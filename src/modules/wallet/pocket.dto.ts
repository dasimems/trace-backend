import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { WalletPocketTypeEnum } from '@prisma/client';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePocketBodyDTO {
  @ApiProperty({ type: String, example: 'Lagos store' })
  @IsString()
  @IsDefined()
  @IsNotEmpty()
  @Transform(toTrimmed, { toClassOnly: true })
  name: string;

  @ApiProperty({ enum: WalletPocketTypeEnum, example: WalletPocketTypeEnum.GOAL })
  @IsDefined()
  @IsEnum(WalletPocketTypeEnum)
  type: WalletPocketTypeEnum;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Target amount in kobo (only meaningful for GOAL pockets).',
    example: 50000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetAmount?: number;
}

export class UpdatePocketBodyDTO {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(toTrimmed, { toClassOnly: true })
  name?: string;

  @ApiProperty({ type: Number, required: false, description: 'Target in kobo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetAmount?: number;
}

export class TransferBetweenPocketsBodyDTO {
  @ApiProperty({ type: String, description: 'Source pocket id' })
  @IsString()
  @IsDefined()
  @IsUUID()
  fromPocketId: string;

  @ApiProperty({ type: String, description: 'Destination pocket id' })
  @IsString()
  @IsDefined()
  @IsUUID()
  toPocketId: string;

  @ApiProperty({ type: Number, description: 'Amount in kobo', example: 50000 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amount: number;
}

export class AllocateToPocketBodyDTO {
  @ApiProperty({ type: Number, description: 'Amount in kobo to move from unallocated balance into this pocket' })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amount: number;
}
