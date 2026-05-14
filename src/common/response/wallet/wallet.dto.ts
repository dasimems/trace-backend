import { ApiProperty } from '@nestjs/swagger';
import { BankAccountResponseDTO } from '../account/account.dto';

export class WalletBalanceDTO {
  @ApiProperty({ type: Number, description: 'Available balance in kobo' })
  available: number;

  @ApiProperty({ type: Number, description: 'Ledger balance in kobo' })
  ledger: number;

  @ApiProperty({ type: Number, description: 'Pending balance in kobo' })
  pending: number;

  @ApiProperty({ type: Number, description: 'Inflow today, in kobo' })
  todayInflow: number;

  @ApiProperty({ type: Number, description: 'Outflow today, in kobo' })
  todayOutflow: number;
}

export class WalletResponseDTO {
  @ApiProperty({ type: () => BankAccountResponseDTO })
  account: BankAccountResponseDTO;

  @ApiProperty({ type: () => WalletBalanceDTO })
  balance: WalletBalanceDTO;
}

export class RecentRecipientDTO {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  accountNumber: string;

  @ApiProperty({ type: String, required: false })
  bankCode?: string;

  @ApiProperty({ type: String, required: false })
  bankName?: string;

  @ApiProperty({ type: Date })
  lastUsedAt: Date;
}

export class TransferLookupResponseDTO {
  @ApiProperty({ type: String })
  accountNumber: string;

  @ApiProperty({ type: String })
  accountName: string;

  @ApiProperty({ type: String })
  bankCode: string;
}
