import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = (process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const index = await (await page.request.get(base + 'timeline-index.json')).json();
  const [first, second] = index.conversations;
  assert.ok(first && second, '需要至少两个会话才能验证持久侧栏');
  const url = entry => base + 'conversations/' + entry.id + '.html';

  await page.goto(url(first), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ceobeSidebarChats === 'ready' && window.Turbo);
  const initial = await page.evaluate(() => {
    const sidebar = document.getElementById('stage-slideover-sidebar');
    sidebar.dataset.persistentMarker = 'keep-me';
    return {
      rows: document.querySelectorAll('[data-chat-recent-list] li').length,
      permanent: sidebar.hasAttribute('data-turbo-permanent'),
    };
  });
  assert.equal(initial.permanent, true, '侧栏应标记为 data-turbo-permanent');

  await page.locator(`a[href*="${second.id}.html"]`).first().click();
  await page.waitForFunction(id => location.pathname.endsWith(id + '.html'), second.id);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    marker: document.getElementById('stage-slideover-sidebar')?.dataset.persistentMarker || null,
    rows: document.querySelectorAll('[data-chat-recent-list] li').length,
    activeHref: document.querySelector('[data-chat-recent-list] a[aria-current="page"]')?.getAttribute('href') || null,
  }));
  assert.equal(after.marker, 'keep-me', '导航后侧栏 DOM 应被保留');
  assert.equal(after.rows, initial.rows, '导航后侧栏仍显示全部会话');
  assert.match(after.activeHref || '', new RegExp(second.id + '\\.html'), '活动项应更新为新会话');

  await page.goBack();
  await page.waitForFunction(id => location.pathname.endsWith(id + '.html'), first.id);
  await page.waitForTimeout(250);
  const back = await page.evaluate(() => ({
    marker: document.getElementById('stage-slideover-sidebar')?.dataset.persistentMarker || null,
    activeHref: document.querySelector('[data-chat-recent-list] a[aria-current="page"]')?.getAttribute('href') || null,
  }));
  assert.equal(back.marker, 'keep-me', '后退后侧栏 DOM 仍应保留');
  assert.match(back.activeHref || '', new RegExp(first.id + '\\.html'), '后退后活动项应恢复');
  assert.deepEqual(errors, [], 'Turbo 切换不应产生页面错误');
  console.log('PASS Turbo conversation navigation: sidebar node persists, full list stays, active follows URL, back restores state');
} finally {
  await browser.close();
}
