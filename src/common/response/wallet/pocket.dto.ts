import { ApiProperty } from '@nestjs/swagger';
import { WalletPocketTypeEnum } from '@prisma/client';
import { Price } from '@common/price/price.dto';

export class WalletPocketDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ enum: WalletPocketTypeEnum })
  type: WalletPocketTypeEnum;

  @ApiProperty({ type: () => Price, description: 'Pocket balance' })
  balance: Price;

  @ApiProperty({
    type: () => Price,
    required: false,
    description: 'Goal target, when type=GOAL',
  })
  targetAmount?: Price;

  @ApiProperty({ type: Boolean })
  isDefault: boolean;

  @ApiProperty({ type: String })
  accountId: string;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}
