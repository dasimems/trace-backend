import { ApiProperty } from '@nestjs/swagger';
import {
  LoanApplicationStatusEnum,
  LoanProductTypeEnum,
  LoanTierEnum,
} from '@prisma/client';

export class LoanProductDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  provider: string;

  @ApiProperty({ enum: LoanProductTypeEnum })
  type: LoanProductTypeEnum;

  @ApiProperty({
    type: Number,
    description: 'Annual interest rate in basis points (2400 = 24%)',
  })
  interestRateBps: number;

  @ApiProperty({ type: Number, description: 'Min loan amount in kobo' })
  minAmount: number;

  @ApiProperty({ type: Number, description: 'Max loan amount in kobo' })
  maxAmount: number;

  @ApiProperty({ type: Number })
  minTenorDays: number;

  @ApiProperty({ type: Number })
  maxTenorDays: number;

  @ApiProperty({ enum: LoanTierEnum })
  requiredTier: LoanTierEnum;

  @ApiProperty({ type: String })
  description: string;

  @ApiProperty({ type: Boolean, description: 'True if the user qualifies for this product' })
  eligible: boolean;
}

export class LoanTierResponseDTO {
  @ApiProperty({ enum: ['ok', 'insufficient_data'] })
  status: 'ok' | 'insufficient_data';

  @ApiProperty({ enum: LoanTierEnum })
  tier: LoanTierEnum;

  @ApiProperty({ type: Number, description: 'Composite health score 0-100' })
  healthScore: number;

  @ApiProperty({ type: Number, description: 'Maximum exposure in kobo' })
  maxExposure: number;

  @ApiProperty({ type: [String] })
  reasons: string[];
}

export class LoanAffordabilityResponseDTO {
  @ApiProperty({ type: Number, description: 'Principal in kobo' })
  principal: number;

  @ApiProperty({ type: Number, description: 'Total interest in kobo' })
  totalInterest: number;

  @ApiProperty({ type: Number, description: 'Total repayment in kobo' })
  totalRepayment: number;

  @ApiProperty({ type: Number, description: 'Daily payment in kobo' })
  dailyPayment: number;

  @ApiProperty({ type: Number, description: 'Weekly payment in kobo' })
  weeklyPayment: number;

  @ApiProperty({ type: Number })
  tenorDays: number;

  @ApiProperty({
    type: Boolean,
    description:
      'True if the daily payment is ≤30% of the user’s average daily inflow.',
  })
  isAffordable: boolean;
}

export class LoanApplicationDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ type: Number, description: 'Requested amount in kobo' })
  requestedAmount: number;

  @ApiProperty({ type: Number, required: false, description: 'Approved amount in kobo' })
  approvedAmount?: number;

  @ApiProperty({ type: Number })
  tenorDays: number;

  @ApiProperty({ enum: LoanApplicationStatusEnum })
  status: LoanApplicationStatusEnum;

  @ApiProperty({ type: String, required: false })
  rejectionReason?: string;

  @ApiProperty({ type: Date, required: false })
  decisionedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  disbursedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  dueAt?: Date;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}
