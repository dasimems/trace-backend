import { PriceService } from '@common/price/price.service';
import { PaginationDetailsDTO } from '../base.dto';
import BaseResponse from '../base.response';
import AccountResponse from '../account/account.response';
import { UserDetailsDBDto, UserDetailsResponseDTO } from './user.dto';

type ResponseType = UserDetailsResponseDTO | UserDetailsResponseDTO[];

// Mask the middle of a sensitive identifier so the user can still recognize
// their own value (first 3 / last 2 digits) without exposing the full number.
// e.g. "12345678901" → "123******01". Short/invalid values are fully masked.
function maskSensitiveId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 5) return '*'.repeat(value.length);
  const head = value.slice(0, 3);
  const tail = value.slice(-2);
  return `${head}${'*'.repeat(value.length - 5)}${tail}`;
}

// Phone numbers can be local ("08012345678") or international ("+2348012345678").
// Same head/tail strategy as IDs.
function maskPhoneNumber(value: string | null | undefined): string | undefined {
  return maskSensitiveId(value);
}

// Preserve the domain so the user knows which mailbox; obscure the local part.
// e.g. "mangodeveloper@example.com" → "ma***********@example.com".
// Local parts of 1–2 chars are fully starred.
function maskEmail(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const at = value.lastIndexOf('@');
  if (at <= 0) return '*'.repeat(value.length);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `${'*'.repeat(local.length)}${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(local.length - 2)}${domain}`;
}

class UserResponse extends BaseResponse<ResponseType> {
  constructor(data: ResponseType, paginationDetails?: PaginationDetailsDTO) {
    super(data, paginationDetails);
  }

  static constructUserFullName(user: UserDetailsDBDto) {
    if (!user?.firstName && !user?.lastName) {
      return undefined;
    }
    return [user?.firstName, user?.middleName, user?.lastName]
      .filter(Boolean)
      .join(' ');
  }

  static constructUserDetails(
    user: UserDetailsDBDto,
    priceService: PriceService,
  ): UserDetailsResponseDTO {
    return {
      id: user.id,
      email: maskEmail(user.email),
      name: this.constructUserFullName(user),
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      middleName: user.middleName || undefined,
      phoneNumber: maskPhoneNumber(user.phoneNumber),
      bvn: maskSensitiveId(user.bvn),
      nin: maskSensitiveId(user.nin),
      address: user.address || undefined,
      gender: user.gender || undefined,
      category: user.category || undefined,
      role: user.role,
      dateOfBirth: user.dateOfBirth || undefined,
      isEmailVerified: user.isEmailVerified,
      isPhoneNumberVerified: user.isPhoneNumberVerified,
      isAccountCreationCompleted: user.isAccountCreationCompleted,
      createdAt: user.createdAt,
      bankAccounts: user.bankAccounts?.map((account) =>
        AccountResponse.constructAccountDetails(account, priceService),
      ),
    };
  }

  static createIndividualUserResponse(
    user: UserDetailsDBDto,
    priceService: PriceService,
  ) {
    return new UserResponse(this.constructUserDetails(user, priceService));
  }

  static createMultipleUserResponse(
    users: UserDetailsDBDto[],
    paginationDetails: PaginationDetailsDTO,
    priceService: PriceService,
  ) {
    return new UserResponse(
      users.map((user) => this.constructUserDetails(user, priceService)),
      paginationDetails,
    );
  }
}

export default UserResponse;
