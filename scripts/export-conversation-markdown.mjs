import { parseHTML } from 'linkedom';
import { markdownTextOnly } from './markdown-text-only.mjs';
import { conversationToMarkdownView } from './conversation-to-markdown-view.mjs';
import { messageCopyContent } from './copy-controls.mjs';
import { buildFrontmatter, buildSourcesSection, collectSources, convertMath, isoLocal } from './markdown-vault.mjs';

const pad2 = value => String(value).padStart(2, '0');
// 本地时区的 YYYY-MM-DD HH:mm:ss；时间来自消息自身的 created_at（epoch 秒）。
const formatStamp = seconds => {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};
// 长文件里助手正文自带的 # 标题会和文档标题抢层级；统一降两级，代码块内的 # 不动。
const demoteHeadings = (text, levels = 2) => {
  let fenced = false;
  return text.split('\n').map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    const match = /^(#{1,6})(\s+)/.exec(line);
    if (!match) return line;
    return '#'.repeat(Math.min(6, match[1].length + levels)) + line.slice(match[1].length);
  }).join('\n');
};

export function exportConversationMarkdown(conversation, {textOnly=false, timestamps=false, frontmatter=false, math=false, sources=false, project=''} = {}) {
  const { document } = parseHTML('<html><body></body></html>');
  const output = [];
  if (frontmatter) {
    const block = buildFrontmatter({
      title: conversation.title,
      chatId: conversation.id,
      url: conversation.source?.url,
      project,
      created: isoLocal(conversation.created_at ?? conversation.metadata?.create_time),
      updated: isoLocal(conversation.updated_at ?? conversation.metadata?.update_time),
      model: conversation.metadata?.default_model_slug,
    });
    if (block) output.push(block.trimEnd(), '');
  }
  output.push(`# ${conversation.title.replace(/[\r\n]/g, ' ')}`, '',
    textOnly ? '> 纯文本 Markdown：仅包含当前阅读分支，不包含附件或外部资源。' : '> 本文件为当前阅读分支的 Markdown 副本；完整消息树、内部记录和原始字段保留在 conversation.ceobe.json。', '');
  const turns = conversationToMarkdownView(conversation);
  // "第 N 段" markers: the outline stays the same, but a reader can search a turn number or see it
  // while scrolling. Counted per assistant reply, so one Q&A is one 段.
  const totalExchanges = turns.filter(turn => turn.role === 'assistant').length;
  let exchange = 0;
  let previousDay = '';
  for (const turn of turns) {
    const parts = turn.parts.filter(part => part.type === 'markdown');
    if (!parts.length) continue;
    output.push(`## ${turn.role === 'user' ? 'User' : 'Assistant'}`, '');
    // 时间线：只在显式要求时输出（下载通道），快照里的 conversation.md 保持原样。
    if (timestamps) {
      const stamp = Number.isFinite(turn.createdAt) ? formatStamp(turn.createdAt) : '';
      if (stamp) {
        // 同一天只在第一条消息上写日期，其余只写时分秒；跨天时日期重新出现。
        const day = stamp.slice(0, 10);
        const label = day === previousDay ? stamp.slice(11) : stamp;
        previousDay = day;
        output.push(`*${label} · 第 ${exchange + 1} 段 / 共 ${totalExchanges} 段*`, '');
      }
    }
    // Separate reference definition scopes so repeated [1] definitions cannot collide.
    for (const part of parts) {
      const prefix = `ref-${part.id.replace(/[^a-zA-Z0-9-]/g, '')}-`;
      let text = messageCopyContent([part], document, prefix).text;
      if (math) text = convertMath(text);
      if (turn.role === 'assistant') text = demoteHeadings(text);
      const partResources = (conversation.resources || []).filter(resource => resource.message_ids.includes(part.id));
      if (textOnly) { output.push(markdownTextOnly(text, partResources).trim(), ''); continue; }
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
    // Marker after each exchange (one user question + its answer), so a long file stays locatable.
    if (turn.role === 'assistant') {
      exchange += 1;

    }
  }
  if (sources) {
    const section = buildSourcesSection(collectSources(conversation));
    if (section) output.push(section);
  }
  return textOnly ? markdownTextOnly(output.join('\n')) : output.join('\n');
}
