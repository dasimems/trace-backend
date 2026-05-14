import { computeFinancialHealth } from './financial-health';
import {
  MIN_DAYS_FOR_SCORING,
  MIN_TRANSACTIONS_FOR_SCORING,
  ScoreTone,
  ScoringTransaction,
  daysOfActivity,
} from './scoring.types';

export interface RiskStabilityItem {
  label: string;
  score: number;
  tone: ScoreTone;
  reason: string;
}

export interface RiskStabilityResult {
  status: 'ok' | 'insufficient_data';
  items: RiskStabilityItem[];
  daysOfData: number;
}

// Reuses the health sub-scores directly — the dashboard's "Risk & stability"
// card shows the same primitives as the health composite, just unrolled.
export function computeRiskStability(
  transactions: ScoringTransaction[],
  currentBalance: number,
): RiskStabilityResult {
  const days = daysOfActivity(transactions);
  const inflowCount = transactions.filter(
    (t) => t.direction === 'CREDIT' && t.status === 'SUCCESS',
  ).length;

  if (inflowCount < MIN_TRANSACTIONS_FOR_SCORING || days < MIN_DAYS_FOR_SCORING) {
    return { status: 'insufficient_data', items: [], daysOfData: days };
  }

  const health = computeFinancialHealth(transactions, currentBalance);
  return {
    status: 'ok',
    daysOfData: days,
    items: health.subScores.map((s) => ({
      label: s.label,
      score: s.score,
      tone: s.tone,
      reason: s.reason,
    })),
  };
}
