import {
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import {
  clamp,
  coefficientOfVariation,
  daysOfActivity,
  MIN_DAYS_FOR_SCORING,
  MIN_TRANSACTIONS_FOR_SCORING,
  ScoringTransaction,
  SubScore,
  toneFromScore,
} from './scoring.types';

export interface HealthScoreResult {
  status: 'ok' | 'insufficient_data';
  score: number;
  tone: ScoreTone;
  segment: string;
  subScores: SubScore[];
  daysOfData: number;
  tags: Array<{ label: string; tone: ScoreTone }>;
}

// Re-export for callers that want the union without pulling the types file.
import type { ScoreTone } from './scoring.types';

function inflows(transactions: ScoringTransaction[]): ScoringTransaction[] {
  return transactions.filter(
    (t) =>
      t.direction === TransactionDirectionEnum.CREDIT &&
      t.status === TransactionStatusEnum.SUCCESS,
  );
}

function outflows(transactions: ScoringTransaction[]): ScoringTransaction[] {
  return transactions.filter(
    (t) =>
      t.direction === TransactionDirectionEnum.DEBIT &&
      t.status === TransactionStatusEnum.SUCCESS,
  );
}

// Group monthly inflow totals (kobo) for the most recent N months.
function monthlyInflowTotals(
  transactions: ScoringTransaction[],
  months: number = 6,
): number[] {
  const totals = new Map<string, number>();
  for (const tx of inflows(transactions)) {
    const key = `${tx.createdAt.getFullYear()}-${tx.createdAt.getMonth()}`;
    totals.set(key, (totals.get(key) ?? 0) + tx.amount);
  }
  return Array.from(totals.values()).slice(-months);
}

function incomeConsistencyScore(transactions: ScoringTransaction[]): SubScore {
  const monthlyTotals = monthlyInflowTotals(transactions);
  if (monthlyTotals.length < 2) {
    return {
      label: 'Income consistency',
      score: 50,
      tone: 'info',
      reason: 'Not enough months of inflow yet.',
    };
  }
  const cv = coefficientOfVariation(monthlyTotals);
  const score = Math.round(100 * (1 - clamp(cv, 0, 1)));
  return {
    label: 'Income consistency',
    score,
    tone: toneFromScore(score),
    reason:
      cv < 0.15
        ? 'Inflow swings are minimal month-to-month.'
        : cv < 0.4
        ? 'Some month-to-month variance in income.'
        : 'Inflow varies sharply between months.',
  };
}

function savingsRateScore(transactions: ScoringTransaction[]): SubScore {
  const totalIn = inflows(transactions).reduce((s, t) => s + t.amount, 0);
  const totalOut = outflows(transactions).reduce((s, t) => s + t.amount, 0);
  if (totalIn === 0) {
    return {
      label: 'Savings rate',
      score: 0,
      tone: 'bad',
      reason: 'No inflow recorded yet.',
    };
  }
  const rate = (totalIn - totalOut) / totalIn;
  // Anchors: 30% savings rate → 100, 0% → 50, -30% → 0.
  const score = Math.round(clamp(50 + rate * 167, 0, 100));
  return {
    label: 'Savings rate',
    score,
    tone: toneFromScore(score),
    reason: `${Math.round(rate * 100)}% of inflow retained over the period.`,
  };
}

function bufferReservesScore(
  transactions: ScoringTransaction[],
  currentBalance: number,
): SubScore {
  const totalOut = outflows(transactions).reduce((s, t) => s + t.amount, 0);
  const days = daysOfActivity(transactions);
  if (totalOut === 0 || days === 0) {
    return {
      label: 'Buffer reserves',
      score: 50,
      tone: 'info',
      reason: 'Not enough outflow history to size a buffer.',
    };
  }
  const dailyBurn = totalOut / days;
  const daysOfCover = currentBalance / dailyBurn;
  // Anchors: 90 days = 100, 30 days = 70, 7 days = 30, 0 = 0.
  const score = Math.round(clamp(daysOfCover * 1.1, 0, 100));
  return {
    label: 'Buffer reserves',
    score,
    tone: toneFromScore(score),
    reason: `Current balance covers about ${Math.round(daysOfCover)} days of spending.`,
  };
}

function spendingDisciplineScore(
  transactions: ScoringTransaction[],
): SubScore {
  // Spend volatility week-over-week.
  const out = outflows(transactions);
  if (out.length < 7) {
    return {
      label: 'Spending discipline',
      score: 50,
      tone: 'info',
      reason: 'Not enough outflow data to detect spikes.',
    };
  }
  const weeklyBuckets = new Map<number, number>();
  for (const tx of out) {
    const weekKey = Math.floor(tx.createdAt.getTime() / (7 * 24 * 3600 * 1000));
    weeklyBuckets.set(weekKey, (weeklyBuckets.get(weekKey) ?? 0) + tx.amount);
  }
  const weekly = Array.from(weeklyBuckets.values());
  const cv = coefficientOfVariation(weekly);
  const score = Math.round(100 * (1 - clamp(cv, 0, 1)));
  return {
    label: 'Spending discipline',
    score,
    tone: toneFromScore(score),
    reason:
      cv < 0.2
        ? 'Weekly spend stays consistent.'
        : cv < 0.5
        ? 'Some weekly spend variance.'
        : 'Weekly spend is volatile.',
  };
}

function repaymentReliabilityScore(
  transactions: ScoringTransaction[],
): SubScore {
  const failed = transactions.filter(
    (t) =>
      t.direction === TransactionDirectionEnum.DEBIT &&
      (t.status === TransactionStatusEnum.FAILED ||
        t.status === TransactionStatusEnum.REVERSED),
  ).length;
  const totalOut = transactions.filter(
    (t) => t.direction === TransactionDirectionEnum.DEBIT,
  ).length;
  if (totalOut === 0) {
    return {
      label: 'Repayment behaviour',
      score: 60,
      tone: 'info',
      reason: 'No outbound transfers to grade reliability on yet.',
    };
  }
  const successRate = 1 - failed / totalOut;
  const score = Math.round(clamp(successRate * 100, 0, 100));
  return {
    label: 'Repayment behaviour',
    score,
    tone: toneFromScore(score),
    reason:
      failed === 0
        ? 'All outbound transfers settled successfully.'
        : `${failed} of ${totalOut} transfers failed or reversed.`,
  };
}

function diversifiedIncomeScore(transactions: ScoringTransaction[]): SubScore {
  const sources = new Set<string>();
  for (const tx of inflows(transactions)) {
    const key = tx.senderAccountNumber || tx.senderName || tx.reference;
    if (key) sources.add(key);
  }
  // 1 source → 30, 2 → 55, 3 → 75, 4 → 90, 5+ → 100.
  const map: Record<number, number> = { 0: 0, 1: 30, 2: 55, 3: 75, 4: 90 };
  const score = sources.size >= 5 ? 100 : map[sources.size] ?? 0;
  return {
    label: 'Diversified income',
    score,
    tone: toneFromScore(score),
    reason:
      sources.size <= 1
        ? 'All inflow comes from a single source.'
        : `Inflow comes from ${sources.size} distinct sources.`,
  };
}

export function computeFinancialHealth(
  transactions: ScoringTransaction[],
  currentBalance: number,
): HealthScoreResult {
  const successfulIn = inflows(transactions).length;
  const days = daysOfActivity(transactions);

  if (
    successfulIn < MIN_TRANSACTIONS_FOR_SCORING ||
    days < MIN_DAYS_FOR_SCORING
  ) {
    return {
      status: 'insufficient_data',
      score: 0,
      tone: 'info',
      segment: 'Collecting baseline',
      subScores: [],
      daysOfData: days,
      tags: [],
    };
  }

  const subScores = [
    incomeConsistencyScore(transactions),
    savingsRateScore(transactions),
    bufferReservesScore(transactions, currentBalance),
    spendingDisciplineScore(transactions),
    repaymentReliabilityScore(transactions),
    diversifiedIncomeScore(transactions),
  ];

  // Weighted composite. Income consistency + savings rate carry the most weight
  // since they correlate most strongly with creditworthiness in
  // emerging-market personal-finance models.
  const weights: Record<string, number> = {
    'Income consistency': 0.22,
    'Savings rate': 0.22,
    'Buffer reserves': 0.18,
    'Spending discipline': 0.14,
    'Repayment behaviour': 0.14,
    'Diversified income': 0.10,
  };
  const score = Math.round(
    subScores.reduce(
      (sum, s) => sum + s.score * (weights[s.label] ?? 0),
      0,
    ),
  );

  const segment =
    score >= 85
      ? 'Top 10% in your segment'
      : score >= 70
      ? 'Top 25% in your segment'
      : score >= 50
      ? 'Mid-tier in your segment'
      : 'Building toward stable';

  // Surface the 2 strongest signals as tags.
  const tags = [...subScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => ({ label: s.label, tone: s.tone }));

  return {
    status: 'ok',
    score,
    tone: toneFromScore(score),
    segment,
    subScores,
    daysOfData: days,
    tags,
  };
}
