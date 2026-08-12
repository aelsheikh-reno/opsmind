export const CURRENCIES = [
  "USD",
  "AED",
  "EUR",
  "GBP",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "EGP",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  AED: "UAE Dirham",
  EUR: "Euro",
  GBP: "British Pound",
  SAR: "Saudi Riyal",
  QAR: "Qatari Riyal",
  KWD: "Kuwaiti Dinar",
  BHD: "Bahraini Dinar",
  OMR: "Omani Rial",
  EGP: "Egyptian Pound",
};
