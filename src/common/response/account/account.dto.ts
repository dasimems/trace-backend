import { ApiProperty } from '@nestjs/swagger';
import { BankAccountProviderEnum } from '@prisma/client';

export class BankAccountResponseDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: '7834927713' })
  accountNumber: string;

  @ApiProperty({ type: String, example: 'Joseph Ayodele' })
  accountName: string;

  @ApiProperty({ type: String, example: '058' })
  bankCode: string;

  @ApiProperty({ type: String, example: 'trace_3f8a2c91' })
  customerIdentifier: string;

  @ApiProperty({ type: String, required: false, example: '4920299492' })
  beneficiaryAccount?: string;

  @ApiProperty({ enum: BankAccountProviderEnum, example: BankAccountProviderEnum.SQUAD })
  provider: BankAccountProviderEnum;

  @ApiProperty({ type: Number, example: 0 })
  balance: number;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export interface BankAccountDBDto {
  id: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  customerIdentifier: string;
  beneficiaryAccount?: string | null;
  provider: BankAccountProviderEnum;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}
