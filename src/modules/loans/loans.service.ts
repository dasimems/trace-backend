import { randomUUID } from 'crypto';
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
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import {
  RationaleProduct,
  RationaleService,
} from '@common/insights/rationale.service';
import { PriceService } from '@common/price/price.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import {
  LoanAffordabilityResponseDTO,
  LoanApplicationDTO,
  LoanProductDTO,
  LoanRepaymentDTO,
  LoanScheduleResponseDTO,
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
import { generateLoanPlan } from './loans.repayment';

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
    private readonly priceService: PriceService,
  ) {}

  private wrap = (kobo: number) =>
    this.priceService.constructPriceResponse(kobo, 'NGN');

  private toKobo = (naira: number) =>
    this.priceService.convertToSmallestUnit(naira, 'NGN');

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
      maxExposure: this.wrap(tier.maxExposure),
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
      minAmount: this.wrap(p.minAmount),
      maxAmount: this.wrap(p.maxAmount),
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
    const amountKobo = this.toKobo(query.amount);
    if (amountKobo < product.minAmount || amountKobo > product.maxAmount) {
      throw new BadRequestException(
        `Amount must be between ${this.wrap(product.minAmount).formatted.withCurrency} and ${this.wrap(product.maxAmount).formatted.withCurrency}.`,
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
      amountKobo * annualRate * (query.tenorDays / 365),
    );
    const totalRepayment = amountKobo + totalInterest;
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
      principal: this.wrap(amountKobo),
      totalInterest: this.wrap(totalInterest),
      totalRepayment: this.wrap(totalRepayment),
      dailyPayment: this.wrap(dailyPayment),
      weeklyPayment: this.wrap(weeklyPayment),
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
    const requestedKobo = this.toKobo(body.requestedAmount);
    if (
      requestedKobo < product.minAmount ||
      requestedKobo > product.maxAmount
    ) {
      throw new BadRequestException(
        `Amount must be between ${this.wrap(product.minAmount).formatted.withCurrency} and ${this.wrap(product.maxAmount).formatted.withCurrency}.`,
      );
    }
    if (requestedKobo > tier.maxExposure) {
      throw new BadRequestException(
        `Your tier caps exposure at ${this.wrap(tier.maxExposure).formatted.withCurrency}.`,
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

    // The user must have a bank account to receive the disbursement and to be
    // auto-debited from. Without it the loan has nowhere to land.
    const account = await this.prismaService.bankAccounts.findFirst({
      where: { userId: auth.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(
        'You need an active bank account before applying for a loan.',
      );
    }

    const disbursedAt = new Date();
    const plan = generateLoanPlan(
      product,
      requestedKobo,
      body.tenorDays,
      disbursedAt,
    );

    // Single transaction: create the application + schedule rows, credit the
    // user's balance, and write the disbursement transaction. Either everything
    // commits or nothing does — we never want a half-disbursed loan.
    const application = await this.prismaService.$transaction(async (tx) => {
      const app = await tx.loanApplications.create({
        data: {
          productId: product.id,
          userId: auth.id,
          requestedAmount: requestedKobo,
          approvedAmount: requestedKobo,
          interestRateBps: product.interestRateBps,
          totalInterest: plan.totalInterest,
          totalRepayment: plan.totalRepayment,
          tenorDays: body.tenorDays,
          status: LoanApplicationStatusEnum.DISBURSED,
          decisionedAt: disbursedAt,
          disbursedAt,
          dueAt: plan.finalDueAt,
        },
      });

      await tx.loanRepayments.createMany({
        data: plan.installments.map((i) => ({
          applicationId: app.id,
          sequence: i.sequence,
          dueAt: i.dueAt,
          principalAmount: i.principalAmount,
          interestAmount: i.interestAmount,
          totalAmount: i.totalAmount,
        })),
      });

      await tx.bankAccounts.update({
        where: { id: account.id },
        data: { balance: { increment: requestedKobo } },
      });

      await tx.transactions.create({
        data: {
          reference: `loan-disb-${randomUUID().replace(/-/g, '')}`,
          direction: TransactionDirectionEnum.CREDIT,
          status: TransactionStatusEnum.SUCCESS,
          category: TransactionCategoryEnum.INCOME,
          description: `${product.name} disbursement`,
          amount: requestedKobo,
          principalAmount: requestedKobo,
          settledAmount: requestedKobo,
          remark: `Loan disbursed (${product.provider})`,
          processedAt: disbursedAt,
          accountId: account.id,
          userId: auth.id,
        },
      });

      return app;
    });

    return new BaseResponse(this.toDTO(application));
  }

  async getSchedule(applicationId: string, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const app = await this.prismaService.loanApplications.findUnique({
      where: { id: applicationId },
      include: { repayments: { orderBy: { sequence: 'asc' } } },
    });
    if (!app || app.userId !== auth.id) {
      throw new NotFoundException('Application not found.');
    }
    const rawInstallments = app.repayments.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      dueAt: r.dueAt,
      principalAmount: r.principalAmount,
      interestAmount: r.interestAmount,
      totalAmount: r.totalAmount,
      paidAmount: r.paidAmount,
      outstandingAmount: Math.max(0, r.totalAmount - r.paidAmount),
      status: r.status,
      paidAt: r.paidAt ?? undefined,
    }));
    const totalPaid = rawInstallments.reduce((s, i) => s + i.paidAmount, 0);
    const totalOutstanding = rawInstallments.reduce(
      (s, i) => s + i.outstandingAmount,
      0,
    );
    const installments: LoanRepaymentDTO[] = rawInstallments.map((i) => ({
      id: i.id,
      sequence: i.sequence,
      dueAt: i.dueAt,
      principalAmount: this.wrap(i.principalAmount),
      interestAmount: this.wrap(i.interestAmount),
      totalAmount: this.wrap(i.totalAmount),
      paidAmount: this.wrap(i.paidAmount),
      outstandingAmount: this.wrap(i.outstandingAmount),
      status: i.status,
      paidAt: i.paidAt,
    }));
    const response: LoanScheduleResponseDTO = {
      applicationId: app.id,
      status: app.status,
      principal: this.wrap(app.approvedAmount ?? app.requestedAmount),
      totalInterest: this.wrap(app.totalInterest ?? 0),
      totalRepayment: this.wrap(app.totalRepayment ?? 0),
      totalPaid: this.wrap(totalPaid),
      totalOutstanding: this.wrap(totalOutstanding),
      disbursedAt: app.disbursedAt ?? undefined,
      finalDueAt: app.dueAt ?? undefined,
      repaidAt: app.repaidAt ?? undefined,
      installments,
    };
    return new BaseResponse(response);
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
      requestedAmount: this.wrap(app.requestedAmount),
      approvedAmount:
        app.approvedAmount === null || app.approvedAmount === undefined
          ? undefined
          : this.wrap(app.approvedAmount),
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
