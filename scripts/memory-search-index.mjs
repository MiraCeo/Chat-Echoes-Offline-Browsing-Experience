#!/usr/bin/env node
/**
 * Build the static memory search index.
 *
 *   npm run memory:search -- --view data/private/memory-kernel/memory-view.json
 *   --out replay/public/memory-search.json
 *   --entities data/private/memory-kernel/source/entities.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIndex } from './memory-search-core.mjs';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const viewPath = resolve(option('--view') || 'data/private/memory-kernel/memory-view.json');
  const out = resolve(option('--out') || 'replay/public/memory-search.json');
  const view = JSON.parse(await readFile(viewPath, 'utf8'));
  const registry = JSON.parse(await readFile(resolve(option('--entities') || 'data/private/memory-kernel/source/entities.json'), 'utf8'));
  const docs = [];
  const add = (kind, title, text, target, extra = {}) => {
    const body = String(text || '').replace(/\s+/g, ' ').trim();
    if (body) docs.push({ kind, title, text: body, target, ...extra });
  };
  for (const group of view.groups || []) {
    add('组', group.name, `${group.name} ${group.as_of}`, { type: 'group', group: group.group }, { group: group.group });
    for (const key of group.block_order || []) {
      for (const entry of group.blocks?.[key] || []) {
        add('记忆', `${group.name} · ${group.block_labels?.[key] || key}`, `${entry.key || ''} ${entry.text || ''}`, { type: 'group', group: group.group }, { group: group.group });
      }
    }
    for (const mainline of group.mainlines || []) add('主线', `${group.name} · ${mainline.label}`, mainline.label, { type: 'group', group: group.group }, { group: group.group });
  }
  for (const session of view.sessions || []) {
    add('会话', session.title, `${session.title} ${session.l1?.summary || ''} ${(session.l1?.tags || []).join(' ')}`, { type: 'session', id: session.id }, { group: session.group });
    for (const node of session.l4?.nodes || []) add('L4', `${session.title} · #${node.n}`, node.x, { type: 'session', id: session.id }, { group: session.group });
  }
  for (const node of view.global?.tree_data?.nodes || []) {
    add('L5', `L5 #${node.n}`, node.x, { type: 'global' }, { valid_at: node.valid_at || null, invalid_at: node.invalid_at || null });
  }
  for (const doc of view.global?.thread_docs || []) add('分册', doc.name, String(doc.html || '').replace(/<[^>]*>/g, ' '), { type: 'doc', name: doc.name });
  for (const mainline of view.global?.mainlines || []) add('全局主线', mainline.label, mainline.label, { type: 'global' });
  for (const project of view.global?.projects || []) add('项目', project.label, project.label, { type: 'global' });
  const index = buildIndex(docs, registry.entities || []);
  await writeFile(out, JSON.stringify(index), 'utf8');
  console.log(`记忆检索索引：${index.docs.length} 条文档 / ${Object.keys(index.postings).length} 个词 / ${Object.keys(index.entities).length} 个实体`);
  console.log(`已写入 ${out}`);
}
