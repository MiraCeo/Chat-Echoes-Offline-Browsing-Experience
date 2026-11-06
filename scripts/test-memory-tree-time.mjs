import assert from 'node:assert/strict';
import {
  dayOf, deriveTreeWindows, filterTreeAt, parseAsOf, sourceTime, validateTreeWindows,
} from './memory-tree-time.js';

// Local noon keeps the fixture on the same calendar day in every timezone.
const at = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0).getTime() / 1000;

const tree = {
  nodes: [
    { n: 1, t: 'decision', s: 'superseded', x: '旧方案', ts: at(2026, 10, 11) },
    { n: 2, t: 'decision', s: 'decided', x: '新方案', ts: at(2026, 10, 13) },
    { n: 3, t: 'event', s: 'decided', x: '后续', ts: at(2026, 10, 20) },
    { n: 4, t: 'open', s: 'pending', x: '未决', ts: at(2026, 10, 21) },
  ],
  edges: [
    [1, 2, 'superseded'],
    [2, 3, 'precedes'],
    [1, 3, 'caused_by'],
  ],
};

// Derivation: node windows from the outgoing superseded edge, edge windows from
// the endpoints. Edges stay arrays so `edge[0..2]` readers keep working.
const derived = deriveTreeWindows(tree);
const node = number => derived.nodes.find(item => item.n === number);
assert.equal(node(1).valid_at, at(2026, 10, 11));
assert.equal(node(1).invalid_at, at(2026, 10, 13));
assert.equal(node(1).superseded_by, 2);
assert.equal(node(2).invalid_at, null);
assert.equal(node(2).superseded_by, null);
assert.equal(node(4).invalid_at, null);
assert.equal(derived.edges.length, 3);
assert.deepEqual(derived.edges[0], [1, 2, 'superseded', at(2026, 10, 11), at(2026, 10, 13)]);
assert.deepEqual(derived.edges[1], [2, 3, 'precedes', at(2026, 10, 13), null]);
assert.deepEqual(derived.edges[2], [1, 3, 'caused_by', at(2026, 10, 11), null]);
assert.equal(derived.edges[0][0], 1, '旧读法 edge[0] 仍可用');
assert.equal(derived.edges[0][2], 'superseded', '旧读法 edge[2] 仍可用');

// Belief model: support counts sources, refined lists the evidence timeline.
const withSources = deriveTreeWindows({
  nodes: [
    { n: 1, t: 'decision', s: 'decided', x: '甲', ts: at(2026, 10, 11), src: [{ s: 'aaaaaaaa', r: [1, 1] }, { s: 'bbbbbbbb', r: [2, 2] }] },
    { n: 2, t: 'decision', s: 'superseded', x: '乙', ts: at(2026, 10, 12), src: [{ s: 'aaaaaaaa', r: [3, 3] }] },
    { n: 3, t: 'decision', s: 'decided', x: '丙', ts: at(2026, 10, 13) },
  ],
  edges: [[2, 3, 'superseded']],
});
const belief = number => withSources.nodes.find(item => item.n === number);
assert.deepEqual(belief(1).support, { sources: 2, sessions: 2 });
assert.deepEqual(belief(2).support, { sources: 1, sessions: 1 });
assert.deepEqual(belief(3).support, { sources: 0, sessions: 0 });
assert.equal(belief(1).refined.filter(item => item.kind === 'source').length, 2);
assert.deepEqual(belief(2).refined.at(-1), { kind: 'superseded', by: 3, at: at(2026, 10, 13) });
assert.deepEqual(validateTreeWindows(withSources, withSources), []);

// Group trees have no ts: derive it from the session date plus the round, and
// break same-round ties by the L4 node number so supersede edges point forward.
const times = new Map([['aaaaaaaa', at(2026, 10, 11)]]);
assert.equal(sourceTime({ src: [{ s: 'aaaaaaaa', r: [1, 1], n: 1 }] }, times), at(2026, 10, 11) + 5 * 60 * 1000 + 1000);
assert.equal(sourceTime({ src: [{ s: 'zzzzzzzz', r: [1, 1] }] }, times), null);
const noTs = deriveTreeWindows({
  nodes: [
    { n: 1, t: 'decision', s: 'superseded', x: '甲', src: [{ s: 'aaaaaaaa', r: [55, 55], n: 32 }] },
    { n: 2, t: 'decision', s: 'decided', x: '乙', src: [{ s: 'aaaaaaaa', r: [55, 55], n: 33 }] },
  ],
  edges: [[1, 2, 'superseded']],
}, times);
assert.ok(noTs.nodes[1].valid_at > noTs.nodes[0].valid_at, '同轮次按 L4 节点号分先后');
assert.deepEqual(validateTreeWindows({ nodes: noTs.nodes, edges: noTs.edges }, noTs), []);

// Invariants hold on the clean tree.
assert.deepEqual(validateTreeWindows(tree, derived), []);

// A superseded node without an outgoing edge is a broken window.
const orphan = {
  nodes: [{ n: 1, s: 'superseded', ts: at(2026, 10, 11) }],
  edges: [],
};
assert.ok(validateTreeWindows(orphan).some(issue => issue.includes('没有出边')));

// A non-superseded node must not carry invalid_at.
const wrongStatus = {
  nodes: [
    { n: 1, s: 'decided', ts: at(2026, 10, 11) },
    { n: 2, s: 'decided', ts: at(2026, 10, 13) },
  ],
  edges: [[1, 2, 'superseded']],
};
assert.ok(validateTreeWindows(wrongStatus).some(issue => issue.includes('不是 superseded')));

// Dangling endpoints, self loops and duplicate superseded edges are rejected.
assert.ok(validateTreeWindows({ nodes: tree.nodes, edges: [[1, 99, 'superseded']] })
  .some(issue => issue.includes('端点不存在')));
assert.ok(validateTreeWindows({ nodes: tree.nodes, edges: [[1, 1, 'precedes']] })
  .some(issue => issue.includes('自环')));
assert.ok(validateTreeWindows({
  nodes: tree.nodes,
  edges: [[1, 2, 'superseded'], [1, 3, 'superseded']],
}).some(issue => issue.includes('多条 superseded 出边')));

// Point-in-time filtering.
const before = filterTreeAt(derived, '2026-10-12');
assert.deepEqual(before.nodes.map(item => item.n), [1]);
assert.equal(before.edges.length, 0);
assert.equal(before.hidden, 3);
assert.equal(before.laterSuperseded, 1, '10-12 时 #1 还成立，之后才被推翻');

const onSupersedeDay = filterTreeAt(derived, '2026-10-13');
assert.deepEqual(onSupersedeDay.nodes.map(item => item.n), [1, 2]);
assert.equal(onSupersedeDay.edges.length, 1);
assert.equal(onSupersedeDay.laterSuperseded, 0, '推翻当天不再算“后来被推翻”');

const end = filterTreeAt(derived, '2026-10-21');
assert.equal(end.nodes.length, 4);
assert.equal(end.edges.length, 3);
assert.equal(end.hidden, 0);

const all = filterTreeAt(derived, null);
assert.equal(all.nodes.length, 4);
assert.equal(all.edges.length, 3);
assert.equal(all.hidden, 0);
assert.equal(all.asOf, null);

// Date parsing rejects impossible and malformed values.
assert.equal(parseAsOf('2026-10-22'), '2026-10-22');
assert.equal(parseAsOf(' 2026-10-22 '), '2026-10-22');
assert.equal(parseAsOf('2026-02-31'), null);
assert.equal(parseAsOf('2026-1-1'), null);
assert.equal(parseAsOf(''), null);
assert.equal(parseAsOf(null), null);
assert.equal(parseAsOf('abc'), null);

assert.equal(dayOf(at(2026, 10, 11)), '2026-10-11');
assert.equal(dayOf(null), null);
assert.equal(dayOf(undefined), null);

console.log('PASS memory tree time: node/edge windows, invariants, point-in-time filter and date parsing');
