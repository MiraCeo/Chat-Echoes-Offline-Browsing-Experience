/**
 * Port reservation for test fixtures.
 *
 * Vite treats `port: 0` as falsy and falls back to its default 5173, so an "ephemeral port" without a
 * probe is not isolation at all: with `npm run dev` already running, the fixture would bind 5174 (or
 * collide outright). Reserve a port with the OS first, then hand Vite the concrete number.
 */
import { createServer } from 'node:net';

export async function freePort() {
  const probe = createServer();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', done); });
  const { port } = probe.address();
  await new Promise(done => probe.close(done));
  return port;
}

/** Vite server options for an isolated fixture on a genuinely free port. */
export async function isolatedServerOptions(extra = {}) {
  return { ...extra, host: '127.0.0.1', port: await freePort(), strictPort: true, open: false };
}
