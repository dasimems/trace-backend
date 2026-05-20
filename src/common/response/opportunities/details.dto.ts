import { ApiProperty } from '@nestjs/swagger';
import { UploadedDocumentCategoryEnum } from '@prisma/client';
import { Price } from '@common/price/price.dto';

export class OpportunitySimulationDTO {
  @ApiProperty({ type: () => Price, description: 'Input amount' })
  inputAmount: Price;

  @ApiProperty({ type: Number })
  inputTenorDays: number;

  // Loan-side
  @ApiProperty({ type: () => Price, required: false })
  totalRepayment?: Price;

  @ApiProperty({ type: () => Price, required: false })
  totalInterest?: Price;

  @ApiProperty({ type: () => Price, required: false })
  weeklyPayment?: Price;

  @ApiProperty({ type: () => Price, required: false })
  dailyPayment?: Price;

  @ApiProperty({ type: Boolean, required: false })
  isAffordable?: boolean;

  // Investment-side
  @ApiProperty({ type: () => Price, required: false })
  projectedValue?: Price;

  @ApiProperty({ type: Number, required: false })
  projectedReturnBps?: number;

  // Grant-side
  @ApiProperty({ type: Number, required: false, description: '0–100' })
  eligibilityScore?: number;
}

export class OpportunityPersonalizedDTO {
  @ApiProperty({ type: () => Price, required: false })
  estimatedNetReceived?: Price;

  @ApiProperty({ type: () => Price, required: false })
  estimatedMonthlyCost?: Price;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Weekly inflow remaining after this commitment, 0–100',
  })
  weeklyBufferPercent?: number;

  @ApiProperty({ type: Number, description: '0–100' })
  approvalConfidencePercent: number;

  @ApiProperty({
    type: String,
    description: 'AI-generated headline rationale for this user + product.',
  })
  oneLiner: string;
}

export class CostBreakdownItemDTO {
  @ApiProperty({ type: String })
  label: string;

  @ApiProperty({ type: () => Price })
  amount: Price;

  @ApiProperty({ type: Boolean })
  recurring: boolean;
}

export class CostBreakdownResponseDTO {
  @ApiProperty({ type: () => [CostBreakdownItemDTO] })
  items: CostBreakdownItemDTO[];

  @ApiProperty({ type: () => Price })
  totalUpfront: Price;

  @ApiProperty({ type: () => Price, description: 'Per cycle' })
  totalRecurring: Price;

  @ApiProperty({
    enum: ['WEEKLY', 'MONTHLY', 'DAILY'],
    required: false,
  })
  cycle?: 'WEEKLY' | 'MONTHLY' | 'DAILY';
}

export class RequiredDocumentDTO {
  @ApiProperty({ type: String, example: 'drivers_license' })
  id: string;

  @ApiProperty({ type: String })
  label: string;

  @ApiProperty({ type: String })
  description: string;

  @ApiProperty({ type: Boolean })
  required: boolean;

  @ApiProperty({ enum: UploadedDocumentCategoryEnum })
  category: UploadedDocumentCategoryEnum;

  @ApiProperty({
    type: Boolean,
    description: 'True if the requesting user has uploaded this doc.',
  })
  uploaded: boolean;
}

export class DocumentsResponseDTO {
  @ApiProperty({ type: () => [RequiredDocumentDTO] })
  documents: RequiredDocumentDTO[];
}

export class FaqEntryDTO {
  @ApiProperty({ type: String })
  question: string;

  @ApiProperty({ type: String })
  answer: string;
}

export class FaqResponseDTO {
  @ApiProperty({ type: () => [FaqEntryDTO] })
  entries: FaqEntryDTO[];
}
