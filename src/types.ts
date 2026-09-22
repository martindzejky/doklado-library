export const INVOICE_TYPES = [
  'issued_invoice',
  'issued_credit',
  'issued_debit',
  'issued_advance',
  'issued_tax_document',
] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const PAYMENT_TYPES = [
  'cash',
  'card',
  'transfer',
  'cash_on_delivery',
] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

/**
 * Explicit options win over the environment.
 * The SDK reads `DOKLADO_API_KEY`, `DOKLADO_API_URL`, and
 * `DOKLADO_ORGANIZATION_ID` from `process.env`. It does not load `.env`.
 */
export type ClientConfig = {
  /** Sent as the `api_key` header. Falls back to `DOKLADO_API_KEY`. */
  apiKey?: string;
  /** API origin with no path. Falls back to `DOKLADO_API_URL`. */
  baseUrl?: string;
  /**
   * Organisation IČO used when a call omits `organizationId`.
   * Falls back to `DOKLADO_ORGANIZATION_ID`.
   */
  organizationId?: string;
  /** Request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
};

export type InvoiceCustomer = {
  name?: string | null;
  ico?: string | null;
  dic?: string | null;
  icDph?: string | null;
  vatPayer?: boolean | null;
  nonCorporateEntity?: boolean | null;
  streetName?: string | null;
  propertyRegistrationNumber?: string | null;
  buildingNumber?: string | null;
  postalCode?: string | null;
  municipality?: string | null;
  country?: string | null;
  countryCode?: string | null;
  registerNumberText?: string | null;
  vatRegistrationType?: string | null;
  contactEmail?: string | null;
};

export type InvoiceItem = {
  name: string;
  unitPriceWithoutVat: number;
  quantity: number;
  vatRate?: number | null;
  unit?: string | null;
  note?: string | null;
};

/** Series selection. `numericCodeId` is the series export abbreviation. */
export type InvoiceAccountingSettings = {
  numericCodeId?: string | null;
};

export type InvoicePaymentInfo = {
  iban?: string | null;
  variableSymbol?: string | null;
};

/**
 * Fields for issuing an ordinary invoice and knowing the customer email
 * to send the PDF to. Other issue-invoice fields known from the mock
 * schema are intentionally omitted.
 */
export type CreateInvoiceInput = {
  organizationId?: string;
  type: InvoiceType;
  items: readonly InvoiceItem[];
  customer: InvoiceCustomer;
  issueDate?: string | null;
  dueDate?: string | null;
  deliveryDate?: string | null;
  number?: string | null;
  accountingSettings?: InvoiceAccountingSettings;
  paymentInfo?: InvoicePaymentInfo;
  note?: string | null;
  noteAboveItems?: string | null;
  internalNote?: string | null;
  currency?: string | null;
  paid?: boolean | null;
  paymentType?: PaymentType | null;
};

export type DownloadPdfInput = {
  documentId: string;
  organizationId?: string;
};

export type Result<T> = {
  statusCode: number;
  data: T;
};

export type IssuedInvoice = {
  documentId: string;
  invoiceNumber: string;
};

export type BinaryResult = {
  statusCode: number;
  data: Uint8Array;
  contentType: string;
  encoding: string;
};
