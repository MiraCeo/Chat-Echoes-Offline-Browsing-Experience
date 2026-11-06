#!/usr/bin/env node
/**
 * Entity reverse index: from an entity to the events that mention it.
 *
 * The L5 nodes only carry forward links (node → entity indices). This inverts
 * them so "关于 TourGrid 我知道什么" can be answered: for every entity, the
 * events that reference it, with session, round and status.
 *
 *   npm run memory:entity-index -- --group g1
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

/** canonical name → { canonical, kind, tier, aliases } */
export function buildLookup(registry) {
  const lookup = new Map();
  for (const entity of registry?.entities || []) {
    const entry = { canonical: entity.canonical, kind: entity.kind || 'other', tier: entity.tier || 3, aliases: entity.aliases || [] };
    lookup.set(entity.canonical, entry);
    for (const alias of entity.aliases || []) lookup.set(alias, entry);
  }
  return lookup;
}

/** Entities a node references: its `e` indices plus names in the text. */
export function nodeEntities(node, session, lookup) {
  const found = new Set();
  for (const index of node.e || []) {
    const name = session?.l4?.ents?.[index];
    const entry = name ? lookup.get(name) : null;
    if (entry) found.add(entry.canonical);
  }
  const text = String(node.x || '');
  for (const [name, entry] of lookup) {
    if (text.includes(name)) found.add(entry.canonical);
  }
  return [...found];
}

/** Invert the L5 tree into entity → events. */
export function buildEntityIndex(view, registry, { group = null } = {}) {
  const lookup = buildLookup(registry);
  const sessions = new Map((view.sessions || []).map(session => [session.short, session]));
  const entities = new Map();
  const groups = (view.groups || []).filter(item => !group || item.group === group);
  for (const item of groups) {
    for (const node of item.l5?.nodes || []) {
      const first = node.src?.[0];
      const session = first ? sessions.get(first.s) : null;
      for (const canonical of nodeEntities(node, session, lookup)) {
        if (!entities.has(canonical)) {
          const entry = lookup.get(canonical);
          entities.set(canonical, { canonical, kind: entry.kind, tier: entry.tier, events: [] });
        }
        entities.get(canonical).events.push({
          group: item.group,
          n: node.n,
          session: first?.s || null,
          round: first?.r?.[0] ?? null,
          status: node.s || null,
          importance: node.w || null,
          thread: node.thread || null,
          text: node.x || '',
        });
      }
    }
  }
  const list = [...entities.values()].sort((a, b) => b.events.length - a.events.length || a.canonical.localeCompare(b.canonical));
  return { schema: 'ceobe.entity-index/1', group: group || 'all', entities: list };
}

/** Build the index from the view and write it next to the other page data. */
export async function buildEntityIndexPage(root = projectRoot, { group = 'g1' } = {}) {
  const view = await readJson(join(root, 'data/private/memory-kernel/memory-view.json'));
  const registry = await readJson(join(root, 'data/private/memory-kernel/source/entities.json'));
  if (!view || !registry) return null;
  const index = buildEntityIndex(view, registry, { group });
  await writeFile(join(root, 'replay/public/entity-index.json'), JSON.stringify(index), 'utf8');
  return index;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const root = resolve(option('--root') || projectRoot);
  const group = option('--group') || 'g1';
  const view = await readJson(join(root, 'data/private/memory-kernel/memory-view.json'));
  const registry = await readJson(join(root, 'data/private/memory-kernel/source/entities.json'));
  if (!view || !registry) {
    console.error('缺少 memory-view.json 或 entities.json');
    process.exit(1);
  }
  const index = buildEntityIndex(view, registry, { group });
  const out = resolve(option('--out') || join(root, 'replay/public/entity-index.json'));
  await writeFile(out, JSON.stringify(index), 'utf8');
  console.log(`实体反向索引：${index.entities.length} 个实体 / ${index.entities.reduce((sum, item) => sum + item.events.length, 0)} 条关联`);
  for (const item of index.entities.slice(0, 8)) console.log(`  ${item.canonical}（${item.kind}）: ${item.events.length} 条`);
  console.log(`已写入 ${out}`);
}
