import { ApiProperty } from '@nestjs/swagger';
import {
  PaymentRequestKindEnum,
  PaymentRequestStatusEnum,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePaymentRequestBodyDTO {
  @ApiProperty({
    description: 'Amount in KOBO. Min ₦100.',
    type: Number,
    example: 50000,
    minimum: 10_000,
    maximum: 100_000_000_00,
  })
  @IsDefined({ message: 'Amount is required' })
  @IsInt({ message: 'Amount must be an integer (in kobo)' })
  @Min(10_000, { message: 'Amount must be at least ₦100 (10,000 kobo)' })
  @Max(100_000_000_00, {
    message: 'Amount cannot exceed ₦100,000,000 per request',
  })
  amount: number;

  @ApiProperty({
    description:
      "What this is for. Shown on the hosted checkout page and the user's history. Max 200 chars.",
    type: String,
    required: false,
    example: 'October rent contribution',
  })
  @IsOptional()
  @IsString()
  @Transform(toTrimmed, { toClassOnly: true })
  description?: string;

  @ApiProperty({
    description:
      "URL the payer is redirected back to after paying. For FUND it deep-links into the user's own app; for REQUEST it can be any landing page.",
    type: String,
    required: false,
    example: 'https://app.trace.ng/wallet/fund/callback',
  })
  @IsOptional()
  @IsString()
  @Transform(toTrimmed, { toClassOnly: true })
  callbackUrl?: string;

  @ApiProperty({
    description:
      'Optional ISO-8601 expiry. After this point the link can no longer be paid. Useful for REQUEST links you want time-limited.',
    type: String,
    required: false,
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class GetPaymentRequestsQueryDTO {
  @ApiProperty({ enum: PaymentRequestKindEnum, required: false })
  @IsOptional()
  @IsEnum(PaymentRequestKindEnum)
  kind?: PaymentRequestKindEnum;

  @ApiProperty({ enum: PaymentRequestStatusEnum, required: false })
  @IsOptional()
  @IsEnum(PaymentRequestStatusEnum)
  status?: PaymentRequestStatusEnum;

  @ApiProperty({ type: Number, required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ type: Number, required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
