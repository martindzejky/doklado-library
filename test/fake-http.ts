import assert from 'node:assert/strict';
import { isRecord } from '../src/record.ts';

export const apiKey = 'test-api-key-value';
export const baseUrl = 'http://127.0.0.1:4010';
export const organizationId = '12345678';
export const issueUrl = `${baseUrl}/v1/documents/invoice-issue`;
export const pdfUrl = `${baseUrl}/v1/documents/get-invoice-pdf`;

export type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

export async function withFetch(
  impl: (call: Call, init: RequestInit) => Promise<Response> | Response,
  run: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const calls: Call[] = [];
  const previous = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    let body: unknown;

    if (typeof init?.body === 'string') {
      const parsed: unknown = JSON.parse(init.body);
      body = parsed;
    }

    const call: Call = {
      url: requestUrl(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(call);
    return impl(call, init ?? {});
  };

  try {
    await run(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

export function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function assertSinglePost(calls: Call[], url: string): Call {
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, url);
  assert.equal(JSON.stringify(call.body).includes('__mock'), false);
  assert.equal(call.url.includes(apiKey), false);
  assert.equal(call.headers.get('api_key'), apiKey);
  assert.equal(call.headers.get('accept'), 'application/json');
  assert.equal(call.headers.get('content-type'), 'application/json');
  return call;
}

export function requestData(call: Call): Record<string, unknown> {
  assert.ok(isRecord(call.body));
  assert.ok(isRecord(call.body.data));
  return call.body.data;
}

export async function rejected(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }

  assert.fail('expected the call to fail');
}

export function hangUntilAbort(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal;

    if (signal === undefined || signal === null) {
      reject(new Error('missing abort signal'));
      return;
    }

    const abort = () => {
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener('abort', abort, { once: true });
  });
}
