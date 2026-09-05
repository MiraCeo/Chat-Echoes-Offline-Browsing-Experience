import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createOfficialCitations } from './official-citations.mjs';
import { renderAssistantMarkdown } from './render-markdown.mjs';

const documents = await Promise.all([
  '测试消息/分支 · 测试消息1.html', '图表/图表.html',
].map(async path => parseHTML(await readFile(path, 'utf8')).document));
const citations = createOfficialCitations(documents);
const file = { id: 'test-file', name: '<测试>.txt', source: 'my_files', snippet: '<script>alert(1)</script>', input_pointer: { line_range_start: 10, line_range_end: 20 } };
const parsed = html => parseHTML('<html><body>' + html + '</body></html>').document.body.firstElementChild;
const node = parsed(citations.file(file));
const template = documents[0].querySelector('[data-file-citation-group-size="1"]');
const structure = element => [element.localName, element.className, [...element.children].map(structure)];
assert.deepEqual(structure(node), structure(template));
assert.equal(node.querySelector('p').textContent, '<测试>');
assert.equal(node.querySelector('use').getAttribute('href'), template.querySelector('use').getAttribute('href'));
assert.equal(node.getAttribute('data-file-citation-primary-file-id'), file.id);
assert.equal(node.hasAttribute('data-file-citation-group-identity'), false);
assert.deepEqual(JSON.parse(node.getAttribute('data-ceobe-reference')), file);
assert.equal(node.querySelector('script'), null);

for (const count of [0, 1]) {
  const web = parsed(citations.web({ items: [{ url: 'https://help.openai.com/test', attribution: 'OpenAI Help Center', supporting_websites: Array(count).fill({url: 'https://example.com'}) }] }));
  const original = [...documents[1].querySelectorAll('[data-testid="webpage-citation-pill"]')].find(e => e.textContent.endsWith('+1') === Boolean(count));
  assert.deepEqual(structure(web), structure(original));
  assert.equal(web.getAttribute('style'), original.getAttribute('style'));
  assert.equal(web.querySelector('img').getAttribute('src'), './assets/favicons.png');
}
const unsafe = parsed(citations.web({ items: [{ url: 'javascript:alert(1)', title: '<script>' }] }));
assert.equal(unsafe.querySelector('a').getAttribute('href'), '#');
assert.equal(unsafe.querySelector('img'), null);
assert.equal(unsafe.querySelector('script'), null);
const token = '\uE200filecite\uE202turn0file0\uE201';
const output = renderAssistantMarkdown(documents[0], '引用 ' + token, { officialCitations: citations, contentReferences: [{...file, matched_text: token}] });
assert.ok(output.includes('data-file-citation-primary-file-id="test-file"'));
assert.ok(!output.includes('\uE200'));
const title = 'OpenAI 官方：Exporting your ChatGPT history and data';
const url = 'https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpthistory-and-data';
for (const source of [`\uE200url\uE202${title}\uE202${url}\uE201`, `url${title}${url}`]) {
  const html = renderAssistantMarkdown(documents[0], source, { officialCitations: citations });
  const paragraph = parsed(html);
  assert.equal(paragraph.localName, 'p');
  const link = paragraph.querySelector('a.decorated-link');
  assert.ok(link);
  assert.equal(link.textContent, title);
  assert.equal(link.getAttribute('href'), url);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.ok(link.querySelector('svg use'));
  assert.equal(paragraph.querySelector('[data-testid="webpage-citation-pill"]'), null);
  assert.equal(link.querySelector('.truncate'), null);
}
const escapedLink = parsed(citations.url('<script>test</script>', 'javascript:alert(1)'));
assert.equal(escapedLink.textContent, '<script>test</script>');
assert.equal(escapedLink.querySelector('script'), null);
assert.equal(escapedLink.getAttribute('href'), '#');
console.log('Official citation DOM, metadata, rendering and escaping tests passed.');
