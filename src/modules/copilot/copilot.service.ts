import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CopilotRoleEnum,
  Prisma,
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { LlmService } from '@common/llm/llm.service';
import { LlmMessage } from '@common/llm/llm.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import {
  CopilotContextResponseDTO,
  Tone as ContextTone,
} from '@common/response/copilot/copilot-context.dto';
import { detectAnomalies } from '@common/scoring/anomaly-detection';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { detectRecurring } from '@common/scoring/recurring-detection';
import { deriveLoanTier } from '@common/scoring/loan-tier';
import { generateRecommendations } from '@common/scoring/recommendation-engine';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { InsightsService } from '@modules/analysis/insights.service';
import { COPILOT_SYSTEM_PROMPT } from './copilot.prompts';
import { COPILOT_TOOLS } from './copilot.tools';
import {
  CopilotChatDTO,
  CopilotMessageDTO,
  CreateCopilotChatBodyDTO,
  GetCopilotMessagesQueryDTO,
  RenameCopilotChatBodyDTO,
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
    private readonly llmService: LlmService,
    private readonly insightsService: InsightsService,
  ) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  async listChats(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const chats = await this.prismaService.copilotChats.findMany({
      where: { userId: auth.id },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
    const data: CopilotChatDTO[] = chats.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
    }));
    return new BaseResponse(data);
  }

  async createChat(body: CreateCopilotChatBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const chat = await this.prismaService.copilotChats.create({
      data: {
        userId: auth.id,
        title: body.title?.length ? body.title : 'New chat',
      },
    });
    return new BaseResponse(this.toChatDTO(chat, 0));
  }

  async renameChat(
    chatId: string,
    body: RenameCopilotChatBodyDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    await this.assertChatOwned(chatId, auth.id);
    const chat = await this.prismaService.copilotChats.update({
      where: { id: chatId },
      data: { title: body.title },
      include: { _count: { select: { messages: true } } },
    });
    return new BaseResponse(this.toChatDTO(chat, chat._count.messages));
  }

  async deleteChat(chatId: string, req: CustomRequest) {
    const auth = this.requireAuth(req);
    await this.assertChatOwned(chatId, auth.id);
    // Cascade on the FK removes the messages.
    await this.prismaService.copilotChats.delete({ where: { id: chatId } });
    return new BaseResponse({ deleted: true });
  }

  async listMessages(
    chatId: string | undefined,
    query: GetCopilotMessagesQueryDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const chat = chatId
      ? await this.assertChatOwned(chatId, auth.id)
      : await this.findMostRecentChat(auth.id);
    if (!chat) {
      // No chats yet — return an empty page rather than 404 so the client can
      // render an empty state without special-casing.
      return new BaseResponse<CopilotMessageDTO[]>([], {
        page: 1,
        limit: 50,
        totalItems: 0,
        req,
      });
    }
    const { page, limit, skip } = this.prismaService.getPaginationDetails({
      page: query.page?.toString(),
      limit: query.limit?.toString(),
    });
    const [totalItems, rows] = await this.prismaService.$transaction([
      this.prismaService.copilotMessages.count({
        where: { chatId: chat.id },
      }),
      this.prismaService.copilotMessages.findMany({
        where: { chatId: chat.id },
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

  async sendMessage(
    chatId: string | undefined,
    body: SendCopilotMessageBodyDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    if (!this.llmService.isEnabled()) {
      throw new ServiceUnavailableException(
        'Copilot is not configured on this server (ANTHROPIC_API_KEY missing).',
      );
    }

    // Resolve target chat: explicit param > most-recent > auto-created default.
    const chat = chatId
      ? await this.assertChatOwned(chatId, auth.id)
      : (await this.findMostRecentChat(auth.id)) ??
        (await this.prismaService.copilotChats.create({
          data: { userId: auth.id, title: 'Default' },
        }));

    // Persist the user turn first so it's preserved even if Claude fails.
    const userMessage = await this.prismaService.copilotMessages.create({
      data: {
        userId: auth.id,
        chatId: chat.id,
        role: CopilotRoleEnum.USER,
        content: body.content,
      },
    });

    const historyRows = await this.prismaService.copilotMessages.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
    const history = historyRows.reverse(); // oldest first for Claude

    const messages: LlmMessage[] = history.map((m) => ({
      role: m.role === CopilotRoleEnum.USER ? 'user' : 'assistant',
      content: m.content,
    }));

    const snapshot = await this.buildUserSnapshot(auth.id);
    // runTools = chat + tool-use loop. The model can call any tool in
    // COPILOT_TOOLS — handler dispatches to private methods below.
    const { finalText } = await this.llmService.runTools({
      systemBlocks: [
        // Stable — cached.
        COPILOT_SYSTEM_PROMPT,
        // Volatile — uncached. Cache breakpoint is on the first block.
        `# User context (live snapshot)\n${JSON.stringify(snapshot, null, 2)}`,
      ],
      messages,
      tools: COPILOT_TOOLS,
      handler: (name, input) => this.handleToolCall(auth.id, name, input),
      maxIterations: 6,
      maxTokens: 1024,
    });
    const assistantText = finalText;

    if (!assistantText) {
      const fallback = await this.prismaService.copilotMessages.create({
        data: {
          userId: auth.id,
          chatId: chat.id,
          role: CopilotRoleEnum.ASSISTANT,
          content:
            "I couldn't reach my reasoning engine just now — please try again in a moment.",
        },
      });
      await this.touchChat(chat.id, userMessage.content);
      return new BaseResponse({
        chatId: chat.id,
        message: this.toDTO(userMessage),
        reply: this.toDTO(fallback),
      });
    }

    const assistantMessage = await this.prismaService.copilotMessages.create({
      data: {
        userId: auth.id,
        chatId: chat.id,
        role: CopilotRoleEnum.ASSISTANT,
        content: assistantText.trim(),
      },
    });
    await this.touchChat(chat.id, userMessage.content);

    return new BaseResponse({
      chatId: chat.id,
      message: this.toDTO(userMessage),
      reply: this.toDTO(assistantMessage),
    });
  }

  // Rolled-up context the wallet's CopilotCard + the chat rail render. The
  // frontend used to need 3+ separate calls; this returns the union as a
  // single DTO. Pure composition of existing compute methods.
  async getContext(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const { transactions, balance } = await this.insightsService.loadContext(
      auth.id,
    );

    // Health drives both the score + the tone chip in the rail.
    const health = this.insightsService.computeHealth(transactions, balance);

    // Run summary + recommendations in parallel — both touch Claude (cached
    // system prompt) but their user payloads differ, so neither blocks the
    // other.
    const [summary, recommendations] = await Promise.all([
      this.insightsService.computeWeeklySummaryFor(transactions, balance),
      this.insightsService.computeRecommendationsFor(transactions, balance),
    ]);

    const obligations = await this.upcomingObligationsFor(auth.id);
    const liveBufferPercent = this.computeLiveBufferPercent(transactions);

    const headline =
      summary.bullets[0]?.text ??
      (health.status === 'insufficient_data'
        ? 'Not enough activity yet to summarize.'
        : 'Quiet stretch — no headline activity this period.');
    const top = recommendations.recommendations[0] ?? null;

    const response: CopilotContextResponseDTO = {
      healthScore: health.score,
      healthTone: health.tone as ContextTone,
      weeklySummaryHeadline: headline,
      topRecommendation: top
        ? {
            title: top.title,
            detail: top.detail,
            tag: { label: top.tag.label, tone: top.tag.tone as ContextTone },
          }
        : null,
      upcomingObligations: obligations,
      liveBufferPercent,
    };
    return new BaseResponse(response);
  }

  // Loan repayments coming due in the next 14 days + recurring debits whose
  // next-expected date falls in that window. Bounded to 4 entries.
  private async upcomingObligationsFor(userId: string) {
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 3600 * 1000);

    const [loans, transactions] = await Promise.all([
      this.prismaService.loanApplications.findMany({
        where: {
          userId,
          status: 'DISBURSED',
          dueAt: { gte: now, lte: horizon },
        },
        include: { product: { select: { name: true } } },
        orderBy: { dueAt: 'asc' },
      }),
      this.prismaService.transactions.findMany({
        where: { userId },
        select: TransactionSelect,
      }),
    ]);

    const obligations: CopilotContextResponseDTO['upcomingObligations'] =
      loans.map((l) => ({
        label: `${l.product.name} · repayment`,
        amount: l.approvedAmount ?? l.requestedAmount,
        dueAt: l.dueAt!,
      }));

    // Add recurring debits whose next occurrence is in-window.
    const recurring = detectRecurring(transactions as ScoringTransaction[]);
    for (const r of recurring) {
      if (
        r.direction !== 'DEBIT' ||
        !r.nextExpected ||
        r.nextExpected < now ||
        r.nextExpected > horizon
      ) {
        continue;
      }
      obligations.push({
        label: r.counterparty,
        amount: r.averageAmount,
        dueAt: r.nextExpected,
      });
    }

    obligations.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return obligations.slice(0, 4);
  }

  // Live buffer = (balance) / (weekly avg outflow). Expressed as a percent
  // of the user's weekly inflow — caps at 100 (full week of cover).
  private computeLiveBufferPercent(transactions: ScoringTransaction[]): number {
    const since = new Date();
    since.setDate(since.getDate() - 28); // last 4 weeks
    const recent = transactions.filter(
      (t) => t.createdAt >= since && t.status === 'SUCCESS',
    );
    const weeklyInflow =
      recent
        .filter((t) => t.direction === 'CREDIT')
        .reduce((s, t) => s + t.amount, 0) / 4;
    if (weeklyInflow <= 0) return 0;
    // We don't have current pocket balances loaded here; use the user's
    // bank-account balance proxy via transactions (net since the window).
    const netSinceWindow = recent.reduce(
      (s, t) => s + (t.direction === 'CREDIT' ? t.amount : -t.amount),
      0,
    );
    const buffer = Math.max(0, netSinceWindow);
    return Math.min(100, Math.round((buffer / weeklyInflow) * 100));
  }

  // Without a chatId, wipes every chat for the user (legacy "clear all"
  // behavior). With a chatId, wipes just that chat's messages but keeps the
  // chat row so the user can keep posting into it.
  async clearMessages(chatId: string | undefined, req: CustomRequest) {
    const auth = this.requireAuth(req);
    if (chatId) {
      await this.assertChatOwned(chatId, auth.id);
      const deleted = await this.prismaService.copilotMessages.deleteMany({
        where: { chatId },
      });
      return new BaseResponse({ deleted: deleted.count });
    }
    const deleted = await this.prismaService.copilotMessages.deleteMany({
      where: { userId: auth.id },
    });
    await this.prismaService.copilotChats.deleteMany({
      where: { userId: auth.id },
    });
    return new BaseResponse({ deleted: deleted.count });
  }

  private async findMostRecentChat(userId: string) {
    return this.prismaService.copilotChats.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async assertChatOwned(chatId: string, userId: string) {
    const chat = await this.prismaService.copilotChats.findUnique({
      where: { id: chatId },
    });
    if (!chat || chat.userId !== userId) {
      throw new NotFoundException('Chat not found');
    }
    return chat;
  }

  // Bump updatedAt so the chat sorts to the top of the list, and seed the
  // title from the first user message when the user hasn't set one.
  private async touchChat(chatId: string, firstUserContent: string) {
    const chat = await this.prismaService.copilotChats.findUnique({
      where: { id: chatId },
      include: { _count: { select: { messages: true } } },
    });
    if (!chat) return;
    const isPlaceholderTitle =
      chat.title === 'New chat' || chat.title === 'Default';
    // _count.messages includes the user turn we just inserted, so 1 = first.
    const shouldRetitle = isPlaceholderTitle && chat._count.messages === 1;
    await this.prismaService.copilotChats.update({
      where: { id: chatId },
      data: {
        updatedAt: new Date(),
        ...(shouldRetitle
          ? { title: this.deriveTitle(firstUserContent) }
          : {}),
      },
    });
  }

  private deriveTitle(content: string): string {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return 'New chat';
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  }

  private toChatDTO(
    c: { id: string; title: string; createdAt: Date; updatedAt: Date },
    messageCount: number,
  ): CopilotChatDTO {
    return {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount,
    };
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

  // ─── Tool handlers ─────────────────────────────────────────────────────
  // Dispatched by the runTools loop. Each handler returns plain JSON-able
  // objects — the loop serializes them as tool_result content for Claude.

  private async handleToolCall(
    userId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case 'lookup_transactions':
        return this.toolLookupTransactions(userId, input);
      case 'simulate_loan':
        return this.toolSimulateLoan(userId, input);
      case 'simulate_investment':
        return this.toolSimulateInvestment(userId, input);
      case 'get_pocket_balances':
        return this.toolGetPocketBalances(userId);
      case 'list_top_recommendations':
        return this.toolListRecommendations(userId);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async toolLookupTransactions(
    userId: string,
    input: Record<string, unknown>,
  ) {
    const days = typeof input.days === 'number' ? input.days : 30;
    const limit = Math.min(
      typeof input.limit === 'number' ? input.limit : 20,
      100,
    );
    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Prisma.TransactionsWhereInput = {
      userId,
      createdAt: { gte: since },
    };
    if (typeof input.category === 'string') {
      where.category = input.category as TransactionCategoryEnum;
    }
    if (input.direction === 'CREDIT' || input.direction === 'DEBIT') {
      where.direction = input.direction;
    }
    if (typeof input.merchant_contains === 'string') {
      const q = input.merchant_contains;
      where.OR = [
        { recipientName: { contains: q, mode: 'insensitive' } },
        { senderName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total, sumAgg] = await this.prismaService.$transaction([
      this.prismaService.transactions.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          amount: true,
          direction: true,
          status: true,
          category: true,
          description: true,
          recipientName: true,
          senderName: true,
        },
      }),
      this.prismaService.transactions.count({ where }),
      this.prismaService.transactions.aggregate({
        where: { ...where, status: TransactionStatusEnum.SUCCESS },
        _sum: { amount: true },
      }),
    ]);

    return {
      total_matching: total,
      total_amount_kobo: sumAgg._sum.amount ?? 0,
      returned: rows.length,
      transactions: rows.map((r) => ({
        date: r.createdAt.toISOString(),
        amount_kobo: r.amount,
        direction: r.direction,
        status: r.status,
        category: r.category,
        counterparty: r.recipientName || r.senderName || null,
        description: r.description,
      })),
    };
  }

  private async toolSimulateLoan(
    userId: string,
    input: Record<string, unknown>,
  ) {
    const amount = typeof input.amountKobo === 'number' ? input.amountKobo : 0;
    const tenorDays =
      typeof input.tenorDays === 'number' ? input.tenorDays : 30;
    if (amount <= 0 || tenorDays <= 0) {
      return { error: 'amountKobo and tenorDays must be positive' };
    }
    const products = await this.prismaService.loanProducts.findMany({
      where: { isActive: true },
    });
    let product = products.find(
      (p) =>
        typeof input.productName === 'string' &&
        p.name.toLowerCase() === (input.productName as string).toLowerCase(),
    );
    if (!product) {
      // Pick cheapest eligible product when the user didn't name one.
      const tier = await this.deriveTierFor(userId);
      const tierOrder = { BRONZE: 0, SILVER: 1, GOLD: 2, PLATINUM: 3 };
      product = products
        .filter(
          (p) =>
            tierOrder[p.requiredTier] <= tierOrder[tier.tier] &&
            amount >= p.minAmount &&
            amount <= p.maxAmount,
        )
        .sort((a, b) => a.interestRateBps - b.interestRateBps)[0];
    }
    if (!product) {
      return {
        error: 'No matching loan product. The amount may exceed your tier cap.',
      };
    }

    const annualRate = product.interestRateBps / 10_000;
    const totalInterest = Math.round(
      amount * annualRate * (tenorDays / 365),
    );
    const totalRepayment = amount + totalInterest;
    const dailyPayment = Math.ceil(totalRepayment / tenorDays);

    // Affordability: daily payment ≤30% of avg daily inflow (last 90 days).
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const inflow = await this.prismaService.transactions.aggregate({
      where: {
        userId,
        direction: TransactionDirectionEnum.CREDIT,
        status: TransactionStatusEnum.SUCCESS,
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    });
    const avgDailyInflow = (inflow._sum.amount ?? 0) / 90;
    const affordable =
      avgDailyInflow > 0 && dailyPayment <= avgDailyInflow * 0.3;

    return {
      product: product.name,
      provider: product.provider,
      tier: product.requiredTier,
      annual_rate_pct: (product.interestRateBps / 100).toFixed(2),
      principal_kobo: amount,
      tenor_days: tenorDays,
      total_interest_kobo: totalInterest,
      total_repayment_kobo: totalRepayment,
      daily_payment_kobo: dailyPayment,
      avg_daily_inflow_kobo: Math.round(avgDailyInflow),
      affordable,
      verdict: affordable
        ? 'Daily payment under 30% of average inflow.'
        : 'Daily payment exceeds 30% of average inflow — risky.',
    };
  }

  private async toolSimulateInvestment(
    userId: string,
    input: Record<string, unknown>,
  ) {
    const amount = typeof input.amountKobo === 'number' ? input.amountKobo : 0;
    if (amount <= 0) return { error: 'amountKobo must be positive' };

    const products = await this.prismaService.investmentProducts.findMany({
      where: { isActive: true },
    });
    let product = products.find(
      (p) =>
        typeof input.productName === 'string' &&
        p.name.toLowerCase() === (input.productName as string).toLowerCase(),
    );
    if (!product) {
      product = products
        .filter((p) => amount >= p.minAmount)
        .sort((a, b) => b.expectedReturnBps - a.expectedReturnBps)[0];
    }
    if (!product) {
      return { error: 'Amount is below the minimum of any product.' };
    }

    const annualRate = product.expectedReturnBps / 10_000;
    const period = product.tenorDays ?? 365;
    const projectedInterest = Math.round(amount * annualRate * (period / 365));

    // Sanity: does the user have the funds?
    const account = await this.prismaService.bankAccounts.findFirst({
      where: { userId },
      select: { balance: true },
    });
    const affordable = (account?.balance ?? 0) >= amount;

    return {
      product: product.name,
      provider: product.provider,
      risk: product.riskLevel,
      annual_yield_pct: (product.expectedReturnBps / 100).toFixed(2),
      principal_kobo: amount,
      tenor_days: product.tenorDays ?? null,
      projected_interest_kobo: projectedInterest,
      total_value_at_maturity_kobo: amount + projectedInterest,
      affordable_against_balance: affordable,
      verdict: affordable
        ? 'You can fund this from your current balance.'
        : 'Insufficient balance — you would need to top up first.',
    };
  }

  private async toolGetPocketBalances(userId: string) {
    const pockets = await this.prismaService.walletPockets.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        name: true,
        type: true,
        balance: true,
        targetAmount: true,
      },
    });
    const account = await this.prismaService.bankAccounts.findFirst({
      where: { userId },
      select: { balance: true },
    });
    const allocated = pockets.reduce((s, p) => s + p.balance, 0);
    const unallocated = (account?.balance ?? 0) - allocated;
    return {
      account_balance_kobo: account?.balance ?? 0,
      unallocated_kobo: unallocated,
      pockets: pockets.map((p) => ({
        name: p.name,
        type: p.type,
        balance_kobo: p.balance,
        target_kobo: p.targetAmount ?? null,
      })),
    };
  }

  private async toolListRecommendations(userId: string) {
    const [transactions, account, loanProducts, investmentProducts] =
      await Promise.all([
        this.prismaService.transactions.findMany({
          where: { userId },
          select: TransactionSelect,
        }),
        this.prismaService.bankAccounts.findFirst({
          where: { userId },
          select: { balance: true },
        }),
        this.prismaService.loanProducts.findMany({ where: { isActive: true } }),
        this.prismaService.investmentProducts.findMany({
          where: { isActive: true },
        }),
      ]);
    const txs = transactions as ScoringTransaction[];
    const health = computeFinancialHealth(txs, account?.balance ?? 0);
    const tier = deriveLoanTier(health);
    const candidates = generateRecommendations({
      transactions: txs,
      currentBalance: account?.balance ?? 0,
      health,
      loanTier: tier,
      loanProducts,
      investmentProducts,
    });
    return {
      count: candidates.length,
      recommendations: candidates.map((c) => ({
        trigger: c.trigger,
        tag: c.tagLabel,
        title: c.title,
        detail: c.detail,
        facts: c.facts,
      })),
    };
  }

  private async deriveTierFor(userId: string) {
    const [transactions, account] = await Promise.all([
      this.prismaService.transactions.findMany({
        where: { userId },
        select: TransactionSelect,
      }),
      this.prismaService.bankAccounts.findFirst({
        where: { userId },
        select: { balance: true },
      }),
    ]);
    return deriveLoanTier(
      computeFinancialHealth(
        transactions as ScoringTransaction[],
        account?.balance ?? 0,
      ),
    );
  }
}
