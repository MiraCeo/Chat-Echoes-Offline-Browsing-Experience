#!/usr/bin/env node
/**
 * Mechanical candidate generation for L5 event merging.
 *
 * The L5 merge used to scan the whole tree from memory, which is why it needed
 * 2–3 runs and a union. This narrows the search: two L4 nodes from different
 * sessions become a candidate when they share a tier-1/2 entity and their
 * timestamps are within the window. No LLM call.
 *
 *   npm run memory:candidates -- --group g1
 *   --events events-v3   L4 directory (default events-v3)
 *   --window 3           day window (default 3)
 *   --json               machine-readable output
 *   --out <path>         write the candidate table to a file
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = root => join(root, 'data/private/memory-kernel/source');
const ROUND_MS = 5 * 60 * 1000; // a round is minutes; only the session date matters at a 3-day window

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const parseFirst = text => {
  const match = String(text).match(/^first:\s*(.+)$/m);
  return match ? Date.parse(match[1].trim()) : null;
};

/** short session id → { id, first, group } */
export async function loadSessions(root, group) {
  const source = sourceRoot(root);
  const map = await readJson(join(source, 'overlay/archive-map.json'), { sessions: [] });
  const sessions = new Map();
  for (const session of map.sessions || []) {
    if (group && session.group !== group) continue;
    let first = null;
    for (const l2 of [join(source, 'memory', `${session.id}.md`), join(source, 'inbox/memory', `${session.id}.md`)]) {
      try { first = parseFirst(await readFile(l2, 'utf8')); } catch { /* try the next location */ }
      if (first) break;
    }
    sessions.set(session.short, { id: session.id, short: session.short, first, group: session.group });
  }
  return sessions;
}

/** Flatten the L4 trees into nodes with canonical entities and timestamps. */
export async function loadNodes(root, eventsDir, sessions) {
  const dir = join(sourceRoot(root), eventsDir);
  let files = [];
  try { files = (await readdir(dir)).filter(name => name.endsWith('.json')); }
  catch { return []; }
  const registry = await readJson(join(sourceRoot(root), 'entities.json'), { entities: [] });
  const lookup = new Map();
  for (const entity of registry.entities || []) {
    const entry = { canonical: entity.canonical, tier: entity.tier || 3 };
    lookup.set(entity.canonical, entry);
    for (const alias of entity.aliases || []) lookup.set(alias, entry);
  }
  const nodes = [];
  for (const file of files) {
    const short = file.slice(0, 8);
    const session = sessions.get(short);
    if (!session) continue;
    const doc = await readJson(join(dir, file));
    if (!doc?.nodes) continue;
    for (const node of doc.nodes) {
      const entities = [];
      for (const index of node.e || []) {
        const name = (doc.ents || [])[index];
        if (!name) continue;
        const known = lookup.get(name);
        entities.push({ name, canonical: known?.canonical || name, tier: known?.tier || 3 });
      }
      nodes.push({
        session: short,
        n: node.n,
        r: node.r,
        text: node.x,
        type: node.t,
        status: node.s,
        entities,
        ts: Number.isFinite(session.first) ? session.first + (node.r?.[0] || 0) * ROUND_MS : null,
      });
    }
  }
  return nodes;
}

const dayGap = (a, b) => (a.ts === null || b.ts === null ? null : Math.abs(a.ts - b.ts) / 86400000);

/**
 * Candidate pairs: different sessions, at least one shared tier-1/2 entity,
 * and a timestamp gap within the window. Pairs already merged in the L5 tree
 * are marked so the judge can skip them.
 */
export function buildCandidates(nodes, { windowDays = 3, mergedPairs = new Set() } = {}) {
  // Document frequency per canonical entity: a shared "鹰角" is weak evidence,
  // a shared "阿撒泻勒" is strong. IDF turns that into a ranking score.
  const df = new Map();
  for (const node of nodes) {
    for (const entity of new Set(node.entities.map(item => item.canonical))) {
      df.set(entity, (df.get(entity) || 0) + 1);
    }
  }
  const idf = entity => Math.log((nodes.length + 1) / ((df.get(entity) || 1) + 1)) + 1;
  const pairs = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.session === b.session) continue;
      const shared = [];
      let bestTier = 3;
      for (const left of a.entities) {
        if (left.tier > 2) continue;
        const right = b.entities.find(item => item.canonical === left.canonical);
        if (!right) continue;
        shared.push(left.canonical);
        bestTier = Math.min(bestTier, left.tier);
      }
      if (!shared.length) continue;
      const gap = dayGap(a, b);
      if (gap !== null && gap > windowDays) continue;
      const key = `${a.session}#${a.n}|${b.session}#${b.n}`;
      const strength = gap !== null && gap <= 3 && bestTier <= 2 ? 'strong' : 'weak';
      pairs.push({
        a: { session: a.session, n: a.n, r: a.r, text: a.text },
        b: { session: b.session, n: b.n, r: b.r, text: b.text },
        shared,
        tier: bestTier,
        strength,
        score: Number(shared.reduce((sum, entity) => sum + idf(entity), 0).toFixed(2)),
        gap_days: gap === null ? null : Number(gap.toFixed(2)),
        already_merged: mergedPairs.has(key) || mergedPairs.has(`${b.session}#${b.n}|${a.session}#${a.n}`),
      });
    }
  }
  pairs.sort((left, right) => right.score - left.score
    || (left.strength === right.strength ? 0 : left.strength === 'strong' ? -1 : 1)
    || left.tier - right.tier
    || (left.gap_days ?? 0) - (right.gap_days ?? 0));
  return pairs;
}

/** Pairs already inside the same L5 node, keyed both ways. */
export async function loadMergedPairs(root, group) {
  const tree = await readJson(join(sourceRoot(root), `global/l5-${group}.json`));
  const merged = new Set();
  for (const node of tree?.nodes || []) {
    const sources = node.src || [];
    for (let i = 0; i < sources.length; i += 1) {
      for (let j = i + 1; j < sources.length; j += 1) {
        merged.add(`${sources[i].s}#${sources[i].n}|${sources[j].s}#${sources[j].n}`);
      }
    }
  }
  return merged;
}

export function summarize(pairs) {
  const byEntity = {};
  const byTier = { 1: 0, 2: 0 };
  let merged = 0;
  let strong = 0;
  for (const pair of pairs) {
    byTier[pair.tier] = (byTier[pair.tier] || 0) + 1;
    if (pair.already_merged) merged += 1;
    if (pair.strength === 'strong') strong += 1;
    for (const entity of pair.shared) byEntity[entity] = (byEntity[entity] || 0) + 1;
  }
  return {
    pairs: pairs.length,
    strong,
    weak: pairs.length - strong,
    already_merged: merged,
    by_tier: byTier,
    top_entities: Object.entries(byEntity).sort((a, b) => b[1] - a[1]).slice(0, 15),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const has = name => process.argv.includes(name);
  const root = resolve(option('--root') || projectRoot);
  const group = option('--group') || 'g1';
  const eventsDir = option('--events') || 'events-v3';
  const windowDays = Number(option('--window') || 14);

  const sessions = await loadSessions(root, group);
  const nodes = await loadNodes(root, eventsDir, sessions);
  const mergedPairs = await loadMergedPairs(root, group);
  const pairs = buildCandidates(nodes, { windowDays, mergedPairs });
  const stats = summarize(pairs);
  const result = {
    schema: 'ceobe.event-candidates/1',
    group,
    events: eventsDir,
    window_days: windowDays,
    sessions: sessions.size,
    nodes: nodes.length,
    stats,
    pairs,
  };

  if (has('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`事件候选（${group} · ${eventsDir} · ±${windowDays} 天）`);
    console.log(`  ${sessions.size} 会话 / ${nodes.length} 节点 → ${stats.pairs} 对候选（strong ${stats.strong} / weak ${stats.weak}，${stats.already_merged} 对已合并）`);
    console.log(`  tier1 ${stats.by_tier[1] || 0} 对 · tier2 ${stats.by_tier[2] || 0} 对`);
    console.log('  高频实体：' + stats.top_entities.slice(0, 8).map(([name, count]) => `${name} ${count}`).join(' · '));
    for (const pair of pairs.slice(0, 10)) {
      console.log(`  [${pair.strength} t${pair.tier}] ${pair.a.session}#${pair.a.n} ↔ ${pair.b.session}#${pair.b.n}（${pair.shared.join('、')}，${pair.gap_days} 天）`);
    }
  }

  const out = option('--out');
  if (out) {
    await writeFile(resolve(out), JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(`\n已写入 ${resolve(out)}`);
  }
}
