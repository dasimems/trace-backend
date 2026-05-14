import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CopilotRoleEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AnthropicService } from '@common/anthropic/anthropic.service';
import { AnthropicMessage } from '@common/anthropic/anthropic.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import { detectAnomalies } from '@common/scoring/anomaly-detection';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { detectRecurring } from '@common/scoring/recurring-detection';
import { deriveLoanTier } from '@common/scoring/loan-tier';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { COPILOT_SYSTEM_PROMPT } from './copilot.prompts';
import {
  CopilotMessageDTO,
  GetCopilotMessagesQueryDTO,
  SendCopilotMessageBodyDTO,
} from './copilot.dto';

// Conversation history sent to Claude is capped — keeps tokens bounded and
// preserves the prompt cache (anything past the system block doesn't cache).
const MAX_HISTORY_MESSAGES = 20;

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly anthropicService: AnthropicService,
  ) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  async listMessages(query: GetCopilotMessagesQueryDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const { page, limit, skip } = this.prismaService.getPaginationDetails({
      page: query.page?.toString(),
      limit: query.limit?.toString(),
    });
    const [totalItems, rows] = await this.prismaService.$transaction([
      this.prismaService.copilotMessages.count({
        where: { userId: auth.id },
      }),
      this.prismaService.copilotMessages.findMany({
        where: { userId: auth.id },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);
    const messages: CopilotMessageDTO[] = rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    }));
    return new BaseResponse(messages, { page, limit, totalItems, req });
  }

  async sendMessage(body: SendCopilotMessageBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    if (!this.anthropicService.isEnabled()) {
      throw new ServiceUnavailableException(
        'Copilot is not configured on this server (ANTHROPIC_API_KEY missing).',
      );
    }

    // Persist the user turn first so it's preserved even if Claude fails.
    const userMessage = await this.prismaService.copilotMessages.create({
      data: {
        userId: auth.id,
        role: CopilotRoleEnum.USER,
        content: body.content,
      },
    });

    const historyRows = await this.prismaService.copilotMessages.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
    const history = historyRows.reverse(); // oldest first for Claude

    const messages: AnthropicMessage[] = history.map((m) => ({
      role: m.role === CopilotRoleEnum.USER ? 'user' : 'assistant',
      content: m.content,
    }));

    const snapshot = await this.buildUserSnapshot(auth.id);
    const assistantText = await this.anthropicService.generateChat({
      systemBlocks: [
        // Stable — cached.
        COPILOT_SYSTEM_PROMPT,
        // Volatile — uncached. Cache breakpoint is on the first block, so
        // anything we put after renders fresh on every request.
        `# User context (live snapshot)\n${JSON.stringify(snapshot, null, 2)}`,
      ],
      messages,
      maxTokens: 768,
    });

    if (!assistantText) {
      // Don't lose the user turn — but tell them we couldn't respond.
      const fallback = await this.prismaService.copilotMessages.create({
        data: {
          userId: auth.id,
          role: CopilotRoleEnum.ASSISTANT,
          content:
            "I couldn't reach my reasoning engine just now — please try again in a moment.",
        },
      });
      return new BaseResponse({
        message: this.toDTO(userMessage),
        reply: this.toDTO(fallback),
      });
    }

    const assistantMessage = await this.prismaService.copilotMessages.create({
      data: {
        userId: auth.id,
        role: CopilotRoleEnum.ASSISTANT,
        content: assistantText.trim(),
      },
    });

    return new BaseResponse({
      message: this.toDTO(userMessage),
      reply: this.toDTO(assistantMessage),
    });
  }

  async clearMessages(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const deleted = await this.prismaService.copilotMessages.deleteMany({
      where: { userId: auth.id },
    });
    return new BaseResponse({ deleted: deleted.count });
  }

  // Snapshot lives in the system prompt's second block (uncached). Keep it
  // compact — every token here costs full input price on every turn.
  private async buildUserSnapshot(userId: string) {
    const [user, transactions, account] = await Promise.all([
      this.prismaService.users.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          category: true,
          createdAt: true,
        },
      }),
      this.prismaService.transactions.findMany({
        where: { userId },
        select: TransactionSelect,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prismaService.bankAccounts.findFirst({
        where: { userId },
        select: { balance: true, accountNumber: true, accountName: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!user) return null;

    const txs = transactions as ScoringTransaction[];
    const health = computeFinancialHealth(txs, account?.balance ?? 0);
    const tier = deriveLoanTier(health);
    const recurring = detectRecurring(txs);
    const anomalies = detectAnomalies(txs);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthTxs = txs.filter((t) => t.createdAt >= monthStart);
    const inflow = monthTxs
      .filter(
        (t) =>
          t.direction === TransactionDirectionEnum.CREDIT &&
          t.status === TransactionStatusEnum.SUCCESS,
      )
      .reduce((s, t) => s + t.amount, 0);
    const outflow = monthTxs
      .filter(
        (t) =>
          t.direction === TransactionDirectionEnum.DEBIT &&
          t.status === TransactionStatusEnum.SUCCESS,
      )
      .reduce((s, t) => s + t.amount, 0);

    return {
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      account: account
        ? { accountNumber: account.accountNumber, balance_kobo: account.balance }
        : null,
      this_month: {
        inflow_kobo: inflow,
        outflow_kobo: outflow,
        net_kobo: inflow - outflow,
        savings_rate_pct:
          inflow > 0 ? Math.round(((inflow - outflow) / inflow) * 100) : 0,
      },
      health_status: health.status,
      health_score: health.score,
      health_tags: health.tags,
      loan_tier: tier.tier,
      loan_max_exposure_kobo: tier.maxExposure,
      recurring_count: recurring.length,
      anomaly_count_last_30d: anomalies.filter(
        (a) =>
          Date.now() - a.flaggedAt.getTime() < 30 * 24 * 3600 * 1000,
      ).length,
      generated_at: new Date().toISOString(),
    };
  }

  private toDTO(m: {
    id: string;
    role: CopilotRoleEnum;
    content: string;
    createdAt: Date;
  }): CopilotMessageDTO {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    };
  }
}
