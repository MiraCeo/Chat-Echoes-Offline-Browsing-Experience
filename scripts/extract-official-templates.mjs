import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';

// The official DOM package is now a frozen, self-contained source artifact.
// This command remains for compatibility, but deliberately never reaches back
// into the large raw browser captures that were used during initial extraction.
const projectRoot = resolve(import.meta.dirname, '..');
const packageRoot = join(projectRoot, 'official-templates');
const shellPath = join(packageRoot, 'shell.html');
const templatesPath = join(packageRoot, 'templates.json');
const manifestPath = join(packageRoot, 'manifest.json');

const [shellSource, templatesSource, manifestSource] = await Promise.all([
  readFile(shellPath, 'utf8'),
  readFile(templatesPath, 'utf8'),
  readFile(manifestPath, 'utf8'),
]);
const shell = parseHTML(shellSource).document;
const templates = JSON.parse(templatesSource);
const previousManifest = JSON.parse(manifestSource);

if (shell.querySelectorAll('[data-ceobe-message-list]').length !== 1) {
  throw new Error('Frozen official shell must contain exactly one CEOBE message list.');
}
if (shell.querySelector('section[data-testid^="conversation-turn-"], script, iframe')) {
  throw new Error('Frozen official shell contains conversation data or executable content.');
}

const templateNames = Object.keys(templates).sort();
for (const name of templateNames) {
  const document = parseHTML(`<html><body>${templates[name]}</body></html>`).document;
  if (!document.body.firstElementChild) throw new Error(`Official DOM template is empty: ${name}`);
}

const assetNames = new Set(await readdir(join(packageRoot, 'assets')));
for (const filename of [
  ...(previousManifest.chart_stylesheets || []),
  ...(previousManifest.preview_stylesheets || []),
  ...(previousManifest.new_chat_stylesheets || []),
]) {
  if (!assetNames.has(filename)) throw new Error(`Official template asset is missing: ${filename}`);
  await access(join(packageRoot, 'assets', filename));
}

const manifest = {
  version: previousManifest.version,
  format: previousManifest.format,
  source_mode: 'frozen_package',
  templates: templateNames,
  chart_stylesheets: [...new Set(previousManifest.chart_stylesheets || [])],
  preview_stylesheets: [...new Set(previousManifest.preview_stylesheets || [])],
  new_chat_stylesheets: [...new Set(previousManifest.new_chat_stylesheets || [])],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `Validated frozen official DOM package: ${templateNames.length} templates and ${assetNames.size} assets.`,
);
