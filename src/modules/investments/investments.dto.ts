import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class NavHistoryQueryDTO {
  @ApiProperty({
    enum: ['1Y', '3Y', 'YTD'],
    required: false,
    description: 'Lookback window. Defaults to 1Y.',
  })
  @IsOptional()
  @IsIn(['1Y', '3Y', 'YTD'])
  period?: '1Y' | '3Y' | 'YTD';
}

export class DistributionsQueryDTO {
  @ApiProperty({
    type: Number,
    required: false,
    description: 'Max items to return (default 12, max 50).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AllocateBodyDTO {
  @ApiProperty({ type: String })
  @IsString()
  @IsDefined()
  @IsUUID()
  productId: string;

  @ApiProperty({ type: Number, description: 'Amount in kobo' })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amount: number;
}

export class GetAllocationsQueryDTO {
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
