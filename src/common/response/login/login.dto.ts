import { ApiProperty } from '@nestjs/swagger';
import { UserDetailsResponseDTO } from '../user/user.dto';

export class LoginResponseDTO {
  @ApiProperty({ type: String, required: false })
  accessToken?: string;

  @ApiProperty({ type: () => UserDetailsResponseDTO })
  user: UserDetailsResponseDTO;
}
