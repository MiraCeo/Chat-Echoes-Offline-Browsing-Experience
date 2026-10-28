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
 * 在临时目录里复制一套运行时 + 三份夹具会话（各带一个已下载附件），跑真实构建与真实的
 * 重命名/删除流程（createChatStore），逐字节比较 replay/*.html 与资源库产物。
 * 全程不读取、不写入使用者的归档。
 *
 * 断言：
 *   1. 数据没变时再构建一次，页面逐字节一致（后处理幂等），且只重做会被重建的顶层页面；
 *   2. 资源库缓存命中、缓存缺失、缓存损坏三种情况产出完全一致；
 *   3. 重命名只重做被改名的那一页，并更新资源库里的来源标题；
 *   4. 删除一个会话后，其余会话页哈希都不变，只有被删页面消失；
 *   5. 页面里没有内嵌全部会话（#ceobe-chat-catalog），且仍保留一行静态回退 + 行模板。
 *
 * 副本放在 `data/private/` 里（与 `test-chat-actions-store.mjs` 相同）：Node 会沿着目录树找到真实
 * 的 `node_modules`，因此**不需要**给 `node_modules`／`archive` 建 junction。
 * 这是硬性要求：Windows 上递归删除会穿过 junction（`git worktree remove` 就这样删空过真实档案）。
 */
const source = resolve(import.meta.dirname, '..');
const deletedId = 'fixture-chat-b';
const renamedId = 'fixture-chat-c';
const profiles = [
  { id: 'fixture-chat-a', messages: 10 },
  { id: 'fixture-chat-b', messages: 8 },
  { id: 'fixture-chat-c', messages: 6 },
];
const fixtures = {
  'fixture-chat-a': { name: '共享说明.txt', text: '共享说明：夹具附件。\n' },
  'fixture-chat-b': { name: '待删附件.txt', text: '这个附件随会话一起消失。\n' },
  'fixture-chat-c': { name: '改名附件.txt', text: '来源会话改名后，资源库里的标题要跟着变。\n' },
};
await mkdir(join(source, 'data', 'private'), { recursive: true });
const root = await mkdtemp(join(source, 'data', 'private', 'sidebar-chat-'));
// 夹具里的页面串行渲染：并行工作池会让多个进程同时把 replay/previews 同步进 public/previews，
// Windows 上偶发 EBUSY（既有的构建竞态）。这个测试验证“重建后字节不变”，不需要并发。
const runCapture = args => promisify(execFile)(process.execPath, args, {
  cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, CEOBE_SERIAL_PAGES: '1' },
});
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
    const folder = join(root, 'archive/chatgpt-share', profile.id, '2026-01-01');
    const conversation = makeBookmarkConversation(profile);
    const fixture = fixtures[profile.id];
    if (fixture) {
      const sha256 = createHash('sha256').update(fixture.text).digest('hex');
      const localPath = `assets/${sha256}.txt`;
      await mkdir(join(folder, 'assets'), { recursive: true });
      await writeFile(join(folder, localPath), fixture.text);
      conversation.resources = [{
        key: `fixture-resource-${profile.id}`, aliases: [], pointers: [], message_ids: [],
        name: fixture.name, mime_type: 'text/plain', status: 'downloaded', local_path: localPath,
        sha256, size_bytes: Buffer.byteLength(fixture.text), bytes: Buffer.byteLength(fixture.text),
      }];
    }
    const file = join(folder, 'conversation.ceobe.json');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(conversation));
  }
  const assetsIndex = () => readFile(join(root, 'replay', 'public', 'assets-index.json'), 'utf8');
  const assetCache = async () => JSON.parse(await readFile(join(root, 'data/private', 'asset-library-cache.json'), 'utf8'));

  const decorations = stdout => {
    const line = stdout.split(/\r?\n/).find(entry => entry.startsWith('Decorations:'));
    assert.ok(line, `构建日志里应有装饰统计：${stdout.slice(0, 400)}`);
    const [, refreshed, total] = line.match(/Decorations: (\d+) of (\d+)/).map(Number);
    return { refreshed, total, line };
  };
  let started = Date.now();
  const firstLog = (await runCapture(['scripts/build-library.mjs'])).stdout;
  const buildMs = Date.now() - started;
  const first = await pageHashes();
  assert.equal(Object.keys(first).filter(name => name.startsWith('conversations/')).length, profiles.length, '每个会话都应生成一页');
  const firstDecoration = decorations(firstLog);
  assert.equal(firstDecoration.refreshed, firstDecoration.total, '首次构建要装饰全部页面');
  assert.ok(await readFile(join(root, 'data/private/decoration-stamps.json'), 'utf8'), '首次构建应写下装饰指纹');
  // 资源库：三个附件都应进入索引并复制成本地文件，缓存按会话记下渲染输入。
  const firstIndex = await assetsIndex();
  assert.equal(JSON.parse(firstIndex).length, profiles.length, '每个夹具附件都应进入资源库');
  assert.equal((await readdir(join(root, 'replay', 'public', 'library-assets'))).length, profiles.length, '附件应复制进资料库');
  const firstCache = await assetCache();
  assert.deepEqual(Object.keys(firstCache.conversations).sort(), profiles.map(profile => profile.id).sort());

  // 1. 幂等：数据没变时再构建一次，页面必须逐字节一致；而且只应重新装饰会被重建的顶层页面。
  started = Date.now();
  const rebuildLog = (await runCapture(['scripts/build-library.mjs'])).stdout;
  const rebuildMs = Date.now() - started;
  assert.deepEqual(await pageHashes(), first, '同一份数据重建后页面必须逐字节一致（后处理步骤要幂等）');
  assert.equal(await assetsIndex(), firstIndex, '资源库缓存命中时索引必须与首次构建一致');
  const rebuildDecoration = decorations(rebuildLog);
  assert.ok(rebuildDecoration.refreshed < rebuildDecoration.total,
    `没有变化的页面不应重新装饰：${rebuildDecoration.line}`);
  assert.ok(rebuildDecoration.refreshed <= 6,
    `只重建首页/导入/资料库/项目/时间线等顶层页时，需要重做的页面不应超过 6 个：${rebuildDecoration.line}`);
  assert.equal(parseInt(rebuildLog.match(/Page cache: parsed (\d+)/)[1], 10), rebuildDecoration.refreshed,
    '页面缓存只应解析需要重做的页面');

  // 2. 缓存缺失/损坏时要重新算，但产出必须完全一致。
  await writeFile(join(root, 'data/private', 'asset-library-cache.json'), '{"version":1,"conversations":{},"pages":{}}');
  await runCapture(['scripts/build-library.mjs']);
  assert.deepEqual(await pageHashes(), first, '资源库缓存缺失时页面也不应变');
  assert.equal(await assetsIndex(), firstIndex, '资源库缓存缺失时索引必须与首次构建一致');
  await writeFile(join(root, 'data/private', 'asset-library-cache.json'), 'not json at all');
  await runCapture(['scripts/build-library.mjs']);
  assert.equal(await assetsIndex(), firstIndex, '资源库缓存损坏时索引必须与首次构建一致');
  assert.deepEqual(await assetCache().then(cache => Object.keys(cache.conversations).sort()), profiles.map(profile => profile.id).sort(),
    '重建缓存应覆盖全部会话');

  // 3. 重命名：只有那一个会话页需要重做（装饰指纹按页计算），资源库里的来源标题跟着更新。
  const store = createChatStore(root);
  await store.mutate({ action: 'rename', id: renamedId, title: 'fixture-chat-c 新标题' });
  started = Date.now();
  const renameLog = (await runCapture(['scripts/build-library.mjs'])).stdout;
  const renameMs = Date.now() - started;
  const baseline = await pageHashes();
  const renameDecoration = decorations(renameLog);
  // 顶层 5 页每次都要重建、因此每次都要重做；重命名只应让被改名的那一页额外重做。
  assert.equal(renameDecoration.refreshed, rebuildDecoration.refreshed + 1,
    `重命名只应重做被改名的那一页：${rebuildDecoration.line} → ${renameDecoration.line}`);
  // assets.html 内嵌资料库索引，来源会话标题变了它就该变（缓存里的资源列表仍然有效）。
  // project.html 只内嵌“属于某个项目”的会话预览；夹具里没有项目，所以它不该变。
  const renamed = Object.keys(first).filter(name => first[name] !== baseline[name]).sort();
  assert.deepEqual(renamed, ['assets.html', 'chats.json', `conversations/${renamedId}.html`],
    `重命名只应改动 chats.json、该会话页与资料库索引：${renamed.join(', ')}`);
  const renamedItem = JSON.parse(await assetsIndex()).find(item => item.sources.some(source => source.id === renamedId));
  assert.ok(renamedItem, '改名会话的附件应仍在资源库里');
  assert.equal(renamedItem.sources.find(source => source.id === renamedId).title, 'fixture-chat-c 新标题',
    '资源库的来源标题应跟随重命名');

  // 4. 真实删除流程：只有被删页面消失，其余页面哈希不变。
  started = Date.now();
  await store.mutate({ action: 'delete', id: deletedId, confirm: deletedId });
  const deleteMs = Date.now() - started;
  const after = await pageHashes();
  assert.equal(after[`conversations/${deletedId}.html`], undefined, '被删除会话的页面应当消失');
  assert.notEqual(after['chats.json'], baseline['chats.json'], 'chats.json 应当随删除更新');
  assert.equal(JSON.parse(await readFile(join(root, 'replay', 'chats.json'), 'utf8')).chats.some(chat => chat.id === deletedId), false);
  // project.html 只内嵌“属于某个项目”的会话预览，夹具里没有项目；assets.html 内嵌资源索引，
  // 少了一个会话它们是否变化取决于该会话的成员关系，这里没有项目、附件只有一份，所以两者都不该变。
  const changed = Object.keys(baseline).filter(name => ![`conversations/${deletedId}.html`, 'chats.json', 'assets.html'].includes(name) && baseline[name] !== after[name]);
  assert.deepEqual(changed, [], `删除一个会话不应改写其他页面：${changed.join(', ')}`);
  const changedConversations = Object.keys(after).filter(name => name.startsWith('conversations/') && baseline[name] !== after[name]);
  assert.deepEqual(changedConversations, [], '会话页必须逐字节保持不变');
  // 被删会话的附件要退出资源库索引、缓存与 public/library-assets（不再被引用的副本会被清掉）。
  const indexAfter = JSON.parse(await assetsIndex());
  assert.equal(indexAfter.length, profiles.length - 1, '被删会话独占的附件应退出资源库');
  assert.equal(indexAfter.some(item => item.sources.some(source => source.id === deletedId)), false, '资源库不应再有被删会话的来源');
  assert.ok(indexAfter.every(item => item.sources.every(source => profiles.some(profile => profile.id === source.id) && source.id !== deletedId)));
  assert.equal(Object.keys((await assetCache()).conversations).includes(deletedId), false, '资源库缓存应清掉被删会话');
  const copiedAssets = await readdir(join(root, 'replay', 'public', 'library-assets'));
  const removedName = createHash('sha256').update(fixtures[deletedId].text).digest('hex') + '.txt';
  assert.equal(copiedAssets.includes(removedName), false, '被删会话的附件副本应被清理');
  assert.equal(copiedAssets.length, profiles.length - 1, '只剩仍在索引里的附件副本');

  // 3. 结构：没有内嵌全部会话的数据块；仍保留一行静态回退与行模板。
  for (const name of (await readdir(join(root, 'replay', 'conversations'))).filter(n => n.endsWith('.html'))) {
    const document = parseHTML(await readFile(join(root, 'replay', 'conversations', name), 'utf8')).document;
    assert.equal(document.querySelectorAll('#ceobe-chat-catalog').length, 0, `${name} 不应内嵌全部会话`);
    assert.equal(document.querySelectorAll('#ceobe-sidebar-chat-row').length, 1, `${name} 应保留一行行模板`);
    assert.equal(document.querySelectorAll('[data-chat-recent-list] > li').length, 1, `${name} 静态 HTML 只保留当前会话一行`);
    assert.equal(document.querySelectorAll('a[data-sidebar-item][href*="conversations/"]').length, 1, `${name} 侧栏不应再写入其他会话`);
  }

  console.log(`Sidebar client render passed: build ${seconds(buildMs)}, idempotent rebuild ${seconds(rebuildMs)} (${rebuildDecoration.line}), rename ${seconds(renameMs)} (${renameDecoration.line}), delete ${seconds(deleteMs)}; ${Object.keys(after).length - 1} pages unchanged.`);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
