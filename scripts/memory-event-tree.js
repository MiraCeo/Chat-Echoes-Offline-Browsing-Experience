/**
 * L4 event-tree renderer. Kept independent from the memory page so a later UI
 * redesign can reuse it with the same session.l4 data.
 */
export function renderEventTree(session, { make, messageHref }) {
  const nodes = Array.isArray(session?.l4?.nodes) ? session.l4.nodes : [];
  const edges = Array.isArray(session?.l4?.edges) ? session.l4.edges : [];
  const section = make('section', 'ceobe-memory-session-section ceobe-event-tree');
  section.id = 'memory-layer-l4';

  const head = make('div', 'ceobe-event-tree-head');
  head.append(make('h3', '', `L4 事件树 · ${nodes.length} 节点`));
  const toolbar = make('div', 'ceobe-event-tree-toolbar');
  const statusSelect = make('select');
  statusSelect.dataset.eventStatusFilter = '';
  statusSelect.setAttribute('aria-label', '按事件状态筛选');
  statusSelect.append(new Option('全部状态', 'all'));
  for (const status of [...new Set(nodes.map(node => node.s).filter(Boolean))].sort()) {
    statusSelect.append(new Option(status, status));
  }
  const typeSelect = make('select');
  typeSelect.dataset.eventTypeFilter = '';
  typeSelect.setAttribute('aria-label', '按事件类型筛选');
  typeSelect.append(new Option('全部类型', 'all'));
  for (const type of [...new Set(nodes.map(node => node.t).filter(Boolean))].sort()) {
    typeSelect.append(new Option(type, type));
  }
  toolbar.append(statusSelect, typeSelect);
  head.append(toolbar);
  section.append(head);

  const graph = make('div', 'ceobe-event-tree-graph');
  const canvas = make('div', 'ceobe-event-tree-canvas');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  canvas.append(svg);
  graph.append(canvas);
  section.append(graph);

  const detail = make('div', 'ceobe-event-tree-detail');
  detail.setAttribute('role', 'region');
  detail.setAttribute('aria-label', '事件节点详情');
  section.append(detail);

  const mobile = make('ol', 'ceobe-event-tree-mobile');
  section.append(mobile);

  const visible = () => nodes.filter(node =>
    (statusSelect.value === 'all' || node.s === statusSelect.value)
    && (typeSelect.value === 'all' || node.t === typeSelect.value));

  function depthMap(list) {
    const ids = new Set(list.map(node => node.n));
    const incoming = new Map(list.map(node => [node.n, 0]));
    for (const edge of edges) {
      if (ids.has(edge[0]) && ids.has(edge[1])) incoming.set(edge[1], (incoming.get(edge[1]) || 0) + 1);
    }
    const depth = new Map(list.map(node => [node.n, 0]));
    for (let pass = 0; pass < list.length; pass += 1) {
      let changed = false;
      for (const edge of edges) {
        if (!ids.has(edge[0]) || !ids.has(edge[1])) continue;
        const next = Math.min(list.length - 1, (depth.get(edge[0]) || 0) + 1);
        if (next > (depth.get(edge[1]) || 0)) {
          depth.set(edge[1], next);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return depth;
  }

  function selectNode(node) {
    detail.replaceChildren();
    const title = make('h4', '', `#${node.n} · ${node.t || 'event'} · ${node.s || ''}`);
    detail.append(title);
    detail.append(make('p', '', node.x || ''));
    const meta = [];
    if (Array.isArray(node.r)) meta.push(node.r[0] === node.r[1] ? `第 ${node.r[0]} 轮` : `第 ${node.r[0]}–${node.r[1]} 轮`);
    if (node.e?.length) meta.push(`实体 ${node.e.length} 个`);
    if (meta.length) detail.append(make('p', 'ceobe-event-tree-meta', meta.join(' · ')));
    const href = messageHref(session, node.r?.[0]);
    if (href) {
      const link = make('a', 'ceobe-event-tree-source', '跳到原文');
      link.href = href;
      link.dataset.eventSource = String(node.n);
      detail.append(link);
    }
    const related = edges.filter(edge => edge[0] === node.n || edge[1] === node.n);
    if (related.length) {
      const list = make('ul', 'ceobe-event-tree-related');
      for (const edge of related) {
        list.append(make('li', '', `#${edge[0]} —${edge[2]}→ #${edge[1]}`));
      }
      detail.append(list);
    }
  }

  function draw() {
    const list = visible();
    const ids = new Set(list.map(node => node.n));
    const depth = depthMap(list);
    const groups = new Map();
    for (const node of list) {
      const level = depth.get(node.n) || 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    }
    for (const group of groups.values()) group.sort((a, b) => a.n - b.n);
    const maxDepth = Math.max(0, ...groups.keys());
    const maxCount = Math.max(1, ...[...groups.values()].map(group => group.length));
    const NODE_W = 190;
    const NODE_H = 64;
    const GAP_X = 70;
    const GAP_Y = 16;
    const PAD = 20;
    const width = PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * GAP_X;
    const height = PAD * 2 + maxCount * NODE_H + (maxCount - 1) * GAP_Y;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.replaceChildren();
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<marker id="ceobe-event-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#98a2b3"/></marker>';
    svg.append(defs);
    canvas.querySelectorAll('.ceobe-event-node').forEach(node => node.remove());
    mobile.replaceChildren();

    const positions = new Map();
    for (const [level, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      group.forEach((node, index) => {
        positions.set(node.n, {
          left: PAD + level * (NODE_W + GAP_X),
          top: PAD + index * (NODE_H + GAP_Y),
        });
      });
    }

    for (const edge of edges) {
      if (!ids.has(edge[0]) || !ids.has(edge[1])) continue;
      const from = positions.get(edge[0]);
      const to = positions.get(edge[1]);
      if (!from || !to) continue;
      const x1 = from.left + NODE_W;
      const y1 = from.top + NODE_H / 2;
      const x2 = to.left;
      const y2 = to.top + NODE_H / 2;
      const mid = Math.max(x1 + 24, (x1 + x2) / 2);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'ceobe-event-edge');
      path.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      path.setAttribute('marker-end', 'url(#ceobe-event-arrow)');
      path.dataset.eventEdge = `${edge[0]}-${edge[1]}`;
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `#${edge[0]} —${edge[2]}→ #${edge[1]}`;
      path.append(title);
      svg.append(path);
    }

    for (const node of list) {
      const pos = positions.get(node.n);
      const button = make('button', `ceobe-event-node status-${node.s || 'unknown'}`);
      button.type = 'button';
      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top}px`;
      button.dataset.eventNode = String(node.n);
      button.append(
        make('strong', '', `#${node.n}`),
        make('span', 'ceobe-event-node-type', `${node.t || 'event'} · ${node.s || ''}`),
        make('p', '', node.x || ''),
      );
      button.addEventListener('click', () => selectNode(node));
      canvas.append(button);

      const item = make('li');
      item.style.paddingLeft = `${(depth.get(node.n) || 0) * 14}px`;
      const mobileButton = make('button', 'ceobe-event-mobile-node');
      mobileButton.type = 'button';
      mobileButton.append(
        make('strong', '', `#${node.n} ${node.t || 'event'} · ${node.s || ''}`),
        make('span', '', node.x || ''),
      );
      mobileButton.addEventListener('click', () => selectNode(node));
      item.append(mobileButton);
      mobile.append(item);
    }

    if (!list.length) {
      graph.append(make('p', 'ceobe-event-tree-empty', '没有符合筛选条件的事件。'));
    }
    if (list.length) selectNode(list[0]);
  }

  statusSelect.addEventListener('change', draw);
  typeSelect.addEventListener('change', draw);
  draw();

  if (session?.l4?.open?.length) {
    const open = make('details', 'ceobe-memory-flags');
    open.append(make('summary', '', `未决问题 ${session.l4.open.length} 条`));
    const list = make('ul');
    for (const question of session.l4.open) list.append(make('li', '', question));
    open.append(list);
    section.append(open);
  }
  return section;
}
