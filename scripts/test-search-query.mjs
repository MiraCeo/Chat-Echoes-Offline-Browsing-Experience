import assert from 'node:assert/strict';
import {
  SEARCH_SYNTAX_VERSION, KINDS, normalize, foldWithMap,
  parseQuery, chatMatches, titleHit, bodyScoped, turnMatches,
  titleHighlights, bodyHighlights, titleParts, bodyParts, occurrences, emptyCopy,
} from './search-query.mjs';

// 搜索语法是纯函数层：解析（引号/排除/任一/字段）与匹配（聊天级、正文级、高亮切片）。
// 浏览器弹窗与将来的 MCP server 共用这里的口径，因此这里覆盖到每条规则的边界。

/* ---------- 折叠 ---------- */
assert.equal(normalize('  ＡＢＣ  '), 'abc', 'NFKC + lowercase + trim');
assert.equal(normalize('ＦＵＬＬ'), 'full', 'full-width letters fold');
const folded = foldWithMap('Ａb🙂c');
assert.equal(folded.text, 'ab🙂c', 'per-character NFKC folding');
assert.deepEqual([...folded.starts], [0, 1, 2, 4], 'folded index maps back to the original character');
assert.deepEqual([...folded.ends], [1, 2, 4, 5], 'astral characters keep their two code units');
const ligature = foldWithMap('ﬁx');
assert.equal(ligature.text, 'fix', 'ligature expands under NFKC');
assert.deepEqual([...ligature.starts], [0, 0, 1], 'both expansion characters point at the ligature');
assert.deepEqual([...ligature.ends], [1, 1, 2]);

/* ---------- 解析 ---------- */
const empty = parseQuery('   ');
assert.deepEqual(empty.terms, [], 'blank input has no terms');
assert.equal(empty.signature, parseQuery('').signature, 'blank forms share a signature');
assert.equal(empty.syntax, SEARCH_SYNTAX_VERSION);

const plain = parseQuery('Needle');
assert.deepEqual(plain.terms.map(term => [term.field, term.text, term.alternatives.map(item => item.folded)]), [[null, 'Needle', ['needle']]]);
assert.equal(bodyScoped(plain), true, 'a free term scopes the body');
assert.deepEqual(bodyHighlights(plain), ['needle']);
assert.deepEqual(titleHighlights(plain), ['needle'], 'free terms also highlight titles');
assert.equal(parseQuery('NEEDLE').signature, plain.signature, 'signature is case/width insensitive');

const phrase = parseQuery('"exact  phrase" tail');
assert.equal(phrase.terms.length, 2, 'quoted phrase stays one term');
assert.deepEqual(phrase.terms[0].alternatives.map(item => item.folded), ['exact  phrase'], 'inner spaces survive');
assert.deepEqual(phrase.terms[1].alternatives.map(item => item.folded), ['tail']);

const excluded = parseQuery('keep -drop -title:skip');
assert.deepEqual(excluded.terms.map(term => term.field), [null]);
assert.deepEqual(excluded.excludedTerms.map(term => [term.field, term.alternatives[0].folded]), [[null, 'drop'], ['title', 'skip']]);
assert.equal(bodyScoped(excluded), true, 'a free positive term scopes the body');
assert.equal(bodyScoped(parseQuery('-drop')), false, 'a negative-only query filters titles, it does not list the whole body');
assert.equal(bodyScoped(parseQuery('-title:skip')), false, 'a title-only exclusion does not scope the body');

const alternatives = parseQuery('alpha/beta "gamma/delta" https://example.invalid/a/b');
assert.deepEqual(alternatives.terms[0].alternatives.map(item => item.folded), ['alpha', 'beta'], 'A/B means either');
assert.deepEqual(alternatives.terms[1].alternatives.map(item => item.folded), ['gamma/delta'], 'quotes protect slashes');
assert.deepEqual(alternatives.terms[2].alternatives.map(item => item.folded), ['https://example.invalid/a/b'], 'URLs are not split');
assert.deepEqual(parseQuery('a\\/b').terms[0].alternatives.map(item => item.folded), ['a/b'], '\\/ is a literal slash');

const titles = parseQuery('title:"积分 曲线" free');
assert.deepEqual(titles.terms.map(term => [term.field, term.alternatives.map(item => item.folded)]),
  [['title', ['积分 曲线']], [null, ['free']]]);
assert.deepEqual(titleHighlights(titles), ['积分 曲线', 'free']);
assert.deepEqual(bodyHighlights(titles), ['free'], 'title: terms never highlight bodies');

const roles = parseQuery('from:user/assistant gpt:oops from:gpt');
assert.deepEqual(roles.from, [['user', 'assistant'], ['assistant']], 'from: accepts aliases and alternatives; each token is one OR group');
assert.equal(roles.terms.length, 1, 'an unknown role falls back to literal text');
assert.deepEqual(roles.terms[0].alternatives[0].folded, 'gpt:oops');

const kinds = parseQuery('has:code/image has:表格');
assert.deepEqual(kinds.has, [['code', 'image']], 'known kinds are kept as one OR group');
assert.equal(kinds.terms.length, 1, 'an unknown kind falls back to literal text');
assert.deepEqual(KINDS, ['code', 'table', 'image', 'attachment', 'audio']);

const created = parseQuery('created:2025-06 created:>2024 created:<=2026-01-31');
assert.equal(created.created.length, 3);
assert.deepEqual(created.created[0], [{ operator: '=', start: 20250601, end: 20250631, label: '2025-06' }]);
assert.deepEqual(created.created[1], [{ operator: '>', start: 20240101, end: 20241231, label: '2024' }]);
assert.deepEqual(created.created[2], [{ operator: '<=', start: 20260131, end: 20260131, label: '2026-01-31' }]);
assert.equal(parseQuery('created:2025-13').created.length, 0, 'invalid months do not become filters');
assert.equal(parseQuery('created:2025-13').terms.length, 1, 'invalid dates fall back to text');

const messages = parseQuery('messages:>20 messages:5 -messages:<=2');
assert.deepEqual(messages.messages, [[{ operator: '>', value: 20 }], [{ operator: '=', value: 5 }]]);
assert.deepEqual(messages.excludedMessages, [[{ operator: '<=', value: 2 }]]);

const literal = parseQuery('region:eu -1 \\-2');
assert.deepEqual(literal.terms.map(term => term.alternatives[0].folded), ['region:eu', '-1', '-2'], 'unknown fields stay literal; negative numbers and \\- stay text');
assert.deepEqual(literal.excludedTerms, [], 'there is no accidental exclusion for numbers');

/* ---------- 聊天级匹配 ---------- */
const chat = (extra = {}) => ({ id: 'c1', title: '积分曲线 比赛', created_at: 1770000000, turn_count: 25, ...extra });
// created: 按阅读器显示的本地日期比较，夹具用本地时间构造，避免断言依赖运行机器的时区。
const date = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime() / 1000;
const roster = [
  chat({ id: 'old', title: '旧会话', created_at: date(2024, 12, 31, 23), turn_count: 5 }),
  chat({ id: 'june', title: '积分曲线 比赛', created_at: date(2025, 6, 15), turn_count: 25 }),
  chat({ id: 'next', title: 'Another 积分', created_at: date(2026, 1, 5), turn_count: 80 }),
];
const ids = (query, list = roster) => list.filter(item => chatMatches(query, item)).map(item => item.id);
assert.deepEqual(ids(parseQuery('')), ['old', 'june', 'next'], 'an empty query passes every chat');
assert.deepEqual(ids(parseQuery('created:2025')), ['june'], 'created: filters by year');
assert.deepEqual(ids(parseQuery('created:2025-06')), ['june'], 'created: filters by month');
assert.deepEqual(ids(parseQuery('created:>2025-07')), ['next'], 'created: supports comparisons');
assert.deepEqual(ids(parseQuery('created:<=2025')), ['old', 'june']);
assert.deepEqual(ids(parseQuery('-created:2025')), ['old', 'next'], 'negative created: excludes');
assert.deepEqual(ids(parseQuery('created:2025/2026')), ['june', 'next'], 'A/B inside created: is OR');
assert.deepEqual(ids(parseQuery('-created:2025/2026')), ['old'], 'a negated OR group excludes any match');
assert.deepEqual(ids(parseQuery('messages:>20')), ['june', 'next']);
assert.deepEqual(ids(parseQuery('messages:<=5')), ['old']);
assert.deepEqual(ids(parseQuery('messages:5/80')), ['old', 'next'], 'A/B inside messages: is OR');
assert.deepEqual(ids(parseQuery('messages:>20 messages:<=80')), ['june', 'next'], 'separate messages: tokens are AND');
assert.deepEqual(ids(parseQuery('-messages:>20')), ['old']);
assert.deepEqual(ids(parseQuery('title:积分')), ['june', 'next']);
assert.deepEqual(ids(parseQuery('title:积分 -title:Another')), ['june']);
assert.deepEqual(ids(parseQuery('-积分')), ['old'], 'a free exclusion drops chats by title');
assert.deepEqual(ids(parseQuery('created:2025-13')), ['old', 'june', 'next'], 'an invalid date becomes a plain text term, not a filter');
assert.deepEqual(roster.filter(item => titleHit(parseQuery('created:2025-13'), item)), [], 'the fallback text term matches no title');
assert.deepEqual(ids(parseQuery('messages:>20'), [{ id: 'x', title: 'x' }]), [], 'a chat without a turn count cannot pass messages:');

assert.equal(titleHit(parseQuery(''), chat()), true);
assert.equal(titleHit(parseQuery('积分'), chat()), true);
assert.equal(titleHit(parseQuery('积分'), chat({ title: '别的话题' })), false, 'title list is title-matching');
assert.equal(titleHit(parseQuery('title:积分'), chat({ title: '别的话题' })), false);
assert.equal(titleHit(parseQuery('title:积分 free'), chat({ title: '积分' })), true, 'title: governs the title list');
assert.equal(titleHit(parseQuery('free'), chat({ title: '积分' })), false);
assert.equal(titleHit(parseQuery('from:user'), chat()), false, 'body-only constraints do not fill the title list');
assert.equal(titleHit(parseQuery('has:code'), chat()), false);
assert.equal(titleHit(parseQuery('created:2025'), chat({ created_at: date(2025, 1, 1) })), true, 'date-only queries list chats');

/* ---------- 正文级匹配 ---------- */
const turn = (extra = {}) => ({ message_id: 'm1', role: 'assistant', order: 0, text: '代码与表', key: '代码与表', kinds: ['code', 'table'], ...extra });
const query = parseQuery('代码 has:code from:assistant');
assert.equal(turnMatches(query, turn()), true);
assert.equal(turnMatches(query, turn({ role: 'user', key: '代码' })), false, 'from: filters the role');
assert.equal(turnMatches(query, turn({ kinds: ['table'] })), false, 'has: needs the kind');
assert.equal(turnMatches(parseQuery('代码/表格'), turn({ key: '只有表格' })), true, 'alternatives are OR');
assert.equal(turnMatches(parseQuery('from:user/assistant'), turn({ role: 'user' })), true, 'from: alternatives are OR within a token');
assert.equal(turnMatches(parseQuery('has:code/image'), turn({ kinds: ['image'] })), true, 'has: alternatives are OR within a token');
assert.equal(turnMatches(parseQuery('has:code has:image'), turn({ kinds: ['image'] })), false, 'separate has: tokens are AND');
assert.equal(turnMatches(parseQuery('-has:code/image'), turn({ kinds: ['image'] })), false, 'a negated OR group excludes any listed kind');
assert.equal(turnMatches(parseQuery('代码 表格'), turn({ key: '只有表格' })), false, 'separate terms are AND');
assert.equal(turnMatches(parseQuery('代码 -表格'), turn({ key: '代码 与 表格' })), false, 'a negative term removes the turn');
assert.equal(turnMatches(parseQuery('代码 -表格'), turn()), true, 'a negative term only removes turns that contain it');
assert.equal(turnMatches(parseQuery('-has:code'), turn()), false);
assert.equal(turnMatches(parseQuery('-has:code'), turn({ kinds: ['table'] })), true);
assert.equal(turnMatches(parseQuery('-from:user'), turn({ role: 'user' })), false);
assert.equal(turnMatches(parseQuery('has:code'), turn({ kinds: undefined })), false, 'an old index without kinds cannot satisfy has:');
assert.equal(turnMatches(parseQuery('-has:code'), turn({ kinds: undefined })), true, 'a negative has: still works without kinds');

/* ---------- 高亮与片段 ---------- */
const title = titleParts('Ａｌｐｈａ 与 Alpha', ['alpha']);
assert.deepEqual(title.map(part => [part.text, part.hit]), [['Ａｌｐｈａ', true], [' 与 ', false], ['Alpha', true]], 'every occurrence highlights, original casing kept');
assert.deepEqual(titleParts('无命中', ['alpha']), [{ text: '无命中', hit: false }]);

const snippet = bodyParts('前文 '.repeat(20) + '这里有 OnlyBodyNeedle 正文。' + '后文 '.repeat(60), ['onlybodyneedle'], { lead: 24, tail: 160 });
assert.equal(snippet.count, 1);
assert.equal(snippet.parts[0].text, '…', 'a long lead-in is truncated');
assert.equal(snippet.parts.at(-1).text, '…', 'the tail is truncated');
assert.equal(snippet.parts.filter(part => part.hit).map(part => part.text).join(''), 'OnlyBodyNeedle', 'the hit is sliced from the original text');
assert.match(snippet.parts.map(part => part.text).join(''), /^…[^]{0,24}这里有 OnlyBodyNeedle 正文。后文 /);

const twice = bodyParts('OnlyBodyNeedle appears twice onlybodyneedle', ['onlybodyneedle']);
assert.equal(twice.count, 2, 'count covers the whole turn, not just the snippet');
assert.equal(twice.parts.filter(part => part.hit).length, 2);
assert.equal(twice.parts[0].text, 'OnlyBodyNeedle', 'short text has no leading ellipsis');

const nearby = bodyParts('abcdef', ['abc', 'bcd']);
assert.equal(nearby.count, 1, 'overlapping hits merge instead of double-counting');
assert.deepEqual(nearby.parts.filter(part => part.hit).map(part => part.text), ['abcd']);

assert.equal(occurrences('x needle y NEEDLE z'.toLocaleLowerCase(), ['needle']), 2);
assert.equal(occurrences('nothing', ['needle']), 0);

/* ---------- 空结果文案 ---------- */
assert.equal(emptyCopy(parseQuery('')), '无结果');
assert.equal(emptyCopy(parseQuery('missing')), '无结果', 'a plain query keeps the short copy');
assert.match(emptyCopy(parseQuery('-foo has:code')), /去掉 -排除/, 'a syntax query explains what to try next');

/* ---------- 组合：按弹窗的顺序过滤 ---------- */
const index = new Map([
  ['june', [
    turn({ message_id: 'j1', role: 'user', text: '我想看积分曲线', key: '我想看积分曲线', kinds: [] }),
    turn({ message_id: 'j2', role: 'assistant', text: '这是积分曲线代码', key: '这是积分曲线代码', kinds: ['code', 'image'] }),
  ]],
  ['next', [turn({ message_id: 'n1', role: 'assistant', text: 'Another 会话', key: 'another 会话', kinds: [] })]],
]);
const search = text => {
  const parsed = parseQuery(text);
  const chats = roster.filter(item => chatMatches(parsed, item));
  const titles = chats.filter(item => titleHit(parsed, item)).map(item => item.id);
  const body = bodyScoped(parsed) ? chats.flatMap(item => (index.get(item.id) || []).filter(entry => turnMatches(parsed, entry)).map(entry => entry.message_id)) : [];
  return { titles, body };
};
assert.deepEqual(search('积分'), { titles: ['june', 'next'], body: ['j1', 'j2'] });
assert.deepEqual(search('has:code'), { titles: [], body: ['j2'] }, 'has: lists body hits only');
assert.deepEqual(search('from:user'), { titles: [], body: ['j1'] });
assert.deepEqual(search('title:积分 -title:Another'), { titles: ['june'], body: [] }, 'title: filters the title list only');
assert.deepEqual(search('积分 -代码'), { titles: ['june', 'next'], body: ['j1'] }, 'a negative term removes only matching turns');
assert.deepEqual(search('messages:>20 积分'), { titles: ['june', 'next'], body: ['j1', 'j2'] });
assert.deepEqual(search('created:2025 积分'), { titles: ['june'], body: ['j1', 'j2'] });
assert.deepEqual(search('title:积分 has:code'), { titles: ['june', 'next'], body: ['j2'] }, 'title: filters chats, has: filters turns');

console.log('PASS search query: quoted phrases, exclusions, alternatives, title/from/has/created/messages, folding, highlights, snippets, empty copy, chat+turn composition');
