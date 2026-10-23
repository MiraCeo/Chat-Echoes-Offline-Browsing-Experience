// 生产构建产物（dist/）在导入、删除这类写操作里曾经每次重建一次，约 14 秒，
// 而它只在 npm run build / npm run preview 时才被真正需要。这里改成"标记过期"，
// 由下一次 npm run build 负责补上，写操作不再为它付时间。
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const markerPath = root => join(root, 'data/private/dist-stale.json');

export const markDistStale = async (root, reason) => {
  const path = markerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ at: new Date().toISOString(), reason }, null, 2), 'utf8');
};

export const readDistStale = async root => {
  try { return JSON.parse(await readFile(markerPath(root), 'utf8')); } catch { return null; }
};

export const clearDistStale = async root => {
  await rm(markerPath(root), { force: true });
};