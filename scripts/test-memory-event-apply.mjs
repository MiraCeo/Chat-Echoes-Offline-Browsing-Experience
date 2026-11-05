import assert from 'node:assert/strict';
import { applyPlan, buildL4Index, buildPlan } from './memory-event-apply.mjs';

const tree = {
  sessions: ['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'],
  nodes: [
    { n: 1, t: 'decision', s: 'decided', w: 'core', thread: 'tourgrid', x: '甲', src: [{ s: 'aaaaaaaa', n: 1 }] },
    { n: 2, t: 'decision', s: 'decided', w: 'supporting', thread: null, x: '乙', src: [{ s: 'bbbbbbbb', n: 1 }] },
    { n: 3, t: 'decision', s: 'decided', w: 'core', thread: null, x: '丙', src: [{ s: 'bbbbbbbb', n: 2 }] },
  ],
  edges: [[1, 2, 'precedes']],
};

const index = buildL4Index(tree);
assert.equal(index.get('aaaaaaaa#1'), 1);
assert.equal(index.get('bbbbbbbb#2'), 3);

const pairs = new Map([
  ['p1', { id: 'p1', a: { session: 'aaaaaaaa', n: 1 }, b: { session: 'bbbbbbbb', n: 1 } }],
  ['p2', { id: 'p2', a: { session: 'aaaaaaaa', n: 1 }, b: { session: 'bbbbbbbb', n: 2 } }],
  ['p3', { id: 'p3', a: { session: 'aaaaaaaa', n: 1 }, b: { session: 'bbbbbbbb', n: 2 } }],
]);

// Merge 1+2, and let 3 supersede the merged node.
const plan = buildPlan(tree, pairs, {
  merges: [{ id: 'p1', duplicate: 'yes', contradiction: 'none', confidence: 'high', reason: '同一件事' }],
  supersedes: [{ id: 'p2', contradiction: 'b_supersedes_a', confidence: 'high', reason: '后者更正' }],
  unsure: [{ id: 'p3', reason: '拿不准' }],
});
assert.equal(plan.merges.length, 1);
assert.equal(plan.supersedes.length, 1);
assert.equal(plan.supersedes[0].from, 1, 'b_supersedes_a：边从 a 指向 b');
assert.equal(plan.supersedes[0].to, 3);
assert.equal(plan.unsure.length, 1);

const result = applyPlan(tree, plan);
assert.equal(result.tree.nodes.length, 2, '合并后少一个节点');
const merged = result.tree.nodes.find(node => node.src.length === 2);
assert.ok(merged, '合并节点应有两个来源');
assert.deepEqual(merged.src.map(src => `${src.s}#${src.n}`).sort(), ['aaaaaaaa#1', 'bbbbbbbb#1']);
assert.equal(merged.w, 'core', '重要度取最高');
assert.equal(merged.thread, 'tourgrid', '主线取非空的那个');

const superseded = result.tree.edges.find(edge => edge[2] === 'superseded');
assert.ok(superseded, '应补一条 superseded 边');
const from = result.tree.nodes.find(node => node.n === superseded[0]);
assert.equal(from.s, 'superseded', '被推翻的节点状态应为 superseded');
assert.equal(result.tree.edges.filter(edge => edge[2] === 'superseded').length, 1);

// Already-merged pairs are skipped, not merged twice.
const again = buildPlan(result.tree, pairs, {
  merges: [{ id: 'p1', duplicate: 'yes', contradiction: 'none', confidence: 'high', reason: '同一件事' }],
  supersedes: [],
  unsure: [],
});
assert.equal(again.merges.length, 0);
assert.ok(again.skipped.some(item => item.reason.includes('同一 L5 节点')));

console.log('PASS event apply: L4 index, merge plan, supersede direction, status invariant, idempotent skip');
