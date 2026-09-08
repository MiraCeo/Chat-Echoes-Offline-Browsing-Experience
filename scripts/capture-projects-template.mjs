// Explicit one-time migration. Regular builds only read the frozen package.
import { readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
const { values } = parseArgs({ options: { input: { type: 'string' } } });
if (!values.input) throw new Error('Pass --input <saved-projects.html>');
const root = resolve(import.meta.dirname, '..');
const file = resolve(values.input);
const d = parseHTML(await readFile(file, 'utf8')).document;
const main = d.querySelector('main');
if (!main?.querySelector('[data-testid="project-directory-scroll-root"]')) throw new Error('Official project directory DOM missing');
for (const node of main.querySelectorAll('script,iframe,object,embed,link,base')) node.remove();
for (const node of [main, ...main.querySelectorAll('*')]) {
  for (const attr of node.getAttributeNames()) if (/^on/i.test(attr)) node.removeAttribute(attr);
  if (/^radix-/.test(node.id || '')) node.removeAttribute('id');
  node.removeAttribute('aria-controls');
}
const stylesheets = [];
for (const link of d.querySelectorAll('link[rel="stylesheet"]')) {
  const href = link.getAttribute('href'); if (!href || /^(https?:|\/\/)/.test(href)) continue;
  const source = resolve(dirname(file), decodeURIComponent(href));
  const bytes = await readFile(source);
  let name = basename(source);
  let existing;
  try { existing = await readFile(join(root, 'official-templates/assets', name)); } catch {}
  if (existing && !existing.equals(bytes)) name = `projects-ref-${name}`;
  if (!existing || !existing.equals(bytes)) await cp(source, join(root, 'official-templates/assets', name));
  if (!stylesheets.includes(name)) stylesheets.push(name);
}
await writeFile(join(root, 'official-templates/projects.json'), JSON.stringify({ version:1, source_mode:'frozen_package', purpose:'official-dom-visual-reference-only', main:htmlSafeSvg(main.outerHTML), stylesheets },null,2));
console.log(`Frozen official projects DOM: ${main.querySelectorAll('[data-page-table-selectable-row]').length} reference rows; ${stylesheets.length} stylesheets.`);
