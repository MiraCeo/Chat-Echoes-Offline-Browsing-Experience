import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { createChatStore } from './chat-store.mjs';
import { makeBookmarkConversation } from '../fixtures/browser/bookmark-conversations.mjs';

/**
 * “删除会话不再重写每一页”的验收。
 *
 * 在临时目录里复制一套运行时 + 三份夹具会话，跑真实构建与真实的删除流程（createChatStore），
 * 逐字节比较 replay/*.html。全程不读取、不写入使用者的归档。
 *
 * 三个断言：
 *   1. 数据没变时再构建一次，页面逐字节一致（后处理步骤必须幂等）；
 *   2. 删除一个会话后，其余页面的哈希都不变，只有被删的那一页消失；
 *   3. 页面里没有内嵌全部会话（#ceobe-chat-catalog），且仍保留一行静态回退 + 行模板。
 *
 * 副本放在 `data/private/` 里（与 `test-chat-actions-store.mjs` 相同）：Node 会沿着目录树找到真实
 * 的 `node_modules`，因此**不需要**给 `node_modules`／`archive` 建 junction。
 * 这是硬性要求：Windows 上递归删除会穿过 junction（`git worktree remove` 就这样删空过真实档案）。
 */
const source = resolve(import.meta.dirname, '..');
const deletedId = 'fixture-chat-b';
const profiles = [
  { id: 'fixture-chat-a', messages: 10 },
  { id: 'fixture-chat-b', messages: 8 },
  { id: 'fixture-chat-c', messages: 6 },
];
await mkdir(join(source, 'data', 'private'), { recursive: true });
const root = await mkdtemp(join(source, 'data', 'private', 'sidebar-chat-'));
const run = args => promisify(execFile)(process.execPath, args, { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const hashFile = async path => createHash('sha256').update(await readFile(join(root, 'replay', path))).digest('hex');
async function pageHashes() {
  const hashes = {};
  for (const name of (await readdir(join(root, 'replay', 'conversations'))).filter(n => n.endsWith('.html')).sort()) {
    hashes[`conversations/${name}`] = await hashFile(`conversations/${name}`);
  }
  for (const name of (await readdir(join(root, 'replay'))).filter(n => n.endsWith('.html')).sort()) hashes[name] = await hashFile(name);
  // chats.json 每次都写新的 generated_at，只比较真正会被删除改动的部分。
  const payload = JSON.parse(await readFile(join(root, 'replay', 'chats.json'), 'utf8'));
  hashes['chats.json'] = createHash('sha256').update(JSON.stringify(payload.chats)).digest('hex');
  return hashes;
}
const seconds = ms => `${(ms / 1000).toFixed(1)}s`;
try {
  await cp(join(source, 'scripts'), join(root, 'scripts'), { recursive: true, filter: path => !/^(?:test-|capture-|\.)/.test(basename(path)) });
  // 模板与官方资源用真实副本：删除流程会把它们复制进暂存目录，联接会被当成符号链接拒绝或重建不出去。
  // node_modules 同样不建联接（递归删除会穿过）：只复制构建真正按路径读取的 katex（约 4 MB），
  // 其余包由 Node 沿目录树向上找到真实的 node_modules。
  for (const name of ['official-templates', 'official-assets']) await cp(join(source, name), join(root, name), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await cp(join(source, 'node_modules', 'katex'), join(root, 'node_modules', 'katex'), { recursive: true });
  for (const name of ['vite.config.mjs', 'package.json']) await cp(join(source, name), join(root, name));
  for (const name of ['src', 'samples']) await cp(join(source, name), join(root, name), { recursive: true });
  for (const profile of profiles) {
    const file = join(root, 'archive/chatgpt-share', profile.id, '2026-01-01', 'conversation.ceobe.json');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(makeBookmarkConversation(profile)));
  }

  let started = Date.now();
  await run(['scripts/build-library.mjs']);
  const buildMs = Date.now() - started;
  const first = await pageHashes();
  assert.equal(Object.keys(first).filter(name => name.startsWith('conversations/')).length, profiles.length, '每个会话都应生成一页');

  // 1. 幂等：数据没变时再构建一次，页面必须逐字节一致。
  started = Date.now();
  await run(['scripts/build-library.mjs']);
  const rebuildMs = Date.now() - started;
  assert.deepEqual(await pageHashes(), first, '同一份数据重建后页面必须逐字节一致（后处理步骤要幂等）');

  // 2. 真实删除流程：只有被删页面消失，其余页面哈希不变。
  const store = createChatStore(root);
  started = Date.now();
  await store.mutate({ action: 'delete', id: deletedId, confirm: deletedId });
  const deleteMs = Date.now() - started;
  const after = await pageHashes();
  assert.equal(after[`conversations/${deletedId}.html`], undefined, '被删除会话的页面应当消失');
  assert.notEqual(after['chats.json'], first['chats.json'], 'chats.json 应当随删除更新');
  assert.equal(JSON.parse(await readFile(join(root, 'replay', 'chats.json'), 'utf8')).chats.some(chat => chat.id === deletedId), false);
  // project.html 内嵌的是“每个会话的预览片段”，少了一个会话它就该变；会话页与索引页不应变。
  const changed = Object.keys(first).filter(name => ![`conversations/${deletedId}.html`, 'chats.json', 'project.html'].includes(name) && first[name] !== after[name]);
  assert.deepEqual(changed, [], `删除一个会话不应改写其他页面：${changed.join(', ')}`);
  const changedConversations = Object.keys(after).filter(name => name.startsWith('conversations/') && first[name] !== after[name]);
  assert.deepEqual(changedConversations, [], '会话页必须逐字节保持不变');

  // 3. 结构：没有内嵌全部会话的数据块；仍保留一行静态回退与行模板。
  for (const name of (await readdir(join(root, 'replay', 'conversations'))).filter(n => n.endsWith('.html'))) {
    const document = parseHTML(await readFile(join(root, 'replay', 'conversations', name), 'utf8')).document;
    assert.equal(document.querySelectorAll('#ceobe-chat-catalog').length, 0, `${name} 不应内嵌全部会话`);
    assert.equal(document.querySelectorAll('#ceobe-sidebar-chat-row').length, 1, `${name} 应保留一行行模板`);
    assert.equal(document.querySelectorAll('[data-chat-recent-list] > li').length, 1, `${name} 静态 HTML 只保留当前会话一行`);
    assert.equal(document.querySelectorAll('a[data-sidebar-item][href*="conversations/"]').length, 1, `${name} 侧栏不应再写入其他会话`);
  }

  console.log(`Sidebar client render passed: build ${seconds(buildMs)}, idempotent rebuild ${seconds(rebuildMs)}, delete ${seconds(deleteMs)}; ${Object.keys(after).length - 1} pages unchanged.`);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
