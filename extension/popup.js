'use strict';

const status = document.getElementById('status');
const input = document.getElementById('url');
const button = document.getElementById('go');

const say = text => { status.textContent = text; };

// 仅 STORE（不压缩）的最小 ZIP：无扩展依赖，浏览器内可算 CRC。
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();
const crc32 = bytes => {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const buildZip = entries => {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
};

const sha256 = async bytes => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

button.addEventListener('click', async () => {
  const value = input.value.trim();
  const match = /^https:\/\/chatgpt\.com\/share\/([\w-]+)\/?$/.exec(value);
  if (!match) { say('请输入 https://chatgpt.com/share/<id> 形式的公开链接'); return; }
  button.disabled = true;
  say('正在抓取分享页面…');
  try {
    // 匿名抓取：不带 cookie，与本地归档行为一致。
    const response = await fetch(value, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) { say('抓取失败：HTTP ' + response.status); return; }
    const capturedAt = new Date().toISOString();
    const stamp = capturedAt.replace(/[:.]/g, '-');
    const capture = {
      source_url: value,
      captured_at: capturedAt,
      status: response.status,
      content_type: response.headers.get('content-type'),
      bytes: bytes.length,
      sha256: await sha256(bytes),
      scope: 'Original HTTP HTML response only. Import locally to decode into conversation.ceobe.json; assets are not downloaded by the extension.',
    };
    const encoder = new TextEncoder();
    const zip = buildZip([
      { name: 'raw/share.html', data: bytes },
      { name: 'capture.json', data: encoder.encode(JSON.stringify(capture, null, 2) + '\n') },
    ]);
    const url = URL.createObjectURL(zip);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ceobe-capture-' + match[1] + '-' + stamp + '.zip';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say('已导出 ZIP（' + Math.round(bytes.length / 1024) + ' KB）。本地导入见下一步说明。');
  } catch (error) {
    say('抓取失败：' + error.message);
  } finally {
    button.disabled = false;
  }
});