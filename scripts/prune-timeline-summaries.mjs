#!/usr/bin/env node
// Remove AI summaries whose conversation no longer exists in the archive.
import { readFile, writeFile, rename, rm, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'data/private/timeline-summaries.json');
const target = join(root, 'replay/public/timeline-summaries.json');

const library = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8'));
const doc = JSON.parse(await readFile(source, 'utf8'));
const ids = new Set(library.conversations.map(entry => entry.id));
const conversations = Object.fromEntries(Object.entries(doc.conversations || {}).filter(([id]) => ids.has(id)));
const removed = Object.keys(doc.conversations || {}).filter(id => !ids.has(id));

if (!removed.length) {
  console.log(`Timeline summaries: ${Object.keys(conversations).length} entries, nothing to prune.`);
  process.exit(0);
}

const temp = source + '.' + randomUUID() + '.tmp';
try {
  await writeFile(temp, JSON.stringify({ ...doc, conversations }, null, 2), 'utf8');
  await rename(temp, source);
} finally {
  await rm(temp, { force: true });
}
try { await cp(source, target); } catch { /* replay not built yet */ }
console.log(`Timeline summaries: pruned ${removed.length} stale entr${removed.length === 1 ? 'y' : 'ies'}: ${removed.join(', ')}`);
