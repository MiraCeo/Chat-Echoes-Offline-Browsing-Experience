import assert from 'node:assert/strict';
import { readZip, CAPTURE_PACKAGE_FORMAT, CAPTURE_PACKAGE_VERSION, validateCapturePackage } from './import-share-package.mjs';
import { buildZipBytes } from '../extension/zip.js';
import { parseShareUrl } from '../extension/capture.js';

// 采集包契约：扩展写（extension/zip.js + capture.js），本地导入读（import-share-package.mjs）。
// 这里不跑 Python 解码器、不联网，只验证 ZIP 往返与 format/version 握手。
const encoder = new TextEncoder();
const capture = {
  format: CAPTURE_PACKAGE_FORMAT,
  version: CAPTURE_PACKAGE_VERSION,
  source_url: 'https://chatgpt.com/share/11111111-1111-4111-8111-111111111111',
  captured_at: '2026-01-01T00:00:00.000Z',
  status: 200,
  content_type: 'text/html; charset=utf-8',
  bytes: 5,
  sha256: '0'.repeat(64),
};
const html = '<html>ok</html>';

const zip = buildZipBytes([
  { name: 'raw/share.html', data: encoder.encode(html) },
  { name: 'capture.json', data: JSON.stringify(capture, null, 2) + '\n' },
]);
assert.ok(zip instanceof Uint8Array && zip.length > 0, 'zip.js returns raw bytes');
assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'local file header signature');

const entries = readZip(zip);
assert.deepEqual([...entries.keys()].sort(), ['capture.json', 'raw/share.html']);
assert.equal(new TextDecoder().decode(entries.get('raw/share.html')), html, 'payload round-trips unchanged');
const parsed = JSON.parse(new TextDecoder().decode(entries.get('capture.json')));
assert.deepEqual(parsed, capture);
assert.deepEqual(validateCapturePackage(parsed), { format: CAPTURE_PACKAGE_FORMAT, version: CAPTURE_PACKAGE_VERSION, legacy: false });

// 旧版扩展（0.4.x）没有 format/version：按 legacy 接受，不能拒收。
assert.equal(validateCapturePackage({ source_url: capture.source_url }).legacy, true);
assert.equal(validateCapturePackage({ format: CAPTURE_PACKAGE_FORMAT }).version, 0, 'a missing version is treated as legacy');

// 未知格式、未来版本、非法版本都要有明确报错。
assert.throws(() => validateCapturePackage({ format: 'other.capture', version: 1 }), /不认识的采集包格式/);
assert.throws(() => validateCapturePackage({ format: CAPTURE_PACKAGE_FORMAT, version: CAPTURE_PACKAGE_VERSION + 1 }), /高于本地支持的/);
assert.throws(() => validateCapturePackage({ format: CAPTURE_PACKAGE_FORMAT, version: '1' }), /版本无效/);
assert.throws(() => validateCapturePackage(null), /不是有效对象/);

// 分享链接解析与扩展、本地导入两边保持一致。
assert.equal(parseShareUrl(capture.source_url), '11111111-1111-4111-8111-111111111111');
assert.equal(parseShareUrl('https://chatgpt.com/share/abc/?x=1'), null, 'query strings are rejected like the importer');
assert.equal(parseShareUrl('https://example.com/share/abc'), null);
assert.equal(parseShareUrl(''), null);

// 损坏的 ZIP 不会静默产出半个包：读不出条目，CLI 随后用明确的 missing 提示拒绝。
assert.equal(readZip(new Uint8Array([1, 2, 3, 4])).size, 0, 'a non-zip package yields no entries');
console.log('PASS share package: STORE zip round-trip, format/version handshake (legacy/wrong/future/invalid), share URL parsing, corrupt package rejected');
