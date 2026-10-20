import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Interaction smoke test: the crawler only proves pages render; this exercises the controls a
// reader actually touches, and fails on any page error while doing it.
const origin = process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));

  // 1. 首页：侧栏折叠开关
  await page.goto(new URL('index.html', origin).href, { waitUntil: 'networkidle' });
  // 侧栏开关监听指针事件/快捷键：DOM click 无效，用快捷键和真实鼠标点击验证。
  const readCollapsed = () => page.evaluate(() => document.documentElement.getAttribute('data-ceobe-sidebar-collapsed'));
  const before = await readCollapsed();
  await page.keyboard.press('Control+Shift+S');
  await page.waitForTimeout(350);
  const afterShortcut = await readCollapsed();
  assert.notEqual(afterShortcut, before, '快捷键应切换侧栏');
  const box = await page.locator('[data-ceobe-sidebar-toggle]').first().boundingBox();
  assert.ok(box, '侧栏按钮应有可点击区域');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);
  assert.equal(await readCollapsed(), before, '点击应切回原状态');

  // 2. 首页：资料库搜索
  // 搜索框藏在折叠面板里，先打开触发器，再直接派发 input/Enter（官方外壳会拦截指针）。
  const search = page.locator('input[type="search"][data-ceobe-source-search]').first();
  assert.ok(await search.count(), '首页应有资料库搜索框');
  await page.evaluate(() => document.querySelector('[data-ceobe-search-trigger]')?.click());
  await page.waitForTimeout(300);
  const typeSearch = value => search.evaluate((element, text) => {
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  }, value);
  await typeSearch('支付');
  await page.waitForTimeout(600);
  const hits = await page.locator('a[data-sidebar-item][href*="./conversations/"]').count();
  assert.ok(hits >= 1, `搜索“支付”应至少命中一条，实际 ${hits}`);
  await typeSearch('');
  await page.waitForTimeout(400);

  // 3. 资料库：筛选按钮换出不同行数
  await page.goto(new URL('assets.html', origin).href, { waitUntil: 'networkidle' });
  const rows = page.locator('[data-ceobe-asset-rows] [data-asset-open], [data-ceobe-asset-rows] .ceobe-asset');
  const allCount = await rows.count();
  assert.ok(allCount > 0, '资料库应有条目');
  const filters = page.locator('[data-asset-filter]');
  assert.ok(await filters.count() >= 3, '资料库应有全部/图片/文件筛选');
  const counts = {};
  for (const label of ['image', 'file', 'all']) {
    const button = page.locator(`[data-asset-filter="${label}"]`).first();
    await button.click();
    await page.waitForTimeout(300);
    counts[label] = await rows.count();
  }
  assert.equal(counts.all, allCount, '切回全部应恢复原数量');
  assert.ok(counts.image + counts.file >= counts.all, '图片 + 文件应覆盖全部条目');

  // 4. 项目页：新建对话框可开可关
  await page.goto(new URL('projects.html', origin).href, { waitUntil: 'networkidle' });
  const newProject = page.locator('[data-ceobe-project-new]').first();
  assert.ok(await newProject.count(), '项目页应有新建入口');
  // 同样被指针层挡住，走 DOM click。
  await page.evaluate(() => document.querySelector('[data-ceobe-project-new]').click());
  await page.waitForTimeout(500);
  const dialog = page.locator('dialog[open], [role="dialog"]');
  assert.ok(await dialog.count(), '新建入口应打开对话框');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Esc 应关闭对话框');

  assert.deepEqual(errors, [], `交互过程中出现页面错误：\n${errors.join('\n')}`);
  console.log(`App smoke: 侧栏折叠、搜索命中 ${hits} 条、资料库筛选 ${counts.all}/${counts.image}/${counts.file}、项目对话框开合正常。`);
} finally {
  await browser.close();
}
