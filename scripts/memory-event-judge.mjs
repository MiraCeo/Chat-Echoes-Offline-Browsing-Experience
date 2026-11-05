#!/usr/bin/env node
/**
 * Event judgment: turn candidate pairs into merge/supersede decisions.
 *
 * The candidate generator narrows the search; this splits the remaining work
 * into batches a clean-context subagent can judge, then aggregates the
 * verdicts. Two independent questions per pair — duplicate and contradiction —
 * because merging and superseding are different decisions.
 *
 *   npm run memory:judge -- --group g1 --top 150 --include-known
 *   npm run memory:judge -- --aggregate data/private/memory-kernel/judge
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildCandidates, loadMergedPairs, loadNodes, loadSessions,
} from './memory-event-candidates.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = root => join(root, 'data/private/memory-kernel/source');
const judgeRoot = root => join(root, 'data/private/memory-kernel/judge');

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const pairKey = pair => `${pair.a.session}#${pair.a.n}|${pair.b.session}#${pair.b.n}`;

/** Pairs already merged in the L5 tree, as candidate-shaped objects. */
async function knownPairs(root, group, nodes) {
  const tree = await readJson(join(sourceRoot(root), `global/l5-${group}.json`));
  const byKey = new Map(nodes.map(node => [`${node.session}#${node.n}`, node]));
  const pairs = [];
  for (const node of tree?.nodes || []) {
    const sources = node.src || [];
    for (let i = 0; i < sources.length; i += 1) {
      for (let j = i + 1; j < sources.length; j += 1) {
        const a = byKey.get(`${sources[i].s}#${sources[i].n}`);
        const b = byKey.get(`${sources[j].s}#${sources[j].n}`);
        if (!a || !b) continue;
        pairs.push({
          a: { session: a.session, n: a.n, r: a.r, text: a.text },
          b: { session: b.session, n: b.n, r: b.r, text: b.text },
          shared: [],
          tier: 3,
          strength: 'known',
          score: 0,
          gap_days: null,
          already_merged: true,
        });
      }
    }
  }
  return pairs;
}

export async function buildBatches(root, { group = 'g1', eventsDir = 'events-v3', top = 150, includeKnown = false, batchSize = 40 } = {}) {
  const sessions = await loadSessions(root, group);
  const nodes = await loadNodes(root, eventsDir, sessions);
  const merged = await loadMergedPairs(root, group);
  const candidates = buildCandidates(nodes, { windowDays: 14, mergedPairs: merged });
  const selected = candidates.slice(0, top);
  if (includeKnown) {
    const known = await knownPairs(root, group, nodes);
    const seen = new Set(selected.map(pairKey));
    for (const pair of known) {
      const key = pairKey(pair);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(pair);
    }
  }
  const batches = [];
  for (let index = 0; index < selected.length; index += batchSize) {
    batches.push(selected.slice(index, index + batchSize));
  }
  return { sessions: sessions.size, nodes: nodes.length, candidates: candidates.length, selected: selected.length, batches };
}

export function formatBatch(batch, index) {
  return {
    schema: 'ceobe.event-judge-batch/1',
    batch: index,
    instructions: [
      '对每一对判断回答两个独立问题：',
      '1. duplicate：这两条是不是同一件事/同一个判断？（yes / no / unsure）',
      '2. contradiction：一条是否推翻或取代另一条？（none / a_supersedes_b / b_supersedes_a / unsure）',
      '重复和矛盾是两件事：同一件事的进展不是矛盾；矛盾也不等于重复。',
      '拿不准就写 unsure，不要硬判。',
    ],
    pairs: batch.map((pair, offset) => ({
      id: `p${index}-${offset + 1}`,
      a: pair.a,
      b: pair.b,
      shared_entities: pair.shared,
      gap_days: pair.gap_days,
      already_merged: pair.already_merged,
    })),
  };
}

export async function aggregate(root, dir) {
  const files = (await readdir(dir)).filter(name => name.startsWith('result-') && name.endsWith('.json'));
  const verdicts = [];
  for (const file of files) {
    const doc = await readJson(join(dir, file));
    for (const item of doc?.verdicts || []) verdicts.push(item);
  }
  // A pair can be both duplicate and contradiction: the same event was later
  // corrected. That is a supersede (keep both, add an edge), not a merge.
  const merges = verdicts.filter(item => item.duplicate === 'yes'
    && (!item.contradiction || item.contradiction === 'none'));
  const supersedes = verdicts.filter(item => item.contradiction && item.contradiction !== 'none' && item.contradiction !== 'unsure');
  const unsure = verdicts.filter(item => item.duplicate === 'unsure' || item.contradiction === 'unsure');
  const decided = new Set([...merges, ...supersedes, ...unsure].map(item => item.id));
  return {
    schema: 'ceobe.event-judgments/1',
    files: files.length,
    verdicts: verdicts.length,
    merges,
    supersedes,
    unsure,
    summary: {
      merge: merges.length,
      supersede: supersedes.length,
      unsure: unsure.length,
      none: verdicts.filter(item => !decided.has(item.id)).length,
    },
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

  if (has('--aggregate')) {
    const dir = resolve(option('--aggregate'));
    const result = await aggregate(root, dir);
    const out = join(dir, 'judgments.json');
    await writeFile(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(`判定汇总：${result.verdicts} 条（合并 ${result.summary.merge} / 推翻 ${result.summary.supersede} / 存疑 ${result.summary.unsure}）`);
    console.log(`已写入 ${out}`);
  } else {
    const group = option('--group') || 'g1';
    const top = Number(option('--top') || 150);
    const batchSize = Number(option('--batch') || 40);
    const built = await buildBatches(root, {
      group,
      eventsDir: option('--events') || 'events-v3',
      top,
      includeKnown: has('--include-known'),
      batchSize,
    });
    const dir = resolve(option('--out') || judgeRoot(root));
    await mkdir(dir, { recursive: true });
    const manifest = {
      schema: 'ceobe.event-judge-manifest/1',
      group,
      sessions: built.sessions,
      nodes: built.nodes,
      candidates: built.candidates,
      selected: built.selected,
      batches: built.batches.length,
      created_at: new Date().toISOString(),
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    for (const [index, batch] of built.batches.entries()) {
      const name = `batch-${String(index + 1).padStart(2, '0')}.json`;
      await writeFile(join(dir, name), JSON.stringify(formatBatch(batch, index + 1), null, 2) + '\n', 'utf8');
    }
    console.log(`候选 ${built.candidates} 对，选中 ${built.selected} 对，分 ${built.batches.length} 批`);
    console.log(`已写入 ${dir}`);
  }
}
