import { randomUUID } from 'crypto';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LoanApplicationStatusEnum,
  LoanRepaymentStatusEnum,
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

// Default interval if LOAN_AUTO_DEDUCTION_INTERVAL_MS is not configured.
// 6h is a good balance: catches due rows the same day without hammering the
// DB. The cron is idempotent — multiple runs in a row are safe.
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface DeductionSummary {
  applicationsProcessed: number;
  installmentsSwept: number;
  installmentsFullyPaid: number;
  loansClosed: number;
  totalDebitedKobo: number;
}

@Injectable()
export class LoansAutoDeductionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LoansAutoDeductionService.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.configService.get<string>('LOAN_AUTO_DEDUCTION_DISABLED') === 'true') {
      this.logger.log(
        'LOAN_AUTO_DEDUCTION_DISABLED=true — skipping scheduler boot.',
      );
      return;
    }
    const interval =
      Number(this.configService.get<string>('LOAN_AUTO_DEDUCTION_INTERVAL_MS')) ||
      DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.run().catch((err) =>
        this.logger.error(`Auto-deduction sweep failed: ${err.message}`, err.stack),
      );
    }, interval);
    // Don't keep the event loop alive solely for this timer.
    this.timer.unref?.();
    this.logger.log(
      `Loan auto-deduction scheduler armed (every ${Math.round(interval / 1000)}s).`,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // Idempotent. Finds every active loan with at least one installment that is
  // due (or has unpaid arrears) and sweeps the user's account balance against
  // the oldest unpaid installments first, partial-debiting if the balance can't
  // cover the full outstanding.
  async run(now: Date = new Date()): Promise<DeductionSummary> {
    if (this.inFlight) {
      this.logger.debug('Auto-deduction already in-flight; skipping overlap.');
      return {
        applicationsProcessed: 0,
        installmentsSwept: 0,
        installmentsFullyPaid: 0,
        loansClosed: 0,
        totalDebitedKobo: 0,
      };
    }
    this.inFlight = true;
    try {
      return await this.doRun(now);
    } finally {
      this.inFlight = false;
    }
  }

  private async doRun(now: Date): Promise<DeductionSummary> {
    const summary: DeductionSummary = {
      applicationsProcessed: 0,
      installmentsSwept: 0,
      installmentsFullyPaid: 0,
      loansClosed: 0,
      totalDebitedKobo: 0,
    };

    // Active loans that have at least one installment whose due date has passed
    // (or is today) and which isn't fully paid yet.
    const applications = await this.prismaService.loanApplications.findMany({
      where: {
        status: LoanApplicationStatusEnum.DISBURSED,
        repayments: {
          some: {
            dueAt: { lte: now },
            status: { not: LoanRepaymentStatusEnum.PAID },
          },
        },
      },
      include: {
        product: { select: { name: true, provider: true } },
      },
    });

    for (const app of applications) {
      try {
        const debited = await this.processApplication(app.id, now);
        summary.applicationsProcessed += 1;
        summary.installmentsSwept += debited.installmentsSwept;
        summary.installmentsFullyPaid += debited.installmentsFullyPaid;
        summary.loansClosed += debited.loanClosed ? 1 : 0;
        summary.totalDebitedKobo += debited.totalDebitedKobo;
      } catch (err) {
        // Don't let one user's failure stall the rest of the sweep.
        this.logger.error(
          `Failed to process application ${app.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    if (summary.applicationsProcessed > 0) {
      this.logger.log(
        `Auto-deduction sweep: ${summary.applicationsProcessed} loans, ` +
          `${summary.installmentsSwept} installments swept ` +
          `(${summary.installmentsFullyPaid} closed, ` +
          `₦${(summary.totalDebitedKobo / 100).toFixed(2)} debited, ` +
          `${summary.loansClosed} loans repaid).`,
      );
    }
    return summary;
  }

  private async processApplication(applicationId: string, now: Date) {
    return this.prismaService.$transaction(async (tx) => {
      // Re-fetch inside the txn so we see fresh state if a concurrent run is
      // mid-sweep. Lock-free; idempotency comes from the partial-debit math.
      const app = await tx.loanApplications.findUnique({
        where: { id: applicationId },
        include: {
          product: { select: { name: true } },
          repayments: {
            where: {
              dueAt: { lte: now },
              status: { not: LoanRepaymentStatusEnum.PAID },
            },
            orderBy: { sequence: 'asc' },
          },
        },
      });
      if (!app || app.status !== LoanApplicationStatusEnum.DISBURSED) {
        return {
          installmentsSwept: 0,
          installmentsFullyPaid: 0,
          loanClosed: false,
          totalDebitedKobo: 0,
        };
      }

      const account = await tx.bankAccounts.findFirst({
        where: { userId: app.userId },
        orderBy: { createdAt: 'asc' },
      });
      if (!account) {
        this.logger.warn(
          `User ${app.userId} has loan ${app.id} but no bank account.`,
        );
        return {
          installmentsSwept: 0,
          installmentsFullyPaid: 0,
          loanClosed: false,
          totalDebitedKobo: 0,
        };
      }

      let remainingBalance = account.balance;
      let totalDebited = 0;
      let installmentsSwept = 0;
      let installmentsFullyPaid = 0;

      for (const installment of app.repayments) {
        if (remainingBalance <= 0) break;
        const outstanding = installment.totalAmount - installment.paidAmount;
        if (outstanding <= 0) continue;

        const debit = Math.min(remainingBalance, outstanding);
        const newPaid = installment.paidAmount + debit;
        const fullyPaid = newPaid >= installment.totalAmount;

        await tx.loanRepayments.update({
          where: { id: installment.id },
          data: {
            paidAmount: newPaid,
            status: fullyPaid
              ? LoanRepaymentStatusEnum.PAID
              : LoanRepaymentStatusEnum.DUE,
            paidAt: fullyPaid ? now : null,
          },
        });

        await tx.transactions.create({
          data: {
            reference: `loan-rpay-${randomUUID().replace(/-/g, '')}`,
            direction: TransactionDirectionEnum.DEBIT,
            status: TransactionStatusEnum.SUCCESS,
            category: TransactionCategoryEnum.OTHER,
            description: `${app.product.name} repayment (installment ${installment.sequence})`,
            amount: debit,
            principalAmount: debit,
            settledAmount: debit,
            remark: fullyPaid
              ? 'Auto-debit · installment closed'
              : 'Auto-debit · partial — balance short',
            processedAt: now,
            accountId: account.id,
            userId: app.userId,
          },
        });

        remainingBalance -= debit;
        totalDebited += debit;
        installmentsSwept += 1;
        if (fullyPaid) installmentsFullyPaid += 1;
      }

      if (totalDebited > 0) {
        await tx.bankAccounts.update({
          where: { id: account.id },
          data: { balance: { decrement: totalDebited } },
        });
      }

      // If every installment on the loan is now PAID, close it out.
      const remainingOutstanding = await tx.loanRepayments.count({
        where: {
          applicationId: app.id,
          status: { not: LoanRepaymentStatusEnum.PAID },
        },
      });
      let loanClosed = false;
      if (remainingOutstanding === 0) {
        await tx.loanApplications.update({
          where: { id: app.id },
          data: {
            status: LoanApplicationStatusEnum.REPAID,
            repaidAt: now,
          },
        });
        loanClosed = true;
      }

      return {
        installmentsSwept,
        installmentsFullyPaid,
        loanClosed,
        totalDebitedKobo: totalDebited,
      };
    });
  }
}
