import BaseResponse from '../base.response';
import { UserDetailsDBDto } from '../user/user.dto';
import UserResponse from '../user/user.response';
import { LoginResponseDTO } from './login.dto';

class LoginResponse extends BaseResponse<LoginResponseDTO> {
  constructor(data: LoginResponseDTO) {
    super(data);
  }

  static constructLoginResponse(user: UserDetailsDBDto, accessToken?: string) {
    return new LoginResponse({
      accessToken,
      user: UserResponse.constructUserDetails(user),
    });
  }
}

export default LoginResponse;
