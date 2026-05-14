import { PaginationDetailsDTO } from '../base.dto';
import BaseResponse from '../base.response';
import AccountResponse from '../account/account.response';
import { UserDetailsDBDto, UserDetailsResponseDTO } from './user.dto';

type ResponseType = UserDetailsResponseDTO | UserDetailsResponseDTO[];

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

  static constructUserDetails(user: UserDetailsDBDto): UserDetailsResponseDTO {
    return {
      id: user.id,
      email: user.email,
      name: this.constructUserFullName(user),
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      middleName: user.middleName || undefined,
      phoneNumber: user.phoneNumber || undefined,
      bvn: user.bvn || undefined,
      nin: user.nin || undefined,
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
        AccountResponse.constructAccountDetails(account),
      ),
    };
  }

  static createIndividualUserResponse(user: UserDetailsDBDto) {
    return new UserResponse(this.constructUserDetails(user));
  }

  static createMultipleUserResponse(
    users: UserDetailsDBDto[],
    paginationDetails: PaginationDetailsDTO,
  ) {
    return new UserResponse(
      users.map((user) => this.constructUserDetails(user)),
      paginationDetails,
    );
  }
}

export default UserResponse;
