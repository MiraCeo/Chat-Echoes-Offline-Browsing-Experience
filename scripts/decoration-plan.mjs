import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// 每页装饰输入的版本号：装饰输入的含义变了（不只是脚本内容变了）就 +1，强制全部页面重做。
// 脚本/模板内容本身由 build-library 的渲染器指纹覆盖，这里只标记“口径”变化。
// v2：共享输入从 projects.html 换成 project 数据文件（见下面 decorationPlan 的注释）。
const DECORATION_VERSION = 2;

const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

const pagesPath = root => join(root, 'data/private/decoration-stamps.json');

/** replay 下需要装饰的页面，顺序固定（顶层页面在前，会话页在后）。 */
export async function decorationPageList(replay) {
  const top = (await readdir(replay)).filter(name => name.endsWith('.html')).sort();
  const conversations = (await readdir(join(replay, 'conversations')))
    .filter(name => name.endsWith('.html')).sort().map(name => `conversations/${name}`);
  return [...top, ...conversations];
}

/**
 * 页面装饰只取决于：渲染器与模板、项目清单、这一页对应的会话条目、以及页面自身的字节。
 * 页面字节同时包含“渲染结果”和“上一轮的装饰结果”，所以重新渲染过或内容变了的页面会自动重做。
 */
export async function decorationPlan(root, { renderer, library, homeId }) {
  const replay = join(root, 'replay');
  let previous = { pages: {} };
  try { previous = JSON.parse(await readFile(pagesPath(root), 'utf8')); } catch { /* 首次构建或文件损坏：全部重做 */ }
  const comparable = previous?.version === DECORATION_VERSION && previous.pages && typeof previous.pages === 'object';
  // 共享输入只放“项目数据”，不要放 projects.html 本身：那个页面是从 import.html 改出来的，
  // 里面内嵌着首页会话那一行（标题、链接、置顶/菜单文案）。导入一个新会话会让首页变化，
  // 于是整份 projects.html 的哈希变化，所有页面的装饰指纹一起失效——实测一次导入 40/40 页
  // 全量重做，光装饰就多花约 100 秒。项目数据文件才是其他页面真正依赖的输入。
  const projects = hash(await readFile(join(root, 'data/private/projects.ceobe.json'), 'utf8').catch(() => ''));
  const shared = hash(`${DECORATION_VERSION}|${renderer}|${projects}`);
  const entries = new Map(library.conversations.map(entry => [entry.id, entry]));
  const idOf = page => {
    const name = page.split('/').pop().slice(0, -'.html'.length);
    // 顶层页面里 import/assets/projects/project/timeline 都内嵌了首页会话那一行；index.html 本身就是首页会话。
    if (page.startsWith('conversations/')) return name;
    return ['index', 'import', 'assets', 'projects', 'project', 'timeline'].includes(name) ? homeId : null;
  };
  const pages = await decorationPageList(replay);
  const changed = [];
  const stamps = {};
  const prefixes = {};
  for (const page of pages) {
    const entry = entries.get(idOf(page) || '');
    const prefix = `${shared}|${entry ? JSON.stringify({ id: entry.id, title: entry.title, page: entry.page }) : ''}`;
    const signature = `${prefix}|${hash(await readFile(join(replay, page)))}`;
    prefixes[page] = prefix;
    stamps[page] = signature;
    if (!comparable || previous.pages[page] !== signature) changed.push(page);
  }
  return { pages, changed, stamps, prefixes, total: pages.length };
}

/** 装饰写完后，被装饰页面的指纹要按“这一趟结束时的字节”重算，下一趟才能据此跳过。 */
export async function finalizeDecorationPlan(root, plan, changed, previousStamps = null) {
  const replay = join(root, 'replay');
  const stamps = { ...plan.stamps, ...(previousStamps || {}) };
  for (const page of changed) {
    stamps[page] = `${plan.prefixes[page]}|${hash(await readFile(join(replay, page)))}`;
  }
  // 只保留仍然存在的页面。
  const alive = new Set(await decorationPageList(replay));
  for (const page of Object.keys(stamps)) if (!alive.has(page)) delete stamps[page];
  await mkdir(dirname(pagesPath(root)), { recursive: true });
  await writeFile(pagesPath(root), JSON.stringify({ version: DECORATION_VERSION, pages: stamps }, null, 1));
  return stamps;
}

export async function readDecorationStamps(root) {
  try { return JSON.parse(await readFile(pagesPath(root), 'utf8')); } catch { return null; }
}
