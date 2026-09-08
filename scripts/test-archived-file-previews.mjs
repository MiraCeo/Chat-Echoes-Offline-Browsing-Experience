import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';

const id = '6a9849f6-3bec-83ee-b032-618d95fc0917';
const document = parseHTML(await readFile(`replay/conversations/${id}.html`, 'utf8')).document;
assert.equal(document.querySelector('template[data-ceobe-preview]'), null);
const previewFiles = new Map();
for (const opener of document.querySelectorAll('[data-ceobe-open-preview][data-ceobe-preview-file]')) {
  previewFiles.set(opener.getAttribute('data-ceobe-open-preview'), opener.getAttribute('data-ceobe-preview-file'));
}
assert.equal(previewFiles.size, 4);
const parsed = await Promise.all([...previewFiles].map(async ([key, filename]) => ({
  key,
  document: parseHTML(`<html><body>${await readFile(`replay/previews/templates/${filename}`, 'utf8')}</body></html>`).document,
})));
const pdf = parsed.find(item => item.document.querySelector('[data-testid="artifact-pdf-preview-surface"]'));
const docx = parsed.find(item => item.document.querySelector('[data-testid="docx-preview-panel"]'));
const sheets = parsed.filter(item => item.document.querySelector('[data-ceobe-sheet]'));
assert.equal(pdf.document.querySelectorAll('[data-testid^="artifact-pdf-page-"] img').length, 7);
for (const image of pdf.document.querySelectorAll('[data-testid^="artifact-pdf-page-"] img')) {
  await access(resolve('replay', image.getAttribute('src')));
}
const docxPanel = docx.document.querySelector('[data-testid="docx-preview-panel"]');
assert.ok(docxPanel.querySelector('.artifact-docx-preview-wrapper > .artifact-docx-preview > article > p > span'));
assert.deepEqual(sheets.map(item => item.document.querySelectorAll('[data-ceobe-sheet]').length).sort(), [1, 2]);
for (const { key } of parsed) assert.ok(document.querySelector(`[data-ceobe-open-preview="${key}"]`));
assert.ok(!document.querySelector('[data-ceobe-open-preview="pasted-reference"]'));
console.log('Archived PDF, DOCX and two XLSX resources have data-driven offline previews.');
