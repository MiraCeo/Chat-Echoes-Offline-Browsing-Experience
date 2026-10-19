// CEOBE 采集器（扩展版，MAIN world）——0.3 穷举扫描 + 请求拦截
(() => {
  'use strict';

  const captured = [];
  const isMessage = value => Boolean(value) && typeof value === 'object'
    && value.author && typeof value.author === 'object'
    && value.content && typeof value.content === 'object';

  const toast = (message, tone = 'info') => {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed', left: '16px', bottom: '64px', zIndex: 2147483647,
      padding: '10px 14px', borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif',
      color: '#fff', background: tone === 'error' ? '#b42318' : '#1f2937',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '420px', whiteSpace: 'pre-wrap',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 9000);
  };

  // 拦截页面请求：扩展注入不受页面 CSP 限制，官方改路由也能录到原始响应。
  const remember = (url, text) => {
    if (!text || text.length > 40 * 1024 * 1024) return;
    if (!/"(mapping|model_dil_v2|current_node)"/.test(text)) return;
    if (captured.some(entry => entry.text === text)) return;
    captured.push({ url, text });
    console.info('[CEOBE] 捕获响应', url, Math.round(text.length / 1024) + ' KB');
  };
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try { remember(String(args[0]?.url || args[0]), await response.clone().text()); } catch {}
      return response;
    };
  } catch (error) { console.warn('[CEOBE] fetch 拦截失败', error); }

  // 穷举扫描：不猜字段名，按 author+content 特征在 props / state 里找消息对象。
  const scanObject = (root, depth, path, out, seen) => {
    if (!root || typeof root !== 'object' || depth > 4 || seen.has(root)) return;
    seen.add(root);
    if (isMessage(root) && root.id && !out.some(item => item.message.id === root.id)) {
      out.push({ path, message: root });
      return;
    }
    let keys = [];
    try { keys = Object.keys(root); } catch { return; }
    for (const key of keys.slice(0, 120)) {
      if (key === 'children' || key === 'return' || key === 'sibling' || key === 'stateNode') continue;
      let value;
      try { value = root[key]; } catch { continue; }
      if (value && typeof value === 'object') scanObject(value, depth + 1, path + '.' + key, out, seen);
    }
  };

  const collectFromFibers = () => {
    const out = [];
    const seen = new Set();
    const anchors = document.querySelectorAll('[data-turn-key], [data-d-component], main div');
    let fibers = 0;
    for (const node of anchors) {
      const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
      if (!key) continue;
      let fiber = node[key];
      for (let depth = 0; fiber && depth < 80; depth += 1) {
        fibers += 1;
        try { scanObject(fiber.memoizedProps, 0, 'props', out, seen); } catch {}
        try { scanObject(fiber.memoizedState, 0, 'state', out, seen); } catch {}
        fiber = fiber.return;
      }
      if (out.length > 200) break;
    }
    return { messages: out, fibers };
  };

  const probe = () => {
    const { messages, fibers } = collectFromFibers();
    const roles = {};
    let dil = 0;
    for (const { message } of messages) {
      roles[message.author?.role || '?'] = (roles[message.author?.role || '?'] || 0) + 1;
      if (message.metadata?.model_dil_v2) dil += 1;
    }
    console.log('[CEOBE] probe', { fibers, messages: messages.length, roles, dil, capturedResponses: captured.length, sample: messages.slice(0, 3).map(item => item.path) });
    if (messages.length) { toast('fiber 扫描：' + messages.length + ' 条消息；角色 ' + JSON.stringify(roles) + '；含 DIL ' + dil); return; }
    if (captured.length) { toast('fiber 里没有消息，但拦截到 ' + captured.length + ' 个响应，可点导出'); return; }
    toast('两者都没有：fiber 扫描 ' + fibers + ' 个节点无消息，也未拦截到响应。请刷新页面后先点导出再点探针', 'error');
  };

  const exportData = () => {
    const { messages, fibers } = collectFromFibers();
    const payload = messages.length
      ? { kind: 'ceobe.message-capture', schema_version: '0.2.0', captured_at: new Date().toISOString(), source: { type: 'chatgpt_web_extension', url: location.href, method: 'fiber-exhaustive' }, messages: messages.map(item => ({ path: item.path, message: item.message })) }
      : { kind: 'ceobe.response-capture', schema_version: '0.1.0', captured_at: new Date().toISOString(), source: { type: 'chatgpt_web_extension', url: location.href, method: 'request-hook' }, responses: captured.map(entry => ({ url: entry.url, text: entry.text })) };
    if (!messages.length && !captured.length) { toast('没有可导出的数据', 'error'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (messages.length ? 'ceobe-messages-' : 'ceobe-responses-') + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(messages.length ? '已导出 ' + messages.length + ' 条消息' : '已导出 ' + captured.length + ' 个响应');
  };

  const mount = () => {
    if (document.getElementById('ceobe-extension-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ceobe-extension-bar';
    Object.assign(bar.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647, display: 'flex', gap: '6px' });
    const make = (label, handler) => {
      const button = document.createElement('button');
      button.textContent = label;
      Object.assign(button.style, { padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff', font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)' });
      button.addEventListener('click', handler);
      return button;
    };
    bar.append(make('CEOBE 探针', probe), make('CEOBE 导出', exportData));
    document.body.append(bar);
  };

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  console.info('[CEOBE] 扩展版 0.3 就绪（穷举扫描 + 请求拦截）');
})();
