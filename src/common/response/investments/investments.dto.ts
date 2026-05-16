import { ApiProperty } from '@nestjs/swagger';
import {
  InvestmentAllocationStatusEnum,
  InvestmentProductTypeEnum,
  RiskLevelEnum,
} from '@prisma/client';

export class InvestmentProductDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  provider: string;

  @ApiProperty({ enum: InvestmentProductTypeEnum })
  type: InvestmentProductTypeEnum;

  @ApiProperty({
    type: Number,
    description: 'Expected annual return in basis points (1320 = 13.2%)',
  })
  expectedReturnBps: number;

  @ApiProperty({ enum: RiskLevelEnum })
  riskLevel: RiskLevelEnum;

  @ApiProperty({ type: Number, description: 'Minimum allocation in kobo' })
  minAmount: number;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Null = open-ended (no lock-up)',
  })
  tenorDays?: number;

  @ApiProperty({ type: String })
  description: string;

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Personalized one-sentence rationale for THIS user (Claude-generated).',
  })
  aiRationale?: string;

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Prose "honest read" risk write-up. Static per product; seeded by the dev module.',
  })
  riskNarrative?: string;
}

export class InvestmentAllocationDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ type: Number, description: 'Allocated amount in kobo' })
  amount: number;

  @ApiProperty({ type: Number, description: 'Current value in kobo' })
  currentValue: number;

  @ApiProperty({ enum: InvestmentAllocationStatusEnum })
  status: InvestmentAllocationStatusEnum;

  @ApiProperty({ type: Date, required: false })
  allocatedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  withdrawnAt?: Date;

  @ApiProperty({ type: Date, required: false })
  maturesAt?: Date;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class InvestmentHoldingDTO {
  @ApiProperty({ enum: InvestmentProductTypeEnum })
  type: InvestmentProductTypeEnum;

  @ApiProperty({ type: String })
  label: string;

  @ApiProperty({ type: Number, description: 'Total value in kobo' })
  amount: number;

  @ApiProperty({ type: Number, description: 'Percent of portfolio (0-100)' })
  percent: number;
}

export class PortfolioResponseDTO {
  @ApiProperty({ type: Number, description: 'Total portfolio value in kobo' })
  totalValue: number;

  @ApiProperty({ type: Number, description: 'Total allocated in kobo' })
  totalAllocated: number;

  @ApiProperty({
    type: Number,
    description: 'Aggregate return as basis points (positive = gain)',
  })
  totalReturnBps: number;

  @ApiProperty({ type: () => [InvestmentHoldingDTO] })
  holdings: InvestmentHoldingDTO[];

  @ApiProperty({ type: () => [InvestmentAllocationDTO] })
  allocations: InvestmentAllocationDTO[];
}

export class SafeToInvestResponseDTO {
  @ApiProperty({ enum: ['ok', 'insufficient_data'] })
  status: 'ok' | 'insufficient_data';

  @ApiProperty({ type: Number, description: 'Suggested allocation in kobo' })
  suggested: number;

  @ApiProperty({
    type: Number,
    description: 'Conservative floor in kobo (10% of safe-to-save).',
  })
  conservative: number;

  @ApiProperty({
    type: Number,
    description: 'Aggressive ceiling in kobo (60% of safe-to-save).',
  })
  aggressive: number;

  @ApiProperty({ type: String })
  rationale: string;
}
