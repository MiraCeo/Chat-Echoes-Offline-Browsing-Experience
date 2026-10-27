/**
 * 官方格式 JSON 导出（`npm run export:json`）：
 *   npm run export:json -- --all --out <目录> [--no-assets] [--compact]
 *   npm run export:json -- --id <share-id> --out <目录>
 *
 * 产物：`conversations.json`（`--all` 为数组，单个 `--id` 为对象）+ `attachments/<sha256>.<ext>` + `manifest.json`。
 * 只读 `archive/`，只写 `--out`。`CEOBE_ROOT` 可指向隔离工作区（测试用）。
 *
 * 确定性：不写墙钟时间；附件按内容哈希命名；同一份输入导出两次逐字节一致。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { conversationToOfficial, officialStats, OFFICIAL_EXPORT_FORMAT, OFFICIAL_EXPORT_VERSION } from './export-conversation-json.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** 附件目标文件名：内容哈希 + 原扩展名；同内容同扩展名天然去重。 */
export function attachmentName(resource, digest) {
  const source = resource.name || resource.local_path || '';
  const extension = extname(source).toLowerCase();
  return digest + (/^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '');
}

/**
 * 会话自身的附件（每页自己的产物，不能放进共享分支的教训同样适用）：
 * 返回 `resource.key -> attachments/<sha>.<ext>` 映射与统计。
 */
async function copyConversationResources(conversationPath, resources, attachmentDir, copyAssets) {
  const folder = dirname(conversationPath);
  const paths = new Map();
  const files = new Map(); // 目标文件名 → 字节数，用于只统计真正写过的唯一文件
  const stats = { copied: 0, missing: 0, skipped: 0 };
  for (const resource of resources) {
    const downloadable = resource.status === 'downloaded' && resource.local_path;
    if (!downloadable) { stats.missing += 1; paths.set(resource.key, null); continue; }
    if (!copyAssets) { stats.skipped += 1; paths.set(resource.key, null); continue; }
    const source = resolve(folder, resource.local_path);
    const rel = relative(folder, source);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) { stats.missing += 1; paths.set(resource.key, null); continue; }
    let bytes;
    try { bytes = await readFile(source); } catch { stats.missing += 1; paths.set(resource.key, null); continue; }
    const name = attachmentName(resource, sha256(bytes));
    const destination = join(attachmentDir, name);
    if (!files.has(name)) {
      await writeFile(destination, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      files.set(name, bytes.length);
    }
    paths.set(resource.key, 'attachments/' + name);
    stats.copied += 1;
  }
  return { paths, stats, files };
}

/**
 * 导出一组会话。返回写入的文件与清单（测试与 CLI 共用）。
 */
export async function exportJson({ root, outDir, ids = [], all = false, copyAssets = true, compact = false }) {
  root = resolve(root);
  outDir = resolve(outDir);
  if (!all && !ids.length) throw new Error('需要 --all 或 --id <share-id>');
  if (all && ids.length) throw new Error('--all 与 --id 不能同时使用');

  let library;
  try { library = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8')); }
  catch { throw new Error('找不到 archive/library.ceobe.json：请先在本地归档（或运行 npm run library）'); }
  if (library.kind !== 'ceobe.library' || !Array.isArray(library.conversations)) throw new Error('聊天索引格式错误');
  if (!library.conversations.length) throw new Error('本地档案里还没有会话');

  let entries;
  if (all) entries = [...library.conversations];
  else {
    const byId = new Map(library.conversations.map(entry => [entry.id, entry]));
    const unknown = ids.filter(id => !byId.has(id));
    if (unknown.length) throw new Error('聊天不存在：' + unknown.join(', '));
    // 保持 --id 的先后顺序，方便脚本一次导出多条。
    entries = ids.map(id => byId.get(id));
  }

  const attachmentDir = join(outDir, 'attachments');
  await mkdir(outDir, { recursive: true });
  if (copyAssets) await mkdir(attachmentDir, { recursive: true });

  const attachments = { copied: 0, missing: 0, skipped: 0, files: new Map() };
  const counts = { conversations: 0, nodes: 0, messages: 0, hidden_messages: 0 };
  const conversations = [];
  for (const entry of entries) {
    const conversationPath = resolve(root, entry.conversation_path);
    const inside = relative(root, conversationPath);
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error('会话路径不在工作区内：' + entry.conversation_path);
    const conversation = JSON.parse(await readFile(conversationPath, 'utf8'));
    const resources = Array.isArray(conversation.resources) ? conversation.resources : [];
    const copied = await copyConversationResources(conversationPath, resources, attachmentDir, copyAssets);
    for (const [name, size] of copied.files) attachments.files.set(name, size);
    attachments.copied += copied.stats.copied;
    attachments.missing += copied.stats.missing;
    attachments.skipped += copied.stats.skipped;
    const official = conversationToOfficial(conversation, {
      title: entry.title,
      attachmentPath: resource => copied.paths.get(resource.key) ?? null,
    });
    const stats = officialStats(official);
    counts.conversations += 1;
    counts.nodes += stats.nodes;
    counts.messages += stats.messages;
    counts.hidden_messages += stats.hidden;
    conversations.push(official);
  }

  const payload = all || ids.length !== 1 ? conversations : conversations[0];
  const indent = compact ? 0 : 2;
  const text = JSON.stringify(payload, null, indent) + '\n';
  await writeFile(join(outDir, 'conversations.json'), text, 'utf8');
  const manifest = {
    format: OFFICIAL_EXPORT_FORMAT,
    version: OFFICIAL_EXPORT_VERSION,
    conversation_ids: entries.map(entry => entry.id),
    counts,
    attachments: {
      copied: attachments.copied,
      missing: attachments.missing,
      skipped: attachments.skipped,
      files: attachments.files.size,
      bytes: [...attachments.files.values()].reduce((sum, value) => sum + value, 0),
    },
    files: [{ name: 'conversations.json', bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) }],
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, indent) + '\n', 'utf8');
  return { outDir, payload, manifest, bytes: Buffer.byteLength(text) };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      id: { type: 'string', multiple: true, default: [] },
      out: { type: 'string' },
      'no-assets': { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
    },
  });
  if (!values.out) throw new Error('需要 --out <目录>；例如：npm run export:json -- --all --out D:\\ceobe-export');
  const root = process.env.CEOBE_ROOT ? resolve(process.env.CEOBE_ROOT) : resolve(import.meta.dirname, '..');
  const ids = [...values.id, ...positionals];
  const result = await exportJson({
    root,
    outDir: values.out,
    all: values.all,
    ids,
    copyAssets: !values['no-assets'],
    compact: values.compact,
  });
  const { counts, attachments } = result.manifest;
  const size = (result.bytes / 1024).toFixed(1) + ' KB';
  const copy = values['no-assets']
    ? `附件未复制（${attachments.missing} 个缺失）`
    : `附件 ${attachments.copied} 个（${(attachments.bytes / 1048576).toFixed(1)} MB，缺失 ${attachments.missing} 个）`;
  console.log(`已导出 ${counts.conversations} 个会话到 ${result.outDir}：conversations.json ${size}，${copy}。`);
  console.log(`消息 ${counts.messages} / 节点 ${counts.nodes} / 隐藏 ${counts.hidden_messages}；格式 ${OFFICIAL_EXPORT_FORMAT} v${OFFICIAL_EXPORT_VERSION}。`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { await main(); }
  catch (error) { console.error('导出失败：' + error.message); process.exitCode = 1; }
}
