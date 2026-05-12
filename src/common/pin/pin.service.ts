import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { format } from 'date-fns';
import { EncryptionService } from '../encryption/encryption.service';
import { CustomRequest } from '../authentication/authentication.dto';
import { UrlService } from '../url/url.service';
import { JwtService } from '../jwt/jwt.service';
import Keyv from 'keyv';
import {
  AUTH_HASH_KEY,
  MEMORY_CACHE,
  PASSWORD_HASH,
  PASSWORD_SALT,
  PASSWORD_SECRET,
} from '@shared/constants';

@Injectable()
export class PinService {
  private passwordSecret: string;
  private passwordHash: string;
  private passwordSalt: string;
  private authHash: string;
  private tokenValidity = 24 * 60 * 60;
  constructor(
    private readonly configService: ConfigService,
    private readonly encryption: EncryptionService,
    private urlService: UrlService,
    private jwtService: JwtService,
    @Inject(MEMORY_CACHE) private readonly memoryCache: Keyv,
  ) {
    this.passwordSecret = this.configService.get<string>(PASSWORD_SECRET)!;
    this.passwordSalt = this.configService.get<string>(PASSWORD_SALT)!;
    this.passwordHash = this.configService.get<string>(PASSWORD_HASH)!;
    this.authHash = this.configService.get<string>(AUTH_HASH_KEY)!;
  }

  private toBase36(value: number, shouldPad: boolean = false): string {
    const base36Value = Math.floor(value)?.toString(36);
    if (shouldPad) {
      return base36Value?.padStart(2, '0');
    }
    return base36Value;
  }

  private constructUniqueID(userAgent: string, ip: string) {
    return `${ip}-${this.authHash}-${userAgent}`;
  }

  private constructPinAuthTokenNonce(
    userId: string,
    pinCreation: Date,
    req: CustomRequest,
  ) {
    const uniqueLetterFromID = `${userId?.slice(0, 1)}${userId?.slice(userId?.length - 1)}`;
    const year = parseInt(format(pinCreation, 'yyyy'), 10);
    const month = parseInt(format(pinCreation, 'MM'), 10);
    const day = parseInt(format(pinCreation, 'dd'), 10);
    const minutes = parseInt(format(pinCreation, 'mm'), 10);
    const seconds = parseInt(format(pinCreation, 'ss'), 10);
    const base36Year = this.toBase36(year);
    const base36Month = this.toBase36(month);
    const base36Day = this.toBase36(day);
    const base36Minutes = this.toBase36(minutes, true);
    const base36Seconds = this.toBase36(seconds, true);
    const uniqueNonceKey = `PIN-${base36Month}${base36Day}-${base36Year}${uniqueLetterFromID}-${base36Minutes}${base36Seconds}-TOKEN`;
    const uniqueId = this.constructUniqueID(
      this.urlService.getUserAgent(req),
      this.urlService.getIpAddress(req),
    );
    return {
      key: `${this.passwordSecret}-${uniqueNonceKey}`,
      iv: `${uniqueId}-${uniqueNonceKey}`,
    };
  }
  private constructPinAuthTokenSecret(
    userId: string,
    userCreationDate: Date,
    req: CustomRequest,
  ) {
    const uniqueLetterFromID = `${userId?.slice(0, 1)}${userId?.slice(userId?.length - 1)}`;
    const year = parseInt(format(userCreationDate, 'yyyy'), 10);
    const month = parseInt(format(userCreationDate, 'MM'), 10);
    const day = parseInt(format(userCreationDate, 'dd'), 10);
    const minutes = parseInt(format(userCreationDate, 'mm'), 10);
    const seconds = parseInt(format(userCreationDate, 'ss'), 10);
    const base36Year = this.toBase36(year);
    const base36Month = this.toBase36(month);
    const base36Day = this.toBase36(day);
    const base36Minutes = this.toBase36(minutes, true);
    const base36Seconds = this.toBase36(seconds, true);
    const uniqueNonceKey = `PIN-${base36Month}${base36Day}-${base36Year}${uniqueLetterFromID}-${base36Minutes}${base36Seconds}-TOKEN`;
    const uniqueId = this.constructUniqueID(
      this.urlService.getUserAgent(req),
      this.urlService.getIpAddress(req),
    );
    return {
      key: `${uniqueId}-${uniqueNonceKey}`,
      iv: `${this.passwordHash}-${uniqueNonceKey}`,
    };
  }

  private generatePinNonce(userId: string, pinCreation: Date) {
    const uniqueLetterFromID = `${userId?.slice(0, 1)}${userId?.slice(userId?.length - 1)}`;
    const year = parseInt(format(pinCreation, 'yyyy'), 10);
    const month = parseInt(format(pinCreation, 'MM'), 10);
    const day = parseInt(format(pinCreation, 'dd'), 10);
    const minutes = parseInt(format(pinCreation, 'mm'), 10);
    const seconds = parseInt(format(pinCreation, 'ss'), 10);
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
  private generatePinSecret(userId: string, userCreationDate: Date) {
    const uniqueLetterFromID = `${userId?.slice(0, 1)}${userId?.slice(userId?.length - 1)}`;
    const year = parseInt(format(userCreationDate, 'yyyy'), 10);
    const month = parseInt(format(userCreationDate, 'MM'), 10);
    const day = parseInt(format(userCreationDate, 'dd'), 10);
    const minutes = parseInt(format(userCreationDate, 'mm'), 10);
    const seconds = parseInt(format(userCreationDate, 'ss'), 10);
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

  private generateEncryptedPin(
    userId: string,
    pin: string,
    userCreationDate: Date,
    pinCreationDate: Date,
  ) {
    const nonce = this.generatePinNonce(userId, pinCreationDate);
    const secret = this.generatePinSecret(userId, userCreationDate);
    const encrypted = this.encryption.encrypt(pin, secret, nonce);
    return encrypted;
  }

  async hashPin(
    userId: string,
    pin: string,
    userCreationDate: Date,
    pinCreationDate: Date,
  ) {
    const encryptedPassword = this.generateEncryptedPin(
      userId,
      pin,
      userCreationDate,
      pinCreationDate,
    );
    const hashedContent = await this.encryption.hash(
      encryptedPassword,
      this.passwordSalt,
    );
    return hashedContent;
  }

  async verifyPin(
    userId: string,
    pin: string,
    userCreationDate: Date,
    pinCreationDate: Date,
    hash: string,
  ) {
    const encryptedPassword = this.generateEncryptedPin(
      userId,
      pin,
      userCreationDate,
      pinCreationDate,
    );
    const isPasswordVerified = await this.encryption.verifyHash(
      hash,
      encryptedPassword,
      this.passwordSalt,
    );

    return isPasswordVerified;
  }

  async generatePinAuthorizationToken(
    userId: string,
    userCreationDate: Date,
    pinCreationDate: Date,
    req: CustomRequest,
  ) {
    const nonce = this.constructPinAuthTokenNonce(userId, pinCreationDate, req);
    const secret = this.constructPinAuthTokenSecret(
      userId,
      userCreationDate,
      req,
    );

    const uniqueId = this.constructUniqueID(
      this.urlService.getUserAgent(req),
      this.urlService.getIpAddress(req),
    );

    const encryptedPin = this.encryption.encrypt({ userId }, secret, nonce);

    const hashedPin = await this.encryption.hash(encryptedPin, uniqueId);

    const iat = Math.floor(Date.now() / 1000);
    const token = await this.jwtService.sign(
      { content: encryptedPin },
      this.passwordSecret,
      uniqueId,
      iat + this.tokenValidity,
    );

    await this.memoryCache.set(
      encryptedPin,
      hashedPin,
      this.tokenValidity * 1000,
    );
    return token;
  }

  async verifyPinAuthorizationToken(
    userId: string,
    userCreationDate: Date,
    pinCreationDate: Date,
    req: CustomRequest,
  ) {
    const nonce = this.constructPinAuthTokenNonce(userId, pinCreationDate, req);
    const secret = this.constructPinAuthTokenSecret(
      userId,
      userCreationDate,
      req,
    );

    const uniqueId = this.constructUniqueID(
      this.urlService.getUserAgent(req),
      this.urlService.getIpAddress(req),
    );

    const encryptedPin = this.encryption.encrypt({ userId }, secret, nonce);

    const token = req?.headers['x-pin-token']?.toString() || '';
    if (!token) {
      throw new ForbiddenException('Forbidden!');
    }

    const tokenDetails = await this.jwtService.verify<{ content: string }>(
      token,
      this.passwordSecret,
      uniqueId,
    );

    if (!tokenDetails) {
      throw new ForbiddenException('Forbidden!');
    }
    const { content } = tokenDetails;

    if (content !== encryptedPin) {
      throw new ForbiddenException('Forbidden!');
    }
    const savedCachedPin = await this.memoryCache.get<string>(encryptedPin);

    if (!savedCachedPin) {
      throw new ForbiddenException('Forbidden!');
    }

    const isValidToken = await this.encryption.verifyHash(
      savedCachedPin,
      encryptedPin,
      uniqueId,
    );

    if (!isValidToken) {
      throw new ForbiddenException('Forbidden!');
    }

    return userId;
  }
}
