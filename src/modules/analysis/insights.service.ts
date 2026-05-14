import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import Keyv from 'keyv';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AnthropicService } from '@common/anthropic/anthropic.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import {
  CachedEntry,
  CachedInsightDTO,
} from '@common/response/insights/cached-insight.dto';
import { AnalysisTopic } from '@common/response/insights/insights-event.dto';
import {
  AnomaliesResponseDTO,
  HealthScoreResponseDTO,
  RecommendationDTO,
  RecommendationsResponseDTO,
  RecurringResponseDTO,
  RiskStabilityResponseDTO,
  SummaryBulletDTO,
  Tone,
  WeeklySummaryResponseDTO,
} from '@common/response/insights/insights.dto';
import { REDIS_CACHE } from '@shared/constants';
import { detectAnomalies } from '@common/scoring/anomaly-detection';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { detectRecurring } from '@common/scoring/recurring-detection';
import {
  RecommendationCandidate,
  generateRecommendations,
} from '@common/scoring/recommendation-engine';
import { computeRiskStability } from '@common/scoring/risk-stability';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { INSIGHTS_SYSTEM_PROMPT } from './insights.prompts';

// 1 hour: long enough that intermittent dashboard refreshes are free, short
// enough that a user's view stays roughly current. Refreshes are explicit
// via POST /analysis/refresh anyway — TTL is just a safety net.
const CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly anthropicService: AnthropicService,
    @Inject(REDIS_CACHE) private readonly redisCache: Keyv,
  ) {}

  // ─── Cache helpers ──────────────────────────────────────────────────────

  private cacheKey(topic: AnalysisTopic, userId: string) {
    return `insights:${topic}:${userId}`;
  }

  async writeCache<T>(
    topic: AnalysisTopic,
    userId: string,
    value: T,
  ): Promise<void> {
    const entry: CachedEntry<T> = {
      value,
      lastUpdated: new Date().toISOString(),
    };
    await this.redisCache.set(this.cacheKey(topic, userId), entry, CACHE_TTL_MS);
  }

  async readCache<T>(
    topic: AnalysisTopic,
    userId: string,
  ): Promise<CachedEntry<T> | null> {
    const entry = await this.redisCache.get<CachedEntry<T>>(
      this.cacheKey(topic, userId),
    );
    return entry ?? null;
  }

  // GET endpoints all go through this. Never blocks on computation — only
  // reads cache and returns pending status if absent.
  private async readCached<T>(
    topic: AnalysisTopic,
    req: CustomRequest,
  ): Promise<BaseResponse<CachedInsightDTO<T>>> {
    const auth = this.requireAuth(req);
    const entry = await this.readCache<T>(topic, auth.id);
    const wrapper: CachedInsightDTO<T> = entry
      ? {
          status: 'fresh',
          lastUpdated: new Date(entry.lastUpdated),
          value: entry.value,
        }
      : { status: 'pending', lastUpdated: null, value: null };
    return new BaseResponse(wrapper);
  }

  requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  // ─── Cached reads (used by GET endpoints) ──────────────────────────────

  getHealthCached(req: CustomRequest) {
    return this.readCached<HealthScoreResponseDTO>('health', req);
  }
  getRiskStabilityCached(req: CustomRequest) {
    return this.readCached<RiskStabilityResponseDTO>('risk-stability', req);
  }
  getRecurringCached(req: CustomRequest) {
    return this.readCached<RecurringResponseDTO>('recurring', req);
  }
  getAnomaliesCached(req: CustomRequest) {
    return this.readCached<AnomaliesResponseDTO>('anomalies', req);
  }
  getWeeklySummaryCached(req: CustomRequest) {
    return this.readCached<WeeklySummaryResponseDTO>('summary', req);
  }
  getRecommendationsCached(req: CustomRequest) {
    return this.readCached<RecommendationsResponseDTO>('recommendations', req);
  }

  // ─── Pure compute (used by AnalysisJobsService, never by GET handlers) ──

  // Loads transactions + balance once per refresh; all six compute methods
  // share the same snapshot so we don't re-query for each topic.
  async loadContext(userId: string) {
    const [transactions, account] = await Promise.all([
      this.prismaService.transactions.findMany({
        where: { userId },
        select: TransactionSelect,
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.bankAccounts.findFirst({
        where: { userId },
        select: { balance: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      transactions: transactions as ScoringTransaction[],
      balance: account?.balance ?? 0,
    };
  }

  computeHealth(
    transactions: ScoringTransaction[],
    balance: number,
  ): HealthScoreResponseDTO {
    const result = computeFinancialHealth(transactions, balance);
    return {
      status: result.status,
      score: result.score,
      tone: result.tone as Tone,
      segment: result.segment,
      subScores: result.subScores.map((s) => ({
        label: s.label,
        score: s.score,
        tone: s.tone as Tone,
        reason: s.reason,
      })),
      daysOfData: result.daysOfData,
      tags: result.tags.map((t) => ({ label: t.label, tone: t.tone as Tone })),
    };
  }

  computeRiskStabilityFor(
    transactions: ScoringTransaction[],
    balance: number,
  ): RiskStabilityResponseDTO {
    const result = computeRiskStability(transactions, balance);
    return {
      status: result.status,
      daysOfData: result.daysOfData,
      items: result.items.map((i) => ({
        label: i.label,
        score: i.score,
        tone: i.tone as Tone,
        reason: i.reason,
      })),
    };
  }

  computeRecurringFor(
    transactions: ScoringTransaction[],
  ): RecurringResponseDTO {
    return { patterns: detectRecurring(transactions) };
  }

  computeAnomaliesFor(
    transactions: ScoringTransaction[],
  ): AnomaliesResponseDTO {
    return { anomalies: detectAnomalies(transactions) };
  }

  async computeWeeklySummaryFor(
    transactions: ScoringTransaction[],
    balance: number,
  ): Promise<WeeklySummaryResponseDTO> {
    const health = computeFinancialHealth(transactions, balance);
    if (health.status === 'insufficient_data') {
      return { status: 'insufficient_data', bullets: [], aiGenerated: false };
    }
    const metrics = this.buildSummaryInputs(transactions, balance);
    let bullets: SummaryBulletDTO[] = [];
    let aiGenerated = false;

    if (this.anthropicService.isEnabled()) {
      const parsed = await this.anthropicService.generateJson<{
        bullets?: Array<{ tone: Tone; text: string }>;
      }>({
        systemPrompt: INSIGHTS_SYSTEM_PROMPT,
        userPrompt: `MODE: weekly_summary\n${JSON.stringify(metrics)}`,
        maxTokens: 1024,
      });
      if (parsed?.bullets && parsed.bullets.length > 0) {
        bullets = parsed.bullets
          .filter((b) => b.text && b.tone)
          .slice(0, 4)
          .map((b) => ({ tone: b.tone, text: b.text.slice(0, 200) }));
        aiGenerated = true;
      }
    }
    if (bullets.length === 0) bullets = this.deterministicSummary(metrics);
    return { status: 'ok', bullets, aiGenerated };
  }

  async computeRecommendationsFor(
    transactions: ScoringTransaction[],
    balance: number,
  ): Promise<RecommendationsResponseDTO> {
    const health = computeFinancialHealth(transactions, balance);
    const candidates = generateRecommendations({
      transactions,
      currentBalance: balance,
      health,
    });
    if (candidates.length === 0) {
      return { recommendations: [], aiGenerated: false };
    }
    let phrased: RecommendationDTO[] = [];
    let aiGenerated = false;

    if (this.anthropicService.isEnabled()) {
      const parsed = await this.anthropicService.generateJson<{
        recommendations?: Array<{
          trigger: string;
          tag: { label: string; tone: Tone };
          title: string;
          detail: string;
        }>;
      }>({
        systemPrompt: INSIGHTS_SYSTEM_PROMPT,
        userPrompt: `MODE: recommendation_phrasing\n${JSON.stringify(candidates)}`,
        maxTokens: 1024,
      });
      if (parsed?.recommendations && parsed.recommendations.length > 0) {
        phrased = parsed.recommendations.map((r) => ({
          trigger: r.trigger,
          tag: { label: r.tag.label, tone: r.tag.tone },
          title: r.title.slice(0, 80),
          detail: r.detail.slice(0, 140),
        }));
        aiGenerated = true;
      }
    }
    if (phrased.length === 0) {
      phrased = candidates.map((c) => this.toRecommendationDTO(c));
    }
    return { recommendations: phrased, aiGenerated };
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  private toRecommendationDTO(c: RecommendationCandidate): RecommendationDTO {
    return {
      trigger: c.trigger,
      tag: { label: c.tagLabel, tone: c.tone as Tone },
      title: c.title,
      detail: c.detail,
    };
  }

  private buildSummaryInputs(
    transactions: ScoringTransaction[],
    balance: number,
  ) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthTxns = transactions.filter((t) => t.createdAt >= monthStart);

    const inflow = monthTxns
      .filter(
        (t) =>
          t.direction === TransactionDirectionEnum.CREDIT &&
          t.status === TransactionStatusEnum.SUCCESS,
      )
      .reduce((s, t) => s + t.amount, 0);
    const outflow = monthTxns
      .filter(
        (t) =>
          t.direction === TransactionDirectionEnum.DEBIT &&
          t.status === TransactionStatusEnum.SUCCESS,
      )
      .reduce((s, t) => s + t.amount, 0);

    const byCategory = new Map<string, number>();
    for (const tx of monthTxns) {
      if (
        tx.direction !== TransactionDirectionEnum.DEBIT ||
        tx.status !== TransactionStatusEnum.SUCCESS
      )
        continue;
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
    }
    let topCategory = 'OTHER';
    let topAmount = 0;
    for (const [cat, amt] of byCategory) {
      if (amt > topAmount) {
        topAmount = amt;
        topCategory = cat;
      }
    }

    const recurring = detectRecurring(transactions).length;
    const anomalyCount = detectAnomalies(transactions).filter(
      (a) => a.flaggedAt >= monthStart,
    ).length;

    const dailyBurn = outflow > 0 ? outflow / Math.max(1, new Date().getDate()) : 0;
    const bufferDays = dailyBurn > 0 ? Math.floor(balance / dailyBurn) : 999;

    return {
      inflow_kobo: inflow,
      outflow_kobo: outflow,
      net_kobo: inflow - outflow,
      savings_rate_pct: inflow > 0 ? Math.round(((inflow - outflow) / inflow) * 100) : 0,
      recurring_count: recurring,
      anomaly_count: anomalyCount,
      top_outflow_category: topCategory,
      top_outflow_kobo: topAmount,
      buffer_days: bufferDays,
    };
  }

  private deterministicSummary(
    metrics: ReturnType<InsightsService['buildSummaryInputs']>,
  ): SummaryBulletDTO[] {
    const out: SummaryBulletDTO[] = [];
    const formatNaira = (kobo: number) =>
      `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

    if (metrics.net_kobo < 0) {
      out.push({
        tone: 'bad',
        text: `You spent ${formatNaira(Math.abs(metrics.net_kobo))} more than you earned this month.`,
      });
    } else if (metrics.savings_rate_pct >= 20) {
      out.push({
        tone: 'good',
        text: `You saved ${formatNaira(metrics.net_kobo)} this month — a ${metrics.savings_rate_pct}% savings rate.`,
      });
    } else {
      out.push({
        tone: 'info',
        text: `Net ${formatNaira(metrics.net_kobo)} this month after spending.`,
      });
    }

    if (metrics.top_outflow_kobo > 0) {
      out.push({
        tone: 'info',
        text: `Largest category was ${metrics.top_outflow_category.toLowerCase().replace(/_/g, ' ')} at ${formatNaira(metrics.top_outflow_kobo)}.`,
      });
    }

    if (metrics.anomaly_count > 0) {
      out.push({
        tone: 'warn',
        text: `${metrics.anomaly_count} unusual ${metrics.anomaly_count === 1 ? 'transaction' : 'transactions'} flagged this month.`,
      });
    } else if (metrics.recurring_count > 0) {
      out.push({
        tone: 'info',
        text: `${metrics.recurring_count} recurring charges active.`,
      });
    }

    return out;
  }
}
