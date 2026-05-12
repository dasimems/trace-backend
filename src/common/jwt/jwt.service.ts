import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EncryptJWT, jwtDecrypt, JWTPayload } from 'jose';
import { EncryptionService } from '../encryption/encryption.service';
import { JWTEncryptionDataDTO } from './jwt.dto';

/**
 * Wraps `jose`'s EncryptJWT with an extra layer of our own AES-GCM encryption.
 * Two layers means a single broken layer doesn't expose the payload, and the
 * tokens are also bound to a per-request `uniqueID` (ip + ua + secret) so
 * lifted tokens are useless on another device.
 */
@Injectable()
export class JwtService {
  constructor(private encryption: EncryptionService) {}
  private convertTo32ByteKey(key: string) {
    const hash = createHash('sha256').update(key).digest();
    return hash;
  }

  private generateEncryptionSecret(secret: string, uniqueID: string) {
    return {
      key: secret,
      iv: `${secret}-${uniqueID}`,
    };
  }
  private generateEncryptionNonce(secret: string, uniqueID: string) {
    return {
      key: secret,
      iv: `${secret}-${uniqueID}`,
    };
  }

  async sign<T>(
    payload: T,
    secret: string,
    uniqueID: string,
    expiresIn: string | number | Date = '1h',
  ): Promise<string> {
    const encryptingKey = this.convertTo32ByteKey(secret);

    const encryptionSecret = this.generateEncryptionSecret(secret, uniqueID);
    const encryptionNonce = this.generateEncryptionNonce(secret, uniqueID);

    const encodedData = this.encryption.encrypt(
      payload,
      encryptionSecret,
      encryptionNonce,
    );

    const dataToEncrypt: JWTEncryptionDataDTO & JWTPayload = {
      data: encodedData,
    };

    return await new EncryptJWT(dataToEncrypt)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .encrypt(encryptingKey);
  }

  async verify<T>(
    token: string,
    secret: string,
    uniqueID: string,
  ): Promise<T | undefined> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const encryptingKey = this.convertTo32ByteKey(secret);

      const jwtDecrypted = await jwtDecrypt<JWTEncryptionDataDTO>(
        token,
        encryptingKey,
      );

      const { payload } = jwtDecrypted;

      if (!jwtDecrypted || !payload.exp || payload.exp < currentTime) {
        return undefined;
      }

      const encryptionSecret = this.generateEncryptionSecret(secret, uniqueID);
      const encryptionNonce = this.generateEncryptionNonce(secret, uniqueID);

      const { data } = payload;

      const decryptedPayload = this.encryption.decrypt<T>(
        data,
        encryptionSecret,
        encryptionNonce,
      );

      return decryptedPayload;
    } catch {
      return undefined;
    }
  }
}
