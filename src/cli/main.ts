import { writeFile } from 'node:fs/promises';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { createClient } from '../index.ts';
import type { ClientConfig } from '../types.ts';
import { printCreated, printError, printSavedPdf } from './output.ts';
import type { OutputFormat } from './output.ts';
import { readInvoiceInput } from './read-data.ts';

type GlobalOptions = ClientConfig & { output: OutputFormat };

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

customer.countryCode must be lowercase, for example "sk", or the literal
"other".

Relative @file paths and the PDF --path are resolved from the working
directory. PDF bytes are written to that file and are not printed.
`;

function parseOutput(value: string): OutputFormat {
  if (value === 'text' || value === 'json') {
    return value;
  }

  throw new InvalidArgumentError('Expected "text" or "json".');
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
    .version(__PACKAGE_VERSION__, '-v, --version', 'Print the version.')
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
      const options = this.optsWithGlobals<GlobalOptions & { data: string }>();
      const input = await readInvoiceInput(options.data);
      const doklado = createClient(options);
      const created = await doklado.invoices.create(input);
      printCreated(options.output, {
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
      const options = this.optsWithGlobals<GlobalOptions & { path: string }>();
      const doklado = createClient(options);
      const pdf = await doklado.invoices.downloadPdf({ documentId });
      await writeFile(options.path, pdf.data);
      printSavedPdf(options.output, {
        statusCode: pdf.statusCode,
        path: options.path,
        documentId,
        contentType: pdf.contentType,
      });
    });

  return program;
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

    printError(program.opts<GlobalOptions>().output, error);
    return 1;
  }
}
