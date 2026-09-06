import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const outputRoot = join(projectRoot, 'official-templates');
const testRoot = join(projectRoot, '测试消息');
const chartRoot = join(projectRoot, '图表');
const sourcesRoot = join(projectRoot, '新界面');
const fileRoot = join(projectRoot, '文件');
const fixtureRoot = join(projectRoot, 'fixtures', 'chatgpt-share', '6a9849f6-3bec-83ee-b032-618d95fc0917');
const snapshotNames = ['分支 · 测试消息.html', '分支 · 测试消息1.html', '分支 · 测试消息2.html'];
const chartName = '图表.html';

const documents = [];
for (const name of snapshotNames) {
  documents.push({ name, document: parseHTML(await readFile(join(testRoot, name), 'utf8')).document });
}
const chartDocument = parseHTML(await readFile(join(chartRoot, chartName), 'utf8')).document;
const sourcesDocument = parseHTML(await readFile(join(sourcesRoot, '新界面.html'), 'utf8')).document;
const baseDocument = documents[0].document;

const normalize = htmlSafeSvg;
const outer = node => {
  if (!node) throw new Error('Cannot extract a missing official DOM template.');
  return normalize(node.outerHTML)
    .replaceAll('sprites-core-ff27b486.svg', 'sprites-core-26c3f2d4.svg')
    .replaceAll('sprites-shell-45f921f2.svg', 'sprites-shell-097001e7.svg')
    .replaceAll('sprites-core-ff27b486', 'sprites-core-26c3f2d4')
    .replaceAll('sprites-shell-45f921f2', 'sprites-shell-097001e7');
};

const sectionCandidates = new Map();
for (const { document } of documents) {
  for (const section of document.querySelectorAll('section[data-testid^="conversation-turn-"]')) {
    const id = section.querySelector('[data-message-id]')?.getAttribute('data-message-id') || section.getAttribute('data-turn-id');
    const previous = sectionCandidates.get(id);
    if (!previous || section.outerHTML.length > previous.outerHTML.length) sectionCandidates.set(id, section);
  }
}
const sections = [...sectionCandidates.values()];
const user = sections.find(section => section.querySelector('.user-message-bubble-color .markdown.prose')
  && !section.querySelector('[data-testid="library-file-icon"]'));
const assistant = sections.find(section => section.querySelector('[data-message-author-role="assistant"] .markdown'));
const stopped = sections.find(section => [...section.querySelectorAll('button')]
  .some(button => button.textContent.trim() === '已停止思考'));
const generatedImage = sections.find(section => section.querySelector('img[alt^="已生成图片"]'));
const branchParagraph = sections
  .flatMap(section => [...section.querySelectorAll('p')])
  .find(paragraph => /从\s*.+\s*建立的分支/.test(paragraph.textContent));
const branchFooter = branchParagraph?.parentElement?.parentElement;
// This outer container owns the conversation-canvas width and defines the CSS
// variables consumed by the wrapper. Without it, wide tables collapse into the
// assistant reading column.
const table = documents.map(({ document }) => document.querySelector('.TyagGW_tableContainer')).find(Boolean);
const chart = chartDocument.querySelector('.chart-widget-container');
const fileTileRow = chartDocument.querySelector('[class*="group/file-tile"]')?.parentElement;

const templates = {
  'message:user': outer(user),
  'message:assistant': outer(assistant),
  'message:stopped-thinking': outer(stopped),
  'message:generated-image': outer(generatedImage),
  'message:branch-footer': outer(branchFooter),
  'message:file-tile-row': outer(fileTileRow),
  'markdown:table': outer(table),
  'widget:chart': outer(chart),
};

for (const section of sections.filter(section => section.getAttribute('data-turn') === 'user')) {
  const images = section.querySelectorAll('[class~="group/message-image"] img');
  if (images.length && !templates[`message:user-images-${images.length}`]) {
    templates[`message:user-images-${images.length}`] = outer(
      images[0].closest('.flex.w-\\[var\\(--user-chat-width\\,70\\%\\)\\]'),
    );
  }
}
for (const tile of chartDocument.querySelectorAll('[class*="group/file-tile"]')) {
  const key = tile.querySelector('[data-library-file-icon-key]')?.getAttribute('data-library-file-icon-key');
  if (key && !templates[`message:file-tile-${key}`]) templates[`message:file-tile-${key}`] = outer(tile);
}

const citationDocuments = [...documents.map(item => item.document), chartDocument];
const fileCitation = citationDocuments.flatMap(document => [...document.querySelectorAll('[data-file-citation-group-size="1"]')])[0];
const webCitations = citationDocuments.flatMap(document => [...document.querySelectorAll('[data-testid="webpage-citation-pill"]')]);
const hasCitationCount = node => [...node.querySelectorAll('span')].some(span => /^\+\d+$/.test(span.textContent));
const decoratedUrl = citationDocuments.flatMap(document => [...document.querySelectorAll('a.decorated-link')])
  .find(link => link.querySelector('svg use'));
templates['citation:file'] = outer(fileCitation);
templates['citation:web'] = outer(webCitations.find(node => !hasCitationCount(node)) || webCitations[0]);
templates['citation:web-count'] = outer(webCitations.find(hasCitationCount) || webCitations[0]);
templates['citation:url'] = outer(decoratedUrl);
const fileSourcesButton = [...parseHTML(await readFile(join(fileRoot, '文件.html'), 'utf8')).document.querySelectorAll('button')]
  .find(button => button.textContent.trim() === '来源' && button.classList.contains('not-prose'));
templates['citation:sources-button'] = outer(fileSourcesButton);

const inlineGeneratedFile = [...chartDocument.querySelectorAll('button.behavior-btn')]
  .find(node => node.querySelector('[data-library-file-icon-key="xls"]'));
const generatedFileButton = [...chartDocument.querySelectorAll('button')]
  .find(node => node.classList.contains('group/open-file'));
let generatedFileCard = generatedFileButton;
while (generatedFileCard && !generatedFileCard.classList.contains('border')) generatedFileCard = generatedFileCard.parentElement;
if (generatedFileCard?.parentElement.classList.contains('w-full')) generatedFileCard = generatedFileCard.parentElement;
templates['generated-file:inline'] = outer(inlineGeneratedFile);
templates['generated-file:card'] = outer(generatedFileCard);

const sourcesToggle = [...sourcesDocument.querySelectorAll('button')]
  .find(button => button.getAttribute('aria-label') === '文件和来源');
templates['sources:toggle'] = outer(sourcesToggle);
templates['sources:panel'] = outer(sourcesDocument.querySelector('aside')?.parentElement?.parentElement);
const promptItem = documents.map(({ document }) => document.querySelector('[data-toc-item-index]')).find(Boolean);
templates['navigation:prompt-rail'] = outer(promptItem?.closest('.fixed'));

const previewSpecs = [
  ['txt', '文件'], ['docx', 'docx'], ['pdf', 'pdf'], ['xlsx', 'xlsx'],
  ['pasted', '粘贴的文本'], ['pasted-reference', '粘贴的文本2'],
];
const previewStylesheetSources = [];
for (const [key, snapshot] of previewSpecs) {
  const document = parseHTML(await readFile(join(fileRoot, `${snapshot}.html`), 'utf8')).document;
  const pane = key === 'pasted'
    ? document.querySelector('.content-sheet.popup')
    : document.querySelector('[data-testid="artifact-preview-side-pane-surface"]')?.closest('aside');
  templates[`preview:${key}`] = outer(pane);
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const filename = basename(link.getAttribute('href') || '');
    if (!/^(?:WidgetRenderer|writing-block|react-|conversation-small|user-markdown-formatted-text|code-block-editor)/.test(filename)) continue;
    previewStylesheetSources.push({ filename, path: join(fileRoot, `${snapshot}_files`, filename) });
  }
}

const sampleSections = Object.fromEntries([...sectionCandidates].map(([id, section]) => [id, outer(section)]));

const firstSection = baseDocument.querySelector('section[data-testid^="conversation-turn-"]');
const messageList = firstSection?.parentElement?.parentElement;
if (!messageList) throw new Error('Official shell message list was not found.');
messageList.setAttribute('data-ceobe-message-list', '');
messageList.replaceChildren();
for (const script of [...baseDocument.querySelectorAll('script')]) script.remove();
for (const link of [...baseDocument.querySelectorAll('link')]) {
  if (/preload|prefetch|preconnect|dns-prefetch/.test(link.getAttribute('rel') || '')
    || (/^https?:/.test(link.getAttribute('href') || '') && link.getAttribute('rel') !== 'stylesheet')) link.remove();
}
for (const frame of [...baseDocument.querySelectorAll('iframe')]) frame.remove();
let shell = `<!DOCTYPE html>\n${normalize(baseDocument.documentElement.outerHTML)}`;
for (const name of snapshotNames) shell = shell.replaceAll(`./${basename(name, '.html')}_files/`, './assets/');
shell = shell
  .replaceAll('sprites-core-ff27b486.svg', 'sprites-core-26c3f2d4.svg')
  .replaceAll('sprites-shell-45f921f2.svg', 'sprites-shell-097001e7.svg');

const chartStylesheets = [...chartDocument.querySelectorAll('link[rel="stylesheet"]')]
  .map(link => basename(link.getAttribute('href') || ''))
  .filter(name => /^(?:react-|chart-widget-container-|WidgetRenderer-)/.test(name));
const manifest = {
  version: 1,
  format: 'ceobe-official-dom-templates',
  sources: [
    ...snapshotNames.map(name => `测试消息/${name}`),
    '图表/图表.html', '新界面/新界面.html',
    ...previewSpecs.map(([, snapshot]) => `文件/${snapshot}.html`),
  ],
  templates: Object.keys(templates).sort(),
  chart_stylesheets: [...new Set(chartStylesheets)],
  preview_stylesheets: [...new Set(previewStylesheetSources.map(item => item.filename))],
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(outputRoot, 'assets'), { recursive: true });
await writeFile(join(outputRoot, 'shell.html'), shell, 'utf8');
await writeFile(join(outputRoot, 'templates.json'), JSON.stringify(templates, null, 2) + '\n', 'utf8');
await writeFile(join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
await writeFile(join(outputRoot, 'README.md'), `# Official DOM template package

This directory is generated by \`npm run extract:templates\` from the saved official ChatGPT pages listed in \`manifest.json\`.

- \`shell.html\` is the reusable page shell with an empty conversation message list.
- \`templates.json\` contains reusable visual DOM fragments only.
- \`assets/\` contains the official stylesheets and favicon used by those fragments.
- Six \`preview:*\` templates preserve the official file and pasted-text viewer DOM.
- Captured sample conversation sections belong to the acceptance fixture, not this package.

The normal JSON-to-HTML renderer reads this package and does not scan the original saved pages. Keep the source pages until a newly extracted package has passed the regression suite.
`, 'utf8');
await writeFile(
  join(fixtureRoot, 'official-sections.json'),
  JSON.stringify(sampleSections, null, 2) + '\n',
  'utf8',
);
await mkdir(join(fixtureRoot, 'preview-inputs'), { recursive: true });
for (const name of ['技术部-开发组-加分题.pdf', '票据收集情况.xlsx']) {
  await cp(join(fileRoot, name), join(fixtureRoot, 'preview-inputs', name));
}

const resourceDirectories = [
  ...snapshotNames.map(name => join(testRoot, `${basename(name, '.html')}_files`)),
  join(chartRoot, `${basename(chartName, '.html')}_files`),
];
const copied = new Set();
for (const directory of resourceDirectories) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css') || copied.has(entry.name)) continue;
    let css = await readFile(join(directory, entry.name), 'utf8');
    css = css.replaceAll(
      'https://cdn.openai.com/common/fonts/openai-sans/v4/OpenAISans-Semibold.woff2',
      './OpenAISans-Semibold.woff2',
    );
    await writeFile(join(outputRoot, 'assets', entry.name), css, 'utf8');
    copied.add(entry.name);
  }
}
for (const { filename, path } of previewStylesheetSources) {
  if (copied.has(filename)) continue;
  let css = await readFile(path, 'utf8');
  css = css.replaceAll(
    'https://cdn.openai.com/common/fonts/openai-sans/v4/OpenAISans-Semibold.woff2',
    './OpenAISans-Semibold.woff2',
  );
  await writeFile(join(outputRoot, 'assets', filename), css, 'utf8');
  copied.add(filename);
}
await cp(join(chartRoot, `${basename(chartName, '.html')}_files`, 'favicons'), join(outputRoot, 'assets', 'favicons.png'));

console.log(`Extracted ${Object.keys(templates).length} official DOM templates and ${copied.size} stylesheets into ${outputRoot}.`);
