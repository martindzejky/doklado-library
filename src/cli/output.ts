import { ApiError, DokladoError } from '../errors.ts';

export type OutputFormat = 'text' | 'json';

type CreatedInvoice = {
  statusCode: number;
  documentId: string;
  invoiceNumber: string;
};

type SavedPdf = {
  statusCode: number;
  path: string;
  documentId: string;
  contentType: string;
};

function causeValue(cause: unknown): unknown {
  if (!(cause instanceof Error)) {
    return cause;
  }

  const described: Record<string, unknown> = {
    name: cause.name,
    message: cause.message,
  };

  if (cause.cause instanceof Error) {
    described.cause = {
      name: cause.cause.name,
      message: cause.cause.message,
    };
  } else if (cause.cause !== undefined) {
    described.cause = cause.cause;
  }

  return described;
}

function errorJson(error: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ok: false,
  };

  if (!(error instanceof Error)) {
    payload.error = { message: 'Unknown error.' };
    return payload;
  }

  const described: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error instanceof DokladoError) {
    described.uncertain = error.uncertain;

    if (error.statusCode !== undefined) {
      payload.status = error.statusCode;
    }

    if (error instanceof ApiError) {
      described.code = error.code;
    }

    if (error.body !== undefined) {
      described.body = error.body;
    }
  }

  if (error.cause !== undefined) {
    described.cause = causeValue(error.cause);
  }

  payload.error = described;
  return payload;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error.';
  }

  if (!(error instanceof DokladoError) || error.body === undefined) {
    return error.message;
  }

  return `${error.message}\n${JSON.stringify(error.body, null, 2)}`;
}

export function printCreated(
  format: OutputFormat,
  invoice: CreatedInvoice,
): void {
  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: invoice.statusCode,
          action: 'invoices.create',
          data: {
            documentId: invoice.documentId,
            invoiceNumber: invoice.invoiceNumber,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `Created invoice ${invoice.invoiceNumber}.\nDocument id: ${invoice.documentId}`,
  );
}

export function printSavedPdf(format: OutputFormat, pdf: SavedPdf): void {
  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: pdf.statusCode,
          action: 'invoices.pdf',
          data: {
            path: pdf.path,
            documentId: pdf.documentId,
            contentType: pdf.contentType,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Saved PDF to ${pdf.path}`);
}

export function printError(format: OutputFormat, error: unknown): void {
  if (format === 'json') {
    console.error(JSON.stringify(errorJson(error), null, 2));
    return;
  }

  console.error(errorText(error));
}
