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
 * 顶层「时间线」页：从已建好的导入页骨架复制外壳（侧栏、页头、样式），
 * 只替换 <main>。列表由 timeline.js 在浏览器里读 timeline-index.json + chats.json 渲染，
 * 因此重命名、新导入都只需要更新这两个文件，不用重写页面。
 */
export async function buildTimelinePage(projectRoot = resolve(import.meta.dirname, '..')) {
  const replay = join(projectRoot, 'replay');
  const document = parseHTML(await readFile(join(replay, 'import.html'), 'utf8')).document;
  document.body.removeAttribute('data-ceobe-import-page');
  // 顶层页不应该带 reader 的会话 ID：chat-actions.js 见到它会把标签标题改成首页会话名。
  document.body.removeAttribute('data-reader-chat-id');
  document.body.dataset.ceobeTimelinePage = '';
  document.title = '时间线';
  prepareLocalSidebar(document, 'timeline');

  const main = document.createElement('main');
  main.className = 'ceobe-timeline';
  main.dataset.ceobeTimeline = '';
  main.innerHTML = `
    <div class="ceobe-timeline-inner">
      <header class="ceobe-timeline-header">
        <h1>时间线</h1>
        <p class="ceobe-timeline-lede">按消息时间浏览本地档案；点击条目跳到对应会话。</p>
        <p class="ceobe-timeline-status" data-ceobe-timeline-status role="status">正在加载时间线…</p>
      </header>
      <div class="ceobe-timeline-groups" data-ceobe-timeline-groups></div>
      <p class="ceobe-timeline-empty" data-ceobe-timeline-empty hidden>本地档案里还没有会话。</p>
    </div>`;
  document.querySelector('main')?.replaceWith(main);

  // 模板/脚本按内容哈希落盘；与其它装饰步骤一样用 placeScript/placeStylesheet 保证幂等。
  const script = await readFile(join(projectRoot, 'scripts', 'timeline.js'), 'utf8');
  const scriptFile = 'timeline.' + hash(script) + '.js';
  await writeFile(join(replay, scriptFile), script);
  placeScript(document, 'timeline.', './' + scriptFile);

  const css = await readFile(join(projectRoot, 'scripts', 'timeline.css'), 'utf8');
  const cssFile = 'timeline.' + hash(css) + '.css';
  await mkdir(replay, { recursive: true });
  await writeFile(join(replay, cssFile), css);
  placeStylesheet(document, 'timeline.', './' + cssFile);

  await writeIfChanged(join(replay, 'timeline.html'), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  console.log('Built local timeline page: replay/timeline.html');
}
