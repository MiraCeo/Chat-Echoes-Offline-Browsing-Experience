#!/usr/bin/env node
/**
 * `npm run memory:status` — compare archive, kernel source, derived view and
 * the published page. Read-only; never touches the corpus.
 *
 *   --json    machine-readable output
 *   --strict  exit 1 when anything is stale (default exits 0)
 */
import { resolve } from 'node:path';
import { collectMemoryStatus, formatStatus } from './memory-freshness.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const has = name => process.argv.includes(name);

const status = await collectMemoryStatus(projectRoot);
if (has('--json')) console.log(JSON.stringify(status, null, 2));
else console.log(formatStatus(status));

if (has('--strict') && status.stale) process.exit(1);
