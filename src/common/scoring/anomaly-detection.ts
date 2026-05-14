import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { mean, ScoringTransaction, stddev } from './scoring.types';

export interface Anomaly {
  transactionId: string;
  reference: string;
  category: TransactionCategoryEnum;
  amount: number; // kobo
  expectedRange: { low: number; high: number }; // kobo, mean ± 2σ for that category
  zScore: number;
  reason: string;
  flaggedAt: Date;
}

// Per-category z-score. A debit is anomalous if it's >Z_THRESHOLD standard
// deviations above the user's own historical mean for that category.
const Z_THRESHOLD = 2.5;
const MIN_SAMPLES_PER_CATEGORY = 5;

export function detectAnomalies(
  transactions: ScoringTransaction[],
): Anomaly[] {
  const debits = transactions.filter(
    (t) =>
      t.direction === TransactionDirectionEnum.DEBIT &&
      t.status === TransactionStatusEnum.SUCCESS,
  );

  // Bucket by category, then compute per-category baseline.
  const byCategory = new Map<TransactionCategoryEnum, ScoringTransaction[]>();
  for (const tx of debits) {
    const list = byCategory.get(tx.category) ?? [];
    list.push(tx);
    byCategory.set(tx.category, list);
  }

  const anomalies: Anomaly[] = [];
  for (const [category, txs] of byCategory) {
    if (txs.length < MIN_SAMPLES_PER_CATEGORY) continue;
    const amounts = txs.map((t) => t.amount);
    const avg = mean(amounts);
    const sd = stddev(amounts);
    if (sd === 0) continue;
    for (const tx of txs) {
      const z = (tx.amount - avg) / sd;
      if (z >= Z_THRESHOLD) {
        anomalies.push({
          transactionId: tx.id,
          reference: tx.reference,
          category,
          amount: tx.amount,
          expectedRange: {
            low: Math.max(0, Math.round(avg - 2 * sd)),
            high: Math.round(avg + 2 * sd),
          },
          zScore: Math.round(z * 10) / 10,
          reason: `Transaction is ${z.toFixed(1)}σ above your typical ${categoryLabel(category)} spend (₦${formatKobo(avg)}).`,
          flaggedAt: tx.createdAt,
        });
      }
    }
  }

  return anomalies.sort(
    (a, b) => b.flaggedAt.getTime() - a.flaggedAt.getTime(),
  );
}

function categoryLabel(category: TransactionCategoryEnum): string {
  return category.toLowerCase().replace(/_/g, ' ');
}

function formatKobo(kobo: number): string {
  return (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}
