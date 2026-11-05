import assert from 'node:assert/strict';
import {
  bm25, buildIndex, entityHits, matchEntities, search, timeRanking, tokenize,
} from './memory-search-core.mjs';

// Tokenization: Chinese bigrams plus Latin words.
assert.deepEqual(tokenize('TourGrid 界面'), ['tourgrid', '界面']);
assert.deepEqual(tokenize('以撒的竞合'), ['以撒', '撒的', '的竞', '竞合']);
assert.deepEqual(tokenize('a'), ['a']);

const entities = [
  { canonical: 'TourGrid', aliases: ['tourgrid'] },
  { canonical: '内推人', aliases: ['秋'] },
];
assert.deepEqual(matchEntities('TourGrid 的界面', entities), ['TourGrid']);
assert.deepEqual(matchEntities('问秋', entities), ['内推人']);
assert.deepEqual(matchEntities('无关', entities), []);

const docs = [
  { kind: 'L5', title: 'L5 #1', text: 'TourGrid 界面改判为官方/社区/独立三层', valid_at: '2026-10-14', invalid_at: null },
  { kind: 'L5', title: 'L5 #2', text: 'TourGrid 旧界面方案被推翻', valid_at: '2026-10-12', invalid_at: '2026-10-14' },
  { kind: 'L5', title: 'L5 #3', text: '鹰角初筛仍无消息', valid_at: '2026-10-20', invalid_at: null },
  { kind: '记忆', title: '内推人', text: '问内推人秋，答不清楚', valid_at: null, invalid_at: null },
];
const index = buildIndex(docs, entities);
assert.equal(index.docs.length, 4);
assert.ok(index.postings['tourgrid']);
assert.equal(index.df['tourgrid'], 2);
assert.ok(index.avgdl > 0);
assert.deepEqual(index.entities['TourGrid'].sort(), [0, 1]);
assert.deepEqual(index.entities['内推人'], [3]);

const ranked = bm25(index, 'TourGrid 界面');
assert.equal(ranked.length, 2);
assert.ok(ranked[0][1] > 0);

const entityRanked = entityHits(index, 'TourGrid');
assert.deepEqual(entityRanked.map(item => item[0]).sort(), [0, 1]);

// Current facts rank above superseded ones.
const time = timeRanking(index);
assert.ok(time.findIndex(item => item[0] === 0) < time.findIndex(item => item[0] === 1));

const hits = search(index, 'TourGrid 界面', { limit: 4 });
assert.ok(hits.length >= 2);
assert.ok(hits[0].text.includes('TourGrid'));
assert.ok(hits.every(hit => typeof hit.score === 'number'));

// A query with no matching term returns nothing: the time signal only
// reorders matches, it must not introduce docs.
const empty = search(index, '完全不存在的词', { limit: 4 });
assert.equal(empty.length, 0);

console.log('PASS memory search: tokenize, entity match, BM25, entity/time signals, RRF');
