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
    p2: 'P2 真实比例：横轴是时间，条长 = 首末跨度，能看出覆盖与重叠；但三个月压缩到 560px 后，短会话只有几像素。',
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

  const monthColor = seconds => {
    const palette = ['#344054', '#475467', '#667085', '#7f8c9a'];
    return palette[(parts(seconds).month - 1) % palette.length];
  };

  const renderGantt = () => {
    const min = Math.min(...items.map(item => item.first));
    const max = Math.max(...items.map(item => item.last));
    const range = Math.max(1, max - min);
    const wrap = el('div', 'proto-gantt');
    const axis = el('div', 'proto-gantt-axis');
    const cursor = new Date(min * 1000);
    cursor.setDate(1);
    const startMonth = new Date(min * 1000);
    const months = [];
    while (cursor.getTime() / 1000 <= max) {
      const sameMonth = cursor.getFullYear() === startMonth.getFullYear() && cursor.getMonth() === startMonth.getMonth();
      if (cursor.getTime() / 1000 >= min || sameMonth) months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const date of months) {
      const left = Math.max(0, ((date.getTime() / 1000 - min) / range) * 100);
      const tick = el('span', 'proto-month-tick', `${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
      tick.style.left = left.toFixed(2) + '%';
      axis.append(tick);
    }
    const rows = el('div', 'proto-gantt-rows');
    for (const date of months) {
      const line = el('div', 'proto-grid-line');
      line.style.left = Math.max(0, (((date.getTime() / 1000 - min) / range) * 100)).toFixed(2) + '%';
      rows.append(line);
    }
    for (const item of items) {
      const row = el('div', 'proto-gantt-row');
      row.append(el('div', 'proto-gantt-label', item.title));
      const bar = el('a', 'proto-gantt-bar');
      bar.href = hrefOf(item);
      bar.target = '_blank';
      bar.rel = 'noreferrer';
      bar.style.left = (((item.first - min) / range) * 100).toFixed(2) + '%';
      bar.style.width = Math.max(0.4, ((item.last - item.first) / range) * 100).toFixed(2) + '%';
      bar.style.background = monthColor(item.first);
      bar.title = `${item.title}\n${fmtRange(item.first, item.last)}\n${item.turns} 轮`;
      row.append(bar);
      rows.append(row);
    }
    wrap.append(axis, rows);
    main.append(wrap, el('p', 'proto-note', `横轴 ${fmtDay(min)} → ${fmtDay(max)}（真实比例）；每行一条会话，条长 = 首末跨度，最短 3px。`));
  };

  if (variant === 'p2') renderGantt();
  else renderRail();
})();
