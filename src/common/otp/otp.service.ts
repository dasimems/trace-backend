import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import Keyv from 'keyv';
import { EncryptionService } from '../encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import {
  MEMORY_CACHE,
  OTP_HASH_KEY,
  OTP_HASH_SALT,
  OTP_SECRET_KEY,
} from '../../shared/constants';
import { OTPEncryptedDTP, OTPEncryptionDTO } from './otp.dto';
import { EmailService } from '../email/email.service';
import { format } from 'date-fns';
import { VerificationType } from '../../shared/enums/enums';

@Injectable()
export class OtpService {
  private secretKey: string;
  private hashKey: string;
  private hashSalt: string;
  private otpTTL = 10 * 60 * 1000;
  constructor(
    private readonly configService: ConfigService,
    @Inject(MEMORY_CACHE) private readonly memoryCache: Keyv,
    private readonly encryption: EncryptionService,
    private emailService: EmailService,
  ) {
    this.secretKey = this.configService.get<string>(OTP_SECRET_KEY)!;
    this.hashKey = this.configService.get<string>(OTP_HASH_KEY)!;
    this.hashSalt = this.configService.get<string>(OTP_HASH_SALT)!;
  }

  private toBase36(value: number, shouldPad: boolean = false): string {
    const base36Value = Math.floor(value)?.toString(36);
    if (shouldPad) {
      return base36Value?.padStart(2, '0');
    }
    return base36Value;
  }

  private generateOTPCode() {
    const otp = Math.floor(100000 + Math.random() * 900000);
    return otp.toString();
  }

  private generateNonce(otp: string) {
    return { iv: `${otp}-${this?.hashKey}`, key: `${this.secretKey}-${otp}` };
  }

  private constructHashContent(
    code: string,
    otp: string,
    userId: string,
    ipAddress: string,
    verificationType: VerificationType,
  ) {
    return `${code}-${otp}-${userId}-${ipAddress}-${verificationType}`;
  }

  private generateOTPCacheKey(type: 'MAIL' | 'MOBILE', userId: string) {
    const date = new Date();

    const year = parseInt(format(date, 'yyyy'), 10);
    const month = parseInt(format(date, 'MM'), 10);
    const day = parseInt(format(date, 'dd'), 10);
    const minutes = parseInt(format(date, 'mm'), 10);
    const seconds = parseInt(format(date, 'ss'), 10);
    const base36Year = this.toBase36(year);
    const base36Month = this.toBase36(month);
    const base36Day = this.toBase36(day);
    const base36Minutes = this.toBase36(minutes, true);
    const base36Seconds = this.toBase36(seconds, true);
    return `${type}-${userId}-${base36Seconds}${base36Minutes}-${base36Day}${base36Month}-OP${base36Year}`;
  }

  async sendOTPToEmail(
    email: string,
    name: string,
    userId: string,
    ipAddress: string,
    verificationType: VerificationType,
  ): Promise<OTPEncryptedDTP> {
    const otp = this.generateOTPCode();
    const code = this.generateOTPCacheKey('MAIL', userId);
    const otpHashContent = this.constructHashContent(
      code,
      otp,
      userId,
      ipAddress,
      verificationType,
    );
    const hash = await this.encryption.hash(otpHashContent, this.hashSalt);
    await this.memoryCache.set<string>(code, hash, this.otpTTL);
    const nonce = this.generateNonce(otp);
    const payload: OTPEncryptionDTO = {
      code,
      userId,
    };
    const encryptedCode = this.encryption.encrypt(
      payload,
      {
        key: this.secretKey,
        iv: this.hashKey,
      },
      nonce,
    );
    const dataToReturn = {
      token: encryptedCode,
      expiresAt: new Date(Date.now() + this.otpTTL),
    };
    if (verificationType === VerificationType.EMAIL_VERIFICATION) {
      await this.emailService.sendEmailVerificationOTPEmail(email, otp, name);
      return dataToReturn;
    }
    if (verificationType === VerificationType.FORGOT_PASSWORD) {
      await this.emailService.sendPasswordResetOTPEmail(email, otp, name);
      return dataToReturn;
    }
    if (verificationType === VerificationType.ACCOUNT_CREATION) {
      await this.emailService.sendAccountCreationOTPEmail(email, otp, name);
      return dataToReturn;
    }
    return dataToReturn;
  }

  async verifyOTP(
    token: string,
    otp: string,
    ipAddress: string,
    verificationType: VerificationType,
  ) {
    const nonce = this.generateNonce(otp);
    const payload = this.encryption.decrypt<OTPEncryptionDTO>(
      token,
      {
        key: this.secretKey,
        iv: this.hashKey,
      },
      nonce,
    );
    if (!payload) {
      throw new BadRequestException('Invalid otp!');
    }
    const { code, userId } = payload || {};
    const savedCachedOTP = await this.memoryCache.get<string>(code);

    if (!savedCachedOTP) {
      throw new BadRequestException('OTP Expired!');
    }

    const otpHashContent = this.constructHashContent(
      code,
      otp,
      userId,
      ipAddress,
      verificationType,
    );

    const isOTPValid = await this.encryption.verifyHash(
      savedCachedOTP,
      otpHashContent,
      this.hashSalt,
    );

    if (!isOTPValid) {
      return undefined;
    }
    await this.memoryCache.delete(code);
    return userId;
  }
}
