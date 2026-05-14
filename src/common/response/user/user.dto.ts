import { ApiProperty } from '@nestjs/swagger';
import {
  CategoryEnum,
  GenderEnum,
  RoleEnum,
} from '@prisma/client';
import { BankAccountDBDto, BankAccountResponseDTO } from '../account/account.dto';

export class UserDetailsResponseDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, required: false })
  email?: string;

  @ApiProperty({ type: String, required: false })
  name?: string;

  @ApiProperty({ type: String, required: false })
  firstName?: string;

  @ApiProperty({ type: String, required: false })
  lastName?: string;

  @ApiProperty({ type: String, required: false })
  middleName?: string;

  @ApiProperty({ type: String, required: false })
  phoneNumber?: string;

  @ApiProperty({ type: String, required: false })
  bvn?: string;

  @ApiProperty({ type: String, required: false })
  nin?: string;

  @ApiProperty({ type: String, required: false })
  address?: string;

  @ApiProperty({ enum: GenderEnum, required: false })
  gender?: GenderEnum;

  @ApiProperty({ enum: CategoryEnum, required: false })
  category?: CategoryEnum;

  @ApiProperty({ enum: RoleEnum, required: false })
  role?: RoleEnum;

  @ApiProperty({ type: Date, required: false })
  dateOfBirth?: Date;

  @ApiProperty({ type: Boolean, required: false })
  isEmailVerified?: boolean;

  @ApiProperty({ type: Boolean, required: false })
  isPhoneNumberVerified?: boolean;

  @ApiProperty({ type: Boolean, required: false })
  isAccountCreationCompleted?: boolean;

  @ApiProperty({ type: Date, required: false })
  createdAt?: Date;

  @ApiProperty({ type: () => [BankAccountResponseDTO], required: false })
  bankAccounts?: BankAccountResponseDTO[];
}

export interface UserDetailsDBDto {
  id: string;
  email?: string;
  password?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  middleName?: string | null;
  phoneNumber?: string | null;
  bvn?: string | null;
  nin?: string | null;
  address?: string | null;
  gender?: GenderEnum | null;
  category?: CategoryEnum | null;
  role?: RoleEnum;
  dateOfBirth?: Date | null;
  isEmailVerified?: boolean;
  isPhoneNumberVerified?: boolean;
  isAccountCreationCompleted?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  bankAccounts?: BankAccountDBDto[];
}
