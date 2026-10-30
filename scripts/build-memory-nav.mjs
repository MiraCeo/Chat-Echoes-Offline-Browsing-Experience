import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';

/**
 * Sidebar 「记忆」 entry. Clone the projects row, insert after the existing
 * 「时间」 row when present, and stay idempotent across rebuilds.
 */
export async function buildMemoryNav(root, pageCache = null, selected = null) {
  const base = join(root, 'replay');
  const pages = selected ?? (await readdir(base)).filter(name => name.endsWith('.html'))
    .concat((await readdir(join(base, 'conversations'))).filter(name => name.endsWith('.html')).map(name => 'conversations/' + name));
  for (const page of pages) {
    const document = pageCache ? await pageCache.load(page) : parseHTML(await readFile(join(base, page), 'utf8')).document;
    const prefix = page.startsWith('conversations/') ? '../' : './';
    for (const node of document.querySelectorAll('[data-ceobe-memory-row]')) node.remove();
    const projects = document.querySelector('[data-ceobe-projects-link]');
    if (!projects?.parentElement) continue;
    const row = projects.cloneNode(true);
    row.removeAttribute('data-ceobe-projects-link');
    row.removeAttribute('data-testid');
    row.removeAttribute('id');
    row.removeAttribute('data-active');
    row.removeAttribute('aria-current');
    for (const extra of row.querySelectorAll('[data-ceobe-project-new], .trailing')) extra.remove();
    row.dataset.ceobeMemoryRow = '';
    row.setAttribute('href', prefix + 'memory.html');
    row.setAttribute('aria-label', '记忆');
    row.setAttribute('title', '记忆');
    row.style.setProperty('pointer-events', 'auto', 'important');
    const label = row.querySelector('.truncate');
    if (label) label.textContent = '记忆';
    for (const use of row.querySelectorAll('use')) use.setAttribute('href', prefix + 'cdn/assets/sprites-shell-097001e7.svg#book-open');
    if (page === 'memory.html') {
      row.dataset.active = '';
      row.setAttribute('aria-current', 'page');
    }
    const timeline = document.querySelector('[data-ceobe-timeline-row]');
    if (timeline?.parentElement) timeline.after(row);
    else projects.after(row);
    if (pageCache) pageCache.markDirty(page);
    else await writeFile(join(base, page), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  }
}
