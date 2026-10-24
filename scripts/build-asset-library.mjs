import { writeIfChanged } from './page-cache.mjs';
import { readFile, writeFile, mkdir, cp, stat, readdir, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { readArchivedResource } from './archive-resources.mjs';
import { htmlSafeSvg } from './serialize-html.mjs';
import { prepareLocalSidebar } from './local-sidebar.mjs';
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

// 资源库每一步都要扫全部会话。缓存的键是“渲染输入”（library-stamps.json 里的 sourceHash:renderer）：
// 会话内容或渲染器没变，页面渲染结果就不会变，于是这一页能提供的信息（资源列表、附件预览文件名）
// 也不必重新读、重新解析。缓存里只存这些派生数据，不存资源字节。
const CACHE_VERSION = 1;
const cacheFile = root => join(root, 'data/private/asset-library-cache.json');

const exists = async path => { try { await stat(path); return true; } catch { return false; } };

async function readCache(root) {
  try {
    const data = JSON.parse(await readFile(cacheFile(root), 'utf8'));
    if (data?.version === CACHE_VERSION && data.conversations && data.pages) return data;
  } catch { /* 首次构建或缓存损坏：全部重算 */ }
  return { version: CACHE_VERSION, conversations: {}, pages: {} };
}

export async function buildAssetLibrary(root, library) {
  const replay = join(root, 'replay');
  const pub = join(replay, 'public');
  for (const dir of ['library-assets', 'library-previews', 'library-media']) await mkdir(join(pub, dir), { recursive: true });
  const frozen = JSON.parse(await readFile(join(root, 'official-templates/library.json'), 'utf8'));
  const document = parseHTML(await readFile(join(replay, 'import.html'), 'utf8')).document;
  const main = parseHTML(frozen.main).document.querySelector('main');
  const grid = main.querySelector('[role="grid"]');
  grid.dataset.ceobeAssetRows = '';
  document.querySelector('main').replaceWith(main);
  document.body.removeAttribute('data-ceobe-import-page');
  document.body.dataset.ceobeAssetLibrary = '';
  prepareLocalSidebar(document, 'assets');
  document.title = '资料库 · CEOBE';
  main.dataset.ceobeAssetMain = '';
  // First phase: no write operations or mock folders; only actual archived resources.
  for (const input of main.querySelectorAll('input[type="file"], input[type="checkbox"]')) input.closest('.absolute')?.remove() || input.remove();
  for (const button of main.querySelectorAll('button')) {
    const label = button.getAttribute('aria-label') || '';
    const text = button.textContent.trim();
    if (text === '新建' || ['打开筛选器', '更改布局', '网格视图', '列表视图'].includes(label)) { button.remove(); continue; }
    if (['全部', '图片', '文件'].includes(text)) { button.dataset.assetFilter = ({ 全部: 'all', 图片: 'image', 文件: 'file' })[text]; button.setAttribute('aria-pressed', String(text === '全部')); }
    if (['名称', '修改时间', '大小'].includes(text)) {
      button.dataset.assetSort = ({ 名称: 'name', 修改时间: 'date', 大小: 'size' })[text];
      if (text === '修改时间') button.textContent = '归档时间';
    }
  }
  const search = main.querySelector('input[placeholder="搜索"]');
  search.dataset.assetSearch = ''; search.placeholder = '搜索文件名或来源会话'; search.setAttribute('aria-label', '搜索文件名或来源会话');
  const summary = document.createElement('p'); summary.className = 'ceobe-assets-summary'; summary.dataset.assetSummary = ''; summary.setAttribute('role', 'status');
  grid.before(summary);
  const empty = document.createElement('p'); empty.className = 'ceobe-assets-empty'; empty.dataset.assetEmpty = ''; empty.hidden = true; empty.textContent = '没有匹配的附件。试试其他关键词或分类。'; grid.after(empty);
  // References use a newer sprite filename, but shared symbol IDs are frozen locally.
  for (const use of main.querySelectorAll('use')) {
    const id = use.getAttribute('href')?.split('#')[1];
    if (id) use.setAttribute('href', `./cdn/assets/sprites-core-26c3f2d4.svg#${id}`);
  }
  // 渲染输入指纹：会话内容 + 渲染器。与 library-stamps.json 一致，页面渲染结果由它决定。
  const stamps = await readFile(join(root, 'data/private/library-stamps.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const previous = await readCache(root);
  const conversations = {}, pages = {};
  const items = new Map();
  const keep = { assets: new Set(), previews: new Set(), media: new Set() };
  for (const entry of library.conversations) {
    const sourcePath = resolve(root, entry.conversation_path);
    const key = typeof stamps[entry.id] === 'string' ? stamps[entry.id] : '';
    const cachedConversation = key ? previous.conversations[entry.id] : null;
    let resources;
    if (cachedConversation?.key === key && Array.isArray(cachedConversation.resources)) {
      resources = cachedConversation.resources;
    } else {
      resources = JSON.parse(await readFile(sourcePath, 'utf8')).resources || [];
    }
    if (key) conversations[entry.id] = { key, resources };
    // 只有“下载成功但没有图片预览”的资源才需要看页面里的预览模板；没有这种资源就不解析页面。
    let previewsPromise = null;
    const previewMap = () => {
      if (!previewsPromise) previewsPromise = (async () => {
        const cachedPage = key ? previous.pages[entry.id] : null;
        if (cachedPage?.key === key && cachedPage.previews && typeof cachedPage.previews === 'object') {
          return new Map(Object.entries(cachedPage.previews));
        }
        const page = parseHTML(await readFile(join(replay, 'conversations', `${entry.id}.html`), 'utf8')).document;
        const map = new Map();
        for (const opener of page.querySelectorAll('[data-ceobe-open-preview]')) {
          const previewKey = opener.getAttribute('data-ceobe-open-preview');
          const file = opener.getAttribute('data-ceobe-preview-file');
          if (previewKey && file && !map.has(previewKey)) map.set(previewKey, file);
        }
        return map;
      })();
      return previewsPromise;
    };
    // 缓存的是“这一页能提供的预览文件名”，它同样由渲染输入决定。
    const rememberPage = async () => {
      const map = await previewMap();
      if (key && !pages[entry.id]) pages[entry.id] = { key, previews: Object.fromEntries(map) };
      return map;
    };
    for (const resource of resources) {
      const id = hash(resource.sha256 || `${entry.id}:${resource.key}`);
      let item = items.get(id);
      if (!item) {
        item = { id, name: resource.name || '未命名附件', names: [], kind: /^image\//.test(resource.mime_type || '') || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(resource.name || '') ? 'image' : 'file', date: entry.captured_at, size: resource.size_bytes ?? null, status: resource.status, sources: [], download: null, preview: null };
        items.set(id, item);
      }
      if (!item.names.includes(resource.name)) item.names.push(resource.name);
      if (String(entry.captured_at) > String(item.date)) item.date = entry.captured_at;
      let source=item.sources.find(s=>s.id===entry.id);if(!source){source={id:entry.id,title:entry.title,page:entry.page,name:resource.name||item.name,names:[],date:entry.captured_at};item.sources.push(source)}if(resource.name&&!source.names.includes(resource.name))source.names.push(resource.name);
      if (resource.status !== 'downloaded' || item.download) continue;
      // 归档文件名就是资源内容的 sha256：目标已存在就说明字节已经在那儿了，不必再读一遍档案。
      const assetName = basename(resource.local_path);
      const target = join(pub, 'library-assets', assetName);
      let size = null;
      try { size = (await stat(target)).size; }
      catch {
        try { const bytes = await readArchivedResource(dirname(sourcePath), resource); await writeFile(target, bytes); size = bytes.length; }
        catch { item.status = 'unavailable'; continue; }
      }
      item.download = `./library-assets/${assetName}`; item.size = size; item.status = 'downloaded';
      keep.assets.add(assetName);
      if (item.kind === 'image') item.preview = { kind: 'image', url: item.download };
      if (!item.preview) {
        const filename = (await rememberPage()).get(`file-${resource.key}`);
        if (!filename || !/^[\w-]+\.html$/.test(filename)) continue;
        const preview = parseHTML(`<html><body>${await readFile(join(replay, 'previews/templates', filename), 'utf8')}</body></html>`).document;
        for (const e of preview.querySelectorAll('script,iframe,object,embed,base,link')) e.remove();
        const media = [];
        for (const e of preview.querySelectorAll('*')) {
          for (const name of e.getAttributeNames()) if (/^on/i.test(name)) e.removeAttribute(name);
          for (const attr of ['src', 'href', 'srcset']) {
            const value = e.getAttribute(attr); if (!value) continue;
            if (attr === 'src' && value.startsWith('./previews/')) {
              const local = resolve(replay, value);
              if (relative(join(replay, 'previews'), local).startsWith('..')) { e.removeAttribute(attr); continue; }
              const name = hash(value) + '-' + basename(local);
              media.push([local, join(pub, 'library-media', name)]);
              e.setAttribute(attr, `./library-media/${name}`);
            } else if (attr === 'href' && value.startsWith('#')) { /* local SVG symbol */ }
            else e.removeAttribute(attr);
          }
        }
        for (const [from, to] of media) { keep.media.add(basename(to)); await cp(from, to); }
        keep.previews.add(`${id}.html`);
        await writeIfChanged(join(pub, 'library-previews', `${id}.html`), htmlSafeSvg(preview.body.innerHTML));
        item.preview = { kind: 'fragment', url: `./library-previews/${id}.html` };
      }
    }
  }
  // Index contains only display metadata and local URLs, never raw signed URLs.
  const records = [...items.values()];
  const json = document.createElement('script'); json.type = 'application/json'; json.id = 'ceobe-assets-data';
  json.textContent = JSON.stringify(records).replaceAll('<', '\\u003c'); document.body.append(json);
  const rowTemplate = document.createElement('template'); rowTemplate.id = 'ceobe-asset-row-template'; rowTemplate.innerHTML = frozen.row; document.body.append(rowTemplate);
  const dialog = document.createElement('dialog'); dialog.className = 'ceobe-assets-dialog'; dialog.setAttribute('aria-labelledby', 'ceobe-asset-title');
  dialog.innerHTML = '<header><h2 id="ceobe-asset-title"></h2><button type="button" data-asset-close aria-label="关闭预览">关闭 ×</button></header><div data-asset-preview-body></div><footer data-asset-preview-links></footer>';
  document.body.append(dialog);
  for (const filename of frozen.stylesheets) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `./assets/${filename}`; document.head.append(link);
  }
  for (const name of ['asset-library.js', 'asset-library.css']) {
    const content = await readFile(join(root, 'scripts', name)); await writeFile(join(replay, name), content);
    const node = document.createElement(name.endsWith('.js') ? 'script' : 'link');
    if (name.endsWith('.js')) { node.type = 'module'; node.src = `./${name}?v=${hash(content)}`; document.body.append(node); }
    else { node.rel = 'stylesheet'; node.href = `./${name}?v=${hash(content)}`; document.head.append(node); }
  }
  await writeIfChanged(join(replay, 'assets.html'), '<!DOCTYPE html>\n' + htmlSafeSvg(document.documentElement.outerHTML));
  await writeIfChanged(join(pub, 'assets-index.json'), JSON.stringify(records, null, 2));
  // 索引会随删除/改名变小；不再被引用的副本不留在 public（进而 dist）里。
  for (const [dir, names] of [['library-assets', keep.assets], ['library-previews', keep.previews], ['library-media', keep.media]]) {
    for (const name of await readdir(join(pub, dir))) if (!names.has(name)) await rm(join(pub, dir, name), { force: true });
  }
  await mkdir(join(root, 'data/private'), { recursive: true });
  await writeIfChanged(cacheFile(root), JSON.stringify({ version: CACHE_VERSION, conversations, pages }));
  console.log(`Asset library: ${records.length} unique resources, ${records.filter(r => r.download).length} verified local files.`);
}
