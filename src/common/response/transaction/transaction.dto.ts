import { ApiProperty } from '@nestjs/swagger';
import {
  BankAccountProviderEnum,
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';
import { Price } from '@common/price/price.dto';

export class TransactionResponseDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'TR-889423' })
  reference: string;

  @ApiProperty({ type: String, required: false, example: 'NIP-1100592...' })
  providerReference?: string;

  @ApiProperty({ enum: TransactionDirectionEnum })
  direction: TransactionDirectionEnum;

  @ApiProperty({ enum: TransactionStatusEnum })
  status: TransactionStatusEnum;

  @ApiProperty({ enum: TransactionCategoryEnum })
  category: TransactionCategoryEnum;

  @ApiProperty({ type: String, required: false })
  description?: string;

  @ApiProperty({ type: () => Price, description: 'Transaction amount' })
  amount: Price;

  @ApiProperty({ type: () => Price, description: 'Fee charged' })
  fee: Price;

  @ApiProperty({ type: () => Price, required: false })
  principalAmount?: Price;

  @ApiProperty({ type: () => Price, required: false })
  settledAmount?: Price;

  @ApiProperty({ type: String, example: 'NGN' })
  currency: string;

  @ApiProperty({ type: String, required: false })
  senderName?: string;

  @ApiProperty({ type: String, required: false })
  senderAccountNumber?: string;

  @ApiProperty({ type: String, required: false })
  senderBankCode?: string;

  @ApiProperty({ type: String, required: false })
  senderBankName?: string;

  @ApiProperty({ type: String, required: false })
  recipientName?: string;

  @ApiProperty({ type: String, required: false })
  recipientAccountNumber?: string;

  @ApiProperty({ type: String, required: false })
  recipientBankCode?: string;

  @ApiProperty({ type: String, required: false })
  recipientBankName?: string;

  @ApiProperty({ type: String, required: false })
  remark?: string;

  @ApiProperty({ enum: BankAccountProviderEnum })
  provider: BankAccountProviderEnum;

  @ApiProperty({ type: String, example: 'uuid' })
  accountId: string;

  @ApiProperty({ type: Date, required: false })
  processedAt?: Date;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export interface TransactionDBDto {
  id: string;
  reference: string;
  providerReference?: string | null;
  direction: TransactionDirectionEnum;
  status: TransactionStatusEnum;
  category: TransactionCategoryEnum;
  description?: string | null;
  amount: number;
  fee: number;
  principalAmount?: number | null;
  settledAmount?: number | null;
  currency: string;
  senderName?: string | null;
  senderAccountNumber?: string | null;
  senderBankCode?: string | null;
  senderBankName?: string | null;
  recipientName?: string | null;
  recipientAccountNumber?: string | null;
  recipientBankCode?: string | null;
  recipientBankName?: string | null;
  remark?: string | null;
  provider: BankAccountProviderEnum;
  accountId: string;
  userId: string;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
