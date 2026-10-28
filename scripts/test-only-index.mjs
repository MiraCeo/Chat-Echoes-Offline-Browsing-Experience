import assert from 'node:assert/strict';
import { indexForOnlyIds } from './build-library.mjs';

// `--only` 应该复用索引，但索引落后于磁盘（刚导入了新快照）时必须先重建一次，
// 而不是用旧索引直接报“档案库中没有这些会话”（2026-10-28 扩展直连的真实故障）。
const index = (...ids) => ({ kind: 'ceobe.library', conversations: ids.map(id => ({ id })) });

let rebuilds = 0;
let result = await indexForOnlyIds(['a', 'b'], {
  readIndex: async () => index('a', 'b'),
  rebuildIndex: async () => { rebuilds += 1; return index('a', 'b'); },
});
assert.deepEqual([result.rebuilt, rebuilds], [false, 0], 'a fresh index is reused without rebuilding');

result = await indexForOnlyIds(['a', 'new'], {
  readIndex: async () => index('a'),
  rebuildIndex: async () => { rebuilds += 1; return index('a', 'new'); },
});
assert.deepEqual([result.rebuilt, rebuilds, result.library.conversations.length], [true, 1, 2], 'a stale index is rebuilt once');
assert.ok(result.library.conversations.some(entry => entry.id === 'new'));

await assert.rejects(() => indexForOnlyIds(['missing'], {
  readIndex: async () => index('a'),
  rebuildIndex: async () => index('a'),
}), /档案库中没有这些会话：missing/, 'a genuinely missing id still fails clearly');

let rebuildCount = 0;
await assert.rejects(() => indexForOnlyIds(['a', 'missing'], {
  readIndex: async () => index('a'),
  rebuildIndex: async () => { rebuildCount += 1; return index('a'); },
}), /missing/);
assert.equal(rebuildCount, 1, 'the index is rebuilt at most once');

console.log('PASS only-index: fresh index reused, stale index rebuilt once, missing id still fails, no rebuild loop');
