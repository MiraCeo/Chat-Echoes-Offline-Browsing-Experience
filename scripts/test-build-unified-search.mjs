import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnifiedIndex } from './build-unified-search.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-unified-search-'));
const pub = join(root, 'replay/public');
const write = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value), 'utf8');
};

try {
  await write(join(pub, 'memory-search.json'), {
    docs: [
      { id: 0, kind: 'L5', title: 'L5 #1', text: '内推人', target: { type: 'global' }, length: 3 },
      { id: 1, kind: '记忆', title: '块', text: '鹰角', target: { type: 'group', group: 'g1' }, length: 2 },
    ],
    postings: { 内推: [[0, 1]], 推人: [[0, 1]], 鹰角: [[1, 1]] },
    df: { 内推: 1, 推人: 1, 鹰角: 1 },
    avgdl: 2.5,
    entities: { 内推人: [0] },
  });
  await write(join(pub, 'library-search.json'), {
    docs: [
      { id: 0, kind: '图片', title: '截图', text: '内推码', target: { type: 'asset', id: 'a1' }, length: 3 },
    ],
    postings: { 内推: [[0, 1]], 推码: [[0, 1]] },
    df: { 内推: 1, 推码: 1 },
    avgdl: 3,
    entities: {},
  });

  const result = await buildUnifiedIndex(root);
  assert.equal(result.docs, 3);
  const index = JSON.parse(await readFile(join(pub, 'unified-search.json'), 'utf8'));
  assert.deepEqual(index.docs.map(doc => doc.source), ['memory', 'memory', 'asset']);
  assert.equal(index.docs[2].id, 2, '资源文档 id 应偏移');
  assert.deepEqual(index.postings['内推'].map(([id]) => id).sort(), [0, 2], '同名词条应合并');
  assert.equal(index.df['内推'], 2);
  assert.deepEqual(index.entities['内推人'], [0]);
  assert.ok(index.avgdl > 0);

  console.log('PASS unified search: doc offset, posting merge, entity merge, avgdl');
} finally {
  await rm(root, { recursive: true, force: true });
}
