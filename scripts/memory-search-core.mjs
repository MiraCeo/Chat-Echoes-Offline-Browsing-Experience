/**
 * Memory search core: BM25 + entity + time, fused with RRF.
 *
 * Pure functions only — no Node imports — so the browser can use the same
 * scoring as the build-time indexer.
 */

const LATIN = /[a-z0-9]+/g;

/** Chinese bigrams plus lowercased Latin words. */
export function tokenize(text) {
  const value = String(text || '').toLowerCase();
  const terms = [];
  for (const match of value.matchAll(LATIN)) terms.push(match[0]);
  const cjk = value.replace(/[^\u3400-\u9fff]+/g, ' ');
  for (const run of cjk.split(/\s+/)) {
    if (!run) continue;
    if (run.length === 1) terms.push(run);
    for (let index = 0; index < run.length - 1; index += 1) terms.push(run.slice(index, index + 2));
  }
  return terms;
}

/** Entities whose canonical name or an alias appears in the text. */
export function matchEntities(text, entities) {
  const value = String(text || '');
  const found = [];
  for (const entity of entities || []) {
    if (value.includes(entity.canonical)) { found.push(entity.canonical); continue; }
    if ((entity.aliases || []).some(alias => alias && value.includes(alias))) found.push(entity.canonical);
  }
  return found;
}

/**
 * Build the index. `docs` are `{ kind, title, text, group, target, valid_at,
 * invalid_at }`; `entities` is the registry.
 */
export function buildIndex(docs, entities = []) {
  const postings = new Map();
  const df = new Map();
  let totalLength = 0;
  const indexed = docs.map((doc, id) => {
    const fullText = `${doc.title || ''} ${doc.text || ''}`;
    const terms = tokenize(fullText);
    totalLength += terms.length;
    const tf = new Map();
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
    for (const [term, count] of tf) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([id, count]);
      df.set(term, (df.get(term) || 0) + 1);
    }
    return {
      id,
      kind: doc.kind,
      title: doc.title,
      // Only a display excerpt is stored; the full text is tokenized above.
      text: String(doc.text || '').slice(0, 200),
      group: doc.group || null,
      source: doc.source || null,
      target: doc.target || null,
      valid_at: doc.valid_at || null,
      invalid_at: doc.invalid_at || null,
      entities: matchEntities(fullText, entities),
      length: terms.length,
    };
  });
  const entityIndex = new Map();
  for (const doc of indexed) {
    for (const entity of doc.entities) {
      if (!entityIndex.has(entity)) entityIndex.set(entity, []);
      entityIndex.get(entity).push(doc.id);
    }
  }
  return {
    schema: 'ceobe.memory-search/1',
    docs: indexed,
    postings: Object.fromEntries(postings),
    df: Object.fromEntries(df),
    avgdl: indexed.length ? totalLength / indexed.length : 0,
    entities: Object.fromEntries(entityIndex),
  };
}

const idf = (df, total) => Math.log(1 + (total - df + 0.5) / (df + 0.5));

/** BM25 over the query terms. */
export function bm25(index, query, { k1 = 1.2, b = 0.75 } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const total = index.docs.length;
  const scores = new Map();
  for (const term of terms) {
    const posting = index.postings[term];
    if (!posting) continue;
    const weight = idf(index.df[term] || 0, total);
    for (const [id, tf] of posting) {
      const doc = index.docs[id];
      const norm = 1 - b + b * (doc.length / (index.avgdl || 1));
      const score = weight * (tf * (k1 + 1)) / (tf + k1 * norm);
      scores.set(id, (scores.get(id) || 0) + score);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

/** Docs whose entities appear in the query. */
export function entityHits(index, query) {
  const value = String(query || '');
  const scores = new Map();
  for (const [entity, ids] of Object.entries(index.entities || {})) {
    if (!value.includes(entity)) continue;
    for (const id of ids) scores.set(id, (scores.get(id) || 0) + 1);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

/** Current facts rank above superseded ones. */
export function timeRanking(index) {
  return index.docs
    .map(doc => ({ id: doc.id, current: doc.invalid_at ? 0 : 1 }))
    .sort((a, b) => b.current - a.current)
    .map(item => [item.id, item.current]);
}

/** Reciprocal rank fusion over the three signals. */
export function search(index, query, { limit = 60, k = 60 } = {}) {
  const term = bm25(index, query);
  const entity = entityHits(index, query);
  // Only docs that matched a content signal are candidates; the time signal
  // reorders them (it ranks every doc, so it must not introduce new ones).
  const matched = new Set([...term.map(([id]) => id), ...entity.map(([id]) => id)]);
  if (!matched.size) return [];
  const time = timeRanking(index).filter(([id]) => matched.has(id));
  const fused = new Map();
  for (const ranking of [term, entity, time]) {
    ranking.forEach(([id], rank) => {
      fused.set(id, (fused.get(id) || 0) + 1 / (k + rank + 1));
    });
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...index.docs[id], score: Number(score.toFixed(6)) }));
}
