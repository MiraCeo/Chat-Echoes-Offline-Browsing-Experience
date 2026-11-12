import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan, prompts, register, stage, verify, workflowScript } from './memory-queue.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-memory-queue-'));
const write = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
};
const read = async path => JSON.parse(await readFile(path, 'utf8'));

const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';
const source = join(root, 'data/private/memory-kernel/source');

try {
  await write(join(root, 'archive/library.ceobe.json'), {
    conversations: [
      { id: A, title: '旧会话', created_at: 1000, updated_at: 2000, user_turn_count: 10, turn_count: 20, conversation_path: `archive/chatgpt-share/${A}/2026-01-01T00-00-00.000Z/conversation.ceobe.json` },
      { id: B, title: '新会话', created_at: 3000, updated_at: 4000, user_turn_count: 5, turn_count: 10, conversation_path: `archive/chatgpt-share/${B}/2026-02-01T00-00-00.000Z/conversation.ceobe.json` },
    ],
  });
  await write(join(root, `archive/chatgpt-share/${B}/2026-02-01T00-00-00.000Z/conversation.md`), '# 新会话\n\n内容\n');
  await write(join(root, `archive/chatgpt-share/${B}/2026-02-01T00-00-00.000Z/conversation.ceobe.json`), { linear_message_ids: ['m1', 'm2'] });

  await write(join(root, 'data/private/memory-kernel/memory-view.json'), { archive: { total: 1 } });
  await write(join(root, 'data/private/memory-kernel/source-manifest.json'), { hashes: {} });
  await write(join(root, 'replay/public/memory-data.json'), { archive: { total: 1 } });

  await write(join(source, 'overlay/archive-map.json'), {
    sessions: [{ id: A, short: 'aaaaaaaa', title: '旧会话', group: 'g1', rounds: 10 }],
    counts: { total: 1, gq: 0, g1: 1, 'g-early': 0, 'g-oct': 0 },
    rounds_by_group: { gq: 0, g1: 10, 'g-early': 0, 'g-oct': 0 },
  });
  await write(join(source, 'overlay/l3-g1.v2.json'), { coverage: { sessions: 1, rounds: 10, session_ids: [A], evidence_session_ids: [A] } });
  await write(join(source, 'overlay/l3.1-g1.v2.json'), { coverage: { sessions: 1, rounds: 10 } });
  await write(join(source, 'overlay/l3-global.v2.json'), { coverage: { sessions: 1, rounds: 10, session_ids: [A] } });
  for (const id of ['gq', 'g-early', 'g-oct']) {
    await write(join(source, `overlay/l3-${id}.v2.json`), { coverage: { sessions: 0, rounds: 0, session_ids: [] } });
  }
  await write(join(source, 'ceobe-index.json'), {
    sessions: [{ id: A, short_id: 'aaaaaaaa', title: '旧会话', group: 'g1', rounds: 10, layers: { l2: { path: `inbox/memory/${A}.md`, chars: 100 } } }],
    counts: { sessions: 1, rounds: 10, gq: 0, g1: 1, 'g-early': 0, 'g-oct': 0 },
  });
  await write(join(source, 'inbox/manifest.json'), { conversations: [{ id: A, title: '旧会话', rounds: 10, turns: 20 }] });
  await write(join(source, `inbox/conversations/${A}.md`), '# 旧会话\n');
  await write(join(source, `inbox/output/${A}.json`), { id: A });
  await write(join(source, `inbox/memory/${A}.md`), '---\nid: ' + A + '\n---\n\n# 旧会话\n');
  await write(join(source, `inbox/events/${A}.json`), { id: A, nodes: [] });
  await write(join(source, 'global/l5-g1.json'), { nodes: [{ n: 1, src: [{ s: 'aaaaaaaa' }] }], edges: [] });
  await write(join(source, 'global/tree.json'), { nodes: [{ n: 1, src: [{ s: 'aaaaaaaa' }] }], edges: [] });
  await mkdir(join(source, 'global/threads'), { recursive: true });

  const queue = await plan(root);
  assert.equal(queue.sessions.length, 1, '应检测到 1 个新会话');
  assert.equal(queue.sessions[0].id, B);
  assert.equal(queue.sessions[0].rounds, 5);
  assert.deepEqual(queue.sessions[0].tasks.map(task => task.id), ['l1', 'l2', 'l4']);
  assert.equal(queue.merges.length, 2, 'L5 组内 + 全局各一个归并任务');
  assert.equal(queue.docs.length, 2, '分册 + profile');

  const staged = await stage(queue, root);
  assert.deepEqual(staged, ['bbbbbbbb']);
  const manifest = await read(join(source, 'inbox/manifest.json'));
  const entry = manifest.conversations.find(item => item.id === B);
  assert.ok(entry, 'manifest 应新增会话');
  assert.equal(entry.last_message_id, 'm2');
  assert.match(entry.source_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(entry.rounds, 5);

  const registered = await register(queue, root);
  assert.deepEqual(registered, ['bbbbbbbb']);
  const map = await read(join(source, 'overlay/archive-map.json'));
  assert.equal(map.sessions.length, 2);
  assert.equal(map.counts.total, 2);
  assert.equal(map.counts.g1, 2);
  assert.equal(map.rounds_by_group.g1, 15);
  const index = await read(join(source, 'ceobe-index.json'));
  assert.equal(index.sessions.length, 2);
  assert.equal(index.counts.sessions, 2);
  assert.equal(index.counts.rounds, 15);
  const l3 = await read(join(source, 'overlay/l3-g1.v2.json'));
  assert.equal(l3.coverage.sessions, 2);
  assert.equal(l3.coverage.rounds, 15);
  assert.deepEqual(l3.coverage.session_ids, [A, B]);
  const globalL3 = await read(join(source, 'overlay/l3-global.v2.json'));
  assert.equal(globalL3.coverage.sessions, 2);

  const written = await prompts(queue, root);
  assert.equal(written.length, 7, '3 个抽取 + 2 个归并 + 2 个文档');
  const l1Prompt = await readFile(join(root, 'data/private/memory-kernel/queue-prompts/bbbbbbbb-l1.md'), 'utf8');
  assert.match(l1Prompt, /L1 索引摘要/);
  assert.match(l1Prompt, new RegExp(B));

  const result = await verify(queue, root);
  assert.equal(result.missing.length, 3, 'L1/L2/L4 产物还没做');
  assert.equal(result.passed.length, 2, '两棵树已存在，算通过');

  const script = workflowScript(queue, root);
  assert.match(script, /const tasks =/);
  assert.match(script, /parallel\(/);
  assert.match(script, /bbbbbbbb-l1/);
  assert.match(script, /l5-group/);

  console.log('PASS memory queue: plan detects new sessions, stage writes manifest, register updates archive-map/index/L3, prompts and verify work');
} finally {
  await rm(root, { recursive: true, force: true });
}
