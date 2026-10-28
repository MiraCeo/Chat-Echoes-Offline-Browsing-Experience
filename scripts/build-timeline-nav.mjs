import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';

/**
 * 侧栏「时间线」入口：克隆官方「项目」导航行，插到「项目」与「更多」之间。
 * 只改锚点本身的 href/图标/文字，保留冻结行的类与间距；每趟构建先删自己上一次注入的行，
 * 因此重复构建不会叠加（清场选择器也在 page-decoration.mjs 里）。
 */
export async function buildTimelineNav(root, pageCache = null, selected = null) {
  const base = join(root, 'replay');
  const pages = selected ?? (await readdir(base)).filter(name => name.endsWith('.html'))
    .concat((await readdir(join(base, 'conversations'))).filter(name => name.endsWith('.html')).map(name => 'conversations/' + name));
  for (const page of pages) {
    const document = pageCache ? await pageCache.load(page) : parseHTML(await readFile(join(base, page), 'utf8')).document;
    const prefix = page.startsWith('conversations/') ? '../' : './';
    for (const node of document.querySelectorAll('[data-ceobe-timeline-row]')) node.remove();
    for (const node of document.querySelectorAll('[data-ceobe-timeline-link]')) node.remove();
    const projects = document.querySelector('[data-ceobe-projects-link]');
    if (projects?.parentElement) {
      const row = projects.cloneNode(true);
      row.removeAttribute('data-ceobe-projects-link');
      row.removeAttribute('data-testid');
      row.removeAttribute('id');
      row.removeAttribute('data-active');
      row.removeAttribute('aria-current');
      for (const extra of row.querySelectorAll('[data-ceobe-project-new], .trailing, [data-ceobe-timeline-link]')) extra.remove();
      row.dataset.ceobeTimelineRow = '';
      row.dataset.ceobeTimelineLink = '';
      row.setAttribute('href', prefix + 'timeline.html');
      row.setAttribute('aria-label', '时间线');
      row.setAttribute('title', '时间线');
      row.style.setProperty('pointer-events', 'auto', 'important');
      const label = row.querySelector('.truncate');
      if (label) label.textContent = '时间线';
      for (const use of row.querySelectorAll('use')) use.setAttribute('href', prefix + 'cdn/assets/sprites-shell-097001e7.svg#clock');
      if (page === 'timeline.html') {
        row.dataset.active = '';
        row.setAttribute('aria-current', 'page');
      } else {
        row.removeAttribute('data-active');
        row.removeAttribute('aria-current');
      }
      projects.after(row);
    }
    if (pageCache) pageCache.markDirty(page);
    else await writeFile(join(base, page), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  }
}
