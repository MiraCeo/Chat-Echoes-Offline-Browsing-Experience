import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLibraryStore, cleanName, uploadKind, uploadId } from './library-store.mjs';

// 资料库的个人数据：文件夹当标签用，上传的字节不进 archive/，删除任何东西都不删文件。
const root = await mkdtemp(join(tmpdir(), 'ceobe-library-store-'));
const dataFile = join(root, 'data/private/library.ceobe.json');
const filesDir = join(root, 'data/private/library-files');
const store = createLibraryStore(dataFile, { filesDir });

const rejects = async (promise, status, pattern) => {
  try { await promise; }
  catch (error) { assert.equal(error.status, status, `expected ${status}, got ${error.status}: ${error.message}`); if (pattern) assert.match(error.message, pattern); return; }
  assert.fail('expected rejection');
};

// 1. 空状态
assert.deepEqual(await store.list(), { folders: [], tags: {}, uploads: [] });

// 2. 名称清洗与类型判断
assert.equal(cleanName('  课程\u0000资料 \n '), '课程 资料');
assert.equal(cleanName('x'.repeat(200)).length, 60);
assert.equal(uploadKind('笔记.md'), 'text');
assert.equal(uploadKind('图.PNG'), 'image');
assert.equal(uploadKind('草稿.docx'), 'file');
assert.equal(uploadKind('数据', 'text/csv'), 'text');

// 3. 文件夹：新建、重名、校验、排序
let state = await store.folders({ action: 'create', name: '课程资料' });
state = await store.folders({ action: 'create', name: '待整理' });
assert.deepEqual(state.folders.map(f => f.name), ['待整理', '课程资料'].sort((a, b) => a.localeCompare(b, 'zh-CN')));
const [first, second] = state.folders;
await rejects(store.folders({ action: 'create', name: '课程资料' }), 409, /同名/);
await rejects(store.folders({ action: 'create', name: '   ' }), 400, /名称/);
await rejects(store.folders({ action: 'create', name: 'a'.repeat(61) }), 400, /1–60/);
await rejects(store.folders({ action: 'rename', id: 'nope', name: 'x' }), 400, /ID/);

// 4. 重命名 + 标签分配（一条资源可以属于多个文件夹）
state = await store.folders({ action: 'rename', id: first.id, name: '资料' });
assert.ok(state.folders.some(f => f.id === first.id && f.name === '资料'));
await rejects(store.folders({ action: 'rename', id: second.id, name: '资料' }), 409, /同名/);
state = await store.tags('asset-123', [first.id, second.id]);
assert.deepEqual(state.tags['asset-123'].sort(), [first.id, second.id].sort());
await rejects(store.tags('asset-123', ['00000000-0000-0000-0000-000000000000']), 404, /文件夹/);
await rejects(store.tags('bad id!', [first.id]), 400, /资源 ID/);
await rejects(store.tags('asset-123', 'nope'), 400, /标签/);
state = await store.tags('asset-123', []);
assert.equal(state.tags['asset-123'], undefined);

// 5. 上传：内容寻址、去重、类型、大小限制
const bytes = Buffer.from('# 提纲\n第一章\n');
const added = await store.addUpload({ name: '提纲.md', bytes });
assert.equal(added.duplicate, false);
assert.equal(added.upload.kind, 'text');
assert.equal(added.upload.size, bytes.length);
assert.equal(added.upload.id, uploadId(added.upload.sha256));
assert.equal(added.upload.stored, `${added.upload.sha256}.md`);
assert.deepEqual(await readdir(filesDir), [added.upload.stored]);
const same = await store.addUpload({ name: '另一个名字.md', bytes });
assert.equal(same.duplicate, true);
assert.equal(same.upload.id, added.upload.id);
assert.equal((await readdir(filesDir)).length, 1, 'same bytes must not be written twice');
await rejects(store.addUpload({ name: '空.txt', bytes: Buffer.alloc(0) }), 400, /为空/);
const tiny = createLibraryStore(join(root, 'data/private/tiny.json'), { filesDir, maxBytes: 8 });
await rejects(tiny.addUpload({ name: 'big.txt', bytes: Buffer.alloc(9) }), 413, /不能超过/);

// 6. 上传记录也能挂标签；删除文件夹只删标签
state = await store.tags(added.upload.id, [first.id]);
assert.deepEqual(state.tags[added.upload.id], [first.id]);
state = await store.folders({ action: 'delete', id: first.id });
assert.equal(state.tags[added.upload.id], undefined);
assert.equal(state.tags['asset-123'], undefined);
assert.ok(!state.folders.some(f => f.id === first.id));

// 7. 移除上传记录：记录消失，文件保留
const removed = await store.removeUpload(added.upload.id);
assert.equal(removed.fileKept, true);
assert.equal(removed.uploads.length, 0);
assert.deepEqual(await readdir(filesDir), [added.upload.stored], 'removing a record must keep the file');
await rejects(store.removeUpload(added.upload.id), 404, /不存在/);
await rejects(store.removeUpload('not-an-upload'), 400, /无效上传记录/);

// 8. 数据文件位置与格式：写在 data/private，不进 archive/
const raw = JSON.parse(await readFile(dataFile, 'utf8'));
assert.equal(raw.kind, 'ceobe.library');
assert.equal(raw.schema_version, '1.0.0');
assert.deepEqual(await readdir(root).then(list => list.sort()), ['data']);
assert.ok(!(await readdir(root)).includes('archive'), 'the library store must never create or touch archive/');

// 9. 损坏与格式异常都不覆盖原文件
await writeFile(dataFile, '{ not json', 'utf8');
await rejects(store.list(), undefined, /损坏/);
assert.equal(await readFile(dataFile, 'utf8'), '{ not json');
await writeFile(dataFile, JSON.stringify({ kind: 'ceobe.projects', projects: [] }), 'utf8');
await rejects(store.list(), undefined, /格式异常/);
assert.match(await readFile(dataFile, 'utf8'), /ceobe\.projects/);

// 10. 并发写入串行化：同时新建两个文件夹都应该保留
await mkdir(join(root, 'data/private'), { recursive: true });
await writeFile(dataFile, JSON.stringify({ schema_version: '1.0.0', kind: 'ceobe.library', folders: [], tags: {}, uploads: [] }), 'utf8');
const fresh = createLibraryStore(dataFile, { filesDir });
await Promise.all([fresh.folders({ action: 'create', name: 'A' }), fresh.folders({ action: 'create', name: 'B' })]);
assert.deepEqual((await fresh.list()).folders.map(f => f.name).sort(), ['A', 'B']);

console.log('PASS library store: folders as tags, upload dedupe/validation, record removal keeps files, no archive writes, corrupt data preserved, serialized writes.');
