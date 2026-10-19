import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertWebCapture, pickConversation, blocksFromContent } from './convert-web-capture.mjs';
import { planSnapshot, assertSnapshotTarget } from './archive-guard.mjs';

// A synthetic capture: same field names the conversation endpoint uses, no personal content.
const message = (id, role, time, content, metadata = {}) => ({
  id, author: { role }, create_time: time, update_time: time,
  content, status: 'finished_successfully', metadata, recipient: 'all',
});

const conversation = {
  conversation_id: '00000000-0000-4000-8000-000000000001',
  title: '合成会话',
  create_time: 1760000000.5,
  update_time: 1760000100.5,
  current_node: 'm3',
  page_info: { has_next_page: false, start_cursor: null, end_cursor: null },
  messages: [
    // Deliberately out of order, so the converter has to sort.
    message('m3', 'assistant', 3, {
      content_type: 'text',
      parts: ['结尾回答'],
      // The web payload carries DIL documents the reader already knows how to render.
      metadata: { model_dil_v2: { code: 'DIL.render()' } },
    }, { model_dil_v2: { code: 'DIL.render()' }, turn_exchange_id: 't2' }),
    message('m1', 'user', 1, { content_type: 'text', parts: ['二分查找'] }),
    message('m2', 'tool', 2, { content_type: 'execution_output', text: 'ok' }, { is_visually_hidden_from_conversation: true }),
    message('m4', 'assistant', 4, {
      content_type: 'code', language: 'python', text: 'def f():\n  return 1',
    }),
    message('m5', 'user', 5, {
      content_type: 'multimodal_text',
      parts: ['看图', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file_x', metadata: { size: 1 } }],
    }),
  ],
};

// Wrapper: the extension exports responses; the largest conversation-bearing one must win.
const wrapper = {
  kind: 'ceobe.response-capture',
  responses: [
    { url: 'https://chatgpt.com/backend-api/conversations?expand=false', text: '{"items":[]}' },
    { url: 'https://chatgpt.com/backend-api/conversations/<id>?num_turns=3', text: JSON.stringify(conversation) },
  ],
};
assert.equal(pickConversation(wrapper)?.conversation_id, conversation.conversation_id);
assert.equal(pickConversation(conversation)?.conversation_id, conversation.conversation_id);
assert.equal(pickConversation({ responses: [] }), null);

// Pagination: the endpoint returns a page of messages, so several captured responses for the same
// conversation must be merged by id rather than keeping only the largest page.
const pageOne = {
  conversation_id: conversation.conversation_id, title: conversation.title,
  create_time: conversation.create_time, update_time: conversation.update_time,
  messages: conversation.messages.slice(0, 3),
  page_info: { has_next_page: true, end_cursor: 'c1' },
};
const pageTwo = {
  conversation_id: conversation.conversation_id, title: conversation.title,
  create_time: conversation.create_time, update_time: conversation.update_time + 1,
  messages: conversation.messages.slice(2),
  page_info: { has_next_page: false, end_cursor: 'c2' },
};
const merged = pickConversation({ responses: [
  { url: '/conversations/<id>?num_turns=2', text: JSON.stringify(pageOne) },
  { url: '/conversations/<id>?num_turns=2&after=c1', text: JSON.stringify(pageTwo) },
] });
assert.equal(merged.messages.length, 5, 'overlapping pages must not duplicate messages');
assert.equal(merged.page_info.has_next_page, false, 'the last page wins for pagination state');
const mergedCanonical = convertWebCapture({ responses: [
  { text: JSON.stringify(pageOne) },
  { text: JSON.stringify(pageTwo) },
] });
assert.deepEqual(mergedCanonical.linear_message_ids, ['m1', 'm2', 'm3', 'm4', 'm5'], 'merged pages keep one linear order');

// Block projection keeps text, code, assets and the CoT records the reader renders.
assert.deepEqual(blocksFromContent({ content_type: 'text', parts: ['a', 'b'] }), [{ type: 'text', text: 'ab' }]);
assert.deepEqual(blocksFromContent({ content_type: 'code', language: 'js', text: 'x' }), [{ type: 'code', language: 'js', text: 'x' }]);
const multimodal = blocksFromContent(conversation.messages[4].content);
assert.equal(multimodal[0].text, '看图');
assert.equal(multimodal[1].type, 'asset');
assert.equal(multimodal[1].asset_type, 'image');
assert.equal(blocksFromContent({ content_type: 'execution_output', text: 'ok' })[0].type, 'text', 'tool output keeps its text');

const canonical = convertWebCapture(wrapper, { capturedAt: '2026-10-19T00:00:00.000Z', sourceUrl: 'https://chatgpt.com/c/x' });
assert.equal(canonical.kind, 'ceobe.conversation');
assert.equal(canonical.schema_version, '1.0.0');
assert.equal(canonical.source.type, 'chatgpt_web');
assert.equal(canonical.source.conversation_id, conversation.conversation_id);
assert.equal(canonical.source.sha256.length, 64);
assert.equal(canonical.source.pagination.has_next_page, false);

// Linear order follows create_time, never the API's array order.
assert.deepEqual(canonical.linear_message_ids, ['m1', 'm2', 'm3', 'm4', 'm5']);
assert.equal(canonical.current_node_id, 'm3');
assert.equal(canonical.nodes.m1.parent_id, null);
assert.equal(canonical.nodes.m1.children[0], 'm2');
assert.deepEqual(canonical.nodes.m5.children, []);

// Hidden records stay in the file but are not visible; DIL metadata survives untouched.
assert.equal(canonical.messages.m2.visible, false);
assert.equal(canonical.messages.m3.visible, true);
assert.ok(canonical.messages.m3.metadata.model_dil_v2.code.startsWith('DIL.render'));
assert.equal(canonical.messages.m4.content.blocks[0].language, 'python');
assert.equal(canonical.messages.m5.attachments.length, 0);
assert.equal(canonical.messages.m5.content.blocks[1].asset_pointer, 'file-service://file_x');

// A share capture claims a branch tree; this one must say it is linear instead of pretending.
assert.equal(canonical.completeness.structured_payload.status, 'usable_linear');
assert.match(canonical.completeness.structured_payload.note, /branch/i);
assert.equal(canonical.completeness.rendered_dom.status, 'absent');
assert.equal(canonical.import_report.complete_offline_archive, false);

// Conversion refuses payloads that are not conversations.
assert.throws(() => convertWebCapture({ responses: [{ text: '{"items":[]}' }] }), /no conversation/);

// The import target goes through the same archive guard as share captures: outside the root is refused.
const workspace = await mkdtemp(join(tmpdir(), 'ceobe-web-import-'));
try {
  const snapshotRoot = join(workspace, 'archive', 'chatgpt-web');
  await mkdir(snapshotRoot, { recursive: true });
  const plan = planSnapshot({ shareId: conversation.conversation_id, capturedAt: '2026-10-19T00:00:00.000Z', snapshotRoot });
  assert.equal(plan.dir, join(snapshotRoot, conversation.conversation_id, '2026-10-19T00-00-00.000Z'));
  await assertSnapshotTarget(plan.dir, { snapshotRoot });
  await assert.rejects(() => assertSnapshotTarget(join(workspace, 'outside'), { snapshotRoot }), /之内/);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('Web capture conversion: payload pick, linear order, block projection, hidden records, DIL metadata, usable_linear completeness and archive guard verified.');
