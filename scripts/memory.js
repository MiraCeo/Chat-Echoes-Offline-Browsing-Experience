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
  const sessionFromUrl = () => new URLSearchParams(location.search).get('session');
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
    next.searchParams.delete('session');
    history.replaceState(null, '', next);
    render(group);
  }

  function chooseSession(session) {
    const next = new URL(location.href);
    next.searchParams.set('group', session.group);
    next.searchParams.set('session', session.id);
    history.replaceState(null, '', next);
    render(session.group, session.id);
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

  function groupName(id) {
    return view.groups.find(group => group.group === id)?.name || id;
  }

  function renderSessionIndex() {
    const section = make('section', 'ceobe-memory-global-section');
    section.append(make('h3', '', `会话语料 ${view.sessions.length} 个`));
    const grid = make('div', 'ceobe-memory-session-grid');
    for (const session of view.sessions) {
      const button = make('button', 'ceobe-memory-session');
      button.type = 'button';
      button.dataset.memorySession = session.id;
      button.append(
        make('strong', '', session.title),
        make('span', '', `${groupName(session.group)} · ${session.rounds} 轮${session.staging ? ' · staging' : ''}`),
      );
      button.addEventListener('click', () => chooseSession(session));
      grid.append(button);
    }
    section.append(grid);
    return section;
  }

  function renderSession(session) {
    setStatus(`${groupName(session.group)} · ${session.rounds} 轮${session.staging ? ' · inbox staging' : ''}`);
    const head = make('section', 'ceobe-memory-bank-head');
    head.append(make('h2', '', session.title));
    const meta = make('p', '', `${groupName(session.group)} · ${session.rounds} 轮${session.project_label ? ` · 项目 ${session.project_label}` : ''}`);
    head.append(meta);
    const back = make('button', 'ceobe-memory-back');
    back.type = 'button';
    back.textContent = `← 返回${groupName(session.group)}`;
    back.addEventListener('click', () => choose(session.group));
    head.append(back);
    content.append(head);

    const l1 = make('section', 'ceobe-memory-session-summary');
    l1.append(make('h3', '', 'L1 摘要'));
    l1.append(make('p', '', session.l1?.summary || '无摘要'));
    if (session.l1?.tags?.length) l1.append(make('p', 'ceobe-memory-tags', session.l1.tags.map(tag => `#${tag}`).join(' ')));
    content.append(l1);

    const l2 = make('section', 'ceobe-memory-session-section');
    l2.append(make('h3', '', 'L2 记忆文档'));
    const prose = make('div', 'ceobe-memory-prose');
    prose.innerHTML = session.l2?.html || '<p>没有 L2 文档。</p>';
    l2.append(prose);
    content.append(l2);

    const l4 = make('section', 'ceobe-memory-session-section');
    l4.append(make('h3', '', `L4 事件树 · ${session.l4?.nodes?.length || 0} 节点`));
    if (session.l4?.nodes?.length) {
      const list = make('ol', 'ceobe-memory-event-list');
      for (const node of session.l4.nodes) {
        const item = make('li');
        item.dataset.eventType = node.t || '';
        item.dataset.eventStatus = node.s || '';
        const range = Array.isArray(node.r) ? (node.r[0] === node.r[1] ? `第 ${node.r[0]} 轮` : `第 ${node.r[0]}–${node.r[1]} 轮`) : '';
        item.append(
          make('strong', '', `#${node.n} ${node.t || 'event'} · ${node.s || ''}`),
          make('span', 'ceobe-memory-event-range', range),
          make('p', '', node.x || ''),
        );
        list.append(item);
      }
      l4.append(list);
    } else {
      l4.append(make('p', '', '没有 L4 事件树。'));
    }
    if (session.l4?.edges?.length) {
      const edges = make('p', 'ceobe-memory-event-edges', `关系：${session.l4.edges.map(edge => `#${edge[0]} —${edge[2]}→ #${edge[1]}`).join('；')}`);
      l4.append(edges);
    }
    if (session.l4?.open?.length) {
      const open = make('details', 'ceobe-memory-flags');
      open.append(make('summary', '', `未决问题 ${session.l4.open.length} 条`));
      const list = make('ul');
      for (const question of session.l4.open) list.append(make('li', '', question));
      open.append(list);
      l4.append(open);
    }
    content.append(l4);
  }

  function renderGlobal(global) {    setStatus(`${global.coverage?.sessions ?? '—'} 个会话 · ${global.coverage?.rounds ?? '—'} 轮 · 截至 ${global.as_of}`);
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

    if (global.overview?.html) {
      const overview = make('details', 'ceobe-memory-global-section ceobe-memory-overview');
      overview.append(make('summary', '', `全局总览正文 · ${global.overview.chars} 字`));
      const prose = make('div', 'ceobe-memory-prose');
      prose.innerHTML = global.overview.html;
      overview.append(prose);
      content.append(overview);
    }

    content.append(renderSessionIndex());

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

  function render(group, sessionId) {
    const session = sessionId ? view.sessions.find(item => item.id === sessionId) : null;
    const current = session || selected(group);
    const actualGroup = session ? session.group : current === view.global ? 'global' : current?.group;
    renderTabs(actualGroup);
    content.replaceChildren();
    empty.hidden = Boolean(current);
    if (!current) {
      setStatus('还没有可显示的记忆。');
      return;
    }
    if (session) renderSession(session);
    else if (actualGroup === 'global') renderGlobal(current);
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
        sessions: Array.isArray(data?.sessions) ? data.sessions : [],
        ungrouped: data?.ungrouped || { count: 0, sessions: [] },
      };
      render(groupFromUrl(), sessionFromUrl());
    })
    .catch(error => {
      empty.hidden = false;
      setStatus('无法读取项目记忆。');
      empty.textContent = error.message;
    });
})();
