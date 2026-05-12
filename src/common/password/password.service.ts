import { Inject, Injectable } from '@nestjs/common';
import { EncryptionService } from '../encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import { format } from 'date-fns';
import {
  MEMORY_CACHE,
  PASSWORD_HASH,
  PASSWORD_SALT,
  PASSWORD_SECRET,
} from '../../shared/constants';
import { ChangePasswordEncryptionPayload } from './password.dto';
import Keyv from 'keyv';

/**
 * Note vs turn-up: `verifyChangePasswordToken` takes `userCreatedAt` as an
 * argument instead of looking it up via `PrismaService.users.findUnique(...)`.
 * Callers (auth module) own the user lookup and pass the date in, keeping this
 * service decoupled from any specific Prisma model.
 */
@Injectable()
export class PasswordService {
  private passwordSecret: string;
  private passwordSalt: string;
  private passwordHash: string;
  private changePasswordExpiresTTL = 15 * 60 * 1000;
  constructor(
    private readonly encryption: EncryptionService,
    private readonly configService: ConfigService,
    @Inject(MEMORY_CACHE) private readonly memoryCache: Keyv,
  ) {
    this.passwordSecret = this.configService.get<string>(PASSWORD_SECRET)!;
    this.passwordSalt = this.configService.get<string>(PASSWORD_SALT)!;
    this.passwordHash = this.configService.get<string>(PASSWORD_HASH)!;
  }

  private toBase36(value: number, shouldPad: boolean = false): string {
    const base36Value = Math.floor(value)?.toString(36);
    if (shouldPad) {
      return base36Value?.padStart(2, '0');
    }
    return base36Value;
  }

  private generatePasswordNonce(userId: string, date: Date) {
    const uniqueLetterFromID = `${userId?.slice(0, 1)}${userId?.slice(userId?.length - 1)}`;
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
    const uniqueNonceKey = `PASS-${base36Month}${base36Day}-${base36Year}${uniqueLetterFromID}-${base36Minutes}${base36Seconds}`;
    return {
      key: `${this.passwordSecret}-${uniqueNonceKey}`,
      iv: `${this.passwordHash}-${uniqueNonceKey}`,
    };
  }

  private generateChangePasswordCacheKey(
    userId: string,
    userCreatedAt: Date,
    createdAt: Date,
  ) {
    const uniqueLetterFromID = `${userId?.slice(0, 1)}${userId?.slice(userId?.length - 1)}`;
    const year = parseInt(format(createdAt, 'yyyy'), 10);
    const month = parseInt(format(userCreatedAt, 'MM'), 10);
    const day = parseInt(format(userCreatedAt, 'dd'), 10);
    const minutes = parseInt(format(createdAt, 'mm'), 10);
    const seconds = parseInt(format(userCreatedAt, 'ss'), 10);
    const base36Year = this.toBase36(year);
    const base36Month = this.toBase36(month);
    const base36Day = this.toBase36(day);
    const base36Minutes = this.toBase36(minutes, true);
    const base36Seconds = this.toBase36(seconds, true);
    return `CHANGE_PASS-${base36Month}${base36Day}-${base36Year}${uniqueLetterFromID}-${base36Minutes}${base36Seconds}`;
  }

  private generateCacheContent(userId: string, salt: string) {
    return `${userId}-${salt}`;
  }

  private generateChangePasswordEncryptionKeyIv(ipAddress: string) {
    const secret = {
      key: `${this.passwordSecret}-${this.passwordSalt}`,
      iv: `${this.passwordHash}-${this.passwordSecret}`,
    };
    const nounce = {
      key: `${this.passwordSecret}-${ipAddress}`,
      iv: `${this.passwordHash}-${ipAddress}`,
    };
    return {
      secret,
      nounce,
    };
  }

  private generatePasswordSecret() {
    return {
      key: this.passwordSecret,
      iv: `${this.passwordHash}-${this.passwordSalt}`,
    };
  }

  private generateEncryptedPassword(
    userId: string,
    password: string,
    date: Date,
  ) {
    const nonce = this.generatePasswordNonce(userId, date);
    const secret = this.generatePasswordSecret();
    const encrypted = this.encryption.encrypt(password, secret, nonce);
    return encrypted;
  }

  async hashPassword(userId: string, password: string, creationDate: Date) {
    const encryptedPassword = this.generateEncryptedPassword(
      userId,
      password,
      creationDate,
    );
    const hashedContent = await this.encryption.hash(
      encryptedPassword,
      this.passwordSalt,
    );
    return hashedContent;
  }

  async verifyPassword(
    userId: string,
    password: string,
    creationDate: Date,
    hash: string,
  ) {
    const encryptedPassword = this.generateEncryptedPassword(
      userId,
      password,
      creationDate,
    );
    const isPasswordVerified = await this.encryption.verifyHash(
      hash,
      encryptedPassword,
      this.passwordSalt,
    );

    return isPasswordVerified;
  }

  async generateChangePasswordToken(
    userId: string,
    ipAddress: string,
    userCreatedAt: Date,
  ) {
    const createdAt = new Date();
    const payload: ChangePasswordEncryptionPayload = {
      createdAt,
      userId,
    };
    const ecnryptionKeys =
      this.generateChangePasswordEncryptionKeyIv(ipAddress);
    const token = this.encryption.encrypt(
      payload,
      ecnryptionKeys.secret,
      ecnryptionKeys.nounce,
    );

    const passwordNounce = this.generatePasswordNonce(userId, createdAt);

    const cacheContent = this.generateCacheContent(userId, passwordNounce.iv);

    const hashedContent = await this.encryption.hash(
      cacheContent,
      this.passwordSalt,
    );

    const cacheKey = this.generateChangePasswordCacheKey(
      userId,
      userCreatedAt,
      createdAt,
    );

    await this.memoryCache.set(
      cacheKey,
      hashedContent,
      this.changePasswordExpiresTTL,
    );

    return {
      token,
      expiresAt: new Date(Date.now() + this.changePasswordExpiresTTL),
    };
  }

  async verifyChangePasswordToken(
    token: string,
    ipAddress: string,
    userCreatedAt: Date,
  ) {
    const ecnryptionKeys =
      this.generateChangePasswordEncryptionKeyIv(ipAddress);
    const content = this.encryption.decrypt<ChangePasswordEncryptionPayload>(
      token,
      ecnryptionKeys.secret,
      ecnryptionKeys.nounce,
    );

    if (!content) {
      return undefined;
    }

    const { createdAt, userId } = content;

    const passwordNounce = this.generatePasswordNonce(userId, createdAt);

    const constructedCacheContent = this.generateCacheContent(
      userId,
      passwordNounce.iv,
    );

    const cacheKey = this.generateChangePasswordCacheKey(
      userId,
      userCreatedAt,
      createdAt,
    );

    const cachedContent = await this.memoryCache.get<string>(cacheKey);

    if (!cachedContent) {
      return undefined;
    }

    const isVerified = await this.encryption.verifyHash(
      cachedContent,
      constructedCacheContent,
      this.passwordSalt,
    );

    if (!isVerified) {
      return undefined;
    }

    return { userId, createdAt: userCreatedAt };
  }
}
