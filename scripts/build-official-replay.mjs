import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readArchivedResource, assetKey } from './archive-resources.mjs';
import { parseHTML } from "linkedom";
import { marked } from "marked";
import { renderAssistantMarkdown } from "./render-markdown.mjs";
import { createOfficialCitations } from "./official-citations.mjs";
import { buildFilePreviews } from "./build-file-previews.mjs";
import { conversationToView } from "./conversation-to-view.mjs";
import { parseArgs } from "node:util";
import { htmlSafeSvg } from './serialize-html.mjs';
import { createGeneratedFiles } from './generated-files.mjs';
import { attachCopyControls } from './copy-controls.mjs';
import { buildSourcesPanel } from './build-sources-panel.mjs';

const projectRoot = resolve(import.meta.dirname, "..");
const testRoot = join(projectRoot, "测试消息");
const chartSnapshotRoot = join(projectRoot, "图表");
const chartSnapshotName = "图表.html";
const { values } = parseArgs({ options: {
  input: { type: "string" },
  "sample-assets": { type: "boolean", default: false },
  "output-page": { type: "string" },
  "preserve-output": { type: "boolean", default: false },
  library: { type: "string" },
  "entry-id": { type: "string" },
} });
if (!values.input) throw new Error("Usage: npm run replay -- --input <conversation.ceobe.json> [--sample-assets]");
const canonicalConversationPath = resolve(values.input);
const useSampleAssets = values["sample-assets"];
// Validate before touching the generated output directory.
const canonicalConversation = JSON.parse(await readFile(canonicalConversationPath, "utf8"));
const messages = conversationToView(canonicalConversation);
const archivedResources = canonicalConversation.resources || [];
const resourceBytes = new Map();
for (const resource of archivedResources.filter(r => r.status === 'downloaded')) {
  resourceBytes.set(resource.local_path, await readArchivedResource(dirname(canonicalConversationPath), resource));
}
const outputRoot = join(projectRoot, "replay");
const outputPage = values["output-page"] ? resolve(values["output-page"]) : join(outputRoot, 'index.html');
const relativeOutputPage = relative(outputRoot, outputPage);
if (relativeOutputPage.startsWith('..') || isAbsolute(relativeOutputPage) || !outputPage.endsWith('.html')) {
  throw new Error('Output page must be an HTML file inside replay/.');
}
const library = values.library ? JSON.parse(await readFile(resolve(values.library), 'utf8')) : null;
const outputAssets = join(outputRoot, "assets");
const officialAssetsRoot = join(projectRoot, "official-assets", "cdn", "assets");
const outputOfficialAssets = join(outputRoot, "cdn", "assets");
const katexDistribution = join(projectRoot, "node_modules", "katex", "dist");
const officialSpriteNames = [
  "sprites-core-26c3f2d4.svg",
  "sprites-shell-097001e7.svg",
];
const officialFontName = 'OpenAISans-Semibold.woff2';
const snapshotNames = [
  "分支 · 测试消息.html",
  "分支 · 测试消息1.html",
  "分支 · 测试消息2.html",
];

marked.setOptions({ gfm: true, breaks: true });

const snapshotDocuments = [];
for (const name of snapshotNames) {
  const source = await readFile(join(testRoot, name), "utf8");
  snapshotDocuments.push({ name, document: parseHTML(source).document });
}

const baseDocument = snapshotDocuments[0].document;
const chartSnapshotSource = await readFile(
  join(chartSnapshotRoot, chartSnapshotName),
  "utf8",
);
const chartSnapshotDocument = parseHTML(chartSnapshotSource).document;
const officialCitations = createOfficialCitations([
  ...snapshotDocuments.map(item => item.document), chartSnapshotDocument,
]);
const officialChart = chartSnapshotDocument.querySelector(".chart-widget-container");
const generatedFiles = createGeneratedFiles(chartSnapshotDocument);
const officialChartTemplates = {};
if (officialChart && useSampleAssets) {
  const title = officialChart.querySelector("section")?.getAttribute("aria-label");
  if (title) {
    officialChartTemplates[title] = htmlSafeSvg(officialChart.outerHTML)
      .replaceAll("sprites-core-ff27b486.svg", "sprites-core-26c3f2d4.svg")
      .replaceAll("sprites-shell-45f921f2.svg", "sprites-shell-097001e7.svg");
  }
}
// Match optional captured visual assets by message identity, never by turn number.
const sectionCandidates = new Map();
for (const { document } of snapshotDocuments) {
  for (const section of document.querySelectorAll('section[data-testid^="conversation-turn-"]')) {
    const id = section.querySelector("[data-message-id]")?.getAttribute("data-message-id")
      || section.getAttribute("data-turn-id");
    const previous = sectionCandidates.get(id);
    if (!previous || section.outerHTML.length > previous.outerHTML.length) sectionCandidates.set(id, section);
  }
}

const cloneIntoBase = (node) => {
  const holder = baseDocument.createElement("div");
  holder.innerHTML = htmlSafeSvg(node.outerHTML);
  return holder.firstElementChild;
};

const setTurnIdentity = (section, turnNumber, role) => {
  const syntheticId = `ceobe-replay-turn-${turnNumber}`;
  section.setAttribute("data-testid", `conversation-turn-${turnNumber}`);
  section.setAttribute("data-turn", role);
  section.setAttribute("data-turn-id", syntheticId);
  section.setAttribute("data-turn-id-container", syntheticId);
  const message = section.querySelector("[data-message-author-role]");
  if (message) {
    message.setAttribute("data-message-author-role", role);
    message.setAttribute("data-message-id", syntheticId);
  }
};

const plainUserText = (parts) => parts
  .map((part) => part.markdown)
  .join("\n\n")
  .replace(/^\*Image '[^']+' not included in export \([^\n]+\)\.\*\s*/gm, "")
  .trim();

const assistantMarkdown = (parts) => parts
  .filter((part) => part.type === "markdown")
  .map((part) => part.markdown)
  .join("\n\n")
  .trim();

const assistantReferences = (parts) => parts
  .filter((part) => part.type === "markdown")
  .flatMap((part) => part.contentReferences || []);

const templates = [...sectionCandidates.values()];
const laterUserTemplate = templates.find(s => s.querySelector('.user-message-bubble-color .whitespace-pre-wrap') && !s.querySelector('[data-testid="library-file-icon"]'));
const assistantTemplate = templates.find(s => s.querySelector('[data-message-author-role="assistant"] .markdown'));
if (!laterUserTemplate || !assistantTemplate) throw new Error("Official message templates are missing.");

const buildUserSection = (turnNumber, message) => {
  const section = cloneIntoBase(laterUserTemplate);
  setTurnIdentity(section, turnNumber, "user");
  const content = section.querySelector(".user-message-bubble-color .whitespace-pre-wrap")
    || section.querySelector('[data-message-author-role="user"]');
  content.textContent = plainUserText(message.parts);
  appendUnavailableContent(content, message);
  return section;
};

const buildAssistantSection = (turnNumber, message) => {
  const section = cloneIntoBase(assistantTemplate);
  setTurnIdentity(section, turnNumber, "assistant");
  const markdownContainer = section.querySelector(".markdown.prose") || section.querySelector(".markdown");
  markdownContainer.innerHTML = renderAssistantMarkdown(
    baseDocument,
    assistantMarkdown(message.parts),
    {
      officialChartTemplates,
      officialCitations,
      generatedFiles,
      contentReferences: assistantReferences(message.parts),
    },
  );
  appendUnavailableContent(markdownContainer, message);
  return section;
};

function appendUnavailableContent(container, message) {
  for (const part of message.parts) {
    // Internal execution records remain in the source JSON, not the reader.
    if (part.type !== 'markdown') continue;
    const localResources = archivedResources.filter(r => r.status === 'downloaded' && r.message_ids.includes(part.id));
    for (const resource of localResources) {
      const link = baseDocument.createElement('a');
      link.href = `./archive-resources/${basename(resource.local_path)}`;
      link.setAttribute('download', resource.name);
      link.setAttribute('data-ceobe-local-resource', resource.key);
      link.textContent = resource.name;
      if (resource.mime_type?.startsWith('image/') && resource.mime_type !== 'image/svg+xml') {
        const image = baseDocument.createElement('img');
        image.src = link.href;
        image.alt = resource.name;
        image.style.cssText = 'max-width:100%;max-height:600px;object-fit:contain;border-radius:16px';
        link.replaceChildren(image);
      }
      // Replace the existing generated-file placeholder without changing its visual wrapper.
      const matches = [...container.querySelectorAll('[data-ceobe-generated-file]')]
        .filter(node => resource.pointers.includes(node.getAttribute('data-ceobe-generated-file')));
      if (matches.length) {
        for (const node of matches) { const replacement = link.cloneNode(true); replacement.className = node.className; node.replaceWith(replacement); }
      } else container.append(link);
    }
    for (const attachment of part.attachments) {
      if (localResources.some(r => r.key === assetKey(attachment))) continue;
      if (attachment.type === 'generated_file' && [...container.querySelectorAll('[data-ceobe-generated-file]')]
        .some(node => node.getAttribute('data-ceobe-generated-file') === attachment.pointer)) continue;
      const note = baseDocument.createElement('p');
      note.setAttribute('data-ceobe-unresolved-asset', '');
      note.className = 'text-token-text-secondary text-sm';
      note.textContent = '附件尚未关联本地资源：' + (attachment.name || attachment.filename || attachment.id || '附件');
      container.append(note);
    }
    for (const block of part.unsupported) {
      if (block.type === 'asset' && (part.attachments.some(a => assetKey(a) === assetKey(block)) || localResources.some(r => r.key === assetKey(block)))) continue;
      if (['model_editable_context', 'reasoning_recap', 'thoughts'].includes(block.type)) continue;
      const note = baseDocument.createElement('p');
      note.setAttribute('data-ceobe-unresolved-asset', '');
      note.className = 'text-token-text-secondary text-sm';
      note.textContent = `尚未接入的内容类型：${block.type || 'unknown'}（原始数据保留在 JSON 中）`;
      container.append(note);
    }
  }
}

const firstSection = baseDocument.querySelector('section[data-testid^="conversation-turn-"]');
const messageList = firstSection.parentElement.parentElement;
// No prompt rail, branch footer or captured message content survives into new data.
messageList.replaceChildren();
let reusedSections = 0;
for (const [index, message] of messages.entries()) {
  const turnNumber = index + 1;
  const captured = useSampleAssets
    ? message.parts.map(p => sectionCandidates.get(p.id)).find(Boolean)
    : null;
  const section = captured ? cloneIntoBase(captured)
    : message.role === "user" ? buildUserSection(turnNumber, message)
    : buildAssistantSection(turnNumber, message);
  if (captured) reusedSections += 1;
  setTurnIdentity(section, turnNumber, message.role);
  section.setAttribute("data-ceobe-message-ids", JSON.stringify(message.parts.map(p => p.id)));
  const wrapper = baseDocument.createElement("div");
  wrapper.setAttribute("data-turn-id-container", `ceobe-replay-turn-${turnNumber}`);
  wrapper.setAttribute("data-is-intersecting", "true");
  wrapper.append(section);
  messageList.append(wrapper);
}
baseDocument.querySelector("title").textContent = canonicalConversation.title;
const historyLinks = [...baseDocument.querySelectorAll('a[data-sidebar-item]')]
  .filter(link => /\/c\//.test(link.getAttribute('href') || ''));
if (library?.conversations?.length && historyLinks.length) {
  const parent = historyLinks[0].parentElement.parentElement;
  const activeTemplate = historyLinks.find(link => link.hasAttribute('data-active')) || historyLinks[0];
  const inactiveTemplate = historyLinks.find(link => !link.hasAttribute('data-active')) || historyLinks[0];
  for (const link of historyLinks) link.parentElement?.remove();
  for (const entry of library.conversations) {
    const template = entry.id === values['entry-id'] ? activeTemplate : inactiveTemplate;
    const item = cloneIntoBase(template.parentElement);
    const link = item.matches?.('a[data-sidebar-item]') ? item : item.querySelector('a[data-sidebar-item]');
    link.href = entry.page;
    link.setAttribute('aria-label', entry.title);
    link.toggleAttribute('data-active', entry.id === values['entry-id']);
    const label = link.querySelector('._NCija_content') || link;
    label.textContent = entry.title;
    parent.append(item);
  }
} else {
  for (const [index, link] of historyLinks.entries()) {
    if (index) { link.remove(); continue; }
    link.setAttribute('href', '#main');
    link.setAttribute('aria-label', canonicalConversation.title);
    const label = link.querySelector('._NCija_content') || link;
    label.textContent = canonicalConversation.title;
  }
}
const nestedPage = dirname(outputPage) !== outputRoot;
baseDocument.querySelector('[data-skip-to-content]')?.setAttribute('href', '#main');

// Keep the saved visual DOM and official styles, but disable the live ChatGPT
// application runtime. All controls remain visible and intentionally inert.
for (const script of [...baseDocument.querySelectorAll("script")]) script.remove();
// Saved preloads can fetch hundreds of live application chunks even after
// scripts are removed. They are not part of the offline reading interface.
for (const link of [...baseDocument.querySelectorAll('link')]) {
  if (/preload|prefetch|preconnect|dns-prefetch/.test(link.getAttribute('rel') || '') ||
    (/^https?:/.test(link.getAttribute('href') || '') && link.getAttribute('rel') !== 'stylesheet')) link.remove();
}
for (const frame of [...baseDocument.querySelectorAll("iframe")]) frame.remove();
for (const element of baseDocument.querySelectorAll("button, textarea, input")) {
  element.setAttribute("tabindex", "-1");
}
for (const [index, section] of [...messageList.querySelectorAll('section[data-testid^="conversation-turn-"]')].entries()) {
  attachCopyControls(section, messages[index].parts);
}

const staticStyle = baseDocument.createElement("style");
staticStyle.setAttribute("data-ceobe-static-replay", "");
staticStyle.textContent = `
  button, textarea, input { pointer-events: none !important; }
  button[data-ceobe-copy] { pointer-events: auto !important; }
  html { scroll-behavior: auto !important; }
  .ceobe-code-block .hljs-keyword, .ceobe-code-block .hljs-selector-tag, .ceobe-code-block .hljs-literal { color: #9c36b5; }
  .ceobe-code-block .hljs-string, .ceobe-code-block .hljs-attr { color: #067d17; }
  .ceobe-code-block .hljs-number, .ceobe-code-block .hljs-symbol { color: #1750eb; }
  .ceobe-code-block .hljs-title, .ceobe-code-block .hljs-built_in, .ceobe-code-block .hljs-type { color: #7a3e9d; }
  .ceobe-code-block .hljs-comment { color: #6a737d; font-style: italic; }
  .ceobe-table-actions { height: 32.6562px; }
  .ceobe-chart { margin-block: 1rem; padding: 1rem 1.25rem 1.2rem; border: 1px solid var(--token-border-light); border-radius: 1.5rem; background: var(--token-bg-primary); }
  .ceobe-chart-title { font-size: 1rem; font-weight: 600; }
  .ceobe-chart-description { margin-top: .2rem; color: var(--token-text-secondary); font-size: .875rem; }
  .ceobe-chart-body { display: grid; gap: .75rem; margin-top: 1rem; }
  .ceobe-chart-row { display: grid; grid-template-columns: minmax(3rem, auto) minmax(8rem, 1fr) 3rem; align-items: center; gap: .75rem; font-size: .875rem; }
  .ceobe-chart-track { height: .75rem; overflow: hidden; border-radius: 999px; background: var(--token-bg-secondary); }
  .ceobe-chart-bar { display: block; height: 100%; border-radius: inherit; background: #10a37f; }
  /* Captured Recharts dimensions belong to the original viewport. Keep its
     viewBox geometry, but fit the static SVG to the current reading column. */
  .chart-widget-container .recharts-wrapper { width: 100% !important; max-width: 100%; }
  .chart-widget-container .recharts-responsive-container > div { width: 100% !important; height: 100% !important; }
  .chart-widget-container .recharts-surface { width: 100%; height: 100%; }
`;
baseDocument.head.append(staticStyle);

const katexStylesheet = baseDocument.createElement("link");
katexStylesheet.setAttribute("rel", "stylesheet");
katexStylesheet.setAttribute("href", "./assets/katex.min.css");
baseDocument.head.append(katexStylesheet);

const existingStylesheets = new Set(
  [...baseDocument.querySelectorAll('link[rel="stylesheet"]')]
    .map((link) => basename(link.getAttribute("href") || "")),
);
const chartStylesheetNames = [...chartSnapshotDocument.querySelectorAll('link[rel="stylesheet"]')]
  .map((link) => basename(link.getAttribute("href") || ""))
  .filter((name) => /^(?:react-|chart-widget-container-|WidgetRenderer-)/.test(name));
for (const stylesheetName of chartStylesheetNames) {
  if (existingStylesheets.has(stylesheetName)) continue;
  const link = baseDocument.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", `./assets/${stylesheetName}`);
  baseDocument.head.append(link);
  existingStylesheets.add(stylesheetName);
}

if (!values['preserve-output']) await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputAssets, { recursive: true });
await mkdir(join(outputRoot, 'archive-resources'), { recursive: true });
for (const [path, bytes] of resourceBytes) await writeFile(join(outputRoot, 'archive-resources', basename(path)), bytes);
// Vite does not emit plain download anchors as bundled assets. Keep these
// public copies so the production build retains every archived download too.
await mkdir(join(outputRoot, 'public', 'archive-resources'), { recursive: true });
for (const [path, bytes] of resourceBytes) await writeFile(join(outputRoot, 'public', 'archive-resources', basename(path)), bytes);
await mkdir(outputOfficialAssets, { recursive: true });
await cp(join(katexDistribution, "katex.min.css"), join(outputAssets, "katex.min.css"));
await cp(join(katexDistribution, "fonts"), join(outputAssets, "fonts"), { recursive: true });

for (const spriteName of officialSpriteNames) {
  await cp(
    join(officialAssetsRoot, spriteName),
    join(outputOfficialAssets, spriteName),
  );
}
await cp(join(officialAssetsRoot, officialFontName), join(outputAssets, officialFontName));

const copiedFiles = new Set();
for (const snapshotName of snapshotNames) {
  const resourceName = `${basename(snapshotName, ".html")}_files`;
  const resourceDirectory = join(testRoot, resourceName);
  for (const entry of await readdir(resourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || copiedFiles.has(entry.name)) continue;
    if (!useSampleAssets && !entry.name.endsWith('.css') && !baseDocument.documentElement.outerHTML.includes(entry.name)) continue;
    await cp(join(resourceDirectory, entry.name), join(outputAssets, entry.name));
    copiedFiles.add(entry.name);
  }
}
for (const filename of copiedFiles) {
  if (!filename.endsWith('.css')) continue;
  const path = join(outputAssets, filename);
  const css = await readFile(path, 'utf8');
  await writeFile(path, css.replaceAll(
    'https://cdn.openai.com/common/fonts/openai-sans/v4/OpenAISans-Semibold.woff2',
    './OpenAISans-Semibold.woff2',
  ));
}

const chartResourceDirectory = join(
  chartSnapshotRoot,
  `${basename(chartSnapshotName, ".html")}_files`,
);
for (const entry of await readdir(chartResourceDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || copiedFiles.has(entry.name)) continue;
  if (!useSampleAssets && !entry.name.endsWith('.css') && !baseDocument.documentElement.outerHTML.includes(entry.name)) continue;
  await cp(join(chartResourceDirectory, entry.name), join(outputAssets, entry.name));
  copiedFiles.add(entry.name);
}

if (useSampleAssets) await buildFilePreviews(baseDocument, projectRoot, outputRoot, canonicalConversation);
await buildSourcesPanel(baseDocument, projectRoot, outputRoot, canonicalConversation, snapshotDocuments.map(s => s.document));
await cp(join(projectRoot, 'scripts/clipboard.js'), join(outputRoot, 'clipboard.js'));
const clipboardScript = baseDocument.createElement('script');
clipboardScript.type = 'module';
clipboardScript.src = './clipboard.js';
baseDocument.body.append(clipboardScript);
await cp(join(chartResourceDirectory, 'favicons'), join(outputAssets, 'favicons.png'));

let output = `<!DOCTYPE html>\n${htmlSafeSvg(baseDocument.documentElement.outerHTML)}`;
for (const snapshotName of snapshotNames) {
  output = output.replaceAll(`./${basename(snapshotName, ".html")}_files/`, "./assets/");
}
if (nestedPage) output = output.replaceAll('href="./', 'href="../').replaceAll('src="./', 'src="../');


await mkdir(dirname(outputPage), { recursive: true });
await writeFile(outputPage, output, "utf8");

console.log([
  `Built official replay from CEOBE JSON and ${snapshotNames[0]}.`,
  `${messages.length} logical conversation messages restored.`,
  `${reusedSections} captured sample sections reused (only with --sample-assets).`,
  `${copiedFiles.size} local resources collected.`,
  `${officialSpriteNames.length} official icon sprites restored.`,
].join("\n"));
