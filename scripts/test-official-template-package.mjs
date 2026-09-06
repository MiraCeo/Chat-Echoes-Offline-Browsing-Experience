import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';

const root = process.cwd();
const pkg = await loadOfficialTemplatePackage(root);
assert.equal(pkg.manifest.format, 'ceobe-official-dom-templates');
assert.equal(pkg.manifest.version, 1);
assert.equal(pkg.manifest.source_mode, 'frozen_package');
assert.equal(pkg.manifest.sources, undefined,
  'the frozen package must not retain build dependencies on raw snapshots');
assert.equal(pkg.document.querySelectorAll('[data-ceobe-message-list]').length, 1);
assert.equal(pkg.document.querySelectorAll('section[data-testid^="conversation-turn-"]').length, 0,
  'the reusable shell must not contain captured conversation messages');
assert.equal(pkg.document.querySelectorAll('script, iframe').length, 0,
  'the reusable shell must not contain live application code');

for (const name of [
  'message:user', 'message:assistant', 'message:stopped-thinking', 'message:generated-image',
  'message:branch-footer', 'message:user-images-1', 'message:user-images-3',
  'message:file-tile-row', 'markdown:table', 'widget:chart',
  'citation:file', 'citation:web', 'citation:web-count', 'citation:url',
  'generated-file:inline', 'generated-file:card', 'sources:toggle', 'sources:panel',
  'navigation:prompt-rail',
  'preview:txt', 'preview:docx', 'preview:pdf', 'preview:xlsx',
  'preview:pasted', 'preview:pasted-reference',
]) {
  assert(pkg.manifest.templates.includes(name), `manifest is missing ${name}`);
  assert(pkg.clone(name), `template is not loadable: ${name}`);
}
const tableTemplate = pkg.clone('markdown:table');
assert.ok(tableTemplate.classList.contains('TyagGW_tableContainer'));
assert.ok(tableTemplate.classList.contains('TyagGW_tableContainerWithTableOfContents'));
assert.ok(tableTemplate.querySelector('.TyagGW_tableWrapper > table'));
for (const stylesheet of pkg.manifest.chart_stylesheets) {
  await access(join(pkg.root, 'assets', stylesheet));
}

for (const path of [
  'scripts/build-official-replay.mjs', 'scripts/build-sources-panel.mjs',
  'scripts/build-file-previews.mjs', 'scripts/extract-official-templates.mjs',
]) {
  const source = await readFile(join(root, path), 'utf8');
  assert(!/["'`](?:测试消息|图表|新界面|文件)[\\/]/.test(source),
    `${path} must consume the template package instead of original snapshots`);
}
for (const name of ['技术部-开发组-加分题.pdf', '票据收集情况.xlsx']) {
  await access(join(root, 'fixtures', 'chatgpt-share', '6a9849f6-3bec-83ee-b032-618d95fc0917', 'preview-inputs', name));
}
console.log(`Official template package verified: ${pkg.manifest.templates.length} templates and an empty reusable shell.`);
