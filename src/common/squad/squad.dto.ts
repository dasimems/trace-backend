// Wire-level shapes from https://docs.squadco.com
// Squad uses '1' for Male and '2' for Female; dob is mm/dd/yyyy.
// Amounts for /payout are sent as STRINGS in kobo (e.g. "10000" = ₦100).

export type SquadGender = '1' | '2';

export interface SquadCreateVirtualAccountPayload {
  first_name: string;
  last_name: string;
  middle_name: string;
  mobile_num: string;
  dob: string;
  email: string;
  bvn: string;
  gender: SquadGender;
  address: string;
  customer_identifier: string;
  beneficiary_account?: string;
}

export interface SquadVirtualAccountData {
  first_name: string;
  last_name: string;
  bank_code: string;
  virtual_account_number: string;
  beneficiary_account: string | null;
  customer_identifier: string;
  created_at: string;
  updated_at: string;
}

// GET /payout/banks — returns the full NIP-supported bank list with their NIP
// institution codes. List is stable; suitable for long-lived caching.
export interface SquadBank {
  bank_code: string;
  name: string;
}

export interface SquadAccountLookupPayload {
  bank_code: string;
  account_number: string;
}

export interface SquadAccountLookupData {
  account_name: string;
  account_number: string;
}

export interface SquadTransferPayload {
  transaction_reference: string;
  amount: string;
  bank_code: string;
  account_number: string;
  account_name: string;
  currency_id: 'NGN';
  remark: string;
}

export interface SquadTransferData {
  transaction_reference: string;
  response_description: string;
  nip_transaction_reference?: string;
  amount: string;
  account_number: string;
  account_name: string;
  destination_institution_name?: string;
}

// POST /transaction/initiate — start a checkout (card / bank / USSD).
// Amount is sent in KOBO as an integer (Squad's docs are explicit on this for
// /transaction/initiate even though /payout/transfer uses a string).
export type SquadPaymentChannel =
  | 'card'
  | 'bank'
  | 'ussd'
  | 'transfer'
  | 'qr';

export interface SquadInitiatePaymentPayload {
  amount: number;
  email: string;
  currency: 'NGN';
  transaction_ref: string;
  callback_url?: string;
  initiate_type?: 'inline' | 'redirect';
  customer_name?: string;
  payment_channels?: SquadPaymentChannel[];
  metadata?: Record<string, unknown>;
  pass_charge?: boolean;
}

export interface SquadInitiatePaymentData {
  // Hosted checkout the user gets redirected to.
  checkout_url?: string;
  authorization_url?: string;
  access_token?: string;
  transaction_ref: string;
  amount: number;
  currency: 'NGN';
  callback_url?: string;
  merchant_info?: Record<string, unknown>;
}

// GET /transaction/verify/:ref — Squad's response shape varies in case; key
// names are documented as PascalCase but sandbox sometimes returns snake_case.
// Treat the status string case-insensitively.
export interface SquadVerifyPaymentData {
  transaction_status?: string; // 'Success' | 'Pending' | 'Failed'
  transaction_amount?: number;
  transaction_currency_id?: string;
  transaction_ref?: string;
  email?: string;
  merchant_amount?: number;
  created_at?: string;
  // Sandbox + some live responses also bubble up gateway details.
  gateway_ref?: string;
  payment_information?: {
    payment_type?: string;
  };
}

// Webhook from Squad's payment gateway. Distinct shape from the
// virtual-account credit webhook — uses Event + TransactionRef + Body envelope.
export interface SquadPaymentWebhookPayload {
  Event?: string; // e.g. 'charge_successful'
  TransactionRef?: string;
  Body?: {
    amount?: number;
    transaction_ref?: string;
    email?: string;
    currency?: string;
    status?: string; // 'Success' | 'Failed'
    gateway_ref?: string;
    payment_type?: string;
    customer?: { name?: string; email?: string };
  };
  // Allow unknown top-level keys — Squad sometimes ships extra metadata.
  [key: string]: unknown;
}

export interface SquadApiResponse<T> {
  status?: number;
  success: boolean;
  message: string;
  data: T;
}

// Webhook payload shape from a virtual-account credit notification.
// See https://docs.squadco.com/Virtual-accounts/api-specifications
export interface SquadVirtualAccountWebhookPayload {
  transaction_reference: string;
  virtual_account_number: string;
  principal_amount: string;
  settled_amount: string;
  fee_charged?: string;
  currency?: string;
  channel?: string;
  customer_identifier: string;
  sender_name?: string;
  sender_account_number?: string;
  sender_bank?: string;
  sender_bank_code?: string;
  remark?: string;
  transaction_date?: string;
  encrypted_body?: string;
  frozen_transaction?: boolean;
  [key: string]: unknown;
}
