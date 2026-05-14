import { ApiProperty } from '@nestjs/swagger';

export class TransactionMetricsResponseDTO {
  @ApiProperty({
    type: Number,
    description: 'Inflow this month, in kobo',
  })
  inflowThisMonth: number;

  @ApiProperty({
    type: Number,
    description: 'Outflow this month, in kobo',
  })
  outflowThisMonth: number;

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
