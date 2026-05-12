export interface ChangePasswordEncryptionPayload {
  userId: string;
  createdAt: Date;
}

export interface ChangePasswordEncryptedDTO {
  token: string;
  expiresAt: string;
}
