import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { VirtualCardBrandEnum } from '@prisma/client';

export class CreateVirtualCardBodyDTO {
  @ApiProperty({
    enum: VirtualCardBrandEnum,
    required: false,
    description: 'Brand. Defaults to VERVE (most common Nigerian card brand).',
  })
  @IsOptional()
  @IsEnum(VirtualCardBrandEnum)
  brand?: VirtualCardBrandEnum;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Monthly spend cap in kobo. Defaults to ₦200,000.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  spendLimitMonthly?: number;
}
