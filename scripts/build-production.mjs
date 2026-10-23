// npm run build：真正跑一次 vite 生产构建，然后清掉"dist 已过期"标记。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { clearDistStale, readDistStale } from './dist-stale.mjs';

const root = resolve(import.meta.dirname, '..');
const stale = await readDistStale(root);
if (stale) console.log(`dist 之前被写操作标记为过期（${stale.reason}，${stale.at}），现在重新构建。`);

const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', 'replay',
  '--config', 'vite.config.mjs', '--outDir', '../dist', '--emptyOutDir'], { cwd: root, stdio: 'inherit' });
child.on('exit', async code => {
  if (code === 0) await clearDistStale(root);
  process.exit(code ?? 0);
});