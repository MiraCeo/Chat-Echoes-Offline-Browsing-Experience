#!/usr/bin/env node
/**
 * Apply event judgments back to the L5 tree.
 *
 * The judge produces merge / supersede / unsure verdicts over L4 pairs. This
 * maps each L4 node to its L5 node, merges the pairs judged duplicate, adds
 * the superseded edges, and writes the unsure ones to a review list.
 *
 *   npm run memory:apply -- --dry-run
 *   npm run memory:apply -- --apply
 *   --judge <dir>   judgment directory (default data/private/memory-kernel/judge)
 *   --tree <path>   L5 tree (default global/l5-g1.json)
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = root => join(root, 'data/private/memory-kernel/source');
const judgeRoot = root => join(root, 'data/private/memory-kernel/judge');

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const l4Key = (session, n) => `${session}#${n}`;

/** id → { a, b } from the batch files. */
export async function loadBatchPairs(dir) {
  const files = (await readdir(dir)).filter(name => name.startsWith('batch-') && name.endsWith('.json'));
  const pairs = new Map();
  for (const file of files) {
    const doc = await readJson(join(dir, file));
    for (const pair of doc?.pairs || []) pairs.set(pair.id, pair);
  }
  return pairs;
}

/** L4 key → L5 node number. */
export function buildL4Index(tree) {
  const index = new Map();
  for (const node of tree.nodes || []) {
    for (const src of node.src || []) index.set(l4Key(src.s, src.n), node.n);
  }
  return index;
}

/**
 * Turn verdicts into a plan over L5 nodes. Pairs whose L4 nodes already live
 * in the same L5 node are already merged and skipped.
 */
export function buildPlan(tree, pairs, judgments) {
  const index = buildL4Index(tree);
  const byNumber = new Map((tree.nodes || []).map(node => [node.n, node]));
  const merges = [];
  const supersedes = [];
  const unsure = [];
  const skipped = [];

  for (const verdict of judgments.merges || []) {
    const pair = pairs.get(verdict.id);
    if (!pair) continue;
    const left = index.get(l4Key(pair.a.session, pair.a.n));
    const right = index.get(l4Key(pair.b.session, pair.b.n));
    if (left === undefined || right === undefined) { skipped.push({ id: verdict.id, reason: 'L4 节点不在 L5 树里' }); continue; }
    if (left === right) { skipped.push({ id: verdict.id, reason: '已在同一 L5 节点' }); continue; }
    merges.push({ id: verdict.id, a: left, b: right, confidence: verdict.confidence, reason: verdict.reason });
  }

  for (const verdict of judgments.supersedes || []) {
    const pair = pairs.get(verdict.id);
    if (!pair) continue;
    const left = index.get(l4Key(pair.a.session, pair.a.n));
    const right = index.get(l4Key(pair.b.session, pair.b.n));
    if (left === undefined || right === undefined) { skipped.push({ id: verdict.id, reason: 'L4 节点不在 L5 树里' }); continue; }
    // a_supersedes_b means a is later: the edge goes from b to a.
    const from = verdict.contradiction === 'a_supersedes_b' ? right : left;
    const to = verdict.contradiction === 'a_supersedes_b' ? left : right;
    if (from === to) { skipped.push({ id: verdict.id, reason: '同一 L5 节点内的更正' }); continue; }
    supersedes.push({ id: verdict.id, from, to, confidence: verdict.confidence, reason: verdict.reason });
  }

  for (const verdict of judgments.unsure || []) {
    const pair = pairs.get(verdict.id);
    if (!pair) continue;
    unsure.push({ id: verdict.id, a: pair.a, b: pair.b, reason: verdict.reason });
  }

  return { merges, supersedes, unsure, skipped, byNumber };
}

/** Union-find over merge pairs, then collapse each group into one node. */
export function applyPlan(tree, plan) {
  const nodes = (tree.nodes || []).map(node => ({ ...node, src: [...(node.src || [])] }));
  const byNumber = new Map(nodes.map(node => [node.n, node]));
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
  for (const merge of plan.merges) union(merge.a, merge.b);

  const groups = new Map();
  for (const node of nodes) {
    const root = find(node.n);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }

  const merged = [];
  for (const [root, group] of groups) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const base = group.find(node => node.n === root) || group[0];
    const src = [];
    const seen = new Set();
    for (const node of group) {
      for (const source of node.src || []) {
        const key = l4Key(source.s, source.n);
        if (seen.has(key)) continue;
        seen.add(key);
        src.push(source);
      }
    }
    const rank = { core: 3, supporting: 2, optional: 1 };
    const weight = group.reduce((best, node) => (rank[node.w] > rank[best] ? node.w : best), 'optional');
    merged.push({
      ...base,
      src,
      w: weight,
      s: group.some(node => node.s === 'superseded') ? 'superseded' : base.s,
      thread: base.thread || group.find(node => node.thread)?.thread || null,
    });
  }

  // Redirect edges onto the surviving node, drop self-loops, dedupe.
  const redirect = nodeNumber => find(nodeNumber);
  const edges = [];
  const seenEdges = new Set();
  for (const [from, to, rel] of tree.edges || []) {
    const left = redirect(from);
    const right = redirect(to);
    if (left === right) continue;
    const key = `${left}|${right}|${rel}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push([left, right, rel]);
  }

  // Add superseded edges; the source node must be marked superseded and keep
  // exactly one outgoing superseded edge.
  const supersededOut = new Map();
  for (const [from, , rel] of edges) if (rel === 'superseded') supersededOut.set(from, (supersededOut.get(from) || 0) + 1);
  const added = [];
  for (const item of plan.supersedes) {
    const from = redirect(item.from);
    const to = redirect(item.to);
    if (from === to) continue;
    if (supersededOut.get(from)) continue; // already superseded by something
    const key = `${from}|${to}|superseded`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push([from, to, 'superseded']);
    supersededOut.set(from, 1);
    added.push({ from, to });
  }

  // Renumber by the surviving node's original number so the order is stable.
  const ordered = merged.sort((a, b) => a.n - b.n);
  const remap = new Map();
  ordered.forEach((node, index) => remap.set(node.n, index + 1));
  const renumbered = ordered.map((node, index) => ({ ...node, n: index + 1 }));
  const finalEdges = edges.map(([from, to, rel]) => [remap.get(from), remap.get(to), rel]);

  // Status follows the final edges: a node with an outgoing superseded edge is
  // superseded; one without must not claim to be.
  const finalOut = new Map();
  for (const [from, , rel] of finalEdges) {
    if (rel === 'superseded') finalOut.set(from, (finalOut.get(from) || 0) + 1);
  }
  for (const node of renumbered) {
    if (finalOut.get(node.n)) node.s = 'superseded';
    else if (node.s === 'superseded') node.s = 'decided';
  }
  return { tree: { ...tree, nodes: renumbered, edges: finalEdges }, added, remap };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const has = name => process.argv.includes(name);
  const root = resolve(option('--root') || projectRoot);
  const dir = resolve(option('--judge') || judgeRoot(root));
  const treePath = resolve(option('--tree') || join(sourceRoot(root), 'global/l5-g1.json'));
  if (!existsSync(treePath)) {
    console.error(`找不到 L5 树：${treePath}`);
    process.exit(1);
  }
  const tree = JSON.parse(await readFile(treePath, 'utf8'));
  const pairs = await loadBatchPairs(dir);
  const judgments = await readJson(join(dir, 'judgments.json'));
  if (!judgments) {
    console.error(`找不到判定结果：${join(dir, 'judgments.json')}`);
    process.exit(1);
  }
  const plan = buildPlan(tree, pairs, judgments);
  console.log(`精修计划（${has('--apply') ? 'apply' : 'dry-run'}）`);
  console.log(`  合并 ${plan.merges.length} 组 · 补边 ${plan.supersedes.length} 条 · 存疑 ${plan.unsure.length} 条 · 跳过 ${plan.skipped.length} 条`);
  for (const merge of plan.merges) console.log(`  [merge] #${merge.a} + #${merge.b}（${merge.confidence}）${merge.reason}`);
  for (const edge of plan.supersedes) console.log(`  [supersede] #${edge.from} → #${edge.to}（${edge.confidence}）${edge.reason}`);
  for (const item of plan.unsure) console.log(`  [unsure] ${item.a.session}#${item.a.n} ↔ ${item.b.session}#${item.b.n}：${item.reason}`);

  if (has('--apply')) {
    const result = applyPlan(tree, plan);
    const backup = treePath.replace(/\.json$/, `.pre-apply-${Date.now()}.json`);
    await writeFile(backup, JSON.stringify(tree, null, 2) + '\n', 'utf8');
    await writeFile(treePath, JSON.stringify(result.tree, null, 2) + '\n', 'utf8');
    await writeFile(join(dir, 'review.json'), JSON.stringify({
      schema: 'ceobe.event-review/1',
      generated_at: new Date().toISOString(),
      unsure: plan.unsure,
      skipped: plan.skipped,
    }, null, 2) + '\n', 'utf8');
    console.log(`\n已写入 ${treePath}`);
    console.log(`备份：${backup}`);
    console.log(`复核清单：${join(dir, 'review.json')}`);
  }
}
