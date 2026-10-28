(() => {
  const data = window.__TIMELINE_DATA__;
  if (!data || !Array.isArray(data.conversations)) return;
  const main = document.querySelector('#proto');
  const description = document.querySelector('[data-proto-desc]');
  const count = document.querySelector('[data-proto-count]');
  const params = new URLSearchParams(location.search);
  const variant = ['p1', 'p2', 'p3', 'p4'].includes(params.get('v')) ? params.get('v') : 'p1';

  const descriptions = {
    p1: 'P1 等距：竖线只表达先后，不表达真实间隔或覆盖。卡片左右交替，适合快速回看“发生了什么”，但不回答“隔了多久、覆盖多长”。',
    p2: 'P2 横向月轴：每月固定 30 天（不是真实日历比例，31 日按月末处理），会话跨度画成横条；左右拖动平移画布，按钮回到最新。',
    p3: 'P3 覆盖条：竖线给顺序，卡片内的条按“最长的会话”归一化显示首末跨度；能比较长短，但不做全档案真实比例。',
    p4: 'P4 活跃日：卡片内的点 = 真的发过消息的日子，空隙保留；能看出“聊了两天、停了一天又回来”，但条本身不再表示连续覆盖。',
  };
  description.textContent = descriptions[variant];
  count.textContent = String(data.conversations.length);
  document.querySelectorAll('[data-variant-link]').forEach(link => {
    if (link.dataset.variantLink === variant) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const pad = value => String(value).padStart(2, '0');
  const parts = seconds => {
    const date = new Date(seconds * 1000);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hours: pad(date.getHours()), minutes: pad(date.getMinutes()) };
  };
  const dayNumber = seconds => {
    const date = new Date(seconds * 1000);
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  };
  const dayDiff = (first, last) => dayNumber(last) - dayNumber(first);
  const fmtDay = seconds => { const p = parts(seconds); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
  const fmtCardDay = seconds => { const p = parts(seconds); return `${p.month}月${p.day}日`; };
  const fmtCardRange = (first, last) => (dayNumber(first) === dayNumber(last) ? fmtCardDay(first) : `${fmtCardDay(first)} → ${fmtCardDay(last)}`);
  const fmtRange = (first, last) => `${fmtDay(first)} → ${fmtDay(last)}`;
  const fmtShort = seconds => { const p = parts(seconds); return `${pad(p.month)}-${pad(p.day)} ${p.hours}:${p.minutes}`; };
  const monthKey = seconds => { const p = parts(seconds); return `${p.year}-${pad(p.month)}`; };
  const monthLabel = key => { const [year, month] = key.split('-'); return `${year} 年 ${Number(month)} 月`; };
  const spanDays = (first, last) => Math.max(1, dayDiff(first, last) + 1);

  const items = data.conversations
    .filter(item => Number.isFinite(item.first) && Number.isFinite(item.last))
    .sort((a, b) => b.first - a.first);
  const maxSpan = Math.max(1, ...items.map(item => spanDays(item.first, item.last)));
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const hrefOf = item => '../../../replay/conversations/' + encodeURIComponent(item.id) + '.html'
    + (item.first_message_id ? '#bookmark=' + encodeURIComponent(item.first_message_id) : '');

  const makeCard = item => {
    const link = el('a', 'proto-card');
    link.href = hrefOf(item);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = `${item.title}\n${fmtRange(item.first, item.last)}（${fmtShort(item.first)} → ${fmtShort(item.last)}）\n${item.turns} 轮`;
    link.append(el('div', 'proto-title', item.title));
    const meta = el('div', 'proto-meta');
    meta.append(el('span', 'proto-range', fmtCardRange(item.first, item.last)));
    meta.append(el('span', 'proto-turns', `${item.turns} 轮`));
    link.append(meta);
    return link;
  };

  const coverageBar = item => {
    const span = spanDays(item.first, item.last);
    const wrap = el('div', 'proto-coverage');
    const track = el('div', 'proto-track');
    const bar = el('div', 'proto-bar');
    bar.style.width = Math.max(4, (span / maxSpan) * 100).toFixed(1) + '%';
    track.append(bar);
    wrap.append(track, el('span', 'proto-coverage-label', `跨度 ${span} 天`));
    return wrap;
  };

  const dayTicks = item => {
    const keys = Object.keys(item.days || {}).sort();
    const span = spanDays(item.first, item.last);
    const start = dayNumber(item.first);
    const wrap = el('div', 'proto-coverage');
    const track = el('div', 'proto-day-track');
    for (const key of keys) {
      const date = new Date(key + 'T00:00:00');
      if (Number.isNaN(date.getTime())) continue;
      const index = Math.max(0, Math.min(span - 1, Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000) - start));
      const left = span === 1 ? 50 : (index / (span - 1)) * 100;
      const tick = el('span', 'proto-tick');
      tick.style.left = left.toFixed(1) + '%';
      tick.title = key;
      track.append(tick);
    }
    wrap.append(track, el('span', 'proto-coverage-label', `${keys.length} 天有消息`));
    return wrap;
  };

  const renderRail = () => {
    const rail = el('div', 'proto-rail');
    rail.append(el('div', 'proto-rail-line'));
    const byMonth = new Map();
    for (const item of items) {
      const key = monthKey(item.first);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(item);
    }
    for (const [key, list] of byMonth) {
      rail.append(el('div', 'proto-month', monthLabel(key)));
      list.forEach((item, index) => {
        const side = index % 2 === 0 ? 'left' : 'right';
        const row = el('div', 'proto-row ' + side);
        const card = makeCard(item);
        card.classList.add(side);
        if (variant === 'p3') card.append(coverageBar(item));
        if (variant === 'p4') card.append(dayTicks(item));
        row.append(card, el('span', 'proto-dot'));
        rail.append(row);
      });
    }
    main.append(rail);
  };

  const renderHorizontal = () => {
    const min = Math.min(...items.map(item => item.first));
    const max = Math.max(...items.map(item => item.last));
    const startDate = new Date(min * 1000);
    const endDate = new Date(max * 1000);
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const months = [];
    while (cursor <= endDate) {
      months.push(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const monthIndex = new Map(months.map((key, index) => [key, index]));
    const DAY = 12;
    const MONTH = 30;
    const WIDTH = months.length * MONTH * DAY;

    const axisPoint = (seconds, isEnd = false) => {
      const p = parts(seconds);
      const index = monthIndex.get(`${p.year}-${pad(p.month)}`);
      if (index == null) return null;
      const day = Math.min(p.day, 30);
      const fraction = Math.min(0.999, (Number(p.hours) * 60 + Number(p.minutes)) / 1440);
      let position = index * MONTH + (day - 1) + fraction;
      if (isEnd && p.day > 30) position = index * MONTH + MONTH - 0.05;
      return Math.max(0, Math.min(months.length * MONTH, position));
    };

    const head = el('div', 'htl-head');
    head.append(el('div', 'htl-corner', '会话'));
    const axis = el('div', 'htl-axis');
    for (const key of months) {
      const block = el('div', 'htl-month');
      block.style.width = `${MONTH * DAY}px`;
      block.append(el('span', 'htl-month-name', key));
      for (const day of [1, 5, 10, 15, 20, 25, 30]) {
        const tick = el('span', 'htl-day', String(day));
        tick.style.left = `${(day - 1) * DAY}px`;
        block.append(tick);
      }
      axis.append(block);
    }
    head.append(axis);

    const body = el('div', 'htl-body');
    const background = el('div', 'htl-bg');
    background.style.width = `${WIDTH}px`;
    months.forEach((key, index) => {
      if (index % 2 === 1) {
        const band = el('div', 'htl-band');
        band.style.left = `${index * MONTH * DAY}px`;
        band.style.width = `${MONTH * DAY}px`;
        background.append(band);
      }
      const line = el('div', 'htl-month-line');
      line.style.left = `${index * MONTH * DAY}px`;
      background.append(line);
    });
    body.append(background);

    for (const item of items) {
      const row = el('div', 'htl-row');
      const label = el('a', 'htl-label');
      label.href = hrefOf(item);
      label.target = '_blank';
      label.rel = 'noreferrer';
      label.title = `${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮`;
      label.append(el('span', 'htl-name', item.title));
      label.append(el('span', 'htl-dates', `${fmtCardRange(item.first, item.last)} · ${item.turns} 轮`));
      const track = el('div', 'htl-track');
      track.style.width = `${WIDTH}px`;
      const start = axisPoint(item.first);
      const end = axisPoint(item.last, true);
      const bar = el('span', 'htl-bar');
      bar.style.left = `${start * DAY}px`;
      bar.style.width = `${Math.max(6, (end - start) * DAY)}px`;
      bar.title = `${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮`;
      track.append(bar);
      row.append(label, track);
      body.append(row);
    }

    const wrap = el('div', 'htl-wrap');
    const toolbar = el('div', 'htl-toolbar');
    toolbar.append(el('span', 'htl-hint', `每月固定 30 天 · ${months[0]} → ${months[months.length - 1]} · 左右拖动平移，31 日按月末处理`));
    const latest = el('button', 'htl-latest', '回到最新');
    latest.type = 'button';
    latest.dataset.htlLatest = '';
    toolbar.append(latest);
    const scroll = el('div', 'htl-scroll');
    scroll.dataset.htlScroll = '';
    scroll.append(head, body);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '横轴：每月固定 30 天（不是真实日历比例）；条长 = 会话首末跨度；点击左侧标题打开会话。'));

    requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    scroll.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      down = true;
      moved = false;
      startX = event.clientX;
      startLeft = scroll.scrollLeft;
      scroll.classList.add('is-dragging');
      scroll.setPointerCapture(event.pointerId);
    });
    scroll.addEventListener('pointermove', event => {
      if (!down) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      scroll.scrollLeft = startLeft - dx;
    });
    const endDrag = () => {
      if (!down) return;
      down = false;
      scroll.classList.remove('is-dragging');
    };
    scroll.addEventListener('pointerup', endDrag);
    scroll.addEventListener('pointercancel', endDrag);
    scroll.addEventListener('click', event => {
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
      moved = false;
    }, true);
    latest.addEventListener('click', () => scroll.scrollTo({ left: scroll.scrollWidth, behavior: 'smooth' }));
  };

  if (variant === 'p2') renderHorizontal();
  else renderRail();
})();
