import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import Keyv from 'keyv';
import { REDIS_CACHE } from '@shared/constants';
import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { BankAccountSelect } from '@common/prisma/selects/bank-account.select';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import AccountResponse from '@common/response/account/account.response';
import BaseResponse from '@common/response/base.response';
import TransactionResponse from '@common/response/transaction/transaction.response';
import {
  BankDTO,
  FundAccountResponseDTO,
  RecentRecipientDTO,
  TransferLookupResponseDTO,
  WalletResponseDTO,
} from '@common/response/wallet/wallet.dto';
import { EventBusService } from '@common/events/event-bus.service';
import { SquadService } from '@common/squad/squad.service';
import { inferTransferCategory } from './category-inference';
import {
  FundAccountBodyDTO,
  LookupAccountBodyDTO,
  TransferBodyDTO,
} from './wallet.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  // Squad's bank list barely changes; cache aggressively so the transfer
  // screen renders instantly and we don't hit Squad on every page load.
  private static readonly BANKS_CACHE_KEY = 'wallet:banks';
  private static readonly BANKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly squadService: SquadService,
    private readonly eventBus: EventBusService,
    @Inject(REDIS_CACHE) private readonly cache: Keyv,
  ) {}

  async listBanks(): Promise<BaseResponse<BankDTO[]>> {
    const cached = await this.cache.get<BankDTO[]>(WalletService.BANKS_CACHE_KEY);
    if (cached) return new BaseResponse(cached);

    const banks = await this.squadService.listBanks();
    // Normalise Squad's snake_case shape to camelCase and drop any malformed
    // entries Squad has occasionally returned in sandbox.
    const normalised: BankDTO[] = banks
      .filter((b) => b.bank_code && b.name)
      .map((b) => ({ code: b.bank_code, name: b.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (normalised.length > 0) {
      await this.cache.set(
        WalletService.BANKS_CACHE_KEY,
        normalised,
        WalletService.BANKS_CACHE_TTL_MS,
      );
    }
    return new BaseResponse(normalised);
  }

  private async getPrimaryAccount(userId: string) {
    return this.prismaService.bankAccounts.findFirst({
      where: { userId },
      select: BankAccountSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  private startOfDay(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async getWallet(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    const snapshot = await this.buildWalletSnapshot(auth.id);
    return new BaseResponse(snapshot);
  }

  // Used by both getWallet (fast read) and refreshWallet (after reconciliation).
  private async buildWalletSnapshot(
    userId: string,
  ): Promise<WalletResponseDTO> {
    const account = await this.getPrimaryAccount(userId);
    if (!account) {
      throw new NotFoundException(
        'No bank account found. Complete sign-up before viewing your wallet.',
      );
    }

    const startOfToday = this.startOfDay(new Date());

    const [todayInflowAgg, todayOutflowAgg, pendingAgg] =
      await this.prismaService.$transaction([
        this.prismaService.transactions.aggregate({
          where: {
            accountId: account.id,
            direction: TransactionDirectionEnum.CREDIT,
            status: TransactionStatusEnum.SUCCESS,
            createdAt: { gte: startOfToday },
          },
          _sum: { amount: true },
        }),
        this.prismaService.transactions.aggregate({
          where: {
            accountId: account.id,
            direction: TransactionDirectionEnum.DEBIT,
            status: TransactionStatusEnum.SUCCESS,
            createdAt: { gte: startOfToday },
          },
          _sum: { amount: true },
        }),
        this.prismaService.transactions.aggregate({
          where: {
            accountId: account.id,
            direction: TransactionDirectionEnum.DEBIT,
            status: TransactionStatusEnum.PENDING,
          },
          _sum: { amount: true },
        }),
      ]);

    const pending = pendingAgg._sum.amount ?? 0;
    return {
      account: AccountResponse.constructAccountDetails(account),
      balance: {
        available: Math.max(account.balance - pending, 0),
        ledger: account.balance,
        pending,
        todayInflow: todayInflowAgg._sum.amount ?? 0,
        todayOutflow: todayOutflowAgg._sum.amount ?? 0,
      },
    };
  }


  async lookupAccount(body: LookupAccountBodyDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const lookup = await this.squadService.lookupAccount({
      bank_code: body.bankCode,
      account_number: body.accountNumber,
    });

    const response: TransferLookupResponseDTO = {
      accountName: lookup.account_name,
      accountNumber: lookup.account_number,
      bankCode: body.bankCode,
    };
    return new BaseResponse(response);
  }

  // ─── Reconciliation against Squad (for missed/late webhooks) ─────────────

  // Reverify a single PENDING transaction against Squad, picking the right
  // endpoint based on direction. Idempotent and safe to call repeatedly.
  // Used by /wallet/refresh (bulk), /wallet/transactions/:ref/reverify
  // (single), and indirectly by a future reconciler cron.
  // Public, no-auth wrapper for the reconciler cron. Skips ownership checks
  // because the caller is the system itself, not a user-facing request.
  async reverifyByReferenceUnscoped(reference: string) {
    return this.reverifyPendingInternal(reference);
  }

  private async reverifyPendingInternal(reference: string) {
    const tx = await this.prismaService.transactions.findUnique({
      where: { reference },
      select: TransactionSelect,
    });
    if (!tx) return null;
    if (tx.status !== TransactionStatusEnum.PENDING) return tx;

    if (tx.direction === TransactionDirectionEnum.CREDIT) {
      // Fund-account top-up. /transaction/verify is the source of truth.
      const remote = await this.squadService.verifyPayment(reference);
      const status = (remote.transaction_status ?? '').toLowerCase();
      if (status === 'success' || status === 'successful') {
        return this.finaliseFundedTransaction(reference, {
          gatewayRef: remote.gateway_ref,
          paymentType: remote.payment_information?.payment_type,
        });
      }
      if (status === 'failed' || status === 'fail' || status === 'cancelled') {
        return this.prismaService.transactions.update({
          where: { reference },
          data: {
            status: TransactionStatusEnum.FAILED,
            processedAt: new Date(),
          },
          select: TransactionSelect,
        });
      }
      return tx; // still PENDING at Squad — leave it.
    }

    // DEBIT (outbound transfer). /payout/requery describes the live state.
    const remote = await this.squadService.requeryTransfer(reference);
    const description = remote.response_description?.toLowerCase() || '';
    let newStatus: TransactionStatusEnum = TransactionStatusEnum.PENDING;
    if (description.includes('success') || description.includes('approved')) {
      newStatus = TransactionStatusEnum.SUCCESS;
    } else if (description.includes('reverse')) {
      newStatus = TransactionStatusEnum.REVERSED;
    } else if (description.includes('fail')) {
      newStatus = TransactionStatusEnum.FAILED;
    }
    if (newStatus === TransactionStatusEnum.PENDING) return tx;

    return this.prismaService.$transaction(async (db) => {
      // Reversed/Failed transfers refund the held funds.
      if (
        newStatus === TransactionStatusEnum.FAILED ||
        newStatus === TransactionStatusEnum.REVERSED
      ) {
        await db.bankAccounts.update({
          where: { id: tx.accountId },
          data: { balance: { increment: tx.amount } },
        });
      }
      const updated = await db.transactions.update({
        where: { id: tx.id },
        data: {
          status: newStatus,
          providerReference:
            remote.nip_transaction_reference ?? tx.providerReference,
          recipientBankName:
            remote.destination_institution_name ?? tx.recipientBankName,
          processedAt: new Date(),
        },
        select: TransactionSelect,
      });
      // Notify SSE subscribers — the wallet stream filters to wallet.* events.
      this.eventBus.publish(tx.userId, {
        type: `wallet.transfer.${newStatus.toLowerCase()}`,
        payload: {
          transactionId: updated.id,
          reference: updated.reference,
          amount: updated.amount,
          status: newStatus,
        },
      });
      return updated;
    });
  }

  // Single-reference reverify exposed to the frontend. Works for fund-account
  // top-ups AND outbound transfers — direction is read from the local row.
  async reverifyTransaction(reference: string, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const tx = await this.prismaService.transactions.findUnique({
      where: { reference },
      select: { userId: true },
    });
    if (!tx || tx.userId !== auth.id) {
      throw new NotFoundException('Transaction not found.');
    }
    const updated = await this.reverifyPendingInternal(reference);
    if (!updated) throw new NotFoundException('Transaction not found.');
    return TransactionResponse.createIndividualTransactionResponse(updated);
  }

  // Bulk reconcile all of the user's PENDING transactions against Squad and
  // return the up-to-date wallet snapshot. Useful for "pull to refresh" /
  // page-focus events / recovery from a missed webhook batch. Bounded to the
  // 25 most-recent PENDING rows to keep tail latency in check; if you have
  // more PENDING than that you have bigger problems anyway.
  async refreshWallet(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const pending = await this.prismaService.transactions.findMany({
      where: {
        userId: auth.id,
        status: TransactionStatusEnum.PENDING,
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { reference: true },
    });

    if (pending.length > 0) {
      // Run in parallel — Squad's verify/requery endpoints are independent.
      // One failure shouldn't sink the whole refresh; log and continue.
      await Promise.all(
        pending.map((p) =>
          this.reverifyPendingInternal(p.reference).catch((err) => {
            this.logger.warn(
              `Reverify ${p.reference} failed during refresh: ${(err as Error).message}`,
            );
            return null;
          }),
        ),
      );
    }

    // Return the fresh wallet snapshot — exactly what GET /wallet returns,
    // so the frontend can swap it in directly.
    return this.getWallet(req);
  }

  // ─── Fund account (payment-in via Squad checkout) ────────────────────────

  async initiateFundAccount(body: FundAccountBodyDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const [account, user] = await Promise.all([
      this.getPrimaryAccount(auth.id),
      this.prismaService.users.findUnique({
        where: { id: auth.id },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
    ]);
    if (!account) {
      throw new NotFoundException(
        'No bank account found. Complete sign-up before funding.',
      );
    }
    if (!user) throw new UnauthorizedException('Unauthorized!');

    // Unique, traceable reference. Squad accepts up to 100 chars; we keep
    // ours short so it round-trips cleanly through their dashboard.
    const reference = `trace-fund-${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    // 1. Pre-create the local row in PENDING. Whichever path finalises first
    //    (verify-on-return OR webhook) flips it to SUCCESS atomically.
    await this.prismaService.transactions.create({
      data: {
        reference,
        direction: TransactionDirectionEnum.CREDIT,
        status: TransactionStatusEnum.PENDING,
        category: TransactionCategoryEnum.INCOME,
        description: 'Wallet top-up',
        amount: body.amount,
        principalAmount: body.amount,
        currency: 'NGN',
        remark: 'Payment via Squad checkout',
        accountId: account.id,
        userId: auth.id,
      },
    });

    // 2. Ask Squad for a hosted checkout URL.
    const customerName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      undefined;
    const squadResult = await this.squadService.initiatePayment({
      amount: body.amount,
      email: user.email ?? `${user.id}@trace.local`,
      currency: 'NGN',
      transaction_ref: reference,
      callback_url: body.callbackUrl,
      initiate_type: 'inline',
      customer_name: customerName,
      payment_channels: ['card', 'bank', 'ussd', 'transfer'],
      metadata: { userId: auth.id },
    });

    const checkoutUrl =
      squadResult.checkout_url ?? squadResult.authorization_url ?? null;
    if (!checkoutUrl) {
      // Squad accepted but didn't return a URL — log + leave the local row as
      // PENDING so the user can retry without orphaning state.
      this.logger.error(
        `Squad initiate accepted but returned no checkout URL for ref=${reference}`,
      );
      throw new BadGatewayException(
        'Payment service did not return a checkout URL. Please try again.',
      );
    }

    const response: FundAccountResponseDTO = {
      checkoutUrl,
      reference,
      amount: body.amount,
      currency: 'NGN',
    };
    return new BaseResponse(response);
  }

  // Frontend calls this after the user returns from Squad's checkout page.
  // Thin wrapper around the unified reconciler — keeps the legacy endpoint
  // working while the actual logic lives in one place.
  async verifyFundAccount(reference: string, req: CustomRequest) {
    return this.reverifyTransaction(reference, req);
  }

  // Shared finaliser: flips a PENDING fund-account row to SUCCESS, credits
  // the user's balance, and publishes the SSE event. Idempotent — returns
  // the existing row untouched if it's already SUCCESS. Public so the webhook
  // handler can call it without going through HTTP.
  async finaliseFundedTransaction(
    reference: string,
    meta: { gatewayRef?: string; paymentType?: string } = {},
  ) {
    return this.prismaService.$transaction(async (tx) => {
      const row = await tx.transactions.findUnique({
        where: { reference },
        select: TransactionSelect,
      });
      if (!row) {
        throw new NotFoundException(`Transaction ${reference} not found.`);
      }
      if (row.status === TransactionStatusEnum.SUCCESS) {
        // Webhook + verify can race — the second caller short-circuits.
        return row;
      }

      const updated = await tx.transactions.update({
        where: { reference },
        data: {
          status: TransactionStatusEnum.SUCCESS,
          providerReference: meta.gatewayRef ?? row.providerReference ?? null,
          settledAmount: row.principalAmount ?? row.amount,
          remark: meta.paymentType
            ? `Payment via Squad (${meta.paymentType})`
            : row.remark,
          processedAt: new Date(),
        },
        select: TransactionSelect,
      });
      const account = await tx.bankAccounts.update({
        where: { id: row.accountId },
        data: { balance: { increment: row.amount } },
        select: { balance: true },
      });

      // Fire-and-forget — event bus runs in-process, no async work to await.
      this.eventBus.publish(row.userId, {
        type: 'wallet.fund.received',
        payload: {
          transactionId: row.id,
          reference: row.reference,
          amount: row.amount,
          balance: account.balance,
          gatewayRef: meta.gatewayRef ?? null,
          paymentType: meta.paymentType ?? null,
        },
      });
      return updated;
    });
  }

  async transfer(body: TransferBodyDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const account = await this.getPrimaryAccount(auth.id);
    if (!account) {
      throw new NotFoundException(
        'No bank account found. Complete sign-up before sending money.',
      );
    }

    if (account.balance < body.amount) {
      throw new BadRequestException(
        'Insufficient balance for this transfer.',
      );
    }

    // Reference must be globally unique and tie back to this user/transfer.
    const reference = `trace-${randomUUID().replace(/-/g, '')}`;
    const remark = body.remark?.slice(0, 100) || `Transfer to ${body.accountName}`;

    // Category resolution: user pick > merchant heuristic > generic TRANSFER.
    // The heuristic only fires when the user hasn't told us, so we never
    // override a deliberate choice.
    const inferred =
      body.category ??
      inferTransferCategory({
        accountName: body.accountName,
        remark: body.remark,
      }) ??
      TransactionCategoryEnum.TRANSFER;

    // 1. Reserve funds by creating a PENDING DEBIT and decrementing balance
    //    inside one transaction. Squad call happens AFTER the row exists so we
    //    never lose money on a crash.
    const pendingTx = await this.prismaService.$transaction(async (tx) => {
      const updated = await tx.bankAccounts.update({
        where: { id: account.id },
        data: { balance: { decrement: body.amount } },
        select: { id: true, balance: true },
      });
      if (updated.balance < 0) {
        // Should be unreachable thanks to the check above, but guard against
        // concurrent debits.
        throw new ConflictException('Insufficient balance.');
      }
      return tx.transactions.create({
        data: {
          reference,
          direction: TransactionDirectionEnum.DEBIT,
          status: TransactionStatusEnum.PENDING,
          category: inferred,
          description: remark,
          amount: body.amount,
          currency: 'NGN',
          recipientName: body.accountName,
          recipientAccountNumber: body.accountNumber,
          recipientBankCode: body.bankCode,
          remark,
          accountId: account.id,
          userId: auth.id,
        },
        select: TransactionSelect,
      });
    });

    // 2. Initiate Squad payout. If Squad rejects (400) we know nothing moved,
    //    so refund the hold and mark FAILED. For anything else we keep the
    //    hold and require an explicit re-query to resolve.
    try {
      const squadResult = await this.squadService.transferFunds({
        transaction_reference: reference,
        amount: body.amount.toString(),
        bank_code: body.bankCode,
        account_number: body.accountNumber,
        account_name: body.accountName,
        currency_id: 'NGN',
        remark,
      });

      const finalised = await this.prismaService.transactions.update({
        where: { id: pendingTx.id },
        data: {
          status: TransactionStatusEnum.SUCCESS,
          providerReference: squadResult.nip_transaction_reference ?? null,
          recipientBankName: squadResult.destination_institution_name ?? null,
          processedAt: new Date(),
        },
        select: TransactionSelect,
      });
      return TransactionResponse.createIndividualTransactionResponse(finalised);
    } catch (error) {
      this.logger.warn(
        `Squad transfer ${reference} failed: ${(error as Error).message}`,
      );
      if (error instanceof BadRequestException) {
        await this.prismaService.$transaction([
          this.prismaService.bankAccounts.update({
            where: { id: account.id },
            data: { balance: { increment: body.amount } },
          }),
          this.prismaService.transactions.update({
            where: { id: pendingTx.id },
            data: {
              status: TransactionStatusEnum.FAILED,
              processedAt: new Date(),
            },
          }),
        ]);
      }
      throw error;
    }
  }

  // Legacy outbound-transfer requery endpoint. Now a thin wrapper around the
  // unified reverify path — the heavy lifting lives in reverifyPendingInternal
  // so we don't have two slightly-divergent copies of the same Squad parsing.
  async requeryTransfer(reference: string, req: CustomRequest) {
    return this.reverifyTransaction(reference, req);
  }

  async getRecentRecipients(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    // Group by recipient details to dedupe; show the 10 most recent recipients
    // the user has actually paid (SUCCESS status only).
    const recent = await this.prismaService.transactions.findMany({
      where: {
        userId: auth.id,
        direction: TransactionDirectionEnum.DEBIT,
        status: TransactionStatusEnum.SUCCESS,
        recipientAccountNumber: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        recipientName: true,
        recipientAccountNumber: true,
        recipientBankCode: true,
        recipientBankName: true,
        createdAt: true,
      },
      take: 50,
    });

    const seen = new Set<string>();
    const recipients: RecentRecipientDTO[] = [];
    for (const tx of recent) {
      const key = `${tx.recipientBankCode ?? ''}:${tx.recipientAccountNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        name: tx.recipientName ?? 'Unknown',
        accountNumber: tx.recipientAccountNumber!,
        bankCode: tx.recipientBankCode ?? undefined,
        bankName: tx.recipientBankName ?? undefined,
        lastUsedAt: tx.createdAt,
      });
      if (recipients.length >= 10) break;
    }

    return new BaseResponse(recipients);
  }
}
