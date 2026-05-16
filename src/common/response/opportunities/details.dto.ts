import { ApiProperty } from '@nestjs/swagger';
import { UploadedDocumentCategoryEnum } from '@prisma/client';

export class OpportunitySimulationDTO {
  @ApiProperty({ type: Number, description: 'Input amount in kobo' })
  inputAmount: number;

  @ApiProperty({ type: Number })
  inputTenorDays: number;

  // Loan-side
  @ApiProperty({ type: Number, required: false })
  totalRepayment?: number;

  @ApiProperty({ type: Number, required: false })
  totalInterest?: number;

  @ApiProperty({ type: Number, required: false })
  weeklyPayment?: number;

  @ApiProperty({ type: Number, required: false })
  dailyPayment?: number;

  @ApiProperty({ type: Boolean, required: false })
  isAffordable?: boolean;

  // Investment-side
  @ApiProperty({ type: Number, required: false })
  projectedValue?: number;

  @ApiProperty({ type: Number, required: false })
  projectedReturnBps?: number;

  // Grant-side
  @ApiProperty({ type: Number, required: false, description: '0–100' })
  eligibilityScore?: number;
}

export class OpportunityPersonalizedDTO {
  @ApiProperty({ type: Number, required: false, description: 'Kobo' })
  estimatedNetReceived?: number;

  @ApiProperty({ type: Number, required: false, description: 'Kobo' })
  estimatedMonthlyCost?: number;

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

  @ApiProperty({ type: Number, description: 'Kobo' })
  amount: number;

  @ApiProperty({ type: Boolean })
  recurring: boolean;
}

export class CostBreakdownResponseDTO {
  @ApiProperty({ type: () => [CostBreakdownItemDTO] })
  items: CostBreakdownItemDTO[];

  @ApiProperty({ type: Number, description: 'Kobo' })
  totalUpfront: number;

  @ApiProperty({ type: Number, description: 'Kobo per cycle' })
  totalRecurring: number;

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
