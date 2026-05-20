import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
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
    description:
      'Monthly spend cap in the major currency unit. Defaults to ₦200,000.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  spendLimitMonthly?: number;
}
