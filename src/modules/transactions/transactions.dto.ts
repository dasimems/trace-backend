import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  TransactionCategoryEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
} from '@prisma/client';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GetTransactionsQueryDTO {
  @ApiProperty({
    description: 'Page number (1-indexed)',
    type: Number,
    example: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiProperty({
    description: 'Items per page (max 100)',
    type: Number,
    example: 20,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  limit?: number;

  @ApiProperty({
    description: 'Filter to CREDIT or DEBIT',
    enum: TransactionDirectionEnum,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionDirectionEnum)
  direction?: TransactionDirectionEnum;

  @ApiProperty({
    description: 'Filter by status',
    enum: TransactionStatusEnum,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionStatusEnum)
  status?: TransactionStatusEnum;

  @ApiProperty({
    description: 'Filter by category',
    enum: TransactionCategoryEnum,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionCategoryEnum)
  category?: TransactionCategoryEnum;

  @ApiProperty({
    description: 'Filter from this date (ISO 8601)',
    type: Date,
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'startDate must be a valid date' })
  startDate?: Date;

  @ApiProperty({
    description: 'Filter up to this date (ISO 8601, inclusive)',
    type: Date,
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endDate must be a valid date' })
  endDate?: Date;

  @ApiProperty({
    description: 'Free-text search over description, merchant, reference',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(toTrimmed, { toClassOnly: true })
  q?: string;
}
