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
  const suggestion = [...importMain.querySelectorAll('button')].find(button =>
    button.textContent.includes('归档完整 JSON'));
  if (suggestion) {
    const description = document.createElement('div');
    description.className = 'ceobe-import-description';
    description.innerHTML = '<p>导入公开分享链接，保存到本地，随时重新阅读。</p><p class="ceobe-import-note">支持 chatgpt.com/share/… · 附件将尽可能保存，缺失情况会在完成后提示。</p>';
    suggestion.replaceWith(description);
  }

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
