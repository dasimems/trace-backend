import { ApiProperty } from '@nestjs/swagger';
import {
  VirtualCardBrandEnum,
  VirtualCardStatusEnum,
} from '@prisma/client';

export class VirtualCardDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: '7821', description: 'Last 4 digits' })
  last4: string;

  @ApiProperty({ enum: VirtualCardBrandEnum })
  brand: VirtualCardBrandEnum;

  @ApiProperty({ type: Number, example: 9, description: '1–12' })
  expMonth: number;

  @ApiProperty({ type: Number, example: 2029, description: '4-digit year' })
  expYear: number;

  @ApiProperty({ enum: VirtualCardStatusEnum })
  status: VirtualCardStatusEnum;

  @ApiProperty({ type: Number, description: 'Monthly spend cap in kobo' })
  spendLimitMonthly: number;

  @ApiProperty({ type: Number, description: 'Spend so far this month in kobo' })
  spentThisMonth: number;

  @ApiProperty({ type: Date })
  createdAt: Date;
}
