# doklado-library

TypeScript SDK and `doklado` CLI for the [Doklado](https://doklado.com/sk) invoice API.

Doklado currently has only a production API. There is no sandbox. An invoice issued there is a real numbered document. For local work, point this client at [doklado-mock](https://github.com/martindzejky/doklado-mock).

## Install

Node.js 24 or newer.

```sh
pnpm add @martindzejky/doklado-library
```

```sh
npm install @martindzejky/doklado-library
```

The package is ESM only. The command installed with it is `doklado`.

## SDK

```ts
import { writeFile } from 'node:fs/promises';
import { createClient } from '@martindzejky/doklado-library';

const doklado = createClient({
  apiKey: process.env.DOKLADO_API_KEY,
  baseUrl: process.env.DOKLADO_API_URL,
  organizationId: process.env.DOKLADO_ORGANIZATION_ID,
});

const created = await doklado.invoices.create({
  type: 'issued_invoice',
  customer: {
    name: 'Ada Lovelace',
    nonCorporateEntity: true,
    contactEmail: 'ada@example.com',
  },
  items: [
    {
      name: 'Work',
      unitPriceWithoutVat: 100,
      quantity: 1,
      vatRate: 23,
    },
  ],
});

const pdf = await doklado.invoices.downloadPdf({
  documentId: created.data.documentId,
});

await writeFile('invoice.pdf', pdf.data);
```

`createClient` returns `invoices.create` and `invoices.downloadPdf`. A successful create resolves to `{ statusCode, data: { documentId, invoiceNumber } }`. A successful PDF download resolves to `{ statusCode, data, contentType, encoding }`, where `data` is the PDF bytes.

Pass `apiKey`, `baseUrl`, and `organizationId` on the client, or leave them unset and the SDK reads `DOKLADO_API_KEY`, `DOKLADO_API_URL`, and `DOKLADO_ORGANIZATION_ID` from `process.env`. There is no default host. `timeoutMs` defaults to 15000.

The SDK does not load `.env` files.

## CLI

```sh
doklado invoices create --data @invoice.json
doklado invoices create --data -
doklado invoices pdf AbCdEfGhIjKlMnOpQrSt --path invoice.pdf
```

`--data` is inline JSON, `@` plus a file path, or `-` to read stdin. The document id for `invoices pdf` is positional. `--path` is required. The PDF is written to that file and is not printed.

`--output text` is the default. `--output json` prints one JSON object on stdout. Failures go to stderr and the process exits with status 1.

```sh
doklado --api-key "$DOKLADO_API_KEY" \
  --base-url "$DOKLADO_API_URL" \
  --organization-id "$DOKLADO_ORGANIZATION_ID" \
  --output json \
  invoices create --data @invoice.json
```

`@file` paths and `--path` are resolved from the working directory.

## Configuration

Flags win over environment variables. Environment variables that are already set win over `.env`.

| Flag                | Environment variable      |
| ------------------- | ------------------------- |
| `--api-key`         | `DOKLADO_API_KEY`         |
| `--base-url`        | `DOKLADO_API_URL`         |
| `--organization-id` | `DOKLADO_ORGANIZATION_ID` |

`doklado` loads `.env` from the working directory. A missing file is ignored, and values already in the environment are left alone. The SDK never loads that file. If you import `createClient` yourself, load environment variables in your own process first.

`timeoutMs` is an SDK option only. The CLI uses the 15 second default.

See `.env.example` for the variable names.

## Invoice fields

`invoices.create` accepts a fixed subset of the issue-invoice payload. Other fields the API may know about are left out.

- `organizationId`, when you are not using the client default
- `type`: `issued_invoice`, `issued_credit`, `issued_debit`, `issued_advance`, `issued_tax_document`
- `customer.name`, `ico`, `dic`, `icDph`, `vatPayer`, `nonCorporateEntity`, `streetName`, `propertyRegistrationNumber`, `buildingNumber`, `postalCode`, `municipality`, `country`, `countryCode`, `registerNumberText`, `vatRegistrationType`, `contactEmail`
- `items`: `name`, `unitPriceWithoutVat`, `quantity`, and optional `vatRate`, `unit`, `note`
- `issueDate`, `dueDate`, `deliveryDate`, `number`, `currency`, `paid`
- `note`, `noteAboveItems`, `internalNote`
- `accountingSettings.numericCodeId`, the series export abbreviation
- `paymentType`: `cash`, `card`, `transfer`, `cash_on_delivery`
- `paymentInfo.iban` and `paymentInfo.variableSymbol`

`paymentType: "transfer"` requires `paymentInfo.iban`. `customer.contactEmail` is the address you keep for sending the PDF yourself. This client does not send email.

## Errors

Failures throw.

- `ConfigError` when the API key or base URL is missing or invalid
- `InputError` when the invoice is rejected before a request is sent
- `HttpError` for a non-2xx response, including 401, 403, 400, and 5xx, with `statusCode` and `body`
- `ApiError` when Doklado responds with HTTP 200, `success: false`, and a `code`
- `TimeoutError` when the request exceeds `timeoutMs`
- `NetworkError` when no response arrives
- `ResponseError` when the body cannot be read, including a PDF payload that is not valid base64 or does not start with `%PDF-`

`error.uncertain` is true when a create may already have been issued. That covers a timeout, a dropped connection, an unreadable create body, or an HTTP 5xx that is not an application error. `ApiError` leaves `uncertain` false. A PDF call leaves `uncertain` false.

Messages, causes, and response bodies are passed through. The API key is sent only in the `api_key` header.

The CLI prints the same failure as text, or as `{ "ok": false, ... }` when `--output json` is set. Commander usage errors, such as a missing argument, also exit 1. `--help` and `--version` exit 0.

## Create is not idempotent

`invoices.create` sends one request and does not retry. A timeout or a lost response can mean Doklado already issued the invoice. Calling create again can issue a second one. Find out whether that invoice exists before you create another.

PDF download is a separate call. If it fails, call `invoices.downloadPdf` again with the same document id. That retry does not create an invoice.

## Local development

Run the mock and point the client at it. Do not use your production key.

```sh
npx @martindzejky/doklado-mock@1.0.1
```

The example config shipped with the mock listens on `http://127.0.0.1:3000`, accepts `test-api-key`, and uses organisation id `12345678`.

```sh
DOKLADO_API_KEY=test-api-key \
DOKLADO_API_URL=http://127.0.0.1:3000 \
DOKLADO_ORGANIZATION_ID=12345678 \
doklado invoices create --data @invoice.json
```

The mock keeps invoices in memory and exposes test controls under `/__mock`. This library does not call those controls. Details are in the [doklado-mock](https://github.com/martindzejky/doklado-mock) repository.
