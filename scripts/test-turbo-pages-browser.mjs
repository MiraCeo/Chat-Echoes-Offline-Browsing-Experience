import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Top-level navigation must keep the browser-rendered sidebar and update the
// active top-level item. This complements the conversation-only Turbo test.
const base = (process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ceobeSidebarChats === 'ready');
  await page.evaluate(() => { document.getElementById('stage-slideover-sidebar').dataset.persistentMarker = 'keep-top'; });

  const check = async (selector, path, label) => {
    await page.locator(selector + ':visible').first().click();
    await page.waitForFunction(value => location.pathname.endsWith(value), path, { timeout: 10000 });
    await page.waitForFunction(() => (document.querySelector('main')?.textContent.trim().length || 0) > 40, { timeout: 5000 });
    const state = await page.evaluate(() => ({
      path: location.pathname,
      marker: document.getElementById('stage-slideover-sidebar')?.dataset.persistentMarker || null,
      active: [...document.querySelectorAll('[data-ceobe-import-share],[data-ceobe-asset-library-link],[data-ceobe-projects-link],[data-ceobe-timeline-row],[data-ceobe-memory-row]')]
        .filter(node => node.hasAttribute('data-active'))
        .map(node => node.getAttribute('aria-label') || node.textContent.trim()),
      main: document.querySelector('main')?.textContent.trim().length || 0,
    }));
    assert.equal(state.marker, 'keep-top', `${label}: sidebar DOM should persist`);
    assert.ok(state.active.length > 0, `${label}: top-level nav should be active`);
    assert.ok(state.active.every(value => value === label), `${label}: only the matching top-level nav should be active`);
    assert.ok(state.main > 40, `${label}: page content should render`);
    return state;
  };

  await check('[data-ceobe-import-share]', '/import.html', '导入会话');
  await check('[data-ceobe-asset-library-link]', '/assets.html', '资料库');
  await check('[data-ceobe-projects-link]', '/projects.html', '项目');
  await check('[data-ceobe-timeline-row]', '/timeline.html', '时间');
  await check('[data-ceobe-memory-row]', '/memory.html', '记忆');

  const chat = page.locator('[data-chat-recent-list] a').first();
  await chat.click();
  await page.waitForFunction(() => location.pathname.includes('/conversations/'));
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-recent-list] a[aria-current="page"]').length === 1, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.getElementById('stage-slideover-sidebar')?.dataset.persistentMarker), 'keep-top');
  assert.equal(await page.locator('[data-chat-recent-list] a[aria-current="page"]').count(), 1);
  assert.ok(await page.locator('[data-chat-recent-list] a[aria-current="page"]').first().getAttribute('href').then(href => !href.includes('/conversations/conversations/')), '侧栏链接不应重复 conversations 段');
  assert.deepEqual(errors, [], 'top-level Turbo navigation should not throw');
  console.log('PASS Turbo top-level navigation: import/assets/projects/timeline/memory keep sidebar and active state');
} finally {
  await browser.close();
}
