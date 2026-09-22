import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { isRecord } from '../src/record.ts';

export const MOCK_VERSION = '1.0.1';

export type RunningMock = {
  baseUrl: string;
  stop: () => Promise<void>;
};

const require = createRequire(import.meta.url);

function installedMock(): { root: string; bin: string } {
  const root = dirname(
    require.resolve('@martindzejky/doklado-mock/package.json'),
  );
  const parsed: unknown = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );

  if (!isRecord(parsed) || parsed.version !== MOCK_VERSION) {
    const found =
      isRecord(parsed) && typeof parsed.version === 'string'
        ? parsed.version
        : 'nothing';
    throw new Error(`Expected doklado-mock ${MOCK_VERSION}, found ${found}.`);
  }

  return {
    root,
    bin: join(root, 'bin', 'doklado-mock.js'),
  };
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

export async function startMock(): Promise<RunningMock> {
  const mock = installedMock();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.DOKLADO_MOCK_CONFIG;
  delete env.PORT;
  delete env.HOST;

  const child = spawn(
    process.execPath,
    [mock.bin, '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: mock.root,
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
