import { readFile } from 'node:fs/promises';
import { text as readStream } from 'node:stream/consumers';
import { parseInvoiceInput } from '../invoice-body.ts';
import type { CreateInvoiceInput } from '../types.ts';

async function readInvoiceText(source: string): Promise<string> {
  if (source === '-') {
    return readStream(process.stdin);
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

  return parseInvoiceInput(parsed);
}
