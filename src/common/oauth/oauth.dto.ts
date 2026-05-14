export type OAuthProvider = 'google' | 'apple';

export interface OAuthVerifiedUser {
  provider: OAuthProvider;
  // Stable per-provider user identifier (Google: sub, Apple: sub).
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}
