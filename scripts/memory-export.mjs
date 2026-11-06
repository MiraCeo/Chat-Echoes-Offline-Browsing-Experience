#!/usr/bin/env node
/**
 * Export a self-describing memory bundle.
 *
 * The bundle is what a model reads when it takes over: a manifest that says
 * what each layer is, plus the layers themselves. Layers are opt-in so a small
 * handover (profile + L5) and a full dump (with search and image descriptions)
 * use the same command.
 *
 *   npm run memory:export -- --out data/private/memory-kernel/bundle
 *   --layers profile,l5,communities,entities
 *   --group g1
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const ALL_LAYERS = ['profile', 'l5', 'communities', 'entities', 'search', 'images'];

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

/** Copy one layer into the bundle and return its manifest entry. */
async function exportLayer(root, out, layer, group) {
  const source = join(root, 'data/private/memory-kernel');
  if (layer === 'profile') {
    const from = join(source, 'profile/memory-profile.md');
    if (!existsSync(from)) return null;
    await cp(from, join(out, 'profile.md'));
    return { name: 'profile', file: 'profile.md', schema: 'markdown', description: '一页纸：我是谁 / 在手的事 / 等着的事 / 近期变化 + 主线 + 未决 + 社区报告' };
  }
  if (layer === 'l5') {
    const from = join(source, `source/global/l5-${group}.json`);
    if (!existsSync(from)) return null;
    const tree = JSON.parse(await readFile(from, 'utf8'));
    await cp(from, join(out, 'l5.json'));
    return { name: 'l5', file: 'l5.json', schema: 'ceobe.l5-tree/1', nodes: tree.nodes?.length || 0, edges: tree.edges?.length || 0, description: '跨会话事件树：节点带时间窗与来源，边带类型与有效期' };
  }
  if (layer === 'communities') {
    const dir = join(source, 'communities');
    const files = (await readdir(dir).catch(() => [])).filter(name => name.startsWith('report-') && !name.startsWith('report-input-') && name.endsWith('.json'));
    if (!files.length) return null;
    const reports = [];
    for (const file of files) {
      const report = await readJson(join(dir, file));
      if (report?.community) reports.push(report);
    }
    reports.sort((a, b) => (b.rank || 0) - (a.rank || 0));
    await writeFile(join(out, 'communities.json'), JSON.stringify({ schema: 'ceobe.community-reports/1', reports }, null, 2) + '\n', 'utf8');
    return { name: 'communities', file: 'communities.json', schema: 'ceobe.community-reports/1', reports: reports.length, description: '按事件切的社区报告：title / summary / findings / rank' };
  }
  if (layer === 'entities') {
    const from = join(source, 'source/entities.json');
    if (!existsSync(from)) return null;
    const registry = JSON.parse(await readFile(from, 'utf8'));
    await cp(from, join(out, 'entities.json'));
    return { name: 'entities', file: 'entities.json', schema: 'ceobe.entities/1', entities: registry.entities?.length || 0, description: '实体注册表：canonical / aliases / kind / thread / tier' };
  }
  if (layer === 'search') {
    const from = join(root, 'replay/public/unified-search.json');
    if (!existsSync(from)) return null;
    const index = JSON.parse(await readFile(from, 'utf8'));
    await cp(from, join(out, 'search.json'));
    return { name: 'search', file: 'search.json', schema: 'ceobe.memory-search/1', docs: index.docs?.length || 0, description: '统一检索索引（记忆 + 文件/图片），BM25 倒排' };
  }
  if (layer === 'images') {
    const from = join(source, 'image-descriptions.json');
    if (!existsSync(from)) return null;
    const sidecar = JSON.parse(await readFile(from, 'utf8'));
    await cp(from, join(out, 'images.json'));
    return { name: 'images', file: 'images.json', schema: 'ceobe.image-descriptions/1', images: Object.keys(sidecar.images || {}).length, description: '图片描述：summary / ocr / entities，按 sha256 索引' };
  }
  return null;
}

export async function exportBundle(root = projectRoot, { out, layers = ALL_LAYERS, group = 'g1' } = {}) {
  const target = resolve(out || join(root, 'data/private/memory-kernel/bundle'));
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const entries = [];
  for (const layer of layers) {
    const entry = await exportLayer(root, target, layer, group);
    if (entry) entries.push(entry);
  }
  const files = {};
  for (const entry of entries) files[entry.file] = await sha256(join(target, entry.file));
  const manifest = {
    schema: 'ceobe.memory-bundle/1',
    generated_at: new Date().toISOString(),
    group,
    layers: entries,
    files,
    readme: 'README.md',
  };
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const readme = [
    '# CEOBE 记忆包',
    '',
    `生成于 ${manifest.generated_at}，组 ${group}。`,
    '',
    '## 怎么读',
    '',
    '1. 先读 `profile.md`——一页纸，知道这个人是谁、在做什么、卡在哪；',
    '2. 需要细节时读 `l5.json`——事件树，节点带时间窗和来源；',
    '3. 需要主题时读 `communities.json`——按事件切的社区报告；',
    '4. 需要查东西时读 `search.json`（如果导出）——BM25 倒排，或直接用 MCP 的 `search` 工具。',
    '',
    '## 层',
    '',
    ...entries.map(entry => `- \`${entry.file}\`（${entry.name}）：${entry.description}`),
    '',
    '## 约定',
    '',
    '- 节点 `valid_at` / `invalid_at` 是事实的有效期，`invalid_at` 非空表示已被推翻；',
    '- 边的 `superseded` 表示「后者推翻前者」，方向从被推翻者指向推翻者；',
    '- `src` 指向原始会话与轮次，可回溯。',
    '',
  ].join('\n');
  await writeFile(join(target, 'README.md'), readme, 'utf8');
  return { target, manifest };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const root = resolve(option('--root') || projectRoot);
  const layers = (option('--layers') || ALL_LAYERS.join(',')).split(',').map(value => value.trim()).filter(Boolean);
  const result = await exportBundle(root, { out: option('--out'), layers, group: option('--group') || 'g1' });
  console.log(`记忆包：${result.manifest.layers.length} 层`);
  for (const layer of result.manifest.layers) console.log(`  ${layer.name}: ${layer.file}`);
  console.log(`已写入 ${result.target}`);
}
