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
      view: document.querySelector('[data-ceobe-view][aria-selected="true"]')?.dataset.ceobeView,
      tabs: [...document.querySelectorAll('[data-ceobe-view]')].map(node => node.textContent.trim()),
      timelineHidden: document.querySelector('[data-ceobe-view-panel="timeline"]')?.hidden,
      axisHidden: document.querySelector('[data-ceobe-view-panel="axis"]')?.hidden,
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
  assert.equal(state.title, '时间');
  assert.equal(state.heading, '时间');
  assert.equal(state.view, 'timeline');
  assert.deepEqual(state.tabs, ['时间线', '时间轴']);
  assert.equal(state.timelineHidden, false);
  assert.equal(state.axisHidden, true);
  assert.equal(state.active, 'page', '时间页上的入口应标记当前页');
  assert.equal(state.href, './timeline.html');
  assert.equal(state.previousIsProjects, true, '入口在「项目」之后');
  assert.equal(state.nextHasMore, true, '入口在「更多」之前');
  assert.equal(state.overflowX, false, '页面不应横向溢出');
  assert.equal(state.entries, expected, '条目数应等于时间线索引里的会话数');
  assert.equal(state.allLinks, true, '每条都链到会话页');
  assert.equal(state.twoLineRows, true, '每行是“标题 + 时间/对话轮次”两行');
  assert.equal(state.datedFormat, true, '时间用统一的「M 月 D 日 HH:mm」格式');
  assert.equal(state.stickyHead, 'sticky', '月份标题在滚动时吸顶');
  assert.match(state.status, new RegExp(`${expected} 个会话`));
  assert.match(state.status, /本地时间/);
  if (expected) {
    assert.ok(state.months.length >= 1, '至少有一个月份分组');
    assert.equal(state.monthCounts.length, state.months.length, '每个月都有会话/对话轮次统计');
    assert.ok(state.monthCounts.every(text => /^\d+ 个会话 · [\d,]+ 轮对话$/.test(text)), '月统计格式');
  }

  // 时间顺序：默认最新在前，可切到最早在前，并在刷新后保留。
  const dated = index.conversations.filter(item => Number.isFinite(item.first));
  if (dated.length) {
    const newest = [...dated].sort((a, b) => b.first - a.first)[0];
    const oldest = [...dated].sort((a, b) => a.first - b.first)[0];
    const firstHref = async () => (await page.locator('.ceobe-timeline-row').first().getAttribute('href')) || '';
    assert.ok((await firstHref()).includes(newest.id), '默认第一条是最新会话');
    assert.equal(await page.locator('[data-ceobe-timeline-order="newest"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-ceobe-timeline-order="oldest"]').click();
    assert.ok((await firstHref()).includes(oldest.id), '切到最早在前后第一条是最早会话');
    assert.equal(await page.locator('[data-ceobe-timeline-order="oldest"]').getAttribute('aria-pressed'), 'true');
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok((await firstHref()).includes(oldest.id), '刷新后保留最早在前');
    await page.locator('[data-ceobe-timeline-order="newest"]').click();
    assert.ok((await firstHref()).includes(newest.id), '切回最新在前');
  }

  // 卡片视图：固定高度、两列、三列统计底栏，布局选择持久化。
  await page.locator('[data-ceobe-timeline-layout="cards"]').click();
  await page.waitForTimeout(120);
  const cardsState = await page.evaluate(() => {
    const grid = document.querySelector('.ceobe-timeline-cards');
    const cards = [...document.querySelectorAll('.ceobe-timeline-card')];
    return {
      cards: cards.length,
      rows: document.querySelectorAll('.ceobe-timeline-row').length,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      stats: document.querySelectorAll('.ceobe-timeline-card-stats').length,
      statCells: document.querySelectorAll('.ceobe-timeline-card-stat').length,
      charPairs: document.querySelectorAll('.ceobe-timeline-card-char-pair').length,
      models: [...document.querySelectorAll('.ceobe-timeline-card-stat-model .ceobe-timeline-card-stat-value')].map(node => node.textContent),
      multiModels: [...document.querySelectorAll('.ceobe-timeline-card-stat-model .ceobe-timeline-card-stat-value')]
        .filter(node => node.textContent.includes('（共')).length,
      charKinds: [...document.querySelectorAll('.ceobe-timeline-card-char-kind')].map(node => node.textContent),
      active: [...document.querySelectorAll('.ceobe-timeline-card-stat-active .ceobe-timeline-card-stat-value')].map(node => node.textContent),
      rounds: document.querySelectorAll('.ceobe-timeline-card-rounds').length,
      heights: cards.map(card => Math.round(card.getBoundingClientRect().height)),
      pressed: document.querySelector('[data-ceobe-timeline-layout="cards"]')?.getAttribute('aria-pressed'),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  assert.equal(cardsState.cards, expected, '卡片视图应有全部会话卡片');
  assert.equal(cardsState.rows, 0, '卡片视图不渲染列表行');
  assert.equal(cardsState.columns, 2, '桌面卡片为两列');
  assert.equal(cardsState.stats, expected, '每张卡片都应有统计底栏');
  assert.equal(cardsState.statCells, expected * 3, '每张卡片三列统计');
  assert.equal(cardsState.charPairs, expected * 2, '字符列拆成用户/助手两个子列');
  assert.equal(cardsState.charKinds.length, expected * 2);
  assert.deepEqual(cardsState.charKinds.slice(0, 2), ['用户', '助手'], '字符子列有独立标签');
  assert.equal(cardsState.multiModels, index.conversations.filter(item => Array.isArray(item.models) && item.models.length > 1).length, '多模型显示主模型 + 共N个');
  assert.ok(cardsState.models.every(Boolean), '每张卡片都有模型');
  assert.ok(cardsState.active.every(text => /^\d+\/\d+ 天$/.test(text)), '活跃列显示 N/M 天');
  assert.equal(cardsState.rounds, expected, '每张卡片都显示轮数');
  assert.equal(new Set(cardsState.heights).size, 1, '固定卡片应等高');
  assert.equal(cardsState.heights[0], 200, '固定卡片高度为 200px');
  assert.equal(cardsState.pressed, 'true');
  assert.equal(cardsState.overflowX, false);
  await page.reload({ waitUntil: 'networkidle' });
  const cardsPersisted = await page.evaluate(() => ({
    cards: document.querySelectorAll('.ceobe-timeline-card').length,
    pressed: document.querySelector('[data-ceobe-timeline-layout="cards"]')?.getAttribute('aria-pressed'),
  }));
  assert.equal(cardsPersisted.cards, expected, '刷新后保留卡片视图');
  assert.equal(cardsPersisted.pressed, 'true');
  await page.locator('[data-ceobe-timeline-layout="list"]').click();
  assert.equal(await page.locator('.ceobe-timeline-row').count(), expected, '切回列表恢复全部行');

  // 时间轴：缩略图、详情卡片、视口框，以及点击缩略图定位详情。
  await page.locator('[data-ceobe-view="axis"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.ceobe-axis-card').length > 0);
  const axis = await page.evaluate(() => {
    const detail = document.querySelector('.ceobe-axis-detail-scroll');
    return {
      view: document.querySelector('[data-ceobe-view][aria-selected="true"]')?.dataset.ceobeView,
      cards: document.querySelectorAll('.ceobe-axis-card').length,
      bars: document.querySelectorAll('.ceobe-axis-overview-bar').length,
      windowRole: document.querySelector('.ceobe-axis-window')?.getAttribute('role'),
      windowWidth: document.querySelector('.ceobe-axis-window')?.style.width,
      detailLeft: Math.round(detail.scrollLeft),
      detailMax: detail.scrollWidth - detail.clientWidth,
      viewParam: new URLSearchParams(location.search).get('view'),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  assert.equal(axis.view, 'axis');
  assert.equal(axis.cards, expected, '时间轴详情应有全部会话卡片');
  assert.equal(axis.bars, expected, '缩略图应有全部会话条');
  assert.equal(axis.windowRole, 'slider', '视口框应可聚焦/键盘操作');
  assert.ok(Number.parseFloat(axis.windowWidth) > 0, '视口框应有宽度');
  assert.equal(axis.detailLeft, axis.detailMax, '时间轴默认停在最新');
  assert.equal(axis.viewParam, 'axis');
  assert.equal(axis.overflowX, false);
  if (expected) {
    const chart = await page.locator('.ceobe-axis-overview-chart').boundingBox();
    const before = axis.detailLeft;
    await page.mouse.click(chart.x + chart.width * 0.2, chart.y + 50);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => Math.round(document.querySelector('.ceobe-axis-detail-scroll').scrollLeft));
    assert.ok(after < before, '点击缩略图左侧应把详情向前移动');
  }
  await page.locator('[data-ceobe-view="timeline"]').click();

  // 窄屏：排序控件仍在、页面不横向溢出。
  await page.setViewportSize({ width: 480, height: 800 });
  await page.reload({ waitUntil: 'networkidle' });
  const mobile = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    controls: [...document.querySelectorAll('[data-ceobe-timeline-order]')].every(button => button.getBoundingClientRect().width > 0),
    entries: document.querySelectorAll('.ceobe-timeline-row').length,
  }));
  assert.equal(mobile.overflowX, false, '窄屏不应横向溢出');
  assert.equal(mobile.controls, true, '窄屏仍能看到排序控件');
  assert.equal(mobile.entries, expected, '窄屏条目数不变');
  await page.locator('[data-ceobe-timeline-layout="cards"]').click();
  const mobileCards = await page.evaluate(() => {
    const grid = document.querySelector('.ceobe-timeline-cards');
    return {
      cards: document.querySelectorAll('.ceobe-timeline-card').length,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      controls: [...document.querySelectorAll('[data-ceobe-timeline-layout]')].every(button => button.getBoundingClientRect().width > 0),
    };
  });
  assert.equal(mobileCards.cards, expected);
  assert.equal(mobileCards.columns, 1, '窄屏卡片为单列');
  assert.equal(mobileCards.overflowX, false);
  assert.equal(mobileCards.controls, true);
  await page.locator('[data-ceobe-timeline-layout="list"]').click();
  await page.locator('[data-ceobe-view="axis"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.ceobe-axis-card').length > 0);
  const mobileAxis = await page.evaluate(() => {
    const win = document.querySelector('.ceobe-axis-window').getBoundingClientRect();
    const ovw = document.querySelector('.ceobe-axis-overview-scroll').getBoundingClientRect();
    return {
      windowVisible: win.right > ovw.left && win.left < ovw.right,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      cards: document.querySelectorAll('.ceobe-axis-card').length,
    };
  });
  assert.equal(mobileAxis.overflowX, false, '窄屏时间轴不应横向溢出');
  assert.equal(mobileAxis.windowVisible, true, '窄屏视口框应在缩略图可视范围内');
  assert.equal(mobileAxis.cards, expected);
  await page.locator('[data-ceobe-view="timeline"]').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });

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
    assert.equal(back.href, '../timeline.html', '会话页上的入口应指回时间');
    assert.equal(back.active, null, '会话页上入口不应标记当前页');
    await page.locator('[data-ceobe-timeline-row]').click();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.title(), '时间', '从会话页可以回到时间');
  }

  // 时区回归：浏览器在 UTC 时，展示仍应使用索引记录的构建时区，进度不能出现 3/2。
  if (expected) {
    const utcContext = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1280, height: 900 } });
    const utcPage = await utcContext.newPage();
    const utcErrors = [];
    utcPage.on('pageerror', error => utcErrors.push(error.message));
    await utcPage.goto(base + 'timeline.html', { waitUntil: 'networkidle' });
    const utcState = await utcPage.evaluate(() => ({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      firstMeta: document.querySelector('.ceobe-timeline-row .ceobe-timeline-meta')?.textContent || '',
    }));
    const newest = [...index.conversations].filter(item => Number.isFinite(item.first)).sort((a, b) => b.first - a.first)[0];
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: index.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const values = Object.fromEntries(fmt.formatToParts(new Date(newest.first * 1000)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const expectedTime = `${Number(values.month)}月${Number(values.day)}日 ${values.hour}:${values.minute}`;
    assert.equal(utcState.tz, 'UTC');
    assert.ok(utcState.firstMeta.includes(expectedTime), 'UTC 浏览器仍按构建时区显示首条时间');
    await utcPage.locator('[data-ceobe-timeline-layout="cards"]').click();
    const utcCards = await utcPage.evaluate(() => ({
      cards: document.querySelectorAll('.ceobe-timeline-card').length,
      stats: document.querySelectorAll('.ceobe-timeline-card-stats').length,
      models: [...document.querySelectorAll('.ceobe-timeline-card-stat-model .ceobe-timeline-card-stat-value')].every(node => node.textContent.length > 0),
      active: [...document.querySelectorAll('.ceobe-timeline-card-stat-active .ceobe-timeline-card-stat-value')].every(node => /^\d+\/\d+ 天$/.test(node.textContent)),
    }));
    assert.equal(utcCards.cards, expected);
    assert.equal(utcCards.stats, expected);
    assert.equal(utcCards.models, true, 'UTC 浏览器仍显示模型');
    assert.equal(utcCards.active, true, 'UTC 浏览器仍显示活跃天数');
    await utcPage.locator('[data-ceobe-view="axis"]').click();
    await utcPage.waitForFunction(() => document.querySelectorAll('.ceobe-axis-card').length > 0);
    assert.equal(await utcPage.locator('.ceobe-axis-card').count(), expected, 'UTC 浏览器时间轴仍有全部会话');
    assert.deepEqual(utcErrors, [], 'UTC 浏览器没有页面错误');
    await utcContext.close();
  }

  // 摘要骨架：只有 fresh 且 last_message_id 匹配的条目才渲染，缺失/过期/不匹配不占位。
  if (expected >= 3) {
    const [fresh, stale, mismatch] = index.conversations;
    const summaryPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const summaryErrors = [];
    summaryPage.on('pageerror', error => summaryErrors.push(error.message));
    await summaryPage.route('**/timeline-summaries.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: '1.0.0',
        kind: 'ceobe.timeline-summaries',
        conversations: {
          [fresh.id]: {
            summary: '骨架摘要：这是一条用于验证卡片布局的测试摘要。',
            tags: ['骨架标签', '测试'],
            status: 'fresh',
            source: { last_message_id: fresh.last_message_id },
          },
          [stale.id]: {
            summary: '这条摘要已经过期，不应显示。',
            tags: ['过期标签'],
            status: 'stale',
            source: { last_message_id: stale.last_message_id },
          },
          [mismatch.id]: {
            summary: '源消息不匹配，不应显示。',
            tags: ['不匹配标签'],
            status: 'fresh',
            source: { last_message_id: 'different-message' },
          },
        },
      }),
    }));
    await summaryPage.goto(base + 'timeline.html', { waitUntil: 'networkidle' });
    await summaryPage.locator('[data-ceobe-timeline-layout="cards"]').click();
    await summaryPage.waitForTimeout(120);
    const summaryState = await summaryPage.evaluate(() => ({
      count: document.querySelectorAll('.ceobe-timeline-card-summary').length,
      text: document.querySelector('.ceobe-timeline-card-summary')?.textContent,
      stale: [...document.querySelectorAll('.ceobe-timeline-card-summary')]
        .some(node => node.textContent.includes('过期')),
      mismatch: [...document.querySelectorAll('.ceobe-timeline-card-summary')]
        .some(node => node.textContent.includes('不匹配')),
      aiLabel: document.querySelector('.ceobe-timeline-card-summary')?.getAttribute('data-ai-summary') != null,
      tagCount: document.querySelectorAll('.ceobe-timeline-card-tag').length,
      tagsText: [...document.querySelectorAll('.ceobe-timeline-card-tag')].map(node => node.textContent).join('、'),
      tagsAi: document.querySelector('.ceobe-timeline-card-tags')?.getAttribute('data-ai-tags') != null,
      staleTags: [...document.querySelectorAll('.ceobe-timeline-card-tag')]
        .some(node => node.textContent.includes('过期') || node.textContent.includes('不匹配')),
    }));
    assert.equal(summaryState.count, 1, '只渲染 fresh 且源匹配的摘要');
    assert.match(summaryState.text, /骨架摘要/);
    assert.equal(summaryState.stale, false);
    assert.equal(summaryState.mismatch, false);
    assert.equal(summaryState.aiLabel, true, '摘要节点应带 data-ai-summary 标记');
    assert.equal(summaryState.tagCount, 2, '摘要和 tag 来自同一条 fresh 记录');
    assert.equal(summaryState.tagsText, '骨架标签、测试');
    assert.equal(summaryState.tagsAi, true, 'tag 容器应带 data-ai-tags 标记');
    assert.equal(summaryState.staleTags, false, '过期/不匹配记录的 tag 不应显示');
    assert.deepEqual(summaryErrors, [], '摘要夹具没有页面错误');
    await summaryPage.close();
  }

  assert.deepEqual(errors, [], '没有页面错误');
  console.log('PASS timeline browser: 时间 nav slot, 时间线 列表/卡片, 时间轴 views, rounds, UTC timezone, summary skeleton, mobile viewport, conversation jump, no overflow/errors');
} finally {
  await browser.close();
}
