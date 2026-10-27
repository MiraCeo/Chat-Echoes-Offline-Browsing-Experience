import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decorationPlan, finalizeDecorationPlan, decorationPageList } from './decoration-plan.mjs';

// 装饰指纹的精度：换首页（导入新会话）只该重做 5 个顶层页，不能把全部会话页一起重做。
// 这条测试锁住 v2 的共享输入：项目数据文件，而不是内嵌首页那一行的 projects.html。
const root = await mkdtemp(join('data/private', 'decoration-plan-'));
const replay = join(root, 'replay');
const topPages = ['index.html', 'import.html', 'assets.html', 'projects.html', 'project.html'];
const conversationPages = ['conversations/a.html', 'conversations/b.html', 'conversations/c.html'];
const library = {
  conversations: [
    { id: 'a', title: '会话 A', page: './conversations/a.html' },
    { id: 'b', title: '会话 B', page: './conversations/b.html' },
    { id: 'c', title: '会话 C', page: './conversations/c.html' },
  ],
};
const projectsFile = join(root, 'data/private/projects.ceobe.json');
const plan = (homeId, renderer = 'renderer-1') => decorationPlan(root, { renderer, library, homeId });
const names = result => result.changed.map(page => page.split('\\').join('/')).sort();

try {
  for (const page of [...topPages, ...conversationPages]) {
    await mkdir(dirname(join(replay, page)), { recursive: true });
    await writeFile(join(replay, page), `<!doctype html><p>${page}</p>`);
  }
  await mkdir(dirname(projectsFile), { recursive: true });
  await writeFile(projectsFile, JSON.stringify({ kind: 'ceobe.projects', projects: [] }));

  const first = await plan('a');
  assert.equal(names(first).length, 8, 'the first build decorates every page');
  await finalizeDecorationPlan(root, first, first.changed);

  assert.deepEqual(names(await plan('a')), [], 'identical inputs need no redecoration');

  // 模拟导入新会话：首页会话那一行进了 projects.html，但项目数据没变。
  await writeFile(join(replay, 'projects.html'), '<!doctype html><p>projects with a new home row 会话新的</p>');
  assert.deepEqual(names(await plan('a')), ['projects.html'], 'a home-row change must not invalidate conversation pages');
  const homeRow = await plan('a');
  await finalizeDecorationPlan(root, homeRow, homeRow.changed);

  // 项目数据变化：所有页面都要重做（侧栏项目行、移动菜单、项目标签）。
  await writeFile(projectsFile, JSON.stringify({ kind: 'ceobe.projects', projects: [{ id: 'p1', name: '项目一', conversation_ids: ['a'] }] }));
  assert.deepEqual(names(await plan('a')).length, 8, 'project data changes refresh every page');
  const projectsChanged = await plan('a');
  await finalizeDecorationPlan(root, projectsChanged, projectsChanged.changed);

  // 换首页（不重新渲染页面字节时）：只重做 5 个顶层页。
  assert.deepEqual(names(await plan('b')), [...topPages].sort(), 'switching the home page only refreshes top pages');
  const homeSwitch = await plan('b');
  await finalizeDecorationPlan(root, homeSwitch, homeSwitch.changed);

  // 单页字节变化：只重做这一页。
  assert.deepEqual(names(await plan('b')), []);
  await writeFile(join(replay, 'conversations/c.html'), '<!doctype html><p>conversations/c.html changed</p>');
  assert.deepEqual(names(await plan('b')), ['conversations/c.html'], 'a single page edit only refreshes that page');

  // 渲染器或模板变化：全站重做。
  assert.deepEqual(names(await plan('b', 'renderer-2')).length, 8, 'a renderer change refreshes every page');

  // 指纹文件损坏：宁可全量重做，也不带着过期指纹跳过。
  await writeFile(join(root, 'data/private/decoration-stamps.json'), '{broken');
  const corrupt = await plan('b');
  assert.equal(names(corrupt).length, 8, 'corrupt stamps fall back to a full refresh');
  await finalizeDecorationPlan(root, corrupt, corrupt.changed);
  const stamps = JSON.parse(await readFile(join(root, 'data/private/decoration-stamps.json'), 'utf8'));
  assert.equal(stamps.version, 2, 'stamps carry the decoration version');

  assert.deepEqual((await decorationPageList(replay)).sort(), [...topPages, ...conversationPages].sort(), 'page list stays top-first');
  console.log('PASS decoration plan: home-row change keeps conversation pages, project data and renderer refresh all, single-page edits stay local, corrupt stamps rebuild');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
