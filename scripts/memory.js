(() => {
  const root = document.querySelector('[data-ceobe-memory]');
  if (!root) return;
  const tabs = root.querySelector('[data-memory-groups]');
  const content = root.querySelector('[data-memory-content]');
  const status = root.querySelector('[data-memory-status]');
  const empty = root.querySelector('[data-memory-empty]');
  let view = { groups: [], ungrouped: { count: 0, sessions: [] } };

  const setStatus = text => { if (status) status.textContent = text; };
  const groupFromUrl = () => new URLSearchParams(location.search).get('group');
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const selected = group => group === 'ungrouped'
    ? view.ungrouped
    : view.groups.find(item => item.group === group) || view.groups[0];

  function renderTabs(group) {
    tabs.replaceChildren();
    for (const item of view.groups) {
      const button = make('button', '', item.name);
      button.type = 'button';
      button.dataset.memoryGroup = item.group;
      button.setAttribute('aria-pressed', String(item.group === group));
      button.addEventListener('click', () => choose(item.group));
      tabs.append(button);
    }
    if (view.ungrouped?.count) {
      const button = make('button', '', `未分组 ${view.ungrouped.count}`);
      button.type = 'button';
      button.dataset.memoryGroup = 'ungrouped';
      button.setAttribute('aria-pressed', String(group === 'ungrouped'));
      button.addEventListener('click', () => choose('ungrouped'));
      tabs.append(button);
    }
  }

  function choose(group) {
    const next = new URL(location.href);
    next.searchParams.set('group', group);
    history.replaceState(null, '', next);
    render(group);
  }

  function renderDelta(delta) {
    if (!delta?.changes?.length) return null;
    const box = make('details', 'ceobe-memory-delta');
    box.append(make('summary', '', `相比上一版 ${delta.changes.length} 项变化`));
    const list = make('ul');
    for (const change of delta.changes) {
      const item = make('li');
      const label = change.path || change.field || '变更';
      item.append(make('strong', '', label));
      if (change.from || change.to) item.append(document.createTextNode(`：${change.from || '—'} → ${change.to || '—'}`));
      else if (change.note) item.append(document.createTextNode(`：${change.note}`));
      list.append(item);
    }
    box.append(list);
    return box;
  }

  function renderGroup(bank) {
    setStatus(`${bank.coverage?.sessions ?? '—'} 个会话 · ${bank.coverage?.rounds ?? '—'} 轮 · 截至 ${bank.as_of}`);
    const head = make('section', 'ceobe-memory-bank-head');
    const title = make('h2', '', bank.name || bank.group);
    const meta = make('p', '', `${bank.as_of} 快照${bank.snapshot ? ' · 不代表之后状态' : ''}`);
    head.append(title, meta);
    content.append(head);

    if (bank.mainlines?.length) {
      const mainlines = make('section', 'ceobe-memory-mainlines');
      mainlines.append(make('h3', '', `主线 ${bank.mainlines.length} 条`));
      const row = make('div', 'ceobe-memory-mainline-row');
      for (const line of bank.mainlines) {
        const chip = make('span', 'ceobe-memory-chip', line.label);
        chip.dataset.memoryMainline = line.id;
        chip.title = line.kind === 'cross_group' ? '跨组主线' : '组内主线';
        row.append(chip);
      }
      mainlines.append(row);
      if (bank.themes?.length) {
        mainlines.append(make('p', 'ceobe-memory-theme', `跨线主题：${bank.themes.map(theme => theme.label).join('、')}`));
      }
      content.append(mainlines);
    }

    const delta = renderDelta(bank.delta_from_previous);
    if (delta) content.append(delta);

    const grid = make('div', 'ceobe-memory-grid');
    for (const key of bank.block_order || ['who', 'doing', 'waiting', 'changes']) {
      const block = make('section', 'ceobe-memory-block');
      block.append(make('h3', '', bank.block_labels?.[key] || key));
      const list = make('ul');
      for (const entry of bank.blocks?.[key] || []) {
        const item = make('li');
        if (entry.key) item.append(make('strong', '', entry.key));
        item.append(document.createTextNode(entry.text || ''));
        list.append(item);
      }
      block.append(list);
      grid.append(block);
    }
    content.append(grid);
  }

  function renderUngrouped(data) {
    setStatus(`${data.count} 个会话 · 仅 L1/L2/L4`);
    const head = make('section', 'ceobe-memory-bank-head');
    head.append(make('h2', '', '未分组'), make('p', '', data.note || '这些会话没有 L3/L3.1'));
    content.append(head);
    const list = make('ul', 'ceobe-memory-ungrouped-list');
    for (const session of data.sessions || []) {
      const item = make('li');
      const title = make('h3', '', session.title || session.id);
      const meta = make('p', 'ceobe-memory-ungrouped-meta', `${session.rounds ?? '—'} 轮 · 仅 L1/L2/L4`);
      item.append(title, meta);
      if (session.summary) item.append(make('p', '', session.summary));
      if (session.tags?.length) item.append(make('p', 'ceobe-memory-tags', session.tags.join(' · ')));
      list.append(item);
    }
    content.append(list);
  }

  function render(group) {
    const current = selected(group);
    const actualGroup = current === view.ungrouped ? 'ungrouped' : current?.group;
    renderTabs(actualGroup);
    content.replaceChildren();
    empty.hidden = Boolean(current);
    if (!current) {
      setStatus('还没有可显示的项目记忆。');
      return;
    }
    if (actualGroup === 'ungrouped') renderUngrouped(current);
    else renderGroup(current);
  }

  fetch(new URL('memory-data.json', location.href), { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('本地记忆数据不可用');
      return response.json();
    })
    .then(data => {
      view = { groups: Array.isArray(data?.groups) ? data.groups : [], ungrouped: data?.ungrouped || { count: 0, sessions: [] } };
      render(groupFromUrl());
    })
    .catch(error => {
      empty.hidden = false;
      setStatus('无法读取项目记忆。');
      empty.textContent = error.message;
    });
})();
