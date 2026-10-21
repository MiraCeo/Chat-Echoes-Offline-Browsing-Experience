const projectMode=!!document.querySelector('[data-project-files]');
let data = projectMode?(window.ceobeProjectFiles||[]):JSON.parse(document.getElementById('ceobe-assets-data').textContent);
const grid = document.querySelector('[data-ceobe-asset-rows]');
const template = document.getElementById('ceobe-asset-row-template');
const search = document.querySelector('[data-asset-search]');
const dialog = document.querySelector('.ceobe-assets-dialog');
let filter = 'all', sort = 'date', direction = -1, previousFocus, requestVersion = 0;
let view = 'list', sourceFilter = 'all', savedFilter = 'all';
try { if (localStorage.getItem('ceobe.asset.view') === 'grid') view = 'grid'; } catch {}
const fmtSize = n => n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtDate = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN'); };
const make = (tag, text, className) => { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; };
function addLinks(parent, item) {
  if (item.download) { const a = make('a', '下载', 'ceobe-asset-link'); a.href = item.download; a.download = item.name; parent.append(a); }
  for (const source of item.sources) { const a = make('a', `来源：${source.title}`, 'ceobe-asset-link'); a.href = source.page; a.title = '回到来源会话'; parent.append(a); }
}
function makeCard(item) {
  const card = document.createElement('div');
  card.className = 'ceobe-asset-card';
  card.dataset.assetId = item.id;
  const icon = document.createElement('div');
  icon.className = 'ceobe-asset-card-icon';
  if (item.kind === 'image' && item.download) {
    const img = document.createElement('img');
    img.src = item.download; img.alt = ''; img.loading = 'lazy';
    img.onerror = () => img.remove();
    icon.append(img);
  } else {
    icon.textContent = item.kind === 'image' ? 'IMG' : (item.name.split('.').at(-1) || 'FILE').slice(0, 5).toUpperCase();
  }
  const name = make('button', item.name, 'ceobe-asset-card-name');
  name.type = 'button'; name.dataset.assetOpen = item.id; name.title = item.name;
  const state = item.download ? (item.preview ? '' : '已保存 · 不支持预览') : '未保存 · 暂不可下载';
  card.append(icon, name);
  if (state) card.append(make('span', state, 'ceobe-asset-state'));
  card.append(make('div', `${fmtDate(item.date)} · ${fmtSize(item.size)}`, 'ceobe-asset-card-meta'));
  const actions = document.createElement('div');
  actions.className = 'ceobe-asset-card-actions';
  addLinks(actions, item);
  card.append(actions);
  return card;
}

function render() {
  const term = search.value.trim().toLocaleLowerCase();
  const shown = data.filter(x => (filter === 'all' || x.kind === filter)
    && (sourceFilter === 'all' || x.sources.some(s => s.title === sourceFilter))
    && (savedFilter === 'all' || (savedFilter === 'saved' ? !!x.download : !x.download))
    && `${x.name} ${x.names.join(' ')} ${x.sources.map(s => s.title).join(' ')}`.toLocaleLowerCase().includes(term));
  shown.sort((a, b) => direction * (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : sort === 'size' ? (a.size ?? -1) - (b.size ?? -1) : String(a.date).localeCompare(String(b.date))) || a.id.localeCompare(b.id));
  grid.classList.toggle('ceobe-asset-grid', view === 'grid');
  // 表头（名称/归档时间/大小）只在列表模式有意义；用文本定位，避免依赖具体类名。
  document.body.classList.toggle('ceobe-grid-mode', view === 'grid');
  grid.replaceChildren();
  for (const item of shown) {
    if (view === 'grid') { grid.append(makeCard(item)); continue; }
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.assetId = item.id;
    const content = row.querySelector('[role="row"]');
    content.classList.add('ceobe-asset-row'); content.removeAttribute('tabindex'); content.removeAttribute('aria-selected');
    const cells = [...content.children];
    const nameCell = cells[1], dateCell = cells[2], sizeCell = cells[3], actionCell = cells[4];
    cells[0].remove();
    const icon = make('span', item.kind === 'image' ? 'IMG' : (item.name.split('.').at(-1) || 'FILE').slice(0, 5).toUpperCase(), 'ceobe-asset-icon');
    // SVGs are used only as image sources, never injected into the document.
    if (item.kind === 'image' && item.download) { const img = document.createElement('img'); img.src = item.download; img.alt = ''; img.loading = 'lazy'; img.onerror = () => { img.remove(); icon.textContent = 'IMG'; }; icon.replaceChildren(img); }
    const name = make('button', item.name, 'ceobe-asset-name'); name.type = 'button'; name.dataset.assetOpen = item.id; name.title = item.name;
    const detail = make('div', '', 'ceobe-asset-details'); detail.append(name);
    const status = item.download ? (!item.preview ? '已保存 · 此类型暂不支持预览' : '') : '未保存 · 暂不可下载';
    if (status) detail.append(make('span', status, 'ceobe-asset-state'));
    nameCell.append(icon, detail); dateCell.textContent = fmtDate(item.date); dateCell.title = `归档时间：${item.date}`; sizeCell.textContent = fmtSize(item.size);
    actionCell.className = 'ceobe-asset-actions'; addLinks(actionCell, item);
    actionCell.setAttribute('role', 'gridcell'); grid.append(row);
  }
  document.querySelector('[data-asset-summary]').textContent = `${shown.length} / ${data.length} 个附件 · 按文件内容去重，${projectMode?'仅保留本项目的来源聊天':'保留全部来源'} · 时间为本地归档时间`;
  const empty = document.querySelector('[data-asset-empty]'); empty.hidden = shown.length > 0;
  empty.textContent=data.length?'没有匹配的附件。试试其他关键词或分类。':projectMode?'本项目的聊天中还没有文件。移入或导入含附件的聊天后，这里会自动显示。':'还没有归档附件。导入含有附件的会话后，它们会出现在这里。';
  for (const b of document.querySelectorAll('[data-asset-filter]')) b.setAttribute('aria-pressed', String(b.dataset.assetFilter === filter));
  for (const b of document.querySelectorAll('[data-asset-view]')) b.setAttribute('aria-pressed', String(b.dataset.assetView === view));
  for (const b of document.querySelectorAll('[data-asset-sort]')) { b.setAttribute('aria-pressed', String(b.dataset.assetSort === sort)); b.setAttribute('aria-label', `${b.textContent}，${b.dataset.assetSort === sort ? (direction > 0 ? '升序' : '降序') : '点击排序'}`); }
}
async function open(item, button) {
  const version = ++requestVersion; previousFocus = button;
  dialog.querySelector('h2').textContent = item.name;
  const body = dialog.querySelector('[data-asset-preview-body]'); body.textContent = '正在加载预览…';
  const links = dialog.querySelector('footer'); links.replaceChildren(); addLinks(links, item);
  dialog.showModal(); dialog.querySelector('[data-asset-close]').focus();
  if (!item.preview) { body.textContent = item.download ? '此文件类型暂不支持预览。可以下载原文件，或返回来源会话查看。' : '原资源尚未保存到本地。保留文件记录，不提供虚假预览。'; return; }
  if (item.preview.kind === 'image') { const img = document.createElement('img'); img.src = item.preview.url; img.alt = item.name; img.onerror = () => { body.textContent = '图片无法预览，可尝试下载原文件。'; }; body.replaceChildren(img); return; }
  try {
    const r = await fetch(item.preview.url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text(); if (version !== requestVersion || !dialog.open) return;
    body.innerHTML = text;
  } catch { if (version === requestVersion) body.textContent = '预览加载失败。请关闭后重试，或下载原文件。'; }
}
function close() { ++requestVersion; dialog.close(); dialog.querySelector('[data-asset-preview-body]').replaceChildren(); previousFocus?.focus(); }
document.addEventListener('ceobe:project-files',e=>{if(!projectMode)return;if(dialog.open)close();data=e.detail.items;if(grid)render()});
function buildControls() {
  if (!grid || document.querySelector('[data-asset-advanced]')) return;
  const style = document.createElement('style');
  style.textContent = `
    .ceobe-asset-advanced{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0 12px}
    .ceobe-asset-advanced label{display:flex;align-items:center;gap:6px;font-size:12px;color:#667085}
    .ceobe-asset-advanced select{font:12px system-ui;padding:4px 8px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#344054}
    .ceobe-asset-advanced .ceobe-asset-view{display:flex;gap:6px;margin-left:auto}
    .ceobe-asset-advanced button{font:12px system-ui;padding:4px 10px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;cursor:pointer;color:#344054}
    .ceobe-asset-advanced button[aria-pressed="true"]{background:#1f2937;border-color:#1f2937;color:#fff}
    body.ceobe-grid-mode div[role="presentation"][class*="h-[42px]"]{display:none !important}
    .ceobe-asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(208px,1fr));gap:14px}
    .ceobe-asset-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid #eaecf0;border-radius:14px;background:#fff}
    .ceobe-asset-card-icon{display:flex;align-items:center;justify-content:center;height:96px;border-radius:10px;overflow:hidden;background:#f2f4f7;color:#667085;font-size:12px;letter-spacing:.08em}
    .ceobe-asset-card-icon img{width:100%;height:100%;object-fit:cover}
    .ceobe-asset-card-name{font-size:13px;line-height:1.45;color:#1f2937;text-align:left;background:none;border:0;padding:0;cursor:pointer;word-break:break-word}
    .ceobe-asset-card-meta{font-size:11px;color:#98a2b3}
    .ceobe-asset-card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto}
  `;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'ceobe-asset-advanced';
  bar.setAttribute('data-asset-advanced', '');

  const sources = [...new Set(data.flatMap(item => item.sources.map(source => source.title)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const sourceLabel = document.createElement('label');
  sourceLabel.append(document.createTextNode('来源'));
  const sourceSelect = document.createElement('select');
  sourceSelect.dataset.assetSource = '';
  sourceSelect.setAttribute('aria-label', '按来源会话筛选');
  sourceSelect.append(new Option('全部来源', 'all'));
  for (const title of sources) sourceSelect.append(new Option(title, title));
  sourceLabel.append(sourceSelect);

  const savedLabel = document.createElement('label');
  savedLabel.append(document.createTextNode('状态'));
  const savedSelect = document.createElement('select');
  savedSelect.dataset.assetSaved = '';
  savedSelect.setAttribute('aria-label', '按保存状态筛选');
  savedSelect.append(new Option('全部', 'all'), new Option('已保存', 'saved'), new Option('未保存', 'missing'));
  savedLabel.append(savedSelect);

  const viewWrap = document.createElement('div');
  viewWrap.className = 'ceobe-asset-view';
  const listButton = document.createElement('button');
  listButton.type = 'button'; listButton.textContent = '列表'; listButton.dataset.assetView = 'list';
  const gridButton = document.createElement('button');
  gridButton.type = 'button'; gridButton.textContent = '网格'; gridButton.dataset.assetView = 'grid';
  viewWrap.append(listButton, gridButton);

  bar.append(sourceLabel, savedLabel, viewWrap);
  grid.parentElement.insertBefore(bar, grid);

  sourceSelect.addEventListener('change', () => { sourceFilter = sourceSelect.value; render(); });
  savedSelect.addEventListener('change', () => { savedFilter = savedSelect.value; render(); });

  // 数据更新后（项目页会替换 data）刷新来源选项
  document.addEventListener('ceobe:project-files', () => {
    const current = sourceSelect.value;
    const titles = [...new Set(data.flatMap(item => item.sources.map(source => source.title)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    sourceSelect.replaceChildren(new Option('全部来源', 'all'), ...titles.map(title => new Option(title, title)));
    sourceSelect.value = titles.includes(current) ? current : 'all';
    sourceFilter = sourceSelect.value;
  });
}
buildControls();
search?.addEventListener('input', render);
document.addEventListener('ceobe:asset-preview',e=>{const item=data.find(x=>x.id===e.detail?.id);if(item)open(item,e.detail.opener)});
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.assetFilter) { filter = target.dataset.assetFilter; render(); }
  if (target.dataset.assetView) { view = target.dataset.assetView; try { localStorage.setItem('ceobe.asset.view', view); } catch {} render(); }
  if (target.dataset.assetSort) { direction = sort === target.dataset.assetSort ? -direction : target.dataset.assetSort === 'name' ? 1 : -1; sort = target.dataset.assetSort; render(); }
  if (target.dataset.assetOpen) open(data.find(x => x.id === target.dataset.assetOpen), target);
  if (target.hasAttribute('data-asset-close') || (dialog.contains(target) && target.hasAttribute('data-ceobe-close-preview'))) close();
  if (dialog.contains(target) && target.hasAttribute('data-ceobe-sheet-tab')) {
    for (const sheet of dialog.querySelectorAll('[data-ceobe-sheet]')) sheet.hidden = sheet.dataset.ceobeSheet !== target.dataset.ceobeSheetTab;
    for (const tab of dialog.querySelectorAll('[data-ceobe-sheet-tab]')) tab.setAttribute('aria-pressed', String(tab === target));
  }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
if(grid)render();

// 选中表格区域后复制，按 TSV 输出，粘到 Excel / Sheets 能直接分列。
document.addEventListener('copy', event => {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const table = start?.closest?.('table.ceobe-sheet-grid');
  if (!table || !dialog.contains(table)) return;
  const rows = [...table.querySelectorAll('tr')].filter(row => range.intersectsNode(row));
  if (!rows.length) return;
  const tsv = rows.map(row => [...row.children]
    .map(cell => (cell.textContent || '').replace(/[\t\r\n]+/g, ' ').trim())
    .join('\t')).join('\n');
  event.clipboardData.setData('text/plain', tsv);
  event.preventDefault();
});
