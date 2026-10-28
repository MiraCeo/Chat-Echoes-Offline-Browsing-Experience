// MV3 Service Worker：抓取在扩展上下文里做（不受分享页 CSP 限制），页面内按钮与 popup 的直连都走这里。
// 注意：扩展消息是 JSON 序列化，不要在这里把 ZIP 字节回传给 popup（会变成普通对象）；
// ZIP 下载由 popup 自己抓取并生成，这里只负责直连发送。
import { captureShare, postPackage, probeEndpoint, DEFAULT_ENDPOINT } from './capture.js';

const ENDPOINT_KEY = 'ceobe.endpoint';
const savedEndpoint = async () => (await chrome.storage.local.get(ENDPOINT_KEY))[ENDPOINT_KEY] || DEFAULT_ENDPOINT;
const validEndpoint = value => /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(String(value || ''));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    if (message?.type === 'ceobe:capture') {
      const captured = await captureShare(message.url);
      const endpoint = message.endpoint && validEndpoint(message.endpoint) ? message.endpoint : await savedEndpoint();
      const result = await postPackage(endpoint, captured.zip);
      return { ok: true, mode: 'post', shareId: captured.shareId, endpoint, result };
    }
    if (message?.type === 'ceobe:probe') {
      const endpoint = await probeEndpoint();
      if (endpoint) await chrome.storage.local.set({ [ENDPOINT_KEY]: endpoint });
      return { ok: Boolean(endpoint), endpoint };
    }
    if (message?.type === 'ceobe:save-endpoint') {
      if (!validEndpoint(message.endpoint)) return { ok: false, error: '本地地址只支持 http://127.0.0.1:<端口> 或 http://localhost:<端口>' };
      await chrome.storage.local.set({ [ENDPOINT_KEY]: message.endpoint });
      return { ok: true, endpoint: message.endpoint };
    }
    if (message?.type === 'ceobe:endpoint') return { ok: true, endpoint: await savedEndpoint() };
    return { ok: false, error: '未知操作' };
  };
  run().then(sendResponse, error => sendResponse({
    ok: false,
    error: error?.message || String(error),
    archived: error?.archived === true,
    retryPublish: error?.retryPublish === true,
  }));
  return true;
});
