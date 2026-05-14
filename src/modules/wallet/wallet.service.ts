import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
  RecentRecipientDTO,
  TransferLookupResponseDTO,
  WalletResponseDTO,
} from '@common/response/wallet/wallet.dto';
import { SquadService } from '@common/squad/squad.service';
import { LookupAccountBodyDTO, TransferBodyDTO } from './wallet.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly squadService: SquadService,
  ) {}

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

    const account = await this.getPrimaryAccount(auth.id);
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
    const response: WalletResponseDTO = {
      account: AccountResponse.constructAccountDetails(account),
      balance: {
        available: Math.max(account.balance - pending, 0),
        ledger: account.balance,
        pending,
        todayInflow: todayInflowAgg._sum.amount ?? 0,
        todayOutflow: todayOutflowAgg._sum.amount ?? 0,
      },
    };

    return new BaseResponse(response);
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
          category: TransactionCategoryEnum.TRANSFER,
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

  async requeryTransfer(reference: string, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const tx = await this.prismaService.transactions.findUnique({
      where: { reference },
      select: TransactionSelect,
    });

    if (!tx || tx.userId !== auth.id) {
      throw new NotFoundException('Transaction not found.');
    }

    if (
      tx.status === TransactionStatusEnum.SUCCESS ||
      tx.status === TransactionStatusEnum.FAILED ||
      tx.status === TransactionStatusEnum.REVERSED
    ) {
      return TransactionResponse.createIndividualTransactionResponse(tx);
    }

    try {
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

      const updated = await this.prismaService.$transaction(async (db) => {
        // If Squad confirms it reversed/failed, return the held funds.
        if (
          newStatus === TransactionStatusEnum.FAILED ||
          newStatus === TransactionStatusEnum.REVERSED
        ) {
          await db.bankAccounts.update({
            where: { id: tx.accountId },
            data: { balance: { increment: tx.amount } },
          });
        }
        return db.transactions.update({
          where: { id: tx.id },
          data: {
            status: newStatus,
            providerReference:
              remote.nip_transaction_reference ?? tx.providerReference,
            recipientBankName:
              remote.destination_institution_name ?? tx.recipientBankName,
            processedAt:
              newStatus === TransactionStatusEnum.PENDING
                ? tx.processedAt
                : new Date(),
          },
          select: TransactionSelect,
        });
      });

      return TransactionResponse.createIndividualTransactionResponse(updated);
    } catch (error) {
      this.logger.warn(
        `Squad requery ${reference} failed: ${(error as Error).message}`,
      );
      throw error;
    }
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
