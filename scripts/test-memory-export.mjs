import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportBundle } from './memory-export.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-memory-export-'));
const write = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
};

try {
  await write(join(root, 'data/private/memory-kernel/profile/memory-profile.md'), '# 记忆档案\n\n## 我是谁\n- 甲（出处：a 第 1 轮）\n');
  await write(join(root, 'data/private/memory-kernel/source/global/l5-g1.json'), {
    nodes: [{ n: 1, x: '甲', src: [{ s: 'aaaaaaaa', n: 1 }] }],
    edges: [[1, 2, 'precedes']],
  });
  await write(join(root, 'data/private/memory-kernel/communities/report-a.json'), {
    community: 'tourgrid-01', title: '标题', summary: '摘要', findings: ['要点'], rank: 0.9,
  });
  await write(join(root, 'data/private/memory-kernel/source/entities.json'), {
    entities: [{ canonical: 'TourGrid', aliases: [], kind: 'project', tier: 1 }],
  });
  await write(join(root, 'replay/public/unified-search.json'), { docs: [{ id: 0 }], postings: {}, df: {} });
  await write(join(root, 'data/private/memory-kernel/image-descriptions.json'), { images: { abc: { summary: '图' } } });

  const out = join(root, 'bundle');
  const result = await exportBundle(root, { out, layers: ['profile', 'l5', 'communities', 'entities', 'search', 'images'] });
  assert.equal(result.manifest.schema, 'ceobe.memory-bundle/1');
  assert.equal(result.manifest.layers.length, 6);
  assert.ok(result.manifest.files['profile.md']);
  assert.equal(result.manifest.layers.find(layer => layer.name === 'l5').nodes, 1);
  assert.equal(result.manifest.layers.find(layer => layer.name === 'communities').reports, 1);
  assert.equal(result.manifest.layers.find(layer => layer.name === 'images').images, 1);

  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.layers.length, 6);
  const readme = await readFile(join(out, 'README.md'), 'utf8');
  assert.match(readme, /profile\.md/);
  assert.match(readme, /superseded/);

  // Layer selection: only the requested layers are exported.
  const partial = await exportBundle(root, { out: join(root, 'bundle-small'), layers: ['profile'] });
  assert.equal(partial.manifest.layers.length, 1);
  assert.equal(partial.manifest.layers[0].name, 'profile');

  console.log('PASS memory export: manifest, layer files, hashes, readme, layer selection');
} finally {
  await rm(root, { recursive: true, force: true });
}
