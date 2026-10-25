import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';

// 这一项验证“真实档案里的附件”渲染出来的预览（PDF/DOCX/两个 XLSX）。公开仓库不带档案，
// 所以按标题在本地档案里找这次会话；找不到就明确跳过，而不是失败。
const libraryPath = 'archive/library.ceobe.json';
const entry = existsSync(libraryPath)
  ? JSON.parse(await readFile(libraryPath, 'utf8')).conversations.find(item => item.title === '分支 · 测试消息')
  : null;
const page = entry ? `replay/conversations/${entry.id}.html` : '';
if (!page || !existsSync(page)) {
  console.log('SKIP archived file previews: 本地档案里没有「分支 · 测试消息」的阅读页（公开仓库不含档案）。');
  process.exit(0);
}
const document = parseHTML(await readFile(page, 'utf8')).document;
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
