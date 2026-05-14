import { ApiProperty } from '@nestjs/swagger';
import { TransactionCategoryEnum } from '@prisma/client';

export class WeeklyCashFlowPointDTO {
  @ApiProperty({ type: String, example: 'Wk 1' })
  label: string;

  @ApiProperty({ type: Date })
  start: Date;

  @ApiProperty({ type: Date })
  end: Date;

  @ApiProperty({ type: Number, description: 'Income in kobo' })
  income: number;

  @ApiProperty({ type: Number, description: 'Spend in kobo' })
  spend: number;

  @ApiProperty({ type: Number, required: false, description: 'Forecast in kobo' })
  forecast?: number;
}

export class CashFlowResponseDTO {
  @ApiProperty({ type: () => [WeeklyCashFlowPointDTO] })
  weeks: WeeklyCashFlowPointDTO[];
}

export class WeeklyMoneyFlowPointDTO {
  @ApiProperty({ type: String, example: 'W1' })
  label: string;

  @ApiProperty({ type: Date })
  start: Date;

  @ApiProperty({ type: Date })
  end: Date;

  @ApiProperty({ type: Number, description: 'Inflow in kobo' })
  in: number;

  @ApiProperty({ type: Number, description: 'Outflow in kobo' })
  out: number;
}

export class MoneyFlowResponseDTO {
  @ApiProperty({ type: () => [WeeklyMoneyFlowPointDTO] })
  weeks: WeeklyMoneyFlowPointDTO[];
}

export class SpendingBreakdownItemDTO {
  @ApiProperty({ enum: TransactionCategoryEnum })
  category: TransactionCategoryEnum;

  @ApiProperty({ type: Number, description: 'Total in kobo' })
  amount: number;

  @ApiProperty({ type: Number, description: 'Percent of total spend, 0-100' })
  percent: number;
}

export class SpendingBreakdownResponseDTO {
  @ApiProperty({ type: () => [SpendingBreakdownItemDTO] })
  items: SpendingBreakdownItemDTO[];

  @ApiProperty({ type: Number, description: 'Total spend in kobo' })
  total: number;
}

export class CategoryTrendItemDTO {
  @ApiProperty({ enum: TransactionCategoryEnum })
  category: TransactionCategoryEnum;

  @ApiProperty({ type: Number, description: 'Current month spend in kobo' })
  current: number;

  @ApiProperty({ type: Number, description: 'Prior 8-week average in kobo' })
  average: number;
}

export class CategoryTrendResponseDTO {
  @ApiProperty({ type: () => [CategoryTrendItemDTO] })
  items: CategoryTrendItemDTO[];
}
