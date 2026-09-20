import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer as createProbeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build, createServer, preview } from 'vite';
import { createBookmarkStore } from './bookmark-store.mjs';
import { bookmarkProfiles, makeBookmarkConversation } from '../fixtures/browser/bookmark-conversations.mjs';

// Vite reads `port: 0` as falsy and falls back to its default 5173, so asking for an ephemeral port
// does not isolate anything: with `npm run dev` running, the fixture would bind 5174 instead and can
// fail outright where that port is reserved. Reserve a free port first, then hand Vite the number.
async function freePort() {
  const probe = createProbeServer();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', done); });
  const { port } = probe.address();
  await new Promise(done => probe.close(done));
  return port;
}

// Build the real application in an isolated root, rather than replacing markup
// in a user's reader. Only runtime source and frozen public assets are reused.
export async function createBookmarkBrowserFixture({ profiles = bookmarkProfiles, production = process.env.CEOBE_TEST_DIST === '1' } = {}) {
  const source = resolve(import.meta.dirname, '..');
  const root = await mkdtemp(join(tmpdir(), 'ceobe-bookmark-browser-'));
  let server;
  const close = async () => {
    try {
      if (production && server?.httpServer) await new Promise(r => server.httpServer.close(r));
      else if (server) await server.close();
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
  };
  try {
    await cp(join(source, 'scripts'), join(root, 'scripts'), { recursive: true,
      filter: path => !/^(?:test-|capture-|\.)/.test(basename(path)) });
    for (const name of ['official-templates', 'official-assets', 'node_modules'])
      await symlink(join(source, name), join(root, name), process.platform === 'win32' ? 'junction' : 'dir');
    await cp(join(source, 'vite.config.mjs'), join(root, 'vite.config.mjs'));
    for (const profile of profiles) {
      const file = join(root, 'archive/chatgpt-share', profile.id, '2026-01-01', 'conversation.ceobe.json');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(makeBookmarkConversation(profile)));
    }
    await promisify(execFile)(process.execPath, ['scripts/build-library.mjs'], { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    // The production config resolves its workspace at load time. Keep this
    // temporary cwd scoped to config loading; all captured paths are absolute.
    const previous = process.cwd();
    try {
      process.chdir(root);
      const common = { configFile: join(root, 'vite.config.mjs'), root: join(root, 'replay'), logLevel: 'error' };
      const port = await freePort();
      if (production) {
        await build({ ...common, build: { outDir: join(root, 'dist'), emptyOutDir: true } });
        server = await preview({ ...common, build: { outDir: join(root, 'dist') }, preview: { host: '127.0.0.1', port, open: false } });
      } else {
        server = await createServer({ ...common, server: { host: '127.0.0.1', port, open: false, hmr: false } });
        await server.listen();
      }
    } finally { process.chdir(previous); }
    const http = server.httpServer;
    const base = `http://127.0.0.1:${http.address().port}/`;
    const store = createBookmarkStore(root);
    return { root, base, production, store, close, profiles,
      async seed(specs) {
        const result = [];
        for (const spec of specs) result.push((await store.mutate({ action: 'save', expectedVersion: 0, ...spec })).bookmark);
        return result;
      },
      async snapshot() {
        return await readFile(join(root, 'data/private/bookmarks.ceobe.json'), 'utf8');
      },
    };
  } catch (error) { await close(); throw error; }
}
