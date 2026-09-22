import { readFile } from 'node:fs/promises';
import { isRecord } from '../record.ts';
import type { CreateInvoiceInput } from '../types.ts';

function isInvoiceInput(value: unknown): value is CreateInvoiceInput {
  return isRecord(value);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    process.stdin.on('data', (chunk: Buffer | string) => {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
        return;
      }

      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    process.stdin.on('error', reject);
  });
}

async function readInvoiceText(source: string): Promise<string> {
  if (source === '-') {
    return readStdin();
  }

  if (source.startsWith('@')) {
    return readFile(source.slice(1), 'utf8');
  }

  return source;
}

export async function readInvoiceInput(
  source: string,
): Promise<CreateInvoiceInput> {
  const text = await readInvoiceText(source);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : 'Unknown parse error';
    throw new Error(`Invoice JSON is not valid JSON. ${detail}`);
  }

  if (!isInvoiceInput(parsed)) {
    throw new Error('Invoice JSON must be an object.');
  }

  return parsed;
}
