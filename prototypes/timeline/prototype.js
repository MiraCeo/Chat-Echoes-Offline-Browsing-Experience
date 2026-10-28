(() => {
  const data = window.__TIMELINE_DATA__;
  if (!data || !Array.isArray(data.conversations)) return;
  const main = document.querySelector('#proto');
  const description = document.querySelector('[data-proto-desc]');
  const count = document.querySelector('[data-proto-count]');
  const params = new URLSearchParams(location.search);
  const variant = ['p1', 'p2', 'p3', 'p4', 'p5', 'p5a', 'p6'].includes(params.get('v')) ? params.get('v') : 'p1';

  const descriptions = {
    p1: 'P1 会话基础：横轴等距槽位，卡片上下交替；只表达先后，可左右拖动。',
    p2: 'P2 会话进度：会话卡片内加完整进度条；整条=该会话自身跨度，按天填充，填充=有消息的日子（例如 2/3）。',
    p3: 'P3 日期基础：只保留有会话的日期，日期等距；每个日期节点分支挂当天所有会话卡片（按开始时间），卡片标注持续天数。',
    p4: 'P4 日期进度：日期节点 + 完整进度条；日期卡片内逐日填充，整条=该会话总跨度，填充=有消息的日子。',
    p5: 'P5 卡片泳道：保留 P3 的白色标题卡；卡片按日期格拉伸（一天=相邻节点中点之间），3 条泳道互不交叉。',
    p5a: 'P5A 分离泳道（对照）：保留 P3 的卡片堆叠，跨度条单独放在下方 3 条泳道。',
    p6: 'P6 缩略图：按真实日历天数（7px/天）把全档案压缩到一屏；月份宽度=实际天数，3 条泳道、纯色细条、无卡片文字。',
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

  const renderSpanRail = () => {
    const NODE_W = 155;
    const CARD_W = 124;
    const CARD_H = 38;
    const CARD_GAP = 4;
    const HEADER = 26;
    const TOP_GAP = 6;
    const LANE_H = 22;
    const LANES = 3;

    const startDates = new Map();
    const endDates = new Map();
    const allDates = new Set();
    for (const item of itemsAsc) {
      const startKey = fmtDay(item.first);
      const endKey = fmtDay(item.last);
      allDates.add(startKey);
      allDates.add(endKey);
      if (!startDates.has(startKey)) startDates.set(startKey, []);
      startDates.get(startKey).push(item);
      if (endKey !== startKey) {
        if (!endDates.has(endKey)) endDates.set(endKey, []);
        endDates.get(endKey).push(item);
      }
    }
    const dates = [...allDates].sort();
    const dateIndex = new Map(dates.map((date, index) => [date, index]));
    const maxCards = Math.max(1, ...[...startDates.values()].map(list => list.length));
    const stack = maxCards * CARD_H + (maxCards - 1) * CARD_GAP;
    const RAIL = HEADER + TOP_GAP + stack + 10;
    const SPAN_TOP = RAIL + 22;
    const STRIP = SPAN_TOP + LANES * LANE_H + 8;
    const width = dates.length * NODE_W;
    const centerOf = key => dateIndex.get(key) * NODE_W + NODE_W / 2;
    const numberOf = new Map(itemsAsc.map((item, index) => [item, index + 1]));

    const lanes = [[], [], []];
    for (const item of itemsAsc) {
      const startIndex = dateIndex.get(fmtDay(item.first));
      const endIndex = dateIndex.get(fmtDay(item.last));
      const startX = startIndex * NODE_W + NODE_W * 0.1;
      const endX = endIndex * NODE_W + NODE_W * 0.9;
      const barWidth = Math.max(6, endX - startX);
      const effectiveEnd = startX + barWidth;
      let lane = lanes.find(list => !list.length || list[list.length - 1].endX <= startX);
      if (!lane) {
        lane = [];
        lanes.push(lane);
      }
      lane.push({ item, startX, endX: effectiveEnd });
    }

    const wrap = el('div', 'snd-wrap');
    const toolbar = el('div', 'htl-toolbar');
    const current = el('span', 'hrl-current', monthLabel(dates[dates.length - 1].slice(0, 7)));
    const hint = el('span', 'htl-hint');
    hint.append(`跨节点 · ${dates.length} 个日期 · ${itemsAsc.length} 条会话 · ${lanes.length} 条泳道 · `, current, ' · 左右拖动平移');
    toolbar.append(hint);
    const latest = el('button', 'htl-latest', '回到最新');
    latest.type = 'button';
    toolbar.append(latest);

    const scroll = el('div', 'snd-scroll');
    const strip = el('div', 'snd-strip');
    strip.style.width = `${width}px`;
    strip.style.height = `${STRIP}px`;

    const months = el('div', 'snd-months');
    let monthStart = 0;
    while (monthStart < dates.length) {
      const key = dates[monthStart].slice(0, 7);
      let end = monthStart;
      while (end < dates.length && dates[end].slice(0, 7) === key) end++;
      const block = el('div', 'snd-month');
      block.style.width = `${(end - monthStart) * NODE_W}px`;
      block.append(el('span', 'snd-month-label', monthLabel(key)));
      months.append(block);
      monthStart = end;
    }
    strip.append(months);

    const body = el('div', 'snd-body');
    body.style.height = `${STRIP - HEADER}px`;
    const rail = el('div', 'snd-rail');
    rail.style.top = `${RAIL - HEADER}px`;
    body.append(rail);

    let boundary = 0;
    let monthCursor = 0;
    while (monthCursor < dates.length) {
      const key = dates[monthCursor].slice(0, 7);
      let end = monthCursor;
      while (end < dates.length && dates[end].slice(0, 7) === key) end++;
      const line = el('div', 'snd-month-line');
      line.style.left = `${boundary}px`;
      body.append(line);
      boundary += (end - monthCursor) * NODE_W;
      monthCursor = end;
    }

    for (let lane = 0; lane < lanes.length; lane += 1) {
      const band = el('div', 'snd-lane' + (lane % 2 ? ' alt' : ''));
      band.style.top = `${SPAN_TOP - HEADER + lane * LANE_H}px`;
      band.style.height = `${LANE_H}px`;
      body.append(band);
    }

    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      const list = (startDates.get(date) || []).sort((a, b) => a.first - b.first);
      const ends = (endDates.get(date) || []).length;
      const nodeX = index * NODE_W + NODE_W / 2;
      const slot = el('div', 'snd-slot');
      slot.style.left = `${index * NODE_W}px`;
      slot.style.width = `${NODE_W}px`;
      list.forEach((item, cardIndex) => {
        const top = RAIL - HEADER - 10 - (list.length - cardIndex) * CARD_H - (list.length - cardIndex - 1) * CARD_GAP;
        const card = el('a', 'snd-card');
        card.draggable = false;
        card.href = hrefOf(item);
        card.target = '_blank';
        card.rel = 'noreferrer';
        card.style.top = `${top}px`;
        card.style.left = `${NODE_W * 0.1}px`;
        card.style.width = `${CARD_W}px`;
        card.title = `#${numberOf.get(item)} ${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮`;
        card.append(el('span', 'snd-card-title', `#${numberOf.get(item)} ${item.title}`));
        card.append(el('span', 'snd-card-meta', `${fmtTime(item.first)} · ${item.turns} 轮 · 持续 ${spanDays(item.first, item.last)} 天`));
        slot.append(card);
      });
      const stem = el('div', 'snd-stem');
      stem.style.left = `${NODE_W / 2}px`;
      stem.style.top = `${Math.min(...list.map((item, cardIndex) => RAIL - HEADER - 10 - (list.length - cardIndex) * CARD_H - (list.length - cardIndex - 1) * CARD_GAP), RAIL - HEADER - 10)}px`;
      stem.style.height = `${RAIL - HEADER - 10 - parseFloat(stem.style.top) + 10}px`;
      slot.append(stem);
      const dot = el('span', 'snd-dot');
      dot.style.left = `${NODE_W / 2}px`;
      dot.style.top = `${RAIL - HEADER}px`;
      slot.append(dot);
      const label = el('div', 'snd-date');
      label.style.top = `${RAIL - HEADER + 6}px`;
      label.append(el('span', 'snd-date-text', fmtCardDay(list[0]?.first || new Date(date + 'T00:00:00').getTime() / 1000)));
      const counts = [];
      if (list.length) counts.push(`${list.length} 开始`);
      if (ends) counts.push(`${ends} 结束`);
      label.append(el('span', 'snd-date-count', counts.join(' · ')));
      slot.append(label);
      body.append(slot);
    }

    for (const lane of lanes) {
      for (const entry of lane) {
        const widthX = Math.max(6, entry.endX - entry.startX);
        const bar = el('a', 'snd-span');
        bar.draggable = false;
        bar.href = hrefOf(entry.item);
        bar.target = '_blank';
        bar.rel = 'noreferrer';
        bar.style.left = `${entry.startX}px`;
        bar.style.width = `${widthX}px`;
        const laneIndex = lanes.indexOf(lane);
        bar.style.top = `${SPAN_TOP - HEADER + laneIndex * LANE_H + 6}px`;
        bar.title = `#${numberOf.get(entry.item)} ${entry.item.title}\n${fmtRange(entry.item.first, entry.item.last)}\n泳道 ${laneIndex + 1}`;
        if (widthX >= 90) bar.append(el('span', 'snd-span-label', entry.item.title));
        else if (widthX >= 26) bar.append(el('span', 'snd-span-label', `#${numberOf.get(entry.item)}`));
        body.append(bar);
      }
    }

    strip.append(body);
    scroll.append(strip);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '保留日期节点和卡片堆叠，卡片/跨度条左右各留 10% 间隙（节点前/后各 40%）；跨度条在下方 3 条泳道里。'));
    const updateCurrent = () => {
      const left = scroll.scrollLeft;
      const right = Math.min(width, scroll.scrollLeft + scroll.clientWidth);
      const startDate = [...dates].reverse().find(date => dateIndex.get(date) * NODE_W <= left) || dates[0];
      const endDate = dates.find(date => dateIndex.get(date) * NODE_W + NODE_W >= right) || dates[dates.length - 1];
      const startMonth = startDate.slice(0, 7);
      const endMonth = endDate.slice(0, 7);
      current.textContent = startMonth === endMonth ? monthLabel(startMonth) : `${monthLabel(startMonth)} – ${monthLabel(endMonth)}`;
    };
    scroll.addEventListener('scroll', updateCurrent);
    requestAnimationFrame(updateCurrent);
    attachPan(scroll, latest);
  };

  const renderCardLanes = () => {
    const NODE_W = 155;
    const HEADER = 26;
    const AXIS_H = 36;
    const LANE_H = 52;
    const CARD_H = 40;

    const dates = [...new Set(itemsAsc.flatMap(item => [fmtDay(item.first), fmtDay(item.last)]))].sort();
    const dateIndex = new Map(dates.map((date, index) => [date, index]));
    const width = dates.length * NODE_W;
    const lanes = [[], [], []];
    const laneOf = new Map();
    for (const item of itemsAsc) {
      const startIndex = dateIndex.get(fmtDay(item.first));
      const endIndex = dateIndex.get(fmtDay(item.last));
      const left = startIndex * NODE_W + NODE_W * 0.1;
      const right = endIndex * NODE_W + NODE_W * 0.9;
      const cardWidth = right - left;
      let lane = lanes.findIndex(list => !list.length || list[list.length - 1] <= left);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push(right);
      laneOf.set(item, lane);
    }

    const wrap = el('div', 'crd-wrap');
    const toolbar = el('div', 'htl-toolbar');
    const current = el('span', 'hrl-current', monthLabel(dates[dates.length - 1].slice(0, 7)));
    const hint = el('span', 'htl-hint');
    hint.append(`卡片泳道 · ${dates.length} 个日期 · ${itemsAsc.length} 条会话 · ${lanes.length} 条泳道 · `, current, ' · 左右拖动平移');
    toolbar.append(hint);
    const latest = el('button', 'htl-latest', '回到最新');
    latest.type = 'button';
    toolbar.append(latest);

    const scroll = el('div', 'crd-scroll');
    const strip = el('div', 'crd-strip');
    strip.style.width = `${width}px`;
    strip.style.height = `${HEADER + AXIS_H + lanes.length * LANE_H + 8}px`;

    const months = el('div', 'crd-months');
    let monthStart = 0;
    while (monthStart < dates.length) {
      const key = dates[monthStart].slice(0, 7);
      let end = monthStart;
      while (end < dates.length && dates[end].slice(0, 7) === key) end++;
      const block = el('div', 'crd-month');
      block.style.width = `${(end - monthStart) * NODE_W}px`;
      block.append(el('span', 'crd-month-label', monthLabel(key)));
      months.append(block);
      monthStart = end;
    }
    strip.append(months);

    const axis = el('div', 'crd-axis');
    axis.style.top = `${HEADER}px`;
    axis.style.height = `${AXIS_H}px`;
    axis.append(el('div', 'crd-axis-line'));
    dates.forEach((date, index) => {
      const x = index * NODE_W + NODE_W / 2;
      const dot = el('span', 'crd-dot');
      dot.style.left = `${x}px`;
      axis.append(dot);
      const label = el('span', 'crd-date', fmtCardDay(new Date(date + 'T00:00:00').getTime() / 1000));
      label.style.left = `${x}px`;
      axis.append(label);
    });
    strip.append(axis);

    for (let lane = 0; lane < lanes.length; lane += 1) {
      const band = el('div', 'crd-lane' + (lane % 2 ? ' alt' : ''));
      band.style.top = `${HEADER + AXIS_H + lane * LANE_H}px`;
      band.style.height = `${LANE_H}px`;
      strip.append(band);
    }
    let boundary = 0;
    let monthCursor = 0;
    while (monthCursor < dates.length) {
      const key = dates[monthCursor].slice(0, 7);
      let end = monthCursor;
      while (end < dates.length && dates[end].slice(0, 7) === key) end++;
      const line = el('div', 'crd-month-line');
      line.style.left = `${boundary}px`;
      strip.append(line);
      boundary += (end - monthCursor) * NODE_W;
      monthCursor = end;
    }

    itemsAsc.forEach((item, index) => {
      const number = index + 1;
      const startIndex = dateIndex.get(fmtDay(item.first));
      const endIndex = dateIndex.get(fmtDay(item.last));
      const left = startIndex * NODE_W + NODE_W * 0.1;
      const cardWidth = (endIndex - startIndex + 0.8) * NODE_W;
      const laneIndex = laneOf.get(item);
      const card = el('a', 'crd-card');
      card.draggable = false;
      card.href = hrefOf(item);
      card.target = '_blank';
      card.rel = 'noreferrer';
      card.style.left = `${left}px`;
      card.style.width = `${cardWidth}px`;
      card.style.top = `${HEADER + AXIS_H + laneIndex * LANE_H + 6}px`;
      card.title = `#${number} ${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮 · 泳道 ${laneIndex + 1}`;
      card.append(el('span', 'crd-card-title', cardWidth >= 70 ? `#${number} ${item.title}` : `#${number}`));
      if (cardWidth >= 110) card.append(el('span', 'crd-card-meta', `${fmtCardRange(item.first, item.last)} · ${item.turns} 轮`));
      strip.append(card);
    });

    scroll.append(strip);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '保留日期节点；卡片按日期格拉伸，左右各留 10% 间隙（节点前/后各 40%）；3 条泳道互不交叉。'));
    const updateCurrent = () => {
      scroll.dataset.scrolled = scroll.scrollLeft > 4 ? 'true' : 'false';
      const left = scroll.scrollLeft;
      const right = Math.min(width, scroll.scrollLeft + scroll.clientWidth);
      const startDate = [...dates].reverse().find(date => dateIndex.get(date) * NODE_W <= left) || dates[0];
      const endDate = dates.find(date => dateIndex.get(date) * NODE_W + NODE_W >= right) || dates[dates.length - 1];
      const startMonth = startDate.slice(0, 7);
      const endMonth = endDate.slice(0, 7);
      current.textContent = startMonth === endMonth ? monthLabel(startMonth) : `${monthLabel(startMonth)} – ${monthLabel(endMonth)}`;
    };
    scroll.addEventListener('scroll', updateCurrent);
    requestAnimationFrame(updateCurrent);
    attachPan(scroll, latest);
  };

  const renderOverview = () => {
    const DAY_W = 7;
    const HEADER = 20;
    const LANE_H = 20;
    const BAR_H = 10;
    const PALETTE = [
      '#3b6ea5', '#b46a3c', '#5b8c5a', '#8a5a9e',
      '#b08a2e', '#4a8a8a', '#a34f5c', '#6b6f9e',
      '#7a8f3a', '#9a5f8a', '#4f7f9a', '#a07040',
    ];
    const firstDate = new Date(itemsAsc[0].first * 1000);
    const lastDate = new Date(itemsAsc[itemsAsc.length - 1].last * 1000);
    const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const endCursor = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);
    const months = [];
    let offset = 0;
    while (cursor < endCursor) {
      const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
      months.push({ key, label: `${Number(key.slice(5))} 月`, days, offset, width: days * DAY_W });
      offset += days * DAY_W;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const total = offset;
    const originDay = Math.floor(Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), 1) / 86400000);
    const xOf = seconds => (dayNumber(seconds) - originDay) * DAY_W;

    const lanes = [[], [], []];
    const laneOf = new Map();
    for (const item of itemsAsc) {
      const left = xOf(item.first);
      const right = xOf(item.last) + DAY_W;
      let lane = lanes.findIndex(list => !list.length || list[list.length - 1] <= left);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push(right);
      laneOf.set(item, lane);
    }

    const wrap = el('div', 'ovw-wrap');
    const toolbar = el('div', 'htl-toolbar');
    toolbar.append(el('span', 'htl-hint', `缩略图 · 日历时间轴 · ${itemsAsc.length} 条会话 · ${lanes.length} 条泳道 · 全档案`));
    const scroll = el('div', 'ovw-scroll');
    const chart = el('div', 'ovw-chart');
    chart.style.width = `${total}px`;
    chart.style.height = `${HEADER + lanes.length * LANE_H + 6}px`;
    const head = el('div', 'ovw-head');
    for (const month of months) {
      const block = el('div', 'ovw-month');
      block.style.width = `${month.width}px`;
      block.append(el('span', 'ovw-month-label', month.label));
      head.append(block);
    }
    const body = el('div', 'ovw-body');
    body.style.height = `${lanes.length * LANE_H}px`;
    for (let lane = 0; lane < lanes.length; lane += 1) {
      const band = el('div', 'ovw-lane' + (lane % 2 ? ' alt' : ''));
      band.style.top = `${lane * LANE_H}px`;
      band.style.height = `${LANE_H}px`;
      body.append(band);
    }
    for (const month of months) {
      const line = el('div', 'ovw-month-line');
      line.style.left = `${month.offset}px`;
      body.append(line);
    }
    itemsAsc.forEach((item, index) => {
      const left = xOf(item.first);
      const widthX = Math.max(2, xOf(item.last) + DAY_W - left - 1);
      const laneIndex = laneOf.get(item);
      const bar = el('a', 'ovw-bar');
      bar.draggable = false;
      bar.href = hrefOf(item);
      bar.target = '_blank';
      bar.rel = 'noreferrer';
      bar.style.left = `${left}px`;
      bar.style.width = `${widthX}px`;
      bar.style.top = `${laneIndex * LANE_H + (LANE_H - BAR_H) / 2}px`;
      bar.style.background = PALETTE[index % PALETTE.length];
      bar.title = `#${index + 1} ${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮 · 泳道 ${laneIndex + 1}`;
      body.append(bar);
    });
    chart.append(head, body);
    scroll.append(chart);
    wrap.append(toolbar, scroll);
    main.append(wrap, el('p', 'proto-note', '缩略图：按真实日历天数（7px/天），月份宽度=该月天数；颜色仅用于区分会话，空日期也占位，3 条泳道互不交叉。'));
  };

  if (variant === 'p6') renderOverview();
  else if (variant === 'p5') renderCardLanes();
  else if (variant === 'p5a') renderSpanRail();
  else if (variant === 'p3' || variant === 'p4') renderDateRail(variant === 'p4' ? 'progress' : 'base');
  else renderHorizontalRail();
})();
