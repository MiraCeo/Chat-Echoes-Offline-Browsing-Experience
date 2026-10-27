import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationToHtmlView } from './conversation-to-html-view.mjs';
import { turnTarget, turnText } from './bookmark-targets.mjs';
import { KINDS } from './search-query.mjs';

export const SEARCH_INDEX_FILE = 'search-index.json';
export const SEARCH_INDEX_KIND = 'ceobe.search-index';

const mimeOf = value => String(value?.mime_type || value?.mime || '').toLocaleLowerCase();
// 索引文本把换行折成了空格（与 bookmarks 摘要同口径），所以表格只能按“折叠后仍保留的
// 分隔行形态”识别：| --- | --- | 这一串短横线是表格最稳的特征。
const TABLE_SEPARATOR = /\|[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?/;
const TABLE_HTML = /<table[\s>]/i;
const IMAGE_MARKDOWN = /!\[[^\]]*\]\([^)]*\)/;

/**
 * 一个可见回复块对公支持的“类型标签”，供搜索的 has: 语法使用。
 * 只描述阅读页真的显示出来的东西：代码块、Markdown/HTML 表格、图片（附件、素材块或
 * 正文里的 ![]()）与任何附件；audio 目前只为将来留位（当前档案里没有音频）。
 */
export function turnKinds(turn, text) {
  const blocks = turn.entries.flatMap(entry => entry.message.content?.blocks || []);
  const attachments = turn.entries.flatMap(entry => entry.message.attachments || []);
  const kinds = new Set();
  if (blocks.some(block => block.type === 'code')) kinds.add('code');
  if (TABLE_SEPARATOR.test(text) || TABLE_HTML.test(text)) kinds.add('table');
  if (attachments.some(asset => mimeOf(asset).startsWith('image/'))
    || blocks.some(block => block.type === 'asset' && (block.asset_type === 'image' || mimeOf(block).startsWith('image/')))
    || IMAGE_MARKDOWN.test(text)) kinds.add('image');
  if (attachments.length || blocks.some(block => block.type === 'asset')) kinds.add('attachment');
  if (attachments.some(asset => mimeOf(asset).startsWith('audio/'))) kinds.add('audio');
  // 固定顺序，序列化与测试都不受 Set 插入顺序影响。
  return KINDS.filter(kind => kinds.has(kind));
}

// One record per rendered turn, keyed by the same canonical message ID that
// bookmarks anchor to, so a body hit can reuse the exact jump (#bookmark=<id>).
// Only what the reader shows is indexed: user prompts and final assistant
// replies (text and code blocks). Reasoning, hidden context, citations and tool
// traffic are excluded, as are attachment names and images.
export function indexConversation(conversation) {
  return conversationToHtmlView(conversation).flatMap((turn, order) => {
    const { text } = turnText(turn);
    if (!text) return [];
    const target = turnTarget(turn, order);
    return [{ message_id: target.message_id, role: target.role, order, text, kinds: turnKinds(turn, text) }];
  });
}

export function buildSearchIndex(entries) {
  return {
    schema_version: '1.0.0',
    kind: SEARCH_INDEX_KIND,
    conversations: entries.map(({ id, conversation }) => ({ id, turns: indexConversation(conversation) })),
  };
}

// Titles are deliberately absent: the dialog takes them from the live catalog
// (/api/chats or the page snapshot) so renames never need an index rebuild.
export async function writeSearchIndex(root, library) {
  const entries = [];
  for (const c of library.conversations)
    entries.push({ id: c.id, conversation: JSON.parse(await readFile(join(root, c.conversation_path), 'utf8')) });
  const index = buildSearchIndex(entries);
  const dir = join(root, 'replay', 'public');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SEARCH_INDEX_FILE), JSON.stringify(index));
  const turns = index.conversations.reduce((n, c) => n + c.turns.length, 0);
  const tagged = index.conversations.reduce((n, c) => n + c.turns.filter(turn => turn.kinds.length).length, 0);
  console.log(`Search index: ${index.conversations.length} conversations, ${turns} turns (${tagged} with kinds).`);
  return index;
}
