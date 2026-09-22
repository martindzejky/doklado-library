import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  ApiError,
  HttpError,
  InputError,
  NetworkError,
  ResponseError,
  TimeoutError,
  createClient,
} from '../src/index.ts';
import {
  apiKey,
  assertSinglePost,
  baseUrl,
  hangUntilAbort,
  issueUrl,
  jsonResponse,
  organizationId,
  pdfUrl,
  rejected,
  requestData,
  withFetch,
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

function client(timeoutMs?: number) {
  if (timeoutMs === undefined) {
    return createClient({ apiKey, baseUrl, organizationId });
  }

  return createClient({ apiKey, baseUrl, organizationId, timeoutMs });
}

function privateInvoice() {
  return {
    type: 'issued_invoice' as const,
    customer: {
      name: 'Ada Lovelace',
      nonCorporateEntity: true,
      country: 'Slovensko',
      countryCode: 'SK',
    },
    items: [
      {
        name: 'Work',
        unitPriceWithoutVat: 10,
        quantity: 1,
        vatRate: 0,
      },
    ],
  };
}

function issued(
  documentId = 'AbCdEfGhIjKlMnOpQrSt',
  invoiceNumber = '2026001',
) {
  return {
    success: true,
    trace: 'ignored',
    data: {
      documentId,
      invoiceNumber,
      extra: true,
    },
  };
}

describe('invoices.create', () => {
  test('issues a private invoice and ignores extra response fields', async () => {
    const doklado = client();

    await withFetch(
      () => jsonResponse(200, issued()),
      async (calls) => {
        const result = await doklado.invoices.create(privateInvoice());
        const call = assertSinglePost(calls, issueUrl);
        const data = requestData(call);

        assert.deepEqual(data, {
          organizationId,
          type: 'issued_invoice',
          customer: {
            name: 'Ada Lovelace',
            nonCorporateEntity: true,
            country: 'Slovensko',
            countryCode: 'SK',
          },
          items: [
            {
              name: 'Work',
              unitPriceWithoutVat: 10,
              quantity: 1,
              vatRate: 0,
            },
          ],
        });
        assert.equal(Object.hasOwn(data, 'number'), false);
        assert.equal(Object.hasOwn(data, 'accountingSettings'), false);
        assert.deepEqual(result, {
          statusCode: 200,
          data: {
            documentId: 'AbCdEfGhIjKlMnOpQrSt',
            invoiceNumber: '2026001',
          },
        });
      },
    );
  });

  test('sends company, address, dates, price, vat, notes, and payment', async () => {
    const doklado = client();
    const input = {
      organizationId: '87654321',
      type: 'issued_invoice' as const,
      number: 'TEST-2026500',
      accountingSettings: { numericCodeId: 'TESTRADEXPORT' },
      customer: {
        name: 'Example s.r.o.',
        ico: '87654321',
        dic: '2012345678',
        icDph: 'SK2012345678',
        vatPayer: true,
        nonCorporateEntity: false,
        streetName: 'Hlavna',
        propertyRegistrationNumber: '1',
        buildingNumber: '2',
        postalCode: '81101',
        municipality: 'Bratislava',
        country: 'Slovensko',
        countryCode: 'SK',
        registerNumberText: 'Oddiel Sro',
        vatRegistrationType: 'standard',
      },
      items: [
        {
          name: 'Consulting',
          unitPriceWithoutVat: 100,
          quantity: 2,
          vatRate: 23,
          unit: 'hod',
          note: 'March',
        },
      ],
      issueDate: '2026-08-05',
      dueDate: '2026-08-19',
      deliveryDate: '2026-08-05',
      currency: 'EUR',
      note: 'Thank you',
      noteAboveItems: 'Above',
      internalNote: 'Internal',
      paymentType: 'transfer' as const,
      paymentInfo: {
        iban: 'SK6807200002891987426353',
        variableSymbol: '2026500',
      },
      paid: true,
    };

    await withFetch(
      () => jsonResponse(200, issued('CompanyDocId00000001', 'TEST-2026500')),
      async (calls) => {
        const result = await doklado.invoices.create(input);
        const data = requestData(assertSinglePost(calls, issueUrl));
        assert.equal(data.organizationId, '87654321');
        assert.equal(data.number, 'TEST-2026500');
        assert.deepEqual(data.accountingSettings, {
          numericCodeId: 'TESTRADEXPORT',
        });
        assert.deepEqual(data.customer, input.customer);
        assert.deepEqual(data.items, input.items);
        assert.equal(data.issueDate, '2026-08-05');
        assert.equal(data.dueDate, '2026-08-19');
        assert.equal(data.deliveryDate, '2026-08-05');
        assert.equal(data.currency, 'EUR');
        assert.equal(data.note, 'Thank you');
        assert.equal(data.noteAboveItems, 'Above');
        assert.equal(data.internalNote, 'Internal');
        assert.equal(data.paymentType, 'transfer');
        assert.deepEqual(data.paymentInfo, input.paymentInfo);
        assert.equal(data.paid, true);
        assert.equal(result.data.invoiceNumber, 'TEST-2026500');
      },
    );
  });

  test('card payment does not require an iban', async () => {
    const doklado = client();

    await withFetch(
      () => jsonResponse(200, issued()),
      async (calls) => {
        await doklado.invoices.create({
          ...privateInvoice(),
          paymentType: 'card',
          paid: false,
        });
        const data = requestData(assertSinglePost(calls, issueUrl));
        assert.equal(data.paymentType, 'card');
        assert.equal(data.paid, false);
        assert.equal(Object.hasOwn(data, 'paymentInfo'), false);
      },
    );
  });

  test('rejects invalid input before any request', async () => {
    const doklado = client();
    const cases = [
      {
        name: 'transfer',
        input: {
          ...privateInvoice(),
          paymentType: 'transfer' as const,
        },
      },
      {
        name: 'empty iban',
        input: {
          ...privateInvoice(),
          paymentType: 'transfer' as const,
          paymentInfo: { iban: '' },
        },
      },
      {
        name: 'nan quantity',
        input: {
          type: 'issued_invoice' as const,
          customer: { name: 'Ada Lovelace' },
          items: [
            {
              name: 'Work',
              unitPriceWithoutVat: 10,
              quantity: Number.NaN,
            },
          ],
        },
      },
    ];

    for (const entry of cases) {
      await withFetch(
        () => {
          throw new Error(`network used for ${entry.name}`);
        },
        async (calls) => {
          const error = await rejected(() =>
            doklado.invoices.create(entry.input),
          );
          assert.ok(error instanceof InputError, entry.name);
          assert.equal(error.uncertain, false, entry.name);
          assert.equal(calls.length, 0, entry.name);
        },
      );
    }
  });

  test('requires an organisation id from the call, config, or env', async () => {
    const doklado = createClient({ apiKey, baseUrl });
    const error = await rejected(() =>
      doklado.invoices.create(privateInvoice()),
    );
    assert.ok(error instanceof InputError);
    assert.match(error.message, /DOKLADO_ORGANIZATION_ID/);
  });

  test('keeps auth and application error bodies', async () => {
    const doklado = client();
    const cases = [
      {
        status: 403,
        body: { error: 'Unauthorized!' },
        kind: 'http' as const,
      },
      {
        status: 401,
        body: { error: 'You are not authorized to make this request' },
        kind: 'http' as const,
      },
      {
        status: 200,
        body: { success: false, code: 'APP_ORGANIZATION_NOT_FOUND' },
        kind: 'api' as const,
        code: 'APP_ORGANIZATION_NOT_FOUND',
      },
      {
        status: 200,
        body: {
          success: false,
          code: 'APP_DOCUMENT_ALREADY_EXISTS',
          data: {
            expenseId: 'AbCdEfGhIjKlMnOpQrSt',
            invoiceType: 'domestic_exposed',
            invoiceNumber: '2026001',
            supplierName: 'Example s.r.o.',
            customerName: 'Ada Lovelace',
          },
        },
        kind: 'api' as const,
        code: 'APP_DOCUMENT_ALREADY_EXISTS',
      },
      {
        status: 200,
        body: {
          success: false,
          code: 'APP_INCORRECT_INPUT_DATA',
          data: {
            properties: {
              organizationId: {
                errors: ['Invalid input: expected string, received undefined'],
              },
            },
          },
        },
        kind: 'api' as const,
        code: 'APP_INCORRECT_INPUT_DATA',
      },
      {
        status: 200,
        body: {
          success: false,
          code: 'APP_INCORRECT_INPUT_DATA',
          message: 'Incorrect numeric code',
        },
        kind: 'api' as const,
        code: 'APP_INCORRECT_INPUT_DATA',
      },
      {
        status: 200,
        body: {
          success: false,
          code: 'APP_INCORRECT_INPUT_DATA',
          message: 'Invoice number doesnt match numeric code format',
        },
        kind: 'api' as const,
        code: 'APP_INCORRECT_INPUT_DATA',
      },
    ];

    for (const entry of cases) {
      await withFetch(
        () => jsonResponse(entry.status, entry.body),
        async (calls) => {
          const error = await rejected(() =>
            doklado.invoices.create(privateInvoice()),
          );
          assertSinglePost(calls, issueUrl);
          assert.equal(error instanceof TimeoutError, false);

          if (entry.kind === 'http') {
            assert.ok(error instanceof HttpError);
            assert.equal(error.statusCode, entry.status);
            assert.deepEqual(error.body, entry.body);
            assert.equal(error.uncertain, false);
            return;
          }

          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 200);
          assert.equal(error.code, entry.code);
          assert.deepEqual(error.body, entry.body);
          assert.equal(error.uncertain, false);
          if (
            'message' in entry.body &&
            typeof entry.body.message === 'string'
          ) {
            assert.equal(error.message.includes(entry.body.message), true);
          }
        },
      );
    }
  });

  test('reports html client errors without treating them as uncertain', async () => {
    const doklado = client();
    const html = '<!doctype html><pre>SyntaxError: Unexpected token</pre>';

    await withFetch(
      () =>
        new Response(html, {
          status: 400,
          headers: { 'content-type': 'text/html' },
        }),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.create(privateInvoice()),
        );
        assertSinglePost(calls, issueUrl);
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.uncertain, false);
        assert.equal(typeof error.body, 'string');
        assert.match(String(error.body), /SyntaxError/);
      },
    );
  });

  test('does not retry when the response is lost after create', async () => {
    const doklado = client();

    await withFetch(
      () => {
        throw new Error('socket hang up');
      },
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.create(privateInvoice()),
        );
        assert.equal(calls.length, 1);
        assert.ok(error instanceof NetworkError);
        assert.equal(error.uncertain, true);
        assert.match(error.message, /invoice may already exist/);
      },
    );
  });

  test('does not retry when create times out', async () => {
    const doklado = client(20);

    await withFetch(
      (_call, init) => hangUntilAbort(init),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.create(privateInvoice()),
        );
        assert.equal(calls.length, 1);
        assert.ok(error instanceof TimeoutError);
        assert.equal(error.uncertain, true);
        assert.match(error.message, /timed out after 20ms/);
        assert.match(error.message, /invoice may already exist/);
        assert.equal(error.message.includes(baseUrl), false);
      },
    );
  });

  test('marks an unreadable create response as uncertain', async () => {
    const doklado = client();
    const bodies = [
      '{{',
      '',
      '<html>ok</html>',
      JSON.stringify({ success: true, data: { invoiceNumber: '1' } }),
      JSON.stringify({ success: true, data: null, extra: true }),
      JSON.stringify({ success: true }),
    ];

    for (const body of bodies) {
      await withFetch(
        () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        async (calls) => {
          const error = await rejected(() =>
            doklado.invoices.create(privateInvoice()),
          );
          assert.equal(calls.length, 1);
          assert.ok(error instanceof ResponseError);
          assert.equal(error.uncertain, true);
          assert.equal(error.statusCode, 200);
        },
      );
    }
  });

  test('treats a create 500 as uncertain unless the body is an api error', async () => {
    const doklado = client();

    await withFetch(
      () => jsonResponse(500, { error: 'upstream' }),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.create(privateInvoice()),
        );
        assert.equal(calls.length, 1);
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.uncertain, true);
        assert.match(error.message, /invoice may already exist/);
      },
    );

    await withFetch(
      () =>
        jsonResponse(500, {
          success: false,
          code: 'APP_INCORRECT_INPUT_DATA',
        }),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.create(privateInvoice()),
        );
        assert.equal(calls.length, 1);
        assert.ok(error instanceof ApiError);
        assert.equal(error.uncertain, false);
      },
    );
  });
});

describe('invoices.downloadPdf', () => {
  test('returns decoded pdf bytes and response metadata', async () => {
    const doklado = client();
    const bytes = Buffer.from('%PDF-1.3\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
    const encoded = Buffer.from(bytes).toString('base64');
    const wrapped = encoded.replace(/(.{8})/g, '$1\n');

    await withFetch(
      () =>
        jsonResponse(200, {
          success: true,
          ignored: true,
          data: {
            'Content-Type': 'application/pdf',
            encoding: 'base64',
            data: wrapped,
            pages: 1,
          },
        }),
      async (calls) => {
        const result = await doklado.invoices.downloadPdf({
          documentId: 'AbCdEfGhIjKlMnOpQrSt',
        });
        const data = requestData(assertSinglePost(calls, pdfUrl));
        assert.deepEqual(data, {
          organizationId,
          documentId: 'AbCdEfGhIjKlMnOpQrSt',
        });
        assert.equal(result.statusCode, 200);
        assert.equal(result.contentType, 'application/pdf');
        assert.equal(result.encoding, 'base64');
        assert.deepEqual(result.data, new Uint8Array(bytes));
        assert.equal(result.data.byteOffset, 0);
        assert.equal(result.data.buffer.byteLength, result.data.byteLength);
      },
    );
  });

  test('rejects invalid pdf payloads', async () => {
    const doklado = client();
    const payloads: unknown[] = [
      {
        success: true,
        data: {
          'Content-Type': 'application/pdf',
          encoding: 'base64',
          data: '%%%%',
        },
      },
      {
        success: true,
        data: {
          'Content-Type': 'application/pdf',
          encoding: 'base64',
          data: Buffer.from('hello').toString('base64'),
        },
      },
      {
        success: true,
        data: {
          encoding: 'base64',
          data: Buffer.from('%PDF-1.3\n').toString('base64'),
        },
      },
      {
        success: true,
        data: {
          'Content-Type': 'application/pdf',
          encoding: 'hex',
          data: Buffer.from('%PDF-1.3\n').toString('base64'),
        },
      },
      {
        success: true,
        data: {
          'content-type': 'application/pdf',
          encoding: 'base64',
          data: Buffer.from('%PDF-1.3\n').toString('base64'),
        },
      },
    ];

    for (const payload of payloads) {
      await withFetch(
        () => jsonResponse(200, payload),
        async (calls) => {
          const error = await rejected(() =>
            doklado.invoices.downloadPdf({ documentId: 'doc-1' }),
          );
          assert.equal(calls.length, 1);
          assert.ok(error instanceof ResponseError);
          assert.equal(error.uncertain, false);
          assert.equal(error.message.includes('may already exist'), false);
        },
      );
    }

    await withFetch(
      () =>
        new Response(Buffer.from('%PDF-1.3\n'), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.downloadPdf({ documentId: 'doc-1' }),
        );
        assert.equal(calls.length, 1);
        assert.ok(error instanceof ResponseError);
        assert.equal(error.uncertain, false);
      },
    );
  });

  test('returns the not-found application error', async () => {
    const doklado = client();

    await withFetch(
      () =>
        jsonResponse(200, {
          success: false,
          code: 'APP_INCORRECT_INPUT_DATA',
        }),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.downloadPdf({ documentId: 'missing' }),
        );
        assertSinglePost(calls, pdfUrl);
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, 'APP_INCORRECT_INPUT_DATA');
        assert.equal(error.statusCode, 200);
        assert.equal(error.uncertain, false);
      },
    );
  });

  test('pdf timeout is not described as a created invoice', async () => {
    const doklado = client(20);

    await withFetch(
      (_call, init) => hangUntilAbort(init),
      async (calls) => {
        const error = await rejected(() =>
          doklado.invoices.downloadPdf({ documentId: 'doc-1' }),
        );
        assert.equal(calls.length, 1);
        assert.ok(error instanceof TimeoutError);
        assert.equal(error.uncertain, false);
        assert.equal(error.message.includes('may already exist'), false);
        assert.equal(error.message.includes(issueUrl), false);
      },
    );
  });
});
