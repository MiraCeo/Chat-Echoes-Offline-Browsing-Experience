const projectMode=!!document.querySelector('[data-project-files]');
let data = projectMode?(window.ceobeProjectFiles||[]):JSON.parse(document.getElementById('ceobe-assets-data').textContent);
const grid = document.querySelector('[data-ceobe-asset-rows]');
const template = document.getElementById('ceobe-asset-row-template');
const search = document.querySelector('[data-asset-search]');
const dialog = document.querySelector('.ceobe-assets-dialog');
let filter = 'all', sort = 'date', direction = -1, previousFocus, requestVersion = 0;
let view = 'list', sourceFilter = 'all', savedFilter = 'all';
try { if (localStorage.getItem('ceobe.asset.view') === 'grid') view = 'grid'; } catch {}

// —— 文件夹（当标签用）与上传 ——
// 构建时会把文件夹与标签烘进 #ceobe-library-data；本地服务可用时再用 /api/library 刷新，
// 这样静态页面照样能按文件夹筛选，只是不能改名/新建/上传。
let folders = [], folderFilter = 'all', writable = false;
const tags = new Map();
const bakedLibrary = (() => { try { return JSON.parse(document.getElementById('ceobe-library-data')?.textContent || '{}'); } catch { return {}; } })();
if (Array.isArray(bakedLibrary.folders)) folders = bakedLibrary.folders;
const adoptTags = source => {
  tags.clear();
  for (const [id, list] of Object.entries(source || {})) if (Array.isArray(list) && list.length) tags.set(id, new Set(list));
  if (!source) for (const item of data) if (Array.isArray(item.folders) && item.folders.length) tags.set(item.id, new Set(item.folders));
  for (const item of data) item.folders = [...(tags.get(item.id) || [])];
};
adoptTags(bakedLibrary.tags);
const uploadRecord = upload => ({
  id: upload.id, name: upload.name, names: [upload.name], kind: upload.kind || 'file',
  date: upload.added_at, size: upload.size ?? null, status: 'uploaded', sources: [], upload: true,
  download: `./library-files/${upload.stored}`, folders: [...(tags.get(upload.id) || [])],
  preview: upload.kind === 'image' ? { kind: 'image', url: `./library-files/${upload.stored}` }
    : upload.kind === 'text' ? { kind: 'text', url: `./library-files/${upload.stored}` } : null,
});
const mergeUpload = upload => {
  const record = uploadRecord(upload);
  const index = data.findIndex(item => item.id === record.id);
  if (index >= 0) data[index] = { ...data[index], ...record };
  else data.push(record);
};
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
    && (folderFilter === 'all' || tags.get(x.id)?.has(folderFilter))
    && `${x.name} ${x.names.join(' ')} ${x.sources.map(s => s.title).join(' ')} ${(x.folders || []).map(id => folders.find(f => f.id === id)?.name || '').join(' ')}`.toLocaleLowerCase().includes(term));
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
  for (const b of document.querySelectorAll('[data-asset-folder]')) b.setAttribute('aria-pressed', String((b.dataset.assetFolder || 'all') === folderFilter));
}
async function open(item, button) {
  const version = ++requestVersion; previousFocus = button;
  dialog.querySelector('h2').textContent = item.name;
  const body = dialog.querySelector('[data-asset-preview-body]'); body.textContent = '正在加载预览…';
  const links = dialog.querySelector('footer'); links.replaceChildren(); addLinks(links, item);
  paintItemFolders(links, item);
  dialog.showModal(); dialog.querySelector('[data-asset-close]').focus();
  if (!item.preview) { body.textContent = item.download ? '此文件类型暂不支持预览。可以下载原文件，或返回来源会话查看。' : '原资源尚未保存到本地。保留文件记录，不提供虚假预览。'; return; }
  if (item.preview.kind === 'text') {
    try {
      const response = await fetch(item.preview.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (version !== requestVersion || !dialog.open) return;
      const pre = document.createElement('pre'); pre.className = 'ceobe-asset-text';
      pre.textContent = text.length > 400000 ? `${text.slice(0, 400000)}\n…（预览截断，可下载原文件）` : text;
      body.replaceChildren(pre);
    } catch { if (version === requestVersion) body.textContent = '文本预览加载失败，可下载原文件。'; }
    return;
  }
  if (item.preview.kind === 'image') { const img = document.createElement('img'); img.src = item.preview.url; img.alt = item.name; img.onerror = () => { body.textContent = '图片无法预览，可尝试下载原文件。'; }; body.replaceChildren(img); return; }
  try {
    const r = await fetch(item.preview.url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text(); if (version !== requestVersion || !dialog.open) return;
    body.innerHTML = text;
  } catch { if (version === requestVersion) body.textContent = '预览加载失败。请关闭后重试，或下载原文件。'; }
}
function close() { ++requestVersion; dialog.close(); dialog.querySelector('[data-asset-preview-body]').replaceChildren(); previousFocus?.focus(); }

// —— 文件夹（标签）/ 上传的界面 ——
let folderManager, uploadInput, statusLine, notifyTimer;
function notify(text) {
  if (!statusLine) return;
  statusLine.textContent = text || '';
  clearTimeout(notifyTimer);
  if (text) notifyTimer = setTimeout(() => { if (statusLine.textContent === text) statusLine.textContent = ''; }, 8000);
}
async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}
function adoptFolders(payload) {
  if (Array.isArray(payload.folders)) folders = payload.folders;
  adoptTags(payload.tags || {});
  if (folderFilter !== 'all' && !folders.some(folder => folder.id === folderFilter)) folderFilter = 'all';
  paintFolderBar();
  if (folderManager?.open) paintFolderList();
  render();
}
function paintFolderBar() {
  const bar = document.querySelector('[data-asset-folder-bar]');
  if (!bar) return;
  bar.replaceChildren();
  const all = make('button', '全部', 'ceobe-asset-folder');
  all.type = 'button'; all.dataset.assetFolder = 'all'; all.setAttribute('aria-pressed', String(folderFilter === 'all'));
  bar.append(all);
  for (const folder of folders) {
    const chip = make('button', folder.name, 'ceobe-asset-folder');
    chip.type = 'button'; chip.dataset.assetFolder = folder.id;
    chip.setAttribute('aria-pressed', String(folderFilter === folder.id));
    chip.title = `只看「${folder.name}」里的资源（${data.filter(item => tags.get(item.id)?.has(folder.id)).length} 个）`;
    bar.append(chip);
  }
  if (writable) {
    const manage = make('button', '管理文件夹', 'ceobe-asset-foldertool');
    manage.type = 'button'; manage.dataset.assetFoldersManage = '';
    const upload = make('button', '上传文件', 'ceobe-asset-foldertool');
    upload.type = 'button'; upload.dataset.assetUpload = '';
    bar.append(manage, upload);
  }
}
function paintItemFolders(links, item) {
  const row = document.createElement('div');
  row.className = 'ceobe-asset-tagrow';
  row.dataset.assetItemFolders = item.id;
  row.append(make('span', '文件夹', 'ceobe-asset-taglabel'));
  if (!folders.length) row.append(make('span', '还没有文件夹', 'ceobe-asset-taghint'));
  for (const folder of folders) {
    const chip = make('button', folder.name, 'ceobe-asset-tag');
    chip.type = 'button';
    chip.dataset.assetTag = folder.id; chip.dataset.assetTagItem = item.id;
    chip.setAttribute('aria-pressed', String(Boolean(tags.get(item.id)?.has(folder.id))));
    row.append(chip);
  }
  if (writable) {
    const manage = make('button', '管理文件夹', 'ceobe-asset-tagmanage');
    manage.type = 'button'; manage.dataset.assetFoldersManage = '';
    row.append(manage);
  }
  links.append(row);
  if (item.upload && writable) {
    const remove = make('button', '从资料库移除', 'ceobe-asset-remove');
    remove.type = 'button'; remove.dataset.assetRemoveUpload = item.id;
    links.append(remove);
  }
}
async function toggleTag(assetId, folderId) {
  const item = data.find(entry => entry.id === assetId);
  if (!item) return;
  const previous = new Set(tags.get(assetId) || []);
  const next = new Set(previous);
  if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
  tags.set(assetId, next); item.folders = [...next];
  for (const chip of dialog.querySelectorAll(`[data-asset-tag-item="${assetId}"][data-asset-tag="${folderId}"]`)) chip.setAttribute('aria-pressed', String(next.has(folderId)));
  render();
  try { adoptFolders(await api('/api/library/tags', { assetId, folders: [...next] })); }
  catch (error) { tags.set(assetId, previous); item.folders = [...previous]; render(); notify(`标签保存失败：${error.message}`); }
}
async function removeUpload(button) {
  const id = button.dataset.assetRemoveUpload;
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1'; button.textContent = '再点一次确认移除';
    setTimeout(() => { if (button.isConnected) { button.dataset.confirm = ''; button.textContent = '从资料库移除'; } }, 5000);
    return;
  }
  try {
    const payload = await api('/api/library/uploads/remove', { id });
    data = data.filter(item => item.id !== id);
    tags.delete(id);
    close(); adoptFolders(payload);
    notify('已从资料库移除这条记录；磁盘上的文件保留。');
  } catch (error) { notify(`移除失败：${error.message}`); }
}
function folderManagerDialog() {
  if (folderManager) return folderManager;
  folderManager = document.createElement('dialog');
  folderManager.className = 'ceobe-library-folders';
  folderManager.dataset.libraryFolders = '';
  folderManager.innerHTML = '<header><h2>管理文件夹</h2><button type="button" data-library-close aria-label="关闭">关闭 ×</button></header>'
    + '<p class="ceobe-library-hint">文件夹就是标签：一条资源可以同时在多个文件夹里。删除文件夹只删标签，不会删除任何文件。</p>'
    + '<div data-library-folder-list></div>'
    + '<form data-library-folder-create><input data-library-name maxlength="60" aria-label="新文件夹名称" placeholder="新文件夹名称"><button type="submit">新建</button></form>';
  document.body.append(folderManager);
  folderManager.addEventListener('cancel', event => { event.preventDefault(); folderManager.close(); });
  folderManager.querySelector('[data-library-close]').addEventListener('click', () => folderManager.close());
  folderManager.querySelector('[data-library-folder-create]').addEventListener('submit', async event => {
    event.preventDefault();
    const input = folderManager.querySelector('[data-library-name]');
    const name = input.value.trim();
    if (!name) return;
    try { adoptFolders(await api('/api/library/folders', { action: 'create', name })); input.value = ''; notify(`已新建文件夹「${name}」`); }
    catch (error) { notify(`新建失败：${error.message}`); }
  });
  return folderManager;
}
function paintFolderList() {
  const list = folderManager?.querySelector('[data-library-folder-list]');
  if (!list) return;
  list.replaceChildren();
  if (!folders.length) { list.append(make('p', '还没有文件夹。', 'ceobe-library-hint')); return; }
  for (const folder of folders) {
    const row = document.createElement('div');
    row.className = 'ceobe-library-folder';
    row.dataset.libraryFolder = folder.id;
    const input = document.createElement('input');
    input.value = folder.name; input.maxLength = 60; input.setAttribute('aria-label', '文件夹名称');
    const rename = make('button', '重命名', 'ceobe-library-action'); rename.type = 'button';
    const remove = make('button', '删除', 'ceobe-library-danger'); remove.type = 'button';
    rename.addEventListener('click', async () => {
      try { adoptFolders(await api('/api/library/folders', { action: 'rename', id: folder.id, name: input.value })); notify('文件夹已重命名'); }
      catch (error) { notify(`重命名失败：${error.message}`); }
    });
    remove.addEventListener('click', async () => {
      if (remove.dataset.confirm !== '1') {
        remove.dataset.confirm = '1'; remove.textContent = '确认删除';
        setTimeout(() => { if (remove.isConnected) { remove.dataset.confirm = ''; remove.textContent = '删除'; } }, 5000);
        return;
      }
      try { adoptFolders(await api('/api/library/folders', { action: 'delete', id: folder.id })); notify('文件夹已删除；文件与原有标签之外的内容都没动。'); }
      catch (error) { notify(`删除失败：${error.message}`); }
    });
    row.append(input, rename, remove);
    list.append(row);
  }
}
function openFolderManager() {
  const manager = folderManagerDialog();
  paintFolderList();
  if (!manager.open) manager.showModal();
  manager.querySelector('[data-library-name]')?.focus();
}
async function uploadFiles(files) {
  if (!files?.length) return;
  let done = 0;
  const failed = [];
  for (const file of files) {
    try {
      const query = `?name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.type || '')}`;
      const response = await fetch(`/api/library/upload${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      mergeUpload(payload.upload);
      done += 1;
    } catch (error) { failed.push(`${file.name}：${error.message}`); }
  }
  render();
  notify(done && !failed.length ? `已上传 ${done} 个文件` : done ? `已上传 ${done} 个，${failed.length} 个失败（${failed[0]}）` : `上传失败：${failed[0] || '没有选择文件'}`);
}
async function syncLibrary() {
  try {
    const response = await fetch('/api/library', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    writable = Boolean(payload.writable);
    // 服务端可能比静态构建新：先补上传记录，再套标签。
    for (const upload of payload.uploads || []) mergeUpload(upload);
    adoptFolders({ folders: payload.folders || [], tags: payload.tags || {} });
    paintFolderBar();
    render();
  } catch { /* 纯静态：保持构建时的文件夹数据 */ }
}
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

  // 文件夹筛选、状态行、上传入口只在真正的资料库里出现（项目文件视图不共用这些）。
  if (!projectMode) {
    const folderBar = document.createElement('div');
    folderBar.className = 'ceobe-asset-folderbar';
    folderBar.dataset.assetFolderBar = '';
    folderBar.setAttribute('role', 'group');
    folderBar.setAttribute('aria-label', '按文件夹筛选');
    grid.parentElement.insertBefore(folderBar, bar);

    statusLine = document.createElement('p');
    statusLine.className = 'ceobe-asset-status';
    statusLine.dataset.libraryStatus = '';
    statusLine.setAttribute('role', 'status');
    grid.parentElement.insertBefore(statusLine, bar);

    uploadInput = document.createElement('input');
    uploadInput.type = 'file'; uploadInput.multiple = true; uploadInput.hidden = true;
    uploadInput.dataset.assetUploadInput = '';
    uploadInput.addEventListener('change', () => {
      const files = [...(uploadInput.files || [])];
      uploadInput.value = '';
      uploadFiles(files);
    });
    document.body.append(uploadInput);
    paintFolderBar();
  }

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
if (!projectMode) syncLibrary();
document.addEventListener('ceobe:asset-preview',e=>{const item=data.find(x=>x.id===e.detail?.id);if(item)open(item,e.detail.opener)});
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.assetFilter) { filter = target.dataset.assetFilter; render(); }
  if (target.dataset.assetView) { view = target.dataset.assetView; try { localStorage.setItem('ceobe.asset.view', view); } catch {} render(); }
  if (target.dataset.assetSort) { direction = sort === target.dataset.assetSort ? -direction : target.dataset.assetSort === 'name' ? 1 : -1; sort = target.dataset.assetSort; render(); }
  if (target.dataset.assetFolder !== undefined) { folderFilter = target.dataset.assetFolder || 'all'; render(); }
  if (target.dataset.assetFoldersManage !== undefined) openFolderManager();
  if (target.dataset.assetUpload !== undefined) uploadInput?.click();
  if (target.dataset.assetTag && target.dataset.assetTagItem) toggleTag(target.dataset.assetTagItem, target.dataset.assetTag);
  if (target.dataset.assetRemoveUpload) removeUpload(target);
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
