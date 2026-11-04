#!/usr/bin/env node
/**
 * `npm run memory:checklist` — list the work needed to bring the kernel back in
 * sync with the archive: missing L1/L2/L4, stale L3/L3.1, L5 nodes, index and
 * thread docs. Read-only unless `--stage` is passed.
 *
 *   --json   machine-readable output
 *   --stage  write data/private/memory-kernel/inbox-staging.json with the new
 *            sessions as todo candidates (never generates content)
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  collectMemoryChecklist, formatChecklist, stagingCandidates,
} from './memory-freshness.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const has = name => process.argv.includes(name);

const checklist = await collectMemoryChecklist(projectRoot);
if (has('--json')) console.log(JSON.stringify(checklist, null, 2));
else console.log(formatChecklist(checklist));

if (has('--stage')) {
  const candidates = stagingCandidates(checklist);
  const target = checklist.status.paths.staging;
  await writeFile(target, JSON.stringify({
    schema: 'ceobe.memory-inbox-staging/1',
    generated_at: new Date().toISOString(),
    note: '只生成待办，不生成内容；不要自动并入 input/，按 RUNBOOK 走 inbox/ staging。',
    candidates,
  }, null, 2) + '\n', 'utf8');
  console.log(`\nStaged ${candidates.length} candidate(s): ${target}`);
}
