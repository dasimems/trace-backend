import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class WeeksQueryDTO {
  @ApiProperty({
    description: 'Number of weeks of history to return (1–52)',
    type: Number,
    required: false,
    example: 8,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'weeks must be an integer' })
  @Min(1, { message: 'weeks must be at least 1' })
  @Max(52, { message: 'weeks cannot exceed 52' })
  weeks?: number;
}
