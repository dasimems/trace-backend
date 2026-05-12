import { Injectable } from '@nestjs/common';
import {
  CipherKey,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from 'crypto';
import * as argon2 from 'argon2';
import { EncryptionPayload } from './encryption.dto';

@Injectable()
export class EncryptionService {
  private joinEncryptionKey = ':=:';
  private deriveKey(secret: string, nonce: string) {
    const hmac = createHmac('sha256', secret).update(nonce).digest();
    return hmac;
  }

  private deriveIV(secret: string, nonce: string) {
    const hmac = createHmac('sha256', secret).update(nonce).digest();
    return hmac.subarray(0, 12); // AES-GCM expects 12-byte IV
  }

  private generateHashContent(content: string, key: string) {
    return `${content}${this.joinEncryptionKey}${key}`;
  }

  encrypt<T>(
    content: T,
    secret: {
      key: string;
      iv: string;
    },
    nonce: {
      key: string;
      iv: string;
    },
  ): string {
    const { iv, key } = secret || {};
    const { iv: ivNonce, key: keyNonce } = nonce || {};
    if (!key || !iv || !keyNonce || !ivNonce) {
      throw new Error('Missing key/IV or nonce data for encryption');
    }
    const derivedIV = this.deriveIV(iv, ivNonce);
    const derivedKey = this.deriveKey(key, keyNonce);
    const cipher = createCipheriv(
      'aes-256-gcm',
      derivedKey as unknown as CipherKey,
      derivedIV,
    );

    let encrypted = cipher.update(JSON.stringify(content), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    const payload: EncryptionPayload = {
      content: `${encrypted}${this.joinEncryptionKey}${authTag}`,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

    return encoded;
  }

  decrypt<T>(
    encrypted: string,
    secret: {
      key: string;
      iv: string;
    },
    nonce: {
      key: string;
      iv: string;
    },
  ): T | undefined {
    try {
      const { iv, key } = secret || {};
      const { iv: ivNonce, key: keyNonce } = nonce || {};
      const decoded = Buffer.from(encrypted, 'base64').toString();
      const payload = JSON.parse(decoded) as EncryptionPayload;
      if (!key || !iv || !keyNonce || !ivNonce || !payload?.content) {
        throw new Error('Missing key/IV or nonce data for encryption');
      }
      const { content: payloadContent } = payload;
      const derivedIV = this.deriveIV(iv, ivNonce);
      const derivedKey = this.deriveKey(key, keyNonce);
      const decipher = createDecipheriv('aes-256-gcm', derivedKey, derivedIV);
      const [content, authTag] = payloadContent.split(this.joinEncryptionKey);
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(content, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted) as T;
    } catch {
      return undefined;
    }
  }

  async hash(content: string, salt: string) {
    try {
      const contentToHash = this.generateHashContent(content, salt);
      const hash = await argon2.hash(contentToHash);
      return hash;
    } catch (error) {
      console.log(error, 'has error');
      throw new Error('Unable to perform operation!');
    }
  }
  async verifyHash(hash: string, content: string, salt: string) {
    try {
      const hashedContent = this.generateHashContent(content, salt);
      const isVerified = await argon2.verify(hash, hashedContent);
      return isVerified;
    } catch {
      return false;
    }
  }
}
