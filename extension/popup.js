import { parseShareUrl, captureShare, DEFAULT_ENDPOINT } from './capture.js';

const urlInput = document.getElementById('url');
const endpointInput = document.getElementById('endpoint');
const sendButton = document.getElementById('send');
const zipButton = document.getElementById('zip');
const probeButton = document.getElementById('probe');
const status = document.getElementById('status');
const ENDPOINT_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/;

const say = (text, state = 'idle') => { status.dataset.state = state; status.textContent = text; };
const setBusy = busy => { for (const button of [sendButton, zipButton, probeButton]) button.disabled = busy; };
const savedEndpoint = async () => {
  try { return (await chrome.runtime.sendMessage({ type: 'ceobe:endpoint' }))?.endpoint || DEFAULT_ENDPOINT; }
  catch { return DEFAULT_ENDPOINT; }
};

async function prefill() {
  endpointInput.value = await savedEndpoint();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && parseShareUrl(tab.url)) urlInput.value = tab.url;
  } catch { /* 没有 tabs 权限时读不到当前地址，用户手填即可 */ }
  urlInput.focus();
  if (urlInput.value) urlInput.select();
}

function downloadZip(zip, filename) {
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function run(deliver) {
  const url = urlInput.value.trim();
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  if (!parseShareUrl(url)) { say('请输入 https://chatgpt.com/share/<id> 形式的公开链接', 'error'); return; }
  if (deliver === 'post' && !ENDPOINT_PATTERN.test(endpoint)) {
    say('本地地址只支持 http://127.0.0.1:<端口> 或 http://localhost:<端口>', 'error');
    return;
  }
  setBusy(true);
  say(deliver === 'post' ? '正在匿名抓取并发送到本地 CEOBE…' : '正在匿名抓取分享页…');
  try {
    // 不要在 popup 与 Service Worker 之间传 ZIP 字节：扩展消息是 JSON 序列化，
    // Uint8Array 会变成普通对象，Blob 随即退化成 "[object Object]"（15 字节，实测踩过）。
    // ZIP 下载直接在 popup 里抓取并生成；直连发送仍由 Service Worker 完成。
    if (deliver === 'zip') {
      const captured = await captureShare(url);
      downloadZip(captured.zip, captured.filename);
      say(`已导出 ${Math.round(captured.bytes / 1024)} KB 的 ZIP。把它拖到本地导入页即可。`, 'success');
      return;
    }
    await chrome.runtime.sendMessage({ type: 'ceobe:save-endpoint', endpoint });
    const response = await chrome.runtime.sendMessage({ type: 'ceobe:capture', url, deliver, endpoint });
    if (!response?.ok) {
      const error = new Error(response?.error || '操作失败');
      if (response?.archived) error.archived = true;
      throw error;
    }
    const result = response.result || {};
    const page = result.page ? response.endpoint + result.page : '';
    status.dataset.state = 'success';
    status.replaceChildren(document.createTextNode(`已归档「${result.title || result.shareId || ''}」，${result.turnCount ?? '?'} 轮对话。`));
    if (page) {
      const link = document.createElement('a');
      link.href = page; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '打开会话';
      status.append(' ', link);
    }
  } catch (error) {
    const hint = error?.archived
      ? '\n采集包已经归档，只是页面没更新；运行 npm run library 或再次发送（不会重复导入）。'
      : '\n请确认本地 CEOBE 已启动（npm run dev），端口与上面一致。';
    say('失败：' + (error?.message || error) + hint, 'error');
  } finally {
    setBusy(false);
  }
}

sendButton.addEventListener('click', () => run('post'));
zipButton.addEventListener('click', () => run('zip'));
probeButton.addEventListener('click', async () => {
  setBusy(true);
  say('正在探测 5173 起的本地服务…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ceobe:probe' });
    if (!response?.ok) { say('没找到本地服务。请先运行 npm run dev；若端口不同，请在上面的输入框里填实际地址。', 'error'); return; }
    endpointInput.value = response.endpoint;
    say('已找到：' + response.endpoint, 'success');
  } finally {
    setBusy(false);
  }
});
urlInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) run('post'); });
prefill();
