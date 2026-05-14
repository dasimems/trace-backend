import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CopilotRoleEnum } from '@prisma/client';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SendCopilotMessageBodyDTO {
  @ApiProperty({
    type: String,
    description: 'User message — max 2000 chars.',
    example: 'How am I doing this month?',
    maxLength: 2000,
  })
  @IsString()
  @IsDefined()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(toTrimmed, { toClassOnly: true })
  content: string;
}

export class GetCopilotMessagesQueryDTO {
  @ApiProperty({ type: Number, required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ type: Number, required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class CopilotMessageDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: CopilotRoleEnum })
  role: CopilotRoleEnum;

  @ApiProperty({ type: String })
  content: string;

  @ApiProperty({ type: Date })
  createdAt: Date;
}
