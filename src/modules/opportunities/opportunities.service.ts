import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  LoanProducts,
  InvestmentProducts,
  Grants,
  OpportunitySourceEnum,
  LoanTierEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { LlmService } from '@common/llm/llm.service';
import {
  RationaleProduct,
  RationaleService,
} from '@common/insights/rationale.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TransactionSelect } from '@common/prisma/selects/transaction.select';
import BaseResponse from '@common/response/base.response';
import { RequiredDocumentDTO } from '@common/response/opportunities/details.dto';
import { OpportunityDTO } from '@common/response/opportunities/opportunities.dto';
import { computeFinancialHealth } from '@common/scoring/financial-health';
import { deriveLoanTier } from '@common/scoring/loan-tier';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { GetOpportunitiesQueryDTO } from './opportunities.dto';

const TIER_ORDER: Record<LoanTierEnum, number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
};

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly rationaleService: RationaleService,
    private readonly llmService: LlmService,
  ) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  // Aggregates loans + investments + grants into the unified marketplace
  // shape. Match percent is a simple weighted blend of eligibility +
  // expected utility — good enough to surface "best fit" cards without an
  // ML model.
  async list(query: GetOpportunitiesQueryDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);

    const [transactions, account, loans, investments, grants, saved] =
      await Promise.all([
        this.prismaService.transactions.findMany({
          where: { userId: auth.id },
          select: TransactionSelect,
        }),
        this.prismaService.bankAccounts.findFirst({
          where: { userId: auth.id },
          select: { balance: true },
        }),
        this.prismaService.loanProducts.findMany({ where: { isActive: true } }),
        this.prismaService.investmentProducts.findMany({
          where: { isActive: true },
        }),
        this.prismaService.grants.findMany({ where: { isActive: true } }),
        this.prismaService.savedOpportunities.findMany({
          where: { userId: auth.id },
        }),
      ]);

    const health = computeFinancialHealth(
      transactions as ScoringTransaction[],
      account?.balance ?? 0,
    );
    const tier = deriveLoanTier(health);
    const savedSet = new Set(
      saved.map((s) => `${s.source}:${s.opportunityId}`),
    );

    let opportunities: OpportunityDTO[] = [];
    const filter = (item: OpportunityDTO) => {
      if (query.source && item.source !== query.source) return false;
      if (
        query.minMatch !== undefined &&
        item.matchPercent < query.minMatch
      )
        return false;
      if (query.q) {
        const q = query.q.toLowerCase();
        if (
          !item.title.toLowerCase().includes(q) &&
          !item.description.toLowerCase().includes(q) &&
          !item.provider.name.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    };

    for (const l of loans) {
      const opp = this.loanToOpportunity(l, tier.tier, savedSet);
      if (filter(opp)) opportunities.push(opp);
    }
    for (const i of investments) {
      const opp = this.investmentToOpportunity(i, health.score, savedSet);
      if (filter(opp)) opportunities.push(opp);
    }
    for (const g of grants) {
      const opp = this.grantToOpportunity(g, savedSet);
      if (filter(opp)) opportunities.push(opp);
    }

    // One batched Claude call covering all opportunities for this user. The
    // rationale is the "why we picked this for you" sentence on each card.
    const rationaleProducts: RationaleProduct[] = [
      ...loans.map(
        (l): RationaleProduct => ({
          id: l.id,
          type: 'loan',
          name: l.name,
          tier: l.requiredTier,
          rateBps: l.interestRateBps,
          maxAmount: l.maxAmount,
          tenor: `${l.minTenorDays}–${l.maxTenorDays} days`,
        }),
      ),
      ...investments.map(
        (i): RationaleProduct => ({
          id: i.id,
          type: 'investment',
          name: i.name,
          yieldBps: i.expectedReturnBps,
          risk: i.riskLevel,
          min: i.minAmount,
        }),
      ),
      ...grants.map(
        (g): RationaleProduct => ({
          id: g.id,
          type: 'grant',
          name: g.title,
          awardAmount: g.awardAmount,
          eligibility: g.eligibility,
        }),
      ),
    ];
    const rationales = await this.rationaleService.generateForUser(
      auth.id,
      rationaleProducts,
    );
    for (const opp of opportunities) {
      // OpportunityDTO.id is "<source>:<uuid>" — strip the prefix to match
      // the rationale keys (which are raw product UUIDs).
      const rawId = opp.id.split(':')[1] ?? opp.id;
      const rationale = rationales.get(rawId);
      if (rationale) opp.aiRationale = rationale;
    }

    opportunities.sort((a, b) => b.matchPercent - a.matchPercent);
    return new BaseResponse(opportunities);
  }

  async getOne(
    source: OpportunitySourceEnum,
    id: string,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const saved = await this.prismaService.savedOpportunities.findFirst({
      where: { userId: auth.id, source, opportunityId: id },
    });
    const savedSet = new Set(saved ? [`${source}:${id}`] : []);

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
    const tier = deriveLoanTier(health);

    if (source === 'LOAN') {
      const loan = await this.prismaService.loanProducts.findUnique({
        where: { id },
      });
      if (!loan) throw new NotFoundException('Opportunity not found.');
      return new BaseResponse(
        this.loanToOpportunity(loan, tier.tier, savedSet),
      );
    }
    if (source === 'INVESTMENT') {
      const inv = await this.prismaService.investmentProducts.findUnique({
        where: { id },
      });
      if (!inv) throw new NotFoundException('Opportunity not found.');
      return new BaseResponse(
        this.investmentToOpportunity(inv, health.score, savedSet),
      );
    }
    const grant = await this.prismaService.grants.findUnique({
      where: { id },
    });
    if (!grant) throw new NotFoundException('Opportunity not found.');
    return new BaseResponse(this.grantToOpportunity(grant, savedSet));
  }

  async save(
    source: OpportunitySourceEnum,
    opportunityId: string,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    await this.assertSourceExists(source, opportunityId);
    try {
      const saved = await this.prismaService.savedOpportunities.create({
        data: { userId: auth.id, source, opportunityId },
      });
      return new BaseResponse(saved);
    } catch (error) {
      // Already saved → idempotent success.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Opportunity already saved.');
      }
      throw error;
    }
  }

  async unsave(
    source: OpportunitySourceEnum,
    opportunityId: string,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    await this.prismaService.savedOpportunities.deleteMany({
      where: { userId: auth.id, source, opportunityId },
    });
    return new BaseResponse('Removed from saved.');
  }

  // ─── Match scoring ─────────────────────────────────────────────────────

  private scoreLoanMatch(loan: LoanProducts, userTier: LoanTierEnum): number {
    // Eligibility-first: ineligible products clamp to 30%. Within eligible,
    // lower interest = higher match. PERSONAL > EMERGENCY in the absence of
    // other signals.
    const tierGap = TIER_ORDER[userTier] - TIER_ORDER[loan.requiredTier];
    if (tierGap < 0) return 30 + tierGap * 5; // gets worse the further away
    // Base 70, +up to 20 for low interest, +10 if EMERGENCY/PERSONAL.
    const rateBonus = Math.max(0, Math.round(20 - loan.interestRateBps / 200));
    const typeBonus =
      loan.type === 'PERSONAL' || loan.type === 'EMERGENCY' ? 10 : 0;
    return Math.min(100, 70 + rateBonus + typeBonus);
  }

  private scoreInvestmentMatch(
    inv: InvestmentProducts,
    healthScore: number,
  ): number {
    // Higher health → better match for higher-risk / higher-return products.
    // Lower health → prefer low-risk products.
    const riskScore: Record<string, number> = {
      LOW: 0,
      LOW_MEDIUM: 1,
      MEDIUM: 2,
      MEDIUM_HIGH: 3,
      HIGH: 4,
    };
    const idealRisk =
      healthScore >= 85
        ? 3
        : healthScore >= 70
        ? 2
        : healthScore >= 50
        ? 1
        : 0;
    const distance = Math.abs(riskScore[inv.riskLevel] - idealRisk);
    const base = 90 - distance * 12; // 0 distance = 90, 4 = 42
    // Boost slightly for higher return.
    const returnBonus = Math.min(8, Math.round(inv.expectedReturnBps / 250));
    return Math.max(20, Math.min(99, base + returnBonus));
  }

  private scoreGrantMatch(_grant: Grants): number {
    // No signal for grant eligibility yet — fixed 60. Tunable when grants
    // gain a `requiredCategory` / `requiredTier` field.
    return 60;
  }

  // ─── Mappers ──────────────────────────────────────────────────────────

  private loanToOpportunity(
    loan: LoanProducts,
    userTier: LoanTierEnum,
    savedSet: Set<string>,
  ): OpportunityDTO {
    const id = `${OpportunitySourceEnum.LOAN}:${loan.id}`;
    return {
      id,
      source: OpportunitySourceEnum.LOAN,
      type: 'Loan',
      title: loan.name,
      description: loan.description,
      provider: this.providerFor(loan.provider),
      stats: {
        return: `${(loan.interestRateBps / 100).toFixed(1)}% p.a.`,
        min: this.formatNaira(loan.minAmount),
        tenor: `${loan.minTenorDays}–${loan.maxTenorDays} days`,
      },
      matchPercent: this.scoreLoanMatch(loan, userTier),
      isSaved: savedSet.has(id),
    };
  }

  private investmentToOpportunity(
    inv: InvestmentProducts,
    healthScore: number,
    savedSet: Set<string>,
  ): OpportunityDTO {
    const id = `${OpportunitySourceEnum.INVESTMENT}:${inv.id}`;
    return {
      id,
      source: OpportunitySourceEnum.INVESTMENT,
      type: 'Investment',
      title: inv.name,
      description: inv.description,
      provider: this.providerFor(inv.provider),
      stats: {
        return: `${(inv.expectedReturnBps / 100).toFixed(1)}% p.a.`,
        risk: inv.riskLevel.replace('_', '-'),
        min: this.formatNaira(inv.minAmount),
        tenor: inv.tenorDays ? `${inv.tenorDays} days` : 'Open-ended',
      },
      matchPercent: this.scoreInvestmentMatch(inv, healthScore),
      isSaved: savedSet.has(id),
    };
  }

  private grantToOpportunity(
    grant: Grants,
    savedSet: Set<string>,
  ): OpportunityDTO {
    const id = `${OpportunitySourceEnum.GRANT}:${grant.id}`;
    return {
      id,
      source: OpportunitySourceEnum.GRANT,
      type: grant.kind === 'GRANT' ? 'Grant' : 'Partnership',
      title: grant.title,
      description: grant.description,
      provider: this.providerFor(grant.provider),
      stats: {
        return: this.formatNaira(grant.awardAmount),
      },
      matchPercent: this.scoreGrantMatch(grant),
      isSaved: savedSet.has(id),
    };
  }

  private async assertSourceExists(
    source: OpportunitySourceEnum,
    id: string,
  ): Promise<void> {
    const exists =
      source === 'LOAN'
        ? await this.prismaService.loanProducts.findUnique({ where: { id } })
        : source === 'INVESTMENT'
        ? await this.prismaService.investmentProducts.findUnique({
            where: { id },
          })
        : await this.prismaService.grants.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Opportunity not found.');
  }

  private providerFor(name: string) {
    const initials = name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
    // Anything we've explicitly seeded counts as verified.
    return { name, initials, verified: true };
  }

  private formatNaira(kobo: number): string {
    return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
  }

  // ─── Detail endpoints ─────────────────────────────────────────────────

  async simulate(
    source: OpportunitySourceEnum,
    id: string,
    amount: number,
    tenorDays: number | undefined,
  ) {
    if (source === 'LOAN') {
      const loan = await this.prismaService.loanProducts.findUnique({
        where: { id },
      });
      if (!loan) throw new NotFoundException('Opportunity not found.');
      const tenor = tenorDays ?? loan.minTenorDays;
      const annualRate = loan.interestRateBps / 10_000;
      const totalInterest = Math.round(amount * annualRate * (tenor / 365));
      const totalRepayment = amount + totalInterest;
      const dailyPayment = Math.ceil(totalRepayment / tenor);
      return new BaseResponse({
        inputAmount: amount,
        inputTenorDays: tenor,
        totalRepayment,
        totalInterest,
        weeklyPayment: dailyPayment * 7,
        dailyPayment,
        // Conservative default — without user context, the FE can re-check
        // via /loans/affordability for the per-user verdict.
        isAffordable: dailyPayment <= 30_000_00,
      });
    }
    if (source === 'INVESTMENT') {
      const inv = await this.prismaService.investmentProducts.findUnique({
        where: { id },
      });
      if (!inv) throw new NotFoundException('Opportunity not found.');
      const tenor = inv.tenorDays ?? 365;
      const annualRate = inv.expectedReturnBps / 10_000;
      const projectedReturn = Math.round(amount * annualRate * (tenor / 365));
      return new BaseResponse({
        inputAmount: amount,
        inputTenorDays: tenor,
        projectedValue: amount + projectedReturn,
        projectedReturnBps: inv.expectedReturnBps,
      });
    }
    const grant = await this.prismaService.grants.findUnique({
      where: { id },
    });
    if (!grant) throw new NotFoundException('Opportunity not found.');
    return new BaseResponse({
      inputAmount: amount,
      inputTenorDays: tenorDays ?? 0,
      eligibilityScore: 60,
    });
  }

  async personalized(
    source: OpportunitySourceEnum,
    id: string,
    req: CustomRequest,
  ) {
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
    const tier = deriveLoanTier(health);

    const since = new Date();
    since.setDate(since.getDate() - 28);
    const weeklyInflow =
      transactions
        .filter(
          (t) =>
            t.createdAt >= since &&
            t.direction === 'CREDIT' &&
            t.status === 'SUCCESS',
        )
        .reduce((s, t) => s + t.amount, 0) / 4;

    let estimatedNetReceived: number | undefined;
    let estimatedMonthlyCost: number | undefined;
    let approvalConfidencePercent = 50;
    let oneLiner = '';

    if (source === 'LOAN') {
      const loan = await this.prismaService.loanProducts.findUnique({
        where: { id },
      });
      if (!loan) throw new NotFoundException('Opportunity not found.');
      const principal = Math.min(loan.maxAmount, tier.maxExposure || 0);
      const tenor = loan.minTenorDays;
      const totalInterest =
        principal * (loan.interestRateBps / 10_000) * (tenor / 365);
      const totalRepayment = principal + totalInterest;
      // Monthly cost = total repayment spread over the tenor's months.
      const months = Math.max(1, tenor / 30);
      estimatedNetReceived = principal;
      estimatedMonthlyCost = Math.round(totalRepayment / months);
      approvalConfidencePercent =
        tier.status === 'ok'
          ? Math.min(95, 40 + Math.round(health.score / 2))
          : 30;
      oneLiner =
        (await this.aiOneLiner('loan', loan.name, {
          health_score: health.score,
          tier: tier.tier,
          weekly_inflow_kobo: Math.round(weeklyInflow),
          principal_kobo: principal,
          monthly_cost_kobo: estimatedMonthlyCost,
        })) ??
        `Your ${tier.tier.toLowerCase()} tier unlocks up to ${this.formatNaira(principal)} from this product.`;
    } else if (source === 'INVESTMENT') {
      const inv = await this.prismaService.investmentProducts.findUnique({
        where: { id },
      });
      if (!inv) throw new NotFoundException('Opportunity not found.');
      approvalConfidencePercent =
        account && account.balance >= inv.minAmount ? 95 : 40;
      oneLiner =
        (await this.aiOneLiner('investment', inv.name, {
          health_score: health.score,
          balance_kobo: account?.balance ?? 0,
          min_amount_kobo: inv.minAmount,
          yield_bps: inv.expectedReturnBps,
          risk: inv.riskLevel,
        })) ??
        `${(inv.expectedReturnBps / 100).toFixed(1)}% p.a. — fits your current risk profile.`;
    } else {
      const grant = await this.prismaService.grants.findUnique({
        where: { id },
      });
      if (!grant) throw new NotFoundException('Opportunity not found.');
      approvalConfidencePercent = 50;
      oneLiner =
        (await this.aiOneLiner('grant', grant.title, {
          award_amount_kobo: grant.awardAmount,
        })) ?? `Up to ${this.formatNaira(grant.awardAmount)} non-repayable.`;
      estimatedNetReceived = grant.awardAmount;
    }

    const weeklyBufferPercent =
      weeklyInflow > 0 && estimatedMonthlyCost !== undefined
        ? Math.max(
            0,
            100 -
              Math.round(((estimatedMonthlyCost / 4) / weeklyInflow) * 100),
          )
        : undefined;

    return new BaseResponse({
      estimatedNetReceived,
      estimatedMonthlyCost,
      weeklyBufferPercent,
      approvalConfidencePercent,
      oneLiner: oneLiner.slice(0, 200),
    });
  }

  async costBreakdown(
    source: OpportunitySourceEnum,
    id: string,
    amount: number,
  ) {
    if (source === 'GRANT') {
      return new BaseResponse({
        items: [],
        totalUpfront: 0,
        totalRecurring: 0,
      });
    }
    type Template = Array<{
      label: string;
      ratioBps?: number;
      amountKobo?: number;
      recurring: boolean;
    }>;
    let template: Template = [];
    let cycle: 'WEEKLY' | 'MONTHLY' | 'DAILY' | undefined;

    if (source === 'LOAN') {
      const loan = await this.prismaService.loanProducts.findUnique({
        where: { id },
      });
      if (!loan) throw new NotFoundException('Opportunity not found.');
      template = (loan.costBreakdownTemplate as Template) ?? [];
      cycle = 'DAILY';
    } else {
      const inv = await this.prismaService.investmentProducts.findUnique({
        where: { id },
      });
      if (!inv) throw new NotFoundException('Opportunity not found.');
      template = (inv.costBreakdownTemplate as Template) ?? [];
      cycle = 'MONTHLY';
    }

    const items = template.map((t) => ({
      label: t.label,
      amount:
        t.amountKobo !== undefined
          ? t.amountKobo
          : Math.round((amount * (t.ratioBps ?? 0)) / 10_000),
      recurring: t.recurring,
    }));
    const totalUpfront = items
      .filter((i) => !i.recurring)
      .reduce((s, i) => s + i.amount, 0);
    const totalRecurring = items
      .filter((i) => i.recurring)
      .reduce((s, i) => s + i.amount, 0);
    return new BaseResponse({
      items,
      totalUpfront,
      totalRecurring,
      ...(cycle && totalRecurring > 0 ? { cycle } : {}),
    });
  }

  async documents(
    source: OpportunitySourceEnum,
    id: string,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    type Template = Array<{
      id: string;
      label: string;
      description: string;
      required: boolean;
      category: string;
    }>;
    let template: Template = [];
    if (source === 'LOAN') {
      const loan = await this.prismaService.loanProducts.findUnique({
        where: { id },
        select: { requiredDocuments: true },
      });
      if (!loan) throw new NotFoundException('Opportunity not found.');
      template = (loan.requiredDocuments as Template) ?? [];
    } else if (source === 'INVESTMENT') {
      const inv = await this.prismaService.investmentProducts.findUnique({
        where: { id },
        select: { requiredDocuments: true },
      });
      if (!inv) throw new NotFoundException('Opportunity not found.');
      template = (inv.requiredDocuments as Template) ?? [];
    } else {
      const grant = await this.prismaService.grants.findUnique({
        where: { id },
        select: { requiredDocuments: true },
      });
      if (!grant) throw new NotFoundException('Opportunity not found.');
      template = (grant.requiredDocuments as Template) ?? [];
    }

    const uploaded = await this.prismaService.userUploadedDocuments.findMany({
      where: { userId: auth.id, source, opportunityId: id },
      select: { documentKey: true },
    });
    const uploadedSet = new Set(uploaded.map((u) => u.documentKey));

    return new BaseResponse({
      documents: template.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        required: t.required,
        category: t.category as RequiredDocumentDTO['category'],
        uploaded: uploadedSet.has(t.id),
      })),
    });
  }

  async faq(source: OpportunitySourceEnum, id: string) {
    let entries: Array<{ question: string; answer: string }> = [];
    if (source === 'LOAN') {
      const loan = await this.prismaService.loanProducts.findUnique({
        where: { id },
        select: { faqEntries: true },
      });
      if (!loan) throw new NotFoundException('Opportunity not found.');
      entries = (loan.faqEntries as typeof entries) ?? [];
    } else if (source === 'INVESTMENT') {
      const inv = await this.prismaService.investmentProducts.findUnique({
        where: { id },
        select: { faqEntries: true },
      });
      if (!inv) throw new NotFoundException('Opportunity not found.');
      entries = (inv.faqEntries as typeof entries) ?? [];
    } else {
      const grant = await this.prismaService.grants.findUnique({
        where: { id },
        select: { faqEntries: true },
      });
      if (!grant) throw new NotFoundException('Opportunity not found.');
      entries = (grant.faqEntries as typeof entries) ?? [];
    }
    return new BaseResponse({ entries });
  }

  // ─── AI one-liner (Claude) ────────────────────────────────────────────

  private async aiOneLiner(
    productType: 'loan' | 'investment' | 'grant',
    productName: string,
    facts: Record<string, unknown>,
  ): Promise<string | null> {
    if (!this.llmService.isEnabled()) return null;
    const text = await this.llmService.generateText({
      systemPrompt:
        'You write one-sentence rationales for Nigerian fintech users. Style: direct, no preamble, no emoji, no marketing. Cite actual numbers from the facts. Use ₦ symbol with comma separators. Output ONLY the sentence — no quotes, no headers, no JSON.',
      userPrompt: `Product type: ${productType}\nProduct: ${productName}\nUser facts: ${JSON.stringify(facts)}\n\nWrite a single sentence (≤140 chars) explaining why this product fits THIS user.`,
      maxTokens: 100,
    });
    return text?.trim().replace(/^["']|["']$/g, '') ?? null;
  }
}
