import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationTimeline, buildTimelineIndex, writeTimelineIndex, TIMELINE_INDEX_FILE, TIMELINE_INDEX_KIND } from './timeline-index.mjs';

// 时间线索引：只看可见轮次；首末时间与锚点消息 ID 要给对；隐藏/推理/工具记录不计。
const entry = (id, role, seconds, { visible = true, content = { type: 'text', blocks: [{ type: 'text', text: 'x' }] } } = {}) => ({
  id, role, visible, created_at: seconds,
  content: { ...content, raw: { content_type: content.type } },
  attachments: [],
});
const conversation = {
  schema_version: '1.0.0', kind: 'ceobe.conversation', id: 'timeline-fixture', title: '时间线夹具',
  messages: {
    sys: entry('sys', 'system', 100, { visible: false }),
    u1: entry('u1', 'user', 1_700_000_000),
    thoughts: entry('thoughts', 'assistant', 1_700_000_100, { content: { type: 'thoughts', blocks: [] } }),
    a1: entry('a1', 'assistant', 1_700_000_200),
    tool: entry('tool', 'tool', 1_700_000_300),
    u2: entry('u2', 'user', 1_700_086_400), // 第二天（UTC）
    a2: entry('a2', 'assistant', 1_700_086_500),
    hidden: entry('hidden', 'user', 1_700_000_050, { visible: false }),
    undated: entry('undated', 'user', null),
  },
  linear_message_ids: ['sys', 'u1', 'thoughts', 'a1', 'tool', 'u2', 'a2', 'hidden', 'undated'],
};
const timeline = conversationTimeline(conversation);
assert.equal(timeline.turns, 5, 'system/tool/hidden records are not timeline turns');
assert.equal(timeline.undated, 1, 'a visible turn without created_at is counted as undated');
assert.equal(timeline.first, 1_700_000_000);
assert.equal(timeline.last, 1_700_086_500);
assert.equal(timeline.first_message_id, 'u1');
assert.equal(timeline.last_message_id, 'a2');
assert.equal(Object.values(timeline.days).reduce((a, b) => a + b, 0), 4, 'dated turns are bucketed by local day');
assert.deepEqual(Object.keys(timeline.days).length, 2, 'two local days');
assert.equal(timeline.days[Object.keys(timeline.days).sort()[0]], 2, 'first day has u1 and a1');
assert.equal(timeline.days[Object.keys(timeline.days).sort()[1]], 2, 'second day has u2 and a2');

const index = buildTimelineIndex([{ id: 'timeline-fixture', conversation }]);
assert.equal(index.kind, TIMELINE_INDEX_KIND);
assert.equal(index.schema_version, '1.0.0');
assert.equal(index.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
assert.deepEqual(index.conversations, [{ id: 'timeline-fixture', ...timeline }]);
assert.equal('title' in index.conversations[0], false, 'titles stay in chats.json');

// 空会话也要有确定结构。
const empty = buildTimelineIndex([{ id: 'empty', conversation: { ...conversation, messages: {}, linear_message_ids: [] } }]);
assert.deepEqual(empty.conversations[0], { id: 'empty', first: null, last: null, first_message_id: null, last_message_id: null, turns: 0, undated: 0, days: {} });

const root = await mkdtemp(join('data/private', 'timeline-index-'));
try {
  const path = join(root, 'archive/chatgpt-share/timeline-fixture/conversation.ceobe.json');
  await mkdir(join(root, 'archive/chatgpt-share/timeline-fixture'), { recursive: true });
  await writeFile(path, JSON.stringify(conversation));
  const written = await writeTimelineIndex(root, { conversations: [{ id: 'timeline-fixture', conversation_path: 'archive/chatgpt-share/timeline-fixture/conversation.ceobe.json' }] });
  const onDisk = JSON.parse(await readFile(join(root, 'replay/public', TIMELINE_INDEX_FILE), 'utf8'));
  assert.deepEqual(onDisk, written);
  assert.deepEqual(onDisk, index);
  // 同一份输入两次构建字节一致（本地时区固定时）。
  const firstBytes = await readFile(join(root, 'replay/public', TIMELINE_INDEX_FILE), 'utf8');
  await writeTimelineIndex(root, { conversations: [{ id: 'timeline-fixture', conversation_path: 'archive/chatgpt-share/timeline-fixture/conversation.ceobe.json' }] });
  assert.equal(await readFile(join(root, 'replay/public', TIMELINE_INDEX_FILE), 'utf8'), firstBytes);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
console.log('PASS timeline index: visible turns only, first/last anchors, local-day buckets, undated handling, empty conversation, deterministic file');
