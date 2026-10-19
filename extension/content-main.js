// CEOBE 采集器（扩展版，MAIN world）——0.5 完整会话
(() => {
  'use strict';

  const captured = [];
  const requestHints = new Map();
  const fetchResults = [];
  const MAX = 40 * 1024 * 1024;
  const interesting = text => Boolean(text) && text.length < MAX
    && /("messages"\s*:\s*\[|"mapping"|model_dil_v2)/.test(text);

  const remember = (url, text) => {
    if (!interesting(text)) return;
    if (captured.some(entry => entry.text === text)) return;
    captured.push({ url, text });
    console.info('[CEOBE] 捕获', url.slice(-60), Math.round(text.length / 1024) + ' KB');
  };

  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const requestUrl = String(args[0]?.url || args[0]);
      const init = (args[1] && typeof args[1] === 'object') ? args[1] : {};
      if (/\/backend-api\/conversations\/[0-9a-f-]{36}/i.test(requestUrl) && init.headers) {
        requestHints.set(requestUrl.split('?')[0], { headers: init.headers, credentials: init.credentials || 'include' });
      }
      const response = await originalFetch.apply(this, args);
      try { remember(requestUrl, await response.clone().text()); } catch {}
      return response;
    };
  } catch (error) { console.warn('[CEOBE] fetch 拦截失败', error); }

  const toast = (message, tone = 'info') => {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed', left: '16px', bottom: '64px', zIndex: 2147483647,
      padding: '10px 14px', borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif',
      color: '#fff', background: tone === 'error' ? '#b42318' : '#1f2937',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '440px', whiteSpace: 'pre-wrap',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 9000);
  };

  const currentId = () => {
    const match = /\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})/i.exec(location.pathname);
    return match ? match[1] : null;
  };

  const parse = text => { try { return JSON.parse(text); } catch { return null; } };

  // 只保留当前会话的载荷：截图状态跨导航累积，不按 id 过滤会把上一条会话也打包进去。
  const conversationsFor = id => captured.filter(entry => {
    const parsed = parse(entry.text);
    return parsed && Array.isArray(parsed.messages) && parsed.conversation_id === id;
  });

  const download = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // 页面自己只请求 num_turns=10（尾部 10 轮）；这里主动用更大的窗口再取一次。
  const fetchFull = async id => {
    const attempts = [200, 100];
    const hint = requestHints.get(`/backend-api/conversations/${id}`) || {};
    for (const turns of attempts) {
      try {
        const response = await fetch(`/backend-api/conversations/${id}?num_turns=${turns}&include_has_versions=true`, {
          credentials: hint.credentials || 'include',
          headers: hint.headers || { accept: 'application/json' },
        });
        fetchResults.push({ turns, status: response.status });
        if (!response.ok) continue;
        const text = await response.text();
        const parsed = parse(text);
        if (parsed && Array.isArray(parsed.messages) && parsed.conversation_id === id) {
          remember(`active-fetch num_turns=${turns}`, text);
          return parsed.messages.length;
        }
      } catch { /* try the next window */ }
    }
    return 0;
  };

  const capture = async () => {
    const id = currentId();
    if (!id) { toast('当前页面不是会话页', 'error'); return; }
    const before = conversationsFor(id).reduce((sum, entry) => sum + (parse(entry.text)?.messages?.length || 0), 0);
    toast('正在补齐会话…（已捕获 ' + before + ' 条，复用页面请求头）');
    const fetched = await fetchFull(id);
    const found = conversationsFor(id);
    if (!found.length) {
      toast('还没录到会话：刷新页面（让拦截器先就位），再点一次', 'error');
      return;
    }
    const counts = found.map(entry => parse(entry.text).messages.length);
    const payload = {
      kind: 'ceobe.response-capture',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web_extension', url: location.href, method: 'fetch-hook+active-window', responses: found.length },
      responses: found.map(entry => ({ url: entry.url, text: entry.text })),
    };
    const text = JSON.stringify(payload);
    download(text, 'ceobe-responses-' + id.slice(0, 8) + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    toast('已导出 ' + found.length + ' 个响应（消息 ' + counts.join('/') + ' 条，' + Math.round(text.length / 1024 / 1024 * 10) / 10 + ' MB）' + (fetched ? '，主动请求 ' + JSON.stringify(fetchResults.slice(-2)) : ''));
  };

  const mount = () => {
    if (document.getElementById('ceobe-extension-bar')) return;
    const button = document.createElement('button');
    button.id = 'ceobe-extension-bar';
    button.textContent = 'CEOBE 采集';
    Object.assign(button.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647,
      padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff',
      font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)',
    });
    button.addEventListener('click', capture);
    document.body.append(button);
  };

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  console.info('[CEOBE] 扩展版 0.5 就绪（按会话过滤 + 主动补齐）');
})();