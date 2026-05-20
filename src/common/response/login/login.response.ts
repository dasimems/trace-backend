import { PriceService } from '@common/price/price.service';
import BaseResponse from '../base.response';
import { UserDetailsDBDto } from '../user/user.dto';
import UserResponse from '../user/user.response';
import { LoginResponseDTO } from './login.dto';

class LoginResponse extends BaseResponse<LoginResponseDTO> {
  constructor(data: LoginResponseDTO) {
    super(data);
  }

  static constructLoginResponse(
    user: UserDetailsDBDto,
    priceService: PriceService,
    accessToken?: string,
  ) {
    return new LoginResponse({
      accessToken,
      user: UserResponse.constructUserDetails(user, priceService),
    });
  }
}

export default LoginResponse;
