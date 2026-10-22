import { mkdir, writeFile, readFile, rm, rmdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { downloadResources, resourceMatches } from './archive-resources.mjs';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';
import { resolveShareResources } from './resolve-share-resources.mjs';
import { assertSnapshotTarget, formatSnapshotPlan, planSnapshot } from './archive-guard.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'archive-root': { type: 'string' }, 'skip-library': { type: 'boolean', default: false }, 'keep-failed': { type: 'boolean', default: false } } });
if (positionals.length !== 1) throw new Error('Usage: npm run archive:share -- <https://chatgpt.com/share/id>');
const url = new URL(positionals[0]);
if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.username || url.password || !/^\/share\/[\w-]+\/?$/.test(url.pathname)) throw new Error('Expected a public ChatGPT share URL');
url.search = ''; url.hash = '';
const shareId = url.pathname.split('/')[2];
const capturedAt = new Date().toISOString();
// 导入耗时分解：每步记一次，结束时打印，便于回答"几分钟花在哪"。
const timing = { started: Date.now(), marks: [] };
const mark = name => { timing.marks.push([name, Date.now() - timing.started]); };
// Dry run first: the plan is printed and the target must be a fresh snapshot inside the archive.
const snapshotRoot = resolve(values['archive-root'] || 'archive/chatgpt-share');
const plan = planSnapshot({ shareId, capturedAt, snapshotRoot });
await assertSnapshotTarget(plan.dir, { snapshotRoot });
console.log(formatSnapshotPlan(plan));
const folder = plan.dir;
// 先取回页面再落盘：取不到就不该在 archive/ 里留下空快照。
// chatgpt.com 偶尔在 TLS 握手阶段被重置（ECONNRESET），重试几次比直接失败合理。
const fetchWithRetry = async (target, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch (error) {
      lastError = error;
      const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket disconnected|fetch failed/i
        .test(`${error.message} ${error.cause?.code || ''} ${error.cause?.message || ''}`);
      if (!transient || attempt === attempts) break;
      console.warn(`抓取失败（第 ${attempt}/${attempts} 次）：${error.cause?.code || error.message}，${attempt}s 后重试…`);
      await new Promise(done => setTimeout(done, attempt * 1000));
    }
  }
  throw lastError;
};
const response = await fetchWithRetry(url);
const bytes = Buffer.from(await response.arrayBuffer());
mark('fetched');
await mkdir(folder, { recursive: true });
await mkdir(join(folder, 'raw'));
await writeFile(join(folder, 'raw', 'share.html'), bytes, { flag: 'wx' });
const capture = { source_url: url.href, captured_at: capturedAt, status: response.status,
  content_type: response.headers.get('content-type'), bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Original HTTP HTML response. Conversation assets are tracked separately in import-report.json; citation websites and application runtime are not mirrored.' };
await writeFile(join(folder, 'capture.json'), JSON.stringify(capture, null, 2), { flag: 'wx' });
// 失败时默认不留快照：假链接或失效链接不该在档案里占位。需要排查时加 --keep-failed。
const keepFailed = values['keep-failed'] === true;
const discard = async error => {
  if (keepFailed) return null;
  await rm(folder, { recursive: true, force: true });
  // 连空的 <会话 id> 目录一起收掉，别在 archive/ 里留下无快照的壳。
  try { await rmdir(dirname(folder)); } catch { /* 非空或被占用则保留 */ }
  return new Error(`${error.message}（未保留快照；加 --keep-failed 可保留原始页面便于排查）`);
};
if (!response.ok) {
  const error = await discard(new Error(`HTTP ${response.status}`));
  if (error) throw error;
  throw new Error(`HTTP ${response.status}; response preserved in ${folder}`);
}
const run = spawnSync(process.env.CEOBE_PYTHON || 'python', ['scripts/import-chatgpt-share.py', join(folder, 'raw', 'share.html'),
  '--output', join(folder, 'conversation.ceobe.json'), '--source-url', url.href], { encoding: 'utf8', windowsHide: true });
if (run.status !== 0) {
  const failure = new Error(run.stderr || String(run.error || 'Import failed'));
  const error = await discard(failure);
  if (error) throw error;
  await writeFile(join(folder, 'import-error.txt'), failure.message, { flag: 'wx' });
  throw new Error(`Import failed; original response retained in ${folder}: ${failure.message}`);
}
mark('decoded');
const conversation = JSON.parse(await readFile(join(folder, 'conversation.ceobe.json'), 'utf8'));
console.log('Resolving public share attachment URLs in an anonymous browser…');
mark('canonical-written');
const resolutions = await resolveShareResources(conversation, url.href);
mark('resources-resolved');
await writeFile(join(folder, 'raw', 'resource-responses.json'), JSON.stringify(resolutions, null, 2), { flag: 'wx' });
conversation.resources = await downloadResources(conversation, folder, { resolutions });
mark('resources-downloaded');
conversation.import_report.resource_resolution = { responses_file: 'raw/resource-responses.json', errors: resolutions.filter(r => !r.key) };
conversation.import_report.resources = conversation.resources;
conversation.import_report.resource_counts = Object.fromEntries(['downloaded', 'unresolved', 'failed'].map(status =>
  [status, conversation.resources.filter(resource => resource.status === status).length]));
for (const asset of conversation.import_report.assets) {
  const resource = conversation.resources.find(item => resourceMatches(item, asset));
  asset.local_status = resource?.status || 'unresolved';
  if (resource?.local_path) asset.local_path = resource.local_path;
}
conversation.import_report.complete_offline_archive = conversation.resources.every(resource => resource.status === 'downloaded') &&
  conversation.import_report.status === 'structure_checked' &&
  conversation.completeness?.structured_payload?.status === 'usable';
mark('files-written');
await writeFile(join(folder, 'conversation.ceobe.json'), JSON.stringify(conversation, null, 2));
await writeFile(join(folder, 'conversation.md'), exportConversationMarkdown(conversation, { timestamps: true }), { flag: 'wx' });
await writeFile(join(folder, 'import-report.json'), JSON.stringify(conversation.import_report, null, 2), { flag: 'wx' });
console.log(run.stdout.trim());
console.log(`Archive: ${folder}\nReport: ${conversation.import_report.status}\nResources: ${JSON.stringify(conversation.import_report.resource_counts)}`);
console.log('Review import-report.json before treating this capture as complete.');
if (!values['skip-library']) {
const libraryRun = spawnSync(process.execPath, ['scripts/build-library.mjs'], { encoding: 'utf8', windowsHide: true });
if (libraryRun.status === 0) console.log(libraryRun.stdout.trim());
else console.warn(`Archive saved, but library index update failed: ${libraryRun.stderr || libraryRun.error}`);
mark('library-rebuilt');
console.log('Timing: ' + timing.marks.map(([name, ms]) => `${name}=${(ms / 1000).toFixed(1)}s`).join(' ')
  + ` total=${((Date.now() - timing.started) / 1000).toFixed(1)}s`);
}
