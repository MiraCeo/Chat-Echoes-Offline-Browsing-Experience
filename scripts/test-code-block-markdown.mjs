import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { conversationToMarkdownView } from './conversation-to-markdown-view.mjs';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';
import { messageCopyContent } from './copy-controls.mjs';
import { markdownTextOnly } from './markdown-text-only.mjs';

// Code blocks have two audiences: the reader renders them with official DOM, and every text export
// (single-chat MD, project ZIP, copy-to-clipboard) must stay plain fenced code with its language.
// This contract has to hold before and after any reader-side markup change.
const conversation = {
  schema_version: '1.0.0',
  kind: 'ceobe.conversation',
  id: 'code-block-contract',
  title: '代码块导出契约',
  source: { type: 'chatgpt_share', share_id: 'code-block-contract', sha256: '0'.repeat(64), format: 'chatgpt_react_flight_html', captured_at: '2026-10-19T00:00:00.000Z' },
  linear_message_ids: ['m-user', 'm-assistant'],
  linear_node_ids: ['n-user', 'n-assistant'],
  nodes: {
    'n-user': { id: 'n-user', parent_id: null, children: ['n-assistant'], message_id: 'm-user', raw: {} },
    'n-assistant': { id: 'n-assistant', parent_id: 'n-user', children: [], message_id: 'm-assistant', raw: {} },
  },
  messages: {
    'm-user': {
      id: 'm-user', role: 'user', visible: true, attachments: [], citations: [], content_references: [], metadata: {},
      content: { type: 'text', blocks: [{ type: 'text', text: '用 python 写二分查找' }], raw: {} }, raw: {},
    },
    'm-assistant': {
      id: 'm-assistant', role: 'assistant', visible: true, attachments: [], citations: [], content_references: [], metadata: {},
      content: {
        type: 'text',
        blocks: [
          { type: 'text', text: '代码如下：' },
          { type: 'code', language: 'python', text: 'def binary_search(items, target):\n    lo, hi = 0, len(items) - 1\n    return lo' },
          { type: 'text', text: '复杂度是 O(log n)。' },
        ],
        raw: {},
      },
      raw: {},
    },
  },
  completeness: { scope: 'captured_public_share', canonical_source: 'structured_react_payload', structured_payload: {}, rendered_dom: {}, renderer_policy: 'test' },
  import_report: { status: 'structure_checked', assets: [], issues: [] },
};

// 1) The Markdown view keeps the fence and the language tag.
const view = conversationToMarkdownView(conversation);
const assistant = view.find(turn => turn.role === 'assistant');
const part = assistant.parts.find(item => item.type === 'markdown');
assert.ok(part.markdown.includes('```python'), 'the fence keeps its language');
assert.ok(part.markdown.includes('def binary_search(items, target):'), 'the code body survives verbatim');
assert.ok(part.markdown.includes('复杂度是 O(log n)。'), 'surrounding prose is kept around the fence');

// 2) A single-chat export (and therefore a project ZIP, which reuses it) is plain text.
for (const textOnly of [false, true]) {
  const markdown = exportConversationMarkdown(conversation, { textOnly });
  assert.ok(markdown.includes('```python'), `textOnly=${textOnly}: export keeps the language fence`);
  assert.ok(markdown.includes('def binary_search(items, target):'), `textOnly=${textOnly}: export keeps the code`);
  assert.equal(/CodeBlock-|cm-editor|ActionBar-/.test(markdown), false, `textOnly=${textOnly}: no reader markup leaks into the export`);
}

// 3) Copy-to-clipboard uses the same converter, so a copied reply is fenced code, not styled DOM.
const { document } = parseHTML('<html><body></body></html>');
const copy = messageCopyContent([part], document);
assert.ok(copy.text.includes('```python') && copy.text.includes('def binary_search'), 'copy text stays fenced code');
assert.equal(/CodeBlock-|ActionBar-/.test(copy.html), false, 'copy HTML carries no code-block shell');

// 4) Text-only mode keeps the fence too (it must not "read" code as prose).
const plain = markdownTextOnly(part.markdown);
assert.ok(plain.includes('```python') && plain.includes('def binary_search'), 'text-only keeps the fence and body');

console.log('Code block Markdown contract: fenced code with language survives MD export, text-only export and copy-to-clipboard.');
