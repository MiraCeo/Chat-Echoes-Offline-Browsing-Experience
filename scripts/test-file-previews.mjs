import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const document = parseHTML(await readFile('replay/index.html', 'utf8')).document;
const templates = [...document.querySelectorAll('template[data-ceobe-preview]')];
assert.equal(templates.length, 6);
for (const template of templates) {
  const content = parseHTML('<html><body>' + template.innerHTML + '</body></html>').document;
  if (template.getAttribute('data-ceobe-preview') === 'pasted') {
    assert.ok(content.querySelector('.content-sheet.popup'));
    assert.ok(content.body.textContent.includes('BUILD SUCCESSFUL in 4m 42s'));
    assert.ok(content.body.textContent.includes('Configuration cache entry reused.'));
  } else assert.ok(content.querySelector('[data-testid="artifact-preview-side-pane-surface"]'));
  assert.ok(content.querySelector('[data-ceobe-close-preview]'));
  assert.equal(content.querySelector('script'), null);
  if (template.getAttribute('data-ceobe-preview') === 'pasted-reference') {
    assert.ok(content.querySelector('[data-ceobe-pasted-reference] .cm-content'));
    assert.ok(content.querySelector('[data-ceobe-incomplete-preview]'));
    assert.equal(content.querySelector('.cm-gap'), null);
    assert.ok(content.body.textContent.includes(':app:assembleRelease'));
  }
  if (template.getAttribute('data-ceobe-preview') === 'pdf') {
    const images = [...content.querySelectorAll('[data-testid^="artifact-pdf-page-"] img')];
    assert.equal(images.length, 7);
    for (const image of images) await access('replay/' + image.getAttribute('src'));
    assert.equal(content.querySelector('canvas'), null);
  }
  if (template.getAttribute('data-ceobe-preview') === 'xlsx') {
    const sheets = [...content.querySelectorAll('[data-ceobe-sheet]')];
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0].querySelectorAll('tbody tr').length, 82);
    assert.equal(sheets[1].querySelectorAll('tbody tr').length, 23);
    assert.equal(content.querySelectorAll('[data-ceobe-sheet-tab]').length, 2);
  }
}
for (const key of ['txt', 'docx', 'pdf', 'xlsx', 'pasted', 'pasted-reference']) {
  assert.ok(document.querySelector(`[data-ceobe-open-preview="${key}"]`), `No ${key} opener`);
}
console.log('Four side panels, pasted-text dialog, openers, seven PDF assets and two worksheet datasets verified.');
