// CEOBE 采集器（扩展版）——0.2.0 按事实采集
// 事实来源：诊断版观测到滚动容器 div.thread-scroll-container 与分页参数 before=<游标>。
// 策略：滚动让页面自己加载更早的页，钩子记录；导出当前会话的全部页。不伪造请求。
(() => {
  'use strict';

  const captured = [];
  const parse = text => { try { return JSON.parse(text); } catch { return null; } };
  const sleep = ms => new Promise(done => setTimeout(done, ms));

  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = String(args[0]?.url || args[0]);
      if (/\/backend-api\/conversations\/[0-9a-f-]{36}/i.test(url)) {
        try {
          const text = await response.clone().text();
          const parsed = parse(text);
          if (parsed && Array.isArray(parsed.messages) && parsed.conversation_id) {
            if (!captured.some(entry => entry.text === text)) {
              captured.push({ url, text });
              console.info('[CEOBE] 捕获页', parsed.messages.length, '条', Math.round(text.length / 1024) + ' KB');
            }
          }
        } catch {}
      }
      return response;
    };
  } catch (error) { console.warn('[CEOBE] hook failed', error); }

  const currentId = () => (/\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})/i.exec(location.pathname) || [])[1] || null;

  const pages = id => captured
    .map(entry => ({ entry, parsed: parse(entry.text) }))
    .filter(item => item.parsed && item.parsed.conversation_id === id && Array.isArray(item.parsed.messages));

  const uniqueMessages = id => {
    const ids = new Set();
    for (const { parsed } of pages(id)) for (const message of parsed.messages) ids.add(message.id);
    return ids.size;
  };

  const threadScroller = () => document.querySelector('.thread-scroll-container')
    || [...document.querySelectorAll('div')].find(element => /auto|scroll/.test(getComputedStyle(element).overflowY)
      && element.scrollHeight - element.clientHeight > 400);

  const toast = (text, tone = 'info') => {
    const node = document.createElement('div');
    node.textContent = text;
    Object.assign(node.style, {
      position: 'fixed', left: '16px', bottom: '64px', zIndex: 2147483647, padding: '10px 14px',
      borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif', color: '#fff',
      background: tone === 'error' ? '#b42318' : '#1f2937', maxWidth: '460px', whiteSpace: 'pre-wrap',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 12000);
  };

  // 向上滚，等页面自己请求 before=<游标> 的那一页；连续两次没有新消息且已到顶才停。
  const loadAll = async id => {
    const scroller = threadScroller();
    if (!scroller) return { ok: false, reason: '找不到滚动容器', messages: uniqueMessages(id) };
    let previous = uniqueMessages(id);
    let stable = 0;
    for (let round = 0; round < 80; round += 1) {
      const atTop = scroller.scrollTop <= 2;
      if (atTop && stable >= 6) break;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.round(scroller.clientHeight * 1.5));
      await sleep(1400);
      const now = uniqueMessages(id);
      if (now > previous) { previous = now; stable = 0; console.info('[CEOBE] 累计', now, '条'); }
      else stable += 1;
      if (atTop && stable >= 3) await sleep(1500);
    }
    return { ok: true, messages: previous, pages: pages(id).length, atTop: scroller.scrollTop <= 2 };
  };

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

  const capture = async () => {
    const id = currentId();
    if (!id) { toast('当前页面不是会话页', 'error'); return; }
    toast('正在向上加载更早的消息…（约 10–30 秒，页面会自动滚动）');
    const result = await loadAll(id);
    const items = pages(id);
    if (!items.length) {
      toast('没有录到会话页：钩子未在页面加载前就位。请刷新页面后等对话完全显示，再点采集。'
        + '（日志：[CEOBE] 捕获页 …）', 'error');
      console.warn('[CEOBE] 无会话页', { messages: result.messages, scroller: Boolean(threadScroller()) });
      return;
    }
    const payload = {
      kind: 'ceobe.response-capture',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: {
        type: 'chatgpt_web_extension', url: location.href, method: 'scroll-paged',
        pages: items.length, messages: result.messages, atTop: result.atTop,
      },
      responses: items.map(item => ({ url: item.entry.url, text: item.entry.text })),
    };
    const text = JSON.stringify(payload);
    download(text, 'ceobe-responses-' + id.slice(0, 8) + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    toast('已导出 ' + items.length + ' 页 / 去重 ' + result.messages + ' 条（' + Math.round(text.length / 1024) + ' KB）' + (result.atTop ? '，已到顶' : '，未到顶'));
  };

  const mount = () => {
    if (document.getElementById('ceobe-extension-bar')) return;
    const button = document.createElement('button');
    button.id = 'ceobe-extension-bar';
    button.textContent = 'CEOBE 扩展采集';
    Object.assign(button.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647,
      padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff',
      font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)',
    });
    button.addEventListener('click', capture);
    document.body.append(button);
  };

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  console.info('[CEOBE] 扩展版 0.2.2 就绪（滚动分页采集）');
})();