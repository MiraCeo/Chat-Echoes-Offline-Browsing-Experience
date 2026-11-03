import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = (process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

  for (const width of [420, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + 'memory.html?group=global', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ceobe-memory-global-stats');
    assert.equal(await overflow(), false, `${width}: 记忆页不应横向溢出`);
    assert.ok(await page.locator('[data-memory-search]').isVisible(), `${width}: 搜索框应可见`);
    assert.ok(await page.locator('[data-memory-group]').count() >= 5, `${width}: 应有全局 + 四组`);
    await page.locator('.ceobe-memory-tree-details').first().locator('summary').click();
    assert.equal(await overflow(), false, `${width}: 展开 L5 后不应横向溢出`);
    await page.locator('[data-memory-search]').fill('TourGrid');
    await page.waitForSelector('.ceobe-memory-search-hit');
    assert.equal(await overflow(), false, `${width}: 搜索结果不应横向溢出`);

    await page.goto(base + 'project.html?id=4a801995-cd88-4b62-9686-d21ed87e2980', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-project-memory-summary]');
    assert.equal(await overflow(), false, `${width}: 项目页不应横向溢出`);
    assert.ok(await page.locator('[data-project-memory-summary]').isVisible(), `${width}: 项目组记忆摘要应可见`);

    await page.goto(base + 'timeline.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-timeline-memory]');
    assert.equal(await overflow(), false, `${width}: 时间线不应横向溢出`);
    assert.ok(await page.locator('[data-timeline-memory]').first().isVisible(), `${width}: 时间线记忆入口应可见`);

    await page.goto(base + 'conversations/6ae4e806-327c-83ec-909b-022374081dc1.html', { waitUntil: 'networkidle' });
    const readerEntry = width <= 640 ? '[data-reader-memory-mobile]' : '[data-reader-memory]';
    await page.waitForSelector(readerEntry);
    assert.equal(await overflow(), false, `${width}: 会话页不应横向溢出`);
    assert.ok(await page.locator(readerEntry).isVisible(), `${width}: 本会话记忆入口应可见`);
  }

  assert.deepEqual(errors, [], '多视口验收不应产生页面错误');
  console.log('PASS memory responsive: 420/900/1440 memory, project, timeline and reader entries without overflow');
} finally {
  await browser.close();
}
