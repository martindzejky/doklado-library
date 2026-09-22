#!/usr/bin/env node
import { config as loadDotEnv } from 'dotenv';
import { runCli } from '../dist/cli.js';

loadDotEnv({ quiet: true });

const code = await runCli(process.argv.slice(2));
process.exit(code);
