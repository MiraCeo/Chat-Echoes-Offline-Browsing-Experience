import assert from 'node:assert/strict';
import {
  buildRegistrations, planMerges, proposeEntityMappings,
} from './memory-entity-merge.mjs';

const registry = {
  entities: [
    { canonical: '以撒的竞合', aliases: ['竞合'], kind: 'project', thread: '以撒的竞合', sessions: 13, mentions: 14, first_seen: '2026-10-04', tier: 1 },
    { canonical: '竞合', aliases: [], kind: 'project', thread: null, sessions: 2, mentions: 2, first_seen: '2026-10-06', tier: 2 },
    { canonical: '系统策划', aliases: [], kind: 'role', thread: '系统策划', sessions: 5, mentions: 6, first_seen: '2026-10-01', tier: 1 },
    { canonical: 'Qwen3.5-27B', aliases: [], kind: 'other', thread: null, sessions: 1, mentions: 1, first_seen: '2026-10-02', tier: 3 },
    { canonical: 'Qwen3.8-27B', aliases: [], kind: 'other', thread: null, sessions: 1, mentions: 1, first_seen: '2026-10-03', tier: 3 },
  ],
  rejected: [],
};

// Alias collision merges into the higher-tier canonical.
const plan = planMerges(registry, { threshold: 0.85 });
assert.equal(plan.groups.length, 1);
assert.equal(plan.groups[0].canonical, '以撒的竞合');
assert.deepEqual(plan.groups[0].merged_from, ['竞合']);
assert.equal(plan.after, 4);

// Version variants must not merge at a normal threshold.
assert.ok(!plan.groups.some(group => group.canonical.startsWith('Qwen')));

// L4 alignment: known, containment-mappable, and unknown.
const counts = new Map([
  ['系统策划', { count: 3, sessions: new Set(['a']), first_seen: '2026-10-01' }],
  ['系统策划（实习）', { count: 1, sessions: new Set(['a']), first_seen: '2026-10-01' }],
  ['银凇界面主题', { count: 1, sessions: new Set(['b']), first_seen: '2026-10-05' }],
  ['0.6', { count: 1, sessions: new Set(['b']), first_seen: '2026-10-05' }],
]);
const { map, register } = proposeEntityMappings(registry, counts, { threshold: 0.85 });
assert.deepEqual(map.map(item => item.name), ['系统策划（实习）']);
assert.equal(map[0].canonical, '系统策划');
assert.equal(map[0].via, 'containment');
assert.deepEqual(register.map(item => item.name).sort(), ['0.6', '银凇界面主题'].sort());
assert.ok(!map.some(item => item.name === '0.6'), '纯数字名不应靠包含关系映射');

// Registration derives tier from the number of sessions.
const additions = buildRegistrations([
  { name: '甲', count: 3, sessions: 3, first_seen: '2026-10-01', tier: 1 },
  { name: '乙', count: 2, sessions: 2, first_seen: '2026-10-02', tier: 2 },
  { name: '丙', count: 1, sessions: 1, first_seen: '2026-10-03', tier: 3 },
]);
assert.deepEqual(additions.map(item => item.tier), [1, 2, 3]);
assert.equal(additions[0].kind, 'other');
assert.equal(additions[0].thread, null);

console.log('PASS entity merge: alias collision, version variants kept apart, containment mapping, tier derivation');
