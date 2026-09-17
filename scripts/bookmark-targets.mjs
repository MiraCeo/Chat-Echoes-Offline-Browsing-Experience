import { conversationToHtmlView } from './conversation-to-html-view.mjs';
// The renderer combines adjacent assistant records into one visible reply block.
// Anchor to a canonical message ID, never the synthetic turn number or scroll offset.
// Visible text of one rendered turn: user prompts and final assistant replies only.
// Reasoning, hidden context, citations and tool traffic never reach the reader,
// so they must not reach bookmark excerpts or the search index either.
export function turnText(turn) {
  const visible = turn.entries.filter((e) => ['document', 'user'].includes(e.kind));
  const text = visible
    .flatMap((e) =>
      (e.message.content?.blocks || [])
        .filter((b) => ['text', 'code'].includes(b.type))
        .map((b) => b.text || ''),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const names = turn.entries
    .flatMap((e) => (e.message.attachments || []).map((a) => a.name || a.filename || ''))
    .filter(Boolean)
    .join('、');
  return { text, names };
}
export function turnTarget(turn, order) {
  const primary =
    turn.entries.find((e) => e.kind === 'document') ||
    turn.entries.find((e) => e.kind === 'user') ||
    turn.entries.find((e) => e.kind === 'media') ||
    turn.entries[0];
  const { text, names } = turnText(turn);
  return {
    message_id: primary.id,
    message_ids: turn.entries.map((e) => e.id),
    role: turn.role,
    order,
    excerpt: (
      text ||
      names ||
      (turn.entries.some((e) => e.kind === 'media') ? '生成的图片' : '无文本消息')
    ).slice(0, 320),
  };
}
export function bookmarkTargets(conversation) {
  return conversationToHtmlView(conversation).map((turn, order) => turnTarget(turn, order));
}
