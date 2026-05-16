import { ApiProperty } from '@nestjs/swagger';
import { TransactionCategoryEnum } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class LookupAccountBodyDTO {
  @ApiProperty({
    description: 'NIP institution code (e.g. 058 for GTBank)',
    type: String,
    example: '058',
  })
  @IsString()
  @IsDefined({ message: 'Bank code is required' })
  @IsNotEmpty({ message: 'Bank code is required' })
  @Transform(toTrimmed, { toClassOnly: true })
  bankCode: string;

  @ApiProperty({
    description: '10-digit NUBAN account number',
    type: String,
    example: '0123456789',
  })
  @IsString()
  @IsDefined({ message: 'Account number is required' })
  @IsNotEmpty({ message: 'Account number is required' })
  @Length(10, 10, { message: 'Account number must be 10 digits' })
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;
}

export class TransferBodyDTO {
  @ApiProperty({
    description: 'NIP institution code (e.g. 058 for GTBank)',
    type: String,
    example: '058',
  })
  @IsString()
  @IsDefined({ message: 'Bank code is required' })
  @IsNotEmpty({ message: 'Bank code is required' })
  bankCode: string;

  @ApiProperty({
    description: '10-digit NUBAN account number',
    type: String,
    example: '0123456789',
  })
  @IsString()
  @IsDefined({ message: 'Account number is required' })
  @IsNotEmpty({ message: 'Account number is required' })
  @Length(10, 10, { message: 'Account number must be 10 digits' })
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  @ApiProperty({
    description: 'Recipient account name (from lookup)',
    type: String,
    example: 'WILLIAM UDOUSORO',
  })
  @IsString()
  @IsDefined({ message: 'Account name is required' })
  @IsNotEmpty({ message: 'Account name is required' })
  @Transform(toTrimmed, { toClassOnly: true })
  accountName: string;

  @ApiProperty({
    description: 'Amount to transfer, in kobo (e.g. 10000 = ₦100)',
    type: Number,
    example: 10000,
    minimum: 100,
    maximum: 1_000_000_00,
  })
  @IsDefined({ message: 'Amount is required' })
  @IsInt({ message: 'Amount must be an integer (in kobo)' })
  @Min(100, { message: 'Amount must be at least ₦1 (100 kobo)' })
  @Max(1_000_000_00, {
    message: 'Amount cannot exceed ₦1,000,000 per transfer',
  })
  amount: number;

  @ApiProperty({
    description: 'Optional remark sent with the transfer',
    type: String,
    required: false,
    example: 'Lunch money',
  })
  @IsOptional()
  @IsString()
  @Transform(toTrimmed, { toClassOnly: true })
  remark?: string;

  @ApiProperty({
    description:
      "Optional. What this transfer is for. When omitted, the server infers from the recipient (e.g. Chowdeck → FOOD_AND_DINING) and falls back to TRANSFER.",
    enum: TransactionCategoryEnum,
    required: false,
    example: TransactionCategoryEnum.FOOD_AND_DINING,
  })
  @IsOptional()
  @IsEnum(TransactionCategoryEnum, {
    message: 'category must be a valid TransactionCategoryEnum value',
  })
  category?: TransactionCategoryEnum;
}

export class FundAccountBodyDTO {
  @ApiProperty({
    description: 'Amount to fund in KOBO (₦1 = 100 kobo). Min ₦100.',
    type: Number,
    example: 50000,
    minimum: 10_000,
    maximum: 100_000_000_00,
  })
  @IsDefined({ message: 'Amount is required' })
  @IsInt({ message: 'Amount must be an integer (in kobo)' })
  @Min(10_000, { message: 'Amount must be at least ₦100 (10,000 kobo)' })
  @Max(100_000_000_00, {
    message: 'Amount cannot exceed ₦100,000,000 per top-up',
  })
  amount: number;

  @ApiProperty({
    description:
      "URL the user is redirected back to after paying at Squad's hosted page. Should be a deep link into your frontend (e.g. https://app.trace.ng/wallet/fund/callback).",
    type: String,
    required: false,
    example: 'https://app.trace.ng/wallet/fund/callback',
  })
  @IsOptional()
  @IsString()
  @Transform(toTrimmed, { toClassOnly: true })
  callbackUrl?: string;
}
