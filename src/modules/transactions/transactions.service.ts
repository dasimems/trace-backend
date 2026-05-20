import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, TransactionDirectionEnum, TransactionStatusEnum } from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PriceService } from '@common/price/price.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import { TransactionMetricsResponseDTO } from '@common/response/transaction/transaction-metrics.dto';
import TransactionResponse from '@common/response/transaction/transaction.response';
import { GetTransactionsQueryDTO } from './transactions.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly priceService: PriceService,
  ) {}

  private startOfMonth(date: Date) {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private startOfDayAgo(days: number) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d;
  }

  private buildWhere(
    userId: string,
    query: GetTransactionsQueryDTO,
  ): Prisma.TransactionsWhereInput {
    const where: Prisma.TransactionsWhereInput = { userId };
    if (query.direction) where.direction = query.direction;
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = query.startDate;
      if (query.endDate) where.createdAt.lte = query.endDate;
    }
    if (query.q) {
      where.OR = [
        { description: { contains: query.q, mode: 'insensitive' } },
        { senderName: { contains: query.q, mode: 'insensitive' } },
        { recipientName: { contains: query.q, mode: 'insensitive' } },
        { reference: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async listTransactions(query: GetTransactionsQueryDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const { page, limit, skip } = this.prismaService.getPaginationDetails({
      page: query.page?.toString(),
      limit: query.limit?.toString(),
    });

    const where = this.buildWhere(auth.id, query);

    const [totalItems, transactions] = await this.prismaService.$transaction([
      this.prismaService.transactions.count({ where }),
      this.prismaService.transactions.findMany({
        where,
        select: TransactionSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return TransactionResponse.createMultipleTransactionResponse(
      transactions,
      { page, limit, totalItems, req },
      this.priceService,
    );
  }

  async getTransaction(id: string, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const tx = await this.prismaService.transactions.findUnique({
      where: { id },
      select: TransactionSelect,
    });
    if (!tx || tx.userId !== auth.id) {
      throw new NotFoundException('Transaction not found.');
    }

    return TransactionResponse.createIndividualTransactionResponse(
      tx,
      this.priceService,
    );
  }

  async getMetrics(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const monthStart = this.startOfMonth(new Date());
    const last30 = this.startOfDayAgo(30);

    const [
      inflowAgg,
      outflowAgg,
      inflowSources,
      outflowCategories,
      pendingCount,
      failedCount,
    ] = await this.prismaService.$transaction([
      this.prismaService.transactions.aggregate({
        where: {
          userId: auth.id,
          direction: TransactionDirectionEnum.CREDIT,
          status: TransactionStatusEnum.SUCCESS,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prismaService.transactions.aggregate({
        where: {
          userId: auth.id,
          direction: TransactionDirectionEnum.DEBIT,
          status: TransactionStatusEnum.SUCCESS,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prismaService.transactions.findMany({
        where: {
          userId: auth.id,
          direction: TransactionDirectionEnum.CREDIT,
          status: TransactionStatusEnum.SUCCESS,
          createdAt: { gte: monthStart },
        },
        select: { senderName: true, senderAccountNumber: true },
        distinct: ['senderName', 'senderAccountNumber'],
      }),
      this.prismaService.transactions.findMany({
        where: {
          userId: auth.id,
          direction: TransactionDirectionEnum.DEBIT,
          status: TransactionStatusEnum.SUCCESS,
          createdAt: { gte: monthStart },
        },
        select: { category: true },
        distinct: ['category'],
      }),
      this.prismaService.transactions.count({
        where: {
          userId: auth.id,
          status: TransactionStatusEnum.PENDING,
        },
      }),
      this.prismaService.transactions.count({
        where: {
          userId: auth.id,
          status: TransactionStatusEnum.FAILED,
          createdAt: { gte: last30 },
        },
      }),
    ]);

    const wrap = (kobo: number) =>
      this.priceService.constructPriceResponse(kobo, 'NGN');
    const response: TransactionMetricsResponseDTO = {
      inflowThisMonth: wrap(inflowAgg._sum.amount ?? 0),
      outflowThisMonth: wrap(outflowAgg._sum.amount ?? 0),
      inflowSources: inflowSources.length,
      outflowCategories: outflowCategories.length,
      pendingCount,
      failedCount,
    };

    return new BaseResponse(response);
  }
}
