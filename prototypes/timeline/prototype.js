(() => {
  const data = window.__TIMELINE_DATA__;
  if (!data || !Array.isArray(data.conversations)) return;
  const main = document.querySelector('#proto');
  const description = document.querySelector('[data-proto-desc]');
  const count = document.querySelector('[data-proto-count]');
  const params = new URLSearchParams(location.search);
  const variant = ['p1', 'p2', 'p3', 'p4'].includes(params.get('v')) ? params.get('v') : 'p1';

  const descriptions = {
    p1: 'P1 横向等距：横轴按会话先后等距排布，卡片上下交替；只表达先后，不表达真实间隔或覆盖。左右拖动平移画布。',
    p2: 'P2 横向覆盖条：与 P1 相同的横轴，卡片内加一条连续跨度条（按最长会话归一化）；能比较长短，不做全档案真实位置。',
    p3: 'P3 横向活跃日：卡片内的点 = 真的有消息的日子，空隙保留；能看出“聊了两天、停了一天又回来”。',
    p4: 'P4 固定 30 天轴：每月固定 30 天（不是真实日历比例，31 日按月末处理），每行一条会话，条长 = 首末跨度；左右拖动平移。',
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
  const itemsAsc = [...items].reverse();
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

  const attachPan = (scroll, latest) => {
    const target = () => scroll.scrollWidth - scroll.clientWidth;
    requestAnimationFrame(() => { scroll.scrollLeft = target(); });
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
    latest?.addEventListener('click', () => scroll.scrollTo({ left: target(), behavior: 'auto' }));
  };

  const SLOT = 232;
  const renderHorizontalRail = () => {
    const groups = new Map();
    for (const item of itemsAsc) {
      const key = monthKey(item.first);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const width = itemsAsc.length * SLOT;
    const wrap = el('div', 'hrl-wrap');
    const toolbar = el('div', 'htl-toolbar');
    const modeLabel = variant === 'p2' ? '横向覆盖条' : variant === 'p3' ? '横向活跃日' : '横向等距';
    const hint = el('span', 'htl-hint');
    const current = el('span', 'hrl-current', monthLabel(monthKey(itemsAsc[itemsAsc.length - 1].first)));
    hint.append(`${modeLabel} · ${itemsAsc.length} 个会话 · `, current, ' · 左右拖动平移');
    toolbar.append(hint);
    const latest = el('button', 'htl-latest', '回到最新');
    latest.type = 'button';
    toolbar.append(latest);

    const scroll = el('div', 'hrl-scroll');
    const strip = el('div', 'hrl-strip');
    strip.style.width = `${width}px`;
    const months = el('div', 'hrl-months');
    for (const [key, list] of groups) {
      const block = el('div', 'hrl-month-block');
      block.style.width = `${list.length * SLOT}px`;
      block.append(el('span', 'hrl-month-label', monthLabel(key)));
      months.append(block);
    }
    const slots = el('div', 'hrl-slots');
    slots.style.width = `${width}px`;
    slots.append(el('div', 'hrl-rail-line'));
    let boundary = 0;
    for (const [, list] of groups) {
      const line = el('div', 'hrl-month-line');
      line.style.left = `${boundary}px`;
      slots.append(line);
      boundary += list.length * SLOT;
    }
    itemsAsc.forEach((item, index) => {
      const slot = el('div', 'hrl-slot');
      const side = index % 2 === 0 ? 'above' : 'below';
      const card = makeCard(item);
      card.classList.add('hrl-card', side);
      if (variant === 'p2') card.append(coverageBar(item));
      if (variant === 'p3') card.append(dayTicks(item));
      slot.append(card, el('span', 'hrl-dot'));
      slots.append(slot);
    });
    strip.append(months, slots);
    scroll.append(strip);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '横轴按会话先后等距排布，卡片上下交替；拖动平移画布，点击卡片打开会话。'));
    const updateCurrent = () => {
      const index = Math.min(itemsAsc.length - 1, Math.max(0, Math.ceil(scroll.scrollLeft / SLOT)));
      current.textContent = monthLabel(monthKey(itemsAsc[index].first));
    };
    scroll.addEventListener('scroll', updateCurrent);
    requestAnimationFrame(updateCurrent);
    attachPan(scroll, latest);
  };

  const MONTH = 30;
  const DAY = 12;
  const renderFixedMonthAxis = () => {
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
    toolbar.append(latest);
    const scroll = el('div', 'htl-scroll');
    scroll.append(head, body);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '横轴：每月固定 30 天（不是真实日历比例）；条长 = 会话首末跨度；点击左侧标题打开会话。'));
    attachPan(scroll, latest);
  };

  if (variant === 'p4') renderFixedMonthAxis();
  else renderHorizontalRail();
})();
