(() => {
  const root = document.querySelector('[data-ceobe-memory]');
  if (!root) return;
  const tabs = root.querySelector('[data-memory-groups]');
  const content = root.querySelector('[data-memory-content]');
  const status = root.querySelector('[data-memory-status]');
  const empty = root.querySelector('[data-memory-empty]');
  let banks = [];

  const setStatus = text => { if (status) status.textContent = text; };
  const groupFromUrl = () => new URLSearchParams(location.search).get('group');

  function render(group) {
    const bank = banks.find(item => item.group === group) || banks[0];
    tabs.replaceChildren();
    content.replaceChildren();
    empty.hidden = Boolean(bank);
    if (!bank) { setStatus('还没有可显示的项目记忆。'); return; }
    for (const item of banks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.name;
      button.dataset.memoryGroup = item.group;
      button.setAttribute('aria-pressed', String(item.group === bank.group));
      button.addEventListener('click', () => {
        const next = new URL(location.href);
        next.searchParams.set('group', item.group);
        history.replaceState(null, '', next);
        render(item.group);
      });
      tabs.append(button);
    }
    setStatus(`${bank.coverage?.sessions ?? '—'} 个会话 · ${bank.coverage?.rounds ?? '—'} 轮 · v${bank.version ?? '—'}`);
    const header = document.createElement('section');
    header.className = 'ceobe-memory-bank-head';
    const title = document.createElement('h2');
    title.textContent = bank.name || bank.group;
    const meta = document.createElement('p');
    meta.textContent = bank.updated ? `更新于 ${new Date(bank.updated).toLocaleString('zh-CN')}` : '';
    header.append(title, meta);
    content.append(header);
    const grid = document.createElement('div');
    grid.className = 'ceobe-memory-grid';
    for (const key of bank.block_order || []) {
      const block = document.createElement('section');
      block.className = 'ceobe-memory-block';
      const heading = document.createElement('h3');
      heading.textContent = bank.block_labels?.[key] || key;
      block.append(heading);
      const list = document.createElement('ul');
      for (const entry of bank.blocks?.[key] || []) {
        const item = document.createElement('li');
        if (entry.key) {
          const label = document.createElement('strong');
          label.textContent = entry.key;
          item.append(label);
        }
        item.append(document.createTextNode(entry.text || ''));
        list.append(item);
      }
      block.append(list);
      grid.append(block);
    }
    content.append(grid);
  }

  fetch(new URL('memory-banks.json', location.href), { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('本地记忆数据不可用');
      return response.json();
    })
    .then(data => {
      banks = Array.isArray(data?.banks) ? data.banks : [];
      render(groupFromUrl());
    })
    .catch(error => {
      empty.hidden = false;
      setStatus('无法读取项目记忆。');
      empty.textContent = error.message;
    });
})();
