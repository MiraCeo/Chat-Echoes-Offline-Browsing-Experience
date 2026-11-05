#!/usr/bin/env node
/**
 * Build the unified search index: memory + files/images + chat turns.
 *
 * The three surfaces already have their own indexes; this merges their docs
 * into one BM25 index with a `source` field so a single box can search all of
 * them. Chat turns are truncated for display; the full text is tokenized.
 *
 *   npm run search:unified
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

export async function buildUnifiedIndex(root = projectRoot) {
  const pub = join(root, 'replay/public');
  const memory = await readJson(join(pub, 'memory-search.json'), { docs: [], postings: {}, df: {} });
  const library = await readJson(join(pub, 'library-search.json'), { docs: [], postings: {}, df: {} });

  // Merge the two indexes instead of re-tokenizing: each index stores only a
  // 200-char display excerpt, so re-indexing would lose the full-text postings.
  const offset = (memory.docs || []).length;
  const docs = [
    ...(memory.docs || []).map(doc => ({ ...doc, source: 'memory' })),
    ...(library.docs || []).map(doc => ({ ...doc, id: doc.id + offset, source: 'asset' })),
  ];
  const postings = {};
  for (const [term, list] of Object.entries(memory.postings || {})) postings[term] = list.map(([id, tf]) => [id, tf]);
  for (const [term, list] of Object.entries(library.postings || {})) {
    if (!postings[term]) postings[term] = [];
    for (const [id, tf] of list) postings[term].push([id + offset, tf]);
  }
  const df = {};
  for (const [term, list] of Object.entries(postings)) df[term] = list.length;
  const entities = {};
  for (const [entity, ids] of Object.entries(memory.entities || {})) entities[entity] = [...ids];
  for (const [entity, ids] of Object.entries(library.entities || {})) {
    if (!entities[entity]) entities[entity] = [];
    for (const id of ids) entities[entity].push(id + offset);
  }
  const totalLength = docs.reduce((sum, doc) => sum + (doc.length || 0), 0);
  const index = {
    schema: 'ceobe.memory-search/1',
    docs,
    postings,
    df,
    avgdl: docs.length ? totalLength / docs.length : 0,
    entities,
  };
  await writeFile(join(pub, 'unified-search.json'), JSON.stringify(index), 'utf8');
  return { docs: docs.length, terms: Object.keys(postings).length };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = resolve(process.argv[2] || projectRoot);
  const result = await buildUnifiedIndex(root);
  console.log(`统一检索索引：${result.docs} 条文档 / ${result.terms} 个词`);
  console.log(`已写入 ${join(root, 'replay/public/unified-search.json')}`);
}
