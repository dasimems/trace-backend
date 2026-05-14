import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
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
}
