import { parseHTML } from 'linkedom';
import { conversationToMarkdownView } from './conversation-to-markdown-view.mjs';
import { messageCopyContent } from './copy-controls.mjs';

export function exportConversationMarkdown(conversation) {
  const { document } = parseHTML('<html><body></body></html>');
  const output = [`# ${conversation.title.replace(/[\r\n]/g, ' ')}`, '',
    '> 本文件为当前阅读分支的 Markdown 副本；完整消息树、内部记录和原始字段保留在 conversation.ceobe.json。', ''];
  for (const turn of conversationToMarkdownView(conversation)) {
    const parts = turn.parts.filter(part => part.type === 'markdown');
    if (!parts.length) continue;
    output.push(`## ${turn.role === 'user' ? 'User' : 'Assistant'}`, '');
    // Separate reference definition scopes so repeated [1] definitions cannot collide.
    for (const part of parts) {
      const prefix = `ref-${part.id.replace(/[^a-zA-Z0-9-]/g, '')}-`;
      let text = messageCopyContent([part], document, prefix).text;
      const partResources = (conversation.resources || []).filter(resource => resource.message_ids.includes(part.id));
      const represented = new Set();
      for (const resource of partResources) {
        for (const pointer of resource.pointers || []) {
          if (!pointer || !text.includes(pointer)) continue;
          if (resource.status === 'downloaded') text = text.replaceAll(pointer, resource.local_path);
          else {
            const escaped = pointer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp(`\\[([^\\]]+)\\]\\(${escaped}\\)`, 'g'), '$1');
          }
          represented.add(resource.key);
        }
      }
      output.push(text.trim(), '');
      for (const resource of partResources) {
        if (represented.has(resource.key) && resource.status === 'downloaded') continue;
        if (!resource.message_ids.includes(part.id)) continue;
        const name = resource.name.replace(/[\[\]\\\r\n]/g, ' ');
        if (resource.status === 'downloaded') {
          output.push(`${resource.mime_type?.startsWith('image/') ? '!' : ''}[${name}](${resource.local_path})`, '');
        } else output.push(`> 附件未保存：${name}（${resource.status}；详见 import-report.json）`, '');
      }
    }
  }
  return output.join('\n');
}
