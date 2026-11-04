#!/usr/bin/env node
/**
 * Memory extraction eval.
 *
 * Two tiers, because the kernel is refined by small human spot-checks rather
 * than full manual review:
 *
 *  1. Automatic metrics — no labels needed, run on every kernel change:
 *     type distribution/entropy, text length, node density, superseded
 *     consistency, provenance coverage.
 *  2. Semantic metrics — scored against a label file (model-drafted, human
 *     spot-checked on disagreements only): recall, precision, type accuracy,
 *     status accuracy, superseded edge precision/recall.
 *
 * Usage:
 *   node scripts/memory-eval.mjs --session 6ad9fd48
 *   node scripts/memory-eval.mjs --session 6ad9fd48 --labels <path> --json
 *
 * Labels live under data/private/memory-kernel/eval/ and are never committed.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(projectRoot, 'data/private/memory-kernel/source');
const evalRoot = join(projectRoot, 'data/private/memory-kernel/eval');

const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const has = name => process.argv.includes(name);

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const TYPES = ['event', 'decision', 'problem', 'artifact', 'open'];
const STATUSES = ['decided', 'pending', 'superseded'];

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const overlap = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return 0;
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);
};

/** Metrics that need no labels. */
export function autoMetrics(l4, l2Text = '') {
  const nodes = Array.isArray(l4?.nodes) ? l4.nodes : [];
  const edges = Array.isArray(l4?.edges) ? l4.edges : [];
  const typeCounts = Object.fromEntries(TYPES.map(type => [type, 0]));
  for (const node of nodes) if (typeCounts[node.t] !== undefined) typeCounts[node.t] += 1;
  const importanceCounts = { core: 0, supporting: 0, optional: 0 };
  for (const node of nodes) {
    const key = importanceCounts[node.w] !== undefined ? node.w : 'supporting';
    importanceCounts[key] += 1;
  }
  const total = nodes.length || 1;
  const entropy = -TYPES.reduce((sum, type) => {
    const share = typeCounts[type] / total;
    return share > 0 ? sum + share * Math.log2(share) : sum;
  }, 0);
  const lengths = nodes.map(node => String(node.x || '').length);
  const supersededOut = new Map();
  for (const edge of edges) {
    if (edge?.[2] !== 'superseded') continue;
    supersededOut.set(edge[0], (supersededOut.get(edge[0]) || 0) + 1);
  }
  const supersededNodes = nodes.filter(node => node.s === 'superseded');
  const brokenSuperseded = supersededNodes.filter(node => supersededOut.get(node.n) !== 1);
  const withProvenance = nodes.filter(node => Array.isArray(node.r) && node.r.length === 2);
  const l2Chars = String(l2Text).replace(/\s/g, '').length;
  return {
    nodes: nodes.length,
    edges: edges.length,
    type_counts: typeCounts,
    importance_counts: importanceCounts,
    decision_share: Number((typeCounts.decision / total).toFixed(3)),
    type_entropy: Number(entropy.toFixed(3)),
    type_entropy_normalized: Number((entropy / Math.log2(TYPES.length)).toFixed(3)),
    text_length: { min: Math.min(...lengths), median: median(lengths), max: Math.max(...lengths) },
    node_density_per_1k: l2Chars ? Number(((nodes.length / l2Chars) * 1000).toFixed(2)) : null,
    superseded_nodes: supersededNodes.length,
    superseded_broken: brokenSuperseded.length,
    provenance_coverage: Number((withProvenance.length / total).toFixed(3)),
  };
}

/** Character-bigram Jaccard, used to break keyword ties. */
const bigrams = text => {
  const clean = String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const set = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2));
  return set;
};
const similarity = (a, b) => {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
};

/**
 * Greedy global matching: a prediction matches a label when their round ranges
 * overlap and the prediction text contains at least one `must_include` keyword.
 * Score = overlap * 10 + keyword hits * 5 + text similarity * 30, assigned
 * highest-first so the result does not depend on label order. Similarity is
 * what separates "底气＝项目积累" from "底气＝7.24 视频" when both share a keyword.
 */
export function matchNodes(labels, predictions) {
  const pairs = [];
  for (const label of labels) {
    for (const prediction of predictions) {
      const rounds = overlap(label.rounds, prediction.r);
      if (!rounds) continue;
      const text = String(prediction.x || '');
      const hits = (label.must_include || []).filter(keyword => text.includes(keyword)).length;
      if (!hits) continue;
      const score = rounds * 10 + hits * 5 + similarity(text, label.text) * 30;
      pairs.push({ label, prediction, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedLabels = new Set();
  const usedPredictions = new Set();
  const matched = [];
  for (const pair of pairs) {
    if (usedLabels.has(pair.label.id) || usedPredictions.has(pair.prediction.n)) continue;
    usedLabels.add(pair.label.id);
    usedPredictions.add(pair.prediction.n);
    matched.push(pair);
  }
  return {
    matched,
    unmatchedLabels: labels.filter(label => !usedLabels.has(label.id)),
    unmatchedPredictions: predictions.filter(prediction => !usedPredictions.has(prediction.n)),
  };
}

/** Semantic metrics against a label file. */
export function scoreLabels(labels, l4) {
  const predictions = Array.isArray(l4?.nodes) ? l4.nodes : [];
  const edges = Array.isArray(l4?.edges) ? l4.edges : [];
  const { matched, unmatchedLabels, unmatchedPredictions } = matchNodes(labels.nodes || [], predictions);
  const typeMismatches = matched
    .filter(pair => pair.label.type !== pair.prediction.t)
    .map(pair => ({ label: pair.label.id, expected: pair.label.type, actual: pair.prediction.t, text: pair.prediction.x }));
  const statusMismatches = matched
    .filter(pair => pair.label.status && pair.label.status !== pair.prediction.s)
    .map(pair => ({ label: pair.label.id, expected: pair.label.status, actual: pair.prediction.s, text: pair.prediction.x }));
  const importanceMismatches = matched
    .filter(pair => pair.prediction.w && pair.label.importance && pair.prediction.w !== pair.label.importance)
    .map(pair => ({ label: pair.label.id, expected: pair.label.importance, actual: pair.prediction.w, text: pair.prediction.x }));

  const labelById = new Map((labels.nodes || []).map(node => [node.id, node]));
  const predictionByNumber = new Map(predictions.map(node => [node.n, node]));
  const predictedSuperseded = edges.filter(edge => edge?.[2] === 'superseded');
  const expectedSuperseded = (labels.edges || []).filter(edge => edge.type === 'superseded');
  const matchedByLabel = new Map(matched.map(pair => [pair.label.id, pair.prediction.n]));
  const matchedByPrediction = new Map(matched.map(pair => [pair.prediction.n, pair.label.id]));
  const expectedPairs = new Set(expectedSuperseded
    .map(edge => `${matchedByLabel.get(edge.from)}>${matchedByLabel.get(edge.to)}`)
    .filter(pair => !pair.includes('undefined')));
  const actualPairs = new Set(predictedSuperseded
    .map(edge => `${edge[0]}>${edge[1]}`)
    .filter(pair => matchedByPrediction.has(Number(pair.split('>')[0])) && matchedByPrediction.has(Number(pair.split('>')[1]))));
  const edgeHits = [...expectedPairs].filter(pair => actualPairs.has(pair)).length;

  const labelTotal = (labels.nodes || []).length || 1;
  const predictionTotal = predictions.length || 1;
  const matchedIds = new Set(matched.map(pair => pair.label.id));
  const byImportance = { core: [], supporting: [], optional: [] };
  for (const label of labels.nodes || []) {
    const key = byImportance[label.importance] ? label.importance : 'supporting';
    byImportance[key].push(label);
  }
  const recallFor = list => (list.length
    ? Number((list.filter(label => matchedIds.has(label.id)).length / list.length).toFixed(3))
    : null);
  const budgetMin = Number(labels.budget?.min ?? 8);
  const budgetMax = Number(labels.budget?.max ?? 15);
  return {
    labels: labelTotal,
    predictions: predictionTotal,
    matched: matched.length,
    recall: Number((matched.length / labelTotal).toFixed(3)),
    recall_core: recallFor(byImportance.core),
    recall_supporting: recallFor(byImportance.supporting),
    recall_optional: recallFor(byImportance.optional),
    precision: Number((matched.length / predictionTotal).toFixed(3)),
    budget: {
      min: budgetMin,
      max: budgetMax,
      actual: predictionTotal,
      fit: predictionTotal >= budgetMin && predictionTotal <= budgetMax,
    },
    type_accuracy: matched.length ? Number(((matched.length - typeMismatches.length) / matched.length).toFixed(3)) : null,
    status_accuracy: matched.length ? Number(((matched.length - statusMismatches.length) / matched.length).toFixed(3)) : null,
    importance_accuracy: matched.some(pair => pair.prediction.w)
      ? Number(((matched.length - importanceMismatches.length) / matched.length).toFixed(3))
      : null,
    superseded_edges: {
      expected: expectedPairs.size,
      predicted: predictedSuperseded.length,
      matched: edgeHits,
      // With few matched endpoints there is nothing to compare against; report
      // null instead of a misleading 0%.
      precision: expectedPairs.size ? Number((edgeHits / predictedSuperseded.length).toFixed(3)) : null,
      recall: expectedPairs.size ? Number((edgeHits / expectedPairs.size).toFixed(3)) : null,
    },
    type_mismatches: typeMismatches,
    status_mismatches: statusMismatches,
    missed_core: byImportance.core
      .filter(label => !matchedIds.has(label.id))
      .map(label => ({ id: label.id, type: label.type, text: label.text })),
    missed_labels: unmatchedLabels.map(label => ({ id: label.id, type: label.type, importance: label.importance || 'supporting', text: label.text })),
    extra_predictions: unmatchedPredictions.map(node => ({ n: node.n, type: node.t, text: node.x })),
    labelById: [...labelById.keys()],
    predictionByNumber: [...predictionByNumber.keys()],
  };
}

export async function evaluateSession(short, { labelsPath = null, eventsDir = null } = {}) {
  const map = await readJson(join(sourceRoot, 'overlay/archive-map.json'), { sessions: [] });
  const session = (map.sessions || []).find(item => item.short === short || item.id.startsWith(short));
  if (!session) throw new Error(`找不到会话：${short}`);
  const l4Path = eventsDir ? join(eventsDir, `${session.id}.json`) : join(sourceRoot, session.l4.path);
  const l4 = await readJson(l4Path);
  if (!l4) throw new Error(`缺少 L4：${l4Path}`);
  const l2Text = await readFile(join(sourceRoot, session.l2.path), 'utf8').catch(() => '');
  const path = labelsPath || join(evalRoot, `${session.short}.json`);
  const labels = existsSync(path) ? await readJson(path) : null;
  return {
    session: { short: session.short, title: session.title, group: session.group, rounds: session.rounds },
    auto: autoMetrics(l4, l2Text),
    labels_path: labels ? path : null,
    semantic: labels ? scoreLabels(labels, l4) : null,
  };
}

const percent = value => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);

export function formatReport(result) {
  const { session, auto, semantic } = result;
  const lines = [];
  lines.push(`记忆抽取评测 · ${session.title}（${session.group} · ${session.rounds} 轮）`);
  lines.push('');
  lines.push('  自动指标（无需标注）');
  lines.push(`    节点 ${auto.nodes} / 边 ${auto.edges} · 密度 ${auto.node_density_per_1k ?? '—'} 节点/千字`);
  lines.push(`    类型 ${Object.entries(auto.type_counts).map(([type, count]) => `${type} ${count}`).join(' · ')}`);
  lines.push(`    decision 占比 ${percent(auto.decision_share)} · 类型熵 ${auto.type_entropy}（归一 ${auto.type_entropy_normalized}）`);
  lines.push(`    正文长度 min ${auto.text_length.min} / 中位 ${auto.text_length.median} / max ${auto.text_length.max}`);
  lines.push(`    superseded 节点 ${auto.superseded_nodes} · 断链 ${auto.superseded_broken} · 来源覆盖 ${percent(auto.provenance_coverage)}`);
  if (!semantic) {
    lines.push('');
    lines.push('  语义指标：缺少标注文件，跳过。');
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`  语义指标（标注 ${semantic.labels} 条 / 抽取 ${semantic.predictions} 条）`);
  lines.push(`    核心召回 ${percent(semantic.recall_core)} · 支撑召回 ${percent(semantic.recall_supporting)} · 可选召回 ${percent(semantic.recall_optional)}`);
  lines.push(`    总召回 ${percent(semantic.recall)} · 精确 ${percent(semantic.precision)} · 类型准确 ${percent(semantic.type_accuracy)} · 状态准确 ${percent(semantic.status_accuracy)}`);
  if (semantic.importance_accuracy !== null) lines.push(`    重要度准确 ${percent(semantic.importance_accuracy)}`);
  lines.push(`    预算 ${semantic.budget.actual} 条（${semantic.budget.min}–${semantic.budget.max}）${semantic.budget.fit ? '✓' : '✗'}`);
  lines.push(`    superseded 边 精确 ${percent(semantic.superseded_edges.precision)} · 召回 ${percent(semantic.superseded_edges.recall)}（期望 ${semantic.superseded_edges.expected} / 实际 ${semantic.superseded_edges.predicted}）`);
  if (semantic.missed_core.length) {
    lines.push('');
    lines.push('  漏掉的核心判断');
    for (const item of semantic.missed_core) lines.push(`    ${item.id} ${item.type}：${item.text}`);
  }
  if (semantic.type_mismatches.length) {
    lines.push('');
    lines.push('  类型分歧');
    for (const item of semantic.type_mismatches) lines.push(`    ${item.label} 期望 ${item.expected}，实际 ${item.actual}：${item.text}`);
  }
  if (semantic.missed_labels.length) {
    const supporting = semantic.missed_labels.filter(item => item.importance !== 'core');
    lines.push('');
    lines.push(`  漏抽 ${semantic.missed_labels.length} 条（核心见上；其余 ${supporting.length} 条支撑/可选，用 --json 看全量）`);
    for (const item of supporting.slice(0, 8)) lines.push(`    ${item.id} ${item.importance} ${item.type}：${item.text}`);
    if (supporting.length > 8) lines.push(`    … 另有 ${supporting.length - 8} 条`);
  }
  if (semantic.extra_predictions.length) {
    lines.push('');
    lines.push('  多抽（抽取有、标注无）');
    for (const item of semantic.extra_predictions) lines.push(`    #${item.n} ${item.type}：${item.text}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const short = option('--session');
  if (!short) {
    console.error('用法：node scripts/memory-eval.mjs --session <short> [--labels <path>] [--json]');
    process.exit(1);
  }
  const result = await evaluateSession(short, {
    labelsPath: option('--labels'),
    eventsDir: option('--events') ? resolve(option('--events')) : null,
  });
  if (has('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(formatReport(result));
}
