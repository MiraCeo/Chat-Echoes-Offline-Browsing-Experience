import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { allowedAssetUrl, collectResources, downloadResources, readArchivedResource, resourceMatches } from './archive-resources.mjs';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';

const conversation = { title: 'Archive', messages: {
  a: { role: 'user', attachments: [{ id: 'file_a', name: 'test.txt', download_url: 'https://files.oaiusercontent.com/test' }], content: { blocks: [{ type: 'text', text: 'Keep original\nsecond line' }, { type: 'asset', pointer: 'sediment://file_a?share=id' }] } },
  b: { role: 'assistant', attachments: [{ name: 'missing.xlsx', pointer: 'sandbox:/mnt/data/missing.xlsx' }], content: { blocks: [{ type: 'code', language: 'kotlin', text: 'val a = 1' }] } },
}, linear_message_ids: ['a', 'b'] };
assert.equal(collectResources(conversation).length, 2);
const discovered = collectResources({ messages: { a: {
  attachments: [{ id: 'file_same', library_file_id: 'lib_same', name: 'arbitrary-name.docx' }],
  content_references: [{ type: 'file', id: 'file_same', name: 'citation-name.docx' }],
  content: { blocks: [{ type: 'asset', pointer: 'sediment://file_same?share=id' }] },
} } });
assert.equal(discovered.length, 1);
assert.ok(resourceMatches(discovered[0], { library_file_id: 'lib_same' }));
assert.ok(resourceMatches(discovered[0], { pointer: 'sediment://file_same?other=id' }));
assert.equal(allowedAssetUrl('https://files.oaiusercontent.com/test'), true);
for (const url of ['http://127.0.0.1/x', 'https://chatgpt.com.evil.test/x', 'https://user:pass@chatgpt.com/x', 'https://chatgpt.com:8000/x']) assert.equal(allowedAssetUrl(url), false);
const folder = await mkdtemp(join(tmpdir(), 'ceobe-resources-'));
conversation.resources = await downloadResources(conversation, folder, { fetcher: async () => new Response('hello', { headers: { 'content-type': 'text/plain' } }) });
assert.equal(conversation.resources[0].status, 'downloaded');
assert.equal(conversation.resources[1].status, 'unresolved');
assert.equal((await readArchivedResource(folder, conversation.resources[0])).toString(), 'hello');
assert.match(exportConversationMarkdown(conversation), /Keep original\nsecond line/);
assert.match(exportConversationMarkdown(conversation), /```kotlin\nval a = 1/);
assert.match(exportConversationMarkdown(conversation), /附件未保存/);
conversation.messages.b.content.blocks.unshift({ type: 'text', text: '[Download](sandbox:/mnt/data/missing.xlsx)' });
const markdown = exportConversationMarkdown(conversation);
assert.doesNotMatch(markdown, /\]\(sandbox:/);
assert.match(markdown, /Download/);
const input = join(folder, 'conversation.ceobe.json');
await writeFile(input, JSON.stringify(conversation));
const replay = spawnSync(process.execPath, ['scripts/build-official-replay.mjs', '--input', input], { encoding: 'utf8' });
assert.equal(replay.status, 0, replay.stderr);
const document = parseHTML(await readFile('replay/index.html', 'utf8')).document;
assert.equal(document.body.textContent.includes('附件尚未关联本地资源：test.txt'), false);
assert.equal(document.querySelector('a[data-ceobe-local-resource="file_a"]'), null);
assert.equal(document.querySelector('template[data-ceobe-preview="file-file_a"]'), null);
const previewOpener = document.querySelector('[data-ceobe-open-preview="file-file_a"]');
assert.ok(previewOpener);
const previewFile = previewOpener.getAttribute('data-ceobe-preview-file');
assert.ok(previewFile);
const previewDocument = parseHTML(`<html><body>${await readFile(join('replay/previews/templates', previewFile), 'utf8')}</body></html>`).document;
assert.ok(previewDocument.body.textContent.includes('hello'));
assert.ok(previewDocument.querySelector('[data-ceobe-close-preview]'));
assert.equal((await readFile(join('replay/archive-resources', conversation.resources[0].local_path.split('/').at(-1)))).toString(), 'hello');
await assert.rejects(readArchivedResource(folder, { local_path: '../secret', sha256: '' }));
await writeFile(join(folder, conversation.resources[0].local_path), 'modified');
await assert.rejects(readArchivedResource(folder, conversation.resources[0]), /checksum/);
let calls = 0;
const blocked = await downloadResources(conversation, folder, { fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }); } });
assert.equal(calls, 1);
assert.equal(blocked[0].status, 'failed');
const html = await downloadResources(conversation, folder, { fetcher: async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }) });
assert.equal(html[0].status, 'failed');
const oversized = await downloadResources(conversation, folder, { maxBytes: 2, fetcher: async () => new Response('hello') });
assert.equal(oversized[0].status, 'failed');
console.log('Archive resource and Markdown tests passed.');
