import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { SquadService } from '@common/squad/squad.service';
import { SquadVirtualAccountWebhookPayload } from '@common/squad/squad.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly squadService: SquadService,
  ) {}

  // Squad amounts come as decimal-string Naira (e.g. "222.00"). Persist in
  // kobo as integers so balance math stays exact.
  private toKobo(amount: string | number | undefined | null) {
    if (amount === undefined || amount === null || amount === '') return 0;
    const raw = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(raw)) return 0;
    return Math.round(raw * 100);
  }

  async handleSquadVirtualAccountWebhook(
    rawBody: string,
    signature: string | undefined,
    payload: SquadVirtualAccountWebhookPayload,
  ) {
    if (!this.squadService.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Rejected Squad webhook: bad signature');
      throw new ForbiddenException('Invalid signature');
    }

    const reference = payload.transaction_reference;
    if (!reference) {
      throw new ForbiddenException('Missing transaction_reference');
    }

    // Idempotency: if we've already accepted this reference, succeed quietly.
    const existing = await this.prismaService.transactions.findFirst({
      where: {
        OR: [
          { providerReference: reference },
          { reference },
        ],
      },
      select: { id: true, reference: true },
    });
    if (existing) {
      return {
        response_code: 200,
        transaction_reference: existing.reference,
        response_description: 'Success',
      };
    }

    const account = await this.prismaService.bankAccounts.findUnique({
      where: { accountNumber: payload.virtual_account_number },
      select: { id: true, userId: true },
    });
    if (!account) {
      this.logger.warn(
        `Squad webhook for unknown virtual account ${payload.virtual_account_number}`,
      );
      throw new NotFoundException('Virtual account not recognised');
    }

    const principal = this.toKobo(payload.principal_amount);
    const settled = this.toKobo(payload.settled_amount);
    const fee = this.toKobo(payload.fee_charged);
    // Credit what was actually settled to the user, not the gross principal.
    const creditAmount = settled || principal;
    const localReference = `trace-${reference.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}`;

    const created = await this.prismaService.$transaction(async (tx) => {
      const newTx = await tx.transactions.create({
        data: {
          reference: localReference,
          providerReference: reference,
          direction: TransactionDirectionEnum.CREDIT,
          status: TransactionStatusEnum.SUCCESS,
          category: TransactionCategoryEnum.INCOME,
          description: payload.remark || payload.sender_name || 'Incoming transfer',
          amount: creditAmount,
          fee,
          principalAmount: principal || null,
          settledAmount: settled || null,
          currency: payload.currency || 'NGN',
          senderName: payload.sender_name || null,
          senderAccountNumber: payload.sender_account_number || null,
          senderBankCode: payload.sender_bank_code || null,
          senderBankName: payload.sender_bank || null,
          remark: payload.remark || null,
          metadata: payload as unknown as object,
          processedAt: payload.transaction_date
            ? new Date(payload.transaction_date)
            : new Date(),
          accountId: account.id,
          userId: account.userId,
        },
        select: { reference: true },
      });

      await tx.bankAccounts.update({
        where: { id: account.id },
        data: { balance: { increment: creditAmount } },
      });

      return newTx;
    });

    return {
      response_code: 200,
      transaction_reference: created.reference,
      response_description: 'Success',
    };
  }
}
