// ==UserScript==
// @name         CEOBE 采集器（DOM 版 v0.6）
// @namespace    ceobe.local
// @version      0.6.0
// @description  读取当前会话已渲染的回合并导出为采集包；不调用私有接口、不挂钩子，沙箱内即可运行。
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
//
// 为什么是 DOM：/backend-api/conversation/<id> 已 404，会话不在 React Router 状态里，
// 而沙箱改不到页面 fetch、页面上下文又被 CSP 拦。DOM 是唯一在两种环境下都稳定的来源。
// 代价：拿不到隐藏分支与原始指针，采集包标记为 dom-capture（降级、非权威）。
// 边界：只产出数据，不写 archive/，不做阅读器。

(() => {
  'use strict';

  const MAX_TURN_BYTES = 200 * 1024;
  const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

  const toast = (message, tone = 'info') => {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed', left: '16px', bottom: '16px', zIndex: 2147483647,
      padding: '10px 14px', borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif',
      color: '#fff', background: tone === 'error' ? '#b42318' : '#1f2937',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '380px',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 8000);
  };

  const sleep = (ms) => new Promise(done => setTimeout(done, ms));

  const scroller = () => {
    let best = document.scrollingElement || document.documentElement;
    let range = best.scrollHeight - best.clientHeight;
    for (const element of document.querySelectorAll('div, main, section')) {
      const overflow = getComputedStyle(element).overflowY;
      if (!/auto|scroll/.test(overflow)) continue;
      const candidate = element.scrollHeight - element.clientHeight;
      if (candidate > range + 200) { best = element; range = candidate; }
    }
    return best;
  };

  const collect = async () => {
    const turns = new Map();
    // 分享页用 section[data-testid^=conversation-turn-]，登录页结构不同，这里按候选列表自动探测。
    const candidates = [
      'section[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]',
      'article[data-message-author-role]',
      '[data-message-author-role]',
      '[data-turn-id]',
    ];
    const counts = candidates.map(selector => ({ selector, count: document.querySelectorAll(selector).length }));
    const ranked = [...counts].sort((left, right) => right.count - left.count);
    const turnSelector = (ranked[0] && ranked[0].count) ? ranked[0].selector : candidates[0];
    window.__ceobeTurnCounts = counts;
    console.info('[CEOBE] 回合候选', counts, '→ 使用', turnSelector);
    const grab = () => {
      for (const turn of document.querySelectorAll(turnSelector)) {
        const id = turn.getAttribute('data-turn-id') || turn.getAttribute('data-testid');
        if (!id || turns.has(id)) continue;
        const html = turn.outerHTML;
        if (html.length > MAX_TURN_BYTES) continue;
        turns.set(id, {
          testid: turn.getAttribute('data-testid'),
          turn: turn.getAttribute('data-turn'),
          turnId: id,
          html,
        });
      }
    };
    const box = scroller();
    const range = Math.max(1, box.scrollHeight - box.clientHeight);
    for (let pass = 0; pass < 2; pass += 1) {
      box.scrollTop = 0;
      await sleep(400);
      grab();
      for (let step = 0; step < 200; step += 1) {
        const before = box.scrollTop;
        box.scrollTop = before + Math.round(box.clientHeight * 0.8);
        await sleep(220);
        grab();
        if (box.scrollTop === before) break;
      }
    }
    // 补扫：虚拟化只保留窗口，跳到缺失回合的估算位置再看一眼。
    const index = turn => Number(String(turn.testid || '').split('-').pop()) || 0;
    const maxIndex = Math.max(0, ...[...turns.values()].map(index));
    const has = value => [...turns.values()].some(turn => index(turn) === value);
    let sweeps = 0;
    for (let value = 1; value <= maxIndex && sweeps < 240; value += 1) {
      if (has(value)) continue;
      const target = Math.round(((value - 1) / Math.max(1, maxIndex - 1)) * range);
      for (const delta of [-1, 0, 1]) {
        box.scrollTop = Math.max(0, Math.min(range, target + delta * Math.round(box.clientHeight * 0.7)));
        await sleep(180);
        grab();
        sweeps += 1;
        if (has(value)) break;
      }
    }
    const missing = [];
    for (let value = 1; value <= maxIndex; value += 1) if (!has(value)) missing.push(value);
    return { turns: [...turns.values()], maxIndex, missing };
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

  const conversationId = () => {
    const match = /\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})/i.exec(location.pathname);
    return match ? match[1] : null;
  };

  const capture = async () => {
    const id = conversationId();
    if (!id) { toast('当前页面不是会话页', 'error'); return; }
    toast('正在走查会话（会滚动页面）…');
    let collected;
    try { collected = await collect(); } catch (error) { toast(`走查失败：${error.message}`, 'error'); return; }
    if (!collected.turns.length) {
      const counts = window.__ceobeTurnCounts || [];
      toast('没有找到回合容器；候选计数见控制台（' + counts.map(item => item.selector + '=' + item.count).join('; ').slice(0, 120) + '）', 'error');
      return;
    }

    const payload = {
      kind: 'ceobe.dom-capture',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web_dom', conversation_id: id, url: location.href, method: 'userscript-dom' },
      coverage: {
        collected: collected.turns.length,
        maxTurnIndex: collected.maxIndex,
        missingTurnIndexes: collected.missing.slice(0, 200),
      },
      turns: collected.turns,
    };
    const text = JSON.stringify(payload);
    if (text.length > MAX_TOTAL_BYTES) { toast(`采集包过大（${Math.round(text.length / 1024 / 1024)} MB），已取消`, 'error'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    download(text, `ceobe-dom-${id}-${stamp}.json`);
    toast(`已导出 ${collected.turns.length} 个回合（缺 ${collected.missing.length}）`);
    console.log('[CEOBE] dom capture', payload.coverage);
  };

  const mount = () => {
    const button = document.createElement('button');
    button.textContent = 'CEOBE 采集';
    Object.assign(button.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647,
      padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff',
      font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)',
    });
    button.addEventListener('click', capture);
    document.body.append(button);
  };

  GM_registerMenuCommand('CEOBE：采集当前会话（DOM）', capture);
  window.addEventListener('ceobe-capture', capture);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  console.info('[CEOBE] DOM 采集器 v0.6 就绪');
})();
