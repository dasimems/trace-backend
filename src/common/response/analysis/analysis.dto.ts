import { ApiProperty } from '@nestjs/swagger';
import { TransactionCategoryEnum } from '@prisma/client';
import { Price } from '@common/price/price.dto';

export class WeeklyCashFlowPointDTO {
  @ApiProperty({ type: String, example: 'Wk 1' })
  label: string;

  @ApiProperty({ type: Date })
  start: Date;

  @ApiProperty({ type: Date })
  end: Date;

  @ApiProperty({ type: () => Price, description: 'Income' })
  income: Price;

  @ApiProperty({ type: () => Price, description: 'Spend' })
  spend: Price;

  @ApiProperty({ type: () => Price, required: false, description: 'Forecast' })
  forecast?: Price;
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

  @ApiProperty({ type: () => Price, description: 'Inflow' })
  in: Price;

  @ApiProperty({ type: () => Price, description: 'Outflow' })
  out: Price;
}

export class MoneyFlowResponseDTO {
  @ApiProperty({ type: () => [WeeklyMoneyFlowPointDTO] })
  weeks: WeeklyMoneyFlowPointDTO[];
}

export class SpendingBreakdownItemDTO {
  @ApiProperty({ enum: TransactionCategoryEnum })
  category: TransactionCategoryEnum;

  @ApiProperty({ type: () => Price, description: 'Total spend in category' })
  amount: Price;

  @ApiProperty({ type: Number, description: 'Percent of total spend, 0-100' })
  percent: number;
}

export class SpendingBreakdownResponseDTO {
  @ApiProperty({ type: () => [SpendingBreakdownItemDTO] })
  items: SpendingBreakdownItemDTO[];

  @ApiProperty({ type: () => Price, description: 'Total spend' })
  total: Price;
}

export class CategoryTrendItemDTO {
  @ApiProperty({ enum: TransactionCategoryEnum })
  category: TransactionCategoryEnum;

  @ApiProperty({ type: () => Price, description: 'Current month spend' })
  current: Price;

  @ApiProperty({ type: () => Price, description: 'Prior 8-week average' })
  average: Price;
}

export class CategoryTrendResponseDTO {
  @ApiProperty({ type: () => [CategoryTrendItemDTO] })
  items: CategoryTrendItemDTO[];
}
