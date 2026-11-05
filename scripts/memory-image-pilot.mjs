#!/usr/bin/env node
/**
 * Pick content-bearing images for the description pilot.
 *
 * Decorative images (avatars, icons, tiny crops) are filtered by pixel size;
 * the rest are spread across sessions so the sample is not dominated by one
 * conversation. Output is a JSON list with the image path and the message text
 * it was attached to, so a vision pass has context.
 *
 *   node scripts/memory-image-pilot.mjs --limit 50 --out data/private/memory-kernel/image-pilot-50.json
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');

/** PNG/JPEG pixel size from the header; null when unknown. */
export function imageSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

/** A screenshot has real area and is not a square avatar. */
export function isContentBearing(size, bytes) {
  if (!size) return false;
  const { width, height } = size;
  if (width < 400 || height < 300) return false;
  if (width === height && width < 600) return false;
  return bytes.length >= 30 * 1024;
}

export async function pickImages(root, { limit = 50 } = {}) {
  const assets = JSON.parse(await readFile(join(root, 'replay/public/assets-index.json'), 'utf8'));
  const images = assets.filter(asset => asset.kind === 'image' && asset.download);
  const candidates = [];
  for (const asset of images) {
    const path = join(root, 'replay/public', asset.download.replace('./', ''));
    let bytes;
    try { bytes = await readFile(path); } catch { continue; }
    const size = imageSize(bytes);
    if (!isContentBearing(size, bytes)) continue;
    candidates.push({ asset, path, size, bytes: bytes.length });
  }
  // Spread across sessions: round-robin so one conversation cannot dominate.
  const bySession = new Map();
  for (const item of candidates) {
    const title = item.asset.sources?.[0]?.title || '?';
    if (!bySession.has(title)) bySession.set(title, []);
    bySession.get(title).push(item);
  }
  const queues = [...bySession.values()].sort((a, b) => b.length - a.length);
  const picked = [];
  while (picked.length < limit && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      if (picked.length >= limit) break;
      if (queue.length) picked.push(queue.shift());
    }
  }
  return picked;
}

/** The message text an image was attached to. */
async function messageFor(root, asset) {
  const source = asset.sources?.[0];
  if (!source) return '';
  const dir = join(root, 'archive/chatgpt-share', source.id);
  let conversation = null;
  try {
    for (const sub of await readdir(dir)) {
      try { conversation = JSON.parse(await readFile(join(dir, sub, 'conversation.ceobe.json'), 'utf8')); break; }
      catch { /* try the next capture */ }
    }
  } catch { return ''; }
  for (const message of Object.values(conversation?.messages || {})) {
    const hit = (message.attachments || []).some(item => item.name === asset.name || item.id === asset.id);
    if (!hit) continue;
    const blocks = message.content?.blocks || [];
    return blocks.filter(block => block.type === 'text').map(block => block.text).join(' ').trim()
      || String(message.content?.text || '').trim();
  }
  return '';
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const root = resolve(option('--root') || projectRoot);
  const limit = Number(option('--limit') || 50);
  const out = resolve(option('--out') || join(root, 'data/private/memory-kernel/image-pilot-50.json'));
  const picked = await pickImages(root, { limit });
  const list = [];
  for (const item of picked) {
    list.push({
      name: item.asset.name,
      path: item.path,
      session: item.asset.sources?.[0]?.title || null,
      width: item.size.width,
      height: item.size.height,
      bytes: item.bytes,
      message: (await messageFor(root, item.asset)).slice(0, 300),
    });
  }
  await writeFile(out, JSON.stringify(list, null, 2) + '\n', 'utf8');
  console.log(`内容型图片：${list.length} 张`);
  const bySession = {};
  for (const item of list) bySession[item.session] = (bySession[item.session] || 0) + 1;
  for (const [session, count] of Object.entries(bySession)) console.log(`  ${session}: ${count}`);
  console.log(`已写入 ${out}`);
}
