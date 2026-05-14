import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { routes, subRoutes } from '@shared/variables';
import {
  ApiCreatedResponseData,
  ApiOkResponseData,
} from '@common/response/api-response.decorator';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { LoginResponseDTO } from '@common/response/login/login.dto';
import { UserDetailsResponseDTO } from '@common/response/user/user.dto';
import { BankAccountResponseDTO } from '@common/response/account/account.dto';
import { AuthService } from './auth.service';
import {
  CreateAccountBodyDTO,
  OAuthSignInBodyDTO,
  ResetPasswordBodyDTO,
  SendOtpBodyDTO,
  SignInBodyDTO,
  SignUpBodyDTO,
  VerifyOtpBodyDTO,
} from './auth.dto';

@ApiTags('Auth')
@Controller(routes.auth)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post(subRoutes.signUp)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Stage 1 — sign up with email + password',
    description:
      'Creates a user record with credentials only. Returns the user and an access token to use for Stage 2.',
  })
  @ApiCreatedResponseData(LoginResponseDTO, {
    description: 'Account created. Returns user details and an access token.',
  })
  signUp(@Body() body: SignUpBodyDTO, @Req() req: CustomRequest) {
    return this.authService.signUp(body, req);
  }

  @Post(subRoutes.signIn)
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email + password' })
  @ApiOkResponseData(LoginResponseDTO, { description: 'Sign in successful.' })
  signIn(@Body() body: SignInBodyDTO, @Req() req: CustomRequest) {
    return this.authService.signIn(body, req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Post(subRoutes.account)
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Stage 2 — complete profile and provision a Squad virtual account',
    description:
      'Submits BVN + personal details. Calls Squad to create a virtual account, persists the bank account, and marks onboarding as complete.',
  })
  @ApiCreatedResponseData(UserDetailsResponseDTO, {
    description:
      'Returns the updated user with the newly-created bank account attached.',
  })
  createAccount(
    @Body() body: CreateAccountBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.authService.createAccount(body, req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.account)
  @HttpCode(200)
  @ApiOperation({ summary: 'List the current user’s bank accounts' })
  @ApiOkResponseData(BankAccountResponseDTO, {
    isArray: true,
    description: 'Returns the bank accounts owned by the current user.',
  })
  getMyAccounts(@Req() req: CustomRequest) {
    return this.authService.getMyAccounts(req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.me)
  @HttpCode(200)
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiOkResponseData(UserDetailsResponseDTO, {
    description: 'Returns the currently authenticated user with bank accounts.',
  })
  getMe(@Req() req: CustomRequest) {
    return this.authService.getMe(req);
  }

  // ─── OTP + password recovery ───────────────────────────────────────────

  @Post(`${subRoutes.otp}${subRoutes.send}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send an OTP to the user’s email',
    description:
      'Used for EMAIL_VERIFICATION (after sign-up) and FORGOT_PASSWORD. Always returns 200 even when the email is unknown to avoid leaking account existence.',
  })
  sendOtp(@Body() body: SendOtpBodyDTO, @Req() req: CustomRequest) {
    return this.authService.sendOtp(body, req);
  }

  @Post(`${subRoutes.otp}${subRoutes.verify}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify an OTP',
    description:
      'For EMAIL_VERIFICATION returns a confirmation message. For FORGOT_PASSWORD returns a one-time change-password token to use at /auth/password/reset.',
  })
  verifyOtp(@Body() body: VerifyOtpBodyDTO, @Req() req: CustomRequest) {
    return this.authService.verifyOtp(body, req);
  }

  @Post(`${subRoutes.password}${subRoutes.reset}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reset password using the FORGOT_PASSWORD change-token',
    description:
      'Token comes from POST /auth/otp/verify with otpType=FORGOT_PASSWORD. Tokens are single-use, bound to the requesting IP, and expire after 15 minutes.',
  })
  resetPassword(
    @Body() body: ResetPasswordBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.authService.resetPassword(body, req);
  }

  // ─── OAuth sign-in (Google / Apple) ────────────────────────────────────

  @Post(`${subRoutes.oauth}${subRoutes.google}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in (or sign up) with a Google ID token',
    description:
      'Body: { idToken } where idToken is the Google-issued JWT from the Google Sign-In SDK. Server verifies signature + audience (GOOGLE_CLIENT_ID), then matches by email — existing users sign in, new emails create a fresh user (no password). Returns user + access token.',
  })
  @ApiOkResponseData(LoginResponseDTO, {
    description: 'Google sign-in successful.',
  })
  signInWithGoogle(
    @Body() body: OAuthSignInBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.authService.signInWithProvider('google', body, req);
  }

  @Post(`${subRoutes.oauth}${subRoutes.apple}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in (or sign up) with an Apple ID token',
    description:
      'Body: { idToken } where idToken is the Apple-issued JWT from Sign in with Apple. The first sign-in must include the `email` scope.',
  })
  @ApiOkResponseData(LoginResponseDTO, {
    description: 'Apple sign-in successful.',
  })
  signInWithApple(
    @Body() body: OAuthSignInBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.authService.signInWithProvider('apple', body, req);
  }
}
