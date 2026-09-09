import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectsMiddleware } from './scripts/project-store.mjs';
import { bookmarksMiddleware } from './scripts/bookmark-store.mjs';
import { chatMiddleware } from './scripts/chat-store.mjs';
import { markdownExportMiddleware } from './scripts/markdown-export-api.mjs';
import { projectExportMiddleware } from './scripts/project-export-api.mjs';
import { localImportMiddleware } from './scripts/local-import-api.mjs';

const replayRoot = resolve('replay');
const conversationRoot = resolve(replayRoot, 'conversations');
let conversationPages = [];
try { conversationPages = readdirSync(conversationRoot).filter(name => name.endsWith('.html')); } catch {}

const projectRoot = resolve('.');
const projectApi = projectsMiddleware(projectRoot);
const chatApi = chatMiddleware(projectRoot);
const bookmarkApi = bookmarksMiddleware(projectRoot);
const markdownApi = markdownExportMiddleware(projectRoot);
const zipApi=projectExportMiddleware(projectRoot);
const localProjects = {
  name: 'ceobe-local-projects',
  configureServer(server) { server.middlewares.use(bookmarkApi); server.middlewares.use(zipApi); server.middlewares.use(projectApi); server.middlewares.use(chatApi); server.middlewares.use(markdownApi); server.middlewares.use(localImportMiddleware(projectRoot)); },
  configurePreviewServer(server) { server.middlewares.use(bookmarkApi); server.middlewares.use(zipApi); server.middlewares.use(projectApi); server.middlewares.use(chatApi); server.middlewares.use(markdownApi); server.middlewares.use(localImportMiddleware(projectRoot,{mode:'production'})); },
};
export default defineConfig({
  plugins: [localProjects],
  server: { hmr: false },
  build: {
    rollupOptions: {
      input: {
        index: resolve(replayRoot, 'index.html'),
        ...(existsSync(resolve(replayRoot,'project.html'))?{project:resolve(replayRoot,'project.html')}:{}),
        ...(existsSync(resolve(replayRoot,'import.html'))?{import:resolve(replayRoot,'import.html')}:{}),
        ...(existsSync(resolve(replayRoot, 'assets.html')) ? { assets: resolve(replayRoot, 'assets.html') } : {}),
        ...(existsSync(resolve(replayRoot, 'projects.html')) ? { projects: resolve(replayRoot, 'projects.html') } : {}),
        ...Object.fromEntries(conversationPages.map(name => [`conversations/${name.slice(0, -5)}`, resolve(conversationRoot, name)])),
      },
    },
  },
});
