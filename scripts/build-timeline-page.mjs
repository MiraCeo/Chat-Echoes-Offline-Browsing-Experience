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
  document.title = '时间';
  prepareLocalSidebar(document, 'timeline');

  const main = document.createElement('main');
  main.className = 'ceobe-timeline';
  main.dataset.ceobeTimeline = '';
  main.innerHTML = `
    <div class="ceobe-timeline-inner">
      <header class="ceobe-timeline-header">
        <h1>时间</h1>
        <p class="ceobe-timeline-lede">按时间浏览本地档案：时间线是列表/卡片，时间轴是缩略导航加详情。</p>
        <div class="ceobe-timeline-views" role="tablist" aria-label="时间视图">
          <button type="button" role="tab" id="ceobe-view-tab-timeline" aria-controls="ceobe-view-panel-timeline" aria-selected="true" tabindex="0" data-ceobe-view="timeline">时间线</button>
          <button type="button" role="tab" id="ceobe-view-tab-axis" aria-controls="ceobe-view-panel-axis" aria-selected="false" tabindex="-1" data-ceobe-view="axis">时间轴</button>
        </div>
      </header>
      <section class="ceobe-timeline-panel" id="ceobe-view-panel-timeline" role="tabpanel" aria-labelledby="ceobe-view-tab-timeline" data-ceobe-view-panel="timeline">
        <div class="ceobe-timeline-toolbar">
          <p class="ceobe-timeline-status" data-ceobe-timeline-status role="status">正在加载时间线…</p>
          <div class="ceobe-timeline-controls">
            <div class="ceobe-timeline-layout" role="group" aria-label="时间线布局">
              <button type="button" data-ceobe-timeline-layout="list" aria-pressed="true">列表</button>
              <button type="button" data-ceobe-timeline-layout="cards" aria-pressed="false">卡片</button>
            </div>
            <div class="ceobe-timeline-order" role="group" aria-label="时间顺序">
              <span class="ceobe-timeline-order-label">按首条消息</span>
              <button type="button" data-ceobe-timeline-order="newest" aria-pressed="true">最新在前</button>
              <button type="button" data-ceobe-timeline-order="oldest" aria-pressed="false">最早在前</button>
            </div>
          </div>
        </div>
        <div class="ceobe-timeline-groups" data-ceobe-timeline-groups></div>
        <p class="ceobe-timeline-empty" data-ceobe-timeline-empty hidden>本地档案里还没有会话。</p>
      </section>
      <section class="ceobe-timeline-panel ceobe-axis-panel" id="ceobe-view-panel-axis" role="tabpanel" aria-labelledby="ceobe-view-tab-axis" data-ceobe-view-panel="axis" hidden>
        <div data-ceobe-axis-overview></div>
        <div data-ceobe-axis-detail></div>
      </section>
    </div>`;
  document.querySelector('main')?.replaceWith(main);

  // 模板/脚本按内容哈希落盘；与其它装饰步骤一样用 placeScript/placeStylesheet 保证幂等。
  const script = await readFile(join(projectRoot, 'scripts', 'timeline.js'), 'utf8');
  const scriptFile = 'timeline.' + hash(script) + '.js';
  await writeFile(join(replay, scriptFile), script);
  placeScript(document, 'timeline.', './' + scriptFile);

  const axisScript = await readFile(join(projectRoot, 'scripts', 'timeline-axis.js'), 'utf8');
  const axisScriptFile = 'timeline-axis.' + hash(axisScript) + '.js';
  await writeFile(join(replay, axisScriptFile), axisScript);
  placeScript(document, 'timeline-axis.', './' + axisScriptFile);

  const css = await readFile(join(projectRoot, 'scripts', 'timeline.css'), 'utf8');
  const cssFile = 'timeline.' + hash(css) + '.css';
  await mkdir(replay, { recursive: true });
  await writeFile(join(replay, cssFile), css);
  placeStylesheet(document, 'timeline.', './' + cssFile);

  const axisCss = await readFile(join(projectRoot, 'scripts', 'timeline-axis.css'), 'utf8');
  const axisCssFile = 'timeline-axis.' + hash(axisCss) + '.css';
  await writeFile(join(replay, axisCssFile), axisCss);
  placeStylesheet(document, 'timeline-axis.', './' + axisCssFile);

  await writeIfChanged(join(replay, 'timeline.html'), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  console.log('Built local timeline page: replay/timeline.html');
}
