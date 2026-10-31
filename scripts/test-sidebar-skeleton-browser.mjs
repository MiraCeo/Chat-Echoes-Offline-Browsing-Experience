import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// The sidebar starts with one build-time row. Delay both catalog sources and
// assert that the visible first paint is a skeleton, not that single row.
const base = (process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const delay = async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  };
  await page.route('**/chats.json', delay);
  await page.route('**/api/chats', delay);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ceobe-sidebar-skeleton]', { timeout: 2000 });
  const early = await page.evaluate(() => ({
    skeletons: document.querySelectorAll('[data-ceobe-sidebar-skeleton]').length,
    visible: [...document.querySelectorAll('[data-ceobe-sidebar-skeleton]')].filter(node => node.checkVisibility()).length,
    rows: document.querySelectorAll('[data-chat-recent-list] li').length,
  }));
  assert.ok(early.skeletons >= 6, '首屏应显示骨架行');
  assert.ok(early.visible >= 6, '骨架行应可见');
  assert.equal(early.rows, early.skeletons, '数据到达前不应同时显示静态会话行');

  await page.screenshot({ path: 'data/private/sidebar-skeleton.png' });
  await page.waitForFunction(() => document.querySelectorAll('[data-ceobe-sidebar-skeleton]').length === 0, { timeout: 6000 });
  const late = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-chat-recent-list] li').length,
    status: document.documentElement.dataset.ceobeSidebarChats,
  }));
  assert.ok(late.rows > 6, '数据到达后应替换为完整侧栏');
  assert.equal(late.status, 'ready');
  assert.deepEqual(errors, [], '侧栏骨架不应产生页面错误');
  console.log(`PASS sidebar skeleton: ${early.visible} visible rows before data, ${late.rows} real rows after`);
} finally {
  await browser.close();
}
