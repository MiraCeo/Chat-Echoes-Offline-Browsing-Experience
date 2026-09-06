import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { conversationToHtmlView, htmlMessageKind } from './conversation-to-html-view.mjs';
import { conversationToMarkdownView } from './conversation-to-markdown-view.mjs';

const build = input => {
  const run = spawnSync(process.execPath, ['scripts/build-official-replay.mjs', '--input', input], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return parseHTML(readFileSync('replay/index.html', 'utf8')).document;
};
let document = build('samples/independent-conversation.json');
const turns = [...document.querySelectorAll('section[data-testid^="conversation-turn-"]')];
assert.equal(turns.length, 5);
assert.deepEqual(turns.map(e => e.getAttribute('data-turn')), ['user', 'assistant', 'user', 'user', 'assistant']);
assert.equal(document.querySelector('title').textContent, '独立输入测试');
assert.equal(document.documentElement.getAttribute('data-ceobe-render-source'), 'canonical-json');
assert.deepEqual(JSON.parse(turns[1].getAttribute('data-ceobe-message-ids')), ['answer']);
assert.deepEqual(JSON.parse(turns[1].getAttribute('data-ceobe-content-types')), ['text']);
assert.deepEqual(JSON.parse(turns[1].getAttribute('data-ceobe-message-kinds')), ['document']);
assert.ok(turns[1].textContent.includes('独立回答'));
assert.equal(turns[1].querySelector('script'), null);
assert.equal(document.querySelector('a[href^="javascript:"]'), null);
assert.equal(document.querySelector('template[data-ceobe-preview]'), null);
assert.ok(!document.body.textContent.includes('Release APK'));
assert.ok(!document.body.textContent.includes('毛泽东'));
assert.equal(document.querySelectorAll('[data-sidebar-item][href="#main"]').length, 1);
assert.ok(turns[4].querySelector('.ceobe-code-block'));
assert.equal(htmlMessageKind({ role: 'assistant', recipient: 'python', content: { type: 'code', blocks: [] } }), 'tool_call');
assert.equal(htmlMessageKind({ role: 'assistant', recipient: 'all', channel: 'final', content: { type: 'text', blocks: [] } }), 'document');
assert.equal(htmlMessageKind({ role: 'assistant', content: { type: 'reasoning_recap', blocks: [] } }), 'activity');
document = build('fixtures/chatgpt-share/6a9849f6-3bec-83ee-b032-618d95fc0917/conversation.ceobe.json');
assert.equal(document.querySelector('section[data-testid="conversation-turn-1"] a[href="https://example.com"]')?.textContent, 'https://example.com');
for (const internalText of ['This code was redacted.', 'fast|site:help.openai.com', 'from PIL import Image, ImageChops', '附件尚未关联本地资源：']) {
  assert.equal(document.body.textContent.includes(internalText), false, `Internal/fallback text leaked: ${internalText}`);
}
assert.ok([...document.querySelectorAll('[data-ceobe-message-kinds]')]
  .some(turn => JSON.parse(turn.getAttribute('data-ceobe-message-kinds')).includes('tool_call')));
document = build('samples/empty-conversation.json');
assert.equal(document.querySelectorAll('section[data-testid^="conversation-turn-"]').length, 0);
assert.equal(document.querySelector('title').textContent, '空对话测试');

const before = readFileSync('replay/index.html', 'utf8');
const invalid = spawnSync(process.execPath, ['scripts/build-official-replay.mjs', '--input', 'package.json'], { encoding: 'utf8' });
assert.notEqual(invalid.status, 0);
assert.equal(readFileSync('replay/index.html', 'utf8'), before);
assert.throws(() => conversationToHtmlView({title:'bad',messages:{},linear_message_ids:['missing']}), /Missing message/);
const fixture = JSON.parse(readFileSync('samples/independent-conversation.json', 'utf8'));
fixture.linear_message_ids = ['answer', 'last'];
assert.equal(conversationToHtmlView(fixture).length, 1);
assert.equal(conversationToHtmlView(fixture)[0].entries.length, 2);
assert.strictEqual(conversationToHtmlView(fixture)[0].entries[0].message, fixture.messages.answer);
assert.equal(conversationToMarkdownView(fixture)[0].parts.length, 2);
console.log('Independent JSON, empty conversation, ordering, escaping and invalid-input preservation passed.');
