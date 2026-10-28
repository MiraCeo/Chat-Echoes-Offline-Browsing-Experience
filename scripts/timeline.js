(() => {
  const groups = document.querySelector('[data-ceobe-timeline-groups]');
  const status = document.querySelector('[data-ceobe-timeline-status]');
  const empty = document.querySelector('[data-ceobe-timeline-empty]');
  const orderButtons = [...document.querySelectorAll('[data-ceobe-timeline-order]')];
  if (!groups || !status) return;

  const root = new URL('./', location.href);
  const ORDER_KEY = 'ceobe.timeline.order';
  let order = 'newest';
  try { if (localStorage.getItem(ORDER_KEY) === 'oldest') order = 'oldest'; } catch { /* 隐私模式下没有 localStorage */ }
  let index = null;
  let titles = new Map();

  const pad = value => String(value).padStart(2, '0');
  const parts = seconds => {
    const date = new Date(seconds * 1000);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
      date,
    };
  };
  const monthKey = seconds => { const p = parts(seconds); return `${p.year}-${pad(p.month)}`; };
  const monthLabel = key => { const [year, month] = key.split('-'); return `${year} 年 ${Number(month)} 月`; };
  const dayLabel = p => `${p.month}月${p.day}日`;
  const clockLabel = p => `${pad(p.hours)}:${pad(p.minutes)}`;
  const rangeLabel = (first, last) => {
    if (!Number.isFinite(first)) return '时间未知';
    const a = parts(first);
    if (!Number.isFinite(last) || last === first) return `${dayLabel(a)} ${clockLabel(a)}`;
    const b = parts(last);
    if (a.date.toDateString() === b.date.toDateString()) return `${dayLabel(a)} ${clockLabel(a)}–${clockLabel(b)}`;
    if (a.year === b.year) return `${dayLabel(a)} ${clockLabel(a)} → ${dayLabel(b)} ${clockLabel(b)}`;
    return `${a.year}年${dayLabel(a)} ${clockLabel(a)} → ${b.year}年${dayLabel(b)} ${clockLabel(b)}`;
  };
  const count = value => Number(value).toLocaleString('zh-CN');
  const titleOf = item => titles.get(item.id) || '会话 ' + String(item.id).slice(0, 8);

  const syncOrderButtons = () => {
    for (const button of orderButtons) {
      const active = (button.dataset.ceobeTimelineOrder || 'newest') === order;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  const setOrder = next => {
    order = next === 'oldest' ? 'oldest' : 'newest';
    try { localStorage.setItem(ORDER_KEY, order); } catch { /* ignore */ }
    syncOrderButtons();
    if (index) draw();
  };

  const fail = text => {
    status.textContent = text;
    groups.replaceChildren();
    if (empty) empty.hidden = true;
  };

  const buildList = (items, { undated = false } = {}) => {
    const list = document.createElement('ol');
    list.className = 'ceobe-timeline-list';
    for (const item of items) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'ceobe-timeline-row';
      const href = 'conversations/' + encodeURIComponent(item.id) + '.html'
        + (item.first_message_id ? '#bookmark=' + encodeURIComponent(item.first_message_id) : '');
      link.href = new URL(href, root).href;

      const title = document.createElement('span');
      title.className = 'ceobe-timeline-title';
      title.textContent = titleOf(item);

      const meta = document.createElement('span');
      meta.className = 'ceobe-timeline-meta';
      let when;
      if (undated) {
        when = document.createElement('span');
        when.className = 'ceobe-timeline-when';
        when.textContent = '时间未知';
      } else {
        when = document.createElement('time');
        when.className = 'ceobe-timeline-when';
        when.dateTime = new Date(item.first * 1000).toISOString();
        when.textContent = rangeLabel(item.first, item.last);
      }
      const turns = document.createElement('span');
      turns.className = 'ceobe-timeline-turns';
      turns.textContent = Number.isFinite(item.turns) ? `${item.turns} 轮` : '';
      meta.append(when, document.createTextNode(' · '), turns);
      link.append(title, meta);

      const accessible = [titleOf(item), when.textContent, turns.textContent].filter(Boolean).join('，');
      link.setAttribute('aria-label', accessible);
      row.append(link);
      list.append(row);
    }
    return list;
  };

  const draw = () => {
    if (!index) return;
    const dated = index.conversations.filter(item => Number.isFinite(item.first));
    const undated = index.conversations.filter(item => !Number.isFinite(item.first));
    const totalTurns = index.conversations.reduce((sum, item) => sum + (Number.isFinite(item.turns) ? item.turns : 0), 0);
    const byMonth = new Map();
    for (const item of dated) {
      const key = monthKey(item.first);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(item);
    }
    const months = [...byMonth.keys()].sort((a, b) => (order === 'oldest' ? a.localeCompare(b) : b.localeCompare(a)));
    groups.replaceChildren();
    for (const key of months) {
      const items = byMonth.get(key).sort((a, b) => (order === 'oldest' ? a.first - b.first : b.first - a.first));
      const turns = items.reduce((sum, item) => sum + (Number.isFinite(item.turns) ? item.turns : 0), 0);
      const section = document.createElement('section');
      section.className = 'ceobe-timeline-month';
      const head = document.createElement('div');
      head.className = 'ceobe-timeline-month-head';
      const heading = document.createElement('h2');
      heading.textContent = monthLabel(key);
      const tally = document.createElement('span');
      tally.className = 'ceobe-timeline-month-count';
      tally.textContent = `${count(items.length)} 个会话 · ${count(turns)} 轮`;
      head.append(heading, tally);
      section.append(head, buildList(items));
      groups.append(section);
    }
    if (undated.length) {
      const section = document.createElement('section');
      section.className = 'ceobe-timeline-month';
      const head = document.createElement('div');
      head.className = 'ceobe-timeline-month-head';
      const heading = document.createElement('h2');
      heading.textContent = '时间未知';
      const tally = document.createElement('span');
      tally.className = 'ceobe-timeline-month-count';
      tally.textContent = `${count(undated.length)} 个会话`;
      head.append(heading, tally);
      section.append(head, buildList(undated, { undated: true }));
      groups.append(section);
    }
    if (empty) empty.hidden = index.conversations.length > 0;
    status.textContent = index.conversations.length
      ? `${count(index.conversations.length)} 个会话 · ${count(totalTurns)} 轮 · 本地时间`
      : '暂无会话';
  };

  for (const button of orderButtons) {
    button.addEventListener('click', () => setOrder(button.dataset.ceobeTimelineOrder));
  }
  syncOrderButtons();

  const viewButtons = [...document.querySelectorAll('[data-ceobe-view]')];
  const viewPanels = [...document.querySelectorAll('[data-ceobe-view-panel]')];
  const VIEW_KEY = 'ceobe.timeline.view';
  const setView = (view, { persist = true, updateUrl = true } = {}) => {
    const current = view === 'axis' ? 'axis' : 'timeline';
    for (const button of viewButtons) {
      const active = button.dataset.ceobeView === current;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of viewPanels) {
      panel.hidden = panel.dataset.ceobeViewPanel !== current;
    }
    if (persist) {
      try { localStorage.setItem(VIEW_KEY, current); } catch { /* ignore */ }
    }
    if (updateUrl) {
      const url = new URL(location.href);
      if (current === 'axis') url.searchParams.set('view', 'axis');
      else url.searchParams.delete('view');
      history.replaceState(null, '', url);
    }
    document.dispatchEvent(new CustomEvent('ceobe:view', { detail: { view: current } }));
  };
  if (viewButtons.length) {
    let stored = null;
    try { stored = localStorage.getItem(VIEW_KEY); } catch { /* ignore */ }
    const requested = new URLSearchParams(location.search).get('view') || stored;
    setView(requested === 'axis' ? 'axis' : 'timeline', { persist: false, updateUrl: false });
    for (const button of viewButtons) {
      button.addEventListener('click', () => setView(button.dataset.ceobeView));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = viewButtons.indexOf(button);
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? viewButtons.length - 1
            : event.key === 'ArrowLeft' ? (index - 1 + viewButtons.length) % viewButtons.length
              : (index + 1) % viewButtons.length;
        viewButtons[next].focus();
        setView(viewButtons[next].dataset.ceobeView);
      });
    }
  }

  Promise.all([
    fetch(new URL('timeline-index.json', root), { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }),
    fetch(new URL('chats.json', root), { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null),
  ]).then(([payload, catalog]) => {
    if (!payload || payload.kind !== 'ceobe.timeline-index' || !Array.isArray(payload.conversations)) {
      fail('时间线索引不可用：请运行 npm run library 重建阅读页。');
      return;
    }
    index = payload;
    titles = new Map((catalog?.chats || []).map(chat => [chat.id, chat.title]));
    draw();
  }).catch(error => fail('时间线索引不可用：' + (error?.message || error) + '。请运行 npm run library 重建阅读页。'));
})();
