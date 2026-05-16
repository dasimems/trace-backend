import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import BaseResponse from '@common/response/base.response';
import {
  CashFlowResponseDTO,
  CategoryTrendResponseDTO,
  MoneyFlowResponseDTO,
  SpendingBreakdownResponseDTO,
  WeeklyCashFlowPointDTO,
  WeeklyMoneyFlowPointDTO,
} from '@common/response/analysis/analysis.dto';

interface WeekBucket {
  start: Date;
  end: Date;
  label: string;
  income: number;
  spend: number;
}

@Injectable()
export class AnalysisService {
  constructor(private readonly prismaService: PrismaService) {}

  private startOfWeek(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    // Reset to Monday (ISO week start) — keeps labels stable regardless of locale.
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d;
  }

  private startOfMonth(date: Date) {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private buildWeekBuckets(
    weeks: number,
    labelFormat: (index: number) => string,
  ): WeekBucket[] {
    const buckets: WeekBucket[] = [];
    const thisWeekStart = this.startOfWeek(new Date());
    for (let i = weeks - 1; i >= 0; i--) {
      const start = new Date(thisWeekStart);
      start.setDate(thisWeekStart.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      buckets.push({
        start,
        end,
        label: labelFormat(weeks - i),
        income: 0,
        spend: 0,
      });
    }
    return buckets;
  }

  async getCashflow(userId: string, weeks: number) {
    const buckets = this.buildWeekBuckets(weeks, (n) => `Wk ${n}`);
    if (buckets.length === 0) {
      return new BaseResponse<CashFlowResponseDTO>({ weeks: [] });
    }

    const earliest = buckets[0].start;
    const rows = await this.prismaService.transactions.findMany({
      where: {
        userId,
        status: TransactionStatusEnum.SUCCESS,
        createdAt: { gte: earliest },
      },
      select: { amount: true, direction: true, createdAt: true },
    });

    for (const row of rows) {
      const bucket = buckets.find(
        (b) => row.createdAt >= b.start && row.createdAt < b.end,
      );
      if (!bucket) continue;
      if (row.direction === TransactionDirectionEnum.CREDIT) {
        bucket.income += row.amount;
      } else {
        bucket.spend += row.amount;
      }
    }

    const points: WeeklyCashFlowPointDTO[] = buckets.map((b) => ({
      label: b.label,
      start: b.start,
      end: b.end,
      income: b.income,
      spend: b.spend,
    }));
    return new BaseResponse<CashFlowResponseDTO>({ weeks: points });
  }

  async getMoneyFlow(userId: string, weeks: number) {
    const buckets = this.buildWeekBuckets(weeks, (n) => `W${n}`);
    if (buckets.length === 0) {
      return new BaseResponse<MoneyFlowResponseDTO>({ weeks: [] });
    }

    const earliest = buckets[0].start;
    const rows = await this.prismaService.transactions.findMany({
      where: {
        userId,
        status: TransactionStatusEnum.SUCCESS,
        createdAt: { gte: earliest },
      },
      select: { amount: true, direction: true, createdAt: true },
    });

    for (const row of rows) {
      const bucket = buckets.find(
        (b) => row.createdAt >= b.start && row.createdAt < b.end,
      );
      if (!bucket) continue;
      if (row.direction === TransactionDirectionEnum.CREDIT) {
        bucket.income += row.amount;
      } else {
        bucket.spend += row.amount;
      }
    }

    const points: WeeklyMoneyFlowPointDTO[] = buckets.map((b) => ({
      label: b.label,
      start: b.start,
      end: b.end,
      in: b.income,
      out: b.spend,
    }));
    return new BaseResponse<MoneyFlowResponseDTO>({ weeks: points });
  }

  async getSpendingBreakdown(userId: string) {
    const monthStart = this.startOfMonth(new Date());
    const grouped = await this.prismaService.transactions.groupBy({
      by: ['category'],
      where: {
        userId,
        direction: TransactionDirectionEnum.DEBIT,
        status: TransactionStatusEnum.SUCCESS,
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    const items = grouped
      .map((row) => ({
        category: row.category,
        amount: row._sum.amount ?? 0,
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const total = items.reduce((sum, row) => sum + row.amount, 0);
    const response: SpendingBreakdownResponseDTO = {
      items: items.map((row) => ({
        category: row.category,
        amount: row.amount,
        percent: total === 0 ? 0 : Math.round((row.amount / total) * 100),
      })),
      total,
    };

    return new BaseResponse(response);
  }

  async getCategoryTrend(userId: string) {
    const now = new Date();
    const monthStart = this.startOfMonth(now);
    const eightWeeksAgo = new Date(monthStart);
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 8 * 7);

    const [currentRows, priorRows] = await Promise.all([
      this.prismaService.transactions.groupBy({
        by: ['category'],
        where: {
          userId,
          direction: TransactionDirectionEnum.DEBIT,
          status: TransactionStatusEnum.SUCCESS,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prismaService.transactions.groupBy({
        by: ['category'],
        where: {
          userId,
          direction: TransactionDirectionEnum.DEBIT,
          status: TransactionStatusEnum.SUCCESS,
          createdAt: { gte: eightWeeksAgo, lt: monthStart },
        },
        _sum: { amount: true },
      }),
    ]);

    // Average of the prior 8 weeks normalized to a "per month" figure (≈4.33
    // weeks/month) so it's comparable with the current month total.
    const priorByCategory = new Map<TransactionCategoryEnum, number>();
    for (const row of priorRows) {
      const totalKobo = row._sum.amount ?? 0;
      const avgPerMonth = Math.round((totalKobo / 8) * 4.33);
      priorByCategory.set(row.category, avgPerMonth);
    }

    const categories = new Set<TransactionCategoryEnum>([
      ...currentRows.map((r) => r.category),
      ...priorByCategory.keys(),
    ]);

    const response: CategoryTrendResponseDTO = {
      items: Array.from(categories)
        .map((category) => ({
          category,
          current:
            currentRows.find((r) => r.category === category)?._sum.amount ??
            0,
          average: priorByCategory.get(category) ?? 0,
        }))
        .filter((row) => row.current > 0 || row.average > 0)
        .sort((a, b) => b.current - a.current),
    };

    return new BaseResponse(response);
  }

  requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  // Spend density across a 7×24 grid (day-of-week × hour-of-day). Sparse —
  // only cells with at least one debit are returned. Powers the
  // SpendingHeatmap card on the transactions page.
  async getSpendHeatmap(userId: string, days: number) {
    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - days);

    const debits = await this.prismaService.transactions.findMany({
      where: {
        userId,
        direction: TransactionDirectionEnum.DEBIT,
        status: TransactionStatusEnum.SUCCESS,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { amount: true, createdAt: true },
    });

    type CellKey = `${number}:${number}`;
    const cells = new Map<CellKey, { amount: number; txCount: number }>();
    let totalSpend = 0;

    for (const tx of debits) {
      // JavaScript's getDay returns 0 (Sun) – 6 (Sat). We want 0=Mon, 6=Sun.
      const jsDay = tx.createdAt.getDay();
      const dayOfWeek = (jsDay + 6) % 7;
      const hour = tx.createdAt.getHours();
      const key: CellKey = `${dayOfWeek}:${hour}`;
      const existing = cells.get(key) ?? { amount: 0, txCount: 0 };
      existing.amount += tx.amount;
      existing.txCount += 1;
      cells.set(key, existing);
      totalSpend += tx.amount;
    }

    const cellArray = Array.from(cells.entries()).map(([key, val]) => {
      const [d, h] = key.split(':').map(Number);
      return {
        dayOfWeek: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        hour: h,
        amount: val.amount,
        txCount: val.txCount,
      };
    });

    let peakCell: { dayOfWeek: number; hour: number; amount: number } | null =
      null;
    for (const c of cellArray) {
      if (!peakCell || c.amount > peakCell.amount) {
        peakCell = { dayOfWeek: c.dayOfWeek, hour: c.hour, amount: c.amount };
      }
    }

    return new BaseResponse({
      cells: cellArray,
      rangeStart,
      rangeEnd,
      totalSpend,
      peakCell,
    });
  }
}
