export interface OTPEncryptionDTO {
  code: string;
  userId: string;
}

export interface OTPEncryptedDTP {
  token: string;
  expiresAt: Date;
}
