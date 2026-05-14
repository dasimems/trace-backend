import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { CategoryEnum, GenderEnum } from '@prisma/client';
import { VerificationType } from '@shared/enums/enums';
import { emailRegexp, passwordRegexp, phoneNumberRegexp } from '@shared/regex';

const toLowerCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class EmailBodyDTO {
  @ApiProperty({
    description: 'Email',
    type: String,
    example: 'jane@example.com',
    required: true,
    format: 'email',
    pattern: emailRegexp.source,
  })
  @IsString({ message: 'Please provide a valid email' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @IsDefined({ message: 'Email is required' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(toLowerCase, { toClassOnly: true })
  email: string;
}

export class SignUpBodyDTO extends EmailBodyDTO {
  @ApiProperty({
    description: 'Password',
    type: String,
    example: 'Password123!',
    required: true,
    minLength: 8,
    pattern: passwordRegexp.source,
  })
  @IsString({ message: 'Please provide a valid password' })
  @IsDefined({ message: 'Password is required' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(passwordRegexp, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;
}

export class SignInBodyDTO extends EmailBodyDTO {
  @ApiProperty({
    description: 'Password',
    type: String,
    example: 'Password123!',
    required: true,
  })
  @IsString({ message: 'Please provide a valid password' })
  @IsDefined({ message: 'Password is required' })
  @IsNotEmpty({ message: 'Password is required' })
  password: string;
}

export class CreateAccountBodyDTO {
  @ApiProperty({ description: 'First name', type: String, example: 'Jane' })
  @IsString({ message: 'Please provide a valid first name' })
  @IsDefined({ message: 'First name is required' })
  @IsNotEmpty({ message: 'First name is required' })
  @Transform(toTrimmed, { toClassOnly: true })
  firstName: string;

  @ApiProperty({ description: 'Last name', type: String, example: 'Doe' })
  @IsString({ message: 'Please provide a valid last name' })
  @IsDefined({ message: 'Last name is required' })
  @IsNotEmpty({ message: 'Last name is required' })
  @Transform(toTrimmed, { toClassOnly: true })
  lastName: string;

  @ApiProperty({ description: 'Middle name', type: String, example: 'Ada' })
  @IsString({ message: 'Please provide a valid middle name' })
  @IsDefined({ message: 'Middle name is required' })
  @IsNotEmpty({ message: 'Middle name is required' })
  @Transform(toTrimmed, { toClassOnly: true })
  middleName: string;

  @ApiProperty({
    description: 'Phone number in E.164 format',
    type: String,
    example: '+2348012345678',
    pattern: phoneNumberRegexp.source,
  })
  @IsString({ message: 'Please provide a valid phone number' })
  @IsDefined({ message: 'Phone number is required' })
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(phoneNumberRegexp, {
    message: 'Phone number must be in E.164 format (e.g. +2348012345678)',
  })
  phoneNumber: string;

  @ApiProperty({
    description: 'Date of birth (ISO 8601)',
    type: Date,
    example: '1995-06-12',
  })
  @IsDefined({ message: 'Date of birth is required' })
  @IsNotEmpty({ message: 'Date of birth is required' })
  @Type(() => Date)
  @IsDate({ message: 'Please provide a valid date of birth' })
  dateOfBirth: Date;

  @ApiProperty({ enum: GenderEnum, example: GenderEnum.FEMALE })
  @IsDefined({ message: 'Gender is required' })
  @IsEnum(GenderEnum, {
    message: `Gender must be one of: ${Object.values(GenderEnum).join(', ')}`,
  })
  gender: GenderEnum;

  @ApiProperty({
    description: 'Residential address',
    type: String,
    example: '12 Marina Road, Lagos',
  })
  @IsString({ message: 'Please provide a valid address' })
  @IsDefined({ message: 'Address is required' })
  @IsNotEmpty({ message: 'Address is required' })
  @Transform(toTrimmed, { toClassOnly: true })
  address: string;

  @ApiProperty({
    description: 'Bank Verification Number (11 digits)',
    type: String,
    example: '12345678901',
  })
  @IsString({ message: 'Please provide a valid BVN' })
  @IsDefined({ message: 'BVN is required' })
  @IsNotEmpty({ message: 'BVN is required' })
  @Length(11, 11, { message: 'BVN must be exactly 11 digits' })
  @Matches(/^\d{11}$/, { message: 'BVN must be exactly 11 digits' })
  bvn: string;

  @ApiProperty({
    description: 'National Identification Number (optional, 11 digits)',
    type: String,
    required: false,
    example: '12345678901',
  })
  @IsOptional()
  @IsString({ message: 'Please provide a valid NIN' })
  @Length(11, 11, { message: 'NIN must be exactly 11 digits' })
  @Matches(/^\d{11}$/, { message: 'NIN must be exactly 11 digits' })
  nin?: string;

  @ApiProperty({ enum: CategoryEnum, example: CategoryEnum.FREELANCER })
  @IsDefined({ message: 'Category is required' })
  @IsEnum(CategoryEnum, {
    message: `Category must be one of: ${Object.values(CategoryEnum).join(', ')}`,
  })
  category: CategoryEnum;
}

// OTP requests are restricted to user-initiated flows. ACCOUNT_CREATION is
// owned by the sign-up endpoint; CHANGE_EMAIL / CHANGE_MOBILE belong on the
// user/settings module once it exists.
const ALLOWED_OTP_TYPES = [
  VerificationType.EMAIL_VERIFICATION,
  VerificationType.FORGOT_PASSWORD,
];

export class SendOtpBodyDTO extends EmailBodyDTO {
  @ApiProperty({
    description: `OTP type. One of: ${ALLOWED_OTP_TYPES.join(', ')}`,
    enum: ALLOWED_OTP_TYPES,
    example: VerificationType.EMAIL_VERIFICATION,
  })
  @IsString()
  @IsDefined({ message: 'OTP type is required' })
  @IsIn(ALLOWED_OTP_TYPES, {
    message: `OTP type must be one of: ${ALLOWED_OTP_TYPES.join(', ')}`,
  })
  otpType: VerificationType;
}

export class VerifyOtpBodyDTO {
  @ApiProperty({
    description: 'OTP delivery token returned by /auth/otp/send.',
    type: String,
    example: 'eyJEnc...',
  })
  @IsString()
  @IsDefined({ message: 'Token is required' })
  @IsNotEmpty({ message: 'Token is required' })
  token: string;

  @ApiProperty({
    description: '6-digit OTP code',
    type: String,
    example: '123456',
  })
  @IsString()
  @IsDefined({ message: 'OTP is required' })
  @IsNotEmpty({ message: 'OTP is required' })
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp: string;

  @ApiProperty({
    description: `OTP type — must match the value used at /auth/otp/send.`,
    enum: ALLOWED_OTP_TYPES,
    example: VerificationType.EMAIL_VERIFICATION,
  })
  @IsString()
  @IsDefined({ message: 'OTP type is required' })
  @IsIn(ALLOWED_OTP_TYPES, {
    message: `OTP type must be one of: ${ALLOWED_OTP_TYPES.join(', ')}`,
  })
  otpType: VerificationType;
}

export class ResetPasswordBodyDTO {
  @ApiProperty({
    description:
      'Change-password token returned by /auth/otp/verify (FORGOT_PASSWORD).',
    type: String,
    example: 'eyJEnc...',
  })
  @IsString()
  @IsDefined({ message: 'Token is required' })
  @IsNotEmpty({ message: 'Token is required' })
  token: string;

  @ApiProperty({
    description: 'New password',
    type: String,
    minLength: 8,
    pattern: passwordRegexp.source,
    example: 'NewPassword123!',
  })
  @IsString()
  @IsDefined({ message: 'Password is required' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(passwordRegexp, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;
}

export class OAuthSignInBodyDTO {
  @ApiProperty({
    description: 'ID token issued by the OAuth provider (Google/Apple SDK).',
    type: String,
    example: 'eyJhbGciOiJSUzI1...',
  })
  @IsString()
  @IsDefined({ message: 'idToken is required' })
  @IsNotEmpty({ message: 'idToken is required' })
  idToken: string;
}
