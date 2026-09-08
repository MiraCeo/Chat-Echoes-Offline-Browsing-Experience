import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const document = parseHTML(await readFile('replay/index.html', 'utf8')).document;
assert.equal(document.querySelector('template[data-ceobe-preview]'), null);
const previewFiles = new Map();
for (const opener of document.querySelectorAll('[data-ceobe-open-preview][data-ceobe-preview-file]')) {
  previewFiles.set(opener.getAttribute('data-ceobe-open-preview'), opener.getAttribute('data-ceobe-preview-file'));
}
assert.equal(previewFiles.size, 6);
for (const [key, filename] of previewFiles) {
  const content = parseHTML('<html><body>' + await readFile(`replay/previews/templates/${filename}`, 'utf8') + '</body></html>').document;
  if (key === 'pasted') {
    assert.ok(content.querySelector('.content-sheet.popup'));
    assert.ok(content.body.textContent.includes('BUILD SUCCESSFUL in 4m 42s'));
    assert.ok(content.body.textContent.includes('Configuration cache entry reused.'));
  } else assert.ok(content.querySelector('[data-testid="artifact-preview-side-pane-surface"]'));
  assert.ok(content.querySelector('[data-ceobe-close-preview]'));
  assert.equal(content.querySelector('script'), null);
  if (key === 'pasted-reference') {
    assert.ok(content.querySelector('[data-ceobe-pasted-reference] .cm-content'));
    assert.equal(content.querySelector('[data-ceobe-incomplete-preview]'), null);
    assert.equal(content.querySelector('[data-ceobe-complete-preview]')?.getAttribute('data-ceobe-complete-preview'), 'clipboard-recovery');
    assert.equal(content.querySelectorAll('.cm-content > .cm-line').length, 374);
    assert.equal(content.querySelector('.cm-gap'), null);
    assert.ok(content.body.textContent.includes("'.\\gradlew.bat' ':app' '--console=plain'"));
    assert.ok(content.body.textContent.includes('BUILD SUCCESSFUL in 4m 42s'));
  }
  if (key === 'pdf') {
    const images = [...content.querySelectorAll('[data-testid^="artifact-pdf-page-"] img')];
    assert.equal(images.length, 7);
    for (const image of images) await access('replay/' + image.getAttribute('src'));
    assert.equal(content.querySelector('canvas'), null);
  }
  if (key === 'docx') {
    const panel = content.querySelector('[data-testid="docx-preview-panel"]');
    const page = panel?.querySelector('.artifact-docx-preview-wrapper > .artifact-docx-preview');
    assert.ok(page, 'official DOCX page wrapper must be retained');
    assert.ok(page.querySelector('article > p > span'), 'DOCX content must use the official article/p/span DOM');
  }
  if (key === 'xlsx') {
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
