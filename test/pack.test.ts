import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { isRecord } from '../src/record.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const consumer = join(root, 'tmp', 'pack-consumer');
const packDir = join(root, 'tmp', 'pack');

function run(
  command: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // pnpm lifecycle settings are not npm install settings (notably allow-scripts).
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
    ),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('packed package', () => {
  test('installs the sdk, types, and cli without dev dependencies', async () => {
    rmSync(consumer, { recursive: true, force: true });
    rmSync(packDir, { recursive: true, force: true });
    mkdirSync(packDir, { recursive: true });

    const packed = run('pnpm', ['pack', '--pack-destination', packDir], root);
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
    assert.ok(tarball);

    mkdirSync(consumer, { recursive: true });
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({
        name: 'doklado-pack-consumer',
        private: true,
        type: 'module',
      }),
      'utf8',
    );

    const installed = run(
      'npm',
      [
        'install',
        '--omit=dev',
        '--ignore-scripts',
        '--cache',
        join(root, 'tmp', 'npm-cache'),
        join(packDir, tarball),
      ],
      consumer,
    );
    assert.equal(installed.status, 0, installed.stderr);

    const installedRoot = join(
      consumer,
      'node_modules',
      '@martindzejky',
      'doklado-library',
    );
    assert.equal(existsSync(join(installedRoot, 'src')), false);
    assert.equal(existsSync(join(installedRoot, 'dist', 'index.js')), true);
    assert.equal(existsSync(join(installedRoot, 'dist', 'index.d.ts')), true);
    assert.equal(existsSync(join(installedRoot, 'dist', 'cli.js')), true);
    assert.equal(existsSync(join(installedRoot, 'bin', 'doklado.js')), true);

    const manifest: unknown = JSON.parse(
      readFileSync(join(installedRoot, 'package.json'), 'utf8'),
    );
    assert.ok(isRecord(manifest));
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          noEmit: true,
          lib: ['ES2022'],
          types: [],
        },
        include: ['check.ts'],
      }),
      'utf8',
    );
    writeFileSync(
      join(consumer, 'check.ts'),
      [
        "import { createClient, type CreateInvoiceInput } from '@martindzejky/doklado-library';",
        '',
        'const input: CreateInvoiceInput = {',
        "  type: 'issued_invoice',",
        "  customer: { contactEmail: 'ada@example.com' },",
        "  items: [{ name: 'Work', unitPriceWithoutVat: 10, quantity: 1 }],",
        '};',
        '',
        'export async function example(): Promise<number> {',
        '  const doklado = createClient({',
        "    apiKey: 'key',",
        "    baseUrl: 'http://127.0.0.1:9',",
        '  });',
        '  const created = await doklado.invoices.create(input);',
        '  const pdf = await doklado.invoices.downloadPdf({',
        '    documentId: created.data.documentId,',
        '  });',
        '  return pdf.data.byteLength;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const typecheck = run(
      join(root, 'node_modules', '.bin', 'tsc'),
      ['-p', join(consumer, 'tsconfig.json')],
      consumer,
    );
    assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        const pdf = Buffer.from('%PDF-1.4\npacked\n').toString('base64');
        const body =
          request.url === '/v1/documents/get-invoice-pdf'
            ? {
                success: true,
                data: {
                  'Content-Type': 'application/pdf',
                  encoding: 'base64',
                  data: pdf,
                },
              }
            : {
                success: true,
                data: {
                  documentId: 'PackedDocumentId0001',
                  invoiceNumber: '2026001',
                },
              };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Could not start the pack stub.');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      writeFileSync(
        join(consumer, 'smoke.mjs'),
        [
          "import { createClient } from '@martindzejky/doklado-library';",
          'const doklado = createClient({',
          "  apiKey: 'packed-key',",
          '  baseUrl: process.env.SMOKE_URL,',
          "  organizationId: '12345678',",
          '});',
          'const created = await doklado.invoices.create({',
          "  type: 'issued_invoice',",
          "  customer: { name: 'Ada', contactEmail: 'ada@example.com' },",
          "  items: [{ name: 'Work', unitPriceWithoutVat: 10, quantity: 1 }],",
          '});',
          "if (created.data.documentId !== 'PackedDocumentId0001') process.exit(2);",
          'const pdf = await doklado.invoices.downloadPdf({',
          '  documentId: created.data.documentId,',
          '});',
          "if (Buffer.from(pdf.data.subarray(0, 5)).toString('ascii') !== '%PDF-') process.exit(3);",
          "process.stdout.write('packed-sdk-ok');",
          '',
        ].join('\n'),
        'utf8',
      );

      const smoke = await new Promise<{
        status: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const child = spawn(process.execPath, ['smoke.mjs'], {
          cwd: consumer,
          env: { ...process.env, SMOKE_URL: baseUrl },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (status) => {
          resolve({ status, stdout, stderr });
        });
      });
      assert.equal(smoke.status, 0, smoke.stderr);
      assert.equal(smoke.stdout, 'packed-sdk-ok');

      const cli = spawnSync(
        process.execPath,
        [join(installedRoot, 'bin', 'doklado.js'), '--version'],
        {
          cwd: consumer,
          encoding: 'utf8',
          env: process.env,
        },
      );
      assert.equal(cli.status, 0, cli.stderr);
      assert.ok(typeof manifest.version === 'string');
      assert.equal(cli.stdout.trim(), manifest.version);

      writeFileSync(
        join(consumer, 'invoice.json'),
        '{"type":"issued_invoice","customer":{"name":"Ada","contactEmail":"ada@example.com"},"items":[{"name":"Work","unitPriceWithoutVat":10,"quantity":1}]}',
        'utf8',
      );
      const created = await new Promise<{
        status: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            join(installedRoot, 'bin', 'doklado.js'),
            '--api-key',
            'packed-key',
            '--base-url',
            baseUrl,
            '--organization-id',
            '12345678',
            'invoices',
            'create',
            '--data',
            '@invoice.json',
          ],
          {
            cwd: consumer,
            env: { PATH: process.env.PATH },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (status) => {
          resolve({ status, stdout, stderr });
        });
      });
      assert.equal(created.status, 0, created.stderr);
      assert.match(created.stdout, /Created invoice 2026001/);
      assert.equal(created.stdout.includes('%PDF'), false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
