import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotArchive } from './chat-store.mjs';
import { listSnapshots, restoreConversation, exportSnapshot, pruneSnapshots } from './archive-backups.mjs';

const root = await mkdtemp('data/private/archive-restore-test-');
const stamp = '2026-01-01T00-00-00.000Z';
const id = '11111111-1111-4111-8111-111111111111';
const keep = '22222222-2222-4222-8222-222222222222';
const conversationPath = `archive/chatgpt-share/${id}/${stamp}/conversation.ceobe.json`;
const keepPath = `archive/chatgpt-share/${keep}/${stamp}/conversation.ceobe.json`;
try {
  await mkdir(join(root, 'data/private'), { recursive: true });
  for (const [chatId, path] of [[id, conversationPath], [keep, keepPath]]) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), JSON.stringify({ id: chatId, title: chatId, messages: {} }));
    await writeFile(join(root, path, '..', 'attachment.txt'), `attachment-${chatId}`);
  }
  const entries = [
    { id, title: '测试恢复', conversation_path: conversationPath },
    { id: keep, title: '保留会话', conversation_path: keepPath },
  ];
  await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    schema_version: '1.0.0', kind: 'ceobe.library', conversations: entries,
  }, null, 2));

  const snapshot = await snapshotArchive(root, { id, title: '删除前快照' });
  const name = snapshot.split(/[\\/]/).pop();
  assert.equal((await listSnapshots(root))[0].name, name);
  assert.equal((await listSnapshots(root))[0].conversations, 2);

  // Simulate the conversation being deleted from the live archive.
  await rm(join(root, conversationPath, '..'), { recursive: true });
  await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    schema_version: '1.0.0', kind: 'ceobe.library', conversations: [entries[1]],
  }, null, 2));

  const dry = await restoreConversation(root, { snapshot: name, chatId: id, build: false, dryRun: true });
  assert.equal(dry.copied, false);
  await assert.rejects(stat(join(root, conversationPath)));

  const restored = await restoreConversation(root, { snapshot: name, chatId: id, build: false });
  assert.equal(restored.copied, true);
  assert.equal((await readFile(join(root, conversationPath), 'utf8')).includes(id), true);
  const library = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8'));
  assert.deepEqual(library.conversations.map(item => item.id).sort(), [id, keep].sort());
  await assert.rejects(
    restoreConversation(root, { snapshot: name, chatId: id, build: false }),
    /已存在|拒绝覆盖/,
  );

  const exportTarget = join(root, 'offsite-copy');
  await exportSnapshot(root, { snapshot: name, to: exportTarget });
  assert.equal((await stat(join(exportTarget, 'archive/library.ceobe.json'))).isFile(), true);
  assert.equal((await stat(join(exportTarget, conversationPath))).isFile(), true);
  assert.equal(JSON.parse(await readFile(join(exportTarget, 'archive/library.ceobe.json'), 'utf8')).conversations.length, 2);

  const second = await snapshotArchive(root, { id: keep, title: '第二份快照' });
  const secondName = second.split(/[\\/]/).pop();
  const pruneDry = await pruneSnapshots(root, { keep: 1, dryRun: true });
  assert.equal(pruneDry.removed.length, 1);
  assert.equal((await listSnapshots(root)).length, 2);
  const pruned = await pruneSnapshots(root, { keep: 1, dryRun: false });
  assert.equal(pruned.remaining.length, 1);
  assert.equal((await listSnapshots(root)).length, 1);
  assert.equal(pruned.remaining[0].name, secondName);

  console.log('PASS archive backups: list, dry-run, restore, no-overwrite, offsite export, prune');
} finally {
  await rm(root, { recursive: true, force: true });
}
