import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { format } from 'date-fns';
import { GenderEnum } from '@prisma/client';
import { AuthenticationService } from '@common/authentication/authentication.service';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { EmailService } from '@common/email/email.service';
import { OAuthService } from '@common/oauth/oauth.service';
import { OAuthProvider, OAuthVerifiedUser } from '@common/oauth/oauth.dto';
import { OtpService } from '@common/otp/otp.service';
import { PasswordService } from '@common/password/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { BankAccountSelect } from '@common/prisma/selects/bank-account.select';
import { UserDetailsSelect } from '@common/prisma/selects/user.select';
import AccountResponse from '@common/response/account/account.response';
import LoginResponse from '@common/response/login/login.response';
import UserResponse from '@common/response/user/user.response';
import BaseResponse from '@common/response/base.response';
import { SquadService } from '@common/squad/squad.service';
import { SquadGender } from '@common/squad/squad.dto';
import { UrlService } from '@common/url/url.service';
import { VerificationType } from '@shared/enums/enums';
import {
  CreateAccountBodyDTO,
  OAuthSignInBodyDTO,
  ResetPasswordBodyDTO,
  SendOtpBodyDTO,
  SignInBodyDTO,
  SignUpBodyDTO,
  VerifyOtpBodyDTO,
} from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authenticationService: AuthenticationService,
    private readonly passwordService: PasswordService,
    private readonly squadService: SquadService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly oauthService: OAuthService,
    private readonly urlService: UrlService,
  ) {}

  private getUserDetailsByEmail(email: string) {
    return this.prismaService.users.findUnique({
      where: { email },
      select: { ...UserDetailsSelect, bankAccounts: { select: BankAccountSelect } },
    });
  }

  private getUserDetailsById(id: string) {
    return this.prismaService.users.findUnique({
      where: { id },
      select: { ...UserDetailsSelect, bankAccounts: { select: BankAccountSelect } },
    });
  }

  private toSquadGender(gender: GenderEnum): SquadGender {
    return gender === GenderEnum.MALE ? '1' : '2';
  }

  // Squad expects strictly numeric mobile_num (max 11 digits, e.g. "08012345678").
  // Strip leading "+" and country code so "+2348012345678" becomes "08012345678".
  private toSquadMobile(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.startsWith('234') && digits.length === 13) {
      return `0${digits.slice(3)}`;
    }
    return digits;
  }

  async signUp(body: SignUpBodyDTO, req: CustomRequest) {
    const { email, password } = body;
    const existing = await this.prismaService.users.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'An account with this email already exists. Please sign in instead.',
      );
    }

    // Pre-generate id + createdAt so the password hash (which is keyed by both)
    // matches what gets persisted on the row.
    const createdAt = new Date();
    const userId = crypto.randomUUID();
    const hashedPassword = await this.passwordService.hashPassword(
      userId,
      password,
      createdAt,
    );

    const userDetails = await this.prismaService.users.create({
      data: {
        id: userId,
        email,
        password: hashedPassword,
        createdAt,
      },
      select: { ...UserDetailsSelect, bankAccounts: { select: BankAccountSelect } },
    });

    const accessToken = await this.authenticationService.generateAuthToken(
      req,
      userDetails,
    );

    return LoginResponse.constructLoginResponse(userDetails, accessToken);
  }

  async signIn(body: SignInBodyDTO, req: CustomRequest) {
    const { email, password } = body;
    const userDetails = await this.getUserDetailsByEmail(email);

    if (!userDetails) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isPasswordValid = await this.passwordService.verifyPassword(
      userDetails.id,
      password,
      userDetails.createdAt,
      userDetails.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const accessToken = await this.authenticationService.generateAuthToken(
      req,
      userDetails,
    );

    return LoginResponse.constructLoginResponse(userDetails, accessToken);
  }

  async createAccount(body: CreateAccountBodyDTO, req: CustomRequest) {
    const auth = req.auth;
    if (!auth) {
      throw new UnauthorizedException('Unauthorized!');
    }

    const userDetails = await this.getUserDetailsById(auth.id);
    if (!userDetails) {
      throw new UnauthorizedException('Unauthorized!');
    }

    if (userDetails.isAccountCreationCompleted) {
      throw new ConflictException(
        'A virtual account has already been created for this user.',
      );
    }

    const existingBvn = await this.prismaService.users.findFirst({
      where: { bvn: body.bvn, NOT: { id: userDetails.id } },
      select: { id: true },
    });
    if (existingBvn) {
      throw new ConflictException(
        'This BVN is already linked to another account.',
      );
    }

    const existingPhone = await this.prismaService.users.findFirst({
      where: { phoneNumber: body.phoneNumber, NOT: { id: userDetails.id } },
      select: { id: true },
    });
    if (existingPhone) {
      throw new ConflictException(
        'This phone number is already linked to another account.',
      );
    }

    if (body.nin) {
      const existingNin = await this.prismaService.users.findFirst({
        where: { nin: body.nin, NOT: { id: userDetails.id } },
        select: { id: true },
      });
      if (existingNin) {
        throw new ConflictException(
          'This NIN is already linked to another account.',
        );
      }
    }

    const customerIdentifier = `trace_${userDetails.id.replace(/-/g, '').slice(0, 16)}`;
    const beneficiaryAccount = this.squadService.getDefaultBeneficiaryAccount();

    const virtualAccount = await this.squadService.createIndividualVirtualAccount({
      first_name: body.firstName,
      last_name: body.lastName,
      middle_name: body.middleName,
      mobile_num: this.toSquadMobile(body.phoneNumber),
      dob: format(body.dateOfBirth, 'MM/dd/yyyy'),
      email: userDetails.email!,
      bvn: body.bvn,
      gender: this.toSquadGender(body.gender),
      address: body.address,
      customer_identifier: customerIdentifier,
      ...(beneficiaryAccount ? { beneficiary_account: beneficiaryAccount } : {}),
    });

    const accountName = [body.firstName, body.middleName, body.lastName]
      .filter(Boolean)
      .join(' ');

    if (
      !virtualAccount?.virtual_account_number ||
      !virtualAccount?.bank_code
    ) {
      throw new BadRequestException(
        'The bank service did not return a virtual account. Please try again.',
      );
    }

    const updatedUser = await this.prismaService.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: userDetails.id },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          middleName: body.middleName,
          phoneNumber: body.phoneNumber,
          dateOfBirth: body.dateOfBirth,
          gender: body.gender,
          address: body.address,
          bvn: body.bvn,
          nin: body.nin ?? null,
          category: body.category,
          isAccountCreationCompleted: true,
        },
        select: { id: true },
      });

      const newAccount = await tx.bankAccounts.create({
        data: {
          userId: userDetails.id,
          accountNumber: virtualAccount.virtual_account_number,
          accountName,
          bankCode: virtualAccount.bank_code,
          customerIdentifier: virtualAccount.customer_identifier,
          beneficiaryAccount: virtualAccount.beneficiary_account ?? null,
        },
        select: { id: true },
      });

      // Seed three default pockets so the dashboard renders meaningful
      // sub-balances from day one. Only "Spend" is flagged isDefault — the
      // user can rename or delete Save / Goals but not Spend.
      await tx.walletPockets.createMany({
        data: [
          {
            name: 'Spend',
            type: 'SPEND',
            isDefault: true,
            accountId: newAccount.id,
            userId: userDetails.id,
          },
          {
            name: 'Save',
            type: 'SAVE',
            accountId: newAccount.id,
            userId: userDetails.id,
          },
          {
            name: 'Goals',
            type: 'GOAL',
            accountId: newAccount.id,
            userId: userDetails.id,
          },
        ],
      });

      return tx.users.findUnique({
        where: { id: userDetails.id },
        select: {
          ...UserDetailsSelect,
          bankAccounts: { select: BankAccountSelect },
        },
      });
    });

    return UserResponse.createIndividualUserResponse(updatedUser!);
  }

  async getMe(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) {
      throw new UnauthorizedException('Unauthorized!');
    }

    const userDetails = await this.getUserDetailsById(auth.id);
    if (!userDetails) {
      throw new UnauthorizedException('Unauthorized!');
    }

    return UserResponse.createIndividualUserResponse(userDetails);
  }

  // Allows the frontend to surface the freshly-created virtual account on the
  // Stage 3 success screen without re-fetching the whole user object.
  async getMyAccounts(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) {
      throw new UnauthorizedException('Unauthorized!');
    }

    const accounts = await this.prismaService.bankAccounts.findMany({
      where: { userId: auth.id },
      select: BankAccountSelect,
      orderBy: { createdAt: 'asc' },
    });

    return AccountResponse.createMultipleAccountResponse(accounts);
  }

  // ─── OTP + password recovery ───────────────────────────────────────────

  async sendOtp(body: SendOtpBodyDTO, req: CustomRequest) {
    const { email, otpType } = body;
    const userDetails = await this.getUserDetailsByEmail(email);

    // Always return success — never confirm whether an email exists. This is
    // important for FORGOT_PASSWORD; for EMAIL_VERIFICATION the frontend
    // already knows the user just signed up.
    if (!userDetails) {
      return new BaseResponse('If that email exists, an OTP has been sent.');
    }
    if (
      otpType === VerificationType.EMAIL_VERIFICATION &&
      userDetails.isEmailVerified
    ) {
      throw new ConflictException('This email is already verified.');
    }

    const ipAddress = this.urlService.getIpAddress(req);
    const displayName =
      [userDetails.firstName, userDetails.lastName]
        .filter(Boolean)
        .join(' ') || 'there';

    const otp = await this.otpService.sendOTPToEmail(
      email,
      displayName,
      userDetails.id,
      ipAddress,
      otpType,
    );

    return new BaseResponse({
      token: otp.token,
      expiresAt: otp.expiresAt,
    });
  }

  async verifyOtp(body: VerifyOtpBodyDTO, req: CustomRequest) {
    const { token, otp, otpType } = body;
    const ipAddress = this.urlService.getIpAddress(req);

    const userId = await this.otpService.verifyOTP(
      token,
      otp,
      ipAddress,
      otpType,
    );

    if (!userId) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    if (otpType === VerificationType.EMAIL_VERIFICATION) {
      const userDetails = await this.prismaService.users.findUnique({
        where: { id: userId },
        select: { id: true, isEmailVerified: true },
      });
      if (!userDetails) {
        throw new ForbiddenException('Forbidden!');
      }
      if (!userDetails.isEmailVerified) {
        await this.prismaService.users.update({
          where: { id: userId },
          data: { isEmailVerified: true, emailVerifiedAt: new Date() },
          select: { id: true },
        });
      }
      return new BaseResponse('Email verified successfully.');
    }

    if (otpType === VerificationType.FORGOT_PASSWORD) {
      const userDetails = await this.prismaService.users.findUnique({
        where: { id: userId },
        select: { id: true, createdAt: true },
      });
      if (!userDetails) {
        throw new ForbiddenException('Forbidden!');
      }
      const changeToken =
        await this.passwordService.generateChangePasswordToken(
          userDetails.id,
          ipAddress,
          userDetails.createdAt,
        );
      // Frontend should now call POST /auth/password/reset with this token.
      return new BaseResponse(changeToken);
    }

    throw new ForbiddenException('Unsupported OTP type.');
  }

  async resetPassword(body: ResetPasswordBodyDTO, req: CustomRequest) {
    const { token, password } = body;
    const ipAddress = this.urlService.getIpAddress(req);

    // Step 1: decode the token to learn which user it's for. This decryption
    // is bound to the requesting IP — a token issued from one IP cannot be
    // redeemed from another.
    const owner = this.passwordService.decodeChangePasswordTokenOwner(
      token,
      ipAddress,
    );
    if (!owner) {
      throw new ForbiddenException('Reset link is invalid or expired.');
    }

    // Step 2: fetch the user so we have their real createdAt (load-bearing
    // for the cache-key computation inside verifyChangePasswordToken).
    const userDetails = await this.prismaService.users.findUnique({
      where: { id: owner.userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!userDetails) {
      throw new ForbiddenException('Reset link is invalid or expired.');
    }

    // Step 3: the real verify. Confirms the cache still has the matching
    // hashed nonce — proves the token was actually minted by us within TTL.
    const verified = await this.passwordService.verifyChangePasswordToken(
      token,
      ipAddress,
      userDetails.createdAt,
    );
    if (!verified || verified.userId !== userDetails.id) {
      throw new ForbiddenException('Reset link is invalid or expired.');
    }

    const hashedPassword = await this.passwordService.hashPassword(
      userDetails.id,
      password,
      userDetails.createdAt,
    );
    await this.prismaService.users.update({
      where: { id: userDetails.id },
      data: { password: hashedPassword },
      select: { id: true },
    });

    const displayName =
      [userDetails.firstName, userDetails.lastName]
        .filter(Boolean)
        .join(' ') || 'there';
    await this.emailService.sendPasswordChangedEmail(
      userDetails.email!,
      displayName,
    );

    return new BaseResponse('Password reset successfully.');
  }

  // ─── OAuth sign-in (Google / Apple) ────────────────────────────────────

  async signInWithProvider(
    provider: OAuthProvider,
    body: OAuthSignInBodyDTO,
    req: CustomRequest,
  ) {
    const verified =
      provider === 'google'
        ? await this.oauthService.verifyGoogleIdToken(body.idToken)
        : await this.oauthService.verifyAppleIdToken(body.idToken);
    return this.upsertOAuthUser(verified, req);
  }

  private async upsertOAuthUser(
    verified: OAuthVerifiedUser,
    req: CustomRequest,
  ) {
    // Match strategy: email-only. OAuth providers don't share a user across
    // providers — same person on Google vs Apple → same email → same user
    // row. If they signed up via password first with the same email, OAuth
    // sign-in attaches to that existing user.
    const existing = await this.prismaService.users.findUnique({
      where: { email: verified.email },
      select: {
        ...UserDetailsSelect,
        bankAccounts: { select: BankAccountSelect },
      },
    });

    if (existing) {
      // Mark email verified now — the OAuth provider has confirmed it.
      if (verified.emailVerified && !existing.isEmailVerified) {
        await this.prismaService.users.update({
          where: { id: existing.id },
          data: {
            isEmailVerified: true,
            emailVerifiedAt: new Date(),
          },
          select: { id: true },
        });
        existing.isEmailVerified = true;
      }
      const accessToken =
        await this.authenticationService.generateAuthToken(req, existing);
      return LoginResponse.constructLoginResponse(existing, accessToken);
    }

    // First-time sign-in via OAuth → create the user. Password is set to a
    // random value the user can never know — they must use OAuth or go
    // through forgot-password to set their own.
    const createdAt = new Date();
    const userId = crypto.randomUUID();
    const randomPassword = `${crypto.randomUUID()}!Aa1${crypto.randomUUID()}`;
    const hashedPassword = await this.passwordService.hashPassword(
      userId,
      randomPassword,
      createdAt,
    );

    const created = await this.prismaService.users.create({
      data: {
        id: userId,
        email: verified.email,
        password: hashedPassword,
        firstName: verified.firstName ?? null,
        lastName: verified.lastName ?? null,
        isEmailVerified: verified.emailVerified,
        emailVerifiedAt: verified.emailVerified ? new Date() : null,
        createdAt,
      },
      select: {
        ...UserDetailsSelect,
        bankAccounts: { select: BankAccountSelect },
      },
    });

    const accessToken = await this.authenticationService.generateAuthToken(
      req,
      created,
    );
    return LoginResponse.constructLoginResponse(created, accessToken);
  }
}
