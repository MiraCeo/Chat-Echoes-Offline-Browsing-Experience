(() => {
  const groups = document.querySelector('[data-ceobe-timeline-groups]');
  const status = document.querySelector('[data-ceobe-timeline-status]');
  const empty = document.querySelector('[data-ceobe-timeline-empty]');
  if (!groups || !status) return;

  const root = new URL('./', location.href);
  const pad = value => String(value).padStart(2, '0');
  const monthKey = seconds => { const d = new Date(seconds * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthLabel = key => { const [year, month] = key.split('-'); return `${year} 年 ${Number(month)} 月`; };
  const timeLabel = seconds => { const d = new Date(seconds * 1000); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const rangeLabel = (first, last) => {
    if (!Number.isFinite(first)) return '时间未知';
    if (!Number.isFinite(last) || last === first) return timeLabel(first);
    const a = new Date(first * 1000), b = new Date(last * 1000);
    if (a.toDateString() === b.toDateString()) return `${timeLabel(first)}–${pad(b.getHours())}:${pad(b.getMinutes())}`;
    return `${timeLabel(first)} → ${timeLabel(last)}`;
  };

  const fail = text => {
    status.textContent = text;
    groups.replaceChildren();
    if (empty) empty.hidden = true;
  };

  Promise.all([
    fetch(new URL('timeline-index.json', root), { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }),
    fetch(new URL('chats.json', root), { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null),
  ]).then(([index, catalog]) => {
    if (!index || index.kind !== 'ceobe.timeline-index' || !Array.isArray(index.conversations)) {
      fail('时间线索引不可用：请运行 npm run library 重建阅读页。');
      return;
    }
    const titles = new Map((catalog?.chats || []).map(chat => [chat.id, chat.title]));
    const titleOf = item => titles.get(item.id) || '会话 ' + String(item.id).slice(0, 8);
    const dated = index.conversations.filter(item => Number.isFinite(item.first));
    const undated = index.conversations.filter(item => !Number.isFinite(item.first));

    const byMonth = new Map();
    for (const item of dated) {
      const key = monthKey(item.first);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(item);
    }
    const months = [...byMonth.keys()].sort().reverse();
    groups.replaceChildren();
    for (const key of months) {
      const items = byMonth.get(key).sort((a, b) => b.first - a.first);
      const section = document.createElement('section');
      section.className = 'ceobe-timeline-month';
      const heading = document.createElement('h2');
      heading.textContent = monthLabel(key);
      const list = document.createElement('ol');
      list.className = 'ceobe-timeline-list';
      for (const item of items) {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'ceobe-timeline-row';
        const href = 'conversations/' + encodeURIComponent(item.id) + '.html'
          + (item.first_message_id ? '#bookmark=' + encodeURIComponent(item.first_message_id) : '');
        link.href = new URL(href, root).href;
        link.setAttribute('aria-label', `${titleOf(item)}，${rangeLabel(item.first, item.last)}`);
        const when = document.createElement('span');
        when.className = 'ceobe-timeline-when';
        when.textContent = rangeLabel(item.first, item.last);
        const title = document.createElement('span');
        title.className = 'ceobe-timeline-title';
        title.textContent = titleOf(item);
        const meta = document.createElement('span');
        meta.className = 'ceobe-timeline-meta';
        meta.textContent = Number.isFinite(item.turns) ? `${item.turns} 轮` : '';
        link.append(when, title, meta);
        row.append(link);
        list.append(row);
      }
      section.append(heading, list);
      groups.append(section);
    }
    if (undated.length) {
      const section = document.createElement('section');
      section.className = 'ceobe-timeline-month';
      const heading = document.createElement('h2');
      heading.textContent = '时间未知';
      const list = document.createElement('ol');
      list.className = 'ceobe-timeline-list';
      for (const item of undated) {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'ceobe-timeline-row';
        link.href = new URL('conversations/' + encodeURIComponent(item.id) + '.html', root).href;
        const when = document.createElement('span');
        when.className = 'ceobe-timeline-when';
        when.textContent = '时间未知';
        const title = document.createElement('span');
        title.className = 'ceobe-timeline-title';
        title.textContent = titleOf(item);
        const meta = document.createElement('span');
        meta.className = 'ceobe-timeline-meta';
        meta.textContent = Number.isFinite(item.turns) ? `${item.turns} 轮` : '';
        link.append(when, title, meta);
        row.append(link);
        list.append(row);
      }
      section.append(heading, list);
      groups.append(section);
    }
    if (empty) empty.hidden = index.conversations.length > 0;
    status.textContent = index.conversations.length
      ? `${index.conversations.length} 个会话 · ${months.length} 个月`
      : '暂无会话';
  }).catch(error => fail('时间线索引不可用：' + (error?.message || error) + '。请运行 npm run library 重建阅读页。'));
})();
