import { ApiProperty } from '@nestjs/swagger';
import {
  VirtualCardBrandEnum,
  VirtualCardStatusEnum,
} from '@prisma/client';
import { Price } from '@common/price/price.dto';

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

  @ApiProperty({ type: () => Price, description: 'Monthly spend cap' })
  spendLimitMonthly: Price;

  @ApiProperty({ type: () => Price, description: 'Spend so far this month' })
  spentThisMonth: Price;

  @ApiProperty({ type: Date })
  createdAt: Date;
}
