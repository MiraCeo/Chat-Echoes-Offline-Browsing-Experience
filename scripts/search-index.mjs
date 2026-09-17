import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationToHtmlView } from './conversation-to-html-view.mjs';
import { turnTarget, turnText } from './bookmark-targets.mjs';

export const SEARCH_INDEX_FILE = 'search-index.json';
export const SEARCH_INDEX_KIND = 'ceobe.search-index';

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
    return [{ message_id: target.message_id, role: target.role, order, text }];
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
  console.log(`Search index: ${index.conversations.length} conversations, ${turns} turns.`);
  return index;
}
