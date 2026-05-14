import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { ApiOkResponseData } from '@common/response/api-response.decorator';
import { UserDetailsResponseDTO } from '@common/response/user/user.dto';
import { routes, subRoutes } from '@shared/variables';
import { ChangePasswordBodyDTO, UpdateUserBodyDTO } from './user.dto';
import { UserService } from './user.service';

@ApiTags('User')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.user)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get the current user profile (with bank accounts)' })
  @ApiOkResponseData(UserDetailsResponseDTO)
  getMe(@Req() req: CustomRequest) {
    return this.userService.getMe(req);
  }

  @Patch('/')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update the current user profile',
    description:
      'Partial update. Identity fields (BVN, NIN, email) cannot be changed here. DOB is locked once the Squad virtual account exists.',
  })
  @ApiOkResponseData(UserDetailsResponseDTO)
  updateMe(@Body() body: UpdateUserBodyDTO, @Req() req: CustomRequest) {
    return this.userService.updateMe(body, req);
  }

  @Patch(subRoutes.password)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change password (knows old password)',
    description:
      'For self-service password change. To reset a forgotten password, use POST /auth/otp/send + /auth/password/reset instead.',
  })
  changePassword(
    @Body() body: ChangePasswordBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.userService.changePassword(body, req);
  }
}
