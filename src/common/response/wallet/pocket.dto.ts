import { ApiProperty } from '@nestjs/swagger';
import { WalletPocketTypeEnum } from '@prisma/client';

export class WalletPocketDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ enum: WalletPocketTypeEnum })
  type: WalletPocketTypeEnum;

  @ApiProperty({ type: Number, description: 'Balance in kobo' })
  balance: number;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Goal target in kobo, when type=GOAL',
  })
  targetAmount?: number;

  @ApiProperty({ type: Boolean })
  isDefault: boolean;

  @ApiProperty({ type: String })
  accountId: string;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}
