import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  createBookmarkStore,
  readBookmarkDocument,
  bookmarksMiddleware,
} from './bookmark-store.mjs';
import { bookmarkTargets } from './bookmark-targets.mjs';
import { createChatStore } from './chat-store.mjs';
import { createProjectStore } from './project-store.mjs';
import { acquireMutation } from './workspace-mutation.mjs';
await mkdir('data/private', { recursive: true });
const root = await mkdtemp(join(process.cwd(), 'data/private/bookmarks-test-')),
  json = async (p, d) => {
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, JSON.stringify(d));
  },
  file = join(root, 'data/private/bookmarks.ceobe.json');
let server;
try {
  const message = (role, text) => ({
      role,
      content: { type: 'text', blocks: [{ type: 'text', text }] },
    }),
    conversation = {
      title: '测试聊天',
      messages: {
        u1: message('user', '原始正文 body-only-token'),
        thought: { ...message('assistant', '不作为标题'), channel: 'analysis' },
        a1: message('assistant', '完整回复'),
        u2: message('user', '第二条消息'),
      },
      linear_message_ids: ['u1', 'thought', 'a1', 'u2'],
      resources: [],
    },
    entries = ['chat-one', 'chat-two'].map((id) => ({
      id,
      title: id,
      conversation_path: `archive/chatgpt-share/${id}/2026-01-01/conversation.ceobe.json`,
      page: `./conversations/${id}.html`,
    }));
  for (const e of entries) await json(join(root, e.conversation_path), conversation);
  await json(join(root, 'archive/library.ceobe.json'), {
    kind: 'ceobe.library',
    conversations: entries,
  });
  for (const dir of ['replay', 'dist']) {
    await mkdir(join(root, dir));
    await writeFile(join(root, dir, 'index.html'), 'before');
  }
  const sourceBytes = await readFile(join(root, entries[0].conversation_path)),
    store = createBookmarkStore(root),
    payload = {
      action: 'save',
      chatId: 'chat-one',
      messageId: 'u1',
      title: '标题',
      note: '备注 secret-note-only',
      expectedVersion: 0,
    };
  const ts = bookmarkTargets(conversation);
  assert.equal(ts[1].message_id, 'a1');
  assert.deepEqual(ts[1].message_ids, ['thought', 'a1']);
  assert.equal(ts[1].excerpt, '完整回复');
  assert.ok(!ts.some((t) => t.message_id.startsWith('ceobe-replay-turn-')));
  assert.deepEqual(await store.list(), []);
  const b = (await store.mutate(payload)).bookmark;
  assert.equal(b.version, 1);
  assert.equal((await createBookmarkStore(root).list())[0].note, payload.note);
  await assert.rejects(
    () => store.mutate(payload),
    (e) => e.status === 409,
  );
  for (const patch of [
    { messageId: 'ceobe-replay-turn-1' },
    { messageId: 'missing' },
    { messageId: 'thought' },
    { chatId: '../outside' },
    { title: ' ' },
    { note: 'x'.repeat(20001) },
  ])
    await assert.rejects(() => store.mutate({ ...payload, ...patch }));
  const updated = (
    await store.mutate({
      ...payload,
      expectedVersion: b.version,
      expectedId: b.id,
      note: '更新\r\n纯文本 <script>not-run</script>',
    })
  ).bookmark;
  assert.equal(updated.version, 2);
  assert.equal(updated.note, '更新\n纯文本 <script>not-run</script>');
  await assert.rejects(
    () => store.mutate({ ...payload, expectedVersion: 1, expectedId: b.id }),
    (e) => e.status === 409,
  );
  const release = await acquireMutation(root);
  try {
    await assert.rejects(
      () => store.mutate({ ...payload, messageId: 'u2' }),
      (e) => e.status === 409,
    );
  } finally {
    await release();
  }
  await assert.rejects(
    () => store.mutate({ action: 'delete', id: b.id, expectedVersion: 1 }),
    (e) => e.status === 409,
  );
  await store.mutate({ action: 'delete', id: b.id, expectedVersion: 2 });
  const replacement = (await store.mutate(payload)).bookmark;
  await assert.rejects(
    () => store.mutate({ ...payload, expectedVersion: 1, expectedId: b.id }),
    (e) => e.status === 409,
  );
  assert.equal((await store.list())[0].id, replacement.id);
  const cstore = createChatStore(root, {
    rebuild: async () => {
      throw Error('injected build failure');
    },
  });
  await cstore.mutate({ id: 'chat-one', action: 'rename', title: '新聊天标题' });
  assert.equal((await store.list())[0].chat_title, '新聊天标题');
  const ps = createProjectStore(join(root, 'data/private/projects.ceobe.json')),
    project = await ps.create({ name: '测试项目' });
  await ps.move('chat-one', project.id);
  assert.equal((await store.list())[0].target_state, 'available');
  await ps.mutate({ id: project.id, action: 'delete', confirm: project.id });
  assert.equal((await store.list()).length, 1);
  const reordered = structuredClone(conversation);
  reordered.messages.insert = message('user', '新插入');
  reordered.linear_message_ids.unshift('insert');
  await json(join(root, entries[0].conversation_path), reordered);
  assert.equal((await store.list())[0].order, 1);
  reordered.linear_message_ids = reordered.linear_message_ids.filter((id) => id !== 'u1');
  await json(join(root, entries[0].conversation_path), reordered);
  assert.equal((await store.list())[0].target_state, 'message_missing');
  assert.equal((await store.list())[0].note, payload.note);
  await writeFile(join(root, entries[0].conversation_path), sourceBytes);
  const before = await readFile(file);
  await assert.rejects(() =>
    cstore.mutate({ id: 'chat-one', action: 'delete', confirm: 'chat-one' }),
  );
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readFile(join(root, entries[0].conversation_path)), sourceBytes);
  const brokenCommit = createChatStore(root, {
    rebuild: async (stage) => {
      await writeFile(join(stage, '../backup/archive'), 'injected parent collision');
    },
  });
  await assert.rejects(() =>
    brokenCommit.mutate({ id: 'chat-one', action: 'delete', confirm: 'chat-one' }),
  );
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readFile(join(root, entries[0].conversation_path)), sourceBytes);
  assert.deepEqual(await readdir(join(root, 'data/private/delete-jobs')), []);
  await writeFile(file, '{broken');
  await assert.rejects(() => store.list());
  await assert.rejects(() => store.mutate({ ...payload, messageId: 'u2' }));
  await assert.rejects(() =>
    cstore.mutate({ id: 'chat-one', action: 'delete', confirm: 'chat-one' }),
  );
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await writeFile(file, before);
  await rm(file);
  await writeFile(join(root, 'outside.json'), before);
  await mkdir(join(root, 'outside-dir'));
  await symlink(join(root, 'outside-dir'), file, 'junction');
  await assert.rejects(() => store.list());
  await assert.rejects(() => store.mutate({ ...payload, messageId: 'u2' }));
  await rm(file, { recursive: true });
  await writeFile(file, before);
  const api = bookmarksMiddleware(root);
  server = createServer((req, res) =>
    api(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/bookmarks';
  assert.equal((await fetch(url)).status, 200);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' },
        body: JSON.stringify(payload),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }))
      .status,
    415,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, messageId: 'u2', note: '正文' }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(140000),
      })
    ).status,
    413,
  );
  await store.mutate({ ...payload, chatId: 'chat-two' });
  const deleter = createChatStore(root, {
    rebuild: async (stage) => {
      const p = join(stage, 'archive/library.ceobe.json'),
        index = JSON.parse(await readFile(p));
      index.conversations = index.conversations.filter((c) => c.id !== 'chat-one');
      await json(p, index);
      for (const dir of ['replay', 'dist']) {
        await mkdir(join(stage, dir));
        await writeFile(join(stage, dir, 'index.html'), 'rebuilt');
      }
    },
  });
  await deleter.mutate({ id: 'chat-one', action: 'delete', confirm: 'chat-one' });
  assert.deepEqual(
    (await readBookmarkDocument(root)).items.map((b) => b.chat_id),
    ['chat-two'],
  );
  assert.equal((await store.list())[0].target_state, 'available');
  assert.deepEqual(await readdir(join(root, 'data/private/delete-jobs')), []);
  console.log(
    'PASS bookmarks store: canonical IDs/grouped replies, unique targets, optional/plain notes, restart, CAS and delete/recreate ABA, lock, rename/project removal, reorder/reimport/missing targets, unchanged originals, corrupt/symlink fail-closed, origin/body guards, failed-build and mid-commit rollback, successful chat deletion cleanup. Isolated fixtures only.',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
