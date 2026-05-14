import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';

// Minimal transaction shape the scoring engines need. Match against
// TransactionSelect — keep this loose so callers can pass whatever they have.
export interface ScoringTransaction {
  id: string;
  reference: string;
  direction: TransactionDirectionEnum;
  status: TransactionStatusEnum;
  category: TransactionCategoryEnum;
  amount: number; // kobo
  senderName?: string | null;
  senderAccountNumber?: string | null;
  recipientName?: string | null;
  recipientAccountNumber?: string | null;
  description?: string | null;
  createdAt: Date;
}

export type ScoreTone = 'good' | 'lime' | 'info' | 'warn' | 'bad';

export interface SubScore {
  label: string;
  score: number; // 0-100
  tone: ScoreTone;
  reason: string;
}

// Minimum activity for scoring to mean anything. With <14 successful inflows
// or <14 days of activity, the scores are noise.
export const MIN_TRANSACTIONS_FOR_SCORING = 14;
export const MIN_DAYS_FOR_SCORING = 14;

export function toneFromScore(score: number): ScoreTone {
  if (score >= 85) return 'good';
  if (score >= 70) return 'lime';
  if (score >= 50) return 'info';
  if (score >= 30) return 'warn';
  return 'bad';
}

export function daysOfActivity(transactions: ScoringTransaction[]): number {
  if (transactions.length === 0) return 0;
  const earliest = Math.min(...transactions.map((t) => t.createdAt.getTime()));
  return Math.ceil((Date.now() - earliest) / (1000 * 60 * 60 * 24));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

// Coefficient of variation. Lower = more consistent. Inverted into a 0-100
// "consistency score" by 100 * (1 - clamp(cv, 0, 1)).
export function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (avg === 0) return 1;
  return stddev(values) / avg;
}
