import { randomUUID } from 'crypto';
import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PaymentRequestKindEnum,
  PaymentRequestStatusEnum,
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { EventBusService } from '@common/events/event-bus.service';
import { PrismaService } from '@common/prisma/prisma.service';
import BaseResponse from '@common/response/base.response';
import { PaymentRequestDTO } from '@common/response/wallet/wallet.dto';
import { SquadService } from '@common/squad/squad.service';
import {
  CreatePaymentRequestBodyDTO,
  GetPaymentRequestsQueryDTO,
} from './payment-requests.dto';

@Injectable()
export class PaymentRequestsService {
  private readonly logger = new Logger(PaymentRequestsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly squadService: SquadService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─── Create (FUND vs REQUEST) ────────────────────────────────────────────

  async createForFund(body: CreatePaymentRequestBodyDTO, req: CustomRequest) {
    return this.createInternal(PaymentRequestKindEnum.FUND, body, req);
  }

  async createForRequest(
    body: CreatePaymentRequestBodyDTO,
    req: CustomRequest,
  ) {
    return this.createInternal(PaymentRequestKindEnum.REQUEST, body, req);
  }

  private async createInternal(
    kind: PaymentRequestKindEnum,
    body: CreatePaymentRequestBodyDTO,
    req: CustomRequest,
  ) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const user = await this.prismaService.users.findUnique({
      where: { id: auth.id },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) throw new UnauthorizedException('Unauthorized!');

    // Reference scheme distinguishes FUND vs REQUEST so support tickets and
    // logs are scannable: `trace-fund-<uuid>` vs `trace-req-<uuid>`.
    const slug = kind === PaymentRequestKindEnum.FUND ? 'fund' : 'req';
    const reference = `trace-${slug}-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
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
      metadata: { userId: auth.id, kind },
    });
    const checkoutUrl =
      squadResult.checkout_url ?? squadResult.authorization_url ?? null;
    if (!checkoutUrl) {
      this.logger.error(
        `Squad initiate accepted but returned no checkout URL for ref=${reference}`,
      );
      throw new BadGatewayException(
        'Payment service did not return a checkout URL. Please try again.',
      );
    }

    const row = await this.prismaService.paymentRequests.create({
      data: {
        userId: auth.id,
        reference,
        kind,
        amount: body.amount,
        currency: 'NGN',
        status: PaymentRequestStatusEnum.PENDING,
        description: body.description?.slice(0, 200),
        checkoutUrl,
        callbackUrl: body.callbackUrl,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    return new BaseResponse(this.toDTO(row));
  }

  // ─── List / get ──────────────────────────────────────────────────────────

  async list(query: GetPaymentRequestsQueryDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const { page, limit, skip } = this.prismaService.getPaginationDetails({
      page: query.page?.toString(),
      limit: query.limit?.toString(),
    });

    const where = {
      userId: auth.id,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [totalItems, rows] = await this.prismaService.$transaction([
      this.prismaService.paymentRequests.count({ where }),
      this.prismaService.paymentRequests.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return new BaseResponse(
      rows.map((r) => this.toDTO(r)),
      { page, limit, totalItems, req },
    );
  }

  async getByReference(reference: string, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    const row = await this.prismaService.paymentRequests.findUnique({
      where: { reference },
    });
    if (!row || row.userId !== auth.id) {
      throw new NotFoundException('Payment request not found.');
    }
    return new BaseResponse(this.toDTO(row));
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────

  async cancel(reference: string, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const row = await this.prismaService.paymentRequests.findUnique({
      where: { reference },
    });
    if (!row || row.userId !== auth.id) {
      throw new NotFoundException('Payment request not found.');
    }
    if (row.status !== PaymentRequestStatusEnum.PENDING) {
      throw new ConflictException(
        `Cannot cancel a payment request that is already ${row.status}.`,
      );
    }
    const updated = await this.prismaService.paymentRequests.update({
      where: { id: row.id },
      data: { status: PaymentRequestStatusEnum.CANCELLED },
    });
    return new BaseResponse(this.toDTO(updated));
  }

  // ─── Reverify (single + bulk for the reconciler cron) ────────────────────

  async reverify(reference: string, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const row = await this.prismaService.paymentRequests.findUnique({
      where: { reference },
    });
    if (!row || row.userId !== auth.id) {
      throw new NotFoundException('Payment request not found.');
    }
    const result = await this.reverifyInternal(reference);
    return new BaseResponse(this.toDTO(result ?? row));
  }

  // Reconciler entry-point. Bounded; safe to call from a recurring cron.
  // Picks up FUND + REQUEST rows that have been PENDING longer than the cutoff
  // and asks Squad for the latest status.
  async reconcileStalePending(opts: {
    olderThanMs?: number;
    batchSize?: number;
  } = {}) {
    const olderThanMs = opts.olderThanMs ?? 10 * 60 * 1000;
    const batchSize = opts.batchSize ?? 50;
    const cutoff = new Date(Date.now() - olderThanMs);

    const stale = await this.prismaService.paymentRequests.findMany({
      where: {
        status: PaymentRequestStatusEnum.PENDING,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { reference: true },
    });
    if (stale.length === 0) return { processed: 0 };

    const results = await Promise.allSettled(
      stale.map((s) => this.reverifyInternal(s.reference)),
    );
    let resolved = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.status === 'SUCCESS') {
        resolved += 1;
      }
    }
    this.logger.log(
      `Payment-request reconcile: ${stale.length} processed, ${resolved} newly resolved as SUCCESS.`,
    );
    return { processed: stale.length, resolved };
  }

  // Core reverify — public so the webhook handler can reuse the finaliser too.
  // Idempotent: non-PENDING rows are returned untouched.
  async reverifyInternal(reference: string) {
    const row = await this.prismaService.paymentRequests.findUnique({
      where: { reference },
    });
    if (!row) return null;
    if (row.status !== PaymentRequestStatusEnum.PENDING) return row;

    // Expired by clock — short-circuit before bothering Squad.
    if (row.expiresAt && row.expiresAt < new Date()) {
      return this.prismaService.paymentRequests.update({
        where: { id: row.id },
        data: { status: PaymentRequestStatusEnum.EXPIRED },
      });
    }

    try {
      const remote = await this.squadService.verifyPayment(reference);
      const status = (remote.transaction_status ?? '').toLowerCase();
      if (status === 'success' || status === 'successful') {
        return this.finaliseAsPaid(reference, {
          gatewayRef: remote.gateway_ref,
          paymentType: remote.payment_information?.payment_type,
          paidByEmail: remote.email,
        });
      }
      if (status === 'failed' || status === 'fail' || status === 'cancelled') {
        return this.prismaService.paymentRequests.update({
          where: { id: row.id },
          data: { status: PaymentRequestStatusEnum.FAILED },
        });
      }
      return row;
    } catch (err) {
      this.logger.warn(
        `Reverify ${reference} failed: ${(err as Error).message}`,
      );
      return row;
    }
  }

  // Flip PaymentRequest → SUCCESS, create the linked CREDIT transaction,
  // credit the user's primary bank account, and publish the SSE event. All in
  // one Prisma transaction so partial state is impossible.
  //
  // Idempotent — if the PaymentRequest is already SUCCESS we return it
  // untouched (the second of webhook/verify to fire is the no-op caller).
  async finaliseAsPaid(
    reference: string,
    meta: {
      gatewayRef?: string;
      paymentType?: string;
      paidByEmail?: string;
      paidByName?: string;
    },
  ) {
    return this.prismaService.$transaction(async (tx) => {
      const row = await tx.paymentRequests.findUnique({
        where: { reference },
      });
      if (!row) {
        throw new NotFoundException(`PaymentRequest ${reference} not found.`);
      }
      if (row.status === PaymentRequestStatusEnum.SUCCESS) {
        return row;
      }

      const account = await tx.bankAccounts.findFirst({
        where: { userId: row.userId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, balance: true },
      });
      if (!account) {
        throw new NotFoundException(
          `No bank account for user ${row.userId} — cannot credit payment.`,
        );
      }

      const newTx = await tx.transactions.create({
        data: {
          // Reuse the PaymentRequests reference for the Transactions row so
          // both can be cross-referenced in support tooling.
          reference: `tx-${row.reference}`,
          providerReference: meta.gatewayRef ?? null,
          direction: TransactionDirectionEnum.CREDIT,
          status: TransactionStatusEnum.SUCCESS,
          category: TransactionCategoryEnum.INCOME,
          description:
            row.kind === PaymentRequestKindEnum.FUND
              ? row.description || 'Wallet top-up'
              : row.description || 'Incoming payment',
          amount: row.amount,
          principalAmount: row.amount,
          settledAmount: row.amount,
          currency: 'NGN',
          senderName: meta.paidByName ?? null,
          remark: meta.paymentType
            ? `Payment via Squad (${meta.paymentType})`
            : 'Payment via Squad',
          processedAt: new Date(),
          accountId: account.id,
          userId: row.userId,
        },
        select: { id: true },
      });

      const updatedAccount = await tx.bankAccounts.update({
        where: { id: account.id },
        data: { balance: { increment: row.amount } },
        select: { balance: true },
      });

      const updated = await tx.paymentRequests.update({
        where: { id: row.id },
        data: {
          status: PaymentRequestStatusEnum.SUCCESS,
          gatewayRef: meta.gatewayRef ?? row.gatewayRef ?? null,
          paymentType: meta.paymentType ?? row.paymentType ?? null,
          paidByEmail: meta.paidByEmail ?? row.paidByEmail ?? null,
          paidByName: meta.paidByName ?? row.paidByName ?? null,
          paidAt: new Date(),
          transactionId: newTx.id,
        },
      });

      // Push an SSE event so the wallet stream updates without a refetch.
      this.eventBus.publish(row.userId, {
        type:
          row.kind === PaymentRequestKindEnum.FUND
            ? 'wallet.fund.received'
            : 'wallet.payment_request.paid',
        payload: {
          paymentRequestId: row.id,
          reference: row.reference,
          transactionId: newTx.id,
          amount: row.amount,
          balance: updatedAccount.balance,
          gatewayRef: meta.gatewayRef ?? null,
          paymentType: meta.paymentType ?? null,
          paidByEmail: meta.paidByEmail ?? null,
          paidByName: meta.paidByName ?? null,
        },
      });
      return updated;
    });
  }

  // ─── Mapping ─────────────────────────────────────────────────────────────

  private toDTO(
    row: Awaited<
      ReturnType<typeof PrismaService.prototype.paymentRequests.findUnique>
    > & object,
  ): PaymentRequestDTO {
    return {
      id: row.id,
      reference: row.reference,
      gatewayRef: row.gatewayRef ?? undefined,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      description: row.description ?? undefined,
      checkoutUrl: row.checkoutUrl,
      callbackUrl: row.callbackUrl ?? undefined,
      paymentType: row.paymentType ?? undefined,
      paidByEmail: row.paidByEmail ?? undefined,
      paidByName: row.paidByName ?? undefined,
      paidAt: row.paidAt ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      transactionId: row.transactionId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
