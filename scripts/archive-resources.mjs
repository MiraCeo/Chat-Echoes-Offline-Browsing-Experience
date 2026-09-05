import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { createHash } from 'node:crypto';

const hosts = ['chatgpt.com', 'oaiusercontent.com', 'oaistatic.com', 'oaidalleapiprodscus.blob.core.windows.net'];
export function allowedAssetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      hosts.some(host => url.hostname === host || (host !== hosts.at(-1) && url.hostname.endsWith('.' + host)));
  } catch { return false; }
}
export function assetKey(asset) {
  return asset.id || /(?:sediment:\/\/)([^?]+)/.exec(asset.pointer || '')?.[1] || asset.pointer || asset.download_url || asset.file_url || asset.url || asset.name;
}
export function collectResources(conversation) {
  const resources = new Map();
  for (const [messageId, message] of Object.entries(conversation.messages)) {
    const assets = [...(message.attachments || []), ...(message.content?.blocks || []).filter(b => b.type === 'asset')];
    for (const asset of assets) {
      const key = assetKey(asset);
      if (!key) continue;
      const entry = resources.get(key) || { key, name: asset.name || asset.filename || key, mime_type: asset.mime_type || null, message_ids: [], pointers: [], candidate_urls: [], status: 'unresolved' };
      if (!entry.message_ids.includes(messageId)) entry.message_ids.push(messageId);
      if (asset.pointer && !entry.pointers.includes(asset.pointer)) entry.pointers.push(asset.pointer);
      for (const url of [asset.download_url, asset.file_url, asset.url, asset.pointer]) {
        if (/^https?:\/\//.test(url || '') && !entry.candidate_urls.includes(url)) entry.candidate_urls.push(url);
      }
      resources.set(key, entry);
    }
  }
  return [...resources.values()];
}

export async function downloadResources(conversation, folder, { fetcher = fetch, maxBytes = 100 * 1024 * 1024, resolutions = [] } = {}) {
  const resources = collectResources(conversation);
  await mkdir(resolve(folder, 'assets'), { recursive: true });
  for (const resource of resources) {
    const resolution = resolutions.find(item => item.key === resource.key);
    if (resolution) resource.resolution = resolution;
    if (resolution?.data?.download_url) resource.candidate_urls.push(resolution.data.download_url);
    resource.attempts = [];
    resource.reason = resolution?.data?.error_code || resolution?.error || 'Source contains an internal pointer but no downloadable URL; original metadata retained.';
    for (const candidate of resource.candidate_urls) {
      let url = candidate;
      try {
        let response;
        for (let redirects = 0; ; redirects++) {
          if (!allowedAssetUrl(url)) throw new Error('Asset URL blocked by host/protocol policy');
          response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
          if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            await response.body?.cancel();
            if (redirects >= 4) throw new Error('Too many redirects');
            url = new URL(response.headers.get('location'), url).href;
            continue;
          }
          break;
        }
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!response.ok || /^(text\/html|application\/xhtml\+xml)$/.test(mime) || Number(response.headers.get('content-length')) > maxBytes) {
          await response.body?.cancel();
          throw new Error(`Invalid asset response: HTTP ${response.status}, ${mime}`);
        }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > maxBytes) throw new Error('Asset exceeds download size limit');
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (!bytes.length) throw new Error('Empty asset response');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const extension = /^\.[a-z0-9]{1,8}$/i.test(extname(resource.name)) ? extname(resource.name).toLowerCase() :
          ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf', 'text/plain': '.txt' }[mime] || '.bin');
        resource.local_path = `assets/${sha256}${extension}`;
        await writeFile(resolve(folder, resource.local_path), bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        Object.assign(resource, { status: 'downloaded', sha256, bytes: size, mime_type: mime || resource.mime_type, downloaded_from: url });
        delete resource.reason;
        break;
      } catch (error) { resource.attempts.push({ url: candidate, error: error.message }); resource.status = 'failed'; resource.reason = error.message; }
    }
  }
  return resources;
}

export async function readArchivedResource(folder, resource) {
  if (!/^assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(resource.local_path || '')) throw new Error('Invalid archived resource path');
  const root = await realpath(folder);
  const path = await realpath(resolve(root, resource.local_path));
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Resource escapes archive directory');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== resource.sha256) throw new Error('Archived resource checksum mismatch');
  return bytes;
}
