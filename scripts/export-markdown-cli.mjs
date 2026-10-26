#!/usr/bin/env node
/**
 * 批量/单条导出 Obsidian-ready Markdown：
 *   npm run export:md -- --all --out D:\vault\ceobe
 *   npm run export:md -- --id <chat-id> --out <dir> [--no-assets] [--link-style wikilink]
 *
 * 只读 archive/：Markdown 写到 --out，附件复制到 <out>/attachments/。
 */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';
import { markdownFilename } from './markdown-filename.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean', default: false },
    id: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    'no-assets': { type: 'boolean', default: false },
    'link-style': { type: 'string', default: 'markdown' },
    'no-timestamps': { type: 'boolean', default: false },
  },
});
const linkStyle = values['link-style'];
if (!['markdown', 'wikilink'].includes(linkStyle)) throw new Error('--link-style 只能是 markdown 或 wikilink');
if (!values.out) throw new Error('需要 --out <目录>；例如：npm run export:md -- --all --out D:\\vault\\ceobe');
const outDir = resolve(values.out);
// 测试可以在隔离副本里跑：CEOBE_ROOT 指向一个临时工作区（含 archive/ 与 data/private/）。
const root = process.env.CEOBE_ROOT ? resolve(process.env.CEOBE_ROOT) : resolve(import.meta.dirname, '..');

const library = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8'));
const projectFile = await readFile(join(root, 'data/private/projects.ceobe.json'), 'utf8').then(JSON.parse).catch(() => ({ projects: [] }));
const projects = Array.isArray(projectFile.projects) ? projectFile.projects : [];

for (const id of [...values.id, ...positionals]) {
  if (!library.conversations.some(entry => entry.id === id)) throw new Error(`聊天不存在：${id}`);
}
const wanted = values.all
  ? library.conversations
  : library.conversations.filter(entry => values.id.includes(entry.id) || positionals.includes(entry.id));
if (!wanted.length) throw new Error(values.all ? '本地档案里还没有会话' : '没有匹配的聊天：用 --all 或 --id <chat-id> 指定');

const attachmentDir = join(outDir, 'attachments');
await mkdir(outDir, { recursive: true });
if (!values['no-assets']) await mkdir(attachmentDir, { recursive: true });

const safeName = name => String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

async function placeAttachment(sourcePath, displayName) {
  const base = safeName(displayName);
  const extension = extname(base);
  const stem = extension ? base.slice(0, -extension.length) : base;
  const digest = await sha256(sourcePath);
  let target = base;
  const destination = join(attachmentDir, target);
  let existing = null;
  try { existing = await sha256(destination); } catch { /* 还没有这个文件 */ }
  if (existing && existing !== digest) target = `${stem}-${digest.slice(0, 8)}${extension}`;
  if (!existing || existing !== digest) await copyFile(sourcePath, join(attachmentDir, target));
  return target;
}

const usedFilenames = new Map();
const written = [];
for (const entry of wanted) {
  const conversationPath = resolve(root, entry.conversation_path);
  const conversation = JSON.parse(await readFile(conversationPath, 'utf8'));
  conversation.title = entry.title;
  conversation.id = entry.id;
  const folder = dirname(conversationPath);
  const project = projects.find(item => (item.conversation_ids || []).includes(entry.id))?.name || '';

  // 先放附件，再把正文里的 assets/<name> 换成最终文件名。
  const mapping = new Map();
  if (!values['no-assets']) {
    for (const resource of conversation.resources || []) {
      if (resource.status !== 'downloaded' || !resource.local_path) continue;
      const sourcePath = resolve(folder, resource.local_path);
      if (relative(folder, sourcePath).startsWith('..')) continue;
      try { await stat(sourcePath); } catch { continue; }
      const stored = await placeAttachment(sourcePath, resource.name || resource.local_path.split('/').at(-1));
      mapping.set(resource.local_path, stored);
    }
  }

  let markdown = exportConversationMarkdown(conversation, {
    textOnly: values['no-assets'],
    timestamps: !values['no-timestamps'],
    frontmatter: true,
    math: true,
    sources: true,
    project,
  });
  for (const [original, stored] of mapping) {
    const pattern = new RegExp(`(!?)\\[([^\\]]*)\\]\\(${original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
    markdown = markdown.replace(pattern, (_, bang, label) => linkStyle === 'wikilink'
      ? `${bang}[[${stored}]]`
      : `${bang}[${label}](attachments/${encodeURI(stored)})`);
  }

  let filename = markdownFilename(entry.title);
  if (usedFilenames.has(filename)) {
    const count = usedFilenames.get(filename) + 1;
    usedFilenames.set(filename, count);
    filename = filename.replace(/\.md$/i, ` (${count}).md`);
  } else usedFilenames.set(filename, 1);
  await writeFile(join(outDir, filename), markdown, 'utf8');
  written.push({ id: entry.id, filename, attachments: mapping.size });
}

const totalAttachments = written.reduce((sum, item) => sum + item.attachments, 0);
console.log(`Exported ${written.length} conversation(s) to ${outDir}${values['no-assets'] ? '（不含附件）' : `，附件链接 ${totalAttachments} 处`}.`);
for (const item of written) console.log(`  ${item.filename}`);
