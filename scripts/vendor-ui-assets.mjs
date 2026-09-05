import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const assets = [{
  url: 'https://cdn.openai.com/common/fonts/openai-sans/v4/OpenAISans-Semibold.woff2',
  filename: 'OpenAISans-Semibold.woff2',
  contentType: 'font/woff2',
}];
const output = resolve('official-assets/cdn/assets');
await mkdir(output, { recursive: true });
for (const asset of assets) {
  const response = await fetch(asset.url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get('content-type') || '').split(';')[0];
  const validWoff2 = asset.contentType === 'font/woff2' && bytes.subarray(0, 4).toString('ascii') === 'wOF2';
  if (!response.ok || !validWoff2 || !bytes.length || bytes.length > 2 * 1024 * 1024) {
    throw new Error(`Invalid UI asset response for ${asset.filename}: HTTP ${response.status}, ${contentType}, ${bytes.length} bytes`);
  }
  await writeFile(resolve(output, asset.filename), bytes);
  console.log(`${asset.filename}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
