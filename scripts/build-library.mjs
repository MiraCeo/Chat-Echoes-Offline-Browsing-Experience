import { localizeGeneratedFonts } from './local-katex-fonts.mjs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { buildImportPage } from './build-import-page.mjs';
import { buildAssetLibrary } from './build-asset-library.mjs';
import { buildBookmarks } from './build-bookmarks.mjs';
import { buildReaderUI } from './build-reader-ui.mjs';
import { buildChatOrganizer } from './build-chat-organizer.mjs';
import { buildSidebarControls } from './build-sidebar-controls.mjs';
import { writeSearchIndex } from './search-index.mjs';
import { buildProjectDetail } from './build-project-detail.mjs';
import { buildProjectsPage } from './build-projects-page.mjs';
import { buildChatMenu } from './build-chat-menu.mjs';
import { createPageCache } from './page-cache.mjs';
import { buildChatActions } from './build-chat-actions.mjs';
import { readChatMetadata } from './chat-store.mjs';
import { writeChatIndexMarkdown } from './chat-index-markdown.mjs';
import { conversationCounts } from './conversation-to-html-view.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const archiveRoot = join(projectRoot, 'archive', 'chatgpt-share');
const indexPath = join(projectRoot, 'archive', 'library.ceobe.json');

const posixRelative = path => relative(projectRoot, path).replaceAll('\\', '/');

export async function buildLibraryIndex() {
  const conversations = [];
  await mkdir(archiveRoot, { recursive: true });
  // 分享抓取与登录态采集分目录存放，索引把两者一起收进来。
  const archiveRoots = [archiveRoot, join(projectRoot, "archive", "chatgpt-web")];
  for (const root of archiveRoots) {
  try { await mkdir(root, { recursive: true }); } catch {}
  for (const share of await readdir(root, { withFileTypes: true })) {
    if (!share.isDirectory() || !/^[\w-]+$/.test(share.name)) continue;
    const shareRoot = join(root, share.name);
    const captures = (await readdir(shareRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
    for (const captureName of captures) {
      const conversationPath = join(shareRoot, captureName, 'conversation.ceobe.json');
      try {
        const conversation = JSON.parse(await readFile(conversationPath, 'utf8'));
        if (conversation.kind !== 'ceobe.conversation' || typeof conversation.title !== 'string') continue;
        const counts = conversation.import_report?.resource_counts || {};
        const messageCounts = conversationCounts(conversation);
        conversations.push({
          id: share.name,
          title: conversation.title,
          source_type: conversation.source?.type || 'chatgpt_share',
          source_url: conversation.source?.url || null,
          captured_at: conversation.source?.captured_at || captureName,
          created_at: conversation.created_at || null,
          updated_at: conversation.updated_at || null,
          // `message_count` keeps its historical meaning (every archived record on
          // the linear path) for existing consumers; `turn_count` is what the
          // reader displays as conversation bubbles.
          message_count: messageCounts.records,
          turn_count: messageCounts.turns,
          user_turn_count: messageCounts.user_turns,
          assistant_turn_count: messageCounts.assistant_turns,
          resource_counts: { downloaded: counts.downloaded || 0, unresolved: counts.unresolved || 0, failed: counts.failed || 0 },
          import_status: conversation.import_report?.status || 'unknown',
          structured_payload_status: conversation.completeness?.structured_payload?.status || 'unknown',
          rendered_dom_status: conversation.completeness?.rendered_dom?.status || 'unknown',
          complete_offline_archive: conversation.import_report?.complete_offline_archive === true,
          conversation_path: posixRelative(conversationPath),
          page: `./conversations/${share.name}.html`,
        });
        break;
      } catch { /* Failed or partial captures remain archived but do not replace the latest usable capture. */ }
    }
  }
  }
  const meta=await readChatMetadata(projectRoot);
  for(const c of conversations)Object.assign(c,meta.items[c.id]||{});
  conversations.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  const library = { schema_version: '1.0.0', kind: 'ceobe.library', generated_at: new Date().toISOString(), conversations };
  await writeFile(indexPath, JSON.stringify(library, null, 2));
  // Human-readable companion of the JSON index, kept next to the ID-named folders it describes.
  await writeChatIndexMarkdown(projectRoot, conversations, { generatedAt: library.generated_at });
  return library;
}

// 增量构建：页面没变就不重新渲染。渲染输入 = canonical 文件内容 + 渲染器/模板的文件清单指纹。
// 指纹包含文件名、大小与修改时间，任何脚本或模板改动都会让全部页面重建一次。
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const stampFile = join(projectRoot, 'data/private/library-stamps.json');
async function rendererStamp() {
  // 用文件内容而非修改时间：删除流程会把脚本复制到暂存目录，mtime 会变，
  // 那样指纹必然不同、每次删除都退化成全量渲染。
  const roots = [join(projectRoot, 'scripts'), join(projectRoot, 'official-templates')];
  const parts = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(mjs|js|json|html|css)$/.test(entry.name)) continue;
      const full = join(entry.parentPath || entry.path, entry.name);
      parts.push(`${entry.name}:${hashBytes(await readFile(full))}`);
    }
  }
  parts.sort();
  return hashBytes(parts.join('|'));
}

const exists = async path => { try { await stat(path); return true; } catch { return false; } };

// 索引类步骤的耗时（用于判断增量构建剩下的时间花在哪）。
const stepTiming = [];
const step = async (name, fn) => { const started = Date.now(); const value = await fn(); stepTiming.push([name, Date.now() - started]); return value; };

// 页面渲染相互独立，可以并行；共享资源（字体、sprites、模板资产）由第一张页面负责拷贝一次，
// 其余子进程用 --skip-shared-assets 只写自己的页面，避免并发覆盖同一批文件。
const runAsync = (entry, output, extra = []) => new Promise((done, fail) => {
  const args = ['scripts/build-official-replay.mjs', '--input', entry.conversation_path, '--output-page', output,
    '--library', posixRelative(indexPath), '--entry-id', entry.id, '--preserve-output', ...extra];
  const child = spawn(process.execPath, args, { cwd: projectRoot, windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.on('error', fail);
  child.on('close', code => (code === 0 ? done() : fail(new Error(stderr || `Failed to build ${entry.title}`))));
});

/** 以固定并发跑一组任务；第一个任务单独跑，负责共享资源。 */
const runPool = async (entries, limit, extraForAll = []) => {
  const queue = [...entries];
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      await runAsync(entry, join('replay', 'conversations', `${entry.id}.html`), extraForAll);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, entries.length)) }, worker));
};

async function buildReader(library, selectedId, onlyIds = null) {

  const run = (entry, output, preserve) => {
    const args = ['scripts/build-official-replay.mjs', '--input', entry.conversation_path, '--output-page', output,
      '--library', posixRelative(indexPath), '--entry-id', entry.id];
    if (preserve) args.push('--preserve-output');
    const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Failed to build ${entry.title}`);
    process.stdout.write(result.stdout);
  };
  // Single-page refresh: pages depend on the current library index, the shared bundles do not. Useful
  // while iterating on the renderer or after editing one archive; every other page is left alone.
  if (onlyIds?.length) {
    const missing = onlyIds.filter(id => !library.conversations.some(entry => entry.id === id));
    if (missing.length) throw new Error(`档案库中没有这些会话：${missing.join(', ')}`);
    await mkdir(join(projectRoot, 'replay/conversations'), { recursive: true });
    for (const id of onlyIds) {
      const entry = library.conversations.find(item => item.id === id);
      run(entry, join('replay', 'conversations', `${entry.id}.html`), true);
    }
    console.log(`Rebuilt ${onlyIds.length} conversation page(s); the home page and shared bundles were left untouched.`);
    return;
  }
  const selected = library.conversations.find(item => item.id === selectedId) || library.conversations[0];
  if(selected)run(selected, join('replay', 'index.html'), true);
  else {
    const empty=JSON.parse(await readFile(join(projectRoot,'samples/empty-conversation.json'),'utf8'));empty.title='本地聊天';
    await mkdir(join(projectRoot,'data/private'),{recursive:true});await writeFile(join(projectRoot,'data/private/empty-reader.ceobe.json'),JSON.stringify(empty));
    run({id:'empty',title:empty.title,conversation_path:'data/private/empty-reader.ceobe.json'},join('replay','index.html'),false);
  }
  await mkdir(join(projectRoot,'replay/conversations'),{recursive:true});
  const renderer = await rendererStamp();
  let previous = {};
  try { previous = JSON.parse(await readFile(stampFile, 'utf8')); } catch { /* 首次构建 */ }
  const next = {};
  const keep = new Set(library.conversations.map(entry => `${entry.id}.html`));
  for (const name of await readdir(join(projectRoot, 'replay', 'conversations')).catch(() => [])) {
    if (name.endsWith('.html') && !keep.has(name)) await rm(join(projectRoot, 'replay', 'conversations', name), { force: true });
  }
  let rebuilt = 0;
  const pending = [];
  for (const entry of library.conversations) {
    const page = join(projectRoot, 'replay', 'conversations', `${entry.id}.html`);
    const source = hashBytes(await readFile(entry.conversation_path));
    const stamp = `${source}:${renderer}`;
    next[entry.id] = stamp;
    if (previous[entry.id] === stamp && await exists(page)) continue;
    pending.push(entry);
  }
  if (pending.length) {
    // 第一页顺带把共享资产拷好，其余并行且跳过共享拷贝。
    const [first, ...rest] = pending;
    await runAsync(first, join('replay', 'conversations', `${first.id}.html`));
    const limit = process.env.CEOBE_SERIAL_PAGES ? 1 : Math.max(1, Number(process.env.CEOBE_PAGE_WORKERS) || 4);
    if (rest.length) await runPool(rest, limit, ['--skip-shared-assets']);
    rebuilt = pending.length;
  }
  await mkdir(join(projectRoot, 'data/private'), { recursive: true });
  await writeFile(stampFile, JSON.stringify(next));
  if (rebuilt < library.conversations.length) {
    console.log(`Incremental: rebuilt ${rebuilt} of ${library.conversations.length} conversation pages.`);
  }
  await cp(indexPath, join(projectRoot, 'replay', 'library.ceobe.json'));
  await mkdir(join(projectRoot, 'replay', 'public'), { recursive: true });
  await cp(indexPath, join(projectRoot, 'replay', 'public', 'library.ceobe.json'));
  await step('import-page', async () => buildImportPage(projectRoot));
  await step('asset-library', async () => buildAssetLibrary(projectRoot, library));
  await step('projects-page', async () => buildProjectsPage(projectRoot));
  await step('project-detail', async () => buildProjectDetail(projectRoot, library));
  // chat-menu 与 chat-actions 合并成同一趟：一页只解析一次，最后统一写回。
  const pageCache = process.env.CEOBE_NO_CACHE ? null : createPageCache(join(projectRoot, 'replay'));
  await step('chat-menu', async () => buildChatMenu(projectRoot, library, pageCache));
  await step('chat-actions', async () => buildChatActions(projectRoot, library, pageCache));
  await step('chat-organizer', async () => buildChatOrganizer(projectRoot, pageCache));
  await step('sidebar-controls', async () => buildSidebarControls(projectRoot, pageCache));
  await step('search-index', async () => writeSearchIndex(projectRoot, library));
  await step('reader-ui', async () => buildReaderUI(projectRoot, library, pageCache));
  if (pageCache) { const written = await pageCache.flush(); console.log(`Page cache: parsed ${pageCache.parsedPages}, wrote ${written.length} page(s).`); }
  await step('bookmarks', async () => buildBookmarks(projectRoot, library));
  await step('fonts', async () => localizeGeneratedFonts(join(projectRoot,'replay')));
  console.log('Steps: ' + stepTiming.map(([n, ms]) => `${n}=${(ms / 1000).toFixed(1)}s`).join(' '));
  console.log(`Library reader built: ${library.conversations.length} conversations; home is “${selected?.title || "本地聊天"}”.`);
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    'index-only': { type: 'boolean', default: false },
    select: { type: 'string' },
    // `--only a,b` rebuilds just those conversation pages; see buildReader.
    only: { type: 'string' },
  } });
  const only = values.only ? values.only.split(',').map(value => value.trim()).filter(Boolean) : null;
  // Page-only refreshes must not touch the archive: reuse the existing index instead of rewriting it.
  let library;
  if (only?.length) {
    library = JSON.parse(await readFile(indexPath, 'utf8'));
    console.log(`Library index reused: ${indexPath} (${library.conversations.length} conversations, archive untouched)`);
  } else {
    library = await buildLibraryIndex();
    console.log(`Library index: ${indexPath} (${library.conversations.length} conversations)`);
  }
  if (!values['index-only']) await buildReader(library, values.select, only);
}
