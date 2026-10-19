// CEOBE 采集器（扩展版）——0.1.0 诊断版
// 只做一件事：把页面事实打印出来。不导出、不宣称能采集。
(() => {
  'use strict';

  const network = [];
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = String(args[0]?.url || args[0]);
      const response = await originalFetch.apply(this, args);
      if (/\/backend-api\/conversations/i.test(url)) {
        let bytes = 0;
        let messages = null;
        try {
          const text = await response.clone().text();
          bytes = text.length;
          const parsed = JSON.parse(text);
          messages = Array.isArray(parsed.messages) ? parsed.messages.length : null;
        } catch {}
        network.push({ url: url.split('?')[1] || '', status: response.status, kb: Math.round(bytes / 1024), messages });
        console.info('[CEOBE] net', network[network.length - 1]);
      }
      return response;
    };
  } catch (error) { console.warn('[CEOBE] fetch hook failed', error); }

  const scrollers = () => {
    const rows = [];
    for (const element of document.querySelectorAll('div, main, section')) {
      const style = getComputedStyle(element);
      if (!/auto|scroll/.test(style.overflowY)) continue;
      const range = element.scrollHeight - element.clientHeight;
      if (range < 200) continue;
      rows.push({
        tag: element.tagName.toLowerCase(),
        cls: (element.getAttribute('class') || '').slice(0, 70),
        range,
        clientHeight: element.clientHeight,
        scrollTop: Math.round(element.scrollTop),
      });
    }
    return rows.sort((left, right) => right.range - left.range).slice(0, 6);
  };

  const turns = () => ({
    turnKey: document.querySelectorAll('[data-turn-key]').length,
    role: document.querySelectorAll('[data-conversation-role]').length,
    userBubble: document.querySelectorAll('[data-user-message-bubble]').length,
  });

  const report = async () => {
    const before = { scrollers: scrollers(), turns: turns() };
    const top = before.scrollers[0];
    const element = top ? [...document.querySelectorAll('div, main, section')].find(node =>
      (node.getAttribute('class') || '').slice(0, 70) === top.cls && node.clientHeight === top.clientHeight) : null;
    let after = null;
    if (element) {
      element.scrollTop = Math.max(0, element.scrollTop - Math.round(element.clientHeight * 2));
      await new Promise(done => setTimeout(done, 1500));
      after = { scrollTop: Math.round(element.scrollTop), turns: turns() };
    }
    const data = { before, scrolled: after, network, url: location.pathname };
    console.log('[CEOBE] 诊断报告', JSON.stringify(data, null, 1));
    const toast = document.createElement('div');
    toast.textContent = '诊断完成：滚动候选 ' + before.scrollers.length + ' 个，网络请求 ' + network.length + ' 条，详情见控制台';
    Object.assign(toast.style, {
      position: 'fixed', left: '16px', bottom: '64px', zIndex: 2147483647, padding: '10px 14px',
      borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif', color: '#fff', background: '#1f2937',
      maxWidth: '420px',
    });
    document.body.append(toast);
    setTimeout(() => toast.remove(), 10000);
  };

  const mount = () => {
    if (document.getElementById('ceobe-extension-bar')) return;
    const button = document.createElement('button');
    button.id = 'ceobe-extension-bar';
    button.textContent = 'CEOBE 诊断';
    Object.assign(button.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647,
      padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff',
      font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)',
    });
    button.addEventListener('click', report);
    document.body.append(button);
  };

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  console.info('[CEOBE] 诊断版 0.1.0 就绪');
})();