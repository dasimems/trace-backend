import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  LoanApplicationStatusEnum,
  LoanTierEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import {
  RationaleProduct,
  RationaleService,
} from '@common/insights/rationale.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import {
  LoanAffordabilityResponseDTO,
  LoanApplicationDTO,
  LoanProductDTO,
  LoanTierResponseDTO,
} from '@common/response/loans/loans.dto';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { deriveLoanTier } from '@common/scoring/loan-tier';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import {
  AffordabilityQueryDTO,
  ApplyForLoanBodyDTO,
  GetLoanApplicationsQueryDTO,
} from './loans.dto';

const TIER_ORDER: Record<LoanTierEnum, number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
};

@Injectable()
export class LoansService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly rationaleService: RationaleService,
  ) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  private async deriveTier(userId: string) {
    const [transactions, account] = await Promise.all([
      this.prismaService.transactions.findMany({
        where: { userId },
        select: TransactionSelect,
      }),
      this.prismaService.bankAccounts.findFirst({
        where: { userId },
        select: { balance: true },
      }),
    ]);
    const health = computeFinancialHealth(
      transactions as ScoringTransaction[],
      account?.balance ?? 0,
    );
    return { tier: deriveLoanTier(health), transactions: transactions as ScoringTransaction[] };
  }

  async getTier(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const { tier } = await this.deriveTier(auth.id);
    const response: LoanTierResponseDTO = {
      status: tier.status,
      tier: tier.tier,
      healthScore: tier.healthScore,
      maxExposure: tier.maxExposure,
      reasons: tier.reasons,
    };
    return new BaseResponse(response);
  }

  async listProducts(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const { tier } = await this.deriveTier(auth.id);
    const products = await this.prismaService.loanProducts.findMany({
      where: { isActive: true },
      orderBy: { interestRateBps: 'asc' },
    });
    const userTierRank = TIER_ORDER[tier.tier];

    const rationaleProducts: RationaleProduct[] = products.map((p) => ({
      id: p.id,
      type: 'loan',
      name: p.name,
      tier: p.requiredTier,
      rateBps: p.interestRateBps,
      maxAmount: p.maxAmount,
      tenor: `${p.minTenorDays}–${p.maxTenorDays} days`,
    }));
    const rationales = await this.rationaleService.generateForUser(
      auth.id,
      rationaleProducts,
    );

    const response: LoanProductDTO[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      type: p.type,
      interestRateBps: p.interestRateBps,
      minAmount: p.minAmount,
      maxAmount: p.maxAmount,
      minTenorDays: p.minTenorDays,
      maxTenorDays: p.maxTenorDays,
      requiredTier: p.requiredTier,
      description: p.description,
      eligible:
        tier.status === 'ok' &&
        TIER_ORDER[p.requiredTier] <= userTierRank,
      aiRationale: rationales.get(p.id),
    }));
    return new BaseResponse(response);
  }

  async getAffordability(
    query: AffordabilityQueryDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const product = await this.prismaService.loanProducts.findUnique({
      where: { id: query.productId },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException('Loan product not found.');
    }
    if (query.amount < product.minAmount || query.amount > product.maxAmount) {
      throw new BadRequestException(
        `Amount must be between ₦${product.minAmount / 100} and ₦${product.maxAmount / 100}.`,
      );
    }
    if (
      query.tenorDays < product.minTenorDays ||
      query.tenorDays > product.maxTenorDays
    ) {
      throw new BadRequestException(
        `Tenor must be between ${product.minTenorDays} and ${product.maxTenorDays} days.`,
      );
    }

    // Simple interest sized for the actual tenor, not the full year. Banks
    // would use APR amortization here; for a simulator this is close enough
    // and matches what users intuit.
    const annualRate = product.interestRateBps / 10_000;
    const totalInterest = Math.round(
      query.amount * annualRate * (query.tenorDays / 365),
    );
    const totalRepayment = query.amount + totalInterest;
    const dailyPayment = Math.ceil(totalRepayment / query.tenorDays);
    const weeklyPayment = dailyPayment * 7;

    // Affordability heuristic: daily payment ≤30% of avg daily inflow over
    // the prior 90 days. This is the same threshold most micro-lenders use.
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const inflowAgg = await this.prismaService.transactions.aggregate({
      where: {
        userId: auth.id,
        direction: TransactionDirectionEnum.CREDIT,
        status: TransactionStatusEnum.SUCCESS,
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    });
    const avgDailyInflow = (inflowAgg._sum.amount ?? 0) / 90;
    const isAffordable =
      avgDailyInflow > 0 && dailyPayment <= avgDailyInflow * 0.3;

    const response: LoanAffordabilityResponseDTO = {
      principal: query.amount,
      totalInterest,
      totalRepayment,
      dailyPayment,
      weeklyPayment,
      tenorDays: query.tenorDays,
      isAffordable,
    };
    return new BaseResponse(response);
  }

  async apply(body: ApplyForLoanBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const product = await this.prismaService.loanProducts.findUnique({
      where: { id: body.productId },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException('Loan product not found.');
    }
    const { tier } = await this.deriveTier(auth.id);
    if (tier.status !== 'ok') {
      throw new ForbiddenException(
        'Tier eligibility cannot be assessed yet — need at least 14 days of activity.',
      );
    }
    if (TIER_ORDER[tier.tier] < TIER_ORDER[product.requiredTier]) {
      throw new ForbiddenException(
        `This product requires ${product.requiredTier} tier; you are ${tier.tier}.`,
      );
    }
    if (
      body.requestedAmount < product.minAmount ||
      body.requestedAmount > product.maxAmount
    ) {
      throw new BadRequestException(
        `Amount must be between ₦${product.minAmount / 100} and ₦${product.maxAmount / 100}.`,
      );
    }
    if (body.requestedAmount > tier.maxExposure) {
      throw new BadRequestException(
        `Your tier caps exposure at ₦${tier.maxExposure / 100}.`,
      );
    }
    if (
      body.tenorDays < product.minTenorDays ||
      body.tenorDays > product.maxTenorDays
    ) {
      throw new BadRequestException(
        `Tenor must be between ${product.minTenorDays} and ${product.maxTenorDays} days.`,
      );
    }

    const openApp = await this.prismaService.loanApplications.findFirst({
      where: {
        userId: auth.id,
        status: { in: ['PENDING', 'APPROVED', 'DISBURSED'] },
      },
      select: { id: true },
    });
    if (openApp) {
      throw new ConflictException(
        'You already have an open loan application or active loan.',
      );
    }

    const application = await this.prismaService.loanApplications.create({
      data: {
        productId: product.id,
        userId: auth.id,
        requestedAmount: body.requestedAmount,
        tenorDays: body.tenorDays,
        status: LoanApplicationStatusEnum.PENDING,
      },
    });
    return new BaseResponse(this.toDTO(application));
  }

  async listApplications(
    query: GetLoanApplicationsQueryDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const { page, limit, skip } = this.prismaService.getPaginationDetails({
      page: query.page?.toString(),
      limit: query.limit?.toString(),
    });
    const [totalItems, applications] = await this.prismaService.$transaction([
      this.prismaService.loanApplications.count({
        where: { userId: auth.id },
      }),
      this.prismaService.loanApplications.findMany({
        where: { userId: auth.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return new BaseResponse(applications.map((a) => this.toDTO(a)), {
      page,
      limit,
      totalItems,
      req,
    });
  }

  async getApplication(id: string, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const app = await this.prismaService.loanApplications.findUnique({
      where: { id },
    });
    if (!app || app.userId !== auth.id) {
      throw new NotFoundException('Application not found.');
    }
    return new BaseResponse(this.toDTO(app));
  }

  private toDTO(
    app: Awaited<
      ReturnType<typeof PrismaService.prototype.loanApplications.findUnique>
    > & object,
  ): LoanApplicationDTO {
    return {
      id: app.id,
      productId: app.productId,
      requestedAmount: app.requestedAmount,
      approvedAmount: app.approvedAmount ?? undefined,
      tenorDays: app.tenorDays,
      status: app.status,
      rejectionReason: app.rejectionReason ?? undefined,
      decisionedAt: app.decisionedAt ?? undefined,
      disbursedAt: app.disbursedAt ?? undefined,
      dueAt: app.dueAt ?? undefined,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }
}
