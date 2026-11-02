import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const view = JSON.parse(await readFile('data/private/memory-kernel/memory-view.json', 'utf8'));
const manifest = JSON.parse(await readFile('data/private/memory-kernel/source-manifest.json', 'utf8'));
assert.equal(manifest.schema, 'ceobe.memory-kernel-source/1');
assert.match(manifest.source, /memory-kernel[\\/]source$/);
assert.ok(existsSync('data/private/memory-kernel/source/overlay/validate-overlay.mjs'));
assert.equal(manifest.archive_sessions, 31);
assert.equal(view.archive.total, 31);
assert.deepEqual(manifest.groups, { gq: 10, g1: 7, 'g-early': 11, 'g-oct': 3 });
assert.equal(manifest.view_schema, 'ceobe.memory-view/2');
assert.ok(Object.keys(manifest.hashes).length >= 8);
assert.ok(Object.values(manifest.hashes).every(value => /^[a-f0-9]{64}$/.test(value)));
console.log('PASS memory source: local kernel, manifest hashes, 31 sessions and four groups');
