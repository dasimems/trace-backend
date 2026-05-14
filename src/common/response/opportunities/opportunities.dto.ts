import { ApiProperty } from '@nestjs/swagger';
import { OpportunitySourceEnum } from '@prisma/client';

export class OpportunityProviderDTO {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, description: 'Initials for avatar/chip' })
  initials: string;

  @ApiProperty({
    type: Boolean,
    description: 'Verified providers get a checkmark on the card.',
  })
  verified: boolean;
}

export class OpportunityStatsDTO {
  @ApiProperty({ type: String, required: false, description: 'e.g. "13.2% p.a."' })
  return?: string;

  @ApiProperty({ type: String, required: false, description: 'e.g. "Low-Med"' })
  risk?: string;

  @ApiProperty({ type: String, required: false, description: 'e.g. "₦10k" min' })
  min?: string;

  @ApiProperty({ type: String, required: false, description: 'e.g. "90 days"' })
  tenor?: string;
}

export class OpportunityDTO {
  @ApiProperty({ type: String, description: 'Source-prefixed id: "<source>:<id>"' })
  id: string;

  @ApiProperty({ enum: OpportunitySourceEnum })
  source: OpportunitySourceEnum;

  @ApiProperty({ type: String, description: 'Type label for the card chip' })
  type: string;

  @ApiProperty({ type: String })
  title: string;

  @ApiProperty({ type: String })
  description: string;

  @ApiProperty({ type: () => OpportunityProviderDTO })
  provider: OpportunityProviderDTO;

  @ApiProperty({ type: () => OpportunityStatsDTO })
  stats: OpportunityStatsDTO;

  @ApiProperty({
    type: Number,
    description: 'Match percent 0-100 against the user’s profile.',
  })
  matchPercent: number;

  @ApiProperty({
    type: Boolean,
    description: 'True if the user has saved this opportunity.',
  })
  isSaved: boolean;

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Personalized one-sentence rationale for THIS user (Claude-generated).',
  })
  aiRationale?: string;
}
