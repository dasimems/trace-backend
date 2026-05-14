import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { CategoryEnum, GenderEnum } from '@prisma/client';
import { passwordRegexp, phoneNumberRegexp } from '@shared/regex';

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Profile fields the user can change post-onboarding. Identity fields (BVN,
// NIN, DOB) are locked once set — they bind the Squad virtual account and
// changing them requires re-running KYC, which lives in a separate flow.
export class UpdateUserBodyDTO {
  @ApiProperty({ type: String, required: false, example: 'Jane' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(toTrimmed, { toClassOnly: true })
  firstName?: string;

  @ApiProperty({ type: String, required: false, example: 'Doe' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(toTrimmed, { toClassOnly: true })
  lastName?: string;

  @ApiProperty({ type: String, required: false, example: 'Ada' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(toTrimmed, { toClassOnly: true })
  middleName?: string;

  @ApiProperty({
    type: String,
    required: false,
    example: '+2348012345678',
    pattern: phoneNumberRegexp.source,
  })
  @IsOptional()
  @IsString()
  @Matches(phoneNumberRegexp, {
    message: 'Phone number must be in E.164 format (e.g. +2348012345678)',
  })
  phoneNumber?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(toTrimmed, { toClassOnly: true })
  address?: string;

  @ApiProperty({ enum: GenderEnum, required: false })
  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @ApiProperty({ enum: CategoryEnum, required: false })
  @IsOptional()
  @IsEnum(CategoryEnum)
  category?: CategoryEnum;

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Locked once the user has completed Squad account creation.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date;
}

export class ChangePasswordBodyDTO {
  @ApiProperty({ type: String })
  @IsString()
  @IsDefined({ message: 'Current password is required' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({
    type: String,
    minLength: 8,
    pattern: passwordRegexp.source,
    example: 'NewPassword123!',
  })
  @IsString()
  @IsDefined({ message: 'New password is required' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(passwordRegexp, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  newPassword: string;
}
