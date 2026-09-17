// Deterministic, authored test content; never derived from a personal archive.
export const bookmarkProfiles = [
  { id: 'fixture-long-100', messages: 100, bookmarks: 20 },
  { id: 'fixture-dense-500', messages: 500, bookmarks: 100 },
];
export function makeBookmarkConversation({ id, messages: count }) {
  const messages = {}, linear_message_ids = [];
  for (let i = 0; i < count; i++) {
    const key = `${id}-message-${i}`, role = i % 2 ? 'assistant' : 'user';
    const text = role === 'user' ? `测试问题 ${i}：如何检查离线阅读？`
      : `### 测试回复 ${i}\n\n` + Array.from({ length: 3 }, (_, j) =>
        `段落 ${j + 1}：这是固定的长对话测试文本，用于验证布局、定位和内容检索。`.repeat(3)).join('\n\n') +
        (i % 10 === 1 ? '\n\n| 检查 | 状态 |\n| --- | --- |\n| 布局 | 待验收 |\n\n```js\nconst offline = true;\n```' : '') +
        '\n\n正文专属词 body-only-token。';
    messages[key] = { id: key, role, visible: true, content: { type: 'text', blocks: [{ type: 'text', text }] } };
    linear_message_ids.push(key);
  }
  return { schema_version: '1.0.0', kind: 'ceobe.conversation', id,
    title: `独立阅读夹具 ${count}`, source: { type: 'test_fixture', captured_at: '2026-01-01T00:00:00Z' },
    messages, linear_message_ids, resources: [] };
}
export function bookmarkSpecs(profile) {
  return Array.from({ length: profile.bookmarks }, (_, i) => ({
    chatId: profile.id,
    messageId: `${profile.id}-message-${Math.floor(i * (profile.messages - 1) / (profile.bookmarks - 1))}`,
    title: `测试书签 ${i}`, note: '独立备注：连续缩放、离屏滚动、精确定位。'.repeat(40),
  }));
}
