import { ApiProperty } from '@nestjs/swagger';
import {
  PaymentRequestKindEnum,
  PaymentRequestStatusEnum,
} from '@prisma/client';
import { Price } from '@common/price/price.dto';
import { BankAccountResponseDTO } from '../account/account.dto';

export class WalletBalanceDTO {
  @ApiProperty({ type: () => Price, description: 'Available balance' })
  available: Price;

  @ApiProperty({ type: () => Price, description: 'Ledger balance' })
  ledger: Price;

  @ApiProperty({ type: () => Price, description: 'Pending balance' })
  pending: Price;

  @ApiProperty({ type: () => Price, description: 'Inflow today' })
  todayInflow: Price;

  @ApiProperty({ type: () => Price, description: 'Outflow today' })
  todayOutflow: Price;
}

export class WalletResponseDTO {
  @ApiProperty({ type: () => BankAccountResponseDTO })
  account: BankAccountResponseDTO;

  @ApiProperty({ type: () => WalletBalanceDTO })
  balance: WalletBalanceDTO;
}

export class FundAccountResponseDTO {
  @ApiProperty({
    type: String,
    description:
      'Hosted checkout URL — redirect the user here to complete the payment.',
    example: 'https://sandbox-pay.squadco.com/abc123',
  })
  checkoutUrl: string;

  @ApiProperty({
    type: String,
    description:
      'Local transaction reference. Use it to call GET /wallet/fund/:reference and to match SSE wallet.fund.received events.',
    example: 'trace-fund-1a2b3c4d5e6f',
  })
  reference: string;

  @ApiProperty({ type: () => Price, description: 'Requested amount' })
  amount: Price;

  @ApiProperty({
    type: String,
    description: 'Currency code — always NGN for the moment.',
    example: 'NGN',
  })
  currency: string;
}

export class PaymentRequestDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, description: 'Local reference — use this to verify/cancel.' })
  reference: string;

  @ApiProperty({ type: String, required: false, description: "Squad's gateway_ref once known." })
  gatewayRef?: string;

  @ApiProperty({ enum: PaymentRequestKindEnum, description: 'FUND = self top-up. REQUEST = link shared with someone else.' })
  kind: PaymentRequestKindEnum;

  @ApiProperty({ type: () => Price, description: 'Requested amount' })
  amount: Price;

  @ApiProperty({ type: String, example: 'NGN' })
  currency: string;

  @ApiProperty({ enum: PaymentRequestStatusEnum })
  status: PaymentRequestStatusEnum;

  @ApiProperty({ type: String, required: false })
  description?: string;

  @ApiProperty({
    type: String,
    description:
      'Hosted Squad checkout URL. Redirect (FUND) or share (REQUEST).',
  })
  checkoutUrl: string;

  @ApiProperty({ type: String, required: false })
  callbackUrl?: string;

  @ApiProperty({ type: String, required: false, description: "How it was paid: 'card', 'bank', etc." })
  paymentType?: string;

  @ApiProperty({ type: String, required: false })
  paidByEmail?: string;

  @ApiProperty({ type: String, required: false })
  paidByName?: string;

  @ApiProperty({ type: Date, required: false })
  paidAt?: Date;

  @ApiProperty({ type: Date, required: false })
  expiresAt?: Date;

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Resulting CREDIT transaction id, once the payment lands and we credit the user.',
  })
  transactionId?: string;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class BankDTO {
  @ApiProperty({
    type: String,
    description: 'NIP institution code (e.g. "058" for GTBank)',
    example: '058',
  })
  code: string;

  @ApiProperty({
    type: String,
    description: 'Bank name as supplied by Squad',
    example: 'GTBank Plc',
  })
  name: string;
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
