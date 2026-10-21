/**
 * Start the dev server on the first port that can actually be bound.
 *
 * Windows sometimes reserves a whole port range (for example 5150-5249), where binding 5173 fails
 * with EACCES rather than EADDRINUSE. Vite's own fallback only retries on EADDRINUSE, so this
 * launcher probes candidates itself and asks it to bind a port that is known to work.
 *
 * Usage: npm run dev              (prefers 5173, then walks upward)
 *        CEOBE_PORT=5400 npm run dev
 */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const preferred = Number(process.env.CEOBE_PORT) || 5173;
const attempts = 40;

const bindable = port => new Promise(done => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(() => done(true)));
});

let chosen = null;
for (let offset = 0; offset < attempts && chosen === null; offset += 1) {
  const port = preferred + offset;
  if (await bindable(port)) chosen = port;
}

if (chosen === null) {
  console.error(`找不到可用端口：${preferred}–${preferred + attempts - 1} 都被占用或保留。可用 CEOBE_PORT 指定其他端口。`);
  process.exit(1);
}
if (chosen !== preferred) {
  console.log(`端口 ${preferred} 不可用（被占用或被系统保留），改用 ${chosen}。`);
}
console.log(`本地服务：http://127.0.0.1:${chosen}/`);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'replay', '--config', 'vite.config.mjs',
  '--port', String(chosen), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' });

vite.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { vite.kill(signal); });
}
