import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// 时间线页的真实浏览器检查：入口位置（项目之后、更多之前）、标题、月份分组、条目数、
// 跳转到会话并高亮首条消息，以及从会话页回到时间线。默认连本地 5173 服务。
const base = (process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const response = await page.goto(base + 'timeline.html', { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200, '时间线页应可打开');
  const index = await (await page.request.get(base + 'timeline-index.json')).json();
  assert.equal(index.kind, 'ceobe.timeline-index');
  const expected = index.conversations.length;

  const state = await page.evaluate(() => {
    const row = document.querySelector('[data-ceobe-timeline-row]');
    const previous = row?.previousElementSibling;
    const next = row?.nextElementSibling;
    const rows = [...document.querySelectorAll('[data-ceobe-timeline-groups] .ceobe-timeline-row')];
    return {
      title: document.title,
      heading: document.querySelector('.ceobe-timeline h1')?.textContent,
      active: row?.getAttribute('aria-current'),
      href: row?.getAttribute('href'),
      previousIsProjects: Boolean(previous?.matches('[data-ceobe-projects-link]')),
      nextHasMore: Boolean(next && next.textContent.trim().startsWith('更多')),
      months: [...document.querySelectorAll('.ceobe-timeline-month h2')].map(node => node.textContent),
      monthCounts: [...document.querySelectorAll('.ceobe-timeline-month-count')].map(node => node.textContent.trim()),
      entries: rows.length,
      allLinks: rows.every(link => /\/conversations\/[^/]+\.html/.test(link.getAttribute('href') || '')),
      twoLineRows: rows.every(link => link.children.length === 2
        && link.firstElementChild?.classList.contains('ceobe-timeline-title')
        && link.lastElementChild?.classList.contains('ceobe-timeline-meta')
        && Boolean(link.querySelector('.ceobe-timeline-when'))
        && Boolean(link.querySelector('.ceobe-timeline-turns'))),
      datedFormat: [...document.querySelectorAll('time.ceobe-timeline-when')]
        .every(node => /\d{1,2}月\d{1,2}日 \d{2}:\d{2}/.test(node.textContent)),
      stickyHead: getComputedStyle(document.querySelector('.ceobe-timeline-month-head')).position,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      status: document.querySelector('[data-ceobe-timeline-status]')?.textContent,
    };
  });
  assert.equal(state.title, '时间线');
  assert.equal(state.heading, '时间线');
  assert.equal(state.active, 'page', '时间线页上的入口应标记当前页');
  assert.equal(state.href, './timeline.html');
  assert.equal(state.previousIsProjects, true, '入口在「项目」之后');
  assert.equal(state.nextHasMore, true, '入口在「更多」之前');
  assert.equal(state.overflowX, false, '页面不应横向溢出');
  assert.equal(state.entries, expected, '条目数应等于时间线索引里的会话数');
  assert.equal(state.allLinks, true, '每条都链到会话页');
  assert.equal(state.twoLineRows, true, '每行是“标题 + 时间/轮数”两行');
  assert.equal(state.datedFormat, true, '时间用统一的「M 月 D 日 HH:mm」格式');
  assert.equal(state.stickyHead, 'sticky', '月份标题在滚动时吸顶');
  assert.match(state.status, new RegExp(`${expected} 个会话`));
  assert.match(state.status, /本地时间/);
  if (expected) {
    assert.ok(state.months.length >= 1, '至少有一个月份分组');
    assert.equal(state.monthCounts.length, state.months.length, '每个月都有会话/轮数统计');
    assert.ok(state.monthCounts.every(text => /^\d+ 个会话 · [\d,]+ 轮$/.test(text)), '月统计格式');
  }

  // 跳转：首条进入会话页，并高亮首条消息。
  if (expected) {
    const first = page.locator('.ceobe-timeline-row').first();
    const href = await first.getAttribute('href');
    await first.click();
    await page.waitForLoadState('networkidle');
    const landed = await page.evaluate(() => ({ path: location.pathname, hash: location.hash, hasHighlight: Boolean(document.querySelector('.ceobe-bookmark-highlight')) }));
    assert.match(landed.path, /\/conversations\/[^/]+\.html$/);
    if (href.includes('#bookmark=')) assert.ok(landed.hash.startsWith('#bookmark='), '跳到首条消息锚点');
    assert.equal(landed.hasHighlight, true, '首条消息应有定位高亮');
    const back = await page.evaluate(() => {
      const link = document.querySelector('[data-ceobe-timeline-row]');
      return { href: link?.getAttribute('href'), active: link?.getAttribute('aria-current') };
    });
    assert.equal(back.href, '../timeline.html', '会话页上的入口应指回时间线');
    assert.equal(back.active, null, '会话页上入口不应标记当前页');
    await page.locator('[data-ceobe-timeline-row]').click();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.title(), '时间线', '从会话页可以回到时间线');
  }

  assert.deepEqual(errors, [], '没有页面错误');
  console.log('PASS timeline browser: nav slot (projects → timeline → more), active state, month groups, entry count, conversation jump with anchor highlight, return link, no overflow/errors');
} finally {
  await browser.close();
}
