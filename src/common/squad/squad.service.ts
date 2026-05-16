import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  SQUAD_BASE_URL,
  SQUAD_BENEFICIARY_ACCOUNT,
  SQUAD_SECRET_KEY,
} from '../../shared/constants';
import {
  SquadAccountLookupData,
  SquadAccountLookupPayload,
  SquadApiResponse,
  SquadCreateVirtualAccountPayload,
  SquadTransferData,
  SquadTransferPayload,
  SquadVirtualAccountData,
} from './squad.dto';

@Injectable()
export class SquadService {
  private readonly logger = new Logger(SquadService.name);
  private readonly secretKey?: string;
  private readonly baseUrl: string;
  private readonly defaultBeneficiaryAccount?: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>(SQUAD_SECRET_KEY);
    this.secretKey = key && key.trim() !== '' ? key : undefined;
    this.enabled = !!this.secretKey;
    this.baseUrl = this.configService
      .get<string>(SQUAD_BASE_URL)
      .replace(/\/$/, '');
    const beneficiary = this.configService.get<string>(
      SQUAD_BENEFICIARY_ACCOUNT,
    );
    this.defaultBeneficiaryAccount = beneficiary || undefined;
  }

  isEnabled() {
    return this.enabled;
  }

  getDefaultBeneficiaryAccount() {
    return this.defaultBeneficiaryAccount;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<SquadApiResponse<T>> {
    if (!this.enabled || !this.secretKey) {
      throw new ServiceUnavailableException(
        'Squad integration is not configured (SQUAD_SECRET_KEY missing). Set the env var to enable virtual accounts and transfers.',
      );
    }
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      this.logger.error(
        `Squad request failed (${method} ${path}): ${(error as Error).message}`,
      );
      throw new BadGatewayException('Unable to reach the bank service.');
    }

    let parsed: SquadApiResponse<T> | undefined;
    try {
      parsed = (await response.json()) as SquadApiResponse<T>;
    } catch {
      parsed = undefined;
    }

    if (!response.ok || !parsed?.success) {
      const message = parsed?.message || 'Bank service rejected the request.';
      this.logger.warn(
        `Squad ${method} ${path} returned ${response.status}: ${message}`,
      );
      if (response.status === 400) {
        throw new BadRequestException(message);
      }
      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(message);
      }
      throw new InternalServerErrorException(message);
    }

    return parsed;
  }

  // POST /virtual-account — individual virtual account
  async createIndividualVirtualAccount(
    payload: SquadCreateVirtualAccountPayload,
  ) {
    const response = await this.request<SquadVirtualAccountData>(
      'POST',
      '/virtual-account',
      payload,
    );
    return response.data;
  }

  // POST /payout/account/lookup — verify recipient before initiating a transfer
  async lookupAccount(payload: SquadAccountLookupPayload) {
    const response = await this.request<SquadAccountLookupData>(
      'POST',
      '/payout/account/lookup',
      payload,
    );
    return response.data;
  }

  // POST /payout/transfer — initiate an outbound transfer
  async transferFunds(payload: SquadTransferPayload) {
    const response = await this.request<SquadTransferData>(
      'POST',
      '/payout/transfer',
      payload,
    );
    return response.data;
  }

  // POST /payout/requery — re-check transfer status
  async requeryTransfer(transactionReference: string) {
    const response = await this.request<SquadTransferData>(
      'POST',
      '/payout/requery',
      { transaction_reference: transactionReference },
    );
    return response.data;
  }

  // Webhook signature verification. Squad signs the whole serialized body with
  // HMAC-SHA512 using the secret key and sends the uppercase hex in the
  // `x-squad-encrypted-body` (a.k.a. `x-squad-signature`) header.
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined) {
    if (!signatureHeader) return false;
    const expected = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex')
      .toUpperCase();
    const provided = signatureHeader.toUpperCase();
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  }
}
