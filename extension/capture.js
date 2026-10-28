// 采集与本地投递的共用逻辑：popup、Service Worker 与 Node 测试都能用（不依赖 DOM）。
import { buildZipBytes, sha256Hex } from './zip.js';

export const CAPTURE_FORMAT = 'ceobe.capture';
export const CAPTURE_VERSION = 1;
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:5173';
export const SHARE_ID_PATTERN = /^https:\/\/chatgpt\.com\/share\/([\w-]+)\/?$/;

export const parseShareUrl = value => {
  const match = SHARE_ID_PATTERN.exec(String(value ?? '').trim());
  return match ? match[1] : null;
};

/** 匿名抓取公开分享页（不带 cookie），返回原始字节、capture.json 与 STORE ZIP。 */
export async function captureShare(url) {
  const shareId = parseShareUrl(url);
  if (!shareId) throw new Error('请输入 https://chatgpt.com/share/<id> 形式的公开链接');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw new Error('抓取失败：HTTP ' + response.status);
  const capturedAt = new Date().toISOString();
  const capture = {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    source_url: url,
    captured_at: capturedAt,
    status: response.status,
    content_type: response.headers.get('content-type'),
    bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    scope: 'Original HTTP HTML response only. Import locally to decode into conversation.ceobe.json; assets are not downloaded by the extension.',
  };
  const zip = buildZipBytes([
    { name: 'raw/share.html', data: bytes },
    { name: 'capture.json', data: JSON.stringify(capture, null, 2) + '\n' },
  ]);
  return {
    shareId,
    bytes: bytes.length,
    capture,
    zip,
    filename: `ceobe-capture-${shareId}-${capturedAt.replace(/[:.]/g, '-')}.zip`,
  };
}

/** POST 采集包到本地服务；错误信息优先用服务端的 JSON error。 */
export async function postPackage(endpoint, zip) {
  const base = String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const response = await fetch(base + '/api/archive-package', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zip,
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* 非 JSON：保留原文 */ }
  if (!response.ok) {
    const error = new Error(data?.error || `本地服务返回 HTTP ${response.status}：${text.slice(0, 160)}`);
    // 服务端可能已经归档、只是页面更新失败；把标记带给 popup / 页内提示。
    if (data?.archived === true) error.archived = true;
    if (data?.retryPublish === true) error.retryPublish = true;
    throw error;
  }
  return { ...data, endpoint: base };
}

/** 依次探测 5173 起的端口（小批并发），返回第一个提供导入能力的本地服务。 */
export async function probeEndpoint({ start = 5173, count = 40, timeoutMs = 900, batch = 8 } = {}) {
  for (let offset = 0; offset < count; offset += batch) {
    const ports = Array.from({ length: Math.min(batch, count - offset) }, (_, index) => start + offset + index);
    const results = await Promise.all(ports.map(async port => {
      const base = `http://127.0.0.1:${port}`;
      try {
        const response = await fetch(base + '/api/capabilities', {
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data?.importShare === true ? base : null;
      } catch { return null; }
    }));
    const hit = results.find(Boolean);
    if (hit) return hit;
  }
  return null;
}
