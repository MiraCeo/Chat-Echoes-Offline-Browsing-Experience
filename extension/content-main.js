// CEOBE 采集器（扩展版，MAIN world）——0.7 滚动补齐
(() => {
  'use strict';

  const captured = [];
  const MAX = 40 * 1024 * 1024;
  const interesting = text => Boolean(text) && text.length < MAX && /("messages"\s*:\s*\[|model_dil_v2)/.test(text);
  const parse = text => { try { return JSON.parse(text); } catch { return null; } };
  const sleep = ms => new Promise(done => setTimeout(done, ms));

  const remember = (url, text) => {
    if (!interesting(text)) return;
    if (captured.some(entry => entry.text === text)) return;
    captured.push({ url, text });
    console.info('[CEOBE] 捕获', url.slice(-56), Math.round(text.length / 1024) + ' KB');
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
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '460px', whiteSpace: 'pre-wrap',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 12000);
  };

  const currentId = () => {
    const match = /\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})/i.exec(location.pathname);
    return match ? match[1] : null;
  };

  const messagesFor = id => captured
    .filter(entry => { const parsed = parse(entry.text); return parsed && parsed.conversation_id === id && Array.isArray(parsed.messages); })
    .reduce((sum, entry) => { const parsed = parse(entry.text); const ids = new Set(parsed.messages.map(m => m.id)); ids.forEach(x => sum.add(x)); return sum; }, new Set()).size;

  // 页面自己按需分页：滚到顶部会加载更早的消息，钩子顺带全部录下。
  // 这比伪造 num_turns 请求可靠——不需要猜任何请求头。
  const scrollForMore = async (id, { rounds = 40, step = 0 } = {}) => {
    let best = document.scrollingElement || document.documentElement;
    let range = best.scrollHeight - best.clientHeight;
    for (const element of document.querySelectorAll('div, main, section')) {
      const overflow = getComputedStyle(element).overflowY;
      if (!/auto|scroll/.test(overflow)) continue;
      const candidate = element.scrollHeight - element.clientHeight;
      if (candidate > range + 200) { best = element; range = candidate; }
    }
    let previous = messagesFor(id);
    let stagnant = 0;
    for (let round = 0; round < rounds && stagnant < 3; round += 1) {
      best.scrollTop = Math.max(0, best.scrollTop - Math.max(300, Math.round(best.clientHeight * 0.9)));
      await sleep(700);
      const now = messagesFor(id);
      if (now > previous) { previous = now; stagnant = 0; } else stagnant += 1;
      if (best.scrollTop <= 0) { await sleep(900); if (messagesFor(id) === previous) stagnant += 1; }
    }
    return { messages: previous, scrollTop: best.scrollTop, atTop: best.scrollTop <= 4 };
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
    const before = messagesFor(id);
    toast('正在向上滚动补齐历史…（当前 ' + before + ' 条）');
    const result = await scrollForMore(id);
    const found = captured.filter(entry => { const parsed = parse(entry.text); return parsed && parsed.conversation_id === id && Array.isArray(parsed.messages); });
    if (!found.length) { toast('还没录到会话：刷新页面后再点一次', 'error'); return; }
    const payload = {
      kind: 'ceobe.response-capture',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web_extension', url: location.href, method: 'fetch-hook+scroll', responses: found.length, messages: result.messages, atTop: result.atTop },
      responses: found.map(entry => ({ url: entry.url, text: entry.text })),
    };
    const text = JSON.stringify(payload);
    download(text, 'ceobe-responses-' + id.slice(0, 8) + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    toast('已导出 ' + found.length + ' 个响应，去重消息 ' + result.messages + ' 条（' + Math.round(text.length / 1024) + ' KB）' + (result.atTop ? '' : '；未滚到顶，可能仍有更早消息'));
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
  console.info('[CEOBE] 扩展版 0.7 就绪（滚动补齐）');
})();