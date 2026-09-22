import { Buffer } from 'node:buffer';
import { InputError, ResponseError } from './errors.ts';
import { parseInvoiceInput } from './invoice-body.ts';
import type { HttpClient } from './http.ts';
import { isRecord } from './record.ts';
import type {
  BinaryResult,
  CreateInvoiceInput,
  DownloadPdfInput,
  IssuedInvoice,
  Result,
} from './types.ts';

type CallContext = {
  http: HttpClient;
  organizationId: string | undefined;
};

function resolveOrganizationId(
  fallback: string | undefined,
  provided: unknown,
): string {
  if (provided !== undefined) {
    if (typeof provided !== 'string') {
      throw new InputError('organizationId must be a string.');
    }

    return provided;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new InputError(
    'organizationId is required. Pass it on the call, set config.organizationId, or set DOKLADO_ORGANIZATION_ID.',
  );
}

function unreadableCreate(statusCode: number, body: unknown): ResponseError {
  return new ResponseError(
    'Doklado returned a create response the SDK could not read. The invoice may already exist.',
    {
      statusCode,
      body,
      uncertain: true,
    },
  );
}

function unreadablePdf(statusCode: number, body: unknown): ResponseError {
  return new ResponseError(
    'Doklado returned a PDF response the SDK could not read.',
    {
      statusCode,
      body,
      uncertain: false,
    },
  );
}

function readIssuedInvoice(value: unknown, statusCode: number): IssuedInvoice {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw unreadableCreate(statusCode, value);
  }

  const documentId = value.data.documentId;
  const invoiceNumber = value.data.invoiceNumber;

  if (typeof documentId !== 'string' || typeof invoiceNumber !== 'string') {
    throw unreadableCreate(statusCode, value);
  }

  return {
    documentId,
    invoiceNumber,
  };
}

function decodeBase64(value: string): Uint8Array | undefined {
  const normalized = value.replace(/[\r\n\t ]/g, '');

  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    return undefined;
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return undefined;
  }

  const buffer = Buffer.from(normalized, 'base64');
  const roundTrip = buffer.toString('base64').replace(/=+$/u, '');
  const compare = normalized.replace(/=+$/u, '');

  if (roundTrip !== compare) {
    return undefined;
  }

  return new Uint8Array(buffer);
}

function startsWithPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) {
    return false;
  }

  const header = Buffer.from(bytes.subarray(0, 5)).toString('ascii');
  return header === '%PDF-';
}

function readPdf(
  value: unknown,
  statusCode: number,
): Pick<BinaryResult, 'data' | 'contentType' | 'encoding'> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw unreadablePdf(statusCode, value);
  }

  const contentType = value.data['Content-Type'];
  const encoding = value.data.encoding;
  const payload = value.data.data;

  if (typeof contentType !== 'string' || contentType.length === 0) {
    throw unreadablePdf(statusCode, value);
  }

  if (encoding !== 'base64' || typeof payload !== 'string') {
    throw unreadablePdf(statusCode, value);
  }

  const bytes = decodeBase64(payload);

  if (bytes === undefined || !startsWithPdf(bytes)) {
    throw unreadablePdf(statusCode, value);
  }

  return {
    data: bytes,
    contentType,
    encoding,
  };
}

export async function createInvoice(
  context: CallContext,
  input: CreateInvoiceInput,
): Promise<Result<IssuedInvoice>> {
  if (!isRecord(input)) {
    throw new InputError('invoice must be an object.');
  }

  const organizationId = resolveOrganizationId(
    context.organizationId,
    input.organizationId,
  );
  const data = parseInvoiceInput(input);
  data.organizationId = organizationId;
  const response = await context.http.post(
    '/v1/documents/invoice-issue',
    data,
    { uncertainOutcome: true },
  );

  return {
    statusCode: response.statusCode,
    data: readIssuedInvoice(response.value, response.statusCode),
  };
}

export async function downloadPdf(
  context: CallContext,
  input: DownloadPdfInput,
): Promise<BinaryResult> {
  if (!isRecord(input)) {
    throw new InputError('pdf request must be an object.');
  }

  const organizationId = resolveOrganizationId(
    context.organizationId,
    input.organizationId,
  );

  if (typeof input.documentId !== 'string') {
    throw new InputError('documentId must be a string.');
  }

  const response = await context.http.post(
    '/v1/documents/get-invoice-pdf',
    {
      organizationId,
      documentId: input.documentId,
    },
    { uncertainOutcome: false },
  );
  const pdf = readPdf(response.value, response.statusCode);

  return {
    statusCode: response.statusCode,
    data: pdf.data,
    contentType: pdf.contentType,
    encoding: pdf.encoding,
  };
}
