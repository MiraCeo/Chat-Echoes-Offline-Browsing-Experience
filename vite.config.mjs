import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const replayRoot = resolve('replay');
const conversationRoot = resolve(replayRoot, 'conversations');
let conversationPages = [];
try { conversationPages = readdirSync(conversationRoot).filter(name => name.endsWith('.html')); } catch {}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(replayRoot, 'index.html'),
        ...Object.fromEntries(conversationPages.map(name => [`conversations/${name.slice(0, -5)}`, resolve(conversationRoot, name)])),
      },
    },
  },
});
