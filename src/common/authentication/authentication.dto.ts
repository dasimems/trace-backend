import { FastifyRequest } from 'fastify';

export interface AuthenticationDataDTO {
  email: string;
  id: string;
  role?: string;
}

/**
 * Minimal shape the authentication layer needs to mint and validate tokens.
 * Add your own fields (firstName, lastName, etc.) by extending this in a
 * domain-specific DTO; the auth flow itself only reads `id`, `email`, `role`,
 * `createdAt`, `isEmailVerified`.
 */
export interface AuthUserDetails {
  id: string;
  email?: string;
  role?: string;
  createdAt?: Date;
  isEmailVerified?: boolean;
}

export interface CustomRequest extends FastifyRequest {
  auth?: AuthenticationDataDTO;
}

export interface MagicLinkEncryptionDataDTO {
  data: string;
}

export interface MagicLinkData {
  email: string | undefined;
  createdAt: Date | undefined;
  id: string;
  isEmailVerified: boolean | undefined;
  role: string | undefined;
}
