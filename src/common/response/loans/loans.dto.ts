import { ApiProperty } from '@nestjs/swagger';
import {
  LoanApplicationStatusEnum,
  LoanProductTypeEnum,
  LoanRepaymentStatusEnum,
  LoanTierEnum,
} from '@prisma/client';
import { Price } from '@common/price/price.dto';

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

  @ApiProperty({ type: () => Price, description: 'Min loan amount' })
  minAmount: Price;

  @ApiProperty({ type: () => Price, description: 'Max loan amount' })
  maxAmount: Price;

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

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Personalized one-sentence rationale for THIS user (Claude-generated). Absent when ANTHROPIC_API_KEY is unset.',
  })
  aiRationale?: string;
}

export class LoanTierResponseDTO {
  @ApiProperty({ enum: ['ok', 'insufficient_data'] })
  status: 'ok' | 'insufficient_data';

  @ApiProperty({ enum: LoanTierEnum })
  tier: LoanTierEnum;

  @ApiProperty({ type: Number, description: 'Composite health score 0-100' })
  healthScore: number;

  @ApiProperty({ type: () => Price, description: 'Maximum exposure' })
  maxExposure: Price;

  @ApiProperty({ type: [String] })
  reasons: string[];
}

export class LoanAffordabilityResponseDTO {
  @ApiProperty({ type: () => Price, description: 'Principal' })
  principal: Price;

  @ApiProperty({ type: () => Price, description: 'Total interest' })
  totalInterest: Price;

  @ApiProperty({ type: () => Price, description: 'Total repayment' })
  totalRepayment: Price;

  @ApiProperty({ type: () => Price, description: 'Daily payment' })
  dailyPayment: Price;

  @ApiProperty({ type: () => Price, description: 'Weekly payment' })
  weeklyPayment: Price;

  @ApiProperty({ type: Number })
  tenorDays: number;

  @ApiProperty({
    type: Boolean,
    description:
      'True if the daily payment is ≤30% of the user’s average daily inflow.',
  })
  isAffordable: boolean;
}

export class LoanRepaymentDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: Number, description: '1-based installment index' })
  sequence: number;

  @ApiProperty({ type: Date })
  dueAt: Date;

  @ApiProperty({ type: () => Price, description: 'Principal portion' })
  principalAmount: Price;

  @ApiProperty({ type: () => Price, description: 'Interest portion' })
  interestAmount: Price;

  @ApiProperty({ type: () => Price, description: 'Total planned for this installment' })
  totalAmount: Price;

  @ApiProperty({ type: () => Price, description: 'Amount already swept' })
  paidAmount: Price;

  @ApiProperty({ type: () => Price, description: 'Remaining owed' })
  outstandingAmount: Price;

  @ApiProperty({ enum: LoanRepaymentStatusEnum })
  status: LoanRepaymentStatusEnum;

  @ApiProperty({ type: Date, required: false })
  paidAt?: Date;
}

export class LoanScheduleResponseDTO {
  @ApiProperty({ type: String })
  applicationId: string;

  @ApiProperty({ enum: LoanApplicationStatusEnum })
  status: LoanApplicationStatusEnum;

  @ApiProperty({ type: () => Price, description: 'Disbursed principal' })
  principal: Price;

  @ApiProperty({ type: () => Price, description: 'Total interest' })
  totalInterest: Price;

  @ApiProperty({ type: () => Price, description: 'Principal + interest' })
  totalRepayment: Price;

  @ApiProperty({ type: () => Price, description: 'Sum of paid amounts across installments' })
  totalPaid: Price;

  @ApiProperty({ type: () => Price, description: 'Remaining outstanding across the loan' })
  totalOutstanding: Price;

  @ApiProperty({ type: Date, required: false })
  disbursedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  finalDueAt?: Date;

  @ApiProperty({ type: Date, required: false })
  repaidAt?: Date;

  @ApiProperty({ type: () => [LoanRepaymentDTO] })
  installments: LoanRepaymentDTO[];
}

export class LoanApplicationDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ type: () => Price, description: 'Requested amount' })
  requestedAmount: Price;

  @ApiProperty({ type: () => Price, required: false, description: 'Approved amount' })
  approvedAmount?: Price;

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
