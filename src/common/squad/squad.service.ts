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
import { STATIC_NIP_BANKS } from './squad.banks';
import {
  SquadAccountLookupData,
  SquadAccountLookupPayload,
  SquadApiResponse,
  SquadBank,
  SquadCreateVirtualAccountPayload,
  SquadInitiatePaymentData,
  SquadInitiatePaymentPayload,
  SquadTransferData,
  SquadTransferPayload,
  SquadVerifyPaymentData,
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

  // Bank list with NIP institution codes. The exact Squad endpoint for this
  // has shifted between docs versions and `GET /payout/banks` is not currently
  // reachable in our environment (returns 404). Until we confirm the live path
  // we serve the curated NIBSS-governed static list — codes are governed by
  // NIBSS, not Squad, so they're identical across PSPs anyway. When Squad's
  // endpoint is confirmed, swap the call below and keep the static list as
  // the fallback so a transient outage never breaks the transfer screen.
  async listBanks(): Promise<SquadBank[]> {
    // Short-circuit when Squad isn't configured at all — the static list still
    // works for the dev/demo path.
    if (!this.enabled) return STATIC_NIP_BANKS;
    try {
      const response = await this.request<SquadBank[]>('GET', '/payout/banks');
      const live = response.data;
      if (Array.isArray(live) && live.length > 0) return live;
      return STATIC_NIP_BANKS;
    } catch (err) {
      this.logger.warn(
        `Squad bank-list call failed (${(err as Error).message}); serving NIBSS static fallback.`,
      );
      return STATIC_NIP_BANKS;
    }
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

  // POST /transaction/initiate — create a hosted checkout for an inbound
  // payment. Returns a checkout/authorization URL the frontend redirects to.
  async initiatePayment(
    payload: SquadInitiatePaymentPayload,
  ): Promise<SquadInitiatePaymentData> {
    const response = await this.request<SquadInitiatePaymentData>(
      'POST',
      '/transaction/initiate',
      payload,
    );
    return response.data;
  }

  // GET /transaction/verify/:reference — pull final state for a payment. Used
  // both for the callback-after-redirect path AND as a safety net when the
  // webhook hasn't arrived yet.
  async verifyPayment(transactionRef: string): Promise<SquadVerifyPaymentData> {
    const response = await this.request<SquadVerifyPaymentData>(
      'GET',
      `/transaction/verify/${encodeURIComponent(transactionRef)}`,
    );
    return response.data ?? {};
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
