(() => {
  const root = document.querySelector('[data-ceobe-memory]');
  if (!root) return;
  const tabs = root.querySelector('[data-memory-groups]');
  const content = root.querySelector('[data-memory-content]');
  const status = root.querySelector('[data-memory-status]');
  const empty = root.querySelector('[data-memory-empty]');
  let view = { groups: [], global: null, ungrouped: { count: 0, sessions: [] } };

  const setStatus = text => { if (status) status.textContent = text; };
  const groupFromUrl = () => new URLSearchParams(location.search).get('group');
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const selected = group => group === 'global'
    ? view.global
    : view.groups.find(item => item.group === group) || view.groups[0];

  function choose(group) {
    const next = new URL(location.href);
    next.searchParams.set('group', group);
    history.replaceState(null, '', next);
    render(group);
  }

  function renderTabs(group) {
    tabs.replaceChildren();
    const global = make('button', '', '全局');
    global.type = 'button';
    global.dataset.memoryGroup = 'global';
    global.setAttribute('aria-pressed', String(group === 'global'));
    global.addEventListener('click', () => choose('global'));
    tabs.append(global);
    for (const item of view.groups) {
      const button = make('button', '', item.name);
      button.type = 'button';
      button.dataset.memoryGroup = item.group;
      button.setAttribute('aria-pressed', String(item.group === group));
      button.addEventListener('click', () => choose(item.group));
      tabs.append(button);
    }
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

  function renderChips(container, items, kind = 'mainline') {
    const row = make('div', 'ceobe-memory-mainline-row');
    for (const item of items) {
      const chip = make('span', 'ceobe-memory-chip', item.label || item.name || item.id);
      chip.dataset[kind === 'project' ? 'memoryProject' : 'memoryMainline'] = item.id;
      if (item.kind) chip.title = item.kind === 'cross_group' ? '跨组主线' : item.kind;
      row.append(chip);
    }
    container.append(row);
  }

  function renderFlags(bank) {
    const flags = [...(bank.flags || []), ...(bank.coverage_gaps || [])];
    if (!flags.length) return null;
    const details = make('details', 'ceobe-memory-flags');
    details.append(make('summary', '', '覆盖与证据说明'));
    const list = make('ul');
    for (const flag of flags) {
      const text = flag.text || flag.note || flag.reason || flag.caveat;
      if (text) list.append(make('li', '', text));
    }
    if (!list.children.length) return null;
    details.append(list);
    return details;
  }

  function renderGroup(bank) {
    setStatus(`${bank.coverage?.sessions ?? '—'} 个会话 · ${bank.coverage?.rounds ?? '—'} 轮 · 截至 ${bank.as_of}`);
    const head = make('section', 'ceobe-memory-bank-head');
    head.append(make('h2', '', bank.name || bank.group), make('p', '', `${bank.as_of} 快照${bank.snapshot ? ' · 不代表之后状态' : ''}`));
    content.append(head);

    if (bank.mainlines?.length) {
      const mainlines = make('section', 'ceobe-memory-mainlines');
      mainlines.append(make('h3', '', `主线 ${bank.mainlines.length} 条`));
      renderChips(mainlines, bank.mainlines);
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
    const flags = renderFlags(bank);
    if (flags) content.append(flags);
  }

  function renderGlobal(global) {
    setStatus(`${global.coverage?.sessions ?? '—'} 个会话 · ${global.coverage?.rounds ?? '—'} 轮 · 截至 ${global.as_of}`);
    const head = make('section', 'ceobe-memory-bank-head');
    head.append(make('h2', '', '全局记忆'), make('p', '', `${global.as_of} 快照 · 四组并集`));
    content.append(head);

    const stats = make('div', 'ceobe-memory-global-stats');
    for (const [label, value] of [
      ['主线', global.mainlines?.length ?? 0],
      ['thread', global.threads?.length ?? 0],
      ['项目', global.projects?.length ?? 0],
      ['冲突', global.conflicts?.length ?? 0],
      ['L5 节点', global.tree?.nodes ?? 0],
      ['L5 边', global.tree?.edges ?? 0],
    ]) {
      const item = make('div', 'ceobe-memory-stat');
      item.append(make('strong', '', String(value)), make('span', '', label));
      stats.append(item);
    }
    content.append(stats);

    if (global.mainlines?.length) {
      const mainlines = make('section', 'ceobe-memory-mainlines');
      mainlines.append(make('h3', '', `全局主线 ${global.mainlines.length} 条`));
      renderChips(mainlines, global.mainlines);
      content.append(mainlines);
    }

    if (global.thread_docs?.length) {
      const docs = make('section', 'ceobe-memory-global-section');
      docs.append(make('h3', '', `Markdown 分册 ${global.thread_docs.length} 份`));
      const list = make('ul', 'ceobe-memory-doc-list');
      for (const doc of global.thread_docs) list.append(make('li', '', doc.name));
      docs.append(list);
      content.append(docs);
    }

    if (global.projects?.length) {
      const projects = make('section', 'ceobe-memory-global-section');
      projects.append(make('h3', '', `项目 ${global.projects.length} 个`));
      renderChips(projects, global.projects, 'project');
      content.append(projects);
    }

    if (global.conflicts?.length) {
      const conflicts = make('details', 'ceobe-memory-flags');
      conflicts.append(make('summary', '', `冲突 ${global.conflicts.length} 条`));
      const list = make('ul');
      for (const conflict of global.conflicts) list.append(make('li', '', `${conflict.topic || conflict.id}${conflict.status ? ` · ${conflict.status}` : ''}`));
      conflicts.append(list);
      content.append(conflicts);
    }

    content.append(make('p', 'ceobe-memory-global-note', 'L2 单会话详情、L4 事件树与 L5 树视图将在此数据层之上接入。'));
  }

  function render(group) {
    const current = selected(group);
    const actualGroup = current === view.global ? 'global' : current?.group;
    renderTabs(actualGroup);
    content.replaceChildren();
    empty.hidden = Boolean(current);
    if (!current) {
      setStatus('还没有可显示的记忆。');
      return;
    }
    if (actualGroup === 'global') renderGlobal(current);
    else renderGroup(current);
  }

  fetch(new URL('memory-data.json', location.href), { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('本地记忆数据不可用');
      return response.json();
    })
    .then(data => {
      view = {
        groups: Array.isArray(data?.groups) ? data.groups : [],
        global: data?.global || null,
        ungrouped: data?.ungrouped || { count: 0, sessions: [] },
      };
      render(groupFromUrl());
    })
    .catch(error => {
      empty.hidden = false;
      setStatus('无法读取项目记忆。');
      empty.textContent = error.message;
    });
})();
