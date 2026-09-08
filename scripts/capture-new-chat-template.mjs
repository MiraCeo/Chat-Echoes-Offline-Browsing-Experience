import { cp, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';

const projectRoot = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { input: { type: 'string' } } });
if (!values.input) throw new Error('Usage: node scripts/capture-new-chat-template.mjs --input <saved-new-chat.html>');

const inputPath = resolve(values.input);
const inputRoot = dirname(inputPath);
const packageRoot = join(projectRoot, 'official-templates');
const templatesPath = join(packageRoot, 'templates.json');
const manifestPath = join(packageRoot, 'manifest.json');
const document = parseHTML(await readFile(inputPath, 'utf8')).document;
const main = document.querySelector('main');
const header = document.querySelector('header');
if (!main || !header) throw new Error('The saved page does not contain the official new-chat shell.');

for (const node of document.querySelectorAll('script, iframe, object, embed')) node.remove();
main.dataset.ceobeImportMain = '';
header.dataset.ceobeImportHeader = '';
header.replaceChildren();

const composer = main.querySelector('form[data-type="unified-composer"]');
const input = main.querySelector('#prompt-textarea');
const submit = composer?.querySelector('button[aria-label="启动语音功能"]');
if (!composer || !input || !submit) throw new Error('The official composer DOM could not be located.');
composer.dataset.ceobeImportForm = '';
input.dataset.ceobeImportInput = '';
input.setAttribute('aria-label', 'ChatGPT 分享链接');
input.innerHTML = '<p dir="auto" data-empty-paragraph="true" data-placeholder="粘贴 ChatGPT 分享链接" class="placeholder"><br class="ProseMirror-trailingBreak"></p>';
submit.dataset.ceobeImportSubmit = '';
submit.setAttribute('aria-label', '导入会话');
submit.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21a1 1 0 0 0 1-1V6.414l5.293 5.293a1 1 0 0 0 1.414-1.414l-7-7a1 1 0 0 0-1.414 0l-7 7a1 1 0 1 0 1.414 1.414L11 6.414V20a1 1 0 0 0 1 1Z"/></svg>';
for (const button of composer.querySelectorAll('button')) {
  if (button !== submit) button.remove();
}

const heading = [...main.querySelectorAll('div')].find(node =>
  node.children.length === 0 && /^(今天有什么计划|我们先从哪里开始呢)？?$/.test(node.textContent.trim()));
if (heading) heading.textContent = '导入会话';

const suggestion = [...main.querySelectorAll('button')].find(button =>
  button.textContent.includes('Give me one concrete design or balance step'));
if (suggestion) suggestion.textContent = '粘贴 ChatGPT 公开分享链接，归档完整 JSON、Markdown 和离线页面。';
main.querySelector('button[aria-label="关闭建议"]')?.remove();

const templates = JSON.parse(await readFile(templatesPath, 'utf8'));
templates['page:new-chat'] = main.outerHTML;
templates['page:new-chat-header'] = header.outerHTML;
await writeFile(templatesPath, `${JSON.stringify(templates, null, 2)}\n`, 'utf8');

const stylesheetPaths = [...document.querySelectorAll('link[rel="stylesheet"]')]
  .map(link => link.getAttribute('href'))
  .filter(Boolean);
const stylesheetNames = [];
for (const href of stylesheetPaths) {
  const source = resolve(inputRoot, decodeURIComponent(href.replace(/^\.\//, '')));
  const name = basename(source);
  await cp(source, join(packageRoot, 'assets', name));
  stylesheetNames.push(name);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.templates.includes('page:new-chat')) manifest.templates.push('page:new-chat');
if (!manifest.templates.includes('page:new-chat-header')) manifest.templates.push('page:new-chat-header');
manifest.new_chat_stylesheets = [...new Set(stylesheetNames)];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Captured official new-chat DOM and ${manifest.new_chat_stylesheets.length} stylesheets.`);
