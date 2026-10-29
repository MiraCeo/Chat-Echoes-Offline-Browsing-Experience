import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationToHtmlView } from './conversation-to-html-view.mjs';
import { turnTarget } from './bookmark-targets.mjs';

export const TIMELINE_INDEX_FILE = 'timeline-index.json';
export const TIMELINE_INDEX_KIND = 'ceobe.timeline-index';
export const TIMELINE_INDEX_VERSION = '1.0.0';
export const TIMELINE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pad = value => String(value).padStart(2, '0');
const MODEL_LABELS = {
  'gpt-6-thinking': 'GPT-6 Thinking',
  'gpt-5-6-thinking': 'GPT-5.6 Thinking',
  'gpt-5-6': 'GPT-5.6',
  'gpt-5-5': 'GPT-5.5',
  'gpt-5-4-auto-thinking': 'GPT-5.4 Auto Thinking',
  'gpt-6.1-sol-wm': 'GPT-6.1 Sol',
  'gpt-6': 'GPT-6',
};
const modelLabel = slug => MODEL_LABELS[slug] || String(slug).replace(/^gpt-/i, 'GPT-').replace(/-/g, ' ');
const visibleText = entry => (Array.isArray(entry?.message?.content?.blocks)
  ? entry.message.content.blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
  : '');
const charCount = text => [...text.replace(/\s+/g, '')].length;
// 时间线按构建机本地时区分组；把 IANA 时区写进索引，页面用同一时区格式化，
// 这样把静态产物拿到别的时区浏览也不会出现“日期天数与 days 桶不一致”。
const localDay = seconds => {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * 一个会话的时间线投影：只看阅读页可见的轮次（提问与最终回复/生成的图片），
 * 隐藏记录、推理、工具往来都不进时间线。返回首末时间、锚点消息 ID 与每日轮数。
 */
export function conversationTimeline(conversation) {
  const days = {};
  const modelCounts = new Map();
  let first = null, last = null, firstMessage = null, lastMessage = null;
  let turns = 0, rounds = 0, undated = 0;
  let userChars = 0, assistantChars = 0;
  conversationToHtmlView(conversation).forEach((turn, order) => {
    const target = turnTarget(turn, order);
    const primary = turn.entries.find(entry => entry.kind === 'document')
      || turn.entries.find(entry => entry.kind === 'user')
      || turn.entries.find(entry => entry.kind === 'media')
      || turn.entries[0];
    const seconds = Number(primary?.message?.created_at);
    turns += 1;
    if (turn.entries.some(entry => entry.message?.role === 'user')) rounds += 1;
    for (const entry of turn.entries) {
      if (entry.kind === 'user') {
        userChars += charCount(visibleText(entry));
      } else if (entry.kind === 'document' || entry.kind === 'media') {
        assistantChars += charCount(visibleText(entry));
        const metadata = entry.message?.metadata || {};
        const model = metadata.resolved_model_slug || metadata.model_slug || metadata.default_model_slug;
        if (model) {
          const label = modelLabel(model);
          modelCounts.set(label, (modelCounts.get(label) || 0) + 1);
        }
      }
    }
    if (!Number.isFinite(seconds) || seconds <= 0) { undated += 1; return; }
    if (first == null || seconds < first) { first = seconds; firstMessage = target.message_id; }
    if (last == null || seconds >= last) { last = seconds; lastMessage = target.message_id; }
    const day = localDay(seconds);
    days[day] = (days[day] || 0) + 1;
  });
  const models = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([model]) => model);
  return {
    first,
    last,
    first_message_id: firstMessage,
    last_message_id: lastMessage,
    turns,
    rounds,
    undated,
    days,
    models,
    primary_model: models[0] || '',
    user_chars: userChars,
    assistant_chars: assistantChars,
  };
}

export function buildTimelineIndex(entries) {
  const conversations = entries.map(({ id, conversation }) => ({ id, ...conversationTimeline(conversation) }));
  return {
    schema_version: TIMELINE_INDEX_VERSION,
    kind: TIMELINE_INDEX_KIND,
    timezone: TIMELINE_TIMEZONE,
    conversations,
  };
}

/** 标题不放进索引（跟搜索索引同一口径）：页面从 chats.json 取当前标题，重命名无需重建。 */
export async function writeTimelineIndex(root, library) {
  const entries = [];
  for (const conversation of library.conversations) {
    entries.push({
      id: conversation.id,
      conversation: JSON.parse(await readFile(join(root, conversation.conversation_path), 'utf8')),
    });
  }
  const index = buildTimelineIndex(entries);
  const dir = join(root, 'replay', 'public');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, TIMELINE_INDEX_FILE), JSON.stringify(index));
  const turns = index.conversations.reduce((sum, item) => sum + item.turns, 0);
  console.log(`Timeline index: ${index.conversations.length} conversations, ${turns} visible turns.`);
  return index;
}
