import assert from 'node:assert/strict';
import { buildCommunities, nodeTime, reportInput } from './memory-communities.mjs';

const times = new Map([
  ['aaaaaaaa', Date.parse('2026-10-01T10:00:00+08:00')],
  ['bbbbbbbb', Date.parse('2026-10-02T10:00:00+08:00')],
  ['cccccccc', Date.parse('2026-10-20T10:00:00+08:00')],
]);

const tree = {
  nodes: [
    { n: 1, t: 'decision', s: 'decided', w: 'core', thread: 'tourgrid', x: '甲', src: [{ s: 'aaaaaaaa', n: 1, r: [1, 1] }] },
    { n: 2, t: 'decision', s: 'decided', w: 'supporting', thread: 'tourgrid', x: '乙', src: [{ s: 'aaaaaaaa', n: 2, r: [2, 2] }] },
    { n: 3, t: 'decision', s: 'decided', w: 'core', thread: 'tourgrid', x: '丙', src: [{ s: 'bbbbbbbb', n: 1, r: [1, 1] }] },
    { n: 4, t: 'decision', s: 'decided', w: 'core', thread: 'tourgrid', x: '丁', src: [{ s: 'cccccccc', n: 1, r: [1, 1] }] },
    { n: 5, t: 'decision', s: 'decided', w: 'core', thread: null, x: '戊', src: [{ s: 'bbbbbbbb', n: 2, r: [2, 2] }] },
  ],
  edges: [[1, 2, 'precedes']],
};

assert.ok(nodeTime(tree.nodes[0], times) > 0);
assert.equal(nodeTime({ src: [{ s: 'zzzzzzzz', n: 1 }] }, times), null);

// 1-2 is one component; 3 is a single node one day later; 4 is 18 days later;
// 5 has no thread. With a large target, 1-2 and 3 merge by thread+time.
const communities = buildCommunities(tree, times, { targetSize: 12, gapDays: 3 });
assert.equal(communities.length, 3, '合并后的 tourgrid 社区 + 远期节点 + 未归属');
const first = communities.find(item => item.nodes.includes(1));
assert.deepEqual(first.nodes, [1, 2, 3], '同主线、时间相邻的分量应合并');
assert.equal(first.thread, 'tourgrid');
assert.equal(first.from, '2026-10-01');
assert.equal(first.to, '2026-10-02');
const later = communities.find(item => item.nodes.includes(4));
assert.deepEqual(later.nodes, [4]);
const orphan = communities.find(item => item.nodes.includes(5));
assert.equal(orphan.thread, null);

// A small target stops the merge: 1-2 (2 nodes) + 3 would exceed 2.
const split = buildCommunities(tree, times, { targetSize: 2, gapDays: 3 });
assert.equal(split.length, 4);
assert.deepEqual(split.find(item => item.nodes.includes(1)).nodes, [1, 2]);
assert.deepEqual(split.find(item => item.nodes.includes(3)).nodes, [3]);

const input = reportInput(tree, first);
assert.equal(input.schema, 'ceobe.community-report-input/1');
assert.equal(input.nodes.length, 3);
assert.deepEqual(input.edges.map(edge => edge.rel), ['precedes']);
assert.ok(input.nodes[0].sources[0].includes('#'));

console.log('PASS communities: graph components, thread+time merge, target size, report input');
