import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { createOfficialCitations } from './official-citations.mjs';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';
import { chooseShell, renderDilTree } from './render-dil.mjs';

const templates = JSON.parse(await readFile(resolve('official-templates/dil.json'), 'utf8'));
const officialTemplates = await loadOfficialTemplatePackage(process.cwd());
const { document } = parseHTML('<html><body></body></html>');
const citations = createOfficialCitations([officialTemplates.templateDocument]);

const render = (tree, extra = {}) => renderDilTree(tree, { templates, document, officialCitations: citations, ...extra });
const node = (type, props = {}, children = []) => ({ type, props, children });
const parsed = html => parseHTML(`<html><body>${html}</body></html>`).document;

// Shell selection follows the props, because official renders one component with several tags.
assert.equal(chooseShell(templates.components.title, { size: '2xl' }).tag, 'h1');
assert.equal(chooseShell(templates.components.title, { size: 'lg' }).tag, 'h2');
assert.equal(chooseShell(templates.components['table-cell'], { header: true }).tag, 'th');
assert.equal(chooseShell(templates.components['table-cell'], { header: false }).tag, 'td');
assert.equal(chooseShell(templates.components.text, { inline: true }).tag, 'span');

const body = render(node('fragment', {}, [
  node('title', { size: 'lg' }, ['小标题']),
  node('text', {}, ['正文含 ', node('bold', {}, ['加粗']), ' 与 ', node('italic', {}, ['斜体']), ' 和 ', node('code', {}, ['code()'])]),
  node('table', {}, [
    node('table-row', {}, [node('table-cell', { header: true }, ['项目']), node('table-cell', { header: true }, ['价格'])]),
    node('table-row', {}, [node('table-cell', { header: false }, ['甲']), node('table-cell', { header: false }, ['1'])]),
  ]),
  node('list', { marker: 'bullet' }, [node('list-item', {}, [node('text', {}, ['条目'])])]),
  node('box', { direction: 'col' }, [node('divider'), node('blockquote', {}, [node('text', {}, ['引用'])])]),
  node('grid', {}, [node('grid-item', {}, [node('caption', {}, ['说明'])])]),
  node('math', { value: 'x^2' }),
  node('icon', { name: 'arrow-down' }),
  node('badge', { color: 'success', size: 'sm' }, ['新']),
]));
assert.deepEqual(body.unsupported, [], 'every component in this tree is representable');
const html = body.html;
assert.ok(!html.includes('&lt;') || !html.includes('<Cite'), 'no component markup leaks as text');

const parsedHtml = parsed(html);
assert.equal(parsedHtml.querySelector('h2.w6asjq_TextBase')?.textContent, '小标题', 'title uses the frozen heading shell for its size');
assert.equal(parsedHtml.querySelector('p.w6asjq_TextBase')?.textContent.includes('加粗'), true);
assert.equal(parsedHtml.querySelectorAll('strong').length, 1);
assert.equal(parsedHtml.querySelectorAll('em').length, 1);
assert.equal(parsedHtml.querySelectorAll('code').length, 1);
assert.equal(parsedHtml.querySelectorAll('th').length, 2);
assert.equal(parsedHtml.querySelectorAll('td').length, 2);
assert.ok(parsedHtml.querySelector('table'), 'tables use the frozen table shell');
assert.equal(parsedHtml.querySelector('ul.PSWZZq_List')?.getAttribute('data-d-marker'), 'bullet');
assert.equal(parsedHtml.querySelector('li.PSWZZq_Item')?.textContent, '条目');
assert.ok(parsedHtml.querySelector('div.oIb9lq_Box[data-d-direction="col"]'), 'box keeps its direction');
assert.ok(parsedHtml.querySelector('div.S6IMGG_Divider'), 'divider uses the frozen shell');
assert.ok(parsedHtml.querySelector('blockquote.HmKZva_Blockquote'));
assert.ok(parsedHtml.querySelector('.W-9lQW_Grid .W-9lQW_Item'), 'grid items nest inside the grid shell');
assert.ok(parsedHtml.querySelector('span.Wj_uza_Caption'), 'captions use the frozen caption shell');
assert.ok(parsedHtml.querySelector('.katex'), 'math renders through KaTeX like the Markdown path');
assert.equal(parsedHtml.querySelector('[data-color="success"]')?.textContent, '新', 'badge keeps its props as data attributes');
assert.equal(html.includes('arrow-down'), false, 'icons are decoration: no invented markup');

// Citations resolve through the same table the text markup uses, and degrade without it.
const cite = render(node('text', {}, [node('Cite', { refs: ['turn1search0'], __resolutionId: 'res-1' }, [])]), {
  message: { metadata: { search_result_groups: [{ domain: 'example.com', entries: [{ ref_id: { turn_index: 1, ref_type: 'search', ref_index: 0 } }] }] } },
  genuiComponents: [{ resolutionId: 'res-1', safeUrls: ['https://example.com/a'], entities: [{ entity_type: 'search', ref: 'turn1search0' }] }],
});
assert.ok(cite.html.includes('data-testid="webpage-citation-pill"'), 'a resolved citation renders the frozen pill');
const bare = render(node('text', {}, [node('Cite', { refs: ['turn9search9'] }, ['兜底文字'])]));
assert.ok(!bare.html.includes('Cite') && bare.html.includes('兜底文字'), 'an unresolved reference degrades to its own text');

// Unsupported components are reported so the caller can prefer the Markdown fallback.
const unknown = render(node('fragment', {}, [node('text', {}, ['前']), node('visualization', {}, []), node('mystery', {}, ['后'])]));
assert.deepEqual(unknown.unsupported.sort(), ['mystery', 'visualization']);
assert.ok(unknown.html.includes('前') && unknown.html.includes('后'), 'children of unsupported components survive for the fallback path');

// Text is escaped; nothing from a payload becomes markup.
const escaped = render(node('text', {}, ['<script>alert(1)</script>']));
assert.equal(parsed(escaped.html).querySelector('script'), null);
console.log('DIL documents render into frozen official shells: variants, inline formatting, references, decoration and fallback reporting verified.');
