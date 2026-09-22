import { ConfigError } from './errors.ts';
import { createHttpClient } from './http.ts';
import { createInvoice, downloadPdf } from './invoices.ts';
import { isRecord } from './record.ts';
import type {
  BinaryResult,
  ClientConfig,
  CreateInvoiceInput,
  DownloadPdfInput,
  IssuedInvoice,
  Result,
} from './types.ts';

const DEFAULT_TIMEOUT_MS = 15000;

export type Client = {
  invoices: {
    create(input: CreateInvoiceInput): Promise<Result<IssuedInvoice>>;
    downloadPdf(input: DownloadPdfInput): Promise<BinaryResult>;
  };
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];

  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  return value;
}

function configuredString(
  value: unknown,
  label: string,
  envName: string,
): string | undefined {
  if (value === undefined) {
    return readEnv(envName);
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new ConfigError(`${label} must be a non-empty string.`);
}

function requiredString(
  value: unknown,
  label: string,
  envName: string,
): string {
  const resolved = configuredString(value, label, envName);

  if (resolved === undefined) {
    throw new ConfigError(
      `Pass ${label} or set ${envName}. The SDK does not load .env files.`,
    );
  }

  return resolved;
}

function readTimeout(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError('timeoutMs must be a positive finite number.');
  }

  return value;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('baseUrl must be an absolute http or https URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('baseUrl must be an absolute http or https URL.');
  }

  if (url.username !== '' || url.password !== '') {
    throw new ConfigError('baseUrl must not include credentials.');
  }

  if (url.pathname === '/' && url.search === '' && url.hash === '') {
    return url.origin;
  }

  return url.toString().replace(/\/$/, '');
}

export function createClient(config: ClientConfig = {}): Client {
  if (!isRecord(config)) {
    throw new ConfigError('config must be an object.');
  }

  const apiKey = requiredString(
    config.apiKey,
    'config.apiKey',
    'DOKLADO_API_KEY',
  );
  const baseUrl = normalizeBaseUrl(
    requiredString(config.baseUrl, 'config.baseUrl', 'DOKLADO_API_URL'),
  );
  const organizationId = configuredString(
    config.organizationId,
    'config.organizationId',
    'DOKLADO_ORGANIZATION_ID',
  );
  const http = createHttpClient({
    apiKey,
    baseUrl,
    timeoutMs: readTimeout(config.timeoutMs),
  });
  const context = {
    http,
    organizationId,
  };

  return {
    invoices: {
      create(input) {
        return createInvoice(context, input);
      },
      downloadPdf(input) {
        return downloadPdf(context, input);
      },
    },
  };
}
