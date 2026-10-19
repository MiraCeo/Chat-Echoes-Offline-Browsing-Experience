// ==UserScript==
// @name         CEOBE 采集器（M1 探针 v0.3.1）
// @namespace    ceobe.local
// @version      0.3.1
// @description  从你自己的会话里取完整消息树，导出为 CEOBE 采集包；本地服务在跑时可直接投递。
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
//
// v0.2 改为"运行时拦截"：官方已下线 /backend-api/conversation/<id>，且会话不在 React Router 状态里，
// 因此在 document-start 包住 fetch / XHR，把任何带 "mapping" 的会话响应当场录下来。
// 边界不变：只产出数据，不写 archive/，不做阅读器。

(() => {
  'use strict';

  const LOCAL = 'http://127.0.0.1:5173';
  const TOKEN_KEY = 'ceobe.intake.token';
  const captured = []; // { url, text, at }
  const MAX_HOOK_BYTES = 40 * 1024 * 1024;

  const looksLikeConversation = (text) => text && text.length < MAX_HOOK_BYTES
    && text.includes('"mapping"') && (text.includes('"current_node"') || text.includes('"currentNode"'));

  const remember = (url, text) => {
    if (!looksLikeConversation(text)) return;
    if (captured.some(entry => entry.url === url && entry.text === text)) return;
    captured.push({ url, text, at: new Date().toISOString() });
    console.info('[CEOBE] 已捕获会话响应：', url, Math.round(text.length / 1024) + ' KB');
  };

  // --- hooks (must be installed before the app starts) -------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (/conversation|backend-api|gateway/i.test(url)) {
        const text = await response.clone().text();
        remember(url, text);
      }
    } catch { /* 读取克隆体失败不影响页面 */ }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ceobeUrl = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (!/conversation|backend-api|gateway/i.test(this.__ceobeUrl || '')) return;
        if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') return;
        remember(this.__ceobeUrl, typeof this.responseText === 'string' ? this.responseText : '');
      } catch { /* ignore */ }
    });
    return originalSend.apply(this, args);
  };

  // --- helpers ------------------------------------------------------------------------------------
  // 页面上下文没有 GM_xmlhttpRequest：同源请求自带 cookie。向 127.0.0.1 直推会被 PNA 拦，
  // 因此 M1 只做导出；直推留给扩展形态或本地导入。
  const request = async (options) => {
    const response = await fetch(options.url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.data,
      credentials: 'include',
    });
    return { status: response.status, responseText: await response.text() };
  };

  const conversationId = () => {
    const match = /\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})/i.exec(location.pathname);
    return match ? match[1] : null;
  };

  const toast = (message, tone = 'info') => {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed', insetInlineEnd: '16px', insetBlockEnd: '16px', zIndex: 2147483647,
      padding: '10px 14px', borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif',
      color: '#fff', background: tone === 'error' ? '#b42318' : '#1f2937',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '360px',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 7000);
  };

  const summarize = (conversation) => {
    const mapping = conversation.mapping || {};
    const nodes = Object.values(mapping);
    const roles = {};
    let attachments = 0;
    let citations = 0;
    for (const node of nodes) {
      const message = node.message;
      if (!message) continue;
      const role = message.author?.role || 'unknown';
      roles[role] = (roles[role] || 0) + 1;
      attachments += message.metadata?.attachments?.length || 0;
      citations += message.metadata?.content_references?.length || 0;
    }
    return {
      id: conversation.conversation_id || conversation.id,
      title: conversation.title,
      nodes: nodes.length,
      roles,
      branching: nodes.filter(node => (node.children || []).length > 1).length,
      attachments,
      citations,
      current_node: conversation.current_node || conversation.currentNode,
    };
  };

  const download = (text, filename) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const serviceAlive = async () => {
    try { return (await request({ method: 'GET', url: `${LOCAL}/api/capabilities` })).status === 200; }
    catch { return false; }
  };

  const capture = async () => {
    const id = conversationId();
    if (!id) { toast('当前页面不是会话页', 'error'); return; }

    let source = captured.map(entry => entry.url);
    let conversation = null;
    // Prefer the most recent captured payload that actually parses into a conversation.
    for (const entry of [...captured].reverse()) {
      try {
        const parsed = JSON.parse(entry.text);
        if (parsed && parsed.mapping) { conversation = parsed; source = [entry.url]; break; }
      } catch { /* keep looking */ }
    }
    if (!conversation) {
      // Fallback: the conversation may arrive in the initial HTML stream rather than an XHR.
      for (const script of document.querySelectorAll('script')) {
        const text = script.textContent || '';
        if (!text.includes('"mapping"')) continue;
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.mapping) { conversation = parsed; source = 'script#' + (script.id || 'inline'); break; }
        } catch { /* escaped payloads are reported by 诊断 */ }
      }
    }
    if (!conversation) {
      toast('v0.3.1：仍未找到会话数据。请点「诊断」并把控制台输出发我', 'error');
      console.warn('[CEOBE] 已捕获的响应：', source);
      return;
    }

    const summary = summarize(conversation);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ceobe-${id}-${stamp}.json`;
    toast(`已录到会话：${summary.nodes} 节点，准备导出`);

    if (await serviceAlive()) {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      try {
        const pushed = await request({
          method: 'POST',
          url: `${LOCAL}/api/intake`,
          headers: { 'content-type': 'application/json', 'x-ceobe-token': token },
          data: JSON.stringify({ conversation_id: id, conversation, summary }),
        });
        if (pushed.status === 200 || pushed.status === 202) { toast('已投递到本地项目'); return; }
        toast(`投递失败（HTTP ${pushed.status}），改为下载`, 'error');
      } catch { toast('投递失败，改为下载', 'error'); }
    } else {
      toast('本地服务未运行，下载采集包');
    }

    download(JSON.stringify({
      kind: 'ceobe.intake',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web', conversation_id: id, method: 'userscript-hook', endpoints: source, url: location.href },
      summary,
      conversation,
    }, null, 2), filename);
    console.log('[CEOBE] summary', summary);
  };

  const mount = () => {
    const bar = document.createElement('div');
    Object.assign(bar.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647, display: 'flex', gap: '6px' });
    const button = document.createElement('button');
    button.textContent = 'CEOBE 采集';
    Object.assign(button.style, {
      padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff',
      font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)',
    });
    button.addEventListener('click', capture);
    const diagnose = document.createElement('button');
    diagnose.textContent = '诊断';
    Object.assign(diagnose.style, button.style);
    diagnose.addEventListener('click', () => {
      const scripts = [...document.querySelectorAll('script')]
        .map(script => ({ id: script.id || '(inline)', type: script.type || '', kb: Math.round((script.textContent || '').length / 1024), hasMapping: (script.textContent || '').includes('"mapping"') }))
        .filter(item => item.kb > 0)
        .sort((left, right) => right.kb - left.kb)
        .slice(0, 12);
      const hookInstalled = !/native code/.test(String(window.fetch));
      console.log('[CEOBE] v0.3.1 诊断', { hookInstalled, captured: captured.length, scripts });
      toast(`v0.3.1：拦截 ${captured.length} 条，脚本命中 ${scripts.filter(item => item.hasMapping).length} 个；详见控制台`);
    });
    bar.append(button, diagnose);
    document.body.append(bar);
  };
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  window.addEventListener('ceobe-capture', capture);
  console.info('[CEOBE] 采集器 v0.3.1 已就绪：刷新一次会话页让拦截器录到数据，再从菜单采集。');
})();
