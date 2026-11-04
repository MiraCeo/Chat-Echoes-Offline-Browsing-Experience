import assert from 'node:assert/strict';
import { autoMetrics, matchNodes, scoreLabels } from './memory-eval.mjs';

const l4 = {
  nodes: [
    { n: 1, t: 'decision', s: 'superseded', r: [1, 2], x: '旧方案：先问内推人' },
    { n: 2, t: 'decision', s: 'decided', r: [3, 3], x: '改判不问' },
    { n: 3, t: 'problem', s: 'pending', r: [4, 5], x: '简历画像差距' },
  ],
  edges: [[1, 2, 'superseded']],
};

const labels = {
  nodes: [
    { id: 'e1', type: 'decision', status: 'superseded', rounds: [1, 2], must_include: ['内推人'] },
    { id: 'e2', type: 'decision', status: 'decided', rounds: [3, 3], must_include: ['不问'] },
    { id: 'e3', type: 'problem', status: 'pending', rounds: [4, 5], must_include: ['简历画像'] },
    { id: 'e4', type: 'decision', status: 'decided', rounds: [4, 5], must_include: ['不存在的关键词'] },
  ],
  edges: [{ from: 'e1', to: 'e2', type: 'superseded' }],
};

// Automatic metrics need no labels.
const auto = autoMetrics(l4, 'x'.repeat(1000));
assert.equal(auto.nodes, 3);
assert.equal(auto.edges, 1);
assert.equal(auto.decision_share, 0.667);
assert.equal(auto.type_counts.problem, 1);
assert.equal(auto.superseded_nodes, 1);
assert.equal(auto.superseded_broken, 0);
assert.equal(auto.provenance_coverage, 1);
assert.equal(auto.node_density_per_1k, 3);
assert.equal(auto.text_length.median, 6);

// Matching needs both round overlap and a keyword hit; each side is used once.
const matched = matchNodes(labels.nodes, l4.nodes);
assert.equal(matched.matched.length, 3);
assert.deepEqual(matched.unmatchedLabels.map(label => label.id), ['e4']);
assert.equal(matched.unmatchedPredictions.length, 0);
assert.equal(new Set(matched.matched.map(pair => pair.prediction.n)).size, 3, '一条抽取不能被两条标注同时占用');

// Semantic scoring.
const score = scoreLabels(labels, l4);
assert.equal(score.recall, 0.75);
assert.equal(score.precision, 1);
assert.equal(score.type_accuracy, 1);
assert.equal(score.status_accuracy, 1);
assert.equal(score.superseded_edges.precision, 1);
assert.equal(score.superseded_edges.recall, 1);
assert.deepEqual(score.missed_labels.map(item => item.id), ['e4']);
assert.deepEqual(score.extra_predictions, []);

// A wrong type is reported, not silently accepted.
const wrongType = { ...labels, nodes: labels.nodes.map(node => (node.id === 'e3' ? { ...node, type: 'open' } : node)) };
const wrongScore = scoreLabels(wrongType, l4);
assert.equal(wrongScore.type_accuracy, 0.667);
assert.equal(wrongScore.type_mismatches.length, 1);
assert.equal(wrongScore.type_mismatches[0].expected, 'open');

// An extra prediction is reported as a false positive.
const extra = { ...l4, nodes: [...l4.nodes, { n: 4, t: 'decision', s: 'decided', r: [6, 6], x: '多出来的判断' }] };
const extraScore = scoreLabels(labels, extra);
assert.equal(extraScore.precision, 0.75);
assert.equal(extraScore.extra_predictions.length, 1);

console.log('PASS memory eval: auto metrics, keyword+round matching, recall/precision, type and edge scoring');
