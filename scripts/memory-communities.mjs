#!/usr/bin/env node
/**
 * Community segmentation for the L5 tree.
 *
 * GraphRAG clusters entities; our memory is event-centric, so communities are
 * (thread, time gap) segments: within a mainline, nodes are ordered by time and
 * split when the gap exceeds a threshold. Deterministic, no LLM.
 *
 *   npm run memory:communities -- --group g1
 *   --tree <path>   L5 tree (default global/l5-<group>.json)
 *   --gap 7         split a thread when the gap exceeds N days
 *   --out <dir>     output directory
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = root => join(root, 'data/private/memory-kernel/source');
const ROUND_MS = 5 * 60 * 1000;

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const parseFirst = text => {
  const match = String(text).match(/^first:\s*(.+)$/m);
  return match ? Date.parse(match[1].trim()) : null;
};

/** short session id → first timestamp (ms). */
export async function loadSessionTimes(root) {
  const source = sourceRoot(root);
  const map = await readJson(join(source, 'overlay/archive-map.json'), { sessions: [] });
  const times = new Map();
  for (const session of map.sessions || []) {
    for (const l2 of [join(source, 'memory', `${session.id}.md`), join(source, 'inbox/memory', `${session.id}.md`)]) {
      try {
        const first = parseFirst(await readFile(l2, 'utf8'));
        if (first) { times.set(session.short, first); break; }
      } catch { /* try the next location */ }
    }
  }
  return times;
}

/** Earliest source timestamp of an L5 node. */
export function nodeTime(node, times) {
  let best = null;
  for (const src of node.src || []) {
    const first = times.get(src.s);
    if (!Number.isFinite(first)) continue;
    const time = first + (src.r?.[0] || 0) * ROUND_MS;
    if (best === null || time < best) best = time;
  }
  return best;
}

const day = ms => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));

/**
 * Segment one thread by time gaps. Nodes without a timestamp go to a trailing
 * "undated" segment so nothing is dropped.
 */
export function segmentThread(nodes, times, gapDays = 7) {
  const dated = [];
  const undated = [];
  for (const node of nodes) {
    const time = nodeTime(node, times);
    if (time === null) undated.push(node);
    else dated.push({ node, time });
  }
  dated.sort((a, b) => a.time - b.time || a.node.n - b.node.n);
  const segments = [];
  let current = null;
  for (const item of dated) {
    if (!current || item.time - current.last > gapDays * 86400000) {
      current = { nodes: [], first: item.time, last: item.time };
      segments.push(current);
    }
    current.nodes.push(item.node);
    current.last = Math.max(current.last, item.time);
  }
  if (undated.length) segments.push({ nodes: undated, first: null, last: null });
  return segments;
}

/**
 * Communities are graph components merged by thread and time: events connected
 * by an edge belong together, and adjacent components in the same thread are
 * merged until the community reaches the target size. This keeps a community
 * at report size (roughly 5–15 nodes) instead of one giant thread summary.
 */
export function buildCommunities(tree, times, { targetSize = 12, gapDays = 3 } = {}) {
  const nodes = tree.nodes || [];
  const parent = new Map(nodes.map(node => [node.n, node.n]));
  const find = value => {
    let root = value;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(value) !== root) { const next = parent.get(value); parent.set(value, root); value = next; }
    return root;
  };
  const union = (a, b) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(Math.max(left, right), Math.min(left, right));
  };
  for (const [from, to] of tree.edges || []) union(from, to);

  const components = new Map();
  for (const node of nodes) {
    const root = find(node.n);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(node);
  }

  const byThread = new Map();
  for (const group of components.values()) {
    const counts = new Map();
    for (const node of group) counts.set(node.thread || '未归属', (counts.get(node.thread || '未归属') || 0) + 1);
    const thread = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const stamps = group.map(node => nodeTime(node, times)).filter(Number.isFinite);
    const entry = {
      thread,
      nodes: group,
      first: stamps.length ? Math.min(...stamps) : null,
      last: stamps.length ? Math.max(...stamps) : null,
    };
    if (!byThread.has(thread)) byThread.set(thread, []);
    byThread.get(thread).push(entry);
  }

  const communities = [];
  for (const [thread, entries] of byThread) {
    entries.sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity));
    let current = null;
    for (const entry of entries) {
      const fits = current
        && current.nodes.length + entry.nodes.length <= targetSize
        && (entry.first === null || current.last === null || entry.first - current.last <= gapDays * 86400000);
      if (!fits) {
        current = { thread, nodes: [], first: entry.first, last: entry.last };
        communities.push(current);
      }
      current.nodes.push(...entry.nodes);
      if (entry.first !== null) current.first = current.first === null ? entry.first : Math.min(current.first, entry.first);
      if (entry.last !== null) current.last = current.last === null ? entry.last : Math.max(current.last, entry.last);
    }
  }

  communities.sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity) || String(a.thread).localeCompare(String(b.thread)));
  const counters = new Map();
  return communities.map(community => {
    const key = community.thread === '未归属' ? '未归属' : community.thread;
    const index = (counters.get(key) || 0) + 1;
    counters.set(key, index);
    return {
      id: `${key}-${String(index).padStart(2, '0')}`,
      thread: community.thread === '未归属' ? null : community.thread,
      from: day(community.first),
      to: day(community.last),
      nodes: community.nodes.map(node => node.n).sort((a, b) => a - b),
    };
  });
}

/** Compact report input: node text, status, importance, sources, edges. */
export function reportInput(tree, community) {
  const byNumber = new Map((tree.nodes || []).map(node => [node.n, node]));
  const members = new Set(community.nodes);
  const nodes = community.nodes.map(number => {
    const node = byNumber.get(number);
    return {
      n: node.n,
      type: node.t,
      status: node.s,
      importance: node.w,
      text: node.x,
      sources: (node.src || []).map(src => `${src.s}#${src.n}`),
    };
  });
  const edges = (tree.edges || [])
    .filter(([from, to]) => members.has(from) && members.has(to))
    .map(([from, to, rel]) => ({ from, to, rel }));
  return {
    schema: 'ceobe.community-report-input/1',
    community: { id: community.id, thread: community.thread, from: community.from, to: community.to },
    nodes,
    edges,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const root = resolve(option('--root') || projectRoot);
  const group = option('--group') || 'g1';
  const gapDays = Number(option('--gap') || 7);
  const treePath = resolve(option('--tree') || join(sourceRoot(root), `global/l5-${group}.json`));
  if (!existsSync(treePath)) {
    console.error(`找不到 L5 树：${treePath}`);
    process.exit(1);
  }
  const tree = JSON.parse(await readFile(treePath, 'utf8'));
  const times = await loadSessionTimes(root);
  const communities = buildCommunities(tree, times, { gapDays });
  const dir = resolve(option('--out') || join(root, 'data/private/memory-kernel/communities'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'communities.json'), JSON.stringify({
    schema: 'ceobe.communities/1',
    group,
    gap_days: gapDays,
    nodes: tree.nodes.length,
    communities,
  }, null, 2) + '\n', 'utf8');
  for (const community of communities) {
    await writeFile(join(dir, `report-input-${community.id}.json`), JSON.stringify(reportInput(tree, community), null, 2) + '\n', 'utf8');
  }
  console.log(`社区切分（${group} · 间隔 ${gapDays} 天）`);
  console.log(`  ${tree.nodes.length} 节点 → ${communities.length} 个社区`);
  for (const community of communities) {
    console.log(`  ${community.id}  ${community.from || '—'} → ${community.to || '—'}  ${community.nodes.length} 节点`);
  }
  console.log(`\n已写入 ${dir}`);
}
