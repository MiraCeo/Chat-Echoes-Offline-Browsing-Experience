import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';

export async function loadOfficialTemplatePackage(projectRoot) {
  const root = join(projectRoot, 'official-templates');
  const [shellSource, templatesSource, manifestSource] = await Promise.all([
    readFile(join(root, 'shell.html'), 'utf8'),
    readFile(join(root, 'templates.json'), 'utf8'),
    readFile(join(root, 'manifest.json'), 'utf8'),
  ]);
  const document = parseHTML(shellSource).document;
  const templates = JSON.parse(templatesSource);
  const manifest = JSON.parse(manifestSource);
  const clone = (name, targetDocument = document) => {
    const source = templates[name];
    if (!source) throw new Error(`Official DOM template is missing: ${name}`);
    const holder = targetDocument.createElement('div');
    holder.innerHTML = htmlSafeSvg(source);
    return holder.firstElementChild;
  };
  const templateDocument = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  for (const name of manifest.templates) templateDocument.body.append(clone(name, templateDocument));
  return { root, document, templates, manifest, clone, templateDocument };
}
