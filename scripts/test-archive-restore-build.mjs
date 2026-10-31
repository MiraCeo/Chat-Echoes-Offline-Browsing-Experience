import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotArchive } from './chat-store.mjs';
import { restoreConversation } from './archive-backups.mjs';

// Exercise restore's default build:true branch. The stub builder runs in the
// fixture root, so this checks invocation/cwd/error handling without copying
// the real template tree. The real build-library has its own full test suite.
const root = await mkdtemp('data/private/archive-restore-build-test-');
const stamp = '2026-01-01T00-00-00.000Z';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pathOf = id => `archive/chatgpt-share/${id}/${stamp}/conversation.ceobe.json`;
try {
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'data/private'), { recursive: true });
  await writeFile(join(root, 'scripts/build-library.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('build-ok.txt', 'ok');\n");
  for (const id of [a, b]) {
    const path = pathOf(id);
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), JSON.stringify({ id, title: id, messages: {} }));
  }
  const entries = [a, b].map(id => ({ id, title: id, conversation_path: pathOf(id) }));
  await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    schema_version: '1.0.0', kind: 'ceobe.library', conversations: entries,
  }));

  const snapshot = await snapshotArchive(root, { id: a, title: 'restore build fixture' });
  const name = snapshot.split(/[\\/]/).pop();

  // Remove both from the live fixture; the snapshot retains both.
  for (const id of [a, b]) await rm(join(root, pathOf(id), '..'), { recursive: true, force: true });
  await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    schema_version: '1.0.0', kind: 'ceobe.library', conversations: [],
  }));

  const ok = await restoreConversation(root, { snapshot: name, chatId: a, build: true });
  assert.equal(ok.copied, true);
  assert.equal((await stat(join(root, 'build-ok.txt'))).isFile(), true);
  assert.equal((await readFile(join(root, pathOf(a)), 'utf8')).includes(a), true);
  assert.equal(JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8')).conversations.length, 1);

  await writeFile(join(root, 'scripts/build-library.mjs'), 'process.exit(1);\n');
  await assert.rejects(
    restoreConversation(root, { snapshot: name, chatId: b, build: true }),
    /build-library 失败/,
  );
  assert.equal((await stat(join(root, pathOf(b)))).isFile(), true, '构建失败时会话仍保留');
  assert.equal(JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8')).conversations.length, 2);

  console.log('PASS archive restore --build: cwd invocation, success marker, failure keeps restored archive');
} finally {
  await rm(root, { recursive: true, force: true });
}
