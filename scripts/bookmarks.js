const seed = JSON.parse(document.querySelector('#ceobe-bookmark-data').textContent),
  q = (s) => document.querySelector(s),
  qa = (s) => [...document.querySelectorAll(s)],
  listDialog = q('[data-bookmark-dialog=list]'),
  editor = q('[data-bookmark-dialog=editor]'),
  form = q('[data-bookmark-form]'),
  menu = q('[data-bookmark-menu]');
let items = [],
  writable = false,
  loaded = false,
  scope = seed.chatId ? 'current' : 'all',
  draft = null,
  pending = false,
  menuTrigger = null,
  menuAction = null,
  loadGeneration = 0,
  loadError = '',
  deleteConfirm = false;
const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  },
  toast = (text) => {
    if (editor.open) q('[data-bookmark-editor-status]').textContent = text;
    else if (listDialog.open) q('[data-bookmark-list-status]').textContent = text;
    const e = q('[data-bookmark-status]');
    e.textContent = text;
    e.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (e.hidden = true), 6000);
  };
// The archived message DOM is immutable for this page's lifetime. Resolve
// canonical IDs and merged-message aliases once, not once per caption per frame.
const messageTargets = new Map();
for (const section of qa('[data-bookmark-target]'))
  for (const id of JSON.parse(section.dataset.bookmarkAliases))
    if (!messageTargets.has(id)) messageTargets.set(id, section);
const messageTarget = id => messageTargets.get(id);
let captionEntries = [];
const nearSections = new WeakSet(), observedSections = new Set();
// Reading an inner box of an offscreen content-visibility:auto section forces
// that whole message to render. Observe only the outer section and measure
// captions shortly before they enter view; exact jumps keep their existing path.
const captionViewport = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) nearSections.add(entry.target);
    else nearSections.delete(entry.target);
    setFlag(entry.target, 'data-bookmark-near', entry.isIntersecting);
  }
  layoutCaptions();
}, { rootMargin: '400px 0px' });
function setAttributeIfChanged(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
function setFlag(node, name, value) {
  if (node.hasAttribute(name) !== value) node.toggleAttribute(name, value);
}
function setStyle(node, name, value) {
  if (node.style[name] !== value) node.style[name] = value;
}
function forTarget(id) {
  return (
    items.find((b) => b.chat_id === seed.chatId && b.message_id === id) ||
    items.find(
      (b) => b.chat_id === seed.chatId && messageTarget(b.message_id) === messageTarget(id),
    )
  );
}
function syncMarks() {
  for (const button of qa('[data-bookmark-mark]'))
    button.hidden = !forTarget(button.dataset.bookmarkMark);
  syncCaptions();
}
function captionHost(section) {
  const leftover = section.querySelector('.ceobe-bookmark-caption-host');
  if (leftover) {
    leftover.replaceWith(
      ...[...leftover.childNodes].filter((n) => !n.matches?.('[data-bookmark-caption]')),
    );
  }
  const bubble = section.querySelector('.user-message-bubble-color');
  const shot = section.querySelector('[data-conversation-screenshot-content]');
  return { side: bubble ? 'end' : 'start', host: shot || section };
}
function syncCaptions() {
  for (const section of qa('[data-bookmark-target]')) {
    const id = section.dataset.bookmarkTarget,
      b = forTarget(id);
    let cap =
      document.querySelector('[data-bookmark-caption="' + CSS.escape(id) + '"]') ||
      section.querySelector('[data-bookmark-caption]');
    if (!b) {
      cap?.remove();
      continue;
    }
    const { side, host } = captionHost(section);
    if (!cap) {
      cap = document.createElement('div');
      cap.className = 'ceobe-bookmark-caption';
      cap.dataset.bookmarkCaption = id;
      cap.tabIndex = 0;
      cap.setAttribute('role', 'button');
    }
    cap.dataset.bookmarkSide = side;
    cap.setAttribute('aria-label', '编辑书签 ' + b.title);
    cap.title = b.title;
    const icon = el('span', null, 'ceobe-bookmark-caption-icon');
    icon.append(bookmarkIcon(b.role === 'user' ? 'user' : 'gpt'));
    const body = el('span', null, 'ceobe-bookmark-caption-body');
    body.append(el('span', b.title, 'ceobe-bookmark-caption-title'));
    if (b.note)
      body.append(el('span', b.note.trim(), 'ceobe-bookmark-caption-note'));
    const main = el('span', null, 'ceobe-bookmark-caption-main');
    main.append(icon, body);
    const more = el('button', '展开', 'ceobe-bookmark-caption-expand');
    more.type = 'button';
    more.dataset.bookmarkCaptionExpand = '';
    more.hidden = true;
    cap.replaceChildren(main, more);
    if (!cap.dataset.bookmarkDisplay) {
      cap.dataset.bookmarkDisplay = 'icon';
      cap.style.maxWidth = '28px';
    }
    if (side === 'end') host.append(cap);
    else host.prepend(cap);
  }
  captionEntries = qa('[data-bookmark-caption]').map(cap => {
    const section = messageTarget(cap.dataset.bookmarkCaption);
    return {
      cap, section,
      box: section.querySelector('.user-message-bubble-color') ||
        section.querySelector('[data-conversation-screenshot-content]') || section,
      title: cap.querySelector('.ceobe-bookmark-caption-title'),
      note: cap.querySelector('.ceobe-bookmark-caption-note'),
      more: cap.querySelector('[data-bookmark-caption-expand]'),
    };
  });
  const nextSections = new Set(captionEntries.map(entry => entry.section));
  for (const section of observedSections) if (!nextSections.has(section)) {
    captionViewport.unobserve(section);
    observedSections.delete(section);
    nearSections.delete(section);
    setFlag(section, 'data-bookmark-near', false);
  }
  for (const section of nextSections) if (!observedSections.has(section)) {
    observedSections.add(section);
    captionViewport.observe(section);
  }
  layoutCaptions();
}
const expandedCaptions = new Set();
// One scheduled geometry pass serves resize, ResizeObserver, panel changes and
// bookmark refresh. Measure all boxes before changing any attributes or styles.
let layoutFrame = 0, chromeFrame = 0;
function layoutCaptions() {
  if (chromeFrame) {
    cancelAnimationFrame(chromeFrame);
    chromeFrame = 0;
  }
  if (!layoutFrame) layoutFrame = requestAnimationFrame(flushBookmarkLayout);
}
// The reading column keeps its position and width, so the panel must never take space from `main`.
// It docks in the free gutter left of the text when that gutter can hold it; otherwise it floats as
// a short overlay that dismisses itself on the next click outside (see the pointerdown guard).
const PANEL_MAX_WIDTH = 280, PANEL_MIN_DOCK = 150, PANEL_OVERLAY_HEIGHT = 420;
// The official column is centered inside a padded wrapper, so its two inherited CSS variables give
// the text edge without reading a rect of a section that lazy layout has skipped.
function readingColumnLeft(rect) {
  const wrap = readerMain.querySelector('section[data-testid^="conversation-turn-"] > div');
  const column = wrap?.querySelector('[data-conversation-screenshot-content]');
  if (!column) return rect.left + 16;
  const raw = getComputedStyle(column).getPropertyValue('--thread-content-max-width').trim();
  const number = parseFloat(raw);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const padding = parseFloat(getComputedStyle(wrap).paddingLeft) || 0;
  // The official column sizes itself in rem, so the unit has to be converted before comparing.
  const maxWidth = Number.isFinite(number) ? number * (/rem$/.test(raw) ? rem : 1) : NaN;
  const inner = Math.max(0, rect.width - padding * 2);
  const width = Number.isFinite(maxWidth) ? Math.min(maxWidth, inner) : inner;
  return rect.left + padding + (inner - width) / 2;
}
function flushBookmarkLayout() {
  layoutFrame = 0;
  const main = readerMain?.getBoundingClientRect();
  const isPanel = Boolean(listDialog.open && scope === 'current' && main);
  const panelLeft = main ? main.left + 8 : 0;
  const gutter = main ? Math.round(readingColumnLeft(main) - panelLeft - 8) : 0;
  const docked = isPanel && gutter >= PANEL_MIN_DOCK;
  const panelWidth = main ? Math.min(PANEL_MAX_WIDTH, docked ? gutter : main.width - 24) : 0;
  const top = main ? Math.max(60, main.top + 8) : 60;
  const compact = isPanel && listDialog.dataset.bookmarkPanelEmpty === 'true';
  const panelHeight = Math.max(160, Math.min(docked ? innerHeight : PANEL_OVERLAY_HEIGHT, innerHeight - top - 16));
  const leftEdge = Math.max(8, main?.left || 0, isPanel ? panelLeft + panelWidth + 8 : 0);
  const empty = 2 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  const plans = captionEntries.filter(entry => nearSections.has(entry.section)).map(entry => {
    const r = entry.box.getBoundingClientRect();
    const max = entry.cap.dataset.bookmarkSide === 'start'
      ? r.left - 8 - leftEdge : innerWidth - 8 - (r.right + 8);
    const available = Math.max(0, Math.min(max - empty, max * 0.65));
    const mode = available >= 180 ? 'summary' : available >= 96 ? 'title' : 'icon';
    return { ...entry, mode, inline: mode === 'icon' && max < 28, width: mode === 'icon' ? 28 : available };
  });

  // Write phase. Idempotent writes also avoid ResizeObserver feedback work.
  setAttributeIfChanged(listDialog, 'data-bookmark-view', scope);
  setFlag(document.body, 'data-bookmark-panel-open', false);
  setAttributeIfChanged(listDialog, 'data-bookmark-panel-mode', isPanel ? (docked ? 'dock' : 'overlay') : 'closed');
  // Compact keeps the panel as short as its content, but a narrow window still caps it so it
  // cannot grow taller than the reading column it floats over.
  const panelStyles = isPanel
    ? {
        left: panelLeft + 'px',
        top: top + 'px',
        width: panelWidth + 'px',
        height: compact ? 'auto' : panelHeight + 'px',
        maxHeight: compact ? panelHeight + 'px' : '',
      }
    : { left: '', top: '', width: '', height: '', maxHeight: '' };
  for (const [key, value] of Object.entries(panelStyles)) setStyle(listDialog, key, value);
  if (main && panelButton) {
    setStyle(panelButton, 'right', 'auto');
    setStyle(panelButton, 'left', main.left + 8 + 'px');
    setStyle(panelButton, 'top', top + 'px');
    if (panelButton.hidden !== isPanel) panelButton.hidden = isPanel;
    setAttributeIfChanged(panelButton, 'aria-expanded', String(isPanel));
  }
  for (const { cap, mode, inline, width, more } of plans) {
    setAttributeIfChanged(cap, 'data-bookmark-display', mode);
    setFlag(cap, 'data-bookmark-inline', inline);
    setStyle(cap, 'maxWidth', width + 'px');
    if (mode !== 'summary') expandedCaptions.delete(cap.dataset.bookmarkCaption);
    setFlag(cap, 'data-expanded', mode === 'summary' && expandedCaptions.has(cap.dataset.bookmarkCaption));
    if (mode !== 'summary' && more) {
      if (!more.hidden) more.hidden = true;
      setAttributeIfChanged(more, 'aria-expanded', 'false');
      if (more.dataset.capKey != null) delete more.dataset.capKey;
    }
  }
  // Overflow depends on the newly applied widths. Read it on the next frame,
  // then update all expand controls together rather than forcing layout per item.
  if (!chromeFrame) chromeFrame = requestAnimationFrame(updateExpandChrome);
  schedulePreviewLayout();
}
function updateExpandChrome() {
  chromeFrame = 0;
  const plans = captionEntries.filter(({ cap, more, section }) => nearSections.has(section) && more && cap.dataset.bookmarkDisplay === 'summary')
    .map(({ cap, more, title, note }) => {
      const expanded = expandedCaptions.has(cap.dataset.bookmarkCaption);
      const overflow = !expanded && Boolean(
        (title && title.scrollHeight > title.clientHeight + 1) ||
        (note && note.scrollHeight > note.clientHeight + 1));
      return { more, expanded, overflow };
    });
  for (const { more, expanded, overflow } of plans) {
    const key = (expanded ? '1' : '0') + (expanded || overflow ? '1' : '0');
    if (more.dataset.capKey === key) continue;
    more.dataset.capKey = key;
    const mark = el('span', expanded ? '▴' : '▾');
    mark.setAttribute('aria-hidden', 'true');
    more.replaceChildren(expanded ? '收起' : '展开', mark);
    more.hidden = !expanded && !overflow;
    setAttributeIfChanged(more, 'aria-expanded', String(expanded));
    setAttributeIfChanged(more, 'aria-label', expanded ? '收起书签全文' : '展开书签全文');
  }
}
function editorDisabled() {
  for (const c of form.querySelectorAll('input,textarea,button'))
    c.disabled = pending || (c.matches('[data-bookmark-save],[data-bookmark-delete]') && !writable);
  editor.querySelector('[data-bookmark-close]').disabled = pending;
}
async function refresh() {
  const gen = ++loadGeneration;
  try {
    if (location.protocol === 'file:') throw Error('本页未连接本地服务');
    const r = await fetch('/api/bookmarks', { cache: 'no-store' });
    if (!r.ok) throw Error('书签服务暂不可用');
    const d = await r.json();
    if (!Array.isArray(d.bookmarks) || d.writable !== true) throw Error('书签服务不可用');
    if (gen !== loadGeneration) return;
    items = d.bookmarks;
    writable = true;
    loaded = true;
    loadError = '';
  } catch (e) {
    if (gen !== loadGeneration) return;
    writable = false;
    loadError =
      '书签服务暂不可用。请通过本地服务打开；备注不会写入 HTML 或导出文件。' +
      (loaded ? ' 当前显示上次读取的数据，仅供查看。' : '');
  }
  syncMarks();
  renderList();
  if (editor.open) editorDisabled();
}
// Current-chat bookmarks are a nonmodal left panel; global bookmarks remain modal.
const readerMain = seed.chatId ? q('main') : null;
const panelButton = q('.ceobe-bookmark-rail');
listDialog.id = 'ceobe-bookmark-list-panel';
if (panelButton) {
  panelButton.setAttribute('aria-controls', listDialog.id);
  panelButton.title = '展开当前聊天书签';
  panelButton.setAttribute('aria-label', '展开当前聊天书签');
}
function placeRail() { layoutCaptions(); }
function placeList() { layoutCaptions(); }
function setListMode() {
  if (listDialog.open) listDialog.close();
  if (scope === 'current') listDialog.show();
  else listDialog.showModal();
  placeList();
}
listDialog.addEventListener('close', () => {
  placeList();
});
if (readerMain)
  new ResizeObserver(() => {
    placeList();
  }).observe(readerMain);
placeRail();
const previewText = new WeakMap();
const previewCanvas = document.createElement('canvas'),
  previewMeasure = previewCanvas.getContext('2d');
const graphemes =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
function bookmarkIcon(name) {
  return q('#ceobe-bookmark-icon-' + name).content.firstElementChild.cloneNode(true);
}
// Explicit two-line layout preserves the edit control and uses ASCII "...", not a browser ellipsis.
let previewCache = new WeakMap();
function layoutBookmarkPreviews() {
  previewFrame = 0;
  if (!listDialog.open) return;
  const plans = [];
  for (const box of qa('.ceobe-bookmark-preview')) {
    if (!box.clientWidth) continue;
    const first = box.querySelector('.ceobe-bookmark-preview-first');
    const last = box.querySelector('.ceobe-bookmark-preview-last');
    const style = getComputedStyle(first);
    const font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    const value = previewText.get(box) || '', firstWidth = first.clientWidth, lastWidth = last.clientWidth;
    const previous = previewCache.get(box);
    if (previous && previous.value === value && previous.font === font &&
        previous.firstWidth === firstWidth && previous.lastWidth === lastWidth) continue;
    previewMeasure.font = font;
    const parts = graphemes ? [...graphemes.segment(value)].map(x => x.segment) : Array.from(value);
    function take(chars, width) {
      let stop = chars.indexOf('\n');
      if (stop < 0) stop = chars.length;
      let lo = 0, hi = stop;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (previewMeasure.measureText(chars.slice(0, mid).join('')).width <= width) lo = mid;
        else hi = mid - 1;
      }
      return { text: chars.slice(0, lo).join(''), rest: chars.slice(lo === stop && chars[stop] === '\n' ? lo + 1 : lo) };
    }
    const a = take(parts, firstWidth), b = take(a.rest, lastWidth);
    let tail = b.text;
    if (b.rest.length) {
      const tailParts = graphemes ? [...graphemes.segment(tail)].map(x => x.segment) : Array.from(tail);
      while (tailParts.length && previewMeasure.measureText(tailParts.join('') + '...').width > lastWidth) tailParts.pop();
      tail = tailParts.join('') + '...';
    }
    plans.push({ box, first, last, firstText: a.text, lastText: tail, truncated: String(b.rest.length > 0) });
    previewCache.set(box, { value, font, firstWidth, lastWidth });
  }
  for (const { box, first, last, firstText, lastText, truncated } of plans) {
    if (first.textContent !== firstText) first.textContent = firstText;
    if (last.textContent !== lastText) last.textContent = lastText;
    setAttributeIfChanged(box, 'data-truncated', truncated);
  }
}
let previewFrame = 0;
function schedulePreviewLayout() {
  if (listDialog.open && !previewFrame) previewFrame = requestAnimationFrame(layoutBookmarkPreviews);
}
new ResizeObserver(schedulePreviewLayout).observe(q('[data-bookmark-list]'));
document.fonts?.ready.then(() => {
  previewCache = new WeakMap();
  layoutCaptions();
  schedulePreviewLayout();
});
function renderList() {
  placeList();
  const list = q('[data-bookmark-list]'),
    searchBox = q('[data-bookmark-search]'),
    searchHint = scope === 'current' ? '搜索书签标题' : '搜索书签标题或聊天标题',
    search = searchBox.value.trim().toLocaleLowerCase(),
    filtered = items
      .filter(
        (b) =>
          (scope === 'all' || b.chat_id === seed.chatId) &&
          (!search ||
            (scope === 'current' ? [b.title] : [b.title, b.chat_title]).some((x) =>
              x.toLocaleLowerCase().includes(search),
            )),
      )
      .sort((a, b) =>
        scope === 'current'
          ? (a.order ?? Infinity) - (b.order ?? Infinity) ||
            a.created_at.localeCompare(b.created_at)
          : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
      );
  list.replaceChildren();
  // An empty list is a note, not a column: the panel shrinks to its content instead of standing
  // between the reader and the chat for no reason.
  setAttributeIfChanged(listDialog, 'data-bookmark-panel-empty', String(!filtered.length));
  // Only the panel has to be re-measured here. Asking for a full caption pass would cancel the
  // pending expand-control update that the captions themselves are waiting for.
  if (scope === 'current' && listDialog.open && !layoutFrame)
    layoutFrame = requestAnimationFrame(flushBookmarkLayout);
  searchBox.placeholder = searchHint;
  searchBox.setAttribute('aria-label', searchHint);
  q('[data-bookmark-list-status]').textContent =
    loadError ||
    (!loaded
      ? '正在读取书签…'
      : `${filtered.length} 条书签 · ${scope === 'current' ? '按消息顺序' : '最近编辑优先'} · 仅搜索标题`);
  for (const b of qa('[data-bookmark-scope]')) {
    b.disabled = b.dataset.bookmarkScope === 'current' && !seed.chatId;
    b.setAttribute('aria-pressed', String(b.dataset.bookmarkScope === scope));
  }
  if (!filtered.length) {
    list.append(
      el(
        'p',
        loaded
          ? search
            ? '没有匹配的书签标题或聊天标题。'
            : '还没有书签。打开消息的“更多操作”，选择“添加书签”。'
          : '连接本地服务后可查看书签。',
        'ceobe-bookmark-empty',
      ),
    );
    return;
  }
  for (const b of filtered) {
    const row = el('article', null, 'ceobe-bookmark-row');
    row.dataset.bookmarkRow = b.id;
    const heading = el('div', null, 'ceobe-bookmark-heading');
    const role = el('span', null, 'ceobe-bookmark-role');
    role.setAttribute('role', 'img');
    role.setAttribute('aria-label', b.role === 'user' ? '用户消息' : 'GPT 回复');
    role.title = b.role === 'user' ? '用户' : 'GPT';
    role.append(bookmarkIcon(b.role === 'user' ? 'user' : 'gpt'));
    const jump = el('button', b.title, 'ceobe-bookmark-title');
    jump.type = 'button';
    jump.dataset.bookmarkJump = b.id;
    heading.append(role, jump);
    row.append(heading);
    if (scope === 'all') {
      const source = el('p', b.chat_title, 'ceobe-bookmark-meta');
      source.dataset.bookmarkChatSource = '';
      row.append(source);
    }
    const preview = el(
      'div',
      null,
      'ceobe-bookmark-preview ' + (b.note ? 'ceobe-bookmark-note' : 'ceobe-bookmark-excerpt'),
    );
    const first = el('span', null, 'ceobe-bookmark-preview-first'),
      second = el('div', null, 'ceobe-bookmark-preview-second'),
      last = el('span', null, 'ceobe-bookmark-preview-last');
    const edit = el('button', null, 'ceobe-bookmark-edit-icon');
    edit.type = 'button';
    edit.dataset.bookmarkEdit = b.id;
    edit.setAttribute('aria-label', b.note ? '编辑备注' : '添加备注');
    edit.title = b.note ? '编辑备注' : '添加备注';
    edit.append(bookmarkIcon('edit'));
    second.append(last, edit);
    preview.append(first, second);
    row.append(preview);
    previewText.set(preview, b.note || b.excerpt);
    first.textContent = b.note || b.excerpt;
    const footer = el('div', null, 'ceobe-bookmark-row-footer');
    if (b.target_state !== 'available')
      footer.append(
        el(
          'span',
          b.target_state === 'message_missing'
            ? '原消息已不在当前归档中'
            : b.target_state === 'chat_missing'
              ? '原聊天已不存在'
              : '归档暂不可读取',
          'ceobe-bookmark-warning',
        ),
      );
    else if (b.content_changed)
      footer.append(el('span', '回复内容或分组已有变化', 'ceobe-bookmark-meta'));
    row.append(footer);
    list.append(row);
  }
  schedulePreviewLayout();
}
async function openList(next) {
  closeMenu();
  scope = next === 'current' && seed.chatId ? 'current' : 'all';
  q('[data-bookmark-search]').value = '';
  renderList();
  setListMode();
  placeList();
  q('[data-bookmark-search]').focus();
  await refresh();
}
function closeMenu() {
  menu.hidden = true;
  menuTrigger?.setAttribute('aria-expanded', 'false');
}
function openMenu(trigger, action, label) {
  if (!menu.hidden && menuTrigger === trigger) {
    closeMenu();
    return;
  }
  closeMenu();
  menuTrigger = trigger;
  menuAction = action;
  const item = menu.querySelector('[data-bookmark-menu-action]');
  item.textContent = label;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  const r = trigger.getBoundingClientRect(),
    m = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(innerWidth - m.width - 8, r.right - m.width)) + 'px';
  menu.style.top = Math.max(8, Math.min(innerHeight - m.height - 8, r.bottom + 5)) + 'px';
  item.focus();
}
function openEditor(target, bookmark) {
  closeMenu();
  deleteConfirm = false;
  draft = bookmark
    ? { ...bookmark }
    : {
        chat_id: seed.chatId,
        message_id: target.message_id,
        role: target.role,
        excerpt: target.excerpt,
        title: target.excerpt.slice(0, 64) || '未命名书签',
        note: '',
        version: 0,
      };
  q('#bookmark-title').value = draft.title;
  q('#bookmark-note').value = draft.note;
  q('[data-bookmark-context]').textContent =
    (bookmark?.chat_title || document.title) +
    ' · ' +
    (draft.role === 'user' ? '我的消息' : '助手回复');
  q('[data-bookmark-excerpt]').textContent = draft.excerpt;
  q('[data-bookmark-delete]').hidden = !draft.id;
  q('[data-bookmark-delete]').textContent = '删除书签';
  q('[data-bookmark-editor-status]').textContent = writable
    ? '仅保存个人标题和备注，不修改原消息。'
    : loadError;
  editorDisabled();
  if (!editor.open) editor.showModal();
  q('#bookmark-title').focus();
}
function closeEditor() {
  if (pending) return;
  editor.close();
  draft = null;
  if (listDialog.open) q('[data-bookmark-search]').focus();
}
async function mutate(body) {
  pending = true;
  editorDisabled();
  q('[data-bookmark-editor-status]').textContent = '正在保存…';
  try {
    const r = await fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let d;
    try {
      d = await r.json();
    } catch {
      throw Error('无法确认保存结果，请保留草稿并刷新列表检查，勿重复提交。');
    }
    if (!r.ok) throw Error(d.error || '操作失败，草稿已保留');
    toast(body.action === 'delete' ? '已删除书签，聊天未受影响' : '书签已保存');
    try {
      localStorage.setItem('ceobe:bookmarks:changed', String(Date.now()) + Math.random());
    } catch {}
    pending = false;
    closeEditor();
    await refresh();
    return true;
  } catch (e) {
    q('[data-bookmark-editor-status]').textContent =
      e instanceof TypeError
        ? '无法确认保存结果，请保留草稿并刷新列表检查，勿重复提交。'
        : e.message || '保存失败，草稿已保留';
    return false;
  } finally {
    pending = false;
    editorDisabled();
  }
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!draft || pending || !writable) return;
  mutate({
    action: 'save',
    chatId: draft.chat_id,
    messageId: draft.message_id,
    title: q('#bookmark-title').value,
    note: q('#bookmark-note').value,
    expectedVersion: draft.version,
    expectedId: draft.id || null,
  });
});
async function scrollMessageTop(target) {
  document.documentElement.setAttribute('data-ceobe-accurate-turn-layout', '');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let scroller = target.parentElement;
  while (
    scroller &&
    !(
      /(auto|scroll)/.test(getComputedStyle(scroller).overflowY) &&
      scroller.scrollHeight > scroller.clientHeight
    )
  )
    scroller = scroller.parentElement;
  scroller ||= document.scrollingElement;
  const offset = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  const visibleTop =
    Math.max(offset, document.querySelector('header')?.getBoundingClientRect().bottom || 0) + 8;
  const top = Math.max(0, target.getBoundingClientRect().top + scroller.scrollTop - visibleTop);
  const missing = top - (scroller.scrollHeight - scroller.clientHeight);
  if (missing > 0) {
    const host = document.querySelector('[data-ceobe-message-list]');
    if (host) {
      let space = host.querySelector('[data-ceobe-jump-space]');
      if (!space) {
        space = document.createElement('div');
        space.dataset.ceobeJumpSpace = '';
        space.setAttribute('aria-hidden', 'true');
        host.append(space);
      }
      space.style.height = (parseFloat(space.style.height) || 0) + missing + 1 + 'px';
    }
  }
  scroller.scrollTo({
    top,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
}
async function jump(b) {
  if (b.target_state !== 'available') {
    toast('无法定位：原目标已丢失或归档不可读取。书签和备注仍然保留。');
    return;
  }
  if (b.chat_id !== seed.chatId) {
    const prefix = location.pathname.includes('/conversations/') ? '../' : './';
    location.href =
      prefix +
      'conversations/' +
      encodeURIComponent(b.chat_id) +
      '.html#bookmark=' +
      encodeURIComponent(b.message_id);
    return;
  }
  const target = messageTarget(b.message_id);
  if (!target) {
    toast('当前页面没有该原消息，请刷新归档页面；不会跳到相邻消息。');
    return;
  }
  if (listDialog.open && scope === 'all') listDialog.close();
  const rail = q('[data-ceobe-prompt-rail]');
  rail?.dispatchEvent(new MouseEvent('mouseleave'));
  await scrollMessageTop(target);
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.classList.remove('ceobe-bookmark-highlight');
  void target.offsetWidth;
  target.classList.add('ceobe-bookmark-highlight');
  setTimeout(() => target.classList.remove('ceobe-bookmark-highlight'), 2200);
  history.replaceState(null, '', '#bookmark=' + encodeURIComponent(b.message_id));
}
document.addEventListener('click', async (e) => {
  const expand = e.target.closest('[data-bookmark-caption-expand]');
  if (expand) {
    const cap = expand.closest('[data-bookmark-caption]');
    const id = cap?.dataset.bookmarkCaption;
    if (!id) return;
    if (expandedCaptions.has(id)) expandedCaptions.delete(id);
    else expandedCaptions.add(id);
    layoutCaptions();
    return;
  }
  const button = e.target.closest(
    '[data-bookmark-unavailable],[data-bookmark-open],[data-bookmark-sidebar-more],[data-bookmark-message-more],[data-bookmark-mark],[data-bookmark-caption],[data-bookmark-menu-action],[data-bookmark-scope],[data-bookmark-jump],[data-bookmark-edit],[data-bookmark-close],[data-bookmark-cancel],[data-bookmark-delete]',
  );
  if (!button) return;
  if (button.matches('[data-bookmark-unavailable]'))
    return toast('本地归档不执行消息编辑、评价、云端分享或模型切换；请通过书签记录个人备注。');
  if (button.matches('[data-bookmark-open]')) return openList(button.dataset.bookmarkOpen);
  if (button.matches('[data-bookmark-sidebar-more]'))
    return openMenu(button, () => openList('all'), '全部书签');
  if (button.matches('[data-bookmark-message-more],[data-bookmark-mark],[data-bookmark-caption]')) {
    const id = button.dataset.bookmarkMessageMore || button.dataset.bookmarkMark || button.dataset.bookmarkCaption,
      target = seed.targets.find((t) => t.message_id === id);
    if (!target) return;
    const run = async () => {
      closeMenu();
      await refresh();
      openEditor(target, forTarget(id));
    };
    if (button.hasAttribute('data-bookmark-mark') || button.hasAttribute('data-bookmark-caption'))
      return run();
    return openMenu(button, run, forTarget(id) ? '编辑书签' : '添加书签');
  }
  if (button.matches('[data-bookmark-menu-action]')) return menuAction?.();
  if (button.matches('[data-bookmark-scope]')) {
    scope = button.dataset.bookmarkScope;
    setListMode();
    renderList();
    return;
  }
  if (button.matches('[data-bookmark-jump]')) {
    const id = button.dataset.bookmarkJump;
    await refresh();
    const b = items.find((b) => b.id === id);
    return b ? jump(b) : toast('此书签已在其他窗口删除');
  }
  if (button.matches('[data-bookmark-edit]')) {
    const id = button.dataset.bookmarkEdit;
    await refresh();
    const b = items.find((b) => b.id === id);
    return b ? openEditor(null, b) : toast('此书签已在其他窗口删除');
  }
  if (
    button.matches('[data-bookmark-cancel]') ||
    (button.closest('[data-bookmark-dialog=editor]') && button.matches('[data-bookmark-close]'))
  )
    return closeEditor();
  if (button.matches('[data-bookmark-close]')) return listDialog.close();
  if (button.matches('[data-bookmark-delete]') && draft?.id && !pending && writable) {
    if (!deleteConfirm) {
      deleteConfirm = true;
      button.textContent = '确认删除书签';
      q('[data-bookmark-editor-status]').textContent =
        '删除这条书签及个人备注？不会删除或更改聊天消息。';
      return;
    }
    return mutate({ action: 'delete', id: draft.id, expectedVersion: draft.version });
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !menuTrigger?.contains(e.target)) closeMenu();
  // An overlay panel does cover text, so it is transient by contract: any click outside it (or
  // Escape, handled below) puts the reading view back. A docked panel never covers text, so it stays.
  if (
    listDialog.open &&
    scope === 'current' &&
    listDialog.dataset.bookmarkPanelMode === 'overlay' &&
    !listDialog.contains(e.target) &&
    !e.target.closest('.ceobe-bookmark-rail')
  )
    listDialog.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) {
    e.preventDefault();
    closeMenu();
    menuTrigger?.focus();
  }
  if (
    (e.key === 'Enter' || e.key === ' ') &&
    e.target.matches(
      '[data-bookmark-caption],[data-bookmark-sidebar-more],[data-bookmark-menu-action]',
    )
  ) {
    e.preventDefault();
    e.target.click();
  }
  if (!menu.hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    menu.querySelector('[data-bookmark-menu-action]').focus();
  }
  if (e.key === 'Tab' && !menu.hidden) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && listDialog.open && scope === 'current' && !editor.open && menu.hidden) {
    listDialog.close();
    panelButton?.focus();
  }
});
editor.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEditor();
});
q('[data-bookmark-search]').addEventListener('input', renderList);
window.addEventListener('resize', () => {
  closeMenu();
  layoutCaptions();
});
listDialog.addEventListener('click', (e) => {
  if (scope === 'all' && e.target === listDialog) {
    const r = listDialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      listDialog.close();
  }
});
window.addEventListener('focus', refresh);
window.addEventListener('storage', (e) => {
  if (e.key === 'ceobe:bookmarks:changed') refresh();
});
document.addEventListener('ceobe:chat-updated', refresh);
// Body-search hits on the current page reuse the exact jump; cross-page hits arrive as #bookmark= on load.
document.addEventListener('ceobe:jump-message', (e) => {
  if (!seed.chatId || e.detail?.chatId !== seed.chatId) return;
  e.preventDefault();
  const id = e.detail.messageId;
  if (messageTarget(id)) jump({ chat_id: seed.chatId, message_id: id, target_state: 'available' });
  else toast('当前页面没有该原消息，请刷新归档页面；不会跳到相邻消息。');
});
(async () => {
  await refresh();
  if (location.hash.startsWith('#bookmark=')) {
    let id;
    try {
      id = decodeURIComponent(location.hash.slice(10));
    } catch {}
    if (id) {
      const target = messageTarget(id);
      if (target) jump({ chat_id: seed.chatId, message_id: id, target_state: 'available' });
      else toast('原书签消息未在当前归档页面中找到；未跳转到其他消息。');
    }
  }
})();
