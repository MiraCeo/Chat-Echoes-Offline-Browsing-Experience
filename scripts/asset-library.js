const data = JSON.parse(document.getElementById('ceobe-assets-data').textContent);
const grid = document.querySelector('[data-ceobe-asset-rows]');
const template = document.getElementById('ceobe-asset-row-template');
const search = document.querySelector('[data-asset-search]');
const dialog = document.querySelector('.ceobe-assets-dialog');
let filter = 'all', sort = 'date', direction = -1, previousFocus, requestVersion = 0;
const fmtSize = n => n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtDate = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN'); };
const make = (tag, text, className) => { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; };
function addLinks(parent, item) {
  if (item.download) { const a = make('a', '下载', 'ceobe-asset-link'); a.href = item.download; a.download = item.name; parent.append(a); }
  for (const source of item.sources) { const a = make('a', `来源：${source.title}`, 'ceobe-asset-link'); a.href = source.page; a.title = '回到来源会话'; parent.append(a); }
}
function render() {
  const term = search.value.trim().toLocaleLowerCase();
  const shown = data.filter(x => (filter === 'all' || x.kind === filter) && `${x.name} ${x.names.join(' ')} ${x.sources.map(s => s.title).join(' ')}`.toLocaleLowerCase().includes(term));
  shown.sort((a, b) => direction * (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : sort === 'size' ? (a.size ?? -1) - (b.size ?? -1) : String(a.date).localeCompare(String(b.date))) || a.id.localeCompare(b.id));
  grid.replaceChildren();
  for (const item of shown) {
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
  document.querySelector('[data-asset-summary]').textContent = `${shown.length} / ${data.length} 个附件 · 按文件内容去重，保留全部来源 · 时间为本地归档时间`;
  const empty = document.querySelector('[data-asset-empty]'); empty.hidden = shown.length > 0;
  if (!data.length) empty.textContent = '还没有归档附件。导入含有附件的会话后，它们会出现在这里。';
  for (const b of document.querySelectorAll('[data-asset-filter]')) b.setAttribute('aria-pressed', String(b.dataset.assetFilter === filter));
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
search.addEventListener('input', render);
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.assetFilter) { filter = target.dataset.assetFilter; render(); }
  if (target.dataset.assetSort) { direction = sort === target.dataset.assetSort ? -direction : target.dataset.assetSort === 'name' ? 1 : -1; sort = target.dataset.assetSort; render(); }
  if (target.dataset.assetOpen) open(data.find(x => x.id === target.dataset.assetOpen), target);
  if (target.hasAttribute('data-asset-close') || (dialog.contains(target) && target.hasAttribute('data-ceobe-close-preview'))) close();
  if (dialog.contains(target) && target.hasAttribute('data-ceobe-sheet-tab')) {
    for (const sheet of dialog.querySelectorAll('[data-ceobe-sheet]')) sheet.hidden = sheet.dataset.ceobeSheet !== target.dataset.ceobeSheetTab;
    for (const tab of dialog.querySelectorAll('[data-ceobe-sheet-tab]')) tab.setAttribute('aria-pressed', String(tab === target));
  }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
render();
