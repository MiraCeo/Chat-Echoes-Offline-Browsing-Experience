(() => {
  const groups = document.querySelector('[data-ceobe-timeline-groups]');
  const status = document.querySelector('[data-ceobe-timeline-status]');
  const empty = document.querySelector('[data-ceobe-timeline-empty]');
  const orderButtons = [...document.querySelectorAll('[data-ceobe-timeline-order]')];
  const layoutButtons = [...document.querySelectorAll('[data-ceobe-timeline-layout]')];
  if (!groups || !status) return;

  const root = new URL('./', location.href);
  const ORDER_KEY = 'ceobe.timeline.order';
  const LAYOUT_KEY = 'ceobe.timeline.layout';
  let order = 'newest';
  let layout = 'list';
  try {
    if (localStorage.getItem(ORDER_KEY) === 'oldest') order = 'oldest';
    if (localStorage.getItem(LAYOUT_KEY) === 'cards') layout = 'cards';
  } catch { /* 隐私模式下没有 localStorage */ }
  let index = null;
  let titles = new Map();
  let summaries = new Map();
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
      hours: Number(values.hour),
      minutes: Number(values.minute),
    };
  };
  const monthKey = seconds => { const p = parts(seconds); return `${p.year}-${pad(p.month)}`; };
  const monthLabel = key => { const [year, month] = key.split('-'); return `${year} 年 ${Number(month)} 月`; };
  const dayLabel = p => `${p.month}月${p.day}日`;
  const clockLabel = p => `${pad(p.hours)}:${pad(p.minutes)}`;
  const sameDay = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
  const rangeLabel = (first, last) => {
    if (!Number.isFinite(first)) return '时间未知';
    const a = parts(first);
    if (!Number.isFinite(last) || last === first) return `${dayLabel(a)} ${clockLabel(a)}`;
    const b = parts(last);
    if (sameDay(a, b)) return `${dayLabel(a)} ${clockLabel(a)}–${clockLabel(b)}`;
    if (a.year === b.year) return `${dayLabel(a)} ${clockLabel(a)} → ${dayLabel(b)} ${clockLabel(b)}`;
    return `${a.year}年${dayLabel(a)} ${clockLabel(a)} → ${b.year}年${dayLabel(b)} ${clockLabel(b)}`;
  };
  const count = value => Number(value).toLocaleString('zh-CN');
  const titleOf = item => titles.get(item.id) || '会话 ' + String(item.id).slice(0, 8);
  const roundsOf = item => Number.isFinite(item.rounds)
    ? item.rounds
    : Math.ceil((Number.isFinite(item.turns) ? item.turns : 0) / 2);
  const compactChars = value => {
    if (!Number.isFinite(value)) return '—';
    if (value < 1000) return String(value);
    return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  };
  const normalizeSummaries = payload => {
    if (!payload || payload.kind !== 'ceobe.timeline-summaries'
      || !payload.conversations || typeof payload.conversations !== 'object') return new Map();
    return new Map(Object.entries(payload.conversations));
  };
  const aiOf = item => {
    const entry = summaries.get(item.id);
    if (!entry || entry.status !== 'fresh') return { summary: '', tags: [] };
    if (entry.source?.last_message_id
      && item.last_message_id
      && entry.source.last_message_id !== item.last_message_id) return { summary: '', tags: [] };
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    const tags = Array.isArray(entry.tags)
      ? [...new Set(entry.tags.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 4)
      : [];
    return { summary, tags };
  };
  const spanOf = (first, last) => {
    const a = parts(first);
    const b = parts(last);
    return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000) + 1;
  };
  const dayKeyAt = (first, offset) => {
    const p = parts(first);
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };

  const syncOrderButtons = () => {
    for (const button of orderButtons) {
      const active = (button.dataset.ceobeTimelineOrder || 'newest') === order;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  const syncLayoutButtons = () => {
    for (const button of layoutButtons) {
      const active = (button.dataset.ceobeTimelineLayout || 'list') === layout;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  const setLayout = next => {
    layout = next === 'cards' ? 'cards' : 'list';
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* ignore */ }
    syncLayoutButtons();
    if (index) draw();
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
      turns.textContent = Number.isFinite(item.turns) ? `${roundsOf(item)} 轮对话` : '';
      meta.append(when, document.createTextNode(' · '), turns);
      link.append(title, meta);

      const accessible = [titleOf(item), when.textContent, turns.textContent].filter(Boolean).join('，');
      link.setAttribute('aria-label', accessible);
      row.append(link);
      list.append(row);
    }
    return list;
  };

  const buildCards = (items, { undated = false } = {}) => {
    const list = document.createElement('ol');
    list.className = 'ceobe-timeline-cards';
    for (const item of items) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'ceobe-timeline-card';
      const href = 'conversations/' + encodeURIComponent(item.id) + '.html'
        + (item.first_message_id ? '#bookmark=' + encodeURIComponent(item.first_message_id) : '');
      link.href = new URL(href, root).href;

      const head = document.createElement('span');
      head.className = 'ceobe-timeline-card-head';
      const identity = document.createElement('span');
      identity.className = 'ceobe-timeline-card-identity';
      const titleLine = document.createElement('span');
      titleLine.className = 'ceobe-timeline-card-title-line';
      const title = document.createElement('span');
      title.className = 'ceobe-timeline-card-title';
      title.textContent = titleOf(item);
      titleLine.append(title);
      if (Number.isFinite(item.rounds) || Number.isFinite(item.turns)) {
        const rounds = document.createElement('span');
        rounds.className = 'ceobe-timeline-card-rounds';
        rounds.textContent = `${roundsOf(item)} 轮`;
        titleLine.append(rounds);
      }
      const when = undated ? '时间未知' : rangeLabel(item.first, item.last);
      const time = document.createElement('span');
      time.className = 'ceobe-timeline-card-time';
      time.textContent = when;
      identity.append(titleLine, time);
      head.append(identity);

      const ai = aiOf(item);
      if (ai.tags.length) {
        const tags = document.createElement('span');
        tags.className = 'ceobe-timeline-card-tags';
        tags.dataset.aiTags = '';
        for (const text of ai.tags) {
          const tag = document.createElement('span');
          tag.className = 'ceobe-timeline-card-tag';
          tag.textContent = text;
          tag.title = text;
          tags.append(tag);
        }
        head.append(tags);
      }
      link.append(head);

      if (ai.summary) {
        const summary = document.createElement('span');
        summary.className = 'ceobe-timeline-card-summary';
        summary.dataset.aiSummary = '';
        summary.textContent = ai.summary;
        link.append(summary);
      }

      let span = 0;
      let active = 0;
      if (!undated) {
        span = spanOf(item.first, item.last);
        for (let offset = 0; offset < span; offset += 1) {
          if ((item.days || {})[dayKeyAt(item.first, offset)]) active += 1;
        }
      }
      const models = Array.isArray(item.models) ? item.models.filter(Boolean) : [];
      const primaryModel = item.primary_model || models[0] || '';
      const modelText = primaryModel
        ? primaryModel + (models.length > 1 ? `（共${models.length}个）` : '')
        : '—';
      const modelTitle = models.length ? `模型：${models.join('、')}` : '模型：未知';
      const userChars = Number.isFinite(item.user_chars) ? item.user_chars : null;
      const assistantChars = Number.isFinite(item.assistant_chars) ? item.assistant_chars : null;
      const charsTitle = userChars == null || assistantChars == null
        ? '字符：未知'
        : `字符（不含空白）：用户 ${userChars.toLocaleString('zh-CN')} · 助手 ${assistantChars.toLocaleString('zh-CN')}`;
      const activeText = undated ? '—' : `${active}/${span} 天`;

      const stats = document.createElement('span');
      stats.className = 'ceobe-timeline-card-stats';
      const modelStat = document.createElement('span');
      modelStat.className = 'ceobe-timeline-card-stat ceobe-timeline-card-stat-model';
      const modelLabel = document.createElement('span');
      modelLabel.className = 'ceobe-timeline-card-stat-label';
      modelLabel.textContent = '模型';
      const modelValue = document.createElement('span');
      modelValue.className = 'ceobe-timeline-card-stat-value';
      modelValue.textContent = modelText;
      modelValue.title = modelTitle;
      modelStat.append(modelLabel, modelValue);

      const charStat = document.createElement('span');
      charStat.className = 'ceobe-timeline-card-stat ceobe-timeline-card-stat-chars';
      const charLabel = document.createElement('span');
      charLabel.className = 'ceobe-timeline-card-stat-label';
      charLabel.textContent = '字符';
      const charValues = document.createElement('span');
      charValues.className = 'ceobe-timeline-card-char-values';
      for (const [kind, value] of [['用户', userChars], ['助手', assistantChars]]) {
        const pair = document.createElement('span');
        pair.className = 'ceobe-timeline-card-char-pair';
        const pairLabel = document.createElement('span');
        pairLabel.className = 'ceobe-timeline-card-char-kind';
        pairLabel.textContent = kind;
        const pairValue = document.createElement('span');
        pairValue.className = 'ceobe-timeline-card-char-value';
        pairValue.textContent = compactChars(value);
        pair.append(pairLabel, pairValue);
        charValues.append(pair);
      }
      charStat.title = charsTitle;
      charStat.append(charLabel, charValues);

      const activeStat = document.createElement('span');
      activeStat.className = 'ceobe-timeline-card-stat ceobe-timeline-card-stat-active';
      const activeLabel = document.createElement('span');
      activeLabel.className = 'ceobe-timeline-card-stat-label';
      activeLabel.textContent = '活跃';
      const activeValue = document.createElement('span');
      activeValue.className = 'ceobe-timeline-card-stat-value';
      activeValue.textContent = activeText;
      activeStat.append(activeLabel, activeValue);

      stats.append(modelStat, charStat, activeStat);
      link.append(stats);

      const accessible = [
        titleOf(item),
        when,
        `${roundsOf(item)} 轮对话`,
        modelTitle,
        charsTitle,
        `活跃 ${activeText}`,
        ai.summary ? `AI 摘要：${ai.summary}` : '',
        ai.tags.length ? `AI 标签：${ai.tags.join('、')}` : '',
      ].filter(Boolean).join('，');
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
    const totalRounds = index.conversations.reduce((sum, item) => sum + roundsOf(item), 0);
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
      const turns = items.reduce((sum, item) => sum + roundsOf(item), 0);
      const section = document.createElement('section');
      section.className = 'ceobe-timeline-month' + (layout === 'cards' ? ' ceobe-timeline-month-cards' : '');
      const head = document.createElement('div');
      head.className = 'ceobe-timeline-month-head';
      const heading = document.createElement('h2');
      heading.textContent = monthLabel(key);
      const tally = document.createElement('span');
      tally.className = 'ceobe-timeline-month-count';
      tally.textContent = `${count(items.length)} 个会话 · ${count(turns)} 轮对话`;
      head.append(heading, tally);
      section.append(head, layout === 'cards' ? buildCards(items) : buildList(items));
      groups.append(section);
    }
    if (undated.length) {
      const section = document.createElement('section');
      section.className = 'ceobe-timeline-month' + (layout === 'cards' ? ' ceobe-timeline-month-cards' : '');
      const head = document.createElement('div');
      head.className = 'ceobe-timeline-month-head';
      const heading = document.createElement('h2');
      heading.textContent = '时间未知';
      const tally = document.createElement('span');
      tally.className = 'ceobe-timeline-month-count';
      tally.textContent = `${count(undated.length)} 个会话`;
      head.append(heading, tally);
      section.append(head, layout === 'cards' ? buildCards(undated, { undated: true }) : buildList(undated, { undated: true }));
      groups.append(section);
    }
    if (empty) empty.hidden = index.conversations.length > 0;
    status.textContent = index.conversations.length
      ? `${count(index.conversations.length)} 个会话 · ${count(totalRounds)} 轮对话 · 本地时间`
      : '暂无会话';
  };

  for (const button of orderButtons) {
    button.addEventListener('click', () => setOrder(button.dataset.ceobeTimelineOrder));
  }
  syncOrderButtons();
  for (const button of layoutButtons) {
    button.addEventListener('click', () => setLayout(button.dataset.ceobeTimelineLayout));
  }
  syncLayoutButtons();

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
    fetch(new URL('timeline-summaries.json', root), { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null),
  ]).then(([payload, catalog, summaryPayload]) => {
    if (!payload || payload.kind !== 'ceobe.timeline-index' || !Array.isArray(payload.conversations)) {
      fail('时间线索引不可用：请运行 npm run library 重建阅读页。');
      return;
    }
    index = payload;
    timezone = normalizeTimezone(payload.timezone);
    titles = new Map((catalog?.chats || []).map(chat => [chat.id, chat.title]));
    summaries = normalizeSummaries(summaryPayload);
    draw();
  }).catch(error => fail('时间线索引不可用：' + (error?.message || error) + '。请运行 npm run library 重建阅读页。'));
})();
