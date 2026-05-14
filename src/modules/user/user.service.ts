import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PasswordService } from '@common/password/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { BankAccountSelect } from '@common/prisma/selects/bank-account.select';
import { UserDetailsSelect } from '@common/prisma/selects/user.select';
import BaseResponse from '@common/response/base.response';
import UserResponse from '@common/response/user/user.response';
import { ChangePasswordBodyDTO, UpdateUserBodyDTO } from './user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  async getMe(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const user = await this.prismaService.users.findUnique({
      where: { id: auth.id },
      select: { ...UserDetailsSelect, bankAccounts: { select: BankAccountSelect } },
    });
    if (!user) throw new UnauthorizedException('Unauthorized!');
    return UserResponse.createIndividualUserResponse(user);
  }

  async updateMe(body: UpdateUserBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);

    // Build patch data — only include fields the caller actually sent. We
    // never overwrite a value with `undefined`.
    const data: Record<string, unknown> = {};
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.middleName !== undefined) data.middleName = body.middleName;
    if (body.address !== undefined) data.address = body.address;
    if (body.gender !== undefined) data.gender = body.gender;
    if (body.category !== undefined) data.category = body.category;

    if (body.phoneNumber !== undefined) {
      const existing = await this.prismaService.users.findFirst({
        where: { phoneNumber: body.phoneNumber, NOT: { id: auth.id } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          'This phone number is already linked to another account.',
        );
      }
      data.phoneNumber = body.phoneNumber;
      // Changing the number invalidates verification — make them re-verify.
      data.isPhoneNumberVerified = false;
      data.phoneNumberVerifiedAt = null;
    }

    if (body.dateOfBirth !== undefined) {
      // DOB is part of the Squad virtual-account record. Allow changes only
      // before account creation; after that, locked.
      const current = await this.prismaService.users.findUnique({
        where: { id: auth.id },
        select: { isAccountCreationCompleted: true },
      });
      if (current?.isAccountCreationCompleted) {
        throw new ForbiddenException(
          'Date of birth is locked once your virtual account is created.',
        );
      }
      data.dateOfBirth = body.dateOfBirth;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No updatable fields provided.');
    }

    const updated = await this.prismaService.users.update({
      where: { id: auth.id },
      data,
      select: { ...UserDetailsSelect, bankAccounts: { select: BankAccountSelect } },
    });
    return UserResponse.createIndividualUserResponse(updated);
  }

  async changePassword(body: ChangePasswordBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const user = await this.prismaService.users.findUnique({
      where: { id: auth.id },
      select: { id: true, password: true, createdAt: true },
    });
    if (!user) throw new UnauthorizedException('Unauthorized!');

    const ok = await this.passwordService.verifyPassword(
      user.id,
      body.currentPassword,
      user.createdAt,
      user.password,
    );
    if (!ok) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const hashed = await this.passwordService.hashPassword(
      user.id,
      body.newPassword,
      user.createdAt,
    );
    await this.prismaService.users.update({
      where: { id: user.id },
      data: { password: hashed },
      select: { id: true },
    });
    return new BaseResponse('Password changed successfully.');
  }
}
