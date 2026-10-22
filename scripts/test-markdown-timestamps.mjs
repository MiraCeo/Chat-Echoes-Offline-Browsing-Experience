// 下载通道的 Markdown 时间线：默认不带，开启后每条可见消息一行；同一天只在首条写日期。
// 同时钉住两条排版约定：助手正文标题降两级、不再输出尾随的「（第 N 段对话，共 M 段）」。
import assert from 'node:assert/strict';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';
import { conversationToMarkdownView } from './conversation-to-markdown-view.mjs';

const fullStamp = /^\*(\d{4}-\d\d-\d\d) (\d\d):(\d\d):(\d\d) · 第 (\d+) 段 \/ 共 (\d+) 段\*$/;
const clockOnly = /^\*(\d\d):(\d\d):(\d\d) · 第 (\d+) 段 \/ 共 (\d+) 段\*$/;

const base = 1792591756; // 固定 epoch 秒，断言只关心格式与顺序
const conversation = {
  title: '时间线样本',
  messages: {
    m1: { role: 'user', visible: true, created_at: base, content: { blocks: [{ type: 'text', text: '第一条提问' }] } },
    m2: {
      role: 'assistant', visible: true, created_at: base + 90,
      content: { blocks: [{ type: 'text', text: '# 大标题\n\n正文段落\n\n```bash\n# 这是代码注释，不是标题\nls\n```' }] },
    },
    m3: { role: 'user', visible: true, created_at: base + 600, content: { blocks: [{ type: 'text', text: '第二条提问' }] } },
    m4: { role: 'assistant', visible: true, created_at: base + 660, content: { blocks: [{ type: 'text', text: '第二条回答' }] } },
  },
  linear_message_ids: ['m1', 'm2', 'm3', 'm4'],
};

const turns = conversationToMarkdownView(conversation);
assert.equal(turns.length, 4);
assert.deepEqual(turns.map(turn => turn.createdAt), [base, base + 90, base + 600, base + 660], '每个 turn 带消息时间');

// 默认导出（老快照的 conversation.md 形态）不含时间行，也不含尾随段号。
const plain = exportConversationMarkdown(conversation);
assert.ok(!plain.split('\n').some(line => fullStamp.test(line.trim()) || clockOnly.test(line.trim())), '默认导出不含时间行');
assert.ok(!plain.includes('段对话，共'), '不再输出尾随的段号标记');

// 显式要求时间线时：首条带日期，同日其余只写时分秒。
const timed = exportConversationMarkdown(conversation, { timestamps: true });
const stamps = timed.split('\n').map(line => line.trim()).filter(line => fullStamp.test(line) || clockOnly.test(line));
assert.equal(stamps.length, 4, '四条可见消息各一行时间');
assert.match(stamps[0], fullStamp, '第一条带完整日期');
assert.match(stamps[1], clockOnly, '同一天的第二条只写时刻');
assert.match(stamps[3], clockOnly, '同一天内不重复日期');
assert.equal(stamps[0].match(fullStamp)[5], '1', '第一段编号为 1');
assert.equal(stamps[3].match(clockOnly)[4], '2', '最后一段编号为 2');
assert.equal(stamps[3].match(clockOnly)[5], '2', '总段数为 2');

// 时间行紧跟在标题之后，正文完好。
const lines = timed.split('\n');
const headingIndex = lines.findIndex(line => line.startsWith('## User'));
assert.ok(headingIndex >= 0, '有 User 标题');
assert.ok(fullStamp.test(lines.slice(headingIndex + 1).find(line => line.trim()).trim()), '标题后第一行是时间');

// 助手正文的标题降两级，代码块里的 # 保持原样。
assert.ok(timed.includes('### 大标题'), '助手正文的一级标题降为三级');
assert.ok(!timed.includes('\n# 大标题'), '助手正文不再出现一级标题');
assert.ok(timed.includes('# 这是代码注释，不是标题'), '代码块内的 # 不受影响');

// 文本模式同样带时间行。
const textOnly = exportConversationMarkdown(conversation, { textOnly: true, timestamps: true });
assert.ok(textOnly.split('\n').some(line => fullStamp.test(line.trim()) || clockOnly.test(line.trim())), '文本模式也带时间行');

console.log('Markdown 时间线: 默认不输出；开启后首条带日期、同日只写时刻；段号并入时间行；助手标题降两级。');
