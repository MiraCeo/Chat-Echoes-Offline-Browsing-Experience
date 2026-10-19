/**
 * Guard for the append-only archive.
 *
 * `archive/` is the original capture record: captures may add snapshots, nothing may overwrite or
 * remove one. Every write path that creates a snapshot goes through here first, so a mistyped id, a
 * re-run of the same capture or a path that escapes the archive root fails loudly instead of quietly
 * destroying evidence.
 *
 * The guard is deliberately independent of the importer: it reasons only about paths.
 */
import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_SNAPSHOT_ROOT = join('archive', 'chatgpt-share');
const SHARE_ID = /^[\w-]+$/;
const STAMP = /^[\dT:.Z+-]+$/;

export const snapshotRootOf = root => join(resolve(root), DEFAULT_SNAPSHOT_ROOT);

const exists = async path => {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

/** Nearest existing ancestor, so a would-be target can be checked before it is created. */
async function deepestExisting(path) {
  let current = resolve(path);
  for (;;) {
    if (await exists(current)) return current;
    const parent = resolve(current, '..');
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * The snapshot a capture will write, as data. `capture.json`, `raw/`, `conversation.ceobe.json` and the
 * report are all listed so a dry run can print exactly what is about to happen.
 */
export function planSnapshot({ shareId, capturedAt, snapshotRoot }) {
  if (!SHARE_ID.test(String(shareId || ''))) throw new Error(`拒绝无效的会话 ID：${JSON.stringify(shareId)}`);
  const stamp = String(capturedAt || '').replaceAll(':', '-');
  if (!STAMP.test(stamp)) throw new Error(`拒绝无效的抓取时间戳：${JSON.stringify(capturedAt)}`);
  const dir = join(resolve(snapshotRoot), String(shareId), stamp);
  return {
    shareId,
    stamp,
    dir,
    files: ['raw/share.html', 'capture.json', 'conversation.ceobe.json', 'conversation.md', 'import-report.json'],
  };
}

export const formatSnapshotPlan = plan => [
  `归档目标：${plan.dir}`,
  `会话 ID：${plan.shareId}　抓取时间：${plan.stamp}`,
  '将写入：',
  ...plan.files.map(file => `  ${file}`),
  '（既有快照不会被覆盖或删除；本计划在写入前打印）',
].join('\n');

/**
 * Refuse anything that is not a fresh `<snapshot-root>/<share-id>/<timestamp>/` directory.
 * Symlinks and junctions are resolved, so a link inside the archive cannot redirect a write outside it.
 */
export async function assertSnapshotTarget(dir, { snapshotRoot } = {}) {
  const root = await realpath(resolve(snapshotRoot)).catch(() => resolve(snapshotRoot));
  const target = resolve(dir);
  const relativePath = relative(root, target);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`归档写入必须位于 ${root} 之内，收到：${target}`);
  }
  if (relativePath.split(sep).filter(Boolean).length !== 2) {
    throw new Error(`归档写入必须是 <会话 ID>/<抓取时间戳> 两层目录，收到：${relativePath}`);
  }
  const resolvedTarget = await realpath(target).catch(async () => realpath(await deepestExisting(target)).catch(() => target));
  const resolvedRelative = relative(root, resolvedTarget);
  if (resolvedRelative.startsWith('..') || isAbsolute(resolvedRelative)) {
    throw new Error(`归档写入经符号链接解析后离开了归档目录：${resolvedTarget}`);
  }
  const entries = await readdir(target).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
  if (entries && entries.length) {
    throw new Error(`目标快照已存在，拒绝覆盖：${target}（共 ${entries.length} 项）`);
  }
  return { target, relativePath };
}
