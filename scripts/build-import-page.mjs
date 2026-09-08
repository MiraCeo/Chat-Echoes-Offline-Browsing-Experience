import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';
import { htmlSafeSvg } from './serialize-html.mjs';

export async function buildImportPage(projectRoot = resolve(import.meta.dirname, '..')) {
  const replayRoot = join(projectRoot, 'replay');
  const document = parseHTML(await readFile(join(replayRoot, 'index.html'), 'utf8')).document;
  const official = await loadOfficialTemplatePackage(projectRoot);
  const currentMain = document.querySelector('main');
  const currentHeader = document.querySelector('header');
  const importMain = official.clone('page:new-chat', document);
  const importHeader = official.clone('page:new-chat-header', document);
  if (!currentMain || !currentHeader || !importMain || !importHeader) {
    throw new Error('Unable to assemble the official import page.');
  }
  currentMain.replaceWith(importMain);
  currentHeader.replaceWith(importHeader);
  document.body.dataset.ceobeImportPage = '';
  document.title = '导入会话';

  for (const name of official.manifest.new_chat_stylesheets || []) {
    if (document.querySelector(`link[href="./assets/${name}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `./assets/${name}`;
    document.head.append(link);
  }

  await writeFile(join(replayRoot, 'import.html'), `<!DOCTYPE html>\n${htmlSafeSvg(document.documentElement.outerHTML)}`, 'utf8');
  console.log('Built official-DOM import page: replay/import.html');
}
