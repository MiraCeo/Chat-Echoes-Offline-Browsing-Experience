// 阅读器搜索语法：纯函数、不碰 DOM，供浏览器（sidebar-controls.js）、Node 测试与将来的
// 档案 MCP server 共用一套解析/匹配口径，避免两边各写一份而慢慢漂移。
//
// 语法（空格分隔，AND）：
//   "精确短语"        引号内空格不拆词
//   -排除词           出现在标题或正文即排除；-title:x 只排除标题
//   A/B               任一命中（`://` 不拆，`\/` 表示字面斜杠）
//   title:词          只匹配聊天标题（不参与正文命中）
//   from:user|gpt     只保留对应角色的正文命中（gpt/assistant/ai 同义）
//   has:code|table|image|attachment|audio
//                     索引里带对应 kinds 的正文命中
//   created:2025-06   聊天创建时间（本地年/月/日；支持 > >= < <=）
//   messages:>20      阅读轮数 turn_count（支持 > >= < <= =）
// 未知 `x:y` 按普通文本搜索，旧查询不会因为新增语法而改变结果。

export const SEARCH_SYNTAX_VERSION = 1;

const FIELDS = new Set(['title', 'from', 'has', 'created', 'messages']);
const ROLE_ALIASES = new Map([
  ['user', 'user'], ['me', 'user'],
  ['assistant', 'assistant'], ['gpt', 'assistant'], ['ai', 'assistant'], ['bot', 'assistant'],
]);
export const KINDS = Object.freeze(['code', 'table', 'image', 'attachment', 'audio']);

// 与索引/标题的中文全角折叠一致：NFKC + 小写 + 去首尾空白。
export const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();

/**
 * 逐字符折叠并保留“折叠后位置 → 原文区间”的映射，用来在原文上切高亮。
 * NFKC 会把一个字符展开成多个（连字、兼容字符），整串折叠拿不到原文偏移，所以这里逐码点处理。
 */
export function foldWithMap(value) {
  const source = value == null ? '' : String(value);
  const starts = [];
  const ends = [];
  let text = '';
  for (let index = 0; index < source.length;) {
    const codePoint = source.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    const piece = char.normalize('NFKC').toLocaleLowerCase();
    for (const out of piece) {
      text += out;
      starts.push(index);
      ends.push(index + char.length);
    }
    index += char.length;
  }
  return { text, starts, ends };
}

/** 把一行输入拆成 token：引号内的空格保留，token 记录每个字符是否在引号里。 */
function tokenizeInput(raw) {
  const tokens = [];
  let parts = null;
  let quoted = false;
  const flush = () => {
    if (parts && parts.length) tokens.push(parts);
    parts = null;
  };
  for (const char of String(raw ?? '')) {
    if (char === '"') { quoted = !quoted; parts ||= []; continue; }
    if (!quoted && /\s/.test(char)) { flush(); continue; }
    parts ||= [];
    parts.push({ char, quoted });
  }
  flush();
  return tokens;
}

/** token → {field, negated, alternatives: [{text, folded}]}；无法识别时整段当文本。 */
function buildToken(parts) {
  let items = parts;
  let negated = false;
  // `-词` 是排除；`\-词` 才表示字面减号。`-1`、`-2` 这类负数保持字面搜索，
  // 否则“搜索 -1 次方”会被理解成“排除 1”。
  const next = items[1]?.char ?? '';
  const negativeNumber = /^\d$/.test(next) || next === '-';
  if (items.length > 1 && items[0].char === '-' && !items[0].quoted && !negativeNumber) { negated = true; items = items.slice(1); }
  else if (items.length > 1 && items[0].char === '\\' && items[1].char === '-' && !items[1].quoted) items = items.slice(1);

  let field = null;
  let value = items;
  let colon = -1;
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].char === ':' && !items[index].quoted) { colon = index; break; }
  }
  if (colon > 0) {
    const name = items.slice(0, colon).map(item => item.char).join('').toLocaleLowerCase();
    if (FIELDS.has(name)) { field = name; value = items.slice(colon + 1); }
  }
  const alternatives = splitAlternatives(value);
  if (!alternatives.length) return null;
  return { field, negated, alternatives };
}

function splitAlternatives(parts) {
  const joined = parts.map(item => item.char).join('');
  // URL 里的斜杠不是“任一”分隔符。
  const urlLike = /^[a-z][a-z0-9+.-]*:\/\//i.test(joined);
  const groups = [];
  let current = [];
  const push = () => {
    const text = current.map(item => item.char).join('').trim();
    if (text) groups.push({ text, folded: normalize(text) });
    current = [];
  };
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index];
    if (item.char === '\\' && parts[index + 1]?.char === '/' && !item.quoted) {
      current.push({ char: '/', quoted: item.quoted });
      index += 1;
      continue;
    }
    if (item.char === '/' && !item.quoted && !urlLike) { push(); continue; }
    current.push(item);
  }
  push();
  return groups;
}

const CREATED = /^(>=|<=|>|<|=)?(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;
const MESSAGES = /^(>=|<=|>|<|=)?(\d+)$/;

function createdRule(value) {
  const match = CREATED.exec(value.trim());
  if (!match) return null;
  const [, operator = '=', year, month, day] = match;
  const y = Number(year);
  const m = month == null ? null : Number(month);
  const d = day == null ? null : Number(day);
  if (m != null && (m < 1 || m > 12)) return null;
  if (d != null && (d < 1 || d > 31)) return null;
  const start = y * 10000 + (m ?? 1) * 100 + (d ?? 1);
  const end = y * 10000 + (m == null ? 1231 : d == null ? m * 100 + 31 : m * 100 + d);
  return { operator, start, end, label: `${year}${month ? '-' + month : ''}${day ? '-' + day : ''}` };
}

function messagesRule(value) {
  const match = MESSAGES.exec(value.trim());
  if (!match) return null;
  return { operator: match[1] || '=', value: Number(match[2]) };
}

const compare = (operator, value, start, end) => {
  switch (operator) {
    case '>': return value > end;
    case '>=': return value >= start;
    case '<': return value < start;
    case '<=': return value <= end;
    default: return value >= start && value <= end;
  }
};

const chatDate = chat => {
  const raw = chat?.created_at ?? chat?.updated_at ?? chat?.captured_at;
  if (raw == null) return null;
  let stamp = Number(raw);
  if (!Number.isFinite(stamp)) stamp = Date.parse(String(raw));
  if (!Number.isFinite(stamp)) return null;
  if (stamp < 1e11) stamp *= 1000; // 归档里的 create_time 是 epoch 秒
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
};

const turnCount = chat => {
  const value = Number(chat?.turn_count ?? chat?.turns ?? chat?.message_count);
  return Number.isFinite(value) ? value : null;
};

/**
 * 解析查询。返回结构只含纯数据（可 JSON 序列化），便于测试与跨页面复用。
 */
export function parseQuery(input) {
  const raw = String(input ?? '');
  const query = {
    syntax: SEARCH_SYNTAX_VERSION, raw,
    terms: [], excludedTerms: [],
    from: [], excludedFrom: [],
    has: [], excludedHas: [],
    created: [], excludedCreated: [],
    messages: [], excludedMessages: [],
    signature: '',
  };
  for (const token of tokenizeInput(raw)) {
    const built = buildToken(token);
    if (!built) continue;
    const { field, negated, alternatives } = built;
    const text = alternatives.map(item => item.text).join('/');
    // from:/has:/created:/messages: 的多个取值是“同一词内的任一”，每个 token 收成一个组；
    // 不同 token 之间仍然是“且”。文本词靠 term.alternatives 表达同一层语义。
    if (field === 'from') {
      const roles = [...new Set(alternatives.map(item => ROLE_ALIASES.get(item.folded)).filter(Boolean))];
      if (roles.length) { query[negated ? 'excludedFrom' : 'from'].push(roles); continue; }
      // 无法识别的角色名按普通文本处理，不吞掉用户的输入。
    } else if (field === 'has') {
      const kinds = [...new Set(alternatives.map(item => item.folded).filter(item => KINDS.includes(item)))];
      if (kinds.length) { query[negated ? 'excludedHas' : 'has'].push(kinds); continue; }
    } else if (field === 'created') {
      const rules = alternatives.map(item => createdRule(item.text)).filter(Boolean);
      if (rules.length) { query[negated ? 'excludedCreated' : 'created'].push(rules); continue; }
    } else if (field === 'messages') {
      const rules = alternatives.map(item => messagesRule(item.text)).filter(Boolean);
      if (rules.length) { query[negated ? 'excludedMessages' : 'messages'].push(rules); continue; }
    }
    const term = { field: field === 'title' ? 'title' : null, text, alternatives };
    query[negated ? 'excludedTerms' : 'terms'].push(term);
  }
  query.signature = JSON.stringify([
    query.terms.map(term => [term.field, term.alternatives.map(item => item.folded)]),
    query.excludedTerms.map(term => [term.field, term.alternatives.map(item => item.folded)]),
    query.from, query.excludedFrom, query.has, query.excludedHas,
    query.created.map(group => group.map(rule => [rule.operator, rule.start, rule.end])),
    query.excludedCreated.map(group => group.map(rule => [rule.operator, rule.start, rule.end])),
    query.messages.map(group => group.map(rule => [rule.operator, rule.value])),
    query.excludedMessages.map(group => group.map(rule => [rule.operator, rule.value])),
  ]);
  return query;
}

const termMatches = (term, folded) => term.alternatives.some(item => folded.includes(item.folded));

/** 聊天级过滤：时间、轮数、title: 正负项、负向词命中标题。日期／轮数的多个取值按“任一”组判断。 */
export function chatMatches(query, chat) {
  const date = chatDate(chat);
  for (const group of query.created) if (date == null || !group.some(rule => compare(rule.operator, date, rule.start, rule.end))) return false;
  for (const group of query.excludedCreated) if (date != null && group.some(rule => compare(rule.operator, date, rule.start, rule.end))) return false;
  const count = turnCount(chat);
  for (const group of query.messages) if (count == null || !group.some(rule => compare(rule.operator, count, rule.value, rule.value))) return false;
  for (const group of query.excludedMessages) if (count != null && group.some(rule => compare(rule.operator, count, rule.value, rule.value))) return false;
  const title = normalize(chat?.title);
  for (const term of query.terms) if (term.field === 'title' && !termMatches(term, title)) return false;
  for (const term of query.excludedTerms) if (termMatches(term, title)) return false;
  return true;
}

/**
 * 标题列表要不要显示这条聊天：空查询/纯时间筛选给出整表；有 free 词时按标题命中；
 * 只有 from:/has: 这类正文条件时不占标题列表（改由正文命中说明）。
 */
export function titleHit(query, chat) {
  const titleTerms = query.terms.filter(term => term.field === 'title');
  const freeTerms = query.terms.filter(term => term.field === null);
  const title = normalize(chat?.title);
  if (!titleTerms.length && !freeTerms.length) return !query.from.length && !query.has.length;
  if (!titleTerms.every(term => termMatches(term, title))) return false;
  if (freeTerms.length && !titleTerms.length && !freeTerms.some(term => termMatches(term, title))) return false;
  return true;
}

/**
 * 查询是否给出“正文命中”的来源条件：free 词、from: 或 has:。
 * 只有负向词时只筛标题列表，不会把整库正文都列成命中（`-foo` 的语义是“排除”，不是“全部”）。
 */
export function bodyScoped(query) {
  return query.terms.some(term => term.field === null)
    || query.from.length > 0
    || query.has.length > 0;
}

/** 正文级匹配：正项 AND、from:/has: 组内任一、组间 AND、负向词与负向 from:/has:。 */
export function turnMatches(query, turn) {
  const folded = typeof turn?.key === 'string' ? turn.key : normalize(turn?.text);
  const kinds = Array.isArray(turn?.kinds) ? turn.kinds : [];
  for (const term of query.terms) if (term.field === null && !termMatches(term, folded)) return false;
  for (const roles of query.from) if (!roles.includes(turn?.role)) return false;
  for (const group of query.has) if (!group.some(kind => kinds.includes(kind))) return false;
  for (const term of query.excludedTerms) if (term.field === null && termMatches(term, folded)) return false;
  for (const roles of query.excludedFrom) if (roles.includes(turn?.role)) return false;
  for (const group of query.excludedHas) if (group.some(kind => kinds.includes(kind))) return false;
  return true;
}

/** 标题里该高亮的片段：free 词与 title: 词。 */
export function titleHighlights(query) {
  return [...new Set(query.terms
    .filter(term => term.field === 'title' || term.field === null)
    .flatMap(term => term.alternatives.map(item => item.folded)))];
}

/** 正文里该高亮的片段：只含 free 词（title: 不进正文）。 */
export function bodyHighlights(query) {
  return [...new Set(query.terms
    .filter(term => term.field === null)
    .flatMap(term => term.alternatives.map(item => item.folded)))];
}

/** 合并覆盖区间，避免重叠高亮把同一段文字切碎。 */
function mergeSpans(spans) {
  const sorted = spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** 在原文里找出所有命中区间（折叠后搜索，映射回原文偏移）。 */
export function matchSpans(text, needles) {
  const folded = foldWithMap(text);
  const spans = [];
  for (const needle of needles) {
    if (!needle) continue;
    let index = folded.text.indexOf(needle);
    while (index >= 0) {
      spans.push({ start: folded.starts[index], end: folded.ends[index + needle.length - 1] });
      index = folded.text.indexOf(needle, index + needle.length);
    }
  }
  return mergeSpans(spans);
}

const partsOf = (text, spans) => {
  const parts = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), hit: false });
    parts.push({ text: text.slice(span.start, span.end), hit: true });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
};

/** 标题高亮：整段标题 + 命中片段（可能多处）。 */
export function titleParts(title, needles) {
  const text = String(title ?? '');
  return partsOf(text, matchSpans(text, needles));
}

/**
 * 正文片段：从第一处命中往前留 24 字、往后留 160 字，命中片段全部高亮。
 * 返回 count 为整条正文里的命中总数（不只是片段里的）。
 */
export function bodyParts(text, needles, { lead = 24, tail = 160 } = {}) {
  const source = String(text ?? '');
  const spans = matchSpans(source, needles);
  const count = spans.length;
  if (!count) {
    const end = Math.min(source.length, 184);
    return { parts: [{ text: source.slice(0, end) + (end < source.length ? '…' : ''), hit: false }], count: 0, start: -1 };
  }
  const start = Math.max(0, spans[0].start - lead);
  const end = Math.min(source.length, spans[0].end + tail);
  const windowSpan = spans.filter(span => span.end > start && span.start < end)
    .map(span => ({ start: Math.max(span.start, start), end: Math.min(span.end, end) }));
  const parts = partsOf(source.slice(start, end), windowSpan.map(span => ({ start: span.start - start, end: span.end - start })));
  if (start > 0) parts.unshift({ text: '…', hit: false });
  if (end < source.length) parts.push({ text: '…', hit: false });
  return { parts, count, start: spans[0].start };
}

/** 命中总数（用于“· n 处”）：按折叠后的正文统计，与索引键同口径。 */
export function occurrences(folded, needles) {
  let total = 0;
  for (const needle of needles) {
    if (!needle) continue;
    let index = folded.indexOf(needle);
    while (index >= 0) { total += 1; index = folded.indexOf(needle, index + needle.length); }
  }
  return total;
}

/** 空结果文案：语法查询给出可执行的下一步，普通查询保持原来的“无结果”。 */
export function emptyCopy(query) {
  // 只有普通关键词时沿用原来的短文案；一旦用了排除或字段语法，就补一句能照着改的提示。
  const syntax = query.excludedTerms.length + query.from.length + query.excludedFrom.length
    + query.has.length + query.excludedHas.length + query.created.length + query.excludedCreated.length
    + query.messages.length + query.excludedMessages.length
    + query.terms.filter(term => term.field === 'title').length;
  if (!syntax) return '无结果';
  return '没有匹配结果。试试去掉 -排除、减少 from:/has: 条件，或换一个更短的关键词。';
}
