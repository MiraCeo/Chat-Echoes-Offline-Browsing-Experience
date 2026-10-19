// CEOBE 采集器（扩展版，MAIN world）——0.4 一键采集
(() => {
  'use strict';

  const captured = [];
  const MAX = 40 * 1024 * 1024;
  const interesting = text => Boolean(text) && text.length < MAX
    && /("messages"\s*:\s*\[|"mapping"|model_dil_v2)/.test(text);

  const remember = (url, text) => {
    if (!interesting(text)) return;
    if (captured.some(entry => entry.text === text)) return;
    captured.push({ url, text });
    console.info('[CEOBE] 捕获', url, Math.round(text.length / 1024) + ' KB');
  };

  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try { remember(String(args[0]?.url || args[0]), await response.clone().text()); } catch {}
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
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '420px', whiteSpace: 'pre-wrap',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 9000);
  };

  // 只保留会话载荷；别的响应（模型列表、设置等）不进包。
  const conversations = () => captured.filter(entry => {
    try {
      const parsed = JSON.parse(entry.text);
      return parsed && Array.isArray(parsed.messages) && parsed.conversation_id;
    } catch { return false; }
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

  const capture = () => {
    const found = conversations();
    if (!found.length) {
      toast('还没录到会话：刷新页面（让拦截器先就位），再点一次', 'error');
      return;
    }
    const payload = {
      kind: 'ceobe.response-capture',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web_extension', url: location.href, method: 'fetch-hook', responses: found.length },
      responses: found.map(entry => ({ url: entry.url, text: entry.text })),
    };
    const text = JSON.stringify(payload);
    const id = (JSON.parse(found[found.length - 1].text).conversation_id || 'conversation');
    download(text, 'ceobe-responses-' + id.slice(0, 8) + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    toast('已导出 ' + found.length + ' 个会话响应（' + Math.round(text.length / 1024 / 1024 * 10) / 10 + ' MB）');
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
  console.info('[CEOBE] 扩展版 0.4 就绪（一键采集）');
})();
