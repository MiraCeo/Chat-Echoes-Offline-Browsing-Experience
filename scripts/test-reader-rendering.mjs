import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
import { createGeneratedFiles } from './generated-files.mjs';
import { renderAssistantMarkdown } from './render-markdown.mjs';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';

let markup = '<div><svg viewBox="0 0 10 10"><title></title><desc></desc><path d="M0 0 L10 10" /></svg></div>';
for (let pass = 0; pass < 4; pass++) {
  const { document } = parseHTML(markup);
  assert.equal(document.querySelectorAll('svg path').length, 1);
  assert.equal(document.querySelector('title').textContent, '');
  markup = htmlSafeSvg(document.firstElementChild.outerHTML);
}
const templates = await loadOfficialTemplatePackage(process.cwd());
const document = parseHTML('<html><body></body></html>').document;
const generatedFiles = createGeneratedFiles(templates.templateDocument);
const rendered = renderAssistantMarkdown(document,
  '[新文件](sandbox:/mnt/data/%E6%96%B0.xlsx)\n\n[再次](sandbox:/mnt/data/新.xlsx)\n\n[网页](https://example.com)\n\n[危险](javascript:alert)',
  { generatedFiles });
const result = parseHTML(rendered).document;
assert.equal(result.querySelectorAll('[data-ceobe-file-state="missing"]').length, 1);
assert.ok(result.querySelector('[data-ceobe-file-state]').textContent.includes('新.xlsx'));
assert.ok(!result.textContent?.includes('2025美亚'));
assert.equal(result.querySelectorAll('a[href]').length, 1);
assert.equal(result.querySelector('a[href]').getAttribute('href'), 'https://example.com');
assert.equal(result.querySelectorAll('[data-ceobe-generated-file="sandbox:/mnt/data/新.xlsx"]').length, 3);
assert.equal(result.querySelector('[data-ceobe-file-state] button').getAttribute('aria-disabled'), 'true');
console.log('SVG round trips, generated-file identity, deduplication, missing state and link safety passed.');
