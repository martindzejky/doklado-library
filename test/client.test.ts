import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createClient } from '../src/index.ts';
import { ConfigError } from '../src/errors.ts';
import {
  apiKey,
  baseUrl,
  issueUrl,
  jsonResponse,
  organizationId,
  requestData,
  withFetch,
  assertSinglePost,
} from './fake-http.ts';

const envKeys = [
  'DOKLADO_API_KEY',
  'DOKLADO_API_URL',
  'DOKLADO_ORGANIZATION_ID',
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function privateInvoice() {
  return {
    type: 'issued_invoice' as const,
    customer: { name: 'Ada Lovelace', nonCorporateEntity: true },
    items: [{ name: 'Work', unitPriceWithoutVat: 10, quantity: 1 }],
  };
}

describe('createClient', () => {
  test('requires an api key and names the env var', () => {
    assert.throws(
      () => createClient({ baseUrl }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /config\.apiKey/);
        assert.match(error.message, /DOKLADO_API_KEY/);
        assert.match(error.message, /does not load \.env/);
        assert.equal(error.uncertain, false);
        return true;
      },
    );
  });

  test('requires a base url', () => {
    assert.throws(
      () => createClient({ apiKey }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /DOKLADO_API_URL/);
        return true;
      },
    );
  });

  test('rejects a base url with credentials without echoing them', () => {
    const password = 's3cret-password';
    assert.throws(
      () =>
        createClient({
          apiKey,
          baseUrl: `http://user:${password}@127.0.0.1:4010`,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.equal(error.message.includes(password), false);
        assert.equal(error.message.includes('user'), false);
        return true;
      },
    );
  });

  test('rejects a non-http base url and a bad timeout', () => {
    assert.throws(
      () => createClient({ apiKey, baseUrl: 'ftp://127.0.0.1' }),
      ConfigError,
    );
    assert.throws(
      () => createClient({ apiKey, baseUrl, timeoutMs: 0 }),
      ConfigError,
    );
  });

  test('uses explicit options instead of the environment', async () => {
    process.env.DOKLADO_API_KEY = 'env-api-key-value';
    process.env.DOKLADO_API_URL = 'http://127.0.0.1:9999';
    process.env.DOKLADO_ORGANIZATION_ID = '99999999';

    const client = createClient({
      apiKey,
      baseUrl,
      organizationId,
    });

    await withFetch(
      () =>
        jsonResponse(200, {
          success: true,
          data: { documentId: 'doc', invoiceNumber: '1' },
        }),
      async (calls) => {
        await client.invoices.create(privateInvoice());
        const call = assertSinglePost(calls, issueUrl);
        assert.equal(requestData(call).organizationId, organizationId);
      },
    );
  });

  test('reads the environment when options are omitted', async () => {
    process.env.DOKLADO_API_KEY = apiKey;
    process.env.DOKLADO_API_URL = baseUrl;
    process.env.DOKLADO_ORGANIZATION_ID = organizationId;

    const client = createClient();

    await withFetch(
      () =>
        jsonResponse(200, {
          success: true,
          data: { documentId: 'doc', invoiceNumber: '1' },
        }),
      async (calls) => {
        await client.invoices.create(privateInvoice());
        const call = assertSinglePost(calls, issueUrl);
        assert.equal(requestData(call).organizationId, organizationId);
      },
    );
  });

  test('does not load a .env file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doklado-env-'));
    writeFileSync(
      join(dir, '.env'),
      'DOKLADO_API_KEY=from-dotenv-file\nDOKLADO_API_URL=http://127.0.0.1:9\n',
    );

    const env = { ...process.env };
    delete env.DOKLADO_API_KEY;
    delete env.DOKLADO_API_URL;
    delete env.DOKLADO_ORGANIZATION_ID;

    const entry = pathToFileURL(
      join(process.cwd(), 'src/create-client.ts'),
    ).href;
    const script = [
      `import { createClient } from ${JSON.stringify(entry)};`,
      'try {',
      '  createClient();',
      '  console.error("created");',
      '  process.exit(2);',
      '} catch (error) {',
      '  const message = error instanceof Error ? error.message : String(error);',
      '  if (message.includes("from-dotenv-file")) process.exit(3);',
      '  if (!message.includes("DOKLADO_API_KEY")) process.exit(4);',
      '}',
    ].join('\n');

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: dir,
        env,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
