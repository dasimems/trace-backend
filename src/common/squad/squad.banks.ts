import { SquadBank } from './squad.dto';

// NIBSS-governed bank codes. Stable list maintained by the Nigerian central
// payments rail (NIP) — banks are added/removed slowly, so periodic manual
// updates are fine. Used as the fallback when Squad's /payout/banks endpoint
// is unreachable, returns 404, or the SQUAD_SECRET_KEY is unset.
//
// Last reviewed: 2026-05. If you add an entry, keep the list alphabetical
// by `name` so the UI dropdown stays consistent.
export const STATIC_NIP_BANKS: SquadBank[] = [
  { bank_code: '044', name: 'Access Bank' },
  { bank_code: '063', name: 'Access Bank (Diamond)' },
  { bank_code: '023', name: 'Citibank Nigeria' },
  { bank_code: '050', name: 'Ecobank Nigeria' },
  { bank_code: '562', name: 'Ekondo Microfinance Bank' },
  { bank_code: '070', name: 'Fidelity Bank' },
  { bank_code: '011', name: 'First Bank of Nigeria' },
  { bank_code: '214', name: 'First City Monument Bank' },
  { bank_code: '00103', name: 'Globus Bank' },
  { bank_code: '058', name: 'Guaranty Trust Bank' },
  { bank_code: '030', name: 'Heritage Bank' },
  { bank_code: '301', name: 'Jaiz Bank' },
  { bank_code: '082', name: 'Keystone Bank' },
  { bank_code: '50211', name: 'Kuda Bank' },
  { bank_code: '50515', name: 'Moniepoint MFB' },
  { bank_code: '999992', name: 'OPay' },
  { bank_code: '100002', name: 'PalmPay' },
  { bank_code: '076', name: 'Polaris Bank' },
  { bank_code: '101', name: 'Providus Bank' },
  { bank_code: '125', name: 'Rubies Microfinance Bank' },
  { bank_code: '221', name: 'Stanbic IBTC Bank' },
  { bank_code: '068', name: 'Standard Chartered Bank' },
  { bank_code: '232', name: 'Sterling Bank' },
  { bank_code: '100', name: 'SunTrust Bank' },
  { bank_code: '102', name: 'Titan Trust Bank' },
  { bank_code: '032', name: 'Union Bank of Nigeria' },
  { bank_code: '033', name: 'United Bank for Africa' },
  { bank_code: '215', name: 'Unity Bank' },
  { bank_code: '566', name: 'VFD Microfinance Bank' },
  { bank_code: '035', name: 'Wema Bank' },
  { bank_code: '057', name: 'Zenith Bank' },
];
