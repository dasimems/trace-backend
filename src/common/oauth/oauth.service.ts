import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  APPLE_CLIENT_ID,
  GOOGLE_CLIENT_ID,
} from '../../shared/constants';
import { OAuthProvider, OAuthVerifiedUser } from './oauth.dto';

// JWKS endpoints + expected `iss` claims for each provider. Source:
// https://accounts.google.com/.well-known/openid-configuration
// https://appleid.apple.com/.well-known/openid-configuration
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

interface GoogleIdTokenClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
}

interface AppleIdTokenClaims extends JWTPayload {
  email?: string;
  email_verified?: 'true' | 'false' | boolean;
  is_private_email?: 'true' | 'false' | boolean;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly googleClientId?: string;
  private readonly appleClientId?: string;
  // Lazy JWKS caches — jose handles HTTP caching internally per the JWKS spec.
  private readonly googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  private readonly appleJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));

  constructor(private readonly configService: ConfigService) {
    const google = this.configService.get<string>(GOOGLE_CLIENT_ID);
    const apple = this.configService.get<string>(APPLE_CLIENT_ID);
    this.googleClientId = google && google.trim() !== '' ? google : undefined;
    this.appleClientId = apple && apple.trim() !== '' ? apple : undefined;
  }

  isEnabled(provider: OAuthProvider) {
    return provider === 'google' ? !!this.googleClientId : !!this.appleClientId;
  }

  async verifyGoogleIdToken(idToken: string): Promise<OAuthVerifiedUser> {
    if (!this.googleClientId) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on this server.',
      );
    }
    if (!idToken) {
      throw new BadRequestException('Missing Google ID token.');
    }

    let payload: GoogleIdTokenClaims;
    try {
      const result = await jwtVerify<GoogleIdTokenClaims>(
        idToken,
        this.googleJwks,
        {
          issuer: GOOGLE_ISSUERS,
          audience: this.googleClientId,
        },
      );
      payload = result.payload;
    } catch (error) {
      this.logger.warn(
        `Google ID token verification failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Invalid Google sign-in.');
    }

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException(
        'Google sign-in is missing an email — request the `email` scope.',
      );
    }

    return {
      provider: 'google',
      providerUserId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      firstName: payload.given_name,
      lastName: payload.family_name,
    };
  }

  async verifyAppleIdToken(idToken: string): Promise<OAuthVerifiedUser> {
    if (!this.appleClientId) {
      throw new ServiceUnavailableException(
        'Apple sign-in is not configured on this server.',
      );
    }
    if (!idToken) {
      throw new BadRequestException('Missing Apple ID token.');
    }

    let payload: AppleIdTokenClaims;
    try {
      const result = await jwtVerify<AppleIdTokenClaims>(
        idToken,
        this.appleJwks,
        {
          issuer: APPLE_ISSUER,
          audience: this.appleClientId,
        },
      );
      payload = result.payload;
    } catch (error) {
      this.logger.warn(
        `Apple ID token verification failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Invalid Apple sign-in.');
    }

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException(
        'Apple sign-in is missing an email. The user must share an email with the app on first sign-in.',
      );
    }

    // Apple sends email_verified as the STRING "true" — coerce defensively.
    const verified =
      payload.email_verified === true || payload.email_verified === 'true';

    return {
      provider: 'apple',
      providerUserId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: verified,
    };
  }
}
