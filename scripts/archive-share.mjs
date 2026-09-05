import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { downloadResources } from './archive-resources.mjs';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';
import { resolveShareResources } from './resolve-share-resources.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'archive-root': { type: 'string' } } });
if (positionals.length !== 1) throw new Error('Usage: npm run archive:share -- <https://chatgpt.com/share/id>');
const url = new URL(positionals[0]);
if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.username || url.password || !/^\/share\/[\w-]+\/?$/.test(url.pathname)) throw new Error('Expected a public ChatGPT share URL');
url.search = ''; url.hash = '';
const shareId = url.pathname.split('/')[2];
const capturedAt = new Date().toISOString();
const folder = join(resolve(values['archive-root'] || 'archive/chatgpt-share'), shareId, capturedAt.replaceAll(':', '-'));
await mkdir(folder, { recursive: true });
await mkdir(join(folder, 'raw'));
const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
const bytes = Buffer.from(await response.arrayBuffer());
await writeFile(join(folder, 'raw', 'share.html'), bytes, { flag: 'wx' });
const capture = { source_url: url.href, captured_at: capturedAt, status: response.status,
  content_type: response.headers.get('content-type'), bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Original HTTP HTML response. Conversation assets are tracked separately in import-report.json; citation websites and application runtime are not mirrored.' };
await writeFile(join(folder, 'capture.json'), JSON.stringify(capture, null, 2), { flag: 'wx' });
if (!response.ok) throw new Error(`HTTP ${response.status}; response preserved in ${folder}`);
const run = spawnSync(process.env.CEOBE_PYTHON || 'python', ['scripts/import-chatgpt-share.py', join(folder, 'raw', 'share.html'),
  '--output', join(folder, 'conversation.ceobe.json'), '--source-url', url.href], { encoding: 'utf8', windowsHide: true });
if (run.status !== 0) {
  await writeFile(join(folder, 'import-error.txt'), run.stderr || String(run.error || 'Import failed'), { flag: 'wx' });
  throw new Error(`Import failed; original response retained in ${folder}: ${run.stderr || run.error}`);
}
const conversation = JSON.parse(await readFile(join(folder, 'conversation.ceobe.json'), 'utf8'));
console.log('Resolving public share attachment URLs in an anonymous browser…');
const resolutions = await resolveShareResources(conversation, url.href);
await writeFile(join(folder, 'raw', 'resource-responses.json'), JSON.stringify(resolutions, null, 2), { flag: 'wx' });
conversation.resources = await downloadResources(conversation, folder, { resolutions });
conversation.import_report.resource_resolution = { responses_file: 'raw/resource-responses.json', errors: resolutions.filter(r => !r.key) };
conversation.import_report.resources = conversation.resources;
conversation.import_report.resource_counts = Object.fromEntries(['downloaded', 'unresolved', 'failed'].map(status =>
  [status, conversation.resources.filter(resource => resource.status === status).length]));
for (const asset of conversation.import_report.assets) {
  const key = asset.id || /(?:sediment:\/\/)([^?]+)/.exec(asset.pointer || '')?.[1] || asset.pointer || asset.name;
  const resource = conversation.resources.find(item => item.key === key);
  asset.local_status = resource?.status || 'unresolved';
  if (resource?.local_path) asset.local_path = resource.local_path;
}
conversation.import_report.complete_offline_archive = conversation.resources.every(resource => resource.status === 'downloaded') &&
  conversation.import_report.status === 'structure_checked';
await writeFile(join(folder, 'conversation.ceobe.json'), JSON.stringify(conversation, null, 2));
await writeFile(join(folder, 'conversation.md'), exportConversationMarkdown(conversation), { flag: 'wx' });
await writeFile(join(folder, 'import-report.json'), JSON.stringify(conversation.import_report, null, 2), { flag: 'wx' });
console.log(run.stdout.trim());
console.log(`Archive: ${folder}\nReport: ${conversation.import_report.status}\nResources: ${JSON.stringify(conversation.import_report.resource_counts)}`);
console.log('Review import-report.json before treating this capture as complete.');
const libraryRun = spawnSync(process.execPath, ['scripts/build-library.mjs'], { encoding: 'utf8', windowsHide: true });
if (libraryRun.status === 0) console.log(libraryRun.stdout.trim());
else console.warn(`Archive saved, but library index update failed: ${libraryRun.stderr || libraryRun.error}`);
