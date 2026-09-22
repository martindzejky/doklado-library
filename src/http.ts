import {
  ApiError,
  HttpError,
  NetworkError,
  ResponseError,
  TimeoutError,
} from './errors.ts';
import { isRecord } from './record.ts';

export type HttpResponse = {
  statusCode: number;
  value: unknown;
};

export type HttpClient = {
  post(
    path: string,
    data: Record<string, unknown>,
    options: { uncertainOutcome: boolean },
  ): Promise<HttpResponse>;
};

type HttpOptions = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const relative = path.startsWith('/') ? path.slice(1) : path;
  return new URL(relative, base).toString();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function requestCause(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error('Unknown request failure');
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function failureCode(value: unknown): string | undefined {
  if (!isRecord(value) || value.success !== false) {
    return undefined;
  }

  if (typeof value.code !== 'string' || value.code.length === 0) {
    return undefined;
  }

  return value.code;
}

function isSuccess(value: unknown): boolean {
  return isRecord(value) && value.success === true;
}

function responseBody(
  parsed: { ok: true; value: unknown } | { ok: false },
  text: string,
): unknown {
  if (parsed.ok) {
    return parsed.value;
  }

  return text;
}

function apiMessage(code: string, value: unknown): string {
  let message = `Doklado rejected the request (${code}).`;

  if (!isRecord(value)) {
    return message;
  }

  if (typeof value.message === 'string' && value.message.length > 0) {
    message = `${message} ${value.message}`;
  }

  return message;
}

// One attempt. Issuing an invoice is not idempotent, so this client never retries.
export function createHttpClient(options: HttpOptions): HttpClient {
  return {
    async post(path, data, requestOptions) {
      const uncertain = requestOptions.uncertainOutcome;
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);

      let statusCode: number;
      let text: string;

      try {
        const response = await fetch(endpoint(options.baseUrl, path), {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            api_key: options.apiKey,
          },
          body: JSON.stringify({ data }),
          signal: controller.signal,
        });
        statusCode = response.status;
        text = await response.text();
      } catch (error: unknown) {
        if (isAbortError(error)) {
          const message = uncertain
            ? `Doklado request timed out after ${options.timeoutMs}ms. The invoice may already exist.`
            : `Doklado request timed out after ${options.timeoutMs}ms.`;
          throw new TimeoutError(message, { uncertain });
        }

        const message = uncertain
          ? 'Doklado request failed before a response arrived. The invoice may already exist.'
          : 'Doklado request failed before a response arrived.';
        throw new NetworkError(message, {
          uncertain,
          cause: requestCause(error),
        });
      } finally {
        clearTimeout(timeout);
      }

      const parsed = parseJson(text);
      const code = parsed.ok ? failureCode(parsed.value) : undefined;

      if (parsed.ok && code !== undefined) {
        throw new ApiError(apiMessage(code, parsed.value), {
          statusCode,
          code,
          body: responseBody(parsed, text),
        });
      }

      if (
        statusCode >= 200 &&
        statusCode < 300 &&
        parsed.ok &&
        isSuccess(parsed.value)
      ) {
        return {
          statusCode,
          value: parsed.value,
        };
      }

      if (statusCode < 200 || statusCode >= 300) {
        const message =
          uncertain && statusCode >= 500
            ? `Doklado returned HTTP ${statusCode}. The invoice may already exist.`
            : `Doklado returned HTTP ${statusCode}.`;
        throw new HttpError(message, {
          statusCode,
          body: responseBody(parsed, text),
          uncertain: uncertain && statusCode >= 500,
        });
      }

      const message = uncertain
        ? 'Doklado returned a response the SDK could not read. The invoice may already exist.'
        : 'Doklado returned a response the SDK could not read.';
      throw new ResponseError(message, {
        statusCode,
        body: responseBody(parsed, text),
        uncertain,
      });
    },
  };
}
