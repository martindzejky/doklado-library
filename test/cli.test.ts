import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { Buffer } from 'node:buffer';
import packageJson from '../package.json' with { type: 'json' };
import { isRecord } from '../src/record.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'doklado.js');

const pdfBytes = Buffer.from('%PDF-1.4\ncli-pdf-marker\n%%EOF\n');
const pdfBase64 = pdfBytes.toString('base64');

type RecordedRequest = {
  url: string | undefined;
  apiKey: string | undefined;
  body: unknown;
};

type Stub = {
  baseUrl: string;
  requests: RecordedRequest[];
  status: number;
  body: unknown;
  close: () => Promise<void>;
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

async function startStub(status = 200, body?: unknown): Promise<Stub> {
  const requests: RecordedRequest[] = [];
  const payload = body ?? {
    success: true,
    data: {
      documentId: 'AbCdEfGhIjKlMnOpQrSt',
      invoiceNumber: '2026001',
    },
  };

  const server: Server = createServer((request, response) => {
    void readBody(request).then((text) => {
      let parsed: unknown = text;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      const header = request.headers.api_key;
      requests.push({
        url: request.url,
        apiKey: typeof header === 'string' ? header : undefined,
        body: parsed,
      });

      const responseBody =
        request.url === '/v1/documents/get-invoice-pdf'
          ? {
              success: true,
              data: {
                'Content-Type': 'application/pdf',
                encoding: 'base64',
                data: pdfBase64,
              },
            }
          : payload;

      response.writeHead(
        request.url === '/v1/documents/get-invoice-pdf' ? 200 : status,
        {
          'content-type': 'application/json',
        },
      );
      response.end(JSON.stringify(responseBody));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not start the stub server.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    status,
    body: payload,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  if (process.env.PATH !== undefined) {
    result.PATH = process.env.PATH;
  }

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function run(
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    input?: string;
  },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
      return;
    }

    child.stdin.end();
  });
}

function invoiceJson(organizationId?: string): string {
  const invoice: Record<string, unknown> = {
    type: 'issued_invoice',
    customer: {
      name: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
    },
    items: [{ name: 'Work', unitPriceWithoutVat: 10, quantity: 1 }],
  };

  if (organizationId !== undefined) {
    invoice.organizationId = organizationId;
  }

  return JSON.stringify(invoice);
}

function requestData(recorded: RecordedRequest): Record<string, unknown> {
  assert.ok(isRecord(recorded.body));
  assert.ok(isRecord(recorded.body.data));
  return recorded.body.data;
}

describe('doklado cli', () => {
  test('prints help and version', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'doklado-cli-'));
    const help = await run(['--help'], { cwd, env: env({}) });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /doklado invoices create/);
    assert.match(help.stdout, /doklado invoices pdf/);
    assert.match(help.stdout, /DOKLADO_API_KEY/);
    assert.match(help.stdout, /\.env/);
    assert.equal(help.stderr, '');

    const version = await run(['--version'], { cwd, env: env({}) });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), packageJson.version);
  });

  test('fails with a nonzero status for usage errors', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'doklado-cli-'));
    const cases = [
      ['nope'],
      ['invoices', 'create'],
      ['invoices', 'pdf'],
      ['invoices', 'pdf', 'doc-1'],
      ['--output', 'yaml', 'invoices', 'create', '--data', '{}'],
    ];

    for (const args of cases) {
      const result = await run(args, { cwd, env: env({}) });
      assert.equal(result.status, 1, args.join(' '));
    }
  });

  test('reads inline json, a file, and stdin', async () => {
    const stub = await startStub();
    const cwd = mkdtempSync(join(tmpdir(), 'doklado-cli-'));
    const baseEnv = {
      DOKLADO_API_KEY: 'inline-key',
      DOKLADO_API_URL: stub.baseUrl,
      DOKLADO_ORGANIZATION_ID: '12345678',
    };

    try {
      const inline = await run(
        ['invoices', 'create', '--data', invoiceJson()],
        { cwd, env: env(baseEnv) },
      );
      assert.equal(inline.status, 0, inline.stderr);
      assert.match(inline.stdout, /Created invoice 2026001/);
      assert.match(inline.stdout, /Document id: AbCdEfGhIjKlMnOpQrSt/);
      assert.equal(inline.stderr, '');

      writeFileSync(join(cwd, 'invoice.json'), invoiceJson(), 'utf8');
      const file = await run(
        ['--output', 'json', 'invoices', 'create', '--data', '@invoice.json'],
        { cwd, env: env(baseEnv) },
      );
      assert.equal(file.status, 0, file.stderr);
      const fileJson: unknown = JSON.parse(file.stdout);
      assert.ok(isRecord(fileJson));
      assert.equal(fileJson.ok, true);
      assert.equal(fileJson.action, 'invoices.create');
      assert.ok(isRecord(fileJson.data));
      assert.equal(fileJson.data.documentId, 'AbCdEfGhIjKlMnOpQrSt');
      assert.equal(file.stdout.includes(pdfBase64), false);

      const stdin = await run(['invoices', 'create', '--data', '-'], {
        cwd,
        env: env(baseEnv),
        input: invoiceJson(),
      });
      assert.equal(stdin.status, 0, stdin.stderr);
      assert.match(stdin.stdout, /Created invoice 2026001/);

      assert.equal(stub.requests.length, 3);
      const firstRequest = stub.requests[0];
      assert.ok(firstRequest);
      const sent = requestData(firstRequest);
      assert.ok(isRecord(sent.customer));
      assert.equal(sent.customer.contactEmail, 'ada@example.com');
    } finally {
      await stub.close();
    }
  });

  test('flags win over the environment and .env', async () => {
    const stub = await startStub();
    const cwd = mkdtempSync(join(tmpdir(), 'doklado-cli-'));

    try {
      writeFileSync(
        join(cwd, '.env'),
        [
          'DOKLADO_API_KEY=from-dotenv',
          `DOKLADO_API_URL=${stub.baseUrl}`,
          'DOKLADO_ORGANIZATION_ID=dotenv-org',
          '',
        ].join('\n'),
        'utf8',
      );

      const fromFile = await run(
        ['invoices', 'create', '--data', invoiceJson()],
        {
          cwd,
          env: env({}),
        },
      );
      assert.equal(fromFile.status, 0, fromFile.stderr);
      const dotenvRequest = stub.requests[0];
      assert.ok(dotenvRequest);
      assert.equal(dotenvRequest.apiKey, 'from-dotenv');
      assert.equal(requestData(dotenvRequest).organizationId, 'dotenv-org');

      writeFileSync(
        join(cwd, '.env'),
        [
          'DOKLADO_API_KEY=from-dotenv',
          'DOKLADO_API_URL=http://127.0.0.1:1',
          'DOKLADO_ORGANIZATION_ID=dotenv-org',
          '',
        ].join('\n'),
        'utf8',
      );
      const fromEnv = await run(
        ['invoices', 'create', '--data', invoiceJson()],
        {
          cwd,
          env: env({
            DOKLADO_API_KEY: 'from-env',
            DOKLADO_API_URL: stub.baseUrl,
            DOKLADO_ORGANIZATION_ID: 'env-org',
          }),
        },
      );
      assert.equal(fromEnv.status, 0, fromEnv.stderr);
      const envRequest = stub.requests[1];
      assert.ok(envRequest);
      assert.equal(envRequest.apiKey, 'from-env');
      assert.equal(requestData(envRequest).organizationId, 'env-org');

      const fromFlag = await run(
        [
          '--api-key',
          'from-flag',
          '--base-url',
          stub.baseUrl,
          '--organization-id',
          'flag-org',
          'invoices',
          'create',
          '--data',
          invoiceJson(),
        ],
        {
          cwd,
          env: env({
            DOKLADO_API_KEY: 'from-env',
            DOKLADO_API_URL: 'http://127.0.0.1:1',
            DOKLADO_ORGANIZATION_ID: 'env-org',
          }),
        },
      );
      assert.equal(fromFlag.status, 0, fromFlag.stderr);
      const flagRequest = stub.requests[2];
      assert.ok(flagRequest);
      assert.equal(flagRequest.apiKey, 'from-flag');
      assert.equal(requestData(flagRequest).organizationId, 'flag-org');

      const fromJson = await run(
        [
          '--organization-id',
          'flag-org',
          'invoices',
          'create',
          '--data',
          invoiceJson('json-org'),
        ],
        {
          cwd,
          env: env({
            DOKLADO_API_KEY: 'from-env',
            DOKLADO_API_URL: stub.baseUrl,
            DOKLADO_ORGANIZATION_ID: 'env-org',
          }),
        },
      );
      assert.equal(fromJson.status, 0, fromJson.stderr);
      const jsonRequest = stub.requests[3];
      assert.ok(jsonRequest);
      assert.equal(requestData(jsonRequest).organizationId, 'json-org');

      const emptyFlag = await run(
        ['--api-key', '', 'invoices', 'create', '--data', invoiceJson()],
        {
          cwd,
          env: env({
            DOKLADO_API_KEY: 'from-env',
            DOKLADO_API_URL: stub.baseUrl,
            DOKLADO_ORGANIZATION_ID: 'env-org',
          }),
        },
      );
      assert.equal(emptyFlag.status, 1);
      assert.equal(emptyFlag.stdout, '');
      assert.match(emptyFlag.stderr, /config\.apiKey/);
      assert.equal(stub.requests.length, 4);
    } finally {
      await stub.close();
    }
  });

  test('writes pdf bytes only to the selected path', async () => {
    const stub = await startStub();
    const cwd = mkdtempSync(join(tmpdir(), 'doklado-cli-'));
    mkdirSync(join(cwd, 'out'));
    const baseEnv = {
      DOKLADO_API_KEY: 'pdf-key',
      DOKLADO_API_URL: stub.baseUrl,
      DOKLADO_ORGANIZATION_ID: '12345678',
    };

    try {
      const saved = await run(
        [
          'invoices',
          'pdf',
          'AbCdEfGhIjKlMnOpQrSt',
          '--path',
          'out/invoice.pdf',
        ],
        { cwd, env: env(baseEnv) },
      );
      assert.equal(saved.status, 0, saved.stderr);
      assert.match(saved.stdout, /Saved PDF to out\/invoice\.pdf/);
      assert.equal(saved.stdout.includes(pdfBase64), false);
      assert.equal(saved.stdout.includes('%PDF'), false);
      assert.equal(saved.stderr, '');
      const file = readFileSync(join(cwd, 'out', 'invoice.pdf'));
      assert.equal(file.subarray(0, 5).toString('ascii'), '%PDF-');
      assert.equal(existsSync(join(root, 'invoice.pdf')), false);
      assert.equal(existsSync(join(root, 'out', 'invoice.pdf')), false);

      const json = await run(
        [
          '--output',
          'json',
          'invoices',
          'pdf',
          'AbCdEfGhIjKlMnOpQrSt',
          '--path',
          'invoice.pdf',
        ],
        { cwd, env: env(baseEnv) },
      );
      assert.equal(json.status, 0, json.stderr);
      assert.equal(json.stdout.includes(pdfBase64), false);
      const parsed: unknown = JSON.parse(json.stdout);
      assert.ok(isRecord(parsed));
      assert.equal(parsed.action, 'invoices.pdf');
      assert.ok(isRecord(parsed.data));
      assert.equal(parsed.data.path, 'invoice.pdf');
      assert.equal(Object.hasOwn(parsed.data, 'data'), false);
      assert.equal(
        readFileSync(join(cwd, 'invoice.pdf')).subarray(0, 5).toString('ascii'),
        '%PDF-',
      );
    } finally {
      await stub.close();
    }
  });

  test('prints failures on stderr and exits nonzero', async () => {
    const stub = await startStub(401, {
      error: 'You are not authorized to make this request',
    });
    const cwd = mkdtempSync(join(tmpdir(), 'doklado-cli-'));
    const secret = 'cli-secret-key';

    try {
      const text = await run(['invoices', 'create', '--data', invoiceJson()], {
        cwd,
        env: env({
          DOKLADO_API_KEY: secret,
          DOKLADO_API_URL: stub.baseUrl,
          DOKLADO_ORGANIZATION_ID: '12345678',
        }),
      });
      assert.equal(text.status, 1);
      assert.equal(text.stdout, '');
      assert.match(text.stderr, /HTTP 401/);
      assert.match(text.stderr, /not authorized/);
      assert.equal(text.stderr.includes(secret), false);

      const json = await run(
        ['--output', 'json', 'invoices', 'create', '--data', invoiceJson()],
        {
          cwd,
          env: env({
            DOKLADO_API_KEY: secret,
            DOKLADO_API_URL: stub.baseUrl,
            DOKLADO_ORGANIZATION_ID: '12345678',
          }),
        },
      );
      assert.equal(json.status, 1);
      assert.equal(json.stdout, '');
      const parsed: unknown = JSON.parse(json.stderr);
      assert.ok(isRecord(parsed));
      assert.equal(parsed.ok, false);
      assert.equal(parsed.status, 401);
      assert.ok(isRecord(parsed.error));
      assert.equal(parsed.error.name, 'HttpError');
      assert.equal(json.stderr.includes(secret), false);

      const missing = await run(
        ['--output', 'json', 'invoices', 'create', '--data', invoiceJson()],
        { cwd, env: env({}) },
      );
      assert.equal(missing.status, 1);
      assert.equal(missing.stdout, '');
      assert.match(missing.stderr, /DOKLADO_API_KEY/);
      assert.match(missing.stderr, /does not load \.env/);

      const badJson = await run(['invoices', 'create', '--data', '{'], {
        cwd,
        env: env({
          DOKLADO_API_KEY: secret,
          DOKLADO_API_URL: stub.baseUrl,
        }),
      });
      assert.equal(badJson.status, 1);
      assert.match(badJson.stderr, /not valid JSON/);

      const notObject = await run(['invoices', 'create', '--data', '[]'], {
        cwd,
        env: env({
          DOKLADO_API_KEY: secret,
          DOKLADO_API_URL: stub.baseUrl,
        }),
      });
      assert.equal(notObject.status, 1);
      assert.match(notObject.stderr, /must be an object/);
    } finally {
      await stub.close();
    }
  });
});
