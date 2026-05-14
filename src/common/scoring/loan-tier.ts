import { LoanTierEnum } from '@prisma/client';
import { HealthScoreResult } from './financial-health';

export interface LoanTierResult {
  status: 'ok' | 'insufficient_data';
  tier: LoanTierEnum;
  // Health score this tier was derived from.
  healthScore: number;
  // Max approved exposure in kobo. Used by /loans/products to filter the
  // catalog and by /loans/applications to clamp the approved amount.
  maxExposure: number;
  reasons: string[];
}

const TIERS: Array<{ tier: LoanTierEnum; minScore: number; maxExposureNaira: number }> = [
  // Min score → tier. Crossing the threshold unlocks the next tier.
  { tier: 'BRONZE',   minScore: 0,  maxExposureNaira: 30_000 },
  { tier: 'SILVER',   minScore: 55, maxExposureNaira: 100_000 },
  { tier: 'GOLD',     minScore: 75, maxExposureNaira: 300_000 },
  { tier: 'PLATINUM', minScore: 88, maxExposureNaira: 1_000_000 },
];

export function deriveLoanTier(
  health: HealthScoreResult,
): LoanTierResult {
  if (health.status === 'insufficient_data') {
    return {
      status: 'insufficient_data',
      tier: 'BRONZE',
      healthScore: 0,
      maxExposure: 0,
      reasons: [
        'We need at least 14 days of activity and 14 inflows to assess your tier.',
      ],
    };
  }

  let result = TIERS[0];
  for (const candidate of TIERS) {
    if (health.score >= candidate.minScore) result = candidate;
  }

  // Highlight the 2 sub-scores most responsible for the tier (best signal
  // for the "why you qualify" card on the loans page).
  const reasons = [...health.subScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.reason);

  return {
    status: 'ok',
    tier: result.tier,
    healthScore: health.score,
    maxExposure: result.maxExposureNaira * 100, // kobo
    reasons,
  };
}
