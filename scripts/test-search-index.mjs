import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { indexConversation, buildSearchIndex, writeSearchIndex, SEARCH_INDEX_FILE, SEARCH_INDEX_KIND } from './search-index.mjs';
import { bookmarkTargets } from './bookmark-targets.mjs';

// Authored fixture only; never derived from a personal archive.
const record = (id, role, content, extra = {}) => [id, { id, role, visible: true, content, ...extra }];
const text = (...blocks) => ({ type: 'text', blocks });
const entries = [
  record('m-system', 'system', text({ type: 'text', text: 'SYSTEM_PROMPT_HIDDEN' }), { visible: false }),
  record('m-user-1', 'user', text({ type: 'text', text: '  用户问题  \n包含 needle-one ' })),
  record('m-thoughts', 'assistant', { type: 'thoughts', blocks: [{ type: 'thoughts', text: 'REASONING_HIDDEN' }] }),
  record('m-recap', 'assistant', { type: 'reasoning_recap', blocks: [{ type: 'text', text: 'RECAP_HIDDEN' }] }),
  record('m-context', 'assistant', { type: 'model_editable_context', blocks: [{ type: 'text', text: 'CONTEXT_HIDDEN' }] }),
  record('m-tool-call', 'assistant', text({ type: 'code', text: 'TOOL_CALL_HIDDEN' }), { recipient: 'python' }),
  record('m-tool-result', 'tool', text({ type: 'text', text: 'TOOL_RESULT_HIDDEN' })),
  record('m-final', 'assistant', text(
    { type: 'text', text: 'FINAL_ANSWER 第一段' },
    { type: 'web_citation', title: 'CITATION_HIDDEN', url: 'https://example.invalid/' },
    { type: 'code', language: 'js', text: 'const code = 1;' },
  )),
  record('m-user-image', 'user', text({ type: 'asset', asset_type: 'image', name: 'photo.png' }), { attachments: [{ name: 'photo.png' }] }),
  record('m-final-empty', 'assistant', text({ type: 'file_citation', title: 'ONLY_CITATION' })),
  record('m-user-2', 'user', text({ type: 'text', text: 'ＦＵＬＬＷＩＤＴＨ needle-two' })),
];
const conversation = {
  schema_version: '1.0.0', kind: 'ceobe.conversation', id: 'idx-test', title: '索引测试',
  source: { type: 'test_fixture', captured_at: '2026-01-01T00:00:00Z' }, resources: [],
  messages: Object.fromEntries(entries), linear_message_ids: entries.map(([id]) => id),
};

const turns = indexConversation(conversation);
assert.deepEqual(turns.map(t => [t.message_id, t.role, t.order]), [['m-user-1', 'user', 0], ['m-final', 'assistant', 1], ['m-user-2', 'user', 4]],
  'Only turns with visible text are indexed; merged assistant runs anchor to the final reply');
assert.equal(turns[0].text, '用户问题 包含 needle-one', 'Whitespace collapsed like bookmark excerpts');
assert.equal(turns[1].text, 'FINAL_ANSWER 第一段 const code = 1;', 'Final text and code blocks only');
const dumped = JSON.stringify(turns);
for (const hidden of ['SYSTEM_PROMPT_HIDDEN', 'REASONING_HIDDEN', 'RECAP_HIDDEN', 'CONTEXT_HIDDEN', 'TOOL_CALL_HIDDEN', 'TOOL_RESULT_HIDDEN', 'CITATION_HIDDEN', 'ONLY_CITATION', 'photo.png'])
  assert.equal(dumped.includes(hidden), false, hidden + ' must not be searchable');
assert.equal(turns[2].text, 'ＦＵＬＬＷＩＤＴＨ needle-two', 'Original text is stored; folding happens in the dialog');

const targets = bookmarkTargets(conversation);
assert.equal(targets.length, 5, 'Bookmark targets still cover text-less turns');
for (const turn of turns) {
  const target = targets.find(t => t.message_id === turn.message_id);
  assert.ok(target, 'Index keys are bookmark message IDs: ' + turn.message_id);
  assert.equal(target.order, turn.order, 'Turn numbers match the bookmark projection');
}

const index = buildSearchIndex([{ id: 'idx-test', conversation }]);
assert.equal(index.kind, SEARCH_INDEX_KIND);
assert.equal(index.schema_version, '1.0.0');
assert.deepEqual(index.conversations, [{ id: 'idx-test', turns }]);
assert.equal('title' in index.conversations[0], false, 'Titles come from the live catalog, not the index');

const root = await mkdtemp(join(tmpdir(), 'ceobe-search-index-'));
try {
  const file = join(root, 'archive/chatgpt-share/idx-test/2026-01-01/conversation.ceobe.json');
  await mkdir(join(root, 'archive/chatgpt-share/idx-test/2026-01-01'), { recursive: true });
  await writeFile(file, JSON.stringify(conversation));
  const written = await writeSearchIndex(root, { conversations: [{ id: 'idx-test', conversation_path: 'archive/chatgpt-share/idx-test/2026-01-01/conversation.ceobe.json' }] });
  const onDisk = JSON.parse(await readFile(join(root, 'replay/public', SEARCH_INDEX_FILE), 'utf8'));
  assert.deepEqual(onDisk, written);
  assert.deepEqual(onDisk, index);
  const empty = await writeSearchIndex(root, { conversations: [] });
  assert.deepEqual(empty.conversations, [], 'Empty archive still produces a valid index');
} finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
console.log('PASS search index: visible text/code only, hidden records and citations excluded, bookmark IDs and turn numbers, file output');
