import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SeedTransactionsBodyDTO {
  @ApiProperty({
    type: Number,
    description: 'Days of synthetic history to generate (1–365).',
    required: false,
    example: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiProperty({
    type: Boolean,
    description: 'If true, wipe existing transactions for this user first.',
    required: false,
    example: false,
  })
  @IsOptional()
  reset?: boolean;
}
