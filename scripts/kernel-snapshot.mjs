#!/usr/bin/env node
/**
 * Kernel source snapshots.
 *
 * The kernel lives under `data/private/memory-kernel/source/`, which is
 * gitignored — so prompt and validator changes have no version history. This
 * copies the source into `data/private/archive-backups/kernel-<timestamp>/`
 * with a manifest, and can restore it.
 *
 *   npm run kernel:snapshot                      # create a snapshot
 *   npm run kernel:snapshot -- --list            # list snapshots
 *   npm run kernel:snapshot -- --restore <name>  # restore (pre-restore backup first)
 *   --keep <n>                                   # retention, default 10
 *   --root <dir>                                 # alternate project root (tests)
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const KEY_FILES = [
  'PROMPT-L4.md',
  'PROMPT-L5.md',
  'validate-events.mjs',
  'validate-tree.mjs',
  'overlay/archive-map.json',
  'global/tree.json',
  'global/l5-g1.json',
];

const paths = root => ({
  source: join(root, 'data/private/memory-kernel/source'),
  backups: join(root, 'data/private/archive-backups'),
});

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);

const walk = async (dir, base = dir, out = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).replaceAll('\\', '/'));
  }
  return out;
};

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

export async function createSnapshot(root, label = 'kernel') {
  const { source, backups } = paths(root);
  if (!existsSync(source)) throw new Error(`找不到内核源：${source}`);
  const name = `${label}-${stamp()}`;
  const target = join(backups, name);
  await mkdir(target, { recursive: true });
  await cp(source, join(target, 'source'), {
    recursive: true,
    filter: entry => !entry.split(sep).includes('.git'),
  });
  const files = await walk(join(target, 'source'));
  let bytes = 0;
  for (const file of files) bytes += (await stat(join(target, 'source', file))).size;
  const hashes = {};
  for (const file of KEY_FILES) {
    const path = join(target, 'source', file);
    if (existsSync(path)) hashes[file] = await sha256(path);
  }
  const manifest = {
    schema: 'ceobe.kernel-snapshot/1',
    name,
    created_at: new Date().toISOString(),
    source,
    files: files.length,
    bytes,
    hashes,
    note: '内核源快照。data/private 不进 git；恢复前会先自动留一份 pre-restore。',
  };
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { name, target, manifest };
}

export async function listSnapshots(root) {
  const { backups } = paths(root);
  let names = [];
  try {
    names = (await readdir(backups, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.startsWith('kernel-'))
      .map(entry => entry.name);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const snapshots = [];
  for (const name of names) {
    const path = join(backups, name);
    let manifest = null;
    try { manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')); } catch { /* incomplete */ }
    snapshots.push({ name, path, manifest });
  }
  snapshots.sort((a, b) => String(b.manifest?.created_at || b.name).localeCompare(String(a.manifest?.created_at || a.name)));
  return snapshots;
}

export async function pruneSnapshots(root, keep = 10) {
  const snapshots = await listSnapshots(root);
  const removed = [];
  for (const snapshot of snapshots.slice(keep)) {
    await rm(snapshot.path, { recursive: true, force: true });
    removed.push(snapshot.name);
  }
  return removed;
}

export async function restoreSnapshot(root, name) {
  const { source } = paths(root);
  const snapshots = await listSnapshots(root);
  const selected = name && name !== 'latest' ? snapshots.find(item => item.name === name) : snapshots[0];
  if (!selected) throw new Error(`找不到快照：${name || 'latest'}`);
  const snapshotSource = join(selected.path, 'source');
  if (!existsSync(snapshotSource)) throw new Error(`快照缺少 source：${selected.name}`);
  // Verify the target before deleting anything.
  const resolvedSource = resolve(source);
  if (resolvedSource !== join(resolve(root), 'data/private/memory-kernel/source')) {
    throw new Error(`拒绝恢复：目标路径异常 ${resolvedSource}`);
  }
  const pre = await createSnapshot(root, 'kernel-pre-restore');
  await rm(resolvedSource, { recursive: true, force: true });
  await cp(snapshotSource, resolvedSource, { recursive: true });
  return { restored: selected.name, pre_restore: pre.name };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const has = name => process.argv.includes(name);
  const root = resolve(option('--root') || resolve(import.meta.dirname, '..'));
  const keep = Number(option('--keep') || 10);

  if (has('--list')) {
    const snapshots = await listSnapshots(root);
    if (!snapshots.length) console.log('没有内核快照。');
    for (const snapshot of snapshots) {
      const manifest = snapshot.manifest;
      console.log(`${snapshot.name}  ${manifest ? `${manifest.files} 文件 / ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB` : '（缺 manifest）'}`);
    }
  } else if (has('--restore')) {
    const result = await restoreSnapshot(root, option('--restore'));
    console.log(`已恢复：${result.restored}`);
    console.log(`恢复前快照：${result.pre_restore}`);
  } else {
    const snapshot = await createSnapshot(root);
    console.log(`内核快照：${snapshot.name}`);
    console.log(`  ${snapshot.manifest.files} 文件 / ${(snapshot.manifest.bytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  ${snapshot.target}`);
    const removed = await pruneSnapshots(root, keep);
    if (removed.length) console.log(`  清理旧快照 ${removed.length} 个（保留最近 ${keep} 个）`);
  }
}
