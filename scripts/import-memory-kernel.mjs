#!/usr/bin/env node
/**
 * Import the local memory-kernel source into CEOBE.
 *
 * The source must already live under data/private/memory-kernel/source (or be
 * passed with --source). This command validates the kernel, then regenerates
 * the derived memory view. It never copies raw corpus into git-tracked paths.
 * Pass --build to also rebuild the local replay pages.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const has = name => process.argv.includes(name);
const source = resolve(option('--source') || process.env.CEOBE_MEMORY_SOURCE || join(projectRoot, 'data/private/memory-kernel/source'));
const checkOnly = has('--check-only');
const build = has('--build');
const manifestPath = join(projectRoot, 'data/private/memory-kernel/source-manifest.json');

const fail = message => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const run = (command, args, cwd = source) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} 退出码 ${result.status}`);
};
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');

if (!existsSync(join(source, 'overlay/validate-overlay.mjs'))) fail(`不是 memory kernel source：${source}`);
if (!existsSync(join(projectRoot, 'archive/library.ceobe.json'))) fail('缺少 archive/library.ceobe.json');

// Structure/method checks first, then corpus layers. Any WARN still exits 0 in
// the validators, so the adapter's own archive/count checks remain mandatory.
run(process.execPath, ['overlay/validate-overlay.mjs']);
run(process.execPath, ['validate-output.mjs', '--input', 'input', '--output', 'output']);
run(process.execPath, ['validate-memory.mjs', '--input', 'input', '--memory', 'memory']);
run(process.execPath, ['validate-events.mjs', '--input', 'input', '--events', 'events']);
run(process.execPath, ['validate-output.mjs', '--input', 'inbox', '--output', 'inbox/output']);
run(process.execPath, ['validate-memory.mjs', '--input', 'inbox', '--memory', 'inbox/memory']);
run(process.execPath, ['validate-events.mjs', '--input', 'inbox', '--events', 'inbox/events']);
run(process.execPath, ['validate-overview.mjs', '--overview', 'global/overview-v2.md']);
run(process.execPath, ['validate-tree.mjs', '--tree', 'global/tree.json', '--events', 'events,inbox/events']);
run(process.execPath, ['validate-index.mjs']);
for (const name of (await readdir(join(source, 'global/threads'))).filter(name => name.endsWith('.md')).sort()) {
  run(process.execPath, ['validate-thread.mjs', '--thread', join('global/threads', name)]);
}

const keyFiles = [
  'overlay/archive-map.json',
  'overlay/l3-global.v2.json',
  'overlay/l3-gq.v2.json',
  'overlay/l3-g1.v2.json',
  'overlay/l3-g-early.v2.json',
  'overlay/l3-g-oct.v2.json',
  'global/overview-v2.md',
  'global/tree.json',
];
const hashes = {};
for (const file of keyFiles) hashes[file] = await digest(join(source, file));
const archive = JSON.parse(await readFile(join(projectRoot, 'archive/library.ceobe.json'), 'utf8'));
if (!checkOnly) {
  run(process.execPath, [join(projectRoot, 'scripts/import-memory-overlay.mjs'), '--source', source], projectRoot);
}
if (build) run(process.execPath, [join(projectRoot, 'scripts/build-library.mjs')], projectRoot);
const view = JSON.parse(await readFile(join(projectRoot, 'data/private/memory-kernel/memory-view.json'), 'utf8').catch(() => 'null'));
const sourceFiles = await readdir(join(source, 'overlay'));
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, JSON.stringify({
  schema: 'ceobe.memory-kernel-source/1',
  imported_at: new Date().toISOString(),
  source,
  archive_sessions: archive.conversations?.length || 0,
  view_schema: view?.schema || null,
  groups: view?.archive?.groups || null,
  files: {
    overlay: sourceFiles.length,
  },
  hashes,
  note: 'Local-only source manifest. data/private is gitignored; do not commit corpus.',
}, null, 2) + '\n', 'utf8');

console.log(`\nPASS memory kernel import${checkOnly ? ' (check only)' : ''}: ${source}`);
console.log(`Manifest: ${manifestPath}`);
if (!build && !checkOnly) console.log('Next: npm run library (or use --build)');
