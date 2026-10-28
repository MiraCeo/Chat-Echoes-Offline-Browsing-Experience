(() => {
  const overviewHost = document.querySelector('[data-ceobe-axis-overview]');
  const detailHost = document.querySelector('[data-ceobe-axis-detail]');
  if (!overviewHost || !detailHost) return;

  const root = new URL('./', location.href);
  const PALETTE = [
    '#3b6ea5', '#b46a3c', '#5b8c5a', '#8a5a9e',
    '#b08a2e', '#4a8a8a', '#a34f5c', '#6b6f9e',
    '#7a8f3a', '#9a5f8a', '#4f7f9a', '#a07040',
  ];
  const DAY_OVERVIEW = 7;
  const DAY_DETAIL = 96;
  const LANES = 3;
  const OVERVIEW_HEADER = 20;
  const OVERVIEW_LANE = 20;
  const OVERVIEW_BAR = 10;
  const DETAIL_HEADER = 26;
  const DETAIL_AXIS = 36;
  const DETAIL_LANE = 52;
  const DETAIL_CARD = 40;

  let built = false;
  let loading = false;
  let refs = null;
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let timezone = browserTimezone;
  let zoneFormatter = null;
  let zoneFormatterKey = '';
  const pad = value => String(value).padStart(2, '0');
  const normalizeTimezone = value => {
    if (!value || value === 'local') return browserTimezone;
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: value });
      return value;
    } catch {
      return browserTimezone;
    }
  };
  const parts = seconds => {
    if (zoneFormatterKey !== timezone) {
      zoneFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      zoneFormatterKey = timezone;
    }
    const values = {};
    for (const part of zoneFormatter.formatToParts(new Date(seconds * 1000))) {
      if (part.type !== 'literal') values[part.type] = part.value;
    }
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hours: values.hour,
      minutes: values.minute,
    };
  };
  const dayNumber = seconds => {
    const p = parts(seconds);
    return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
  };
  const fmtDay = seconds => { const p = parts(seconds); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
  const fmtShortDay = seconds => { const p = parts(seconds); return `${p.month}/${p.day}`; };
  const fmtCardDay = seconds => { const p = parts(seconds); return `${p.month}月${p.day}日`; };
  const fmtRange = (first, last) => `${fmtDay(first)} → ${fmtDay(last)}`;
  const monthLabel = key => { const [year, month] = key.split('-'); return `${year} 年 ${Number(month)} 月`; };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const linkTo = item => new URL('conversations/' + encodeURIComponent(item.id) + '.html'
    + (item.first_message_id ? '#bookmark=' + encodeURIComponent(item.first_message_id) : ''), root).href;
  const roundsOf = item => Number.isFinite(item.rounds)
    ? item.rounds
    : Math.ceil((Number.isFinite(item.turns) ? item.turns : 0) / 2);

  const status = text => {
    let node = overviewHost.querySelector('[data-ceobe-axis-status]');
    if (!node) {
      node = el('div', 'ceobe-axis-status');
      overviewHost.append(node);
    }
    node.textContent = text;
  };

  const build = (index, titles) => {
    const items = index.conversations
      .filter(item => Number.isFinite(item.first) && Number.isFinite(item.last))
      .sort((a, b) => a.first - b.first);
    if (!items.length) {
      status('本地档案里还没有会话。');
      return;
    }
    const totalRounds = items.reduce((sum, item) => sum + roundsOf(item), 0);
    const firstParts = parts(items[0].first);
    const lastParts = parts(items[items.length - 1].last);
    const months = [];
    const dates = [];
    let offset = 0;
    let year = firstParts.year;
    let month = firstParts.month;
    while (year < lastParts.year || (year === lastParts.year && month <= lastParts.month)) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const key = `${year}-${pad(month)}`;
      months.push({ key, label: `${month} 月`, days, offset });
      for (let day = 1; day <= days; day += 1) dates.push(`${key}-${pad(day)}`);
      offset += days;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    const totalDays = dates.length;
    const firstDayNumber = Math.floor(Date.UTC(firstParts.year, firstParts.month - 1, 1) / 86400000);
    const dayIndex = seconds => dayNumber(seconds) - firstDayNumber;
    const dayByIndex = index => dates[index] || '';

    // Three shared lanes. Max concurrency in the archive is 3, so no crossing.
    const lanes = [[], [], []];
    const laneOf = new Map();
    const overviewLanes = [[], [], []];
    const overviewLaneOf = new Map();
    const pack = (item, startIndex, endIndex, tables, laneMap) => {
      const left = startIndex * DAY_DETAIL + DAY_DETAIL * 0.1;
      const right = endIndex * DAY_DETAIL + DAY_DETAIL * 0.9;
      let lane = tables.findIndex(list => !list.length || list[list.length - 1] <= left);
      if (lane < 0) {
        lane = tables.length;
        tables.push([]);
      }
      tables[lane].push(right);
      laneMap.set(item, lane);
    };
    for (const item of items) {
      const startIndex = dayIndex(item.first);
      const endIndex = dayIndex(item.last);
      pack(item, startIndex, endIndex, lanes, laneOf);
      const oLeft = startIndex * DAY_OVERVIEW;
      const oRight = (endIndex + 1) * DAY_OVERVIEW;
      let lane = overviewLanes.findIndex(list => !list.length || list[list.length - 1] <= oLeft);
      if (lane < 0) {
        lane = overviewLanes.length;
        overviewLanes.push([]);
      }
      overviewLanes[lane].push(oRight);
      overviewLaneOf.set(item.id, lane);
    }

    const overview = el('div', 'ceobe-axis-overview');
    const overviewHead = el('div', 'ceobe-axis-overview-head');
    overviewHead.append(el('div', 'ceobe-axis-overview-title', '缩略导航'));
    const overviewStatus = el('div', 'ceobe-axis-status', '正在加载…');
    overviewStatus.dataset.ceobeAxisStatus = '';
    overviewHead.append(overviewStatus);
    const overviewHint = el('div', 'ceobe-axis-overview-hint', '拖动或点击缩略图定位下方详情');
    overview.append(overviewHead, overviewHint);
    const overviewScroll = el('div', 'ceobe-axis-overview-scroll');
    const overviewChart = el('div', 'ceobe-axis-overview-chart');
    const overviewWidth = totalDays * DAY_OVERVIEW;
    overviewChart.style.width = `${overviewWidth}px`;
    overviewChart.style.height = `${OVERVIEW_HEADER + overviewLanes.length * OVERVIEW_LANE}px`;
    const overviewMonths = el('div', 'ceobe-axis-overview-months');
    for (const month of months) {
      const block = el('div', 'ceobe-axis-overview-month');
      block.style.width = `${month.days * DAY_OVERVIEW}px`;
      block.append(el('span', 'ceobe-axis-overview-month-label', month.label));
      overviewMonths.append(block);
    }
    const overviewBody = el('div', 'ceobe-axis-overview-body');
    overviewBody.style.height = `${overviewLanes.length * OVERVIEW_LANE}px`;
    for (let lane = 0; lane < overviewLanes.length; lane += 1) {
      const band = el('div', 'ceobe-axis-overview-lane' + (lane % 2 ? ' alt' : ''));
      band.style.top = `${lane * OVERVIEW_LANE}px`;
      band.style.height = `${OVERVIEW_LANE}px`;
      overviewBody.append(band);
    }
    for (const month of months) {
      const line = el('div', 'ceobe-axis-overview-month-line');
      line.style.left = `${month.offset * DAY_OVERVIEW}px`;
      overviewBody.append(line);
    }
    items.forEach((item, index) => {
      const start = dayIndex(item.first);
      const end = dayIndex(item.last);
      const bar = el('span', 'ceobe-axis-overview-bar');
      bar.style.left = `${start * DAY_OVERVIEW}px`;
      bar.style.width = `${Math.max(2, (end - start + 1) * DAY_OVERVIEW - 1)}px`;
      bar.style.top = `${overviewLaneOf.get(item.id) * OVERVIEW_LANE + (OVERVIEW_LANE - OVERVIEW_BAR) / 2}px`;
      bar.style.background = PALETTE[index % PALETTE.length];
      bar.title = `#${index + 1} ${titles.get(item.id) || '会话 ' + item.id.slice(0, 8)}\n${fmtRange(item.first, item.last)}\n${roundsOf(item)} 轮对话 · ${item.turns} 个可见轮次`;
      overviewBody.append(bar);
    });
    const windowEl = el('div', 'ceobe-axis-window');
    windowEl.tabIndex = 0;
    windowEl.setAttribute('role', 'slider');
    windowEl.setAttribute('aria-label', '时间轴视口');
    windowEl.style.top = `${OVERVIEW_HEADER}px`;
    windowEl.style.height = `${overviewLanes.length * OVERVIEW_LANE}px`;
    overviewChart.append(overviewMonths, overviewBody, windowEl);
    overviewScroll.append(overviewChart);
    overview.append(overviewScroll);
    overviewHost.append(overview);

    const detail = el('div', 'ceobe-axis-detail');
    const detailBar = el('div', 'ceobe-axis-detail-bar');
    detailBar.append(el('div', 'ceobe-axis-detail-title', '详情'));
    const latestButton = el('button', 'ceobe-axis-latest', '回到最新');
    latestButton.type = 'button';
    detailBar.append(latestButton);
    const detailScroll = el('div', 'ceobe-axis-detail-scroll');
    const detailChart = el('div', 'ceobe-axis-detail-chart');
    const detailWidth = totalDays * DAY_DETAIL;
    detailChart.style.width = `${detailWidth}px`;
    detailChart.style.height = `${DETAIL_HEADER + DETAIL_AXIS + lanes.length * DETAIL_LANE + 8}px`;
    const detailMonths = el('div', 'ceobe-axis-detail-months');
    for (const month of months) {
      const block = el('div', 'ceobe-axis-detail-month');
      block.style.width = `${month.days * DAY_DETAIL}px`;
      block.append(el('span', 'ceobe-axis-detail-month-label', monthLabel(month.key)));
      detailMonths.append(block);
    }
    const axis = el('div', 'ceobe-axis-detail-axis');
    axis.style.top = `${DETAIL_HEADER}px`;
    axis.style.height = `${DETAIL_AXIS}px`;
    axis.append(el('div', 'ceobe-axis-detail-axis-line'));
    dates.forEach((date, index) => {
      const x = index * DAY_DETAIL + DAY_DETAIL / 2;
      const dot = el('span', 'ceobe-axis-detail-dot');
      dot.style.left = `${x}px`;
      axis.append(dot);
      const label = el('span', 'ceobe-axis-detail-date', dates[index].slice(5).replace('-', '/'));
      label.style.left = `${x}px`;
      axis.append(label);
    });
    const detailBody = el('div', 'ceobe-axis-detail-body');
    detailBody.style.top = `${DETAIL_HEADER + DETAIL_AXIS}px`;
    detailBody.style.height = `${lanes.length * DETAIL_LANE}px`;
    for (let lane = 0; lane < lanes.length; lane += 1) {
      const band = el('div', 'ceobe-axis-detail-lane' + (lane % 2 ? ' alt' : ''));
      band.style.top = `${lane * DETAIL_LANE}px`;
      band.style.height = `${DETAIL_LANE}px`;
      detailBody.append(band);
    }
    for (const month of months) {
      const line = el('div', 'ceobe-axis-detail-month-line');
      line.style.left = `${month.offset * DAY_DETAIL}px`;
      detailBody.append(line);
    }
    items.forEach((item, index) => {
      const start = dayIndex(item.first);
      const end = dayIndex(item.last);
      const card = el('a', 'ceobe-axis-card');
      card.href = linkTo(item);
      card.title = `#${index + 1} ${titles.get(item.id) || '会话 ' + item.id.slice(0, 8)}\n${fmtRange(item.first, item.last)}\n${roundsOf(item)} 轮对话 · ${item.turns} 个可见轮次`;
      card.style.left = `${start * DAY_DETAIL + DAY_DETAIL * 0.1}px`;
      card.style.width = `${(end - start + 0.8) * DAY_DETAIL}px`;
      card.style.top = `${laneOf.get(item) * DETAIL_LANE + (DETAIL_LANE - DETAIL_CARD) / 2}px`;
      card.append(el('span', 'ceobe-axis-card-title', `#${index + 1} ${titles.get(item.id) || '会话 ' + item.id.slice(0, 8)}`));
      if ((end - start + 0.8) * DAY_DETAIL >= 110) {
        card.append(el('span', 'ceobe-axis-card-meta', `${fmtCardDay(item.first)} → ${fmtCardDay(item.last)} · ${roundsOf(item)} 轮对话`));
      }
      detailBody.append(card);
    });
    detailChart.append(detailMonths, axis, detailBody);
    detailScroll.append(detailChart);
    detail.append(detailBar, detailScroll);
    detailHost.append(detail);

    const maxScroll = () => Math.max(0, detailWidth - detailScroll.clientWidth);
    const clamp = value => Math.max(0, Math.min(maxScroll(), value));
    const updateWindow = () => {
      const left = detailScroll.scrollLeft;
      const width = detailScroll.clientWidth;
      const leftDay = left / DAY_DETAIL;
      const visibleDays = width / DAY_DETAIL;
      const winLeft = leftDay * DAY_OVERVIEW;
      const winWidth = Math.max(8, visibleDays * DAY_OVERVIEW);
      windowEl.style.left = `${Math.min(overviewWidth - winWidth, Math.max(0, winLeft))}px`;
      windowEl.style.width = `${winWidth}px`;
      windowEl.setAttribute('aria-valuemin', '0');
      windowEl.setAttribute('aria-valuemax', String(totalDays));
      windowEl.setAttribute('aria-valuenow', String(Math.round(leftDay)));
      windowEl.setAttribute('aria-valuetext', `${dayByIndex(Math.round(leftDay))} 起约 ${Math.max(1, Math.round(visibleDays))} 天`);
      detailScroll.dataset.scrolled = left > 4 ? 'true' : 'false';
      ensureOverviewWindowVisible(winLeft, winWidth);
    };
    const ensureOverviewWindowVisible = (winLeft, winWidth) => {
      const viewLeft = overviewScroll.scrollLeft;
      const viewRight = viewLeft + overviewScroll.clientWidth;
      if (winLeft < viewLeft || winLeft + winWidth > viewRight) {
        overviewScroll.scrollLeft = Math.max(0, winLeft - 24);
      }
    };
    const centerOnOverviewX = clientX => {
      const rect = overviewChart.getBoundingClientRect();
      const x = Math.max(0, Math.min(overviewWidth, clientX - rect.left));
      detailScroll.scrollLeft = clamp((x / DAY_OVERVIEW) * DAY_DETAIL - detailScroll.clientWidth / 2);
    };

    overviewChart.addEventListener('pointerdown', event => {
      if (event.target === windowEl) return;
      centerOnOverviewX(event.clientX);
    });
    let dragging = false;
    let dragStartX = 0;
    let dragStartLeft = 0;
    windowEl.addEventListener('pointerdown', event => {
      dragging = true;
      dragStartX = event.clientX;
      dragStartLeft = detailScroll.scrollLeft;
      windowEl.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    windowEl.addEventListener('pointermove', event => {
      if (!dragging) return;
      detailScroll.scrollLeft = clamp(dragStartLeft + (event.clientX - dragStartX) * DAY_DETAIL / DAY_OVERVIEW);
    });
    const endDrag = () => { dragging = false; };
    windowEl.addEventListener('pointerup', endDrag);
    windowEl.addEventListener('pointercancel', endDrag);
    windowEl.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); detailScroll.scrollLeft = clamp(detailScroll.scrollLeft - DAY_DETAIL); }
      if (event.key === 'ArrowRight') { event.preventDefault(); detailScroll.scrollLeft = clamp(detailScroll.scrollLeft + DAY_DETAIL); }
      if (event.key === 'Home') { event.preventDefault(); detailScroll.scrollLeft = 0; }
      if (event.key === 'End') { event.preventDefault(); detailScroll.scrollLeft = maxScroll(); }
    });
    latestButton.addEventListener('click', () => { detailScroll.scrollLeft = maxScroll(); });

    detailScroll.addEventListener('scroll', updateWindow, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWindow);
      observer.observe(detailScroll);
      observer.observe(overviewScroll);
    } else {
      window.addEventListener('resize', updateWindow);
    }
    detailScroll.scrollLeft = maxScroll();
    requestAnimationFrame(updateWindow);
    status(`${items.length} 个会话 · ${totalDays} 天 · ${totalRounds} 轮对话 · ${lanes.length} 条泳道 · 本地时间`);
  };

  const init = async () => {
    if (built || loading) return;
    loading = true;
    try {
      const [index, catalog] = await Promise.all([
        fetch(new URL('timeline-index.json', root), { cache: 'no-cache' }).then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        }),
        fetch(new URL('chats.json', root), { cache: 'no-store' })
          .then(response => (response.ok ? response.json() : null))
          .catch(() => null),
      ]);
      if (!index || index.kind !== 'ceobe.timeline-index' || !Array.isArray(index.conversations)) {
        status('时间轴索引不可用：请运行 npm run library 重建阅读页。');
        return;
      }
      built = true;
      timezone = normalizeTimezone(index.timezone);
      build(index, new Map((catalog?.chats || []).map(chat => [chat.id, chat.title])));
    } catch (error) {
      status('时间轴索引不可用：' + (error?.message || error) + '。请运行 npm run library 重建阅读页。');
    } finally {
      loading = false;
    }
  };

  document.addEventListener('ceobe:view', event => {
    if (event.detail?.view === 'axis') init();
  });
  if (document.querySelector('[data-ceobe-view="axis"]')?.getAttribute('aria-selected') === 'true') init();
})();
