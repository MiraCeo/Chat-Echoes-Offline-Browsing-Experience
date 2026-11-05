import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSnapshot, listSnapshots, pruneSnapshots, restoreSnapshot,
} from './kernel-snapshot.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-kernel-snapshot-'));
const source = join(root, 'data/private/memory-kernel/source');
const write = async (path, text) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
};

try {
  await write(join(source, 'PROMPT-L4.md'), '# L4 v1\n');
  await write(join(source, 'validate-events.mjs'), '// v1\n');
  await write(join(source, 'overlay/archive-map.json'), '{"sessions":[]}\n');
  await write(join(source, 'global/tree.json'), '{"nodes":[]}\n');
  await write(join(source, '.git/config'), 'should be excluded\n');

  const first = await createSnapshot(root);
  assert.match(first.name, /^kernel-/);
  assert.equal(first.manifest.schema, 'ceobe.kernel-snapshot/1');
  assert.equal(first.manifest.files, 4, '.git 不应进入快照');
  assert.ok(first.manifest.hashes['PROMPT-L4.md']);
  assert.equal(first.manifest.hashes['global/l5-g1.json'], undefined, '缺失的关键文件不写哈希');

  const listed = await listSnapshots(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, first.name);

  // Modify the source, then restore the snapshot.
  await write(join(source, 'PROMPT-L4.md'), '# L4 v2 (broken)\n');
  await write(join(source, 'extra.md'), 'not in the snapshot\n');
  const restored = await restoreSnapshot(root, first.name);
  assert.equal(restored.restored, first.name);
  assert.match(restored.pre_restore, /^kernel-pre-restore-/);
  assert.equal(await readFile(join(source, 'PROMPT-L4.md'), 'utf8'), '# L4 v1\n');
  await assert.rejects(readFile(join(source, 'extra.md'), 'utf8'), '恢复应移除快照里没有的文件');

  // Retention keeps the newest N. After the restore there are two snapshots
  // (first + pre-restore); two more makes four, so keeping two removes two.
  await createSnapshot(root);
  await createSnapshot(root);
  assert.equal((await listSnapshots(root)).length, 4);
  const removed = await pruneSnapshots(root, 2);
  assert.equal(removed.length, 2);
  assert.equal((await listSnapshots(root)).length, 2);

  console.log('PASS kernel snapshot: create, list, restore with pre-restore backup, retention');
} finally {
  await rm(root, { recursive: true, force: true });
}
