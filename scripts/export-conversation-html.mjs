/**
 * Single-file HTML export for phone reading.
 *
 * A PDF is fixed layout: fitting an A4 page into a phone screen shrinks the text to ~6px. This export
 * produces one self-contained HTML file instead — reflowable text at a readable size, no external
 * stylesheet, images embedded as data URIs (within a budget), openable from a chat app or file manager.
 *
 * Usage:
 *   node scripts/export-conversation-html.mjs --input <conversation.ceobe.json> [--output x.html] [--max-image-bytes 12000000]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';
import { marked } from 'marked';
import { messageComponents, collectInlineComponents, inlineComponentMarkdown } from './dil-inline-components.mjs';

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/i;

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 18px 16px 48px; font: 17px/1.75 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
       color: #1a1a1a; background: #fff; max-width: 46rem; margin-inline: auto; overflow-wrap: break-word; }
header { margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #e6e6e6; }
header h1 { font-size: 20px; line-height: 1.4; margin: 0 0 6px; }
header p { margin: 0; font-size: 13px; color: #6b6b6b; }
.turn { margin: 0 0 26px; }
.turn.user { display: flex; justify-content: flex-end; }
.bubble { background: #f2f4f7; border-radius: 22px; border-end-end-radius: 6px; padding: 10px 16px; max-width: 85%; white-space: pre-wrap; }
.answer > :first-child { margin-top: 0; }
.answer > :last-child { margin-bottom: 0; }
h2 { font-size: 19px; line-height: 1.45; margin: 26px 0 10px; }
h3 { font-size: 17px; margin: 20px 0 8px; }
p { margin: 0 0 14px; }
ul, ol { margin: 0 0 14px; padding-inline-start: 1.4em; }
li { margin: 0 0 6px; }
blockquote { margin: 0 0 14px; padding: 2px 0 2px 14px; border-inline-start: 3px solid #d8d8d8; color: #4a4a4a; }
pre { margin: 0 0 16px; padding: 12px 14px; background: #f6f7f9; border-radius: 12px; overflow-x: auto; font: 13.5px/1.6 ui-monospace, Consolas, monospace; }
code { font: 13.5px/1.6 ui-monospace, Consolas, monospace; background: #f0f1f3; padding: 1px 5px; border-radius: 5px; }
pre code { background: none; padding: 0; border-radius: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 15px; display: block; overflow-x: auto; }
th, td { border: 1px solid #e2e2e2; padding: 6px 10px; text-align: start; vertical-align: top; }
th { background: #f6f7f9; font-weight: 600; }
img { max-width: 100%; height: auto; border-radius: 12px; display: block; margin: 0 0 14px; }
a { color: #0b63c5; }
hr { border: 0; border-top: 1px solid #e6e6e6; margin: 22px 0; }
.chip { display: inline-block; font-size: 13px; color: #5b5b5b; background: #f1f2f4; border: 1px solid #e2e2e2; border-radius: 999px; padding: 0 8px; margin-inline-start: 4px; }
.attach { font-size: 13px; color: #5b5b5b; margin: 0 0 10px; }
footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e6e6e6; font-size: 12px; color: #8a8a8a; }
@media (prefers-color-scheme: dark) {
  body { color: #e8e8e8; background: #17181a; }
  header, footer, hr { border-color: #2c2e31; }
  .bubble { background: #24262a; }
  pre { background: #1e2023; }
  code { background: #24262a; }
  th { background: #1e2023; }
  th, td { border-color: #2c2e31; }
  blockquote { border-color: #3a3d41; color: #b8b8b8; }
  a { color: #77b6ff; }
  .chip { background: #24262a; border-color: #2c2e31; color: #b8b8b8; }
}
`;

/** Markdown → HTML for one message, with the same inline-component handling the reader uses. */
export const renderMessageMarkdown = (message) => {
  const blocks = message.content?.blocks || [];
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text || '');
    else if (block.type === 'code') {
      const fence = '`'.repeat(Math.max(3, ...[...(block.text || '').matchAll(/`+/g)].map(match => match[0].length + 1)));
      parts.push(`${fence}${block.language || ''}\n${block.text || ''}\n${fence}`);
    }
  }
  let source = parts.join('\n\n');
  const components = collectInlineComponents(source, { components: messageComponents(message), message });
  const definitions = new Map();
  for (const component of [...components].sort((left, right) => right.start - left.start)) {
    source = source.slice(0, component.start) + inlineComponentMarkdown(component, { definitions }) + source.slice(component.end);
  }
  const document_ = parseHTML('<html><body></body></html>').document;
  const html = marked.parse(source, { gfm: true, breaks: true });
  const holder = document_.createElement('div');
  holder.innerHTML = html;
  for (const link of holder.querySelectorAll('a[href]')) {
    const href = (link.getAttribute('href') || '').replace(/[\u0000-\u0020]/g, '');
    if (!/^(https?:|mailto:)/i.test(href)) link.removeAttribute('href');
    else { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); }
  }
  return holder.innerHTML;
};

const dataUri = async (file, mime) => `data:${mime};base64,${(await readFile(file)).toString('base64')}`;

/**
 * Build a self-contained document. Images are embedded until the budget is spent; anything beyond it
 * stays a plain note so the file never balloons past what a chat app will happily open.
 */
export async function exportConversationHtml(conversation, { resources = [], baseDir = process.cwd(), maxImageBytes = 12 * 1024 * 1024 } = {}) {
  const messages = conversation.messages || {};
  const order = conversation.linear_message_ids || [];
  let embedded = 0;
  let skipped = 0;
  const turns = [];
  for (const id of order) {
    const message = messages[id];
    if (!message || message.visible === false) continue;
    if (message.role === 'user') {
      const text = message.content?.blocks?.filter(block => block.type === 'text').map(block => block.text || '').join('\n\n').trim();
      const files = (message.attachments || []).filter(asset => asset.name).map(asset => asset.name);
      const images = [];
      for (const resource of resources) {
        if (!resource.message_ids?.includes(id) || !IMAGE_TYPES.test(resource.mime_type || '') || resource.status !== 'downloaded') continue;
        if (embedded + (resource.bytes || 0) > maxImageBytes) { skipped += 1; continue; }
        try {
          const uri = await dataUri(join(baseDir, resource.local_path), resource.mime_type);
          embedded += resource.bytes || 0;
          images.push(`<img src="${uri}" alt="${escapeHtml(resource.name || '图片')}">`);
        } catch { skipped += 1; }
      }
      const body = [text ? `<div class="bubble">${escapeHtml(text)}</div>` : '', ...images,
        files.length ? `<p class="attach">附件：${files.map(escapeHtml).join('、')}</p>` : ''].filter(Boolean).join('');
      turns.push(`<div class="turn user">${body}</div>`);
      continue;
    }
    if (message.role !== 'assistant') continue;
    const content = renderMessageMarkdown(message);
    if (!content.trim()) continue;
    turns.push(`<div class="turn"><div class="answer">${content}</div></div>`);
  }
  const created = conversation.created_at ? new Date(conversation.created_at * 1000).toISOString().slice(0, 10) : '';
  const title = escapeHtml(conversation.title || '本地聊天');
  const meta = [created, conversation.source?.url ? '本地归档' : '', `${turns.filter(turn => turn.includes('turn user')).length} 轮`].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${title}</h1><p>${escapeHtml(meta)}</p></header>
<main>
${turns.join('\n')}
</main>
<footer>CEOBE 本地归档导出${skipped ? ` · ${skipped} 张图片超过体积上限未内嵌` : ''}</footer>
</body>
</html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    output: { type: 'string' },
    'max-image-bytes': { type: 'string' },
  } });
  if (!values.input) {
    console.error('Usage: node scripts/export-conversation-html.mjs --input <conversation.ceobe.json> [--output x.html] [--max-image-bytes 12000000]');
    process.exitCode = 2;
  } else {
    const input = resolve(values.input);
    const conversation = JSON.parse(await readFile(input, 'utf8'));
    const baseDir = dirname(input);
    const resources = (conversation.resources || []).filter(resource => resource.local_path);
    const html = await exportConversationHtml(conversation, {
      resources,
      baseDir,
      maxImageBytes: values['max-image-bytes'] ? Number(values['max-image-bytes']) : undefined,
    });
    const output = resolve(values.output || `${conversation.id || 'conversation'}.html`);
    await writeFile(output, html, 'utf8');
    console.log(`${output} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
  }
}
