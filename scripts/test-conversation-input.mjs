import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { conversationToView } from './conversation-to-view.mjs';

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
assert.ok(turns[1].textContent.includes('独立回答'));
assert.equal(turns[1].querySelector('script'), null);
assert.equal(document.querySelector('a[href^="javascript:"]'), null);
assert.equal(document.querySelector('template[data-ceobe-preview]'), null);
assert.ok(!document.body.textContent.includes('Release APK'));
assert.ok(!document.body.textContent.includes('毛泽东'));
assert.equal(document.querySelectorAll('[data-sidebar-item][href="#main"]').length, 1);
assert.ok(turns[4].querySelector('.ceobe-code-block'));
document = build('samples/empty-conversation.json');
assert.equal(document.querySelectorAll('section[data-testid^="conversation-turn-"]').length, 0);
assert.equal(document.querySelector('title').textContent, '空对话测试');

const before = readFileSync('replay/index.html', 'utf8');
const invalid = spawnSync(process.execPath, ['scripts/build-official-replay.mjs', '--input', 'package.json'], { encoding: 'utf8' });
assert.notEqual(invalid.status, 0);
assert.equal(readFileSync('replay/index.html', 'utf8'), before);
assert.throws(() => conversationToView({title:'bad',messages:{},linear_message_ids:['missing']}), /Missing message/);
const fixture = JSON.parse(readFileSync('samples/independent-conversation.json', 'utf8'));
fixture.linear_message_ids = ['answer', 'last'];
assert.equal(conversationToView(fixture).length, 1);
assert.equal(conversationToView(fixture)[0].parts.length, 2);
console.log('Independent JSON, empty conversation, ordering, escaping and invalid-input preservation passed.');
