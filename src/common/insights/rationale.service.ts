import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { createHash } from 'crypto';
import Keyv from 'keyv';
import { AnthropicService } from '@common/anthropic/anthropic.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { deriveLoanTier } from '@common/scoring/loan-tier';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { REDIS_CACHE } from '@shared/constants';
import { INSIGHTS_SYSTEM_PROMPT } from '@modules/analysis/insights.prompts';

// Product surface the rationale service can speak about. Loans, investments,
// and opportunities all flatten to this shape — keeps the LLM prompt simple
// and the response easy to fan back out.
export type RationaleProduct =
  | {
      id: string;
      type: 'loan';
      name: string;
      tier: string;
      rateBps: number;
      maxAmount: number;
      tenor: string;
    }
  | {
      id: string;
      type: 'investment';
      name: string;
      yieldBps: number;
      risk: string;
      min: number;
    }
  | {
      id: string;
      type: 'grant';
      name: string;
      awardAmount: number;
      eligibility: string;
    };

// 1 hour. Rationales depend on the user's profile (which mutates with every
// transaction), but the dashboard cares more about consistent demo behavior
// than fresh-to-the-second copy. Refreshes can be forced by busting cache.
const CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class RationaleService {
  private readonly logger = new Logger(RationaleService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly anthropicService: AnthropicService,
    @Inject(REDIS_CACHE) private readonly cache: Keyv,
  ) {}

  // Returns a Map<productId, rationale>. Empty Map when Claude is disabled
  // or returns nothing — callers should just skip attaching the field rather
  // than rendering an empty string.
  async generateForUser(
    userId: string,
    products: RationaleProduct[],
  ): Promise<Map<string, string>> {
    if (products.length === 0) return new Map();
    if (!this.anthropicService.isEnabled()) return new Map();

    // Cache key fingerprints the product set so swapping the catalog
    // invalidates the cached rationales.
    const fingerprint = createHash('sha1')
      .update(
        products
          .map((p) => p.id)
          .sort()
          .join(','),
      )
      .digest('hex')
      .slice(0, 12);
    const cacheKey = `rationale:${userId}:${fingerprint}`;

    const cached = await this.cache.get<Record<string, string>>(cacheKey);
    if (cached) return new Map(Object.entries(cached));

    const profile = await this.buildProfile(userId);
    if (!profile) return new Map();

    const userMessage = `MODE: product_rationale\n${JSON.stringify(
      { user_profile: profile, products },
      null,
      0,
    )}`;

    const parsed = await this.anthropicService.generateJson<{
      rationales?: Array<{ productId: string; text: string }>;
    }>({
      systemPrompt: INSIGHTS_SYSTEM_PROMPT,
      userPrompt: userMessage,
      maxTokens: Math.min(2048, 120 + products.length * 100),
    });

    const result = new Map<string, string>();
    if (parsed?.rationales) {
      for (const r of parsed.rationales) {
        if (r.productId && r.text) {
          result.set(r.productId, r.text.slice(0, 200));
        }
      }
    }
    if (result.size > 0) {
      await this.cache.set(
        cacheKey,
        Object.fromEntries(result),
        CACHE_TTL_MS,
      );
    }
    return result;
  }

  // Compact JSON-friendly snapshot. Keep small — every token here costs full
  // input price on every uncached call.
  private async buildProfile(userId: string) {
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
    if (!account) return null;

    const txs = transactions as ScoringTransaction[];
    const health = computeFinancialHealth(txs, account.balance);
    const tier = deriveLoanTier(health);

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
    const surplus = Math.max(0, inflow - outflow);
    const safeToInvest = Math.round(surplus * 0.3);

    return {
      health_status: health.status,
      health_score: health.score,
      loan_tier: tier.tier,
      monthly_inflow_kobo: inflow,
      monthly_outflow_kobo: outflow,
      monthly_surplus_kobo: surplus,
      balance_kobo: account.balance,
      safe_to_invest_kobo: safeToInvest,
    };
  }
}
