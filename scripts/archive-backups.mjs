#!/usr/bin/env node
/**
 * Archive backup operations:
 *   list
 *   export --snapshot <name> --to <new-directory>
 *   restore --snapshot <name> --chat <id> [--no-build] [--dry-run]
 *
 * Restore is conversation-level and refuses to overwrite an existing id or
 * folder. It never deletes anything.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const backupsRoot = root => join(root, 'data/private/archive-backups');
const inside = (parent, child) => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !/^[a-zA-Z]:/.test(rel));
};

export async function listSnapshots(root = projectRoot) {
  const base = backupsRoot(root);
  let names = [];
  try { names = (await readdir(base, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const snapshots = [];
  for (const name of names) {
    const path = join(base, name);
    let library = null;
    try { library = JSON.parse(await readFile(join(path, 'archive/library.ceobe.json'), 'utf8')); } catch { /* incomplete snapshot */ }
    let manifest = null;
    try { manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')); } catch { /* older snapshot */ }
    snapshots.push({
      name,
      path,
      created_at: manifest?.created_at || name.slice(0, 24),
      deleted: manifest?.deleted_conversation || null,
      conversations: Array.isArray(library?.conversations) ? library.conversations.length : null,
      complete: Boolean(Array.isArray(library?.conversations)),
    });
  }
  snapshots.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.name.localeCompare(a.name));
  return snapshots;
}

async function resolveSnapshot(root, name) {
  const snapshots = await listSnapshots(root);
  if (!snapshots.length) throw new Error('没有 archive 快照。');
  const selected = name && name !== 'latest'
    ? snapshots.find(item => item.name === name)
    : snapshots[0];
  if (!selected) throw new Error(`找不到快照：${name}`);
  if (!selected.complete) throw new Error(`快照缺少 archive/library.ceobe.json：${selected.name}`);
  return selected;
}

async function findChat(root, snapshot, chatId, requestedSnapshot) {
  const snapshots = await listSnapshots(root);
  if (requestedSnapshot && requestedSnapshot !== 'latest') return snapshot;
  const candidates = [];
  for (const item of snapshots) {
    if (!item.complete) continue;
    const library = JSON.parse(await readFile(join(item.path, 'archive/library.ceobe.json'), 'utf8'));
    if ((library.conversations || []).some(entry => entry.id === chatId)) candidates.push(item);
  }
  return candidates[0] || snapshot;
}

export async function exportSnapshot(root = projectRoot, { snapshot = 'latest', to } = {}) {
  if (!to) throw new Error('缺少 --to <目标目录>');
  const selected = await resolveSnapshot(root, snapshot);
  const target = resolve(to);
  if (inside(selected.path, target)) throw new Error('目标目录不能位于快照内部。');
  if (existsSync(target)) throw new Error(`目标已存在，拒绝覆盖：${target}`);
  await mkdir(dirname(target), { recursive: true });
  await cp(selected.path, target, { recursive: true, force: false, errorOnExist: true });
  return { snapshot: selected, target };
}

export async function pruneSnapshots(root = projectRoot, { keep = 5, dryRun = true } = {}) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep 必须是大于 0 的整数');
  const snapshots = await listSnapshots(root);
  const removed = snapshots.slice(keep);
  if (!dryRun) for (const item of removed) await rm(item.path, { recursive: true, force: true });
  return { keep, removed, remaining: snapshots.slice(0, keep), dryRun };
}

export async function restoreConversation(root = projectRoot, {
  snapshot = 'latest',
  chatId,
  build = true,
  dryRun = false,
} = {}) {
  if (!chatId) throw new Error('缺少 --chat <会话 ID>');
  const initial = await resolveSnapshot(root, snapshot);
  const selected = await findChat(root, initial, chatId, snapshot);
  const snapshotLibrary = JSON.parse(await readFile(join(selected.path, 'archive/library.ceobe.json'), 'utf8'));
  const entry = (snapshotLibrary.conversations || []).find(item => item.id === chatId);
  if (!entry) throw new Error(`快照 ${selected.name} 中找不到会话：${chatId}`);
  const relativePath = entry.conversation_path;
  if (typeof relativePath !== 'string' || !relativePath.startsWith('archive/')) {
    throw new Error(`快照中的 conversation_path 异常：${relativePath || '空'}`);
  }
  const sourceConversation = resolve(selected.path, relativePath);
  const targetConversation = resolve(root, relativePath);
  if (!inside(join(selected.path, 'archive'), sourceConversation)) throw new Error('快照路径越界。');
  if (!inside(join(root, 'archive'), targetConversation)) throw new Error('目标路径越界。');
  const sourceDir = dirname(sourceConversation);
  const targetDir = dirname(targetConversation);
  if (!existsSync(sourceConversation)) throw new Error(`快照中的会话文件不存在：${relativePath}`);
  if (!existsSync(targetConversation)) {
    const current = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8'));
    if ((current.conversations || []).some(item => item.id === chatId)) throw new Error(`当前 archive 已存在会话：${chatId}`);
    if (existsSync(targetDir)) throw new Error(`目标目录已存在，拒绝覆盖：${targetDir}`);
    if (dryRun) return { snapshot: selected, entry, sourceDir, targetDir, copied: false, dryRun: true };
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true, force: false, errorOnExist: true });
    const afterCopy = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8'));
    if ((afterCopy.conversations || []).some(item => item.id === chatId)) throw new Error(`恢复过程中发现重复会话：${chatId}`);
    afterCopy.conversations.push(entry);
    afterCopy.generated_at = new Date().toISOString();
    const tmp = join(root, 'archive/library.ceobe.json.' + process.pid + '.tmp');
    await writeFile(tmp, JSON.stringify(afterCopy, null, 2) + '\n', 'utf8');
    await rename(tmp, join(root, 'archive/library.ceobe.json'));
    if (build) {
      const result = spawnSync(process.execPath, ['scripts/build-library.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
      if (result.status !== 0) throw new Error('会话已恢复，但 build-library 失败；archive 未回滚。');
    }
    return { snapshot: selected, entry, sourceDir, targetDir, copied: true, dryRun: false };
  }
  throw new Error(`目标已存在，拒绝覆盖：${targetDir}`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';
  const option = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  try {
    if (command === 'list') {
      const snapshots = await listSnapshots(projectRoot);
      if (!snapshots.length) {
        console.log('没有 archive 快照。');
        return;
      }
      for (const item of snapshots) {
        console.log([
          item.name,
          item.complete ? `${item.conversations} chats` : 'incomplete',
          item.created_at,
          item.deleted?.title || '',
        ].join('\t'));
      }
      return;
    }
    if (command === 'export') {
      const result = await exportSnapshot(projectRoot, { snapshot: option('--snapshot') || 'latest', to: option('--to') });
      console.log(`Exported ${result.snapshot.name} -> ${result.target}`);
      return;
    }
    if (command === 'prune') {
      const result = await pruneSnapshots(projectRoot, {
        keep: Number(option('--keep') || 5),
        dryRun: !args.includes('--confirm'),
      });
      console.log(JSON.stringify({
        keep: result.keep,
        dryRun: result.dryRun,
        removed: result.removed.map(item => item.name),
        remaining: result.remaining.map(item => item.name),
      }, null, 2));
      return;
    }
    if (command === 'restore') {
      const result = await restoreConversation(projectRoot, {
        snapshot: option('--snapshot') || 'latest',
        chatId: option('--chat'),
        build: !args.includes('--no-build'),
        dryRun: args.includes('--dry-run'),
      });
      console.log(JSON.stringify({
        snapshot: result.snapshot.name,
        id: result.entry.id,
        title: result.entry.title,
        target: result.targetDir,
        copied: result.copied,
        dryRun: result.dryRun,
      }, null, 2));
      return;
    }
    throw new Error(`未知命令：${command}`);
  } catch (error) {
    console.error(`archive backup: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
