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
