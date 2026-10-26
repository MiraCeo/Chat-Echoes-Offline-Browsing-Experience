import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

// 用隔离夹具（data/private/readme-shot）生成 README 截图：不连本地 API、不使用任何真实聊天。
const ROOT = resolve('data/private/readme-shot/replay');
const OUT = resolve('docs/assets');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // 截图用的最小 API 桩：让页面表现为“本地服务可用”，不暴露任何真实数据。
  if (url.pathname.startsWith('/api/')) {
    const json = data => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
    if (url.pathname === '/api/capabilities') return json({ mode: 'development', importShare: true });
    if (url.pathname === '/api/projects') return json({ projects: projects, writable: true });
    if (url.pathname === '/api/chats') return json({ conversations: chats });
    if (url.pathname === '/api/bookmarks') return json({ items: bookmarks, writable: true });
    if (url.pathname === '/api/library') return json({ folders: [], tags: {}, uploads: [], writable: true });
    res.statusCode = 404;
    return json({ error: 'not found' });
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw Object.assign(new Error('dir'), { code: 'ENOENT' });
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;

const library = JSON.parse(await readFile(resolve('data/private/readme-shot/archive/library.ceobe.json'), 'utf8'));
const projects = JSON.parse(await readFile(resolve('data/private/readme-shot/data/private/projects.ceobe.json'), 'utf8')).projects;
const bookmarks = JSON.parse(await readFile(resolve('data/private/readme-shot/data/private/bookmarks.ceobe.json'), 'utf8')).items;
const chats = JSON.parse(await readFile(resolve('data/private/readme-shot/replay/chats.json'), 'utf8')).chats;
const mathChat = library.conversations.find(entry => entry.title.includes('贝叶斯'));
const project = projects[0];

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: 'light', locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.addInitScript(() => {
    // 截图里不要出现滚动条与“悬浮高亮”这类瞬态。
    const style = document.createElement('style');
    style.textContent = '::-webkit-scrollbar{display:none!important}html{scrollbar-width:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  });
  const demoLink = 'https://chatgpt.com/share/12345678-1234-4123-8123-123456789abc';
  void demoLink;
  // composer 的占位段落不会因为程序化输入而消失，截图里保持空输入框更干净。
  const shots = [
    ['readme-reader.png', `conversations/${mathChat.id}.html`, null],
    ['readme-project.png', `project.html?id=${project.id}`, null],
    ['readme-library.png', 'assets.html', null],
    ['readme-import.png', 'import.html', null],
  ];
  for (const [name, path, composer] of shots) {
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    if (composer) {
      const input = page.locator(composer).first();
      if (await input.count()) { await input.fill(demoLink); }
    }
    await page.waitForTimeout(700);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, name), type: 'png' });
    console.log('shot', name, '->', path);
  }
  console.log('page errors:', JSON.stringify(errors));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
