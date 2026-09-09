import { restoreKatexFonts, localizeGeneratedFonts } from './local-katex-fonts.mjs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from 'node:crypto';
import { prepareLocalSidebar } from './local-sidebar.mjs';
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readArchivedResource, assetKey, resourceMatches } from './archive-resources.mjs';
import { marked, Renderer } from "marked";
import { renderAssistantMarkdown } from "./render-markdown.mjs";
import { createOfficialCitations } from "./official-citations.mjs";
import { buildFilePreviews } from "./build-file-previews.mjs";
import { conversationToHtmlView } from "./conversation-to-html-view.mjs";
import { parseArgs } from "node:util";
import { htmlSafeSvg } from './serialize-html.mjs';
import { createGeneratedFiles } from './generated-files.mjs';
import { attachCopyControls } from './copy-controls.mjs';
import { buildSourcesPanel } from './build-sources-panel.mjs';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';

const projectRoot = resolve(import.meta.dirname, "..");
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
const turns = conversationToHtmlView(canonicalConversation);
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
marked.setOptions({ gfm: true, breaks: true });

const officialTemplates = await loadOfficialTemplatePackage(projectRoot);
const baseDocument = officialTemplates.document;
if(values['entry-id'])baseDocument.body.dataset.readerChatId=values['entry-id'];
baseDocument.documentElement.setAttribute('data-ceobe-render-source', 'canonical-json');
baseDocument.documentElement.setAttribute('data-ceobe-structured-payload-status', canonicalConversation.completeness?.structured_payload?.status || 'unknown');
baseDocument.documentElement.setAttribute('data-ceobe-source-dom-status', canonicalConversation.completeness?.rendered_dom?.status || 'unknown');
const officialCitations = createOfficialCitations([officialTemplates.templateDocument]);
const officialChart = officialTemplates.clone('widget:chart');
const officialTableTemplate = officialTemplates.templates['markdown:table'];
const generatedFiles = createGeneratedFiles(officialTemplates.templateDocument);
const officialChartTemplates = {};
if (officialChart) {
  const title = officialChart.querySelector("section")?.getAttribute("aria-label");
  if (title) {
    officialChartTemplates[title] = htmlSafeSvg(officialChart.outerHTML)
      .replaceAll("sprites-core-ff27b486.svg", "sprites-core-26c3f2d4.svg")
      .replaceAll("sprites-shell-45f921f2.svg", "sprites-shell-097001e7.svg");
  }
}
// Match optional captured visual assets by message identity, never by turn number.
const sectionCandidates = new Map();
if (useSampleAssets) {
  const sampleSections = JSON.parse(await readFile(join(dirname(canonicalConversationPath), 'official-sections.json'), 'utf8'));
  for (const [id, source] of Object.entries(sampleSections)) {
    const holder = baseDocument.createElement('div');
    holder.innerHTML = htmlSafeSvg(source);
    sectionCandidates.set(id, holder.firstElementChild);
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

const blockMarkdown = (block) => {
  if (block.type === 'text') return block.text || '';
  if (['file_citation', 'web_citation', 'widget', 'url', 'embedded_reference'].includes(block.type)) return block.raw || '';
  if (block.type === 'code') {
    const fence = '`'.repeat(Math.max(3, ...[...(block.text || '').matchAll(/`+/g)].map(match => match[0].length + 1)));
    return `${fence}${block.language || ''}\n${block.text || ''}\n${fence}`;
  }
  return '';
};

const recordMarkdown = (message) => (message.content?.blocks || []).map(blockMarkdown).join('');

const plainUserText = (entries) => entries
  .filter(entry => entry.kind === 'user')
  .map(entry => recordMarkdown(entry.message))
  .join("\n\n")
  .replace(/^\*Image '[^']+' not included in export \([^\n]+\)\.\*\s*/gm, "")
  .trim();

const renderUserText = (source) => {
  const renderer = new Renderer();
  renderer.html = token => String(token.text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const holder = baseDocument.createElement('div');
  holder.innerHTML = htmlSafeSvg(marked.parse(source, { renderer, gfm: true, breaks: true }));
  for (const link of holder.querySelectorAll('a[href]')) {
    const href = (link.getAttribute('href') || '').replace(/[\u0000-\u0020]/g, '');
    if (!/^(https?:|mailto:)/i.test(href)) link.removeAttribute('href');
    else {
      link.className = 'font-medium [&&]:underline [&&]:decoration-current [&&]:underline-offset-2 [&&]:hover:no-underline';
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return htmlSafeSvg(holder.innerHTML);
};

const assistantMarkdown = (entries) => entries
  .filter(entry => entry.kind === 'document')
  .map(entry => recordMarkdown(entry.message))
  .join("\n\n")
  .trim();

const assistantReferences = (entries) => entries
  .filter(entry => entry.kind === 'document')
  .flatMap(entry => entry.message.content_references || []);

// Copying is an output concern of the HTML page. This adapter is intentionally
// local and does not become the input model used to construct the DOM.
const copyParts = (entries) => entries
  .filter(entry => entry.kind === 'user' || entry.kind === 'document')
  .map(({ message }) => ({
    id: message.id,
    type: 'markdown',
    markdown: recordMarkdown(message),
    contentReferences: message.content_references || [],
  }));

const laterUserTemplate = officialTemplates.clone('message:user');
const assistantTemplate = officialTemplates.clone('message:assistant');
const stoppedThinkingTemplate = officialTemplates.clone('message:stopped-thinking');
const generatedImageTemplate = officialTemplates.clone('message:generated-image');
const branchFooterTemplate = officialTemplates.clone('message:branch-footer');
const userImageTemplates = new Map([
  [1, officialTemplates.clone('message:user-images-1')],
  [3, officialTemplates.clone('message:user-images-3')],
]);
const fileTileTemplates = new Map(['document', 'pdf', 'text', 'xls']
  .map(key => [key, officialTemplates.clone(`message:file-tile-${key}`)]));
const fileTileRowTemplate = officialTemplates.clone('message:file-tile-row');

const resourcesForMessage = (messageId) => archivedResources.filter(resource => resource.message_ids.includes(messageId));
const downloadedResourceForMessage = (messageId, mimePrefix = '') => resourcesForMessage(messageId)
  .find(resource => resource.status === 'downloaded' && (!mimePrefix || resource.mime_type?.startsWith(mimePrefix)));

const fileIconKey = (attachment) => {
  const mime = attachment.mime_type || '';
  const extension = attachment.name?.split('.').pop()?.toLowerCase();
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mime.includes('spreadsheet') || ['xls', 'xlsx', 'csv'].includes(extension)) return 'xls';
  if (mime.includes('wordprocessingml') || ['doc', 'docx'].includes(extension)) return 'document';
  if (mime.startsWith('text/') || ['txt', 'md', 'log'].includes(extension)) return 'text';
  return fileTileTemplates.has(extension) ? extension : 'document';
};

const fileTypeLabel = (attachment) => {
  const key = fileIconKey(attachment);
  if (key === 'pdf') return 'PDF';
  if (key === 'xls') return '电子表格';
  return '文档';
};

const buildFileTile = (attachment, messageId) => {
  const template = fileTileTemplates.get(fileIconKey(attachment)) || fileTileTemplates.get('document');
  const tile = cloneIntoBase(template);
  tile.setAttribute('aria-label', attachment.name);
  tile.setAttribute('data-ceobe-attachment-id', attachment.id || '');
  tile.querySelector('button[aria-label]')?.setAttribute('aria-label', attachment.name);
  const labelBox = [...tile.querySelectorAll('.overflow-hidden')].at(-1);
  const labels = labelBox?.children || [];
  if (labels[0]) labels[0].textContent = attachment.name;
  if (labels[1]) labels[1].textContent = fileTypeLabel(attachment);
  const resource = resourcesForMessage(messageId).find(item => resourceMatches(item, attachment));
  if (resource?.status === 'downloaded') {
    tile.setAttribute('data-ceobe-local-resource', resource.key);
    tile.setAttribute('data-ceobe-download', `./archive-resources/${basename(resource.local_path)}`);
  } else {
    tile.setAttribute('data-ceobe-resource-status', resource?.status || 'unresolved');
  }
  return tile;
};

const appendFileTiles = (section, entries) => {
  const userMessage = section.querySelector('[data-message-author-role="user"]');
  const stack = userMessage?.firstElementChild;
  const bubble = stack?.querySelector('.user-message-bubble-color')?.parentElement;
  if (!stack || !bubble) return;
  for (const entry of entries) {
    const attachments = (entry.message.attachments || []).filter(attachment =>
      attachment.type !== 'generated_file' && attachment.type !== 'image' && !attachment.mime_type?.startsWith('image/'));
    if (!attachments.length) continue;
    const row = cloneIntoBase(fileTileRowTemplate);
    row.replaceChildren(...attachments.map(attachment => buildFileTile(attachment, entry.id)));
    stack.insertBefore(row, bubble);
  }
};

const appendUserImages = (section, entries) => {
  const userMessage = section.querySelector('[data-message-author-role="user"]');
  const stack = userMessage?.firstElementChild;
  const bubble = stack?.querySelector('.user-message-bubble-color')?.parentElement;
  if (!stack || !bubble) return;
  for (const entry of entries) {
    const attachments = (entry.message.attachments || [])
      .filter(attachment => attachment.type !== 'generated_file' && attachment.type !== 'image_asset_pointer' && attachment.mime_type?.startsWith('image/'));
    if (!attachments.length) continue;
    const template = userImageTemplates.get(attachments.length);
    if (!template) continue;
    const imageRow = cloneIntoBase(template);
    const images = [...imageRow.querySelectorAll('[class~="group/message-image"] img')];
    const buttons = [...imageRow.querySelectorAll('[class~="group/message-image"] button')];
    for (const [index, attachment] of attachments.entries()) {
      const image = images[index];
      const button = buttons[index];
      const resource = resourcesForMessage(entry.id).find(item => resourceMatches(item, attachment) && item.status === 'downloaded');
      if (!image || !resource) continue;
      image.src = `./archive-resources/${basename(resource.local_path)}`;
      image.alt = attachment.name;
      image.width = attachment.width || image.width;
      image.height = attachment.height || image.height;
      image.classList.remove('opacity-0');
      image.classList.add('opacity-100');
      image.setAttribute('data-ceobe-local-resource', resource.key);
      if (button) {
        button.setAttribute('aria-label', attachments.length === 1
          ? `打开图片：${attachment.name}`
          : `打开第 ${index + 1} 张（共 ${attachments.length} 张）图片：${attachment.name}`);
      }
    }
    stack.insertBefore(imageRow, bubble);
  }
};

const appendBranchFooter = (section, entries) => {
  const branch = entries.map(entry => entry.message.metadata || {}).find(metadata => metadata.branching_from_conversation_id);
  if (!branch) return;
  const footer = cloneIntoBase(branchFooterTemplate);
  const paragraph = [...footer.querySelectorAll('p')].find(p => /建立的分支/.test(p.textContent));
  const link = paragraph?.querySelector('a');
  if (!paragraph || !link) return;
  link.textContent = branch.branching_from_conversation_title || '原对话';
  link.href = `https://chatgpt.com/c/${branch.branching_from_conversation_id}`;
  paragraph.replaceChildren(baseDocument.createTextNode('从 '), link, baseDocument.createTextNode(' 建立的分支'));
  const agentTurn = section.querySelector('.agent-turn');
  // In the official DOM the branch divider is a sibling of the agent turn.
  // Nesting it inside `.agent-turn` makes its flex width collapse to the label.
  if (agentTurn?.parentElement) agentTurn.after(footer);
};

const buildStoppedThinkingSection = (turnNumber, turn) => {
  const section = cloneIntoBase(stoppedThinkingTemplate);
  setTurnIdentity(section, turnNumber, 'assistant');
  const entry = turn.entries.find(item => item.kind === 'activity');
  const label = entry?.message.content?.raw?.content
    || entry?.message.content?.blocks?.find(block => block.type === 'reasoning_recap')?.data?.content
    || '已停止思考';
  const button = [...section.querySelectorAll('button')].find(item => item.textContent.trim() === '已停止思考');
  if (button) {
    for (const child of [...button.childNodes]) if (child.nodeType === 3) child.remove();
    button.insertBefore(baseDocument.createTextNode(label), button.firstChild);
  }
  return section;
};

const buildGeneratedImageSection = (turnNumber, turn) => {
  const section = cloneIntoBase(generatedImageTemplate);
  setTurnIdentity(section, turnNumber, 'assistant');
  const entry = turn.entries.find(item => item.kind === 'media');
  const resource = entry && downloadedResourceForMessage(entry.id, 'image/');
  const block = entry?.message.content?.blocks?.find(item => item.type === 'asset' && item.asset_type === 'image');
  const dimensions = block?.raw?.metadata?.generation || block?.raw || {};
  const title = entry?.message.metadata?.image_gen_title || resource?.name || '图片';
  const imageRoot = section.querySelector('[class~="group/imagegen-image"]');
  const primaryImage = section.querySelector('img[alt^="已生成图片"]');
  const imageId = `ceobe-generated-image-${entry?.id || turnNumber}`;
  if (imageRoot) imageRoot.id = `image-${entry?.id || turnNumber}`;
  if (primaryImage) {
    primaryImage.id = imageId;
    primaryImage.alt = `已生成图片：${title}`;
  }
  section.querySelector('[aria-labelledby]')?.setAttribute('aria-labelledby', imageId);
  if (resource) {
    const source = `./archive-resources/${basename(resource.local_path)}`;
    for (const image of section.querySelectorAll('img')) {
      image.src = source;
      image.removeAttribute('srcset');
      image.setAttribute('data-ceobe-local-resource', resource.key);
      if (dimensions.width) image.width = dimensions.width;
      if (dimensions.height) image.height = dimensions.height;
    }
  }
  return section;
};

const buildUserSection = (turnNumber, message) => {
  const section = cloneIntoBase(laterUserTemplate);
  setTurnIdentity(section, turnNumber, "user");
  const content = section.querySelector(".user-message-bubble-color .markdown.prose")
    || section.querySelector(".user-message-bubble-color .whitespace-pre-wrap")
    || section.querySelector('[data-message-author-role="user"]');
  content.innerHTML = renderUserText(plainUserText(message.entries));
  appendUserImages(section, message.entries);
  appendFileTiles(section, message.entries);
  appendUnavailableContent(content, message, { skipFileAttachments: true, skipImages: true });
  return section;
};

const buildAssistantSection = (turnNumber, message) => {
  const section = cloneIntoBase(assistantTemplate);
  setTurnIdentity(section, turnNumber, "assistant");
  const markdownContainer = section.querySelector(".markdown.prose") || section.querySelector(".markdown");
  markdownContainer.innerHTML = renderAssistantMarkdown(
    baseDocument,
    assistantMarkdown(message.entries),
    {
      officialChartTemplates,
      officialTableTemplate,
      officialCitations,
      generatedFiles,
      contentReferences: assistantReferences(message.entries),
    },
  );
  appendUnavailableContent(markdownContainer, message);
  appendBranchFooter(section, message.entries);
  return section;
};

function appendUnavailableContent(container, message, { skipFileAttachments = false, skipImages = false } = {}) {
  for (const { message: record } of message.entries) {
    // Internal execution records remain in the source JSON, not the reader.
    const localResources = archivedResources.filter(r => r.status === 'downloaded' && r.message_ids.includes(record.id));
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
      } else if (resource.mime_type?.startsWith('image/') && !skipImages) container.append(link);
    }
    for (const block of record.content?.blocks || []) {
      if (['text','code','file_citation','web_citation','widget','url','embedded_reference'].includes(block.type)) continue;
      if (block.type === 'asset' && ((record.attachments || []).some(a => assetKey(a) === assetKey(block)) || localResources.some(r => r.key === assetKey(block)))) continue;
      if (['model_editable_context', 'reasoning_recap', 'thoughts'].includes(block.type)) continue;
      const note = baseDocument.createElement('p');
      note.setAttribute('data-ceobe-unresolved-asset', '');
      note.className = 'text-token-text-secondary text-sm';
      note.textContent = `尚未接入的内容类型：${block.type || 'unknown'}（原始数据保留在 JSON 中）`;
      container.append(note);
    }
  }
}

const messageList = baseDocument.querySelector('[data-ceobe-message-list]');
if (!messageList) throw new Error('Official shell message list is missing.');
// No prompt rail, branch footer or captured message content survives into new data.
messageList.replaceChildren();
let reusedSections = 0;
for (const [index, message] of turns.entries()) {
  const turnNumber = index + 1;
  const captured = useSampleAssets
    ? message.entries.map(entry => sectionCandidates.get(entry.id)).find(Boolean)
    : null;
  const isStoppedThinking = message.entries.some(entry => entry.kind === 'activity' && entry.message.metadata?.reasoning_status === 'reasoning_cancelled')
    && !message.entries.some(entry => entry.kind === 'document');
  const hasGeneratedImage = message.entries.some(entry => entry.kind === 'media');
  const section = captured ? cloneIntoBase(captured)
    : message.role === "user" ? buildUserSection(turnNumber, message)
    : hasGeneratedImage ? buildGeneratedImageSection(turnNumber, message)
    : isStoppedThinking ? buildStoppedThinkingSection(turnNumber, message)
    : buildAssistantSection(turnNumber, message);
  if (captured) reusedSections += 1;
  setTurnIdentity(section, turnNumber, message.role);
  section.setAttribute("data-ceobe-message-ids", JSON.stringify(message.entries.map(entry => entry.id)));
  section.setAttribute("data-ceobe-content-types", JSON.stringify(message.entries.map(entry => entry.message.content?.type || null)));
  section.setAttribute("data-ceobe-message-kinds", JSON.stringify(message.entries.map(entry => entry.kind)));
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
baseDocument.documentElement.setAttribute('data-ceobe-render-source', 'canonical-json');
for (const [index, section] of [...messageList.querySelectorAll('section[data-testid^="conversation-turn-"]')].entries()) {
  attachCopyControls(section, copyParts(turns[index].entries));
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
const chartStylesheetNames = officialTemplates.manifest.chart_stylesheets;
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
await restoreKatexFonts(projectRoot,outputRoot);

for (const spriteName of officialSpriteNames) {
  await cp(
    join(officialAssetsRoot, spriteName),
    join(outputOfficialAssets, spriteName),
  );
}
await cp(join(officialAssetsRoot, officialFontName), join(outputAssets, officialFontName));
await cp(outputOfficialAssets,join(outputRoot,'public/cdn/assets'),{recursive:true});

const copiedFiles = new Set();
for (const entry of await readdir(join(officialTemplates.root, 'assets'), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  await cp(join(officialTemplates.root, 'assets', entry.name), join(outputAssets, entry.name));
  copiedFiles.add(entry.name);
}

const availablePreviewFiles = await buildFilePreviews(
  baseDocument,
  projectRoot,
  outputRoot,
  canonicalConversation,
  officialTemplates,
  dirname(canonicalConversationPath),
  useSampleAssets,
);
await buildSourcesPanel(baseDocument, projectRoot, outputRoot, canonicalConversation, officialTemplates);
for (const opener of baseDocument.querySelectorAll('[data-ceobe-open-preview]')) {
  const key = opener.getAttribute('data-ceobe-open-preview');
  const previewFile = availablePreviewFiles.get(key);
  if (!previewFile) {
    opener.removeAttribute('data-ceobe-open-preview');
    opener.removeAttribute('data-ceobe-preview-file');
  } else opener.setAttribute('data-ceobe-preview-file', previewFile);
}
await cp(join(projectRoot, 'scripts/clipboard.js'), join(outputRoot, 'clipboard.js'));
const clipboardScript = baseDocument.createElement('script');
clipboardScript.type = 'module';
clipboardScript.src = './clipboard.js';
baseDocument.body.append(clipboardScript);
await cp(join(projectRoot, 'scripts/link-import.js'), join(outputRoot, 'link-import.js'));
await cp(join(projectRoot, 'scripts/link-import.css'), join(outputRoot, 'link-import.css'));
const importStylesheet = baseDocument.createElement('link');
importStylesheet.rel = 'stylesheet';
importStylesheet.href = './link-import.css';
baseDocument.head.append(importStylesheet);
const importScript = baseDocument.createElement('script');
importScript.type = 'module';
importScript.src = './link-import.js';
baseDocument.body.append(importScript);
// A local initials avatar never depends on an external or missing profile image.
for (const image of baseDocument.querySelectorAll('img[alt="个人资料图片"]')) {
  const avatar = baseDocument.createElement('span');
  avatar.className = 'ceobe-local-avatar';
  avatar.setAttribute('role', 'img');
  avatar.setAttribute('aria-label', '本地用户头像 MC');
  avatar.textContent = 'MC';
  image.replaceWith(avatar);
}
// Regeneration replaces the replay directory. Content-version local controls
// so a running dev server cannot serve stale transformed JS or CSS.
for (const element of baseDocument.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
  const attribute = element.localName === 'script' ? 'src' : 'href';
  const path = element.getAttribute(attribute);
  if (!/^\.\/[^/]+\.(js|css)$/.test(path || '')) continue;
  const hash = createHash('sha256').update(await readFile(join(outputRoot, path))).digest('hex').slice(0, 12);
  element.setAttribute(attribute, `${path}?v=${hash}`);
}
prepareLocalSidebar(baseDocument);
let output = `<!DOCTYPE html>\n${htmlSafeSvg(baseDocument.documentElement.outerHTML)}`;
if (nestedPage) output = output.replaceAll('href="./', 'href="../').replaceAll('src="./', 'src="../');


await localizeGeneratedFonts(outputRoot);
await mkdir(dirname(outputPage), { recursive: true });
await writeFile(outputPage, output, "utf8");

console.log([
  `Built official replay from CEOBE JSON and official template package v${officialTemplates.manifest.version}.`,
  `${turns.length} typed conversation turns restored directly from CEOBE JSON.`,
  `${reusedSections} captured sample sections reused (only with --sample-assets).`,
  `${copiedFiles.size} official template assets copied.`,
  `${officialSpriteNames.length} official icon sprites restored.`,
].join("\n"));
