import { ApiProperty } from '@nestjs/swagger';
import { Price } from '@common/price/price.dto';

export type Tone = 'good' | 'lime' | 'info' | 'warn' | 'bad';

export class CopilotContextTagDTO {
  @ApiProperty({ type: String })
  label: string;

  @ApiProperty({ enum: ['good', 'lime', 'info', 'warn', 'bad'] })
  tone: Tone;
}

export class CopilotContextRecommendationDTO {
  @ApiProperty({ type: String })
  title: string;

  @ApiProperty({ type: String })
  detail: string;

  @ApiProperty({ type: () => CopilotContextTagDTO })
  tag: CopilotContextTagDTO;
}

export class CopilotContextObligationDTO {
  @ApiProperty({ type: String, example: 'Loan repayment · Mon' })
  label: string;

  @ApiProperty({ type: () => Price, description: 'Amount due' })
  amount: Price;

  @ApiProperty({ type: Date })
  dueAt: Date;
}

export class CopilotContextResponseDTO {
  @ApiProperty({ type: Number, description: '0–100' })
  healthScore: number;

  @ApiProperty({ enum: ['good', 'lime', 'info', 'warn', 'bad'] })
  healthTone: Tone;

  @ApiProperty({
    type: String,
    description: 'First bullet from the weekly summary',
  })
  weeklySummaryHeadline: string;

  @ApiProperty({
    type: () => CopilotContextRecommendationDTO,
    nullable: true,
    required: false,
  })
  topRecommendation: CopilotContextRecommendationDTO | null;

  @ApiProperty({ type: () => [CopilotContextObligationDTO] })
  upcomingObligations: CopilotContextObligationDTO[];

  @ApiProperty({
    type: Number,
    description: 'Percent of weekly inflow currently uncommitted (0–100)',
  })
  liveBufferPercent: number;
}
