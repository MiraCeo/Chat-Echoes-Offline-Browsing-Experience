import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { localImportMiddleware } from './local-import-api.mjs';

// `/api/archive-package`：采集包导入只写快照、不写索引。回归锁：
// 1) 导入成功后必须先重建索引再读条目（否则 --only/旧索引会报“档案库中没有这些会话”）；
// 2) 重建失败要返回 archived=true，让扩展提示“已归档、可重试”；
// 3) 生产模式要发布 dist；
// 4) 临时 zip 不残留。
const root = await mkdtemp('data/private/import-package-api-');
const id = '33333333-3333-4333-8333-333333333333';
let imports = 0, rebuilds = 0, publishes = 0, snapshots = 0, failRebuild = true, failImport = false;
const libraryEntry = { id, title: '采集包会话', message_count: 4, turn_count: 2, user_turn_count: 1, assistant_turn_count: 1, resource_counts: { downloaded: 1, unresolved: 0, failed: 0 } };
const options = {
  mode: 'production',
  importPackage: async zip => {
    imports += 1;
    if (failImport) throw new Error('decode failed: injected package failure');
    // 真实导入器按 captured_at 复用快照；这里模拟“重复导入不新增快照”。
    if (!snapshots) { snapshots = 1; await mkdir(join(root, 'archive'), { recursive: true }); await writeFile(join(root, 'archive/capture.txt'), 'snapshot'); }
    return `已归档：${join(root, 'archive')}\nSHARE_ID=${id}\n消息 4 条 / 节点 4 个\n`;
  },
  rebuild: async () => {
    rebuilds += 1;
    if (failRebuild) throw new Error('injected rebuild failure');
    await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({ schema_version: '1.0.0', kind: 'ceobe.library', conversations: [libraryEntry] }));
  },
  publish: async () => { publishes += 1; },
};

let middleware = localImportMiddleware(root, options);
const server = createServer((q, s) => middleware(q, s, () => { s.statusCode = 404; s.end(); }));
const post = body => fetch(base + '/api/archive-package', {
  method: 'POST',
  headers: { 'Content-Type': 'application/zip', Origin: 'chrome-extension://regressiontestextension' },
  body,
});
let base;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;

  // 1) 重建失败：已归档，但页面没更新；不能伪装成完全失败。
  let response = await post(Buffer.from('PK-fake-package'));
  let data = await response.json();
  assert.equal(response.status, 422);
  assert.equal(data.archived, true, 'a package that was imported is reported as archived');
  assert.equal(data.retryPublish, true);
  assert.match(data.error, /采集包已归档，但页面更新失败/);
  assert.match(data.error, /重试只会更新页面/);
  assert.deepEqual([imports, rebuilds, publishes, snapshots], [1, 1, 0, 1]);

  // 2) 重试（索引当前）：重建索引后能读到条目；生产模式发布一次。
  failRebuild = false;
  response = await post(Buffer.from('PK-fake-package'));
  data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual([data.shareId, data.title, data.turnCount, data.page], [id, '采集包会话', 2, '/conversations/' + id + '.html']);
  assert.deepEqual([imports, rebuilds, publishes, snapshots], [2, 2, 1, 1], 'a retry rebuilds and publishes without a duplicate snapshot');

  // 3) 导入本身失败：archived 必须为 false，且不触发重建。
  failImport = true; failRebuild = true;
  const before = [imports, rebuilds, publishes];
  response = await post(Buffer.from('PK-broken-package'));
  data = await response.json();
  assert.equal(response.status, 422);
  assert.equal(data.archived, false);
  assert.match(data.error, /decode failed/);
  assert.deepEqual([imports, rebuilds, publishes], [before[0] + 1, 2, 1], 'a failed import does not rebuild or publish');

  // 4) 临时 zip 不残留。
  const packages = await readdir(join(root, 'data/private/import-packages')).catch(() => []);
  assert.deepEqual(packages.filter(name => name.endsWith('.zip')), [], 'temporary packages are removed');

  // 5) 索引由重建写入，而不是沿用旧文件（读到的条目来自上面的 rebuild()）。
  assert.deepEqual(JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8')).conversations.map(entry => entry.id), [id]);
  console.log('PASS archive package API: rebuild-before-read, archived flag on post-import failure, production publish, no duplicate snapshot, temp zip cleanup');
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
