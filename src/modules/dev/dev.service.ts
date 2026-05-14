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

    return new BaseResponse({
      inserted: rows.length,
      days,
      balanceDeltaKobo: balanceDelta,
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

    const loans = LOAN_PRODUCT_SEEDS.filter(
      (p) => !existingLoanSet.has(loanKey(p)),
    );
    const investments = INVESTMENT_PRODUCT_SEEDS.filter(
      (p) => !existingInvestmentSet.has(loanKey(p)),
    );
    const grants = GRANT_SEEDS.filter((g) => !existingGrantSet.has(grantKey(g)));

    const [loanResult, investmentResult, grantResult] = await Promise.all([
      this.prismaService.loanProducts.createMany({ data: loans }),
      this.prismaService.investmentProducts.createMany({ data: investments }),
      this.prismaService.grants.createMany({ data: grants }),
    ]);

    return new BaseResponse({
      loans: loanResult.count,
      investments: investmentResult.count,
      grants: grantResult.count,
      message:
        'Catalog seeded. /loans/products, /investments/products, /opportunities now have data.',
    });
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
