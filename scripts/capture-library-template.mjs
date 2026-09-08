// One-time migration input only. Normal builds never read the reference folder.
import { readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
const { values } = parseArgs({ options: { input: { type: 'string' } } });
if (!values.input) throw new Error('Pass --input <saved-library.html>');
const root = resolve(import.meta.dirname, '..');
const file = resolve(values.input);
const d = parseHTML(await readFile(file, 'utf8')).document;
const main = d.querySelector('main');
const row = [...main.querySelectorAll('[data-page-table-row-item]')].find(e => e.querySelector('[data-testid^="artifact-checkbox-bridge-"]'))?.cloneNode(true);
if (!row) throw new Error('Official library file row missing');
main.querySelector('[role="grid"]').replaceChildren();
for (const node of [main, row]) {
  for (const e of node.querySelectorAll('script,iframe,object,embed,img')) e.remove();
  for (const e of [node, ...node.querySelectorAll('*')]) {
    for (const a of e.getAttributeNames()) if (/^on/i.test(a) || a === 'id' || a === 'draggable' || a === 'aria-controls' || a === 'data-page-table-selection-id' || (a === 'data-testid' && /libfile_|row-actions-/.test(e.getAttribute(a)))) e.removeAttribute(a);
  }
}
// Keep official cells and layout, not captured personal filenames or metadata.
for (const cell of row.querySelectorAll('[role="gridcell"]')) cell.replaceChildren();
const stylesheets = [];
for (const link of d.querySelectorAll('link[rel="stylesheet"]')) {
  const href = link.getAttribute('href');
  if (!href || /^(https?:|\/\/)/.test(href)) continue;
  const name = basename(decodeURIComponent(href));
  if (!/^(artifacts-surface|page-table-row|project-directory|\(_lang\))/.test(name)) continue;
  await cp(resolve(dirname(file), decodeURIComponent(href)), join(root, 'official-templates/assets', name));
  stylesheets.push(name);
}
await writeFile(join(root, 'official-templates/library.json'), JSON.stringify({ version: 1, source_mode: 'frozen_package', main: htmlSafeSvg(main.outerHTML), row: htmlSafeSvg(row.outerHTML), stylesheets }, null, 2));
console.log('Frozen official library shell, blank file row and', stylesheets.length, 'stylesheets.');
