import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCandidates, loadMergedPairs, loadNodes, loadSessions, summarize,
} from './memory-event-candidates.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-event-candidates-'));
const source = join(root, 'data/private/memory-kernel/source');
const write = async (path, text) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
};

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const C = 'cccccccc-0000-0000-0000-000000000003';

try {
  await write(join(source, 'overlay/archive-map.json'), JSON.stringify({
    sessions: [
      { id: A, short: 'aaaaaaaa', group: 'g1' },
      { id: B, short: 'bbbbbbbb', group: 'g1' },
      { id: C, short: 'cccccccc', group: 'gq' },
    ],
  }));
  await write(join(source, `memory/${A}.md`), '---\nfirst: 2026-10-01T10:00:00+08:00\n---\n');
  await write(join(source, `memory/${B}.md`), '---\nfirst: 2026-10-02T10:00:00+08:00\n---\n');
  await write(join(source, 'entities.json'), JSON.stringify({
    entities: [
      { canonical: 'TourGrid', aliases: ['tourgrid'], kind: 'project', tier: 1 },
      { canonical: '内推人', aliases: ['秋'], kind: 'role', tier: 2 },
      { canonical: '鹰角', aliases: [], kind: 'org', tier: 1 },
    ],
  }));
  await write(join(source, `events-v3/${A}.json`), JSON.stringify({
    ents: ['TourGrid', '鹰角'],
    nodes: [
      { n: 1, t: 'decision', s: 'decided', r: [1, 1], x: 'TourGrid 升第一顺位', e: [0] },
      { n: 2, t: 'decision', s: 'decided', r: [2, 2], x: '鹰角初筛无消息', e: [1] },
    ],
  }));
  await write(join(source, `events-v3/${B}.json`), JSON.stringify({
    ents: ['tourgrid', '秋'],
    nodes: [
      { n: 1, t: 'decision', s: 'decided', r: [1, 1], x: 'TourGrid 与可简吧并列', e: [0] },
      { n: 2, t: 'decision', s: 'decided', r: [2, 2], x: '不问内推人秋', e: [1] },
    ],
  }));
  await write(join(source, `events-v3/${C}.json`), JSON.stringify({
    ents: ['TourGrid'],
    nodes: [{ n: 1, t: 'decision', s: 'decided', r: [1, 1], x: '别的组', e: [0] }],
  }));
  await write(join(source, 'global/l5-g1.json'), JSON.stringify({
    nodes: [{ n: 1, src: [{ s: 'aaaaaaaa', n: 1 }, { s: 'bbbbbbbb', n: 1 }] }],
  }));

  const sessions = await loadSessions(root, 'g1');
  assert.equal(sessions.size, 2, '只加载指定组');
  assert.ok(sessions.get('aaaaaaaa').first > 0);

  const nodes = await loadNodes(root, 'events-v3', sessions);
  assert.equal(nodes.length, 4);
  const node = nodes.find(item => item.session === 'bbbbbbbb' && item.n === 2);
  assert.deepEqual(node.entities.map(item => item.canonical), ['内推人'], '别名归一到 canonical');

  const merged = await loadMergedPairs(root, 'g1');
  assert.equal(merged.size, 1);

  const pairs = buildCandidates(nodes, { windowDays: 14, mergedPairs: merged });
  assert.ok(pairs.length > 0);
  const tourgrid = pairs.find(pair => pair.shared.includes('TourGrid'));
  assert.ok(tourgrid, '共享 tier1 实体应成为候选');
  assert.equal(tourgrid.already_merged, true, '已合并的对应被标记');
  assert.ok(tourgrid.score > 0);
  assert.ok(!pairs.some(pair => pair.a.session === pair.b.session), '同会话不配对');

  const stats = summarize(pairs);
  assert.equal(stats.pairs, pairs.length);
  assert.ok(stats.strong + stats.weak === pairs.length);

  // A 3-day window drops the 1-day pairs? No: it keeps them and drops the far ones.
  const narrow = buildCandidates(nodes, { windowDays: 0.5, mergedPairs: merged });
  assert.ok(narrow.length < pairs.length, '窗口收紧后候选变少');

  console.log('PASS event candidates: session loading, alias normalization, pair building, merged marking, window');
} finally {
  await rm(root, { recursive: true, force: true });
}
