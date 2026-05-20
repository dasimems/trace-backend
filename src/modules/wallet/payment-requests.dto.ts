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
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePaymentRequestBodyDTO {
  @ApiProperty({
    description:
      'Amount in the major currency unit (e.g. 500 = ₦500). Decimals allowed. Min ₦100.',
    type: Number,
    example: 500,
    minimum: 100,
    maximum: 100_000_000,
  })
  @IsDefined({ message: 'Amount is required' })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Amount must be a number with up to 2 decimal places' },
  )
  @Min(100, { message: 'Amount must be at least ₦100' })
  @Max(100_000_000, {
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
