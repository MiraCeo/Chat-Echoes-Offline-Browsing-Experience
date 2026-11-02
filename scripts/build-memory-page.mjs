import { writeIfChanged } from './page-cache.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
import { prepareLocalSidebar } from './local-sidebar.mjs';
import { placeScript, placeStylesheet } from './page-decoration.mjs';

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
        <p class="ceobe-memory-lede">按已确认账号组与全局主线整理的项目记忆库。只读；内容来自本地记忆内核。</p>
      </header>
      <div class="ceobe-memory-toolbar">
        <div class="ceobe-memory-groups" data-memory-groups role="group" aria-label="记忆分组"></div>
        <p class="ceobe-memory-status" data-memory-status role="status">正在读取记忆库…</p>
      </div>
      <div class="ceobe-memory-search-row">
        <input type="search" data-memory-search aria-label="搜索记忆、主线、L5 节点和分册" placeholder="搜索记忆、主线、L5 节点和分册…">
        <p data-memory-search-status role="status"></p>
      </div>
      <div class="ceobe-memory-search-results" data-memory-search-results hidden></div>
      <div class="ceobe-memory-content" data-memory-content></div>
      <p class="ceobe-memory-empty" data-memory-empty hidden>没有可显示的项目记忆。</p>
    </div>`;
  document.querySelector('main')?.replaceWith(main);

  const source = join(projectRoot, 'data/private/memory-kernel/memory-view.json');
  let doc = { schema: 'ceobe.memory-view/2', groups: [], global: null, ungrouped: { count: 0, sessions: [] } };
  try { doc = JSON.parse(await readFile(source, 'utf8')); } catch { /* optional until overlay is adapted */ }
  await mkdir(join(replay, 'public'), { recursive: true });
  await writeFile(join(replay, 'public', 'memory-data.json'), JSON.stringify(doc), 'utf8');
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

  const script = await readFile(join(projectRoot, 'scripts/memory.js'), 'utf8');
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
