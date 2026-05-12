import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthenticationDataDTO,
  AuthUserDetails,
  CustomRequest,
  MagicLinkData,
  MagicLinkEncryptionDataDTO,
} from './authentication.dto';
import { JwtService } from '../jwt/jwt.service';
import {
  AUTH_HASH_KEY,
  AUTH_SECRET_KEY,
  REDIS_CACHE,
} from '../../shared/constants';
import { UrlService } from '../url/url.service';
import Keyv from 'keyv';
import { EncryptionService } from '@common/encryption/encryption.service';

@Injectable()
export class AuthenticationService {
  private authSecret: string;
  private authHash: string;
  authTokenCookieKey = 'auth_token';
  tokenValidity = 7 * 24 * 60 * 60;
  private magicTokenValidity = 10 * 60;
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly urlService: UrlService,
    private readonly encryptionService: EncryptionService,
    @Inject(REDIS_CACHE) private readonly redisCache: Keyv,
  ) {
    this.authSecret = this.configService.get<string>(AUTH_SECRET_KEY)!;
    this.authHash = this.configService.get<string>(AUTH_HASH_KEY)!;
  }

  // Binds the auth token to the device/network so a lifted token is useless
  // elsewhere. Used by both the http path and the websocket path.
  private constructUniqueID(userAgent: string, ip: string) {
    return `${userAgent}-${this.authHash}-${ip}`;
  }

  private constructWebSocketUniqueId(
    req: CustomRequest,
    handShakeAddress: string,
  ) {
    const userAgent = this.urlService.getUserAgent(req);
    return this.constructUniqueID(userAgent, handShakeAddress);
  }

  private constructMagicLinkTokenUniqueId(
    userAgent: string,
    ip: string,
    id: string,
  ) {
    return `${userAgent}-${id}-${ip}`;
  }

  private constructUniqueIdentifier(req: CustomRequest) {
    const userAgent = this.urlService.getUserAgent(req);
    const ip = this.urlService.getIpAddress(req);
    return this.constructUniqueID(userAgent, ip);
  }

  // Stores the issued token in Redis. Acts as a session store + final line of
  // defense: even if both JWT and our AES layers were broken, a fabricated
  // token would still fail this lookup.
  async storeAuthSession(
    token: string,
    userDetails: Required<AuthUserDetails>,
  ) {
    return await this.redisCache.set(
      token,
      userDetails,
      this.tokenValidity * 1000,
    );
  }

  async invalidateAuthSession(req: CustomRequest) {
    const token = this.getUserToken(req)!;
    return await this.redisCache.delete(token);
  }

  async getAuthSession(req: CustomRequest, shouldThrowError: boolean = true) {
    const token = this.getUserToken(req, shouldThrowError);
    if (!token) {
      return undefined;
    }
    return await this.redisCache.get<Required<AuthUserDetails>>(token);
  }

  async generateAuthToken(
    req: CustomRequest,
    userDetails: Required<AuthUserDetails>,
  ) {
    const iat = Math.floor(Date.now() / 1000);
    const payload: AuthenticationDataDTO = {
      email: userDetails?.email,
      id: userDetails?.id,
      role: userDetails?.role,
    };
    const uniqueId = this.constructUniqueIdentifier(req);
    const token = await this.jwtService.sign(
      payload,
      this.authSecret,
      uniqueId,
      iat + this.tokenValidity,
    );

    await this.storeAuthSession(token, userDetails);
    return token;
  }

  private async completeTokenVerification(
    token: string,
    req: CustomRequest,
    uniqueId: string,
    shouldThrowError: boolean = true,
  ) {
    const payload = await this.jwtService.verify<AuthenticationDataDTO>(
      token,
      this.authSecret,
      uniqueId,
    );
    if (!payload) {
      if (shouldThrowError) {
        throw new UnauthorizedException('Unauthorized!');
      }
      return undefined;
    }
    const userDetails = await this.getAuthSession(req, shouldThrowError);

    if (!userDetails || !payload || userDetails?.id !== payload?.id) {
      if (userDetails) {
        await this.invalidateAuthSession(req);
      }
      if (shouldThrowError) {
        throw new UnauthorizedException('Unauthorized!');
      }
      return undefined;
    }

    return this.generateAuthData(userDetails);
  }

  async verifyWebSocketToken(
    req: CustomRequest,
    token: string,
    handShakeAddress: string,
  ) {
    const uniqueId = this.constructWebSocketUniqueId(req, handShakeAddress);
    return await this.completeTokenVerification(token, req, uniqueId, false);
  }

  async verifyToken(
    req: CustomRequest,
    token: string,
    shouldThrowError: boolean = true,
  ) {
    const uniqueId = this.constructUniqueIdentifier(req);
    return await this.completeTokenVerification(
      token,
      req,
      uniqueId,
      shouldThrowError,
    );
  }

  isAuthorized(
    authData: AuthenticationDataDTO,
    role: string | string[] = 'ADMIN',
    shouldThrowError: boolean = true,
  ) {
    const hasAuthData = authData && authData?.role;
    const isStringAuthorized =
      hasAuthData && !Array.isArray(role) && authData?.role === role;
    const isArrayAuthorized =
      hasAuthData &&
      Array.isArray(role) &&
      authData?.role &&
      role.includes(authData?.role);
    if (!isArrayAuthorized && !isStringAuthorized) {
      if (shouldThrowError) {
        throw new ForbiddenException('Unknown request!');
      }
      return false;
    }
    return true;
  }

  getUserToken(request: CustomRequest, shouldThrowError: boolean = true) {
    const authHeader =
      request?.cookies?.[this.authTokenCookieKey] ||
      request?.headers?.authorization;

    if (!authHeader || (authHeader && !authHeader.startsWith('Bearer '))) {
      if (!shouldThrowError) {
        return undefined;
      }
      throw new UnauthorizedException('Unauthorized!');
    }

    const token = authHeader.split(' ')[1];
    return token;
  }

  private generateAuthData(
    userDetails: Required<AuthUserDetails>,
  ): AuthenticationDataDTO {
    return {
      email: userDetails?.email,
      id: userDetails?.id,
      role: userDetails?.role,
    };
  }

  private constructMagicLinkData(userDetails: AuthUserDetails): MagicLinkData {
    const { email, createdAt, id, isEmailVerified, role } = userDetails;
    return { email, createdAt, id, isEmailVerified, role };
  }

  private getMagicLinkEncryptionSecret(
    userDetails: AuthUserDetails,
    uniqueId: string,
  ) {
    const { id, email } = userDetails;
    const secret = {
        key: `${id}-${email}`,
        iv: `${uniqueId}-${id}`,
      },
      nonce = {
        key: `${email}-${id}`,
        iv: `${uniqueId}-${email}`,
      };
    return { secret, nonce };
  }

  async constructMagicLinkToken(
    userDetails: AuthUserDetails,
    req: CustomRequest,
  ) {
    const ipAddress = this.urlService.getIpAddress(req);
    const userAgent = this.urlService.getUserAgent(req);
    const uniqueId = this.constructMagicLinkTokenUniqueId(
      userAgent,
      ipAddress,
      userDetails?.id,
    );
    const iat = Math.floor(Date.now() / 1000);
    const secreteKeyDetails = this.getMagicLinkEncryptionSecret(
      userDetails,
      uniqueId,
    );
    const magicLinkExtraData = this.constructMagicLinkData(userDetails);
    const encryptedData = this.encryptionService.encrypt(
      magicLinkExtraData,
      secreteKeyDetails?.secret,
      secreteKeyDetails?.nonce,
    );
    const payload: MagicLinkEncryptionDataDTO = { data: encryptedData };
    const token = await this.jwtService.sign(
      payload,
      this.authSecret,
      uniqueId,
      iat + this.magicTokenValidity,
    );

    await this.redisCache.set(
      encryptedData,
      magicLinkExtraData,
      this.magicTokenValidity * 1000,
    );
    return token;
  }

  async verifyMagicLinkToken(
    userDetails: AuthUserDetails,
    token: string,
    req: CustomRequest,
  ) {
    const ipAddress = this.urlService.getIpAddress(req);
    const userAgent = this.urlService.getUserAgent(req);
    const uniqueId = this.constructMagicLinkTokenUniqueId(
      userAgent,
      ipAddress,
      userDetails?.id,
    );
    const secreteKeyDetails = this.getMagicLinkEncryptionSecret(
      userDetails,
      uniqueId,
    );
    const tokenData = await this.jwtService.verify<MagicLinkEncryptionDataDTO>(
      token,
      this.authSecret,
      uniqueId,
    );

    if (!tokenData) {
      throw new UnauthorizedException('Unauthorized!');
    }

    const storedRedisCache = await this.redisCache.get<MagicLinkData>(
      tokenData?.data,
    );

    if (!storedRedisCache) {
      throw new UnauthorizedException('Unauthorized!');
    }

    const encryptedData = this.encryptionService.encrypt(
      storedRedisCache,
      secreteKeyDetails?.secret,
      secreteKeyDetails?.nonce,
    );

    if (encryptedData !== tokenData?.data) {
      throw new UnauthorizedException('Unauthorized!');
    }
    await this.redisCache.delete(tokenData?.data);

    return userDetails;
  }
}
