import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionStatusEnum } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { PaymentRequestsService } from './payment-requests.service';
import { WalletService } from './wallet.service';

// Default cadence — 5 minutes is comfortably under the 10-minute "stale"
// threshold and well clear of Squad's typical webhook delivery window.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// Minimum age before a row is considered "stale enough to reverify". Younger
// rows are still on the happy path (verify-on-return or webhook) and don't
// need our intervention.
const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

export interface ReconcileSummary {
  paymentRequestsProcessed: number;
  paymentRequestsResolved: number;
  legacyTransactionsProcessed: number;
}

// Periodic safety net for missed webhooks. Runs in-process via setInterval
// (we deliberately don't pull in @nestjs/schedule). Idempotent — every row
// it touches goes through the same reverify path as the user-triggered
// /wallet/refresh endpoint, so racing the webhook is a no-op.
@Injectable()
export class WalletReconcilerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WalletReconcilerService.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly walletService: WalletService,
    private readonly paymentRequestsService: PaymentRequestsService,
  ) {}

  onApplicationBootstrap() {
    if (
      this.configService.get<string>('WALLET_RECONCILER_DISABLED') === 'true'
    ) {
      this.logger.log(
        'WALLET_RECONCILER_DISABLED=true — skipping reconciler boot.',
      );
      return;
    }
    const intervalMs =
      Number(this.configService.get<string>('WALLET_RECONCILER_INTERVAL_MS')) ||
      DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.run().catch((err) =>
        this.logger.error(
          `Reconciler sweep failed: ${err.message}`,
          err.stack,
        ),
      );
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Wallet reconciler armed (every ${Math.round(intervalMs / 1000)}s, stale-after ${Math.round(DEFAULT_STALE_AFTER_MS / 1000)}s).`,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // Safe to call manually too — exposed (no auth gate) but the only callers
  // are this service's own setInterval and any future dev/admin endpoint.
  async run(): Promise<ReconcileSummary> {
    if (this.inFlight) {
      this.logger.debug('Reconciler already running; skipping overlap.');
      return {
        paymentRequestsProcessed: 0,
        paymentRequestsResolved: 0,
        legacyTransactionsProcessed: 0,
      };
    }
    this.inFlight = true;
    try {
      return await this.doRun();
    } finally {
      this.inFlight = false;
    }
  }

  private async doRun(): Promise<ReconcileSummary> {
    // 1. New flow: PaymentRequests rows that have been PENDING > 10m.
    const prSummary = await this.paymentRequestsService.reconcileStalePending({
      olderThanMs: DEFAULT_STALE_AFTER_MS,
      batchSize: 50,
    });

    // 2. Legacy fallback: outbound transfer rows (DEBIT PENDING on
    //    `transactions`) plus any pre-refactor /wallet/fund rows that are
    //    still on `transactions` instead of `payment_requests`.
    const cutoff = new Date(Date.now() - DEFAULT_STALE_AFTER_MS);
    const staleTransactions = await this.prismaService.transactions.findMany({
      where: {
        status: TransactionStatusEnum.PENDING,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { reference: true },
    });
    if (staleTransactions.length > 0) {
      await Promise.allSettled(
        staleTransactions.map((row) =>
          // Bypass the user-bound reverifyTransaction wrapper (no auth in cron
          // context). The shared helper does the same Squad call + finalise.
          this.walletService.reverifyByReferenceUnscoped(row.reference),
        ),
      );
    }

    return {
      paymentRequestsProcessed: prSummary.processed,
      paymentRequestsResolved: prSummary.resolved ?? 0,
      legacyTransactionsProcessed: staleTransactions.length,
    };
  }
}
