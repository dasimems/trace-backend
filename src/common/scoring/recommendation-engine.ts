import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { detectAnomalies } from './anomaly-detection';
import { HealthScoreResult } from './financial-health';
import { ScoringTransaction, ScoreTone } from './scoring.types';

export type RecommendationTrigger =
  | 'safe_to_save'
  | 'overspending'
  | 'category_blowup'
  | 'idle_balance'
  | 'low_buffer'
  | 'failed_transfer'
  | 'no_savings'
  | 'recurring_review';

export interface RecommendationCandidate {
  trigger: RecommendationTrigger;
  tone: ScoreTone;
  tagLabel: string;
  // Deterministic copy — used as-is when the LLM is disabled, and as a hint
  // for the LLM when phrasing.
  title: string;
  detail: string;
  // Structured facts the LLM can use to rewrite the copy with confidence.
  facts: Record<string, string | number>;
}

interface EngineInputs {
  transactions: ScoringTransaction[];
  currentBalance: number;
  health: HealthScoreResult;
}

const KOBO_PER_NAIRA = 100;
const formatNaira = (kobo: number) =>
  `₦${Math.round(kobo / KOBO_PER_NAIRA).toLocaleString('en-NG')}`;

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

export function generateRecommendations(
  inputs: EngineInputs,
): RecommendationCandidate[] {
  const { transactions, currentBalance, health } = inputs;
  const candidates: RecommendationCandidate[] = [];

  const inflow = monthInflow(transactions);
  const outflow = monthOutflow(transactions);
  const net = inflow - outflow;

  // Trigger 1: overspending this month (outflow > inflow).
  if (inflow > 0 && outflow > inflow) {
    candidates.push({
      trigger: 'overspending',
      tone: 'bad',
      tagLabel: 'Spend',
      title: `You spent ${formatNaira(outflow - inflow)} more than you earned`,
      detail: 'Pause non-essential outflows until the gap closes.',
      facts: { inflow, outflow, deficit: outflow - inflow },
    });
  }

  // Trigger 2: comfortably positive net — surface "safe to save" copy.
  // Move ~30% of the surplus, capped at ₦100k to keep recommendations realistic.
  if (net > 0 && health.status === 'ok' && health.score >= 50) {
    const suggested = Math.min(Math.round(net * 0.3), 100 * KOBO_PER_NAIRA * 1000);
    if (suggested >= 5 * KOBO_PER_NAIRA * 1000) {
      candidates.push({
        trigger: 'safe_to_save',
        tone: 'good',
        tagLabel: 'Save',
        title: `${formatNaira(suggested)} is safe to move into Save`,
        detail: 'Keeps daily liquidity while earning yield.',
        facts: { suggested, surplus: net },
      });
    }
  }

  // Trigger 3: low buffer reserves (covers < 14 days of spending).
  const buffer = health.subScores.find((s) => s.label === 'Buffer reserves');
  if (buffer && buffer.score < 30) {
    candidates.push({
      trigger: 'low_buffer',
      tone: 'warn',
      tagLabel: 'Reserve',
      title: 'Buffer is below 2 weeks of spending',
      detail: 'Build the reserve before taking on new commitments.',
      facts: {
        bufferScore: buffer.score,
        currentBalance,
      },
    });
  }

  // Trigger 4: idle balance — large balance with no outflow in 21 days.
  const lastOutflow = transactions
    .filter(
      (t) =>
        t.direction === TransactionDirectionEnum.DEBIT &&
        t.status === TransactionStatusEnum.SUCCESS,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const daysIdle = lastOutflow
    ? Math.floor(
        (Date.now() - lastOutflow.createdAt.getTime()) / (1000 * 3600 * 24),
      )
    : 999;
  if (daysIdle >= 21 && currentBalance >= 50 * KOBO_PER_NAIRA * 1000) {
    candidates.push({
      trigger: 'idle_balance',
      tone: 'info',
      tagLabel: 'Move funds',
      title: `${formatNaira(currentBalance)} has been idle for ${daysIdle} days`,
      detail: 'Earning yield on idle balance compounds while staying liquid.',
      facts: { daysIdle, balance: currentBalance },
    });
  }

  // Trigger 5: anomalies pending review.
  const anomalies = detectAnomalies(transactions);
  const recentAnomalies = anomalies.filter(
    (a) =>
      Date.now() - a.flaggedAt.getTime() < 7 * 24 * 3600 * 1000,
  );
  if (recentAnomalies.length > 0) {
    candidates.push({
      trigger: 'category_blowup',
      tone: 'warn',
      tagLabel: 'Review',
      title: `${recentAnomalies.length} unusual ${recentAnomalies.length === 1 ? 'transaction' : 'transactions'} this week`,
      detail: 'Confirm these were intentional before they shape your baseline.',
      facts: { anomalyCount: recentAnomalies.length },
    });
  }

  // Trigger 6: failed transfers — operational, not financial-planning.
  const recentFailed = transactions.filter(
    (t) =>
      t.direction === TransactionDirectionEnum.DEBIT &&
      (t.status === TransactionStatusEnum.FAILED ||
        t.status === TransactionStatusEnum.REVERSED) &&
      Date.now() - t.createdAt.getTime() < 14 * 24 * 3600 * 1000,
  );
  if (recentFailed.length > 0) {
    candidates.push({
      trigger: 'failed_transfer',
      tone: 'warn',
      tagLabel: 'Retry',
      title: `${recentFailed.length} recent ${recentFailed.length === 1 ? 'transfer' : 'transfers'} did not settle`,
      detail: 'Re-query to confirm and refund the held funds.',
      facts: { failedCount: recentFailed.length },
    });
  }

  // Trigger 7: zero savings rate. Different from overspending — this means
  // they're net-flat. Suggest starting a small auto-rule.
  const savings = health.subScores.find((s) => s.label === 'Savings rate');
  if (savings && savings.score < 40 && inflow > 0 && outflow <= inflow) {
    candidates.push({
      trigger: 'no_savings',
      tone: 'info',
      tagLabel: 'Auto-rule',
      title: 'Set a 10% auto-save rule on payday',
      detail: 'Pay yourself first — the rest flows to spend as normal.',
      facts: { savingsScore: savings.score, suggested: Math.round(inflow * 0.1) },
    });
  }

  // Surface the top 3 candidates. Severity ordering: bad > warn > info > good.
  const toneRank: Record<ScoreTone, number> = {
    bad: 0,
    warn: 1,
    info: 2,
    lime: 3,
    good: 4,
  };
  candidates.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  return candidates.slice(0, 3);
}
