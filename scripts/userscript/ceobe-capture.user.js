// ==UserScript==
// @name         CEOBE 采集器（M1 探针）
// @namespace    ceobe.local
// @version      0.1.0
// @description  从你自己的会话里取完整消息树，导出为 CEOBE 采集包；本地服务在跑时可直接投递。
// @match        https://chatgpt.com/c/*
// @match        https://chatgpt.com/g/*/c/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @connect      chatgpt.com
// @run-at       document-idle
// ==/UserScript==
//
// M1 只做三件事：取数、汇总、落盘（下载 JSON）。转换与打包在 M2，直推服务的令牌握手在 M3。
// 设计边界：插件只产出数据，不写 archive/，不做阅读器。

(() => {
  'use strict';

  const LOCAL = 'http://127.0.0.1:5173';
  const TOKEN_KEY = 'ceobe.intake.token';

  const request = (options) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...options,
      timeout: options.timeout ?? 30000,
      onload: result => resolve(result),
      onerror: () => reject(new Error('网络请求失败')),
      ontimeout: () => reject(new Error('请求超时')),
    });
  });

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
      color: '#fff', background: tone === 'error' ? '#b42318' : '#1f2937', boxShadow: '0 6px 24px rgba(0,0,0,.25)',
      maxWidth: '360px',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 6000);
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
      roles[message.author?.role || 'unknown'] = (roles[message.author?.role || 'unknown'] || 0) + 1;
      if (message.metadata?.attachments?.length) attachments += message.metadata.attachments.length;
      if (message.metadata?.content_references?.length) citations += message.metadata.content_references.length;
    }
    const branching = nodes.filter(node => (node.children || []).length > 1).length;
    return { id: conversation.conversation_id, title: conversation.title, nodes: nodes.length, roles, branching, attachments, citations, currentNode: conversation.current_node };
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

  // 本地服务是否在跑：只探测能力声明，不写入任何东西。
  const serviceAlive = async () => {
    try {
      const result = await request({ method: 'GET', url: `${LOCAL}/api/capabilities` });
      return result.status === 200;
    } catch { return false; }
  };

  const capture = async () => {
    const id = conversationId();
    if (!id) { toast('当前页面不是会话页', 'error'); return; }
    toast('正在读取会话数据…');
    let conversation;
    try {
      const result = await request({
        method: 'GET',
        url: `https://chatgpt.com/backend-api/conversation/${id}`,
        headers: { accept: 'application/json' },
        withCredentials: true,
      });
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      conversation = JSON.parse(result.responseText);
    } catch (error) {
      toast(`读取失败：${error.message}（可用分享链接归档作为兜底）`, 'error');
      return;
    }
    const summary = summarize(conversation);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ceobe-${id}-${stamp}.json`;

    if (await serviceAlive()) {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      try {
        const pushed = await request({
          method: 'POST',
          url: `${LOCAL}/api/intake`,
          headers: { 'content-type': 'application/json', 'x-ceobe-token': token },
          data: JSON.stringify({ conversation_id: id, conversation, summary }),
        });
        if (pushed.status === 200 || pushed.status === 202) {
          toast(`已投递到本地项目：${summary.title || id}`);
          return;
        }
        if (pushed.status === 401 || pushed.status === 403) toast('本地服务需要令牌：请在脚本里填入 intake token，已改为下载', 'error');
        else toast(`投递失败（HTTP ${pushed.status}），已改为下载`, 'error');
      } catch { toast('投递失败，已改为下载', 'error'); }
    } else {
      toast('本地服务未运行，下载采集包');
    }

    download(JSON.stringify({
      kind: 'ceobe.intake',
      schema_version: '1.0.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web', conversation_id: id, method: 'userscript-m1', url: location.href },
      summary,
      conversation,
    }, null, 2), filename);
    console.log('[CEOBE] summary', summary);
  };

  GM_registerMenuCommand('CEOBE：采集当前会话', capture);
  window.addEventListener('ceobe-capture', capture);
  console.info('[CEOBE] 采集器已就绪；从 Tampermonkey 菜单或控制台 dispatchEvent(new Event("ceobe-capture")) 触发。');
})();
