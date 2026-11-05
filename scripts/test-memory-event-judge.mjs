import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, buildBatches, formatBatch } from './memory-event-judge.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-event-judge-'));
const source = join(root, 'data/private/memory-kernel/source');
const judge = join(root, 'data/private/memory-kernel/judge');
const write = async (path, text) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
};

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

try {
  await write(join(source, 'overlay/archive-map.json'), JSON.stringify({
    sessions: [
      { id: A, short: 'aaaaaaaa', group: 'g1' },
      { id: B, short: 'bbbbbbbb', group: 'g1' },
    ],
  }));
  await write(join(source, `memory/${A}.md`), '---\nfirst: 2026-10-01T10:00:00+08:00\n---\n');
  await write(join(source, `memory/${B}.md`), '---\nfirst: 2026-10-02T10:00:00+08:00\n---\n');
  await write(join(source, 'entities.json'), JSON.stringify({
    entities: [{ canonical: 'TourGrid', aliases: [], kind: 'project', tier: 1 }],
  }));
  await write(join(source, `events-v3/${A}.json`), JSON.stringify({
    ents: ['TourGrid'],
    nodes: [{ n: 1, t: 'decision', s: 'decided', r: [1, 1], x: 'TourGrid 升第一顺位', e: [0] }],
  }));
  await write(join(source, `events-v3/${B}.json`), JSON.stringify({
    ents: ['TourGrid'],
    nodes: [{ n: 1, t: 'decision', s: 'decided', r: [1, 1], x: 'TourGrid 与可简吧并列', e: [0] }],
  }));
  await write(join(source, 'global/l5-g1.json'), JSON.stringify({
    nodes: [{ n: 1, src: [{ s: 'aaaaaaaa', n: 1 }, { s: 'bbbbbbbb', n: 1 }] }],
  }));

  const built = await buildBatches(root, { group: 'g1', top: 10, includeKnown: true, batchSize: 1 });
  assert.equal(built.sessions, 2);
  assert.equal(built.nodes, 2);
  assert.equal(built.selected, 1, '同一对候选只出现一次');
  assert.equal(built.batches.length, 1);

  const batch = formatBatch(built.batches[0], 1);
  assert.equal(batch.schema, 'ceobe.event-judge-batch/1');
  assert.equal(batch.pairs.length, 1);
  assert.equal(batch.pairs[0].id, 'p1-1');
  assert.ok(batch.pairs[0].a.text.includes('TourGrid'));

  // Aggregate two result files.
  await write(join(judge, 'result-01.json'), JSON.stringify({
    batch: 1,
    verdicts: [
      { id: 'p1-1', duplicate: 'yes', contradiction: 'none', confidence: 'high', reason: '同一件事' },
      { id: 'p1-2', duplicate: 'no', contradiction: 'a_supersedes_b', confidence: 'medium', reason: '后者推翻前者' },
      { id: 'p1-3', duplicate: 'unsure', contradiction: 'unsure', confidence: 'low', reason: '拿不准' },
      { id: 'p1-4', duplicate: 'yes', contradiction: 'b_supersedes_a', confidence: 'medium', reason: '同一件事被更正' },
    ],
  }));
  await write(join(judge, 'result-02.json'), JSON.stringify({
    batch: 2,
    verdicts: [
      { id: 'p2-1', duplicate: 'no', contradiction: 'none', confidence: 'high', reason: '无关' },
    ],
  }));

  const result = await aggregate(root, judge);
  assert.equal(result.verdicts, 5);
  assert.equal(result.summary.merge, 1, 'duplicate+contradiction 是推翻，不是合并');
  assert.equal(result.summary.supersede, 2);
  assert.equal(result.summary.unsure, 1);
  assert.equal(result.summary.none, 1);
  assert.equal(result.merges[0].id, 'p1-1');
  assert.deepEqual(result.supersedes.map(item => item.id).sort(), ['p1-2', 'p1-4']);

  console.log('PASS event judge: batch building, known-pair dedupe, batch format, verdict aggregation');
} finally {
  await rm(root, { recursive: true, force: true });
}
