// Continue reading: reopen a chat where the reader left off. The record lives in this
// browser only (localStorage, like the sidebar preferences); archives, exports and the
// bookmark store are untouched, and no message text is stored — only the canonical
// message ID, its turn number and the pixel offset inside that message, because turn
// heights move with width, fonts and the reader's lazy (content-visibility) layout.
(() => {
  const KEY = 'ceobe.reading-position.v1';
  const MAX_CHATS = 60, MIN_OFFSET = 24, SAVE_DELAY = 900, CHIP_LIFE = 12000, PASS_LIMIT = 4;
  const chatId = document.body.dataset.readerChatId;
  const sections = [...document.querySelectorAll('section[data-ceobe-message-ids]')];
  if (!chatId || sections.length < 2) return;
  const indexById = new Map();
  for (const [index, section] of sections.entries())
    for (const id of JSON.parse(section.dataset.ceobeMessageIds || '[]'))
      if (!indexById.has(id)) indexById.set(id, index);
  let scroller = sections[0].parentElement;
  while (
    scroller &&
    !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)
  )
    scroller = scroller.parentElement;
  scroller ||= document.scrollingElement;
  const root = scroller === document.scrollingElement;
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Same visible-top convention the bookmark jump uses, so both land on the same line.
  const clipTop = () =>
    Math.max(
      root ? 0 : scroller.getBoundingClientRect().top,
      document.querySelector('header')?.getBoundingClientRect().bottom || 0,
    ) + 8;
  const maxTop = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const turnLabel = (index) => '第 ' + (index + 1) + ' 轮';
  const read = () => {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null');
      return data && data.items && typeof data.items === 'object' ? data.items : {};
    } catch {
      return {};
    }
  };
  const write = (items) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, items }));
    } catch {}
  };
  let hint = 0, timer = 0, last = null, manual = false;
  const firstId = (index) => JSON.parse(sections[index]?.dataset.ceobeMessageIds || '[]')[0] || null;
  // Measure outwards from the previous anchor: reading a rect of a skipped section forces
  // its layout, so the whole conversation is never walked on a scroll tick.
  function anchor() {
    const clip = clipTop();
    let i = Math.max(0, Math.min(sections.length - 1, hint));
    while (i + 1 < sections.length && sections[i + 1].getBoundingClientRect().top <= clip + 1) i++;
    while (i > 0 && sections[i].getBoundingClientRect().top > clip + 1) i--;
    hint = i;
    const rect = sections[i].getBoundingClientRect();
    const offset = Math.round(Math.min(Math.max(0, clip - rect.top), Math.max(0, rect.height - MIN_OFFSET)));
    return { index: i, offset };
  }
  function clear() {
    const items = read();
    if (items[chatId]) {
      delete items[chatId];
      write(items);
    }
    last = null;
  }
  function remember() {
    if (scroller.scrollTop < MIN_OFFSET) return clear();
    const { index, offset } = anchor();
    const id = firstId(index);
    if (!id || offset < MIN_OFFSET) return;
    if (last && last.m === id && Math.abs(last.o - offset) < 8) return;
    last = { m: id, o: offset, n: index, t: Date.now() };
    const items = read();
    items[chatId] = last;
    const keys = Object.keys(items);
    if (keys.length > MAX_CHATS)
      for (const key of keys
        .sort((a, b) => (items[a]?.t || 0) - (items[b]?.t || 0))
        .slice(0, keys.length - MAX_CHATS))
        delete items[key];
    write(items);
  }
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      remember();
    }, SAVE_DELAY);
  };
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    remember();
  };
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  addEventListener('resize', schedule);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  // Web fonts and images reflow the page after the first paint; only correction passes that
  // the reader has not interrupted are allowed to move the view again.
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
    document.addEventListener(type, () => (manual = true), { capture: true, passive: true, once: true });
  // Re-anchor the message the reader actually clicked to, rather than the one we restored.
  document.addEventListener('ceobe:jump-message', (e) => {
    const index = indexById.get(e.detail?.messageId);
    if (index !== undefined) hint = index;
  });
  async function place(index, offset) {
    for (let pass = 0; pass < PASS_LIMIT; pass++) {
      const before = scroller.scrollTop;
      const delta = sections[index].getBoundingClientRect().top - (clipTop() - offset);
      if (Math.abs(delta) <= 2) break;
      scroller.scrollTop = Math.max(0, Math.min(maxTop(), before + delta));
      await frames();
      if (Math.abs(scroller.scrollTop - before) < 1) break;
    }
  }
  function make(attr, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-' + attr, '');
    b.textContent = label;
    return b;
  }
  function chip(index, messageId) {
    const box = document.createElement('div');
    box.dataset.ceobeReadingPosition = '';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.textContent = '已回到上次阅读位置 · ' + turnLabel(index);
    const jump = make('ceobe-reading-jump', '跳到该条消息');
    const start = make('ceobe-reading-top', '从头阅读');
    const close = make('ceobe-reading-close', '×');
    close.setAttribute('aria-label', '关闭阅读位置提示');
    box.append(text, jump, start, close);
    document.body.append(box);
    const hide = () => box.remove();
    const life = setTimeout(hide, CHIP_LIFE);
    box.addEventListener('pointerenter', () => clearTimeout(life));
    box.addEventListener('focusin', () => clearTimeout(life));
    box.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      clearTimeout(life);
      if (button === close) return hide();
      if (button === start) {
        clear();
        scroller.scrollTop = 0;
        hint = 0;
        return hide();
      }
      if (button !== jump) return;
      // Prefer the bookmark module's exact jump; fall back to an equally exact scroll here.
      if (!document.dispatchEvent(new CustomEvent('ceobe:jump-message', { cancelable: true, detail: { chatId, messageId } })))
        return hide();
      document.documentElement.setAttribute('data-ceobe-accurate-turn-layout', '');
      frames().then(() => place(index, 0)).then(hide);
    });
  }
  async function restore() {
    const item = read()[chatId];
    // An explicit bookmark or search target is the reader's own instruction, so it wins.
    if (!item || !Number.isInteger(item.o) || item.o < MIN_OFFSET || location.hash.startsWith('#bookmark=')) return;
    const index = indexById.get(item.m);
    if (index === undefined) return clear();
    hint = index;
    await frames();
    await place(index, item.o);
    hint = index;
    last = { m: item.m, o: item.o, n: index };
    chip(index, item.m);
    if (document.fonts?.ready)
      document.fonts.ready.then(async () => {
        if (manual) return;
        await place(index, item.o);
        hint = index;
      });
  }
  restore();
})();
