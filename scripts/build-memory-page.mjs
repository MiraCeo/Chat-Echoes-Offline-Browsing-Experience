import { writeIfChanged } from './page-cache.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
import { prepareLocalSidebar } from './local-sidebar.mjs';
import { placeScript, placeStylesheet } from './page-decoration.mjs';
import { collectMemoryStatus, freshnessForPage } from './memory-freshness.mjs';
import { buildIndex } from './memory-search-core.mjs';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);

/**
 * Top-level read-only L3.1 page. The source is the normalized memory view
 * produced by import-memory-overlay.mjs; CEOBE copies it into replay/public.
 */
export async function buildMemoryPage(projectRoot = resolve(import.meta.dirname, '..')) {
  const replay = join(projectRoot, 'replay');
  const document = parseHTML(await readFile(join(replay, 'import.html'), 'utf8')).document;
  document.body.removeAttribute('data-ceobe-import-page');
  document.body.removeAttribute('data-reader-chat-id');
  document.body.dataset.ceobeMemoryPage = '';
  document.title = '记忆';
  prepareLocalSidebar(document, 'memory');

  const main = document.createElement('main');
  main.className = 'ceobe-memory';
  main.dataset.ceobeMemory = '';
  main.innerHTML = `
    <div class="ceobe-memory-inner">
      <header class="ceobe-memory-header">
        <h1>记忆</h1>
        <p class="ceobe-memory-lede">按账号组与全局浏览；L1–L5 作为详情层级。只读；内容来自本地记忆内核。</p>
        <p class="ceobe-memory-freshness" data-memory-freshness role="status"></p>
      </header>
      <div class="ceobe-memory-toolbar">
        <div class="ceobe-memory-groups" data-memory-groups role="group" aria-label="记忆分组"></div>
        <p class="ceobe-memory-status" data-memory-status role="status">正在读取记忆库…</p>
      </div>
      <div class="ceobe-memory-search-row">
        <input type="search" data-memory-search aria-label="搜索记忆、主线、L5 节点和分册" placeholder="搜索记忆、主线、L5 节点和分册…">
        <p data-memory-search-status role="status"></p>
      </div>
      <nav class="ceobe-memory-layer-nav" data-memory-layer-nav aria-label="记忆层级"></nav>
      <div class="ceobe-memory-search-results" data-memory-search-results hidden></div>
      <div class="ceobe-memory-content" data-memory-content></div>
      <p class="ceobe-memory-empty" data-memory-empty hidden>没有可显示的项目记忆。</p>
    </div>`;
  document.querySelector('main')?.replaceWith(main);

  const source = join(projectRoot, 'data/private/memory-kernel/memory-view.json');
  let doc = { schema: 'ceobe.memory-view/2', groups: [], global: null, ungrouped: { count: 0, sessions: [] } };
  try { doc = JSON.parse(await readFile(source, 'utf8')); } catch { /* optional until overlay is adapted */ }
  // Freshness is computed at build time: the page is static, so it can only
  // report the state it was built from. It never claims "page is stale" —
  // rebuilding the page is what makes it current.
  const freshness = freshnessForPage(await collectMemoryStatus(projectRoot));
  await mkdir(join(replay, 'public'), { recursive: true });
  await writeFile(join(replay, 'public', 'memory-data.json'), JSON.stringify({ ...doc, freshness }), 'utf8');
  const projectIndex = {
    schema: 'ceobe.memory-project-index/1',
    groups: Object.fromEntries((doc.groups || []).map(group => [group.group, {
      name: group.name,
      as_of: group.as_of,
      coverage: group.coverage,
      mainlines: group.mainlines || [],
    }])),
  };
  await writeFile(join(replay, 'public', 'memory-project-index.json'), JSON.stringify(projectIndex), 'utf8');
  const sessionIndex = {
    schema: 'ceobe.memory-session-index/1',
    sessions: Object.fromEntries((doc.sessions || []).map(session => [session.id, {
      group: session.group,
      title: session.title,
    }])),
  };
  await writeFile(join(replay, 'public', 'memory-session-index.json'), JSON.stringify(sessionIndex), 'utf8');

  // Static search index: BM25 + entity + time, scored in the browser.
  const searchDocs = [];
  const addDoc = (kind, title, text, target, extra = {}) => {
    const body = String(text || '').replace(/\s+/g, ' ').trim();
    if (body) searchDocs.push({ kind, title, text: body, target, ...extra });
  };
  for (const group of doc.groups || []) {
    addDoc('组', group.name, `${group.name} ${group.as_of}`, { type: 'group', group: group.group }, { group: group.group });
    for (const key of group.block_order || []) {
      for (const entry of group.blocks?.[key] || []) {
        addDoc('记忆', `${group.name} · ${group.block_labels?.[key] || key}`, `${entry.key || ''} ${entry.text || ''}`, { type: 'group', group: group.group }, { group: group.group });
      }
    }
    for (const mainline of group.mainlines || []) addDoc('主线', `${group.name} · ${mainline.label}`, mainline.label, { type: 'group', group: group.group }, { group: group.group });
  }
  for (const session of doc.sessions || []) {
    addDoc('会话', session.title, `${session.title} ${session.l1?.summary || ''} ${(session.l1?.tags || []).join(' ')}`, { type: 'session', id: session.id }, { group: session.group });
    for (const node of session.l4?.nodes || []) addDoc('L4', `${session.title} · #${node.n}`, node.x, { type: 'session', id: session.id }, { group: session.group });
  }
  for (const node of doc.global?.tree_data?.nodes || []) {
    addDoc('L5', `L5 #${node.n}`, node.x, { type: 'global' }, { valid_at: node.valid_at || null, invalid_at: node.invalid_at || null });
  }
  for (const threadDoc of doc.global?.thread_docs || []) addDoc('分册', threadDoc.name, String(threadDoc.html || '').replace(/<[^>]*>/g, ' '), { type: 'doc', name: threadDoc.name });
  for (const mainline of doc.global?.mainlines || []) addDoc('全局主线', mainline.label, mainline.label, { type: 'global' });
  for (const project of doc.global?.projects || []) addDoc('项目', project.label, project.label, { type: 'global' });
  const entities = JSON.parse(await readFile(join(projectRoot, 'data/private/memory-kernel/source/entities.json'), 'utf8').catch(() => '{"entities":[]}'));
  const searchIndex = buildIndex(searchDocs, entities.entities || []);
  await writeFile(join(replay, 'public', 'memory-search.json'), JSON.stringify(searchIndex), 'utf8');

  // Page modules are copied with a content hash and the import specifiers in
  // memory.js are rewritten to match, so the page never serves a stale module.
  let script = await readFile(join(projectRoot, 'scripts/memory.js'), 'utf8');
  for (const name of ['memory-event-tree.js', 'memory-tree-time.js', 'memory-search-core.mjs']) {
    const source = await readFile(join(projectRoot, 'scripts', name), 'utf8');
    const file = name.replace(/\.(js|mjs)$/, '') + '.' + hash(source) + (name.endsWith('.mjs') ? '.mjs' : '.js');
    await writeFile(join(replay, file), source);
    script = script.replace(`'./${name}'`, `'./${file}'`);
  }
  const scriptFile = 'memory.' + hash(script) + '.js';
  await writeFile(join(replay, scriptFile), script);
  placeScript(document, 'memory.', './' + scriptFile);

  const css = await readFile(join(projectRoot, 'scripts/memory.css'), 'utf8');
  const cssFile = 'memory.' + hash(css) + '.css';
  await writeFile(join(replay, cssFile), css);
  placeStylesheet(document, 'memory.', './' + cssFile);

  await writeIfChanged(join(replay, 'memory.html'), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  console.log('Built local memory page: replay/memory.html');
}
