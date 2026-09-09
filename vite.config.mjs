import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { projectsMiddleware } from './scripts/project-store.mjs';
import { chatMiddleware } from './scripts/chat-store.mjs';
import { markdownExportMiddleware } from './scripts/markdown-export-api.mjs';
import { acquireMutation } from './scripts/workspace-mutation.mjs';

const replayRoot = resolve('replay');
const conversationRoot = resolve(replayRoot, 'conversations');
let conversationPages = [];
try { conversationPages = readdirSync(conversationRoot).filter(name => name.endsWith('.html')); } catch {}

const projectRoot = resolve('.');
const projectApi = projectsMiddleware(projectRoot);
const chatApi = chatMiddleware(projectRoot);
const markdownApi = markdownExportMiddleware(projectRoot);
const localProjects = {
  name: 'ceobe-local-projects',
  configureServer(server) { server.middlewares.use(projectApi); server.middlewares.use(chatApi); server.middlewares.use(markdownApi); },
  configurePreviewServer(server) { server.middlewares.use(projectApi); server.middlewares.use(chatApi); server.middlewares.use(markdownApi); },
};
let activeImport = false;

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function archiveShare(url) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['scripts/archive-share.mjs', url], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-200000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-200000); });
    child.on('error', rejectRun);
    child.on('close', code => code === 0
      ? resolveRun({ stdout, stderr })
      : rejectRun(new Error(stderr.trim() || stdout.trim() || `归档进程退出，代码 ${code}`)));
  });
}

const localShareImporter = {
  name: 'ceobe-local-share-importer',
  configureServer(server) {
    server.middlewares.use('/api/archive-share', async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: '仅支持 POST' });
      if (activeImport) return sendJson(response, 409, { error: '已有链接正在导入，请等待完成' });
      let ownsImport = false,releaseMutation;
      try {
        const body = await readJsonBody(request);
        const url = new URL(body?.url);
        if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.port || url.username || url.password ||
          !/^\/share\/[\w-]+\/?$/.test(url.pathname)) throw new Error('请输入公开的 ChatGPT 分享链接');
        url.search = ''; url.hash = '';
        const shareId = url.pathname.split('/')[2];
        // Recheck after the asynchronous body read; only the lock owner may release it.
        if (activeImport) return sendJson(response, 409, { error: '已有链接正在导入，请等待完成' });
        releaseMutation=await acquireMutation(projectRoot);
        activeImport = true;
        ownsImport = true;
        const run = await archiveShare(url.href);
        const library = JSON.parse(await readFile(resolve('archive/library.ceobe.json'), 'utf8'));
        const entry = library.conversations?.find(item => item.id === shareId);
        if (!entry) throw new Error('归档完成，但没有在档案库索引中找到该会话');
        await releaseMutation();releaseMutation=null;
        sendJson(response, 200, {
          ok: true,
          shareId,
          title: entry.title,
          messageCount: entry.message_count,
          resourceCounts: entry.resource_counts,
          page: `/conversations/${shareId}.html`,
          output: run.stdout.trim(),
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (ownsImport) activeImport = false;
        if(releaseMutation)await releaseMutation();
      }
    });
  },
};

export default defineConfig({
  plugins: [localShareImporter, localProjects],
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
