import { buildIndex, search } from './memory-search-core.mjs';

(() => {
  const root = document.querySelector('[data-ceobe-unified-search]');
  if (!root) return;
  const input = root.querySelector('[data-unified-search]');
  const status = root.querySelector('[data-unified-status]');
  const results = root.querySelector('[data-unified-results]');
  const empty = root.querySelector('[data-unified-empty]');

  const SOURCE_LABELS = { memory: '记忆', asset: '文件与图片', chat: '聊天' };
  let unified = null;
  let chat = null;
  let chatLoading = null;

  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const loadJson = async name => {
    const response = await fetch(new URL(name, location.href), { cache: 'no-store' });
    if (!response.ok) throw new Error(`${name} 不可用`);
    return response.json();
  };

  const loadChat = () => {
    if (chat) return Promise.resolve(chat);
    if (chatLoading) return chatLoading;
    chatLoading = Promise.all([loadJson('search-index.json'), loadJson('memory-session-index.json')])
      .then(([index, sessions]) => {
        const docs = [];
        for (const conversation of index.conversations || []) {
          const title = sessions.sessions?.[conversation.id]?.title || conversation.id;
          for (const turn of conversation.turns || []) {
            if (!turn.text) continue;
            docs.push({
              kind: '聊天',
              title: `${title} · ${turn.role === 'user' ? '我' : 'AI'}`,
              text: turn.text,
              target: { type: 'turn', conversation: conversation.id, message: turn.message_id },
              source: 'chat',
            });
          }
        }
        chat = buildIndex(docs, []);
        return chat;
      })
      .catch(() => null);
    return chatLoading;
  };

  const hrefFor = hit => {
    const target = hit.target || {};
    if (hit.source === 'asset') return `assets.html?asset=${encodeURIComponent(target.id || '')}`;
    if (hit.source === 'chat') return `conversations/${encodeURIComponent(target.conversation)}.html#bookmark=${encodeURIComponent(target.message)}`;
    if (target.type === 'session') return `memory.html?session=${encodeURIComponent(target.session?.id || target.id || '')}`;
    if (target.type === 'group') return `memory.html?group=${encodeURIComponent(target.group || 'global')}`;
    if (target.type === 'doc') return 'memory.html?group=global';
    return 'memory.html';
  };

  const render = async () => {
    const query = input.value.trim();
    if (!query) {
      results.replaceChildren();
      empty.hidden = false;
      status.textContent = '';
      return;
    }
    empty.hidden = true;
    status.textContent = '搜索中…';
    if (!unified) unified = await loadJson('unified-search.json');
    const chatIndex = await loadChat();
    const groups = [
      ['memory', search(unified, query, { limit: 40 }).filter(hit => hit.source === 'memory')],
      ['asset', search(unified, query, { limit: 40 }).filter(hit => hit.source === 'asset')],
      ['chat', chatIndex ? search(chatIndex, query, { limit: 40 }) : []],
    ];
    const total = groups.reduce((sum, [, hits]) => sum + hits.length, 0);
    status.textContent = `${total} 条结果`;
    results.replaceChildren();
    if (!total) {
      results.append(make('p', '没有匹配的内容。', 'ceobe-search-none'));
      return;
    }
    for (const [source, hits] of groups) {
      if (!hits.length) continue;
      const section = make('section', '', 'ceobe-search-section');
      section.append(make('h2', `${SOURCE_LABELS[source]} · ${hits.length}`));
      const list = make('div', '', 'ceobe-search-list');
      for (const hit of hits) {
        const link = make('a', '', 'ceobe-search-hit');
        link.href = hrefFor(hit);
        link.append(make('strong', `${hit.kind} · ${hit.title}`), make('span', hit.text.slice(0, 180)));
        list.append(link);
      }
      section.append(list);
      results.append(section);
    }
  };

  let timer = null;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 180);
  });
  input?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { input.value = ''; render(); }
  });
  render();
})();
