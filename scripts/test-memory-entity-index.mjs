import assert from 'node:assert/strict';
import { buildEntityIndex, buildLookup, nodeEntities } from './memory-entity-index.mjs';

const registry = {
  entities: [
    { canonical: 'TourGrid', aliases: ['tourgrid'], kind: 'project', tier: 1 },
    { canonical: '内推人', aliases: ['秋'], kind: 'role', tier: 2 },
    { canonical: '鹰角', aliases: [], kind: 'org', tier: 1 },
  ],
};

const lookup = buildLookup(registry);
assert.equal(lookup.get('tourgrid').canonical, 'TourGrid');
assert.equal(lookup.get('秋').canonical, '内推人');
assert.equal(lookup.get('不存在'), undefined);

const session = { short: 'aaaaaaaa', l4: { ents: ['鹰角', '内推人', 'TourGrid'] } };
// `e` indices resolve against the session's ents; text matches add the rest.
assert.deepEqual(nodeEntities({ n: 1, e: [0], x: '问秋' }, session, lookup).sort(), ['内推人', '鹰角'].sort());
assert.deepEqual(nodeEntities({ n: 2, e: [], x: 'TourGrid 的界面' }, session, lookup), ['TourGrid']);
assert.deepEqual(nodeEntities({ n: 3, e: [9], x: '无关' }, session, lookup), []);

const view = {
  sessions: [session],
  groups: [{
    group: 'g1',
    l5: {
      nodes: [
        { n: 1, s: 'decided', w: 'core', thread: 'tourgrid', x: 'TourGrid 升第一', e: [2], src: [{ s: 'aaaaaaaa', r: [3, 3] }] },
        { n: 2, s: 'superseded', w: 'supporting', thread: 'yj-intern', x: '问内推人秋', e: [1], src: [{ s: 'aaaaaaaa', r: [5, 5] }] },
      ],
    },
  }],
};
const index = buildEntityIndex(view, registry, { group: 'g1' });
assert.equal(index.schema, 'ceobe.entity-index/1');
const tourgrid = index.entities.find(item => item.canonical === 'TourGrid');
assert.equal(tourgrid.events.length, 1);
assert.equal(tourgrid.events[0].n, 1);
assert.equal(tourgrid.events[0].session, 'aaaaaaaa');
assert.equal(tourgrid.events[0].round, 3);
const referral = index.entities.find(item => item.canonical === '内推人');
assert.equal(referral.events[0].status, 'superseded');
assert.ok(index.entities.every(item => item.events.length > 0));

console.log('PASS entity index: lookup, e-index resolution, text match, inversion');
