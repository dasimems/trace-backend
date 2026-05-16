import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { OpportunitySourceEnum } from '@prisma/client';

export class SimulateQueryDTO {
  @ApiProperty({
    type: Number,
    description: 'Amount in kobo for the simulation.',
  })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amount: number;

  @ApiProperty({
    type: Number,
    description: 'Tenor in days (only used for loans).',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  tenorDays?: number;
}

export class GetOpportunitiesQueryDTO {
  @ApiProperty({
    enum: OpportunitySourceEnum,
    required: false,
    description: 'Filter to a single source (LOAN / INVESTMENT / GRANT).',
  })
  @IsOptional()
  @IsEnum(OpportunitySourceEnum)
  source?: OpportunitySourceEnum;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Minimum match percent (0-100).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minMatch?: number;

  @ApiProperty({ type: String, required: false, description: 'Free-text query' })
  @IsOptional()
  @IsString()
  q?: string;
}
