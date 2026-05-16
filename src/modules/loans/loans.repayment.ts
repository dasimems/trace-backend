import {
  LoanProducts,
  LoanRepaymentCadenceEnum,
} from '@prisma/client';

export interface PlannedInstallment {
  sequence: number; // 1-based
  dueAt: Date;
  principalAmount: number; // kobo
  interestAmount: number; // kobo
  totalAmount: number; // kobo
}

export interface LoanPlan {
  installments: PlannedInstallment[];
  totalInterest: number;
  totalRepayment: number;
  // Final installment's dueAt — convenient for LoanApplications.dueAt.
  finalDueAt: Date;
}

// Days-per-step for each cadence. BULLET = 1 installment at the end of tenor.
function stepDaysFor(cadence: LoanRepaymentCadenceEnum, tenorDays: number) {
  switch (cadence) {
    case 'DAILY':
      return 1;
    case 'WEEKLY':
      return 7;
    case 'MONTHLY':
      return 30;
    case 'BULLET':
      return tenorDays;
  }
}

// Generates an equal-payment-style amortized schedule using simple interest
// sized to the tenor. Each installment carries an equal share of principal
// plus an equal share of total interest. Rounding remainders land on the
// final installment so the schedule sums exactly to the planned repayment.
export function generateLoanPlan(
  product: LoanProducts,
  principalKobo: number,
  tenorDays: number,
  disbursedAt: Date = new Date(),
): LoanPlan {
  if (principalKobo <= 0 || tenorDays <= 0) {
    throw new Error('principal and tenor must be positive');
  }
  const annualRate = product.interestRateBps / 10_000;
  const totalInterest = Math.round(
    principalKobo * annualRate * (tenorDays / 365),
  );
  const totalRepayment = principalKobo + totalInterest;

  const step = stepDaysFor(product.repaymentCadence, tenorDays);
  // Number of installments: ceil so the final one closes the tenor even if
  // tenor isn't a clean multiple of step.
  const count =
    product.repaymentCadence === 'BULLET' ? 1 : Math.max(1, Math.ceil(tenorDays / step));

  const basePrincipal = Math.floor(principalKobo / count);
  const baseInterest = Math.floor(totalInterest / count);
  const installments: PlannedInstallment[] = [];
  let allocatedPrincipal = 0;
  let allocatedInterest = 0;

  for (let i = 1; i <= count; i++) {
    const isFinal = i === count;
    const principalPart = isFinal
      ? principalKobo - allocatedPrincipal
      : basePrincipal;
    const interestPart = isFinal ? totalInterest - allocatedInterest : baseInterest;
    allocatedPrincipal += principalPart;
    allocatedInterest += interestPart;

    // Final installment lands exactly on the tenor cutoff; earlier ones step
    // by `step` days from disbursement.
    const offsetDays = isFinal ? tenorDays : step * i;
    const due = new Date(disbursedAt);
    due.setDate(due.getDate() + offsetDays);

    installments.push({
      sequence: i,
      dueAt: due,
      principalAmount: principalPart,
      interestAmount: interestPart,
      totalAmount: principalPart + interestPart,
    });
  }

  return {
    installments,
    totalInterest,
    totalRepayment,
    finalDueAt: installments[installments.length - 1].dueAt,
  };
}
