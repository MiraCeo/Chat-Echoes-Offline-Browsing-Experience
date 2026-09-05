export function conversationToView(conversation) {
  if (!conversation || typeof conversation.title !== 'string' || !conversation.messages || !Array.isArray(conversation.linear_message_ids)) {
    throw new Error('Expected CEOBE JSON with title, messages and linear_message_ids.');
  }
  const messages = [];
  const seen = new Set();
  for (const id of conversation.linear_message_ids) {
    if (seen.has(id)) throw new Error(`Repeated message in linear_message_ids: ${id}`);
    seen.add(id);
    const source = conversation.messages[id];
    if (!source) throw new Error(`Missing message referenced by linear_message_ids: ${id}`);
    const content = source.content || {};
    const blocks = content.blocks || [];
    const toolImage = source.role === 'tool' && blocks.some(b => b.type === 'asset' && b.asset_type === 'image');
    if (source.visible === false || (!['user', 'assistant'].includes(source.role) && !toolImage)) continue;
    const displayRole = toolImage ? 'assistant' : source.role;
    const markdown = blocks.map(block => {
      if (block.type === 'text') return block.text || '';
      if (['file_citation', 'web_citation', 'widget', 'url', 'embedded_reference'].includes(block.type)) return block.raw || '';
      if (block.type === 'code') {
        const fence = '`'.repeat(Math.max(3, ...[...(block.text || '').matchAll(/`+/g)].map(m => m[0].length + 1)));
        return `${fence}${block.language || ''}\n${block.text || ''}\n${fence}`;
      }
      return '';
    }).join('');
    const activity = ['reasoning_recap', 'thoughts'].includes(content.type);
    const type = activity ? 'activity' : toolImage || source.role === 'user' || (!source.recipient || source.recipient === 'all') && (!source.channel || source.channel === 'final') ? 'markdown' : 'tool';
    const raw = content.raw || {};
    const part = {
      id, type,
      markdown: activity ? raw.content || (raw.thoughts || []).map(t => t.summary || t.content || '').join('\n') : markdown,
      contentReferences: source.content_references || [],
      attachments: source.attachments || [],
      unsupported: blocks.filter(b => !['text','code','file_citation','web_citation','widget','url','embedded_reference'].includes(b.type)),
    };
    const last = messages.at(-1);
    if (displayRole === 'assistant' && last?.role === 'assistant') last.parts.push(part);
    else messages.push({ role: displayRole, parts: [part] });
  }
  return messages;
}
