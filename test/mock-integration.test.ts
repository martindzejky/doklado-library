import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { after, before, describe, test } from 'node:test';
import {
  ApiError,
  HttpError,
  InputError,
  TimeoutError,
  createClient,
} from '../src/index.ts';
import type { CreateInvoiceInput } from '../src/types.ts';
import { isRecord } from '../src/record.ts';
import { startMock, type RunningMock } from './mock-runtime.ts';

const apiKey = 'test-api-key';
const organizationId = '12345678';

let mock: RunningMock;

function client(timeoutMs?: number) {
  if (timeoutMs === undefined) {
    return createClient({
      apiKey,
      baseUrl: mock.baseUrl,
      organizationId,
    });
  }

  return createClient({
    apiKey,
    baseUrl: mock.baseUrl,
    organizationId,
    timeoutMs,
  });
}

function privateInvoice(): CreateInvoiceInput {
  return {
    type: 'issued_invoice',
    customer: {
      name: 'Ada Lovelace',
      nonCorporateEntity: true,
      country: 'Slovensko',
      countryCode: 'sk',
      contactEmail: 'ada@example.com',
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

type MockState = {
  invoices: Record<string, unknown>[];
  requests: Record<string, unknown>[];
};

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }

  assert.fail('expected the call to fail');
}

async function reset(): Promise<void> {
  const response = await fetch(`${mock.baseUrl}/__mock/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

async function fault(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${mock.baseUrl}/__mock/fault`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, await response.text());
}

function asRecords(value: unknown, label: string): Record<string, unknown>[] {
  assert.ok(Array.isArray(value), label);
  const records: Record<string, unknown>[] = [];

  for (const entry of value) {
    assert.ok(isRecord(entry), label);
    records.push(entry);
  }

  return records;
}

async function state(): Promise<MockState> {
  const response = await fetch(`${mock.baseUrl}/__mock/state`);
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return {
    invoices: asRecords(body.invoices, 'invoices'),
    requests: asRecords(body.requests, 'requests'),
  };
}

function countPath(snapshot: MockState, path: string): number {
  let count = 0;

  for (const request of snapshot.requests) {
    if (request.path === path) {
      count += 1;
    }
  }

  return count;
}

function issueBodies(snapshot: MockState): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];

  for (const request of snapshot.requests) {
    if (
      request.path !== '/v1/documents/invoice-issue' ||
      !isRecord(request.requestBody) ||
      !isRecord(request.requestBody.data)
    ) {
      continue;
    }

    bodies.push(request.requestBody.data);
  }

  return bodies;
}

function requestData(
  snapshot: MockState,
  path: string,
): Record<string, unknown> {
  for (const request of snapshot.requests) {
    if (request.path !== path || !isRecord(request.requestBody)) {
      continue;
    }

    const wrapped = request.requestBody.data;
    if (isRecord(wrapped)) {
      return wrapped;
    }
  }

  assert.fail(`missing request body for ${path}`);
}

function invoiceByNumber(
  snapshot: MockState,
  invoiceNumber: string,
): Record<string, unknown> {
  for (const invoice of snapshot.invoices) {
    if (invoice.invoiceNumber === invoiceNumber) {
      return invoice;
    }
  }

  assert.fail(`missing invoice ${invoiceNumber}`);
}

async function waitForRequests(
  path: string,
  expected: number,
): Promise<MockState> {
  const deadline = Date.now() + 4_000;
  let snapshot = await state();

  while (Date.now() < deadline) {
    snapshot = await state();
    if (countPath(snapshot, path) >= expected) {
      return snapshot;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  return snapshot;
}

describe('doklado-mock integration', { concurrency: false }, () => {
  before(async () => {
    mock = await startMock();
    assert.equal(mock.baseUrl.startsWith('http://127.0.0.1:'), true);
  });

  after(async () => {
    await mock.stop();
  });

  test('creates a private invoice and downloads the pdf', async () => {
    await reset();
    const doklado = client();
    const created = await doklado.invoices.create(privateInvoice());

    assert.equal(created.statusCode, 200);
    assert.match(created.data.documentId, /^[A-Za-z0-9]{20}$/);
    assert.equal(created.data.invoiceNumber, '2026001');

    const pdf = await doklado.invoices.downloadPdf({
      documentId: created.data.documentId,
    });
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.contentType, 'application/pdf');
    assert.equal(pdf.encoding, 'base64');
    assert.equal(
      Buffer.from(pdf.data.subarray(0, 5)).toString('ascii'),
      '%PDF-',
    );

    const snapshot = await state();
    assert.equal(snapshot.invoices.length, 1);
    assert.equal(snapshot.invoices[0]?.hasPdf, true);
    const sent = requestData(snapshot, '/v1/documents/invoice-issue');
    assert.equal(
      isRecord(sent.customer) && sent.customer.contactEmail,
      'ada@example.com',
    );
    assert.equal(
      sent.customer &&
        isRecord(sent.customer) &&
        sent.customer.nonCorporateEntity,
      true,
    );
  });

  test('stores optional fields, dates, vat, and series numbers', async () => {
    await reset();
    const doklado = client();
    const created = await doklado.invoices.create({
      type: 'issued_invoice',
      number: 'TEST-2026500',
      accountingSettings: { numericCodeId: 'TESTRADEXPORT' },
      customer: {
        name: 'Example buyer s.r.o.',
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
        countryCode: 'sk',
        registerNumberText: 'Oddiel Sro',
        vatRegistrationType: 'standard',
        contactEmail: 'buyer@example.com',
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
      paymentType: 'transfer',
      paymentInfo: {
        iban: 'SK6807200002891987426353',
        variableSymbol: '2026500',
      },
      paid: true,
    });

    assert.equal(created.data.invoiceNumber, 'TEST-2026500');

    const next = await doklado.invoices.create({
      ...privateInvoice(),
      accountingSettings: { numericCodeId: 'TESTRADEXPORT' },
    });
    assert.equal(next.data.invoiceNumber, 'TEST-2026501');

    const snapshot = await state();
    assert.equal(snapshot.invoices.length, 2);
    const stored = invoiceByNumber(snapshot, 'TEST-2026500');
    assert.equal(stored.issuedAt, '2026-08-05T00:00:00.000Z');
    assert.equal(stored.dueDate, '2026-08-19T00:00:00.000Z');
    assert.equal(stored.deliveryDate, '2026-08-05T00:00:00.000Z');
    assert.equal(stored.currency, 'EUR');
    assert.equal(stored.totalPrice, 246);
    assert.equal(stored.note, 'Thank you');
    assert.equal(stored.internalNote, 'Internal');
    assert.equal(stored.paymentType, 'transfer');
    assert.equal(stored.paymentStatus, 'paid');
    assert.equal(stored.organizationName, 'Example buyer s.r.o.');
    assert.equal(stored.subType, 'domestic_exposed');
    assert.ok(isRecord(stored.paymentInfo));
    assert.equal(stored.paymentInfo.vs, '2026500');
    assert.ok(isRecord(stored.address));
    assert.equal(stored.address.municipality, 'Bratislava');
    assert.ok(Array.isArray(stored.items));
    assert.ok(isRecord(stored.items[0]));
    assert.equal(stored.items[0].vatRate, 23);
    assert.equal(stored.items[0].unit, 'hod');
    assert.ok(isRecord(stored.accountingSettings));
    assert.ok(isRecord(stored.accountingSettings.numericCode));
    assert.equal(stored.accountingSettings.numericCode.value, 'TESTRADEXPORT');

    const sent = issueBodies(snapshot).find(
      (body) => body.number === 'TEST-2026500',
    );
    assert.ok(sent);
    assert.equal(
      isRecord(sent.customer) && sent.customer.contactEmail,
      'buyer@example.com',
    );
  });

  test('reports auth and application errors from the mock', async () => {
    await reset();
    const wrongKey = 'not-the-mock-key';
    const denied = createClient({
      apiKey: wrongKey,
      baseUrl: mock.baseUrl,
      organizationId,
    });
    const authError = await failure(() =>
      denied.invoices.create(privateInvoice()),
    );
    assert.ok(authError instanceof HttpError);
    assert.equal(authError.statusCode, 401);
    assert.deepEqual(authError.body, {
      error: 'You are not authorized to make this request',
    });
    assert.equal(authError.uncertain, false);
    assert.equal(authError.message.includes(wrongKey), false);

    const doklado = client();
    const unknownOrg = await failure(() =>
      doklado.invoices.create({
        ...privateInvoice(),
        organizationId: '00000000',
      }),
    );
    assert.ok(unknownOrg instanceof ApiError);
    assert.equal(unknownOrg.code, 'APP_ORGANIZATION_NOT_FOUND');
    assert.equal(unknownOrg.statusCode, 200);
    assert.deepEqual(unknownOrg.body, {
      success: false,
      code: 'APP_ORGANIZATION_NOT_FOUND',
    });
    assert.equal(unknownOrg.uncertain, false);

    const first = await doklado.invoices.create({
      ...privateInvoice(),
      number: 'MANUAL-1',
    });
    const duplicate = await failure(() =>
      doklado.invoices.create({
        ...privateInvoice(),
        number: 'MANUAL-1',
      }),
    );
    assert.ok(duplicate instanceof ApiError);
    assert.equal(duplicate.code, 'APP_DOCUMENT_ALREADY_EXISTS');
    assert.equal(duplicate.uncertain, false);
    assert.ok(isRecord(duplicate.body));
    assert.ok(isRecord(duplicate.body.data));
    assert.equal(duplicate.body.data.expenseId, first.data.documentId);
    assert.equal(duplicate.body.data.invoiceNumber, 'MANUAL-1');
    assert.equal(duplicate.body.data.customerName, 'Ada Lovelace');
    assert.equal(duplicate.body.data.supplierName, 'Example s.r.o.');
    assert.equal(duplicate.body.data.invoiceType, 'domestic_exposed');

    const badSeries = await failure(() =>
      doklado.invoices.create({
        ...privateInvoice(),
        accountingSettings: { numericCodeId: 'NOT_A_SERIES' },
      }),
    );
    assert.ok(badSeries instanceof ApiError);
    assert.equal(badSeries.code, 'APP_INCORRECT_INPUT_DATA');
    assert.equal(badSeries.uncertain, false);
    assert.match(badSeries.message, /Incorrect numeric code/);

    const badNumber = await failure(() =>
      doklado.invoices.create({
        ...privateInvoice(),
        number: '2026001',
        accountingSettings: { numericCodeId: 'TESTRADEXPORT' },
      }),
    );
    assert.ok(badNumber instanceof ApiError);
    assert.equal(badNumber.code, 'APP_INCORRECT_INPUT_DATA');
    assert.match(
      badNumber.message,
      /Invoice number doesnt match numeric code format/,
    );

    const invalid = await failure(() =>
      doklado.invoices.create({
        ...privateInvoice(),
        paymentType: 'transfer',
      }),
    );
    assert.ok(invalid instanceof InputError);
    assert.equal(invalid.uncertain, false);

    const snapshot = await state();
    assert.equal(snapshot.invoices.length, 1);
    assert.equal(countPath(snapshot, '/v1/documents/invoice-issue'), 6);
  });

  test('does not issue a second invoice when create times out after success', async () => {
    await reset();
    await fault({
      path: '/v1/documents/invoice-issue',
      remaining: 1,
      afterSuccess: true,
      latencyMs: 1_000,
    });

    const error = await failure(() =>
      client(200).invoices.create(privateInvoice()),
    );
    assert.ok(error instanceof TimeoutError);
    assert.equal(error.uncertain, true);
    assert.match(error.message, /timed out after 200ms/);
    assert.match(error.message, /invoice may already exist/);

    const snapshot = await waitForRequests('/v1/documents/invoice-issue', 1);
    assert.equal(snapshot.invoices.length, 1);
    assert.equal(countPath(snapshot, '/v1/documents/invoice-issue'), 1);
  });

  test('does not issue a second invoice when create fails after success', async () => {
    await reset();
    await fault({
      path: '/v1/documents/invoice-issue',
      remaining: 1,
      afterSuccess: true,
      httpStatus: 500,
    });

    const error = await failure(() =>
      client().invoices.create(privateInvoice()),
    );
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 500);
    assert.equal(error.uncertain, true);
    assert.match(error.message, /invoice may already exist/);

    const snapshot = await state();
    assert.equal(snapshot.invoices.length, 1);
    assert.equal(countPath(snapshot, '/v1/documents/invoice-issue'), 1);
  });

  test('retries a pdf download with the same document id', async () => {
    await reset();
    const doklado = client();
    const created = await doklado.invoices.create(privateInvoice());
    await fault({
      path: '/v1/documents/get-invoice-pdf',
      remaining: 1,
      httpStatus: 500,
    });

    const error = await failure(() =>
      doklado.invoices.downloadPdf({
        documentId: created.data.documentId,
      }),
    );
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 500);
    assert.equal(error.uncertain, false);
    assert.equal(error.message.includes('may already exist'), false);

    const pdf = await doklado.invoices.downloadPdf({
      documentId: created.data.documentId,
    });
    assert.equal(
      Buffer.from(pdf.data.subarray(0, 5)).toString('ascii'),
      '%PDF-',
    );

    const snapshot = await state();
    assert.equal(snapshot.invoices.length, 1);
    assert.equal(countPath(snapshot, '/v1/documents/get-invoice-pdf'), 2);
    assert.equal(countPath(snapshot, '/v1/documents/invoice-issue'), 1);
  });
});
