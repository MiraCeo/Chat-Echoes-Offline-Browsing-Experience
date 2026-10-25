import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { libraryMiddleware } from './library-store.mjs';

// 资料库接口：文件夹/标签/上传。上传字节写 data/private（不进 archive/），删记录不删文件。
const root = await mkdtemp(join(tmpdir(), 'ceobe-library-api-'));
await mkdir(join(root, 'data/private'), { recursive: true });
await mkdir(join(root, 'replay/public'), { recursive: true });
const middleware = libraryMiddleware(root);
const server = createServer((q, s) => middleware(q, s, () => { s.statusCode = 404; s.end(JSON.stringify({ error: 'not found' })); }));
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, { method = 'POST', body, type = 'application/json', origin = base } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: type ? { 'Content-Type': type, ...(origin ? { Origin: origin } : {}) } : {},
    body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: response.status, payload, headers: response.headers };
};

try {
  // 1. 读取
  let response = await call('/api/library', { method: 'GET', type: null });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { folders: [], tags: {}, uploads: [], writable: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  // 2. 方法/类型/跨站守卫
  assert.equal((await call('/api/library/folders', { method: 'GET', type: null })).status, 405);
  assert.equal((await call('/api/library/folders', { type: 'text/plain', body: '{}' })).status, 415);
  assert.equal((await call('/api/library/folders', { body: { action: 'create', name: 'x' }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/library/folders', { body: '{ not json' })).status, 400);
  assert.equal((await call('/api/library/nope', { body: {} })).status, 404);

  // 3. 文件夹
  response = await call('/api/library/folders', { body: { action: 'create', name: '课程资料' } });
  assert.equal(response.status, 200);
  const folder = response.payload.folders[0];
  assert.equal(folder.name, '课程资料');
  assert.equal((await call('/api/library/folders', { body: { action: 'create', name: '课程资料' } })).status, 409);
  response = await call('/api/library/folders', { body: { action: 'rename', id: folder.id, name: '资料' } });
  assert.equal(response.payload.folders[0].name, '资料');

  // 4. 标签
  response = await call('/api/library/tags', { body: { assetId: 'asset-1', folders: [folder.id] } });
  assert.deepEqual(response.payload.tags['asset-1'], [folder.id]);
  assert.equal((await call('/api/library/tags', { body: { assetId: 'asset-1', folders: ['00000000-0000-0000-0000-000000000000'] } })).status, 404);
  response = await call('/api/library/tags', { body: { assetId: 'asset-1', folders: [] } });
  assert.equal(response.payload.tags['asset-1'], undefined);

  // 5. 上传：类型守卫、内容寻址、副本、不进 archive/
  assert.equal((await call('/api/library/upload?name=x.txt', { type: 'text/plain', body: Buffer.from('x') })).status, 415);
  const body = Buffer.from('# 提纲\n第一章\n');
  response = await call(`/api/library/upload?name=${encodeURIComponent('提纲.md')}&mime=text/markdown`, { type: 'application/octet-stream', body });
  assert.equal(response.status, 201);
  const upload = response.payload.upload;
  assert.equal(upload.kind, 'text');
  assert.equal(upload.size, body.length);
  assert.equal(upload.name, '提纲.md');
  const privateFiles = await readdir(join(root, 'data/private/library-files'));
  const publicFiles = await readdir(join(root, 'replay/public/library-files'));
  assert.deepEqual(privateFiles, [upload.stored]);
  assert.deepEqual(publicFiles, [upload.stored]);
  assert.equal((await stat(join(root, 'replay/public/library-files', upload.stored))).size, body.length);
  assert.deepEqual(await readFile(join(root, 'data/private/library-files', upload.stored)).then(b => b.toString()), body.toString());
  assert.ok(!(await readdir(root)).includes('archive'), 'uploads must not create archive/');

  // 6. 同一份字节再传一次：返回已有记录，不新增文件
  response = await call(`/api/library/upload?name=${encodeURIComponent('重命名.md')}`, { type: 'application/octet-stream', body });
  assert.equal(response.status, 200);
  assert.equal(response.payload.duplicate, true);
  assert.equal(response.payload.upload.id, upload.id);
  assert.equal((await readdir(join(root, 'data/private/library-files'))).length, 1);

  // 7. 上传记录也能打标签；删文件夹只删标签
  response = await call('/api/library/tags', { body: { assetId: upload.id, folders: [folder.id] } });
  assert.deepEqual(response.payload.tags[upload.id], [folder.id]);
  response = await call('/api/library/folders', { body: { action: 'delete', id: folder.id } });
  assert.equal(response.payload.folders.length, 0);
  assert.equal(response.payload.tags[upload.id], undefined);

  // 8. 移除记录：记录消失，私有文件保留
  response = await call('/api/library/uploads/remove', { body: { id: upload.id } });
  assert.equal(response.status, 200);
  assert.equal(response.payload.fileKept, true);
  assert.equal(response.payload.uploads.length, 0);
  assert.deepEqual(await readdir(join(root, 'data/private/library-files')), [upload.stored]);
  assert.equal((await call('/api/library/uploads/remove', { body: { id: upload.id } })).status, 404);

  // 9. 数据文件留在 data/private，不写 archive/
  const stored = JSON.parse(await readFile(join(root, 'data/private/library.ceobe.json'), 'utf8'));
  assert.equal(stored.kind, 'ceobe.library');
  assert.deepEqual(stored.uploads, []);
  assert.ok(!(await readdir(root)).includes('archive'));
  await writeFile(join(root, 'data/private/library.ceobe.json'), '{ broken', 'utf8');
  response = await call('/api/library', { method: 'GET', type: null });
  assert.equal(response.status, 500);
  assert.match(response.payload.error, /未被覆盖/);
  assert.equal(await readFile(join(root, 'data/private/library.ceobe.json'), 'utf8'), '{ broken');

  console.log('PASS library API: read/write shape, guards, folder + tag lifecycle, upload dedupe with private+public copies, record removal keeps files, no archive writes, corrupt data preserved.');
} finally {
  await new Promise(done => server.close(done));
}
