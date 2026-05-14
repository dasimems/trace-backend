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

export class AffordabilityQueryDTO {
  @ApiProperty({ type: String, description: 'Loan product id' })
  @IsString()
  @IsDefined()
  @IsUUID()
  productId: string;

  @ApiProperty({ type: Number, description: 'Requested amount in kobo' })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amount: number;

  @ApiProperty({ type: Number, description: 'Tenor in days' })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  tenorDays: number;
}

export class ApplyForLoanBodyDTO {
  @ApiProperty({ type: String })
  @IsString()
  @IsDefined()
  @IsUUID()
  productId: string;

  @ApiProperty({ type: Number, description: 'Requested amount in kobo' })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  requestedAmount: number;

  @ApiProperty({ type: Number, description: 'Tenor in days' })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  tenorDays: number;
}

export class GetLoanApplicationsQueryDTO {
  @ApiProperty({ type: Number, required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ type: Number, required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
