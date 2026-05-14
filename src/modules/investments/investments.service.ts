import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InvestmentAllocationStatusEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import {
  InvestmentAllocationDTO,
  InvestmentHoldingDTO,
  InvestmentProductDTO,
  PortfolioResponseDTO,
  SafeToInvestResponseDTO,
} from '@common/response/investments/investments.dto';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { AllocateBodyDTO, GetAllocationsQueryDTO } from './investments.dto';

@Injectable()
export class InvestmentsService {
  constructor(private readonly prismaService: PrismaService) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  async listProducts() {
    const products = await this.prismaService.investmentProducts.findMany({
      where: { isActive: true },
      orderBy: { expectedReturnBps: 'desc' },
    });
    const response: InvestmentProductDTO[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      type: p.type,
      expectedReturnBps: p.expectedReturnBps,
      riskLevel: p.riskLevel,
      minAmount: p.minAmount,
      tenorDays: p.tenorDays ?? undefined,
      description: p.description,
    }));
    return new BaseResponse(response);
  }

  async getPortfolio(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const allocations = await this.prismaService.investmentAllocations.findMany({
      where: {
        userId: auth.id,
        status: { in: ['PENDING', 'ACTIVE'] },
      },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalValue = allocations.reduce(
      (s, a) => s + a.currentValue,
      0,
    );
    const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
    const totalReturnBps =
      totalAllocated === 0
        ? 0
        : Math.round(((totalValue - totalAllocated) / totalAllocated) * 10_000);

    // Group by product type for the holdings chart.
    const byType = new Map<string, number>();
    for (const a of allocations) {
      byType.set(a.product.type, (byType.get(a.product.type) ?? 0) + a.currentValue);
    }
    const holdings: InvestmentHoldingDTO[] = Array.from(byType.entries())
      .map(([type, amount]) => ({
        type: type as InvestmentHoldingDTO['type'],
        label: this.typeLabel(type),
        amount,
        percent:
          totalValue === 0 ? 0 : Math.round((amount / totalValue) * 100),
      }))
      .sort((a, b) => b.amount - a.amount);

    const response: PortfolioResponseDTO = {
      totalValue,
      totalAllocated,
      totalReturnBps,
      holdings,
      allocations: allocations.map((a) => this.allocationToDTO(a)),
    };
    return new BaseResponse(response);
  }

  // "Safe to invest" = 10–60% of the net surplus the user has built up. Uses
  // the same health-engine inputs as the recommendations service.
  async getSafeToInvest(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const [transactions, account] = await Promise.all([
      this.prismaService.transactions.findMany({
        where: { userId: auth.id },
        select: TransactionSelect,
      }),
      this.prismaService.bankAccounts.findFirst({
        where: { userId: auth.id },
        select: { balance: true },
      }),
    ]);
    const health = computeFinancialHealth(
      transactions as ScoringTransaction[],
      account?.balance ?? 0,
    );
    if (health.status === 'insufficient_data') {
      const response: SafeToInvestResponseDTO = {
        status: 'insufficient_data',
        suggested: 0,
        conservative: 0,
        aggressive: 0,
        rationale:
          'We need at least 14 days of activity before suggesting an allocation.',
      };
      return new BaseResponse(response);
    }

    // Use the prior 30 days' net surplus as the base. Anything beyond is
    // hypothetical and dangerous to lock up.
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const monthly = transactions.filter(
      (t) => t.createdAt >= since && t.status === TransactionStatusEnum.SUCCESS,
    );
    const inflow = monthly
      .filter((t) => t.direction === TransactionDirectionEnum.CREDIT)
      .reduce((s, t) => s + t.amount, 0);
    const outflow = monthly
      .filter((t) => t.direction === TransactionDirectionEnum.DEBIT)
      .reduce((s, t) => s + t.amount, 0);
    const surplus = Math.max(0, inflow - outflow);

    const response: SafeToInvestResponseDTO = {
      status: 'ok',
      conservative: Math.round(surplus * 0.1),
      suggested: Math.round(surplus * 0.3),
      aggressive: Math.round(surplus * 0.6),
      rationale:
        surplus === 0
          ? 'No surplus over the last 30 days — focus on building reserves first.'
          : `Based on a ₦${Math.round(surplus / 100).toLocaleString('en-NG')} net surplus over the last 30 days.`,
    };
    return new BaseResponse(response);
  }

  async allocate(body: AllocateBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const product = await this.prismaService.investmentProducts.findUnique({
      where: { id: body.productId },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException('Investment product not found.');
    }
    if (body.amount < product.minAmount) {
      throw new BadRequestException(
        `Minimum allocation for this product is ₦${product.minAmount / 100}.`,
      );
    }

    // Hold the funds in the user's bank account. Allocation is recorded as
    // PENDING; an offline settlement process (or scheduled job) would later
    // mark it ACTIVE and start crediting yields. For now we don't move money
    // through Squad — this is purely book-keeping.
    const account = await this.prismaService.bankAccounts.findFirst({
      where: { userId: auth.id },
      select: { id: true, balance: true },
    });
    if (!account || account.balance < body.amount) {
      throw new BadRequestException(
        'Insufficient balance for this allocation.',
      );
    }

    const maturesAt = product.tenorDays
      ? new Date(Date.now() + product.tenorDays * 24 * 3600 * 1000)
      : null;

    const allocation = await this.prismaService.$transaction(async (tx) => {
      await tx.bankAccounts.update({
        where: { id: account.id },
        data: { balance: { decrement: body.amount } },
      });
      return tx.investmentAllocations.create({
        data: {
          productId: product.id,
          userId: auth.id,
          amount: body.amount,
          currentValue: body.amount,
          status: InvestmentAllocationStatusEnum.PENDING,
          maturesAt,
        },
      });
    });
    return new BaseResponse(this.allocationToDTO(allocation));
  }

  async listAllocations(
    query: GetAllocationsQueryDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const { page, limit, skip } = this.prismaService.getPaginationDetails({
      page: query.page?.toString(),
      limit: query.limit?.toString(),
    });
    const [totalItems, allocations] = await this.prismaService.$transaction([
      this.prismaService.investmentAllocations.count({
        where: { userId: auth.id },
      }),
      this.prismaService.investmentAllocations.findMany({
        where: { userId: auth.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return new BaseResponse(
      allocations.map((a) => this.allocationToDTO(a)),
      { page, limit, totalItems, req },
    );
  }

  private allocationToDTO(
    a: Awaited<
      ReturnType<
        typeof PrismaService.prototype.investmentAllocations.findUnique
      >
    > & object,
  ): InvestmentAllocationDTO {
    return {
      id: a.id,
      productId: a.productId,
      amount: a.amount,
      currentValue: a.currentValue,
      status: a.status,
      allocatedAt: a.allocatedAt ?? undefined,
      withdrawnAt: a.withdrawnAt ?? undefined,
      maturesAt: a.maturesAt ?? undefined,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  private typeLabel(type: string): string {
    return type
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
