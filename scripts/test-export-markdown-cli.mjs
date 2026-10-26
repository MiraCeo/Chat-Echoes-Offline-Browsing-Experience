import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// CLI 离线导出：只读 archive/，Markdown + attachments/ 写到 --out；用隔离临时工作区，不碰真实数据。
const root = await mkdtemp(join('data/private', 'md-cli-'));
const chat = (id, title, extra = {}) => ({
  id, title, conversation_path: `archive/chatgpt-share/${id}/conversation.ceobe.json`,
});
try {
  for (const [id, title] of [['chat-a', '公式与引用'], ['chat-b', '同名附件'], ['chat-c', '纯文本']]) {
    await mkdir(join(root, 'archive/chatgpt-share', id, 'assets'), { recursive: true });
    const blocks = [{ type: 'text', text: extraText(id) }];
    const resources = [];
    if (id !== 'chat-c') {
      const bytes = id === 'chat-a' ? 'photo-from-a' : 'photo-from-b';
      await writeFile(join(root, 'archive/chatgpt-share', id, 'assets', 'photo.png'), bytes, 'utf8');
      resources.push({ key: 'image', name: 'photo.png', local_path: 'assets/photo.png', pointers: [], message_ids: ['m1'], status: 'downloaded', mime_type: 'image/png', size_bytes: bytes.length });
    }
    const message = { role: 'user', visible: true, content: { blocks }, content_references: id === 'chat-a' ? [{ type: 'grouped_webpages', items: [{ title: 'OpenAI 帮助中心', url: 'https://help.openai.com/x', attribution: 'help.openai.com' }] }] : [] };
    await writeFile(join(root, 'archive/chatgpt-share', id, 'conversation.ceobe.json'), JSON.stringify({ id, title, source: { url: `https://chatgpt.com/share/${id}` }, linear_message_ids: ['m1'], messages: { m1: message }, resources }));
  }
  function extraText(id) {
    if (id === 'chat-a') return '引用来源\n\n行内公式 \\(a^2+b^2\\) 与显示公式 \\[x=1\\]';
    if (id === 'chat-b') return '同名附件也要能区分';
    return '只有文字，没有附件';
  }
  await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    kind: 'ceobe.library',
    conversations: [chat('chat-a', '公式与引用'), chat('chat-b', '同名附件'), chat('chat-c', '纯文本')],
  }));
  await mkdir(join(root, 'data/private'), { recursive: true });
  await writeFile(join(root, 'data/private/projects.ceobe.json'), JSON.stringify({
    kind: 'ceobe.projects',
    projects: [{ id: 'p1', name: '测试项目', conversation_ids: ['chat-a'], created_at: '2026-09-01T00:00:00Z' }],
  }));

  const snapshot = async () => {
    const files = await readdir(join(root, 'archive/chatgpt-share'), { recursive: true });
    return files.sort().join('|');
  };
  const archiveBefore = await snapshot();
  const run = args => execFileSync(process.execPath, ['scripts/export-markdown-cli.mjs', ...args], {
    encoding: 'utf8', env: { ...process.env, CEOBE_ROOT: root }, cwd: process.cwd(),
  });

  const out = join(root, 'out');
  const log = run(['--all', '--out', out]);
  assert.match(log, /Exported 3 conversation\(s\)/);
  const files = await readdir(out);
  assert.deepEqual(files.filter(name => name.endsWith('.md')).sort(), ['公式与引用.md', '同名附件.md', '纯文本.md'].sort());

  const first = await readFile(join(out, '公式与引用.md'), 'utf8');
  assert.match(first, /^---\ntitle: 公式与引用\n/);
  assert.match(first, /^chat_id: chat-a$/m);
  assert.match(first, /^url: https:\/\/chatgpt\.com\/share\/chat-a$/m);
  assert.match(first, /^project: 测试项目$/m);
  assert.match(first, /^\$\$$/m, 'display math must become a $$ block');
  assert.match(first, /^x=1$/m, 'display math body must be preserved');
  assert.equal(first.match(/^\$\$$/gm).length, 2, 'display math needs an opener and a closer');
  assert.match(first, /\$a\^2\+b\^2\$/, 'inline math must be converted');
  assert.match(first, /^## Sources$/m);
  assert.match(first, /1\. \[OpenAI 帮助中心\]\(https:\/\/help\.openai\.com\/x\)/);
  assert.match(first, /!\[photo\.png\]\(attachments\/photo\.png\)/, 'image links must point at the attachments folder');

  const attachments = (await readdir(join(out, 'attachments'))).sort();
  assert.equal(attachments.length, 2, `same-named attachments must not overwrite each other: ${attachments}`);
  assert.ok(attachments.includes('photo.png'));
  assert.ok(attachments.some(name => /^photo-[a-f0-9]{8}\.png$/.test(name)));
  const second = await readFile(join(out, '同名附件.md'), 'utf8');
  const secondLink = second.match(/attachments\/(photo-[a-f0-9]{8}\.png)/);
  assert.ok(secondLink, 'the second chat must link to its own copy');
  assert.equal(await readFile(join(out, 'attachments', secondLink[1]), 'utf8'), 'photo-from-b');

  // --no-assets：不写附件链接、不新增文件
  const plainOut = join(root, 'plain');
  run(['--all', '--out', plainOut, '--no-assets']);
  const plain = await readFile(join(plainOut, '公式与引用.md'), 'utf8');
  assert.doesNotMatch(plain, /attachments\//);
  assert.doesNotMatch(plain, /assets\//);
  assert.match(plain, /^---\ntitle: 公式与引用/m, 'frontmatter stays');
  assert.deepEqual((await readdir(plainOut)).filter(name => name === 'attachments'), []);

  // wikilink 风格
  const wikiOut = join(root, 'wiki');
  run(['--id', 'chat-a', '--out', wikiOut, '--link-style', 'wikilink']);
  const wiki = await readFile(join(wikiOut, '公式与引用.md'), 'utf8');
  assert.match(wiki, /!\[\[photo\.png\]\]/);

  // 只读 archive/
  assert.equal(await snapshot(), archiveBefore);
  // 参数校验
  assert.throws(() => run(['--all']), /--out/);
  assert.throws(() => run(['--id', 'missing', '--out', join(root, 'x')]), /聊天不存在/);
  assert.throws(() => run(['--all', '--out', join(root, 'x'), '--link-style', 'bogus']), /link-style/);

  console.log('PASS export:md CLI: frontmatter (project/url/chat_id), math, sources, attachment copies with collision suffix, wikilink style, --no-assets, archive left untouched, argument validation.');
} finally {
  await rm(root, { recursive: true, force: true });
}
