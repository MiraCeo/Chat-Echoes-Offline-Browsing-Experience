(() => {
  const data = window.__TIMELINE_DATA__;
  if (!data || !Array.isArray(data.conversations)) return;
  const main = document.querySelector('#proto');
  const description = document.querySelector('[data-proto-desc]');
  const count = document.querySelector('[data-proto-count]');
  const params = new URLSearchParams(location.search);
  const variant = ['p1', 'p2', 'p3', 'p4'].includes(params.get('v')) ? params.get('v') : 'p1';

  const descriptions = {
    p1: 'P1 会话基础：横轴等距槽位，卡片上下交替；只表达先后，可左右拖动。',
    p2: 'P2 会话进度：会话卡片内加完整进度条；整条=该会话自身跨度，按天填充，填充=有消息的日子（例如 2/3）。',
    p3: 'P3 日期基础：只保留有会话的日期，日期等距；每个日期节点分支挂当天所有会话卡片（按开始时间），卡片标注持续天数。',
    p4: 'P4 日期进度：日期节点 + 完整进度条；日期卡片内逐日填充，整条=该会话总跨度，填充=有消息的日子。',
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
  const fmtTime = seconds => { const p = parts(seconds); return `${p.hours}:${p.minutes}`; };
  const monthKey = seconds => { const p = parts(seconds); return `${p.year}-${pad(p.month)}`; };
  const monthLabel = key => { const [year, month] = key.split('-'); return `${year} 年 ${Number(month)} 月`; };
  const spanDays = (first, last) => Math.max(1, dayDiff(first, last) + 1);

  const items = data.conversations
    .filter(item => Number.isFinite(item.first) && Number.isFinite(item.last))
    .sort((a, b) => b.first - a.first);
  const itemsAsc = [...items].reverse();
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
    link.draggable = false;
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

  const segmentedCoverage = item => {
    const span = spanDays(item.first, item.last);
    const active = new Set(Object.keys(item.days || {}));
    const start = dayNumber(item.first);
    const wrap = el('div', 'proto-coverage');
    const track = el('div', 'proto-segments');
    for (let index = 0; index < span; index += 1) {
      const date = new Date((start + index) * 86400000);
      const key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      const segment = el('span', 'proto-seg' + (active.has(key) ? ' filled' : ''));
      segment.title = key;
      track.append(segment);
    }
    wrap.append(track, el('span', 'proto-coverage-label', `${active.size}/${span} 天有消息`));
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
    const modeLabel = variant === 'p2' ? '会话进度' : '会话基础';
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
      if (variant === 'p2') card.append(segmentedCoverage(item));
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

  const CARD_H = 42;
  const CARD_GAP = 6;
  const renderDateRail = mode => {
    const visual = mode === 'progress';
    const cardH = visual ? 58 : CARD_H;
    const modeLabel = visual ? '日期进度' : '日期基础';
    const groups = new Map();
    for (const item of itemsAsc) {
      const key = fmtDay(item.first);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const dates = [...groups.keys()].sort();
    for (const list of groups.values()) list.sort((a, b) => a.first - b.first);
    const maxCards = Math.max(...[...groups.values()].map(list => list.length));
    const HEADER = 28;
    const TOP_GAP = 10;
    const STEM_GAP = 12;
    const stack = maxCards * cardH + (maxCards - 1) * CARD_GAP;
    const railY = HEADER + TOP_GAP + stack + STEM_GAP;
    const STRIP = railY + 34;
    const width = dates.length * SLOT;
    const railLocal = railY - HEADER;

    const wrap = el('div', 'drl-wrap');
    const toolbar = el('div', 'htl-toolbar');
    const current = el('span', 'hrl-current', monthLabel(dates[dates.length - 1].slice(0, 7)));
    const hint = el('span', 'htl-hint');
    hint.append(`${modeLabel} · ${dates.length} 个有会话的日期 · `, current, ' · 左右拖动平移');
    toolbar.append(hint);
    const latest = el('button', 'htl-latest', '回到最新');
    latest.type = 'button';
    toolbar.append(latest);

    const scroll = el('div', 'drl-scroll');
    const strip = el('div', 'drl-strip');
    strip.style.width = `${width}px`;
    strip.style.height = `${STRIP}px`;
    const months = el('div', 'drl-months');
    let monthStart = 0;
    while (monthStart < dates.length) {
      const month = dates[monthStart].slice(0, 7);
      let end = monthStart;
      while (end < dates.length && dates[end].slice(0, 7) === month) end++;
      const block = el('div', 'drl-month-block');
      block.style.width = `${(end - monthStart) * SLOT}px`;
      block.append(el('span', 'drl-month-label', monthLabel(month)));
      months.append(block);
      monthStart = end;
    }
    const slots = el('div', 'drl-slots');
    slots.style.width = `${width}px`;
    slots.style.height = `${STRIP - HEADER}px`;
    const rail = el('div', 'drl-rail');
    rail.style.top = `${railLocal}px`;
    slots.append(rail);
    let boundary = 0;
    let monthCursor = 0;
    while (monthCursor < dates.length) {
      const month = dates[monthCursor].slice(0, 7);
      let end = monthCursor;
      while (end < dates.length && dates[end].slice(0, 7) === month) end++;
      const line = el('div', 'drl-month-line');
      line.style.left = `${boundary}px`;
      slots.append(line);
      boundary += (end - monthCursor) * SLOT;
      monthCursor = end;
    }
    for (const date of dates) {
      const list = groups.get(date);
      const n = list.length;
      const slot = el('div', 'drl-slot');
      slot.style.width = `${SLOT}px`;
      const topCard = railLocal - STEM_GAP - n * cardH - (n - 1) * CARD_GAP;
      list.forEach((item, index) => {
        const top = railLocal - STEM_GAP - (n - index) * cardH - (n - index - 1) * CARD_GAP;
        const card = el('a', 'drl-card' + (visual ? ' tall' : ''));
        card.draggable = false;
        card.href = hrefOf(item);
        card.target = '_blank';
        card.rel = 'noreferrer';
        card.style.top = `${top}px`;
        card.title = `${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮`;
        card.append(el('span', 'drl-title', item.title));
        const span = spanDays(item.first, item.last);
        const meta = el('span', 'drl-meta', `${fmtTime(item.first)} · ${item.turns} 轮${mode === 'base' ? ` · 持续 ${span} 天` : ''}`);
        card.append(meta);
        if (mode === 'progress') card.append(segmentedCoverage(item));
        slot.append(card);
      });
      const stem = el('div', 'drl-stem');
      stem.style.top = `${topCard}px`;
      stem.style.height = `${railLocal - topCard}px`;
      slot.append(stem);
      const dot = el('span', 'drl-dot');
      dot.style.top = `${railLocal}px`;
      slot.append(dot);
      const label = el('div', 'drl-date');
      label.style.top = `${railLocal + 8}px`;
      label.append(el('span', 'drl-date-text', fmtCardDay(list[0].first)));
      label.append(el('span', 'drl-date-count', `${n} 个会话`));
      slot.append(label);
      slots.append(slot);
    }
    strip.append(months, slots);
    scroll.append(strip);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '每个有会话的日期一个节点；同一天的会话挂在节点分支上；拖动平移画布，点击卡片打开会话。'));
    const updateCurrent = () => {
      const index = Math.min(dates.length - 1, Math.max(0, Math.ceil(scroll.scrollLeft / SLOT)));
      current.textContent = monthLabel(dates[index].slice(0, 7));
    };
    scroll.addEventListener('scroll', updateCurrent);
    requestAnimationFrame(updateCurrent);
    attachPan(scroll, latest);
  };

  if (variant === 'p3' || variant === 'p4') renderDateRail(variant === 'p4' ? 'progress' : 'base');
  else renderHorizontalRail();
})();
