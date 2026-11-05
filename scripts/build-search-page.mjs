import { writeIfChanged } from './page-cache.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
import { prepareLocalSidebar } from './local-sidebar.mjs';
import { placeScript, placeStylesheet } from './page-decoration.mjs';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);

/**
 * Unified search page: one box over memory, files/images and chat turns.
 * The memory + asset index is loaded eagerly; the conversation index is loaded
 * lazily on the first query because it is ~7 MB.
 */
export async function buildSearchPage(projectRoot = resolve(import.meta.dirname, '..')) {
  const replay = join(projectRoot, 'replay');
  const document = parseHTML(await readFile(join(replay, 'import.html'), 'utf8')).document;
  document.body.removeAttribute('data-ceobe-import-page');
  document.body.removeAttribute('data-reader-chat-id');
  document.body.dataset.ceobeSearchPage = '';
  document.title = '搜索';
  prepareLocalSidebar(document, null);

  const main = document.createElement('main');
  main.className = 'ceobe-search';
  // 不要用 data-ceobe-search：那是侧栏搜索对话框的标记。
  main.dataset.ceobeUnifiedSearch = '';
  main.innerHTML = `
    <div class="ceobe-search-inner">
      <header class="ceobe-search-header">
        <h1>搜索</h1>
        <p class="ceobe-search-lede">一次查记忆、文件、图片和聊天记录。结果按来源分组。</p>
      </header>
      <div class="ceobe-search-row">
        <input type="search" data-unified-search aria-label="搜索记忆、文件、图片和聊天" placeholder="搜索记忆、文件、图片和聊天…" autofocus>
        <p data-unified-status role="status"></p>
      </div>
      <div class="ceobe-search-results" data-unified-results></div>
      <p class="ceobe-search-empty" data-unified-empty hidden>输入关键词开始搜索。</p>
    </div>`;
  document.querySelector('main')?.replaceWith(main);

  const script = await readFile(join(projectRoot, 'scripts/search.js'), 'utf8');
  const scriptFile = 'search.' + hash(script) + '.js';
  await writeFile(join(replay, scriptFile), script);
  placeScript(document, 'search.', './' + scriptFile);

  const css = await readFile(join(projectRoot, 'scripts/search.css'), 'utf8');
  const cssFile = 'search.' + hash(css) + '.css';
  await writeFile(join(replay, cssFile), css);
  placeStylesheet(document, 'search.', './' + cssFile);

  await writeIfChanged(join(replay, 'search.html'), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  console.log('Built local search page: replay/search.html');
}
