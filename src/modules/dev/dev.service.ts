import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InvestmentProductTypeEnum,
  LoanProductTypeEnum,
  LoanTierEnum,
  OpportunityKindEnum,
  RiskLevelEnum,
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import BaseResponse from '@common/response/base.response';
import { SeedTransactionsBodyDTO } from './dev.dto';

// Plausible Lagos-flavoured fake counterparties so the dashboard doesn't look
// like Lorem-Ipsum. Amounts are in naira (we convert to kobo on insert).
const DEBIT_TEMPLATES: Array<{
  category: TransactionCategoryEnum;
  recipients: string[];
  amountRangeNaira: [number, number];
  // Probability of this template firing on any given day (0–1).
  dailyChance: number;
}> = [
  {
    category: TransactionCategoryEnum.FOOD_AND_DINING,
    recipients: ['Chowdeck', 'Mr. Biggs', 'Sweet Sensation', 'Jollof Republic', 'Bukka Hut', 'Glovo'],
    amountRangeNaira: [1500, 6500],
    dailyChance: 0.7,
  },
  {
    category: TransactionCategoryEnum.TRANSPORT,
    recipients: ['Bolt', 'LagRide', 'Indrive', 'Uber', 'NNPC Fuel', 'Total'],
    amountRangeNaira: [800, 4500],
    dailyChance: 0.55,
  },
  {
    category: TransactionCategoryEnum.BILLS_AND_UTILITIES,
    recipients: ['IKEDC', 'MTN Data', 'DSTV', 'Spectranet'],
    amountRangeNaira: [4000, 32000],
    dailyChance: 0.1,
  },
  {
    category: TransactionCategoryEnum.SHOPPING,
    recipients: ['Jumia', 'Konga', 'Shoprite', 'Spar Lagos'],
    amountRangeNaira: [5000, 38000],
    dailyChance: 0.25,
  },
  {
    category: TransactionCategoryEnum.ENTERTAINMENT,
    recipients: ['Netflix NG', 'Spotify', 'Cinemax VI'],
    amountRangeNaira: [2400, 8500],
    dailyChance: 0.1,
  },
  {
    category: TransactionCategoryEnum.TRANSFER,
    recipients: ['Adaobi Ifeanyi', 'Mama Caro Foods', 'Tunde Bakare', 'Ngozi Eze'],
    amountRangeNaira: [5000, 80000],
    dailyChance: 0.18,
  },
];

const NIGERIAN_BANKS: Array<{ code: string; name: string }> = [
  { code: '058', name: 'GTBank' },
  { code: '044', name: 'Access Bank' },
  { code: '011', name: 'First Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
];

@Injectable()
export class DevService {
  private readonly logger = new Logger(DevService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async seedTransactions(body: SeedTransactionsBodyDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');

    const account = await this.prismaService.bankAccounts.findFirst({
      where: { userId: auth.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, balance: true },
    });
    if (!account) {
      throw new NotFoundException(
        'No bank account found for this user. Complete sign-up Stage 2 first.',
      );
    }

    const days = body.days ?? 90;
    if (body.reset) {
      const deleted = await this.prismaService.transactions.deleteMany({
        where: { userId: auth.id },
      });
      // Reset balance to 0 — the seeder will rebuild it as it inserts.
      await this.prismaService.bankAccounts.update({
        where: { id: account.id },
        data: { balance: 0 },
      });
      this.logger.log(`Wiped ${deleted.count} transactions for user=${auth.id}`);
    }

    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - days);

    // Monthly salary inflows: one big credit per month, anchored to the 28th
    // (or the start date for the first month).
    const inflowAmount = 280_000 + Math.floor(Math.random() * 260_000); // ₦280k–540k
    const salaryDates: Date[] = [];
    for (let cursor = new Date(start); cursor <= now; ) {
      const next = new Date(cursor);
      next.setMonth(cursor.getMonth() + 1);
      salaryDates.push(cursor);
      cursor = next;
    }

    type Insert = Parameters<
      typeof this.prismaService.transactions.createMany
    >[0]['data'];
    const rows: Insert = [];
    let balanceDelta = 0;

    for (const salaryDate of salaryDates) {
      const amount = inflowAmount * 100; // kobo
      rows.push({
        reference: `seed-${randomUUID().replace(/-/g, '')}`,
        direction: TransactionDirectionEnum.CREDIT,
        status: TransactionStatusEnum.SUCCESS,
        category: TransactionCategoryEnum.INCOME,
        description: 'Salary · Balogun Fabrics',
        amount,
        principalAmount: amount,
        settledAmount: amount,
        currency: 'NGN',
        senderName: 'Balogun Fabrics Ltd',
        senderAccountNumber: this.randomNuban(),
        senderBankCode: '058',
        senderBankName: 'GTBank',
        processedAt: salaryDate,
        createdAt: salaryDate,
        updatedAt: salaryDate,
        accountId: account.id,
        userId: auth.id,
      });
      balanceDelta += amount;
    }

    for (let i = 0; i < days; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      for (const template of DEBIT_TEMPLATES) {
        if (Math.random() > template.dailyChance) continue;
        const [lo, hi] = template.amountRangeNaira;
        const naira = lo + Math.floor(Math.random() * (hi - lo));
        const amount = naira * 100;
        const counterparty =
          template.recipients[
            Math.floor(Math.random() * template.recipients.length)
          ];
        const bank =
          template.category === TransactionCategoryEnum.TRANSFER
            ? NIGERIAN_BANKS[
                Math.floor(Math.random() * NIGERIAN_BANKS.length)
              ]
            : undefined;
        // Randomize the time of day so the spending-heatmap card has texture.
        const hour = 7 + Math.floor(Math.random() * 14);
        const minute = Math.floor(Math.random() * 60);
        const txDate = new Date(day);
        txDate.setHours(hour, minute, 0, 0);

        rows.push({
          reference: `seed-${randomUUID().replace(/-/g, '')}`,
          direction: TransactionDirectionEnum.DEBIT,
          status: TransactionStatusEnum.SUCCESS,
          category: template.category,
          description: counterparty,
          amount,
          currency: 'NGN',
          recipientName: counterparty,
          recipientAccountNumber: bank ? this.randomNuban() : null,
          recipientBankCode: bank?.code,
          recipientBankName: bank?.name,
          processedAt: txDate,
          createdAt: txDate,
          updatedAt: txDate,
          accountId: account.id,
          userId: auth.id,
        });
        balanceDelta -= amount;
      }
    }

    // Prisma's createMany is fast but doesn't return rows; we don't need them.
    await this.prismaService.transactions.createMany({
      data: rows,
      skipDuplicates: true,
    });
    await this.prismaService.bankAccounts.update({
      where: { id: account.id },
      data: { balance: { increment: balanceDelta } },
    });

    // Also mint a virtual card if the user doesn't have one yet — keeps
    // the wallet's VirtualCardPreview meaningful from the first demo run.
    const existingCard = await this.prismaService.virtualCards.findFirst({
      where: { userId: auth.id, status: { not: 'TERMINATED' } },
      select: { id: true },
    });
    if (!existingCard) {
      await this.prismaService.virtualCards.create({
        data: {
          userId: auth.id,
          accountId: account.id,
          last4: String(1000 + Math.floor(Math.random() * 9000)),
          brand: 'VERVE',
          expMonth: 9,
          expYear: now.getFullYear() + 4,
          status: 'ACTIVE',
          spendLimitMonthly: 500_000 * 100,
          spentThisMonth: Math.round(
            Math.abs(balanceDelta) * 0.15,
          ),
        },
      });
    }

    return new BaseResponse({
      inserted: rows.length,
      days,
      balanceDeltaKobo: balanceDelta,
      cardSeeded: !existingCard,
      message:
        'Seed complete. POST /api/v1/analysis/refresh to populate insights from the new data.',
    });
  }

  async clearTransactions(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    const deleted = await this.prismaService.transactions.deleteMany({
      where: { userId: auth.id },
    });
    // Reset balance — easier than back-tracking which rows were seeded vs real.
    await this.prismaService.bankAccounts.updateMany({
      where: { userId: auth.id },
      data: { balance: 0 },
    });
    return new BaseResponse({ deleted: deleted.count });
  }

  // Idempotently seed loan products, investment products, and grants. Use
  // `skipDuplicates` on a unique name so reruns don't bloat the catalog.
  async seedCatalog() {
    // We don't have a unique index on `name` because real products might
    // share names across providers. Instead, dedupe in JS by checking what
    // already exists and only inserting the missing ones.
    const [existingLoans, existingInvestments, existingGrants] =
      await Promise.all([
        this.prismaService.loanProducts.findMany({
          select: { name: true, provider: true },
        }),
        this.prismaService.investmentProducts.findMany({
          select: { name: true, provider: true },
        }),
        this.prismaService.grants.findMany({
          select: { title: true, provider: true },
        }),
      ]);

    const loanKey = (p: { name: string; provider: string }) =>
      `${p.provider}::${p.name}`;
    const grantKey = (p: { title: string; provider: string }) =>
      `${p.provider}::${p.title}`;

    const existingLoanSet = new Set(existingLoans.map(loanKey));
    const existingInvestmentSet = new Set(
      existingInvestments.map(loanKey),
    );
    const existingGrantSet = new Set(existingGrants.map(grantKey));

    // Decorate each seed with the JSON template defaults declared below.
    // Keeps the seed literals readable while still wiring riskNarrative,
    // faqEntries, requiredDocuments, etc. onto every product.
    const loans = LOAN_PRODUCT_SEEDS.filter(
      (p) => !existingLoanSet.has(loanKey(p)),
    ).map((p) => ({
      ...p,
      riskNarrative: LOAN_RISK_NARRATIVES[p.type] ?? null,
      faqEntries: LOAN_FAQ as unknown as object,
      requiredDocuments: [
        COMMON_DOCS.nin_slip,
        COMMON_DOCS.drivers_license,
        COMMON_DOCS.bank_statement_6mo,
        ...(p.type === 'BUSINESS' ? [COMMON_DOCS.cac_certificate] : []),
        COMMON_DOCS.utility_bill,
      ] as unknown as object,
      costBreakdownTemplate: LOAN_COST_TEMPLATE as unknown as object,
    }));
    const investments = INVESTMENT_PRODUCT_SEEDS.filter(
      (p) => !existingInvestmentSet.has(loanKey(p)),
    ).map((p) => ({
      ...p,
      riskNarrative: INVESTMENT_RISK_NARRATIVES[p.riskLevel] ?? null,
      sectorAllocation: SECTOR_ALLOCATIONS[p.type] as unknown as object,
      faqEntries: INVESTMENT_FAQ as unknown as object,
      requiredDocuments: [
        COMMON_DOCS.nin_slip,
        COMMON_DOCS.bank_statement_6mo,
      ] as unknown as object,
      costBreakdownTemplate: INVESTMENT_COST_TEMPLATE as unknown as object,
    }));
    const grants = GRANT_SEEDS.filter(
      (g) => !existingGrantSet.has(grantKey(g)),
    ).map((g) => ({
      ...g,
      faqEntries: GRANT_FAQ as unknown as object,
      requiredDocuments: [
        COMMON_DOCS.nin_slip,
        COMMON_DOCS.cac_certificate,
        COMMON_DOCS.bank_statement_6mo,
      ] as unknown as object,
    }));

    const [loanResult, investmentResult, grantResult] = await Promise.all([
      this.prismaService.loanProducts.createMany({ data: loans }),
      this.prismaService.investmentProducts.createMany({ data: investments }),
      this.prismaService.grants.createMany({ data: grants }),
    ]);

    // After investments insert, seed NAV history + distributions for any
    // investment product that doesn't have them yet. This powers the
    // PerformanceChart + NavPerUnitCard + RecentDistributions panels on
    // /investments/[id].
    const navResult = await this.seedInvestmentTimeSeries();

    return new BaseResponse({
      loans: loanResult.count,
      investments: investmentResult.count,
      grants: grantResult.count,
      navHistoryPoints: navResult.navPoints,
      distributions: navResult.distributions,
      message:
        'Catalog seeded. /loans/products, /investments/products, /opportunities now have data.',
    });
  }

  // Seeds 365 days of daily NAV history + 12 months of distributions per
  // active investment product that doesn't already have data. The shape is
  // believable but illustrative — there's no real market data feed.
  private async seedInvestmentTimeSeries() {
    const products = await this.prismaService.investmentProducts.findMany({
      where: { isActive: true },
      select: { id: true, expectedReturnBps: true, type: true },
    });
    let navPoints = 0;
    let distributions = 0;

    for (const p of products) {
      const existing = await this.prismaService.investmentNavHistory.count({
        where: { productId: p.id },
      });
      if (existing > 0) continue;

      const days = 365;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = new Date(today);
      start.setDate(start.getDate() - days);

      // Generate NAV that drifts upward consistent with expectedReturnBps,
      // plus daily noise sized by the product's risk band.
      const annualReturn = p.expectedReturnBps / 10_000;
      const dailyReturn = annualReturn / 365;
      const dailyVolBps = this.dailyVolatilityForType(p.type);

      let nav = 100_00; // start at ₦100 per unit
      const rows: Array<{
        productId: string;
        date: Date;
        navPerUnit: number;
      }> = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const noise = ((Math.random() * 2 - 1) * dailyVolBps) / 10_000;
        nav = Math.max(1, Math.round(nav * (1 + dailyReturn + noise)));
        rows.push({ productId: p.id, date, navPerUnit: nav });
      }
      const created = await this.prismaService.investmentNavHistory.createMany({
        data: rows,
        skipDuplicates: true,
      });
      navPoints += created.count;

      // 12 monthly distributions matching the implied yield.
      const distroRows: Array<{
        productId: string;
        paidAt: Date;
        amountPerUnit: number;
        totalPaid: number;
        type: 'DIVIDEND' | 'INTEREST' | 'CAPITAL_GAIN';
      }> = [];
      const distroType: 'DIVIDEND' | 'INTEREST' | 'CAPITAL_GAIN' =
        p.type === 'BOND' || p.type === 'TREASURY_BILL' || p.type === 'FIXED_DEPOSIT'
          ? 'INTEREST'
          : p.type === 'ETF'
          ? 'DIVIDEND'
          : 'INTEREST';
      for (let m = 11; m >= 0; m--) {
        const paidAt = new Date(today);
        paidAt.setMonth(today.getMonth() - m);
        const amountPerUnit = Math.round((100_00 * annualReturn) / 12);
        distroRows.push({
          productId: p.id,
          paidAt,
          amountPerUnit,
          totalPaid: amountPerUnit * 1_000_000, // illustrative AUM
          type: distroType,
        });
      }
      const createdDistros =
        await this.prismaService.investmentDistributions.createMany({
          data: distroRows,
          skipDuplicates: true,
        });
      distributions += createdDistros.count;
    }
    return { navPoints, distributions };
  }

  // Pegged volatility per product type. Low-risk products (T-Bills, FD) hold
  // their NAV tightly; ETFs swing more. Bps per day.
  private dailyVolatilityForType(type: string): number {
    switch (type) {
      case 'TREASURY_BILL':
      case 'FIXED_DEPOSIT':
        return 5;
      case 'MONEY_MARKET':
        return 10;
      case 'BOND':
        return 20;
      case 'COOPERATIVE':
        return 30;
      case 'ETF':
        return 80;
      default:
        return 20;
    }
  }

  private randomNuban() {
    let n = '';
    for (let i = 0; i < 10; i++) n += Math.floor(Math.random() * 10).toString();
    return n;
  }
}

// ─── Catalog seed data ──────────────────────────────────────────────────────
// Tunable. These are the products surfaced on /loans, /investments, and
// /opportunities. Replace with real partner products once integrations exist.

// Shared document templates — referenced by ID from per-product requirements.
const COMMON_DOCS = {
  drivers_license: {
    id: 'drivers_license',
    label: "Driver's licence",
    description: 'Front + back of a valid Nigerian driver’s licence.',
    required: true,
    category: 'IDENTITY' as const,
  },
  nin_slip: {
    id: 'nin_slip',
    label: 'NIN slip',
    description: 'National Identification Number slip or NIMC card.',
    required: true,
    category: 'IDENTITY' as const,
  },
  bank_statement_6mo: {
    id: 'bank_statement_6mo',
    label: 'Bank statement (last 6 months)',
    description: 'PDF statement covering the most recent 6 months.',
    required: true,
    category: 'FINANCIAL' as const,
  },
  utility_bill: {
    id: 'utility_bill',
    label: 'Utility bill',
    description: 'Recent NEPA / water / cable bill (<3 months old).',
    required: false,
    category: 'OTHER' as const,
  },
  cac_certificate: {
    id: 'cac_certificate',
    label: 'CAC certificate',
    description: 'Corporate Affairs Commission registration certificate.',
    required: true,
    category: 'BUSINESS' as const,
  },
  signature_specimen: {
    id: 'signature_specimen',
    label: 'Signature specimen',
    description: 'Signed specimen card.',
    required: false,
    category: 'OTHER' as const,
  },
};

const LOAN_COST_TEMPLATE = [
  { label: 'Origination fee', ratioBps: 150, recurring: false }, // 1.5%
  { label: 'Processing fee', amountKobo: 50_000, recurring: false }, // ₦500
  { label: 'Insurance', ratioBps: 50, recurring: true }, // 0.5% per cycle
];

const INVESTMENT_COST_TEMPLATE = [
  { label: 'Entry fee', amountKobo: 0, recurring: false },
  { label: 'Management fee', ratioBps: 83, recurring: true }, // ~1% p.a. spread monthly
];

const LOAN_FAQ = [
  {
    question: 'How quickly will I receive the funds?',
    answer:
      'Approved loans are disbursed to your Trace wallet within 24 hours, subject to verification.',
  },
  {
    question: 'What happens if I miss a payment?',
    answer:
      'A late fee of ₦500 applies after a 3-day grace period. Persistent default reduces your tier.',
  },
  {
    question: 'Can I repay early?',
    answer: 'Yes — early repayment is free; you save the unaccrued interest.',
  },
];

const INVESTMENT_FAQ = [
  {
    question: 'Can I withdraw before maturity?',
    answer:
      'Open-ended products allow withdrawal anytime. Locked products redeem at maturity; early exit forfeits a portion of interest.',
  },
  {
    question: 'Is my principal protected?',
    answer:
      'Risk profile varies by product — see the riskNarrative for the honest read.',
  },
  {
    question: 'How are returns paid?',
    answer:
      'Returns are credited to your Trace wallet at maturity (locked products) or daily (money market).',
  },
];

const GRANT_FAQ = [
  {
    question: 'Is this grant repayable?',
    answer: 'No — grants are non-repayable subject to compliance with terms.',
  },
  {
    question: 'How long does review take?',
    answer: 'Most grant decisions are issued within 30–60 days of submission.',
  },
];

// Short "honest read" paragraphs per loan product type. Surfaced on the
// detail page's RiskHonestRead card.
const LOAN_RISK_NARRATIVES: Record<string, string> = {
  PERSONAL:
    'Mid-size personal loans carry default risk if monthly inflow drops. The rate is fair; the tenor flexibility is what makes or breaks affordability — keep daily payments under a third of your daily inflow.',
  SALARY_ADVANCE:
    'Short-tenor advances are low-friction but compound quickly if you miss the payday auto-debit. Treat them as one-month bridges, not ongoing credit.',
  BUSINESS:
    'Business credit is priced for cashflow-mature traders. The repayment cadence is weekly; ensure your inventory turnover supports it before drawing.',
  EMERGENCY:
    'Emergency cash is the most expensive credit on the platform — use it once, repay fast, and migrate to Personal or Salary Advance once your tier improves.',
};

// Same idea per risk band on investments.
const INVESTMENT_RISK_NARRATIVES: Record<string, string> = {
  LOW: 'Principal is effectively protected. Returns track CBN policy rates — modest but consistent. Suitable for emergency reserves and short-term goals.',
  LOW_MEDIUM:
    'Mostly fixed-income exposure with limited price volatility. Open-ended liquidity. Reasonable home for a quarter to a third of your investable surplus.',
  MEDIUM:
    'Balanced mix of fixed-income + selective equities. Expect modest drawdowns in rough months; long-term return should beat MMF by 200–400 bps.',
  MEDIUM_HIGH:
    'Real volatility — single-month moves of 5%+ are normal. Returns can compound powerfully but you need a multi-year horizon to ride out cycles.',
  HIGH: 'Equity-heavy or sector-concentrated. Capable of 20%+ annual gains but also of 20%+ drawdowns. Only commit money you can leave alone for 3+ years.',
};

// Illustrative sector splits per product type. Used by the
// SectorAllocation card on /investments/[id].
const SECTOR_ALLOCATIONS: Record<
  string,
  Array<{ sector: string; percent: number; amount: number }>
> = {
  MONEY_MARKET: [
    { sector: 'T-Bills', percent: 65, amount: 65_000_000_00 },
    { sector: 'Commercial Paper', percent: 25, amount: 25_000_000_00 },
    { sector: 'Bank Placements', percent: 10, amount: 10_000_000_00 },
  ],
  TREASURY_BILL: [
    { sector: 'FGN T-Bills', percent: 100, amount: 100_000_000_00 },
  ],
  BOND: [
    { sector: 'FGN Bonds', percent: 60, amount: 60_000_000_00 },
    { sector: 'Corporate Bonds', percent: 30, amount: 30_000_000_00 },
    { sector: 'Sub-national Bonds', percent: 10, amount: 10_000_000_00 },
  ],
  COOPERATIVE: [
    { sector: 'Textile traders', percent: 70, amount: 70_000_000_00 },
    { sector: 'Logistics support', percent: 30, amount: 30_000_000_00 },
  ],
  ETF: [
    { sector: 'Banking', percent: 45, amount: 45_000_000_00 },
    { sector: 'Consumer goods', percent: 25, amount: 25_000_000_00 },
    { sector: 'Industrials', percent: 15, amount: 15_000_000_00 },
    { sector: 'Telecoms', percent: 10, amount: 10_000_000_00 },
    { sector: 'Cash', percent: 5, amount: 5_000_000_00 },
  ],
  FIXED_DEPOSIT: [
    { sector: 'Term deposit', percent: 100, amount: 100_000_000_00 },
  ],
};

const LOAN_PRODUCT_SEEDS: Array<{
  name: string;
  provider: string;
  type: LoanProductTypeEnum;
  interestRateBps: number;
  minAmount: number;
  maxAmount: number;
  minTenorDays: number;
  maxTenorDays: number;
  requiredTier: LoanTierEnum;
  description: string;
}> = [
  {
    name: 'Salary Advance',
    provider: 'SquadCapital',
    type: 'SALARY_ADVANCE',
    interestRateBps: 1800, // 18%
    minAmount: 10_000_00,
    maxAmount: 100_000_00,
    minTenorDays: 7,
    maxTenorDays: 30,
    requiredTier: 'SILVER',
    description: 'Up to 30 days against your next salary. Daily amortising.',
  },
  {
    name: 'Quick Cash',
    provider: 'SquadCapital',
    type: 'EMERGENCY',
    interestRateBps: 2400,
    minAmount: 5_000_00,
    maxAmount: 30_000_00,
    minTenorDays: 7,
    maxTenorDays: 14,
    requiredTier: 'BRONZE',
    description: 'Same-day emergency cash. No collateral.',
  },
  {
    name: 'Personal Loan',
    provider: 'SquadCapital',
    type: 'PERSONAL',
    interestRateBps: 1500,
    minAmount: 50_000_00,
    maxAmount: 500_000_00,
    minTenorDays: 30,
    maxTenorDays: 180,
    requiredTier: 'GOLD',
    description: 'Mid-size personal loan with flexible tenor.',
  },
  {
    name: 'Trader Stock Loan',
    provider: 'SquadCapital',
    type: 'BUSINESS',
    interestRateBps: 1700,
    minAmount: 100_000_00,
    maxAmount: 1_000_000_00,
    minTenorDays: 30,
    maxTenorDays: 90,
    requiredTier: 'GOLD',
    description: 'Stock financing for traders. Weekly repayments.',
  },
  {
    name: 'Platinum Credit Line',
    provider: 'SquadCapital',
    type: 'PERSONAL',
    interestRateBps: 1200,
    minAmount: 200_000_00,
    maxAmount: 2_000_000_00,
    minTenorDays: 60,
    maxTenorDays: 365,
    requiredTier: 'PLATINUM',
    description: 'Premium revolving credit at our lowest rate.',
  },
];

const INVESTMENT_PRODUCT_SEEDS: Array<{
  name: string;
  provider: string;
  type: InvestmentProductTypeEnum;
  expectedReturnBps: number;
  riskLevel: RiskLevelEnum;
  minAmount: number;
  tenorDays: number | null;
  description: string;
}> = [
  {
    name: 'Money Market Fund',
    provider: 'Stanbic',
    type: 'MONEY_MARKET',
    expectedReturnBps: 1320, // 13.2%
    riskLevel: 'LOW',
    minAmount: 5_000_00,
    tenorDays: null,
    description: 'Withdraw anytime. Daily compounding.',
  },
  {
    name: '91-Day T-Bill',
    provider: 'CBN',
    type: 'TREASURY_BILL',
    expectedReturnBps: 1800,
    riskLevel: 'LOW',
    minAmount: 50_000_00,
    tenorDays: 91,
    description: 'Government-backed. Locked for 91 days.',
  },
  {
    name: '182-Day T-Bill',
    provider: 'CBN',
    type: 'TREASURY_BILL',
    expectedReturnBps: 2050,
    riskLevel: 'LOW',
    minAmount: 50_000_00,
    tenorDays: 182,
    description: 'Higher yield, longer lock.',
  },
  {
    name: 'Lagos Textile Coop',
    provider: 'LagTex Coop',
    type: 'COOPERATIVE',
    expectedReturnBps: 2400,
    riskLevel: 'MEDIUM',
    minAmount: 25_000_00,
    tenorDays: 180,
    description: 'Pooled coop fund for textile traders in Lagos.',
  },
  {
    name: 'NGN Bond Fund',
    provider: 'ARM',
    type: 'BOND',
    expectedReturnBps: 1600,
    riskLevel: 'LOW_MEDIUM',
    minAmount: 10_000_00,
    tenorDays: null,
    description: 'Diversified Nigerian sovereign + corporate bonds.',
  },
  {
    name: 'NGX Banking ETF',
    provider: 'Vetiva',
    type: 'ETF',
    expectedReturnBps: 2200,
    riskLevel: 'MEDIUM_HIGH',
    minAmount: 20_000_00,
    tenorDays: null,
    description: 'Tracks the NGX Banking Index. Higher volatility.',
  },
  {
    name: '30-Day Fixed Deposit',
    provider: 'GTBank',
    type: 'FIXED_DEPOSIT',
    expectedReturnBps: 1100,
    riskLevel: 'LOW',
    minAmount: 100_000_00,
    tenorDays: 30,
    description: 'NDIC-insured. Locked 30 days.',
  },
];

const GRANT_SEEDS: Array<{
  kind: OpportunityKindEnum;
  title: string;
  provider: string;
  description: string;
  awardAmount: number;
  deadline: Date | null;
  eligibility: string;
  applicationUrl: string | null;
}> = [
  {
    kind: 'GRANT',
    title: 'YouWiN Connect Grant',
    provider: 'Federal Ministry of Finance',
    description:
      'Non-repayable grant for early-stage businesses run by Nigerian entrepreneurs aged 18-45.',
    awardAmount: 5_000_000_00,
    deadline: null,
    eligibility:
      'Registered business in Nigeria, ages 18-45, business plan submission required.',
    applicationUrl: 'https://example.org/youwin',
  },
  {
    kind: 'GRANT',
    title: 'Tony Elumelu Foundation Seed Grant',
    provider: 'Tony Elumelu Foundation',
    description: '$5,000 seed for African entrepreneurs across 54 countries.',
    awardAmount: 5_000_000_00,
    deadline: null,
    eligibility: 'African entrepreneurs with active businesses ≤3 years old.',
    applicationUrl: 'https://example.org/tef',
  },
  {
    kind: 'PARTNERSHIP',
    title: 'Lagos Trader Equipment Partnership',
    provider: 'Lagos State Government',
    description:
      'Subsidised equipment financing for market traders in Lagos State.',
    awardAmount: 250_000_00,
    deadline: null,
    eligibility:
      'Registered traders in Lagos State markets with ≥6 months of transaction history.',
    applicationUrl: null,
  },
];
