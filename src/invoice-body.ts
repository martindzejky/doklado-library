import { InputError } from './errors.ts';
import { isRecord } from './record.ts';
import {
  INVOICE_TYPES,
  PAYMENT_TYPES,
  type CreateInvoiceInput,
  type InvoiceCustomer,
  type InvoiceItem,
  type InvoicePaymentInfo,
  type InvoiceAccountingSettings,
  type InvoiceType,
  type PaymentType,
} from './types.ts';

const CUSTOMER_STRING_FIELDS = [
  'name',
  'ico',
  'dic',
  'icDph',
  'streetName',
  'propertyRegistrationNumber',
  'buildingNumber',
  'postalCode',
  'municipality',
  'country',
  'countryCode',
  'registerNumberText',
  'vatRegistrationType',
  'contactEmail',
] as const;

const CUSTOMER_BOOLEAN_FIELDS = ['vatPayer', 'nonCorporateEntity'] as const;

const INVOICE_STRING_FIELDS = [
  'issueDate',
  'dueDate',
  'deliveryDate',
  'number',
  'note',
  'noteAboveItems',
  'internalNote',
  'currency',
] as const;

function isInvoiceType(value: unknown): value is InvoiceType {
  if (typeof value !== 'string') {
    return false;
  }

  for (const candidate of INVOICE_TYPES) {
    if (value === candidate) {
      return true;
    }
  }

  return false;
}

function isPaymentType(value: unknown): value is PaymentType {
  if (typeof value !== 'string') {
    return false;
  }

  for (const candidate of PAYMENT_TYPES) {
    if (value === candidate) {
      return true;
    }
  }

  return false;
}

function put<T, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string | null | undefined {
  if (!Object.hasOwn(source, key)) {
    return undefined;
  }

  const value = source[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'string') {
    return value;
  }

  throw new InputError(`${label} must be a string or null.`);
}

function optionalBoolean(
  source: Record<string, unknown>,
  key: string,
  label: string,
): boolean | null | undefined {
  if (!Object.hasOwn(source, key)) {
    return undefined;
  }

  const value = source[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  throw new InputError(`${label} must be a boolean or null.`);
}

function optionalNumber(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new InputError(`${label} must be a finite number or null.`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new InputError(`${label} must be a string.`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InputError(`${label} must be a finite number.`);
  }

  return value;
}

function buildCustomer(value: unknown): InvoiceCustomer {
  if (!isRecord(value)) {
    throw new InputError('customer must be an object.');
  }

  const customer: InvoiceCustomer = {};

  for (const key of CUSTOMER_STRING_FIELDS) {
    put(customer, key, optionalString(value, key, `customer.${key}`));
  }

  for (const key of CUSTOMER_BOOLEAN_FIELDS) {
    put(customer, key, optionalBoolean(value, key, `customer.${key}`));
  }

  return customer;
}

function buildItem(value: unknown, index: number): InvoiceItem {
  if (!isRecord(value)) {
    throw new InputError(`items[${index}] must be an object.`);
  }

  const item: InvoiceItem = {
    name: requireString(value.name, `items[${index}].name`),
    unitPriceWithoutVat: requireNumber(
      value.unitPriceWithoutVat,
      `items[${index}].unitPriceWithoutVat`,
    ),
    quantity: requireNumber(value.quantity, `items[${index}].quantity`),
  };

  put(
    item,
    'vatRate',
    optionalNumber(value.vatRate, `items[${index}].vatRate`),
  );
  put(item, 'unit', optionalString(value, 'unit', `items[${index}].unit`));
  put(item, 'note', optionalString(value, 'note', `items[${index}].note`));

  return item;
}

function buildItems(value: unknown): InvoiceItem[] {
  if (!Array.isArray(value)) {
    throw new InputError('items must be an array.');
  }

  const items: InvoiceItem[] = [];
  for (let index = 0; index < value.length; index += 1) {
    items.push(buildItem(value[index], index));
  }

  return items;
}

function buildPaymentInfo(value: unknown): InvoicePaymentInfo | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new InputError('paymentInfo must be an object.');
  }

  const paymentInfo: InvoicePaymentInfo = {};
  put(paymentInfo, 'iban', optionalString(value, 'iban', 'paymentInfo.iban'));
  put(
    paymentInfo,
    'variableSymbol',
    optionalString(value, 'variableSymbol', 'paymentInfo.variableSymbol'),
  );

  if (Object.keys(paymentInfo).length === 0) {
    return undefined;
  }

  return paymentInfo;
}

function readPaymentType(value: unknown): PaymentType | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (isPaymentType(value)) {
    return value;
  }

  throw new InputError(
    'paymentType must be cash, card, transfer, cash_on_delivery, or null.',
  );
}

function buildAccountingSettings(
  value: unknown,
): InvoiceAccountingSettings | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new InputError('accountingSettings must be an object.');
  }

  if (!Object.hasOwn(value, 'numericCodeId')) {
    return undefined;
  }

  const numericCodeId = optionalString(
    value,
    'numericCodeId',
    'accountingSettings.numericCodeId',
  );

  if (numericCodeId === undefined) {
    return undefined;
  }

  return { numericCodeId };
}

function assertTransferIban(
  paymentType: PaymentType | null | undefined,
  paymentInfo: InvoicePaymentInfo | undefined,
): void {
  if (paymentType !== 'transfer') {
    return;
  }

  const iban = paymentInfo?.iban;
  if (typeof iban === 'string' && iban.length > 0) {
    return;
  }

  throw new InputError(
    'paymentInfo.iban is required when paymentType is transfer.',
  );
}

export function parseInvoiceInput(input: unknown): CreateInvoiceInput {
  if (!isRecord(input)) {
    throw new InputError('invoice must be an object.');
  }

  if (!isInvoiceType(input.type)) {
    throw new InputError(
      'type must be issued_invoice, issued_credit, issued_debit, issued_advance, or issued_tax_document.',
    );
  }

  const paymentType = readPaymentType(input.paymentType);
  const paymentInfo = buildPaymentInfo(input.paymentInfo);
  assertTransferIban(paymentType, paymentInfo);

  const data: CreateInvoiceInput = {
    type: input.type,
    customer: buildCustomer(input.customer),
    items: buildItems(input.items),
  };

  if (input.organizationId !== undefined) {
    data.organizationId = requireString(input.organizationId, 'organizationId');
  }

  for (const key of INVOICE_STRING_FIELDS) {
    put(data, key, optionalString(input, key, key));
  }

  put(data, 'paid', optionalBoolean(input, 'paid', 'paid'));
  put(data, 'paymentType', paymentType);
  put(data, 'paymentInfo', paymentInfo);
  put(
    data,
    'accountingSettings',
    buildAccountingSettings(input.accountingSettings),
  );

  return data;
}
