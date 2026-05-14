import {
  InvestmentProducts,
  LoanProducts,
  LoanTierEnum,
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { detectAnomalies } from './anomaly-detection';
import { HealthScoreResult } from './financial-health';
import { LoanTierResult } from './loan-tier';
import { ScoringTransaction, ScoreTone } from './scoring.types';

// Tag taxonomy that the frontend renders as colored chips on the Smart
// Recommendations card. Each trigger maps to exactly one tag.
export type RecommendationTag = 'Save' | 'Spend' | 'Grow' | 'Earn' | 'Review' | 'Reserve' | 'Retry' | 'Move funds' | 'Auto-rule';

export type RecommendationTrigger =
  // Save
  | 'safe_to_save'
  // Spend
  | 'overspending'
  | 'category_cap'
  // Grow (investment + loan upgrades)
  | 'investment_pick'
  | 'loan_tier_match'
  // Earn (yield on idle money)
  | 'yield_on_idle'
  // Operational
  | 'low_buffer'
  | 'category_blowup'
  | 'failed_transfer'
  | 'no_savings'
  | 'idle_balance';

export interface RecommendationCandidate {
  trigger: RecommendationTrigger;
  tone: ScoreTone;
  tagLabel: RecommendationTag;
  // Deterministic copy — used as-is when the LLM is disabled, and as a hint
  // for the LLM when phrasing.
  title: string;
  detail: string;
  // Structured facts the LLM uses to write specific, grounded copy. Always
  // include the actual product name / amount / merchant — never vague.
  facts: Record<string, string | number>;
}

interface EngineInputs {
  transactions: ScoringTransaction[];
  currentBalance: number;
  health: HealthScoreResult;
  loanTier: LoanTierResult;
  loanProducts: LoanProducts[];
  investmentProducts: InvestmentProducts[];
}

const KOBO_PER_NAIRA = 100;
const formatNaira = (kobo: number) =>
  `₦${Math.round(kobo / KOBO_PER_NAIRA).toLocaleString('en-NG')}`;

const TIER_ORDER: Record<LoanTierEnum, number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
};

function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthInflow(transactions: ScoringTransaction[]): number {
  const start = startOfMonth(new Date());
  return transactions
    .filter(
      (t) =>
        t.direction === TransactionDirectionEnum.CREDIT &&
        t.status === TransactionStatusEnum.SUCCESS &&
        t.createdAt >= start,
    )
    .reduce((s, t) => s + t.amount, 0);
}

function monthOutflow(transactions: ScoringTransaction[]): number {
  const start = startOfMonth(new Date());
  return transactions
    .filter(
      (t) =>
        t.direction === TransactionDirectionEnum.DEBIT &&
        t.status === TransactionStatusEnum.SUCCESS &&
        t.createdAt >= start,
    )
    .reduce((s, t) => s + t.amount, 0);
}

// Sum debits by category over a date range.
function categoryTotals(
  transactions: ScoringTransaction[],
  since: Date,
): Map<TransactionCategoryEnum, number> {
  const map = new Map<TransactionCategoryEnum, number>();
  for (const tx of transactions) {
    if (
      tx.direction !== TransactionDirectionEnum.DEBIT ||
      tx.status !== TransactionStatusEnum.SUCCESS ||
      tx.createdAt < since
    )
      continue;
    map.set(tx.category, (map.get(tx.category) ?? 0) + tx.amount);
  }
  return map;
}

function humanCategoryName(cat: TransactionCategoryEnum): string {
  return cat.toLowerCase().replace(/_/g, ' ');
}

// ───── Trigger implementations ─────────────────────────────────────────────

function overspendingTrigger(
  monthIn: number,
  monthOut: number,
): RecommendationCandidate | null {
  if (monthIn <= 0 || monthOut <= monthIn) return null;
  return {
    trigger: 'overspending',
    tone: 'bad',
    tagLabel: 'Spend',
    title: `You spent ${formatNaira(monthOut - monthIn)} more than you earned`,
    detail: 'Pause non-essential outflows until the gap closes.',
    facts: {
      inflow: monthIn,
      outflow: monthOut,
      deficit: monthOut - monthIn,
    },
  };
}

function safeToSaveTrigger(
  net: number,
  health: HealthScoreResult,
): RecommendationCandidate | null {
  if (net <= 0 || health.status !== 'ok' || health.score < 50) return null;
  const suggested = Math.min(
    Math.round(net * 0.3),
    100 * KOBO_PER_NAIRA * 1000,
  );
  if (suggested < 5 * KOBO_PER_NAIRA * 1000) return null;
  return {
    trigger: 'safe_to_save',
    tone: 'good',
    tagLabel: 'Save',
    title: `${formatNaira(suggested)} is safe to move into Save`,
    detail: 'Keeps daily liquidity while earning yield.',
    facts: { suggested, monthlySurplus: net },
  };
}

// New "Grow / Earn" — recommend a specific investment product when the user
// has dry surplus to deploy. Picks the best-yield product the user can fund.
function investmentPickTrigger(
  net: number,
  health: HealthScoreResult,
  investmentProducts: InvestmentProducts[],
): RecommendationCandidate | null {
  if (net <= 0 || investmentProducts.length === 0) return null;
  if (health.status !== 'ok' || health.score < 50) return null;
  // Match risk appetite to health score (same heuristic the opportunities
  // service uses).
  const idealRiskRank =
    health.score >= 85
      ? 3
      : health.score >= 70
      ? 2
      : health.score >= 50
      ? 1
      : 0;
  const riskScore: Record<string, number> = {
    LOW: 0,
    LOW_MEDIUM: 1,
    MEDIUM: 2,
    MEDIUM_HIGH: 3,
    HIGH: 4,
  };
  const suggested = Math.min(
    Math.round(net * 0.3),
    100 * KOBO_PER_NAIRA * 1000,
  );
  if (suggested < 5 * KOBO_PER_NAIRA * 1000) return null;

  const candidates = investmentProducts
    .filter((p) => p.isActive && p.minAmount <= suggested)
    .sort((a, b) => {
      // Closest to ideal risk first; tiebreak on yield.
      const aDistance = Math.abs(riskScore[a.riskLevel] - idealRiskRank);
      const bDistance = Math.abs(riskScore[b.riskLevel] - idealRiskRank);
      if (aDistance !== bDistance) return aDistance - bDistance;
      return b.expectedReturnBps - a.expectedReturnBps;
    });

  const product = candidates[0];
  if (!product) return null;

  const yieldPct = (product.expectedReturnBps / 100).toFixed(1);
  return {
    trigger: 'investment_pick',
    tone: 'good',
    tagLabel: 'Grow',
    title: `Move ${formatNaira(suggested)} into ${product.name}`,
    detail: `Earn ~${yieldPct}% p.a. ${product.tenorDays ? `over ${product.tenorDays} days` : 'while staying liquid'}`,
    facts: {
      productId: product.id,
      productName: product.name,
      provider: product.provider,
      productType: product.type,
      yieldBps: product.expectedReturnBps,
      riskLevel: product.riskLevel,
      suggestedAmount: suggested,
      tenorDays: product.tenorDays ?? 0,
    },
  };
}

// Recommend the best loan when the user's tier indicates they qualify for
// working capital — useful for trader / business categories.
function loanTierMatchTrigger(
  loanTier: LoanTierResult,
  loanProducts: LoanProducts[],
): RecommendationCandidate | null {
  if (loanTier.status !== 'ok') return null;
  if (loanTier.tier === 'BRONZE') return null; // Bronze gets emergency only — not a "Grow" surface
  const userRank = TIER_ORDER[loanTier.tier];
  const eligible = loanProducts
    .filter(
      (p) => p.isActive && TIER_ORDER[p.requiredTier] === userRank,
    )
    .sort((a, b) => a.interestRateBps - b.interestRateBps);
  const product = eligible[0];
  if (!product) return null;
  const ratePct = (product.interestRateBps / 100).toFixed(1);
  return {
    trigger: 'loan_tier_match',
    tone: 'lime',
    tagLabel: 'Grow',
    title: `Apply for ${loanTier.tier.charAt(0)}${loanTier.tier.slice(1).toLowerCase()} loan`,
    detail: `${formatNaira(product.maxAmount)} @ ${ratePct}% for working capital`,
    facts: {
      productId: product.id,
      productName: product.name,
      tier: loanTier.tier,
      maxAmount: product.maxAmount,
      interestBps: product.interestRateBps,
      tenorDaysMin: product.minTenorDays,
      tenorDaysMax: product.maxTenorDays,
    },
  };
}

// Cap on a specific category that's running >30% above its 8-week median.
function categoryCapTrigger(
  transactions: ScoringTransaction[],
): RecommendationCandidate | null {
  const monthStart = startOfMonth(new Date());
  const eightWeeksAgo = new Date(monthStart);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 8 * 7);
  const current = categoryTotals(transactions, monthStart);
  const prior = categoryTotals(transactions, eightWeeksAgo);
  // Subtract current month from prior to get a clean 8-week window.
  for (const [cat, amt] of current) {
    prior.set(cat, (prior.get(cat) ?? 0) - amt);
  }
  let worst: {
    cat: TransactionCategoryEnum;
    current: number;
    median: number;
  } | null = null;
  for (const [cat, currentAmt] of current) {
    // Skip categories whose absolute size is small (avoid suggesting caps on
    // ₦500 / month — noisy).
    if (currentAmt < 10_000 * 100) continue;
    const priorAmt = prior.get(cat) ?? 0;
    // Normalize prior 8 weeks into a per-month figure (~4.33 weeks/mo).
    const median = Math.round((priorAmt / 8) * 4.33);
    if (median <= 0) continue;
    const ratio = currentAmt / median;
    if (ratio < 1.3) continue;
    if (!worst || ratio > worst.current / worst.median) {
      worst = { cat, current: currentAmt, median };
    }
  }
  if (!worst) return null;
  // Cap = floor(median × 1.05) — i.e. 5% above their own median.
  const cap = Math.round(worst.median * 1.05);
  return {
    trigger: 'category_cap',
    tone: 'warn',
    tagLabel: 'Spend',
    title: `Cap ${humanCategoryName(worst.cat)} at ${formatNaira(cap)}`,
    detail: 'Aligns with your 8-week median',
    facts: {
      category: worst.cat,
      currentSpend: worst.current,
      median: worst.median,
      suggestedCap: cap,
    },
  };
}

// Earn — surface what the user is leaving on the table by sitting on cash.
// Uses the highest-yield no-lockup product (typically MMF) as the comparator.
function yieldOnIdleTrigger(
  currentBalance: number,
  investmentProducts: InvestmentProducts[],
): RecommendationCandidate | null {
  // Idle = 30%+ of balance unused for a month → assume sitting fallow.
  const idle = currentBalance;
  if (idle < 50 * KOBO_PER_NAIRA * 1000) return null;
  // No-lockup, highest-yield product wins.
  const openEnded = investmentProducts
    .filter((p) => p.isActive && p.tenorDays === null && p.minAmount <= idle)
    .sort((a, b) => b.expectedReturnBps - a.expectedReturnBps);
  const product = openEnded[0];
  if (!product) return null;
  // Estimated monthly yield in kobo if they parked the whole idle amount.
  const monthlyYield = Math.round(
    (idle * product.expectedReturnBps) / 10_000 / 12,
  );
  if (monthlyYield < 1_000 * 100) return null; // <₦1k/mo isn't motivating
  const yieldPct = (product.expectedReturnBps / 100).toFixed(1);
  return {
    trigger: 'yield_on_idle',
    tone: 'good',
    tagLabel: 'Earn',
    title: `Earn ~${formatNaira(monthlyYield)}/mo on your idle balance`,
    detail: `${product.name} pays ${yieldPct}% p.a. — withdraw anytime`,
    facts: {
      productId: product.id,
      productName: product.name,
      yieldBps: product.expectedReturnBps,
      idleAmount: idle,
      monthlyYield,
    },
  };
}

function lowBufferTrigger(
  health: HealthScoreResult,
  currentBalance: number,
): RecommendationCandidate | null {
  const buffer = health.subScores.find((s) => s.label === 'Buffer reserves');
  if (!buffer || buffer.score >= 30) return null;
  return {
    trigger: 'low_buffer',
    tone: 'warn',
    tagLabel: 'Reserve',
    title: 'Buffer is below 2 weeks of spending',
    detail: 'Build the reserve before taking on new commitments.',
    facts: {
      bufferScore: buffer.score,
      currentBalance,
    },
  };
}

function categoryBlowupTrigger(
  transactions: ScoringTransaction[],
): RecommendationCandidate | null {
  const anomalies = detectAnomalies(transactions);
  const recent = anomalies.filter(
    (a) => Date.now() - a.flaggedAt.getTime() < 7 * 24 * 3600 * 1000,
  );
  if (recent.length === 0) return null;
  return {
    trigger: 'category_blowup',
    tone: 'warn',
    tagLabel: 'Review',
    title: `${recent.length} unusual ${recent.length === 1 ? 'transaction' : 'transactions'} this week`,
    detail: 'Confirm these were intentional before they shape your baseline.',
    facts: { anomalyCount: recent.length },
  };
}

function failedTransferTrigger(
  transactions: ScoringTransaction[],
): RecommendationCandidate | null {
  const recentFailed = transactions.filter(
    (t) =>
      t.direction === TransactionDirectionEnum.DEBIT &&
      (t.status === TransactionStatusEnum.FAILED ||
        t.status === TransactionStatusEnum.REVERSED) &&
      Date.now() - t.createdAt.getTime() < 14 * 24 * 3600 * 1000,
  );
  if (recentFailed.length === 0) return null;
  return {
    trigger: 'failed_transfer',
    tone: 'warn',
    tagLabel: 'Retry',
    title: `${recentFailed.length} recent ${recentFailed.length === 1 ? 'transfer' : 'transfers'} did not settle`,
    detail: 'Re-query to confirm and refund the held funds.',
    facts: { failedCount: recentFailed.length },
  };
}

function noSavingsTrigger(
  monthIn: number,
  monthOut: number,
  health: HealthScoreResult,
): RecommendationCandidate | null {
  const savings = health.subScores.find((s) => s.label === 'Savings rate');
  if (!savings || savings.score >= 40 || monthIn <= 0 || monthOut > monthIn) {
    return null;
  }
  return {
    trigger: 'no_savings',
    tone: 'info',
    tagLabel: 'Auto-rule',
    title: 'Set a 10% auto-save rule on payday',
    detail: 'Pay yourself first — the rest flows to spend as normal.',
    facts: {
      savingsScore: savings.score,
      suggested: Math.round(monthIn * 0.1),
    },
  };
}

// ───── Public entry point ─────────────────────────────────────────────────

export function generateRecommendations(
  inputs: EngineInputs,
): RecommendationCandidate[] {
  const { transactions, currentBalance, health, loanTier, loanProducts, investmentProducts } = inputs;

  const monthIn = monthInflow(transactions);
  const monthOut = monthOutflow(transactions);
  const net = monthIn - monthOut;

  const candidates: RecommendationCandidate[] = [
    overspendingTrigger(monthIn, monthOut),
    safeToSaveTrigger(net, health),
    investmentPickTrigger(net, health, investmentProducts),
    loanTierMatchTrigger(loanTier, loanProducts),
    categoryCapTrigger(transactions),
    yieldOnIdleTrigger(currentBalance, investmentProducts),
    lowBufferTrigger(health, currentBalance),
    categoryBlowupTrigger(transactions),
    failedTransferTrigger(transactions),
    noSavingsTrigger(monthIn, monthOut, health),
  ].filter((c): c is RecommendationCandidate => c !== null);

  // Dedupe by tag — only one card per tag. This avoids two "Spend" cards
  // outranking the one Grow or Earn we want to surface.
  const seenTags = new Set<RecommendationTag>();
  const uniqueByTag: RecommendationCandidate[] = [];
  // Tag priority order — Spend over the others when tied; Grow + Earn always
  // surface for the demo.
  const tagPriority: Record<RecommendationTag, number> = {
    Spend: 0,
    Save: 1,
    Grow: 2,
    Earn: 3,
    Review: 4,
    Retry: 5,
    Reserve: 6,
    'Move funds': 7,
    'Auto-rule': 8,
  };

  // Within a tag, take the most severe candidate first.
  const toneRank: Record<ScoreTone, number> = {
    bad: 0,
    warn: 1,
    info: 2,
    lime: 3,
    good: 4,
  };
  candidates.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  for (const c of candidates) {
    if (seenTags.has(c.tagLabel)) continue;
    seenTags.add(c.tagLabel);
    uniqueByTag.push(c);
  }

  // Final ordering: Save → Spend → Grow → Earn → operational, but always
  // bubble destructive ones (bad/warn) to the top regardless of tag.
  uniqueByTag.sort((a, b) => {
    const toneDelta = toneRank[a.tone] - toneRank[b.tone];
    if (toneDelta !== 0) return toneDelta;
    return tagPriority[a.tagLabel] - tagPriority[b.tagLabel];
  });
  return uniqueByTag.slice(0, 4);
}
