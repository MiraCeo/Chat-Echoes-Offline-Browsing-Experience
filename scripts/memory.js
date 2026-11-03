(() => {
  const root = document.querySelector('[data-ceobe-memory]');
  if (!root) return;
  const tabs = root.querySelector('[data-memory-groups]');
  const content = root.querySelector('[data-memory-content]');
  const status = root.querySelector('[data-memory-status]');
  const empty = root.querySelector('[data-memory-empty]');
  const searchInput = root.querySelector('[data-memory-search]');
  const searchResults = root.querySelector('[data-memory-search-results]');
  const searchStatus = root.querySelector('[data-memory-search-status]');
  let view = { groups: [], global: null, ungrouped: { count: 0, sessions: [] } };
  let searchIndex = [];

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
    head.append(make('h2', '', bank.name || bank.group), make('span', 'ceobe-memory-layer', 'L3.1 记忆库'), make('p', '', `${bank.as_of} 快照${bank.snapshot ? ' · 不代表之后状态' : ''}`));
    content.append(head);

    if (bank.mainlines?.length) {
      const mainlines = make('section', 'ceobe-memory-mainlines');
      mainlines.append(make('h3', '', `L3 主线 · ${bank.mainlines.length} 条`));
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

  function findSession(short) {
    return view.sessions.find(session => session.short === short || session.id.startsWith(short));
  }

  function messageHref(session, round) {
    const target = session?.round_map?.find(item => item.round === round);
    if (!session?.page || !target?.message_id) return null;
    return `${new URL(session.page, location.href).href}#bookmark=${encodeURIComponent(target.message_id)}`;
  }

  function appendSourceLink(container, session, round, text) {
    const href = messageHref(session, round);
    if (!href) return false;
    const link = make('a', 'ceobe-memory-source-link', text);
    link.href = href;
    link.dataset.memorySourceSession = session.id;
    link.dataset.memorySourceRound = String(round);
    container.append(link);
    return true;
  }

  function formatDate(ts) {
    if (!Number.isFinite(ts)) return '';
    try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(ts * 1000)); }
    catch { return ''; }
  }

  function renderTree(global) {
    const tree = global.tree_data;
    if (!tree?.nodes?.length) return null;
    const section = make('section', 'ceobe-memory-global-section ceobe-memory-tree');
    section.append(make('h3', '', `L5 跨会话树 · ${tree.nodes.length} 节点 / ${tree.edges.length} 边`));
    section.append(make('p', 'ceobe-memory-tree-note', '只读浏览；节点按时间编号，来源轮次可跳到对应会话。'));

    const nodes = make('details', 'ceobe-memory-tree-details');
    nodes.append(make('summary', '', `节点 ${tree.nodes.length}`));
    const list = make('div', 'ceobe-memory-tree-nodes');
    for (const node of tree.nodes) {
      const item = make('article', 'ceobe-memory-tree-node');
      item.dataset.treeNode = String(node.n);
      const head = make('div', 'ceobe-memory-tree-node-head');
      head.append(
        make('strong', '', `#${node.n}`),
        make('span', 'ceobe-memory-tree-type', `${node.t || 'event'} · ${node.s || ''}`),
      );
      const date = formatDate(node.ts);
      if (date) head.append(make('time', 'ceobe-memory-tree-date', date));
      item.append(head, make('p', '', node.x || ''));
      if (node.src?.length) {
        const sources = make('div', 'ceobe-memory-tree-sources');
        for (const source of node.src) {
          const session = findSession(source.s);
          const label = `${source.s}${source.r ? ` · ${source.r[0]}–${source.r[1]} 轮` : ''}`;
          if (session && appendSourceLink(sources, session, source.r?.[0], label)) continue;
          const chip = make(session ? 'button' : 'span', 'ceobe-memory-source');
          if (session) {
            chip.type = 'button';
            chip.dataset.memorySourceSession = session.id;
            chip.addEventListener('click', () => chooseSession(session));
          }
          chip.textContent = label;
          if (!session) chip.title = '该来源不在当前 31 会话 archive 中';
          sources.append(chip);
        }
        item.append(sources);
      }
      list.append(item);
    }
    nodes.append(list);
    section.append(nodes);

    if (tree.edges?.length) {
      const edges = make('details', 'ceobe-memory-tree-details');
      edges.append(make('summary', '', `关系 ${tree.edges.length}`));
      const edgeList = make('ul', 'ceobe-memory-edge-list');
      for (const edge of tree.edges) {
        edgeList.append(make('li', '', `#${edge[0]} —${edge[2]}→ #${edge[1]}`));
      }
      edges.append(edgeList);
      section.append(edges);
    }
    return section;
  }

  function stripHtml(html) {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buildSearchIndex() {
    const entries = [];
    const add = (kind, title, text, target) => {
      const body = String(text || '').replace(/\s+/g, ' ').trim();
      if (body) entries.push({ kind, title, text: body, target });
    };
    for (const group of view.groups) {
      add('组', group.name, `${group.name} ${group.as_of}`, { type: 'group', group: group.group });
      for (const key of group.block_order || []) {
        for (const entry of group.blocks?.[key] || []) {
          add('记忆', `${group.name} · ${group.block_labels?.[key] || key}`, `${entry.key || ''} ${entry.text || ''}`, { type: 'group', group: group.group });
        }
      }
      for (const mainline of group.mainlines || []) add('主线', `${group.name} · ${mainline.label}`, mainline.label, { type: 'group', group: group.group });
      for (const flag of [...(group.flags || []), ...(group.coverage_gaps || [])]) add('说明', group.name, flag.text || flag.note || flag.reason || flag.caveat, { type: 'group', group: group.group });
    }
    for (const session of view.sessions) {
      add('会话', session.title, `${session.title} ${session.l1?.summary || ''} ${(session.l1?.tags || []).join(' ')}`, { type: 'session', session });
      add('L2', session.title, stripHtml(session.l2?.html), { type: 'session', session });
      for (const node of session.l4?.nodes || []) add('L4', `${session.title} · #${node.n}`, node.x, { type: 'session', session });
    }
    for (const node of view.global?.tree_data?.nodes || []) {
      const source = node.src?.[0];
      const session = source ? findSession(source.s) : null;
      add('L5', `L5 #${node.n}`, node.x, session ? { type: 'href', href: messageHref(session, source.r?.[0]) } : { type: 'global' });
    }
    for (const doc of view.global?.thread_docs || []) add('分册', doc.name, stripHtml(doc.html), { type: 'doc', name: doc.name });
    for (const mainline of view.global?.mainlines || []) add('全局主线', mainline.label, mainline.label, { type: 'global' });
    for (const project of view.global?.projects || []) add('项目', project.label, project.label, { type: 'global' });
    for (const conflict of view.global?.conflicts || []) add('冲突', conflict.topic || conflict.id, `${conflict.topic || ''} ${conflict.status || ''}`, { type: 'global' });
    add('总览', '全局总览', stripHtml(view.global?.overview?.html), { type: 'global' });
    searchIndex = entries;
  }

  function openThreadDoc(name) {
    choose('global');
    requestAnimationFrame(() => {
      const details = [...content.querySelectorAll('.ceobe-memory-thread')]
        .find(node => node.querySelector('summary')?.textContent === name);
      if (details) {
        details.open = true;
        details.scrollIntoView({ block: 'start' });
      }
    });
  }

  function clearSearch() {
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.hidden = true;
    if (searchStatus) searchStatus.textContent = '';
    content.hidden = false;
  }

  function renderSearch() {
    const query = searchInput?.value.trim().toLowerCase() || '';
    if (!query) {
      clearSearch();
      return;
    }
    const hits = searchIndex.filter(entry => `${entry.title} ${entry.text}`.toLowerCase().includes(query)).slice(0, 60);
    searchResults.replaceChildren();
    searchResults.hidden = false;
    content.hidden = true;
    searchStatus.textContent = `${hits.length} 条结果`;
    if (!hits.length) {
      searchResults.append(make('p', 'ceobe-memory-search-empty', '没有匹配的记忆。'));
      return;
    }
    for (const hit of hits) {
      const button = make('button', 'ceobe-memory-search-hit');
      button.type = 'button';
      button.append(make('strong', '', `${hit.kind} · ${hit.title}`), make('span', '', hit.text.slice(0, 180)));
      button.addEventListener('click', () => {
        clearSearch();
        if (hit.target.type === 'session') chooseSession(hit.target.session);
        else if (hit.target.type === 'group') choose(hit.target.group);
        else if (hit.target.type === 'doc') openThreadDoc(hit.target.name);
        else if (hit.target.type === 'href' && hit.target.href) location.href = hit.target.href;
        else choose('global');
      });
      searchResults.append(button);
    }
  }

  searchInput?.addEventListener('input', renderSearch);
  searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape') clearSearch();
  });

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
        const jump = messageHref(session, node.r?.[0]);
        if (jump) {
          const link = make('a', 'ceobe-memory-event-jump', '跳到原文');
          link.href = jump;
          link.dataset.memoryEventRound = String(node.r[0]);
          item.append(link);
        }
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
    head.append(make('h2', '', '全局记忆'), make('span', 'ceobe-memory-layer', 'L3 全局'), make('p', '', `${global.as_of} 快照 · 四组并集`));
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
      mainlines.append(make('h3', '', `L3 全局主线 ${global.mainlines.length} 条`));
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
    const tree = renderTree(global);
    if (tree) content.append(tree);

    if (global.thread_docs?.length) {
      const docs = make('section', 'ceobe-memory-global-section');
      docs.append(make('h3', '', `L3 分册 ${global.thread_docs.length} 份`));
      for (const doc of global.thread_docs) {
        const details = make('details', 'ceobe-memory-thread');
        details.append(make('summary', '', doc.name));
        const prose = make('div', 'ceobe-memory-prose');
        prose.innerHTML = doc.html || '';
        details.append(prose);
        docs.append(details);
      }
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
      buildSearchIndex();
      render(groupFromUrl(), sessionFromUrl());
    })
    .catch(error => {
      empty.hidden = false;
      setStatus('无法读取项目记忆。');
      empty.textContent = error.message;
    });
})();
