/**
 * Crawl the local web app and report health problems.
 *
 * Checks each page for console errors, HTTP failures, broken local images, and horizontal overflow.
 * Read-only: it never clicks anything destructive and never writes to archive/.
 *
 * Usage: node scripts/test-web-health.mjs [--base http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const projectRoot = import.meta.dirname.replace(/[\\/]scripts$/, '');
const { values } = parseArgs({ options: { base: { type: 'string' }, limit: { type: 'string' } } });
const base = (values.base || 'http://127.0.0.1:5173').replace(/\/$/, '');
const limit = Number(values.limit || 40);

const pages = [];
for (const name of await readdir(join(projectRoot, 'replay'))) {
  if (/\.html$/i.test(name)) pages.push('/' + name);
}
const conversations = await readdir(join(projectRoot, 'replay', 'conversations')).catch(() => []);
for (const name of conversations.filter(name => /\.html$/i.test(name)).slice(0, Math.max(0, limit - pages.length))) {
  pages.push('/conversations/' + name);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CEOBE_BROWSER_CHANNEL ? { channel: process.env.CEOBE_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
});

const problems = [];
let reachable = true;
for (const path of pages) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const failed = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160)); });
  page.on('pageerror', error => consoleErrors.push('pageerror: ' + error.message.slice(0, 160)));
  page.on('response', response => {
    const status = response.status();
    if (status >= 400) failed.push(status + ' ' + new URL(response.url()).pathname.slice(0, 80));
  });
  try {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(700);
  } catch (error) {
    reachable = false;
    problems.push({ path, kind: 'unreachable', detail: error.message.split('\n')[0] });
    await page.close();
    continue;
  }
  // 站内链接是否可达：只检查同源链接，避免把外部引用算进来。
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map(anchor => anchor.getAttribute('href') || '')
    .filter(href => href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#'))
    .map(href => href.split('#')[0])
    .filter((href, index, list) => href && list.indexOf(href) === index)
    .slice(0, 80));
  const brokenLinks = [];
  for (const href of links) {
    try {
      const response = await page.context().request.get(new URL(href, base + path).href, { timeout: 15000 });
      if (response.status() >= 400) brokenLinks.push(response.status() + ' ' + href);
    } catch (error) {
      brokenLinks.push('ERR ' + href);
    }
  }
  if (brokenLinks.length) problems.push({ path, kind: 'broken-links', detail: brokenLinks.slice(0, 10) });

  const metrics = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    brokenImages: [...document.images].filter(image => (image.getAttribute('src') || '').trim() && image.complete && image.naturalWidth === 0).length,
    title: document.title,
    empty: (document.querySelector('main')?.textContent || '').trim().length < 40,
  }));
  const real = failed.filter(entry => !entry.endsWith('/favicon.ico'));
  // “Failed to load resource” 没有对应的失败响应时，通常是页面关闭时被取消的请求（blob 解码等），
  // 不是页面缺陷：只有确实存在失败响应时才把它计入问题。
  const meaningful = consoleErrors.filter(message => real.length > 0 || !/Failed to load resource/i.test(message));
  if (meaningful.length || real.length) problems.push({ path, kind: 'console', consoleErrors: meaningful, failed: real });
  if (metrics.overflow > 2) problems.push({ path, kind: 'overflow', detail: metrics.overflow + 'px' });
  if (metrics.brokenImages) problems.push({ path, kind: 'broken-images', detail: metrics.brokenImages });
  if (metrics.empty) problems.push({ path, kind: 'empty-main', detail: metrics.title });
  await page.close();
}
await browser.close();

console.log(`checked ${pages.length} page(s) at ${base}`);
if (!reachable) console.log('server unreachable - start the app first');
console.log(JSON.stringify(problems, null, 1));
if (problems.length) process.exitCode = 1;
