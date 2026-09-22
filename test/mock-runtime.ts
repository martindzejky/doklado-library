import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { isRecord } from '../src/record.ts';

export const MOCK_VERSION = '1.0.1';

export type RunningMock = {
  baseUrl: string;
  stop: () => Promise<void>;
};

function readInstalledVersion(prefix: string): string | undefined {
  const packagePath = join(
    prefix,
    'node_modules',
    '@martindzejky',
    'doklado-mock',
    'package.json',
  );

  if (!existsSync(packagePath)) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    return undefined;
  }

  return parsed.version;
}

function installMock(prefix: string): Promise<void> {
  mkdirSync(prefix, { recursive: true });
  const manifest = join(prefix, 'package.json');
  if (!existsSync(manifest)) {
    writeFileSync(manifest, '{"private":true}\n');
  }

  if (readInstalledVersion(prefix) === MOCK_VERSION) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      'npm',
      [
        'install',
        '--prefix',
        prefix,
        '--omit=dev',
        '--ignore-scripts',
        '--no-package-lock',
        `@martindzejky/doklado-mock@${MOCK_VERSION}`,
      ],
      {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) {
        reject(new Error(`Could not install doklado-mock. ${stderr}`));
        return;
      }

      const installed = readInstalledVersion(prefix);
      if (installed !== MOCK_VERSION) {
        reject(
          new Error(
            `Expected doklado-mock ${MOCK_VERSION}, found ${installed ?? 'nothing'}.`,
          ),
        );
        return;
      }

      resolve();
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local port.'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitUntilReady(
  baseUrl: string,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError = 'no response';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `doklado-mock exited ${child.exitCode}. ${stderr()}`.trim(),
      );
    }

    try {
      const response = await fetch(`${baseUrl}/__mock/state`);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : 'request failed';
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`doklado-mock did not start. ${lastError}. ${stderr()}`);
}

export async function startMock(rootDir: string): Promise<RunningMock> {
  const prefix = join(rootDir, 'tmp', 'doklado-mock-runtime');
  await installMock(prefix);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const bin = join(
    prefix,
    'node_modules',
    '@martindzejky',
    'doklado-mock',
    'bin',
    'doklado-mock.js',
  );
  const env = { ...process.env };
  delete env.DOKLADO_MOCK_CONFIG;
  delete env.PORT;
  delete env.HOST;

  const child = spawn(
    process.execPath,
    [bin, '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: prefix,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  try {
    await waitUntilReady(baseUrl, child, () => stderr);
  } catch (error: unknown) {
    child.kill('SIGTERM');
    throw error;
  }

  return {
    baseUrl,
    stop: () => stopChild(child),
  };
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
