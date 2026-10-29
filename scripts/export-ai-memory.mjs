import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { conversationToHtmlView } from './conversation-to-html-view.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const outDir = resolve(option('--out', join(projectRoot, 'ai-memory', 'input')));
const pad = value => String(value).padStart(2, '0');
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const timeLabel = seconds => {
  const values = {};
  for (const part of formatter.formatToParts(new Date(seconds * 1000))) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
};

const blockText = block => {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text' && typeof block.text === 'string') return block.text.trim();
  if (block.type === 'asset') {
    const name = block.name || block.alt_text || block.asset_type || '资源';
    return `[资源: ${name}]`;
  }
  if (block.type === 'web_citation') {
    return block.title ? `[引用: ${block.title}]` : '';
  }
  if (block.type === 'embedded_reference') {
    const name = block.title || block.name || block.reference_type;
    return name ? `[嵌入引用: ${name}]` : '';
  }
  return '';
};

const attachmentText = message => {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!attachments.length) return '';
  return attachments.map(attachment => {
    const name = attachment.name || attachment.id || '附件';
    return `[附件: ${name}${attachment.mime_type ? ` (${attachment.mime_type})` : ''}]`;
  }).join('\n');
};

const cleanText = text => text
  .replace(/FileCite\b[^\n]*?\/>/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const messageText = (entry, role) => {
  const blocks = entry.message.content?.blocks;
  const parts = Array.isArray(blocks)
    ? blocks.map(blockText).filter(Boolean)
    : [];
  const attachments = attachmentText(entry.message);
  const text = cleanText([parts.join('\n\n'), attachments].filter(Boolean).join('\n\n'));
  return text || `（此${role === '用户' ? '用户' : '助手'}消息没有可导出的文本）`;
};

const sourceHash = records => 'sha256:' + createHash('sha256')
  .update(JSON.stringify(records))
  .digest('hex');

const clearOutput = async () => {
  await mkdir(join(outDir, 'conversations'), { recursive: true });
  await rm(join(outDir, 'manifest.json'), { force: true });
  for (const name of await readdir(join(outDir, 'conversations'))) {
    if (name.endsWith('.md')) await unlink(join(outDir, 'conversations', name));
  }
};

const [library, timelineIndex, catalog] = await Promise.all([
  readFile(join(projectRoot, 'replay', 'library.ceobe.json'), 'utf8').then(JSON.parse),
  readFile(join(projectRoot, 'replay', 'public', 'timeline-index.json'), 'utf8').then(JSON.parse),
  readFile(join(projectRoot, 'replay', 'chats.json'), 'utf8').then(JSON.parse),
]);
if (library?.kind !== 'ceobe.library' || !Array.isArray(library.conversations)) {
  throw new Error('replay/library.ceobe.json 不是 ceobe.library');
}
if (timelineIndex?.kind !== 'ceobe.timeline-index' || !Array.isArray(timelineIndex.conversations)) {
  throw new Error('replay/public/timeline-index.json 不是 ceobe.timeline-index');
}

const titles = new Map((catalog?.chats || []).map(chat => [chat.id, chat.title]));
const timeline = new Map(timelineIndex.conversations.map(item => [item.id, item]));
const entries = [];
const skipped = [];
const failures = [];

await clearOutput();
for (const conversation of library.conversations) {
  const item = timeline.get(conversation.id);
  const title = titles.get(conversation.id) || conversation.title || '未命名会话';
  if (!item || !Number.isFinite(item.first) || !Number.isFinite(item.last)) {
    skipped.push({ id: conversation.id, reason: '没有有日期的可见轮次' });
    continue;
  }
  let turns;
  try {
    const source = JSON.parse(await readFile(join(projectRoot, conversation.conversation_path), 'utf8'));
    turns = conversationToHtmlView(source);
  } catch (error) {
    failures.push({ id: conversation.id, error: error?.message || String(error) });
    continue;
  }

  const records = [];
  let userIndex = 0;
  let assistantIndex = 0;
  const sections = [];
  for (const turn of turns) {
    for (const entry of turn.entries) {
      if (!['user', 'document', 'media'].includes(entry.kind)) continue;
      const role = entry.kind === 'user' ? '用户' : '助手';
      if (role === '用户') userIndex += 1;
      else assistantIndex += 1;
      const seconds = Number(entry.message.created_at);
      const label = Number.isFinite(seconds) ? timeLabel(seconds) : '时间未知';
      const text = messageText(entry, role);
      records.push({
        message_id: entry.id,
        role: role === '用户' ? 'user' : 'assistant',
        created_at: Number.isFinite(seconds) ? seconds : null,
        text,
      });
      sections.push(`## ${role} ${role === '用户' ? userIndex : assistantIndex} · ${label}\n\n${text}`);
    }
  }

  if (!records.length) {
    skipped.push({ id: conversation.id, reason: '没有可导出的用户/助手正文' });
    continue;
  }
  const hash = sourceHash({
    id: conversation.id,
    messages: records,
  });
  const source = {
    id: conversation.id,
    title,
    first: item.first,
    last: item.last,
    rounds: item.rounds,
    turns: item.turns,
    last_message_id: item.last_message_id || records.at(-1).message_id,
    source_hash: hash,
    file: `conversations/${conversation.id}.md`,
  };
  const markdown = [
    '---',
    `id: ${JSON.stringify(source.id)}`,
    `title: ${JSON.stringify(source.title)}`,
    `first: ${source.first}`,
    `last: ${source.last}`,
    `rounds: ${source.rounds}`,
    `turns: ${source.turns}`,
    `last_message_id: ${JSON.stringify(source.last_message_id)}`,
    `source_hash: ${JSON.stringify(source.source_hash)}`,
    '---',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
  await writeFile(join(outDir, 'conversations', `${conversation.id}.md`), markdown, 'utf8');
  entries.push(source);
}

entries.sort((a, b) => a.first - b.first);
const manifest = {
  schema_version: '1.0.0',
  kind: 'ceobe.memory-input',
  generated_at: new Date().toISOString(),
  timezone,
  conversations: entries,
};
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`AI memory export: ${entries.length} conversation(s) -> ${outDir}`);
console.log(`Messages: ${manifest.conversations.reduce((sum, item) => sum + item.turns, 0)} visible turns represented.`);
if (skipped.length) {
  console.log(`Skipped: ${skipped.length}`);
  for (const item of skipped) console.log(`- ${item.id}: ${item.reason}`);
}
if (failures.length) {
  console.log(`Failed: ${failures.length}`);
  for (const item of failures) console.log(`- ${item.id}: ${item.error}`);
  process.exitCode = 1;
}
