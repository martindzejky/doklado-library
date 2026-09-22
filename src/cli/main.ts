import { writeFile } from 'node:fs/promises';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { createClient } from '../index.ts';
import { isRecord } from '../record.ts';
import type { ClientConfig } from '../types.ts';
import { printCreated, printError, printSavedPdf } from './output.ts';
import type { OutputFormat } from './output.ts';
import { readInvoiceInput } from './read-data.ts';

const HELP = `
Examples:
  doklado invoices create --data @invoice.json
  doklado invoices create --data -
  doklado invoices pdf <document-id> --path invoice.pdf

Environment:
  DOKLADO_API_KEY
  DOKLADO_API_URL
  DOKLADO_ORGANIZATION_ID

The doklado command loads .env from the working directory. Variables
already set in the environment win over that file. Flags win over both.
The SDK does not load .env files.

Relative @file paths and the PDF --path are resolved from the working
directory. PDF bytes are written to that file and are not printed.
`;

function parseOutput(value: string): OutputFormat {
  if (value === 'text' || value === 'json') {
    return value;
  }

  throw new InvalidArgumentError('Expected "text" or "json".');
}

function readOptions(command: Command): Record<string, unknown> {
  const options: unknown = command.optsWithGlobals();

  if (!isRecord(options)) {
    throw new Error('Could not read CLI options.');
  }

  return options;
}

function readString(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(options, key)) {
    return undefined;
  }

  const value = options[key];

  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
}

function readFormat(options: Record<string, unknown>): OutputFormat {
  if (options.output === 'json') {
    return 'json';
  }

  return 'text';
}

function clientConfig(options: Record<string, unknown>): ClientConfig {
  const config: ClientConfig = {};
  const apiKey = readString(options, 'apiKey');
  const baseUrl = readString(options, 'baseUrl');
  const organizationId = readString(options, 'organizationId');

  if (apiKey !== undefined) {
    config.apiKey = apiKey;
  }

  if (baseUrl !== undefined) {
    config.baseUrl = baseUrl;
  }

  if (organizationId !== undefined) {
    config.organizationId = organizationId;
  }

  return config;
}

function addGlobalOptions(command: Command): Command {
  return command
    .option('--api-key <key>', 'API key. Overrides DOKLADO_API_KEY.')
    .option('--base-url <url>', 'API origin. Overrides DOKLADO_API_URL.')
    .option(
      '--organization-id <id>',
      'Organisation id. Overrides DOKLADO_ORGANIZATION_ID.',
    )
    .option(
      '--output <format>',
      'Output format: text or json.',
      parseOutput,
      'text',
    );
}

function buildProgram(): Command {
  const program = addGlobalOptions(new Command());

  program
    .name('doklado')
    .description('Issue Doklado invoices and download their PDFs.')
    .version(packageJson.version, '-v, --version', 'Print the version.')
    .showHelpAfterError()
    .exitOverride()
    .addHelpText('after', HELP);

  const invoices = program.command('invoices').description('Invoice commands.');

  invoices
    .command('create')
    .description('Issue an invoice from JSON.')
    .requiredOption(
      '--data <json>',
      'Invoice JSON, a @file path, or - to read stdin.',
    )
    .action(async function (this: Command) {
      const options = readOptions(this);
      const source = readString(options, 'data');

      if (source === undefined) {
        throw new Error('Missing invoice JSON.');
      }

      const input = await readInvoiceInput(source);
      const doklado = createClient(clientConfig(options));
      const created = await doklado.invoices.create(input);
      printCreated(readFormat(options), {
        statusCode: created.statusCode,
        documentId: created.data.documentId,
        invoiceNumber: created.data.invoiceNumber,
      });
    });

  invoices
    .command('pdf')
    .description('Download an invoice PDF.')
    .argument('<id>', 'Document id.')
    .requiredOption(
      '--path <file>',
      'Where to write the PDF. Relative paths use the working directory.',
    )
    .action(async function (this: Command, documentId: string) {
      const options = readOptions(this);
      const path = readString(options, 'path');

      if (path === undefined) {
        throw new Error('Missing PDF path.');
      }

      const doklado = createClient(clientConfig(options));
      const pdf = await doklado.invoices.downloadPdf({ documentId });
      await writeFile(path, pdf.data);
      printSavedPdf(readFormat(options), {
        statusCode: pdf.statusCode,
        path,
        documentId,
        contentType: pdf.contentType,
      });
    });

  return program;
}

function outputFormat(program: Command): OutputFormat {
  const options: unknown = program.opts();

  if (!isRecord(options)) {
    return 'text';
  }

  return readFormat(options);
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const program = buildProgram();

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return 0;
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    printError(outputFormat(program), error);
    return 1;
  }
}
