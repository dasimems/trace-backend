import { TransactionDirectionEnum, TransactionStatusEnum } from '@prisma/client';
import { mean, ScoringTransaction, stddev } from './scoring.types';

export interface RecurringPattern {
  counterparty: string;
  direction: 'CREDIT' | 'DEBIT';
  averageAmount: number; // kobo
  cadence: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'IRREGULAR';
  averageDaysBetween: number;
  occurrences: number;
  lastSeen: Date;
  nextExpected?: Date;
}

function counterpartyKey(tx: ScoringTransaction): string | null {
  if (tx.direction === TransactionDirectionEnum.CREDIT) {
    return tx.senderAccountNumber || tx.senderName;
  }
  return tx.recipientAccountNumber || tx.recipientName;
}

// Amounts are "the same" if within 5% of the median. Tolerates small fees and
// rounding without losing the pattern. Tweak via AMOUNT_TOLERANCE.
const AMOUNT_TOLERANCE = 0.05;
const MIN_OCCURRENCES = 3;

function cadenceLabel(avgDays: number): RecurringPattern['cadence'] {
  if (avgDays >= 6 && avgDays <= 8) return 'WEEKLY';
  if (avgDays >= 13 && avgDays <= 16) return 'BIWEEKLY';
  if (avgDays >= 27 && avgDays <= 33) return 'MONTHLY';
  return 'IRREGULAR';
}

export function detectRecurring(
  transactions: ScoringTransaction[],
): RecurringPattern[] {
  // Group successful txns by counterparty + direction.
  const groups = new Map<string, ScoringTransaction[]>();
  for (const tx of transactions) {
    if (tx.status !== TransactionStatusEnum.SUCCESS) continue;
    const key = counterpartyKey(tx);
    if (!key) continue;
    const groupKey = `${tx.direction}:${key}`;
    const list = groups.get(groupKey) ?? [];
    list.push(tx);
    groups.set(groupKey, list);
  }

  const patterns: RecurringPattern[] = [];
  for (const [groupKey, txs] of groups) {
    if (txs.length < MIN_OCCURRENCES) continue;
    // Sort by date, oldest first.
    txs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Bucket by amount similarity. A single counterparty can have multiple
    // recurring lines (e.g. ₦4,200 Chowdeck weekly + ₦35k Chowdeck monthly);
    // treat each amount band as its own pattern.
    const amountBuckets: ScoringTransaction[][] = [];
    for (const tx of txs) {
      const bucket = amountBuckets.find((b) => {
        const refAmount = b[0].amount;
        return Math.abs(tx.amount - refAmount) <= refAmount * AMOUNT_TOLERANCE;
      });
      if (bucket) bucket.push(tx);
      else amountBuckets.push([tx]);
    }

    for (const bucket of amountBuckets) {
      if (bucket.length < MIN_OCCURRENCES) continue;
      const intervalDays: number[] = [];
      for (let i = 1; i < bucket.length; i++) {
        const diff =
          (bucket[i].createdAt.getTime() - bucket[i - 1].createdAt.getTime()) /
          (1000 * 60 * 60 * 24);
        intervalDays.push(diff);
      }
      const avgGap = mean(intervalDays);
      // Reject if the gap variance is wildly inconsistent — likely noise, not
      // a recurring pattern. CV > 0.5 means intervals swing by ±50%+.
      const gapCv = avgGap === 0 ? 1 : stddev(intervalDays) / avgGap;
      if (gapCv > 0.5) continue;

      const lastSeen = bucket[bucket.length - 1].createdAt;
      const cadence = cadenceLabel(avgGap);
      patterns.push({
        counterparty: counterpartyKey(bucket[0]) || groupKey,
        direction:
          bucket[0].direction === TransactionDirectionEnum.CREDIT
            ? 'CREDIT'
            : 'DEBIT',
        averageAmount: Math.round(
          bucket.reduce((s, t) => s + t.amount, 0) / bucket.length,
        ),
        cadence,
        averageDaysBetween: Math.round(avgGap),
        occurrences: bucket.length,
        lastSeen,
        nextExpected:
          cadence !== 'IRREGULAR'
            ? new Date(lastSeen.getTime() + avgGap * 24 * 3600 * 1000)
            : undefined,
      });
    }
  }

  // Sort by amount, then frequency — bills first, salaries highlighted.
  return patterns.sort(
    (a, b) =>
      b.averageAmount * b.occurrences - a.averageAmount * a.occurrences,
  );
}
