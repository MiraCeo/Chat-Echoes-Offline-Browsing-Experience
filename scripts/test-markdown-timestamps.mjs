// 下载通道的 Markdown 带时间线，快照里的 conversation.md 不带：两者必须互不影响。
import assert from 'node:assert/strict';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';
import { conversationToMarkdownView } from './conversation-to-markdown-view.mjs';

const stampLine = /^\*(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\*$/;
const base = 1792591756; // 任意固定的 epoch 秒，断言只关心"有没有"和顺序

const conversation = {
  title: '时间线样本',
  messages: {
    m1: { role: 'user', visible: true, created_at: base, content: { blocks: [{ type: 'text', text: '第一条提问' }] } },
    m2: { role: 'assistant', visible: true, created_at: base + 90, content: { blocks: [{ type: 'text', text: '第一条回答' }] } },
    m3: { role: 'user', visible: true, created_at: base + 600, content: { blocks: [{ type: 'text', text: '第二条提问' }] } },
    m4: { role: 'assistant', visible: true, created_at: base + 660, content: { blocks: [{ type: 'text', text: '第二条回答' }] } },
  },
  linear_message_ids: ['m1', 'm2', 'm3', 'm4'],
};

// 视图层要把消息时间带出来，否则导出函数拿不到。
const turns = conversationToMarkdownView(conversation);
assert.equal(turns.length, 4);
assert.deepEqual(turns.map(turn => turn.createdAt), [base, base + 90, base + 600, base + 660], '每个 turn 带消息时间');

// 默认导出（快照里的 conversation.md）不含时间行。
const plain = exportConversationMarkdown(conversation);
assert.ok(!plain.split('\n').some(line => stampLine.test(line.trim())), '默认导出不含时间行');

// 显式要求时，每条可见消息前有一行本地时间。
const timed = exportConversationMarkdown(conversation, { timestamps: true });
const timeLines = timed.split('\n').map(line => line.trim()).filter(line => stampLine.test(line));
assert.equal(timeLines.length, 4, '四条可见消息各一行时间');

// 时间行紧跟在标题之后，且正文仍在。
const lines = timed.split('\n');
const headingIndex = lines.findIndex(line => line.startsWith('## User'));
assert.ok(headingIndex >= 0, '有 User 标题');
const afterHeading = lines.slice(headingIndex + 1).find(line => line.trim());
assert.ok(stampLine.test(afterHeading.trim()), '标题后的第一行是时间');
assert.ok(timed.includes('第一条提问') && timed.includes('第二条回答'), '正文没有被破坏');

// 文本模式同样带时间，便于直接粘贴。
const textOnly = exportConversationMarkdown(conversation, { textOnly: true, timestamps: true });
assert.ok(textOnly.split('\n').some(line => stampLine.test(line.trim())), '文本模式也带时间行');

console.log('Markdown 时间线: 默认不输出、显式开启后每条可见消息一行、标题后紧跟、正文不破坏。');
