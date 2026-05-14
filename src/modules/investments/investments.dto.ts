import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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
