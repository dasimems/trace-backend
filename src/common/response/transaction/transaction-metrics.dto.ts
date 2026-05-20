import { ApiProperty } from '@nestjs/swagger';
import { Price } from '@common/price/price.dto';

export class TransactionMetricsResponseDTO {
  @ApiProperty({
    type: () => Price,
    description: 'Inflow this month',
  })
  inflowThisMonth: Price;

  @ApiProperty({
    type: () => Price,
    description: 'Outflow this month',
  })
  outflowThisMonth: Price;

  @ApiProperty({
    type: Number,
    description: 'Distinct sources of inflow this month',
  })
  inflowSources: number;

  @ApiProperty({
    type: Number,
    description: 'Distinct categories of outflow this month',
  })
  outflowCategories: number;

  @ApiProperty({
    type: Number,
    description: 'Count of pending transactions',
  })
  pendingCount: number;

  @ApiProperty({
    type: Number,
    description: 'Count of failed transactions in last 30 days',
  })
  failedCount: number;
}
