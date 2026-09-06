const isToolImage = message => message.role === 'tool'
  && (message.content?.blocks || []).some(block => block.type === 'asset' && block.asset_type === 'image');

export function htmlMessageKind(message) {
  const contentType = message.content?.type;
  if (message.role === 'user') return 'user';
  if (isToolImage(message)) return 'media';
  if (['reasoning_recap', 'thoughts'].includes(contentType)) return 'activity';
  if (contentType === 'model_editable_context') return 'context';
  if (message.role === 'assistant'
    && (!message.recipient || message.recipient === 'all')
    && (!message.channel || message.channel === 'final')) return 'document';
  return 'tool_call';
}

const isHtmlVisible = message => message.visible !== false
  && (['user', 'assistant'].includes(message.role) || isToolImage(message));

/**
 * Build the typed turn stream consumed by the offline HTML renderer.
 *
 * This projection deliberately retains each canonical message object. It does
 * not serialize messages to Markdown; Markdown is only used later for textual
 * content blocks inside a message.
 */
export function conversationToHtmlView(conversation) {
  if (!conversation || typeof conversation.title !== 'string' || !conversation.messages || !Array.isArray(conversation.linear_message_ids)) {
    throw new Error('Expected CEOBE JSON with title, messages and linear_message_ids.');
  }

  const turns = [];
  const seen = new Set();
  for (const id of conversation.linear_message_ids) {
    if (seen.has(id)) throw new Error(`Repeated message in linear_message_ids: ${id}`);
    seen.add(id);
    const source = conversation.messages[id];
    if (!source) throw new Error(`Missing message referenced by linear_message_ids: ${id}`);
    if (!isHtmlVisible(source)) continue;
    // Canonical imports always contain message.id. Keep a non-mutating fallback
    // for older hand-authored CEOBE JSON and test fixtures.
    const message = source.id == null ? { ...source, id } : source;

    const role = isToolImage(source) ? 'assistant' : source.role;
    const entry = { id, kind: htmlMessageKind(message), message };
    const previous = turns.at(-1);
    if (role === 'assistant' && previous?.role === 'assistant') previous.entries.push(entry);
    else turns.push({ role, entries: [entry] });
  }
  return turns;
}
