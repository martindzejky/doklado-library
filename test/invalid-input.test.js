import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { InputError, createClient } from '../src/index.ts';

const client = createClient({
  apiKey: 'test-api-key-value',
  baseUrl: 'http://127.0.0.1:4010',
  organizationId: '12345678',
});

function invoice() {
  return {
    type: 'issued_invoice',
    customer: { name: 'Ada Lovelace' },
    items: [{ name: 'Work', unitPriceWithoutVat: 10, quantity: 1 }],
  };
}

describe('runtime input checks', () => {
  test('rejects wrong types before any request', async () => {
    const cases = [
      { ...invoice(), type: 'quote' },
      { ...invoice(), items: 'nope' },
      {
        ...invoice(),
        items: [{ name: 'Work', unitPriceWithoutVat: 10, quantity: '1' }],
      },
      { ...invoice(), customer: null },
      { ...invoice(), paymentType: 'wire' },
      null,
    ];
    const previous = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('network must not be called');
    };

    try {
      for (const input of cases) {
        await assert.rejects(() => client.invoices.create(input), InputError);
      }
    } finally {
      globalThis.fetch = previous;
    }
  });
});
