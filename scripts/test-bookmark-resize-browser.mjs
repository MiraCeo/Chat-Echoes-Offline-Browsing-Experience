import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const prod = process.env.CEOBE_TEST_DIST === '1'
  ? await preview({ configFile: 'vite.config.mjs', root: 'replay', build: { outDir: '../dist' }, preview: { host: '127.0.0.1', port: 0 } }) : null;
const base = prod ? `http://127.0.0.1:${prod.httpServer.address().port}/` : 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: process.env.CEOBE_TEST_HEADED !== '1' });
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Performance.enable');
  const original = await (await p.request.get(base + 'api/bookmarks')).json();
  let state = [], measuring = false, requests = [];
  const errors = [], results = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('request', r => { if (measuring && (r.resourceType() === 'document' || new URL(r.url()).pathname.startsWith('/api/'))) requests.push(r.url()); });
  await p.route('**/api/**', route => {
    assert.equal(route.request().method(), 'GET', 'Never write real stores');
    if (new URL(route.request().url()).pathname === '/api/bookmarks') return route.fulfill({ json: { bookmarks: state, writable: true } });
    return route.continue();
  });
  if (process.env.CEOBE_TEST_SOURCE === '1' && !prod)
    await p.route('**/bookmarks.*.js', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('./bookmarks.js', import.meta.url), 'utf8') }));
  if (process.env.CEOBE_TEST_SOURCE === '1' && !prod)
    await p.route('**/reader-ui.*.css', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + '\n' + await readFile(new URL('./reader-ui.css', import.meta.url), 'utf8') });
    });
  const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await p.goto(base, { waitUntil: 'networkidle' });
  const seed = await p.locator('#ceobe-bookmark-data').evaluate(e => JSON.parse(e.textContent));
  assert.ok(seed.targets.length >= 14, 'Use a conversation with at least 14 visible message targets');
  state = seed.targets.slice(0, 14).map((t, i) => ({ id: 'resize-fixture-' + i, chat_id: seed.chatId, message_id: t.message_id,
    role: t.role, title: '尺寸回归书签 ' + i, note: '这是一条用于连续缩放性能验收的独立长备注。'.repeat(40),
    chat_title: '性能夹具', excerpt: '原消息摘要', order: i, version: 1, target_state: 'available',
    created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }));
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  for (const panelOpen of [false, true]) {
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(base, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await frames();
    assert.equal(await p.locator('[data-bookmark-target]').last().evaluate(e => getComputedStyle(e).contentVisibility), 'auto', 'Offscreen rendering must also work without preview attachments');
    if (panelOpen) { await p.locator('.ceobe-bookmark-rail').click(); await frames(); }
    assert.equal(await p.locator('[data-bookmark-caption]').count(), 14);
    await p.evaluate(() => {
      window.resizeEvents = 0;
      window.onResizeCount = () => window.resizeEvents++;
      addEventListener('resize', window.onResizeCount);
    });
    requests = []; measuring = true;
    const before = await metrics(), started = Date.now();
    for (const width of [1380, 1320, 1260, 1200, 1140, 1080, 1020, 960, 900, 960, 1020, 1080, 1140, 1200, 1260, 1320, 1380, 1440, 1500]) {
      await p.setViewportSize({ width, height: 900 });
      await p.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    }
    await frames();
    const after = await metrics(); measuring = false;
    const count = await p.evaluate(() => { removeEventListener('resize', window.onResizeCount); return window.resizeEvents; });
    const sample = { panelOpen, resizeEvents: count, elapsedMs: Date.now() - started,
      layouts: after.LayoutCount - before.LayoutCount, styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount,
      layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000),
      styleMs: Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000) };
    assert.ok(count >= 15, JSON.stringify(sample));
    // Structural budgets detect per-caption forced layouts without a brittle
    // wall-clock threshold dependent on machine load, display refresh or CI speed.
    assert.ok(sample.layouts <= count * 8 + 24, JSON.stringify(sample));
    assert.ok(sample.styleRecalculations <= count * 12 + 24, JSON.stringify(sample));
    assert.deepEqual(requests, [], 'Resizing must not reload the page or refresh APIs');
    results.push(sample);
    // Pending frames must settle; no observer/layout feedback loop while idle.
    const stable = await metrics();
    for (let i = 0; i < 6; i++) await frames();
    const idle = await metrics();
    assert.ok(idle.LayoutCount - stable.LayoutCount <= 4, 'Layout continued while idle');
    assert.ok(idle.RecalcStyleCount - stable.RecalcStyleCount <= 8, 'Style writes continued while idle');
  }
  // Offscreen targets still become correctly laid out when reached, and the
  // existing exact-jump mode must keep working after lazy measurements.
  await p.goto(base, { waitUntil: 'networkidle' }); await frames();
  await p.locator('.ceobe-bookmark-rail').click();
  const last = state.at(-1);
  await p.locator('[data-bookmark-jump="' + last.id + '"]').click();
  await p.waitForFunction(id => {
    const section = document.querySelector('[data-bookmark-target="' + id + '"]');
    const top = document.querySelector('header').getBoundingClientRect().bottom + 8;
    return Math.abs(section.getBoundingClientRect().top - top) < 8;
  }, last.message_id);
  assert.equal(await p.locator('html').getAttribute('data-ceobe-accurate-turn-layout'), '');
  await p.keyboard.press('Escape');
  for (const width of [390, 1440]) {
    await p.setViewportSize({ width, height: 900 }); await frames();
    for (const index of [0, 13, 3, 10]) {
      const id = state[index].message_id;
      await p.locator('[data-bookmark-target="' + id + '"]').evaluate(e => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await frames();
      const g = await p.locator('[data-bookmark-caption="' + id + '"]').evaluate(e => {
        const r = e.getBoundingClientRect();
        return { mode: e.dataset.bookmarkDisplay, x: r.x, right: r.right, width: r.width };
      });
      assert.ok(['icon', 'title', 'summary'].includes(g.mode) && g.width >= 28 && g.x >= -1 && g.right <= width + 1, JSON.stringify({ width, index, g }));
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await (await p.request.get(base + 'api/bookmarks')).json(), original);
  console.log('PASS continuous bookmark resize (' + (prod ? 'production' : 'development') + '): ' + JSON.stringify(results) + '; mocked notes, GET-only, no idle feedback loop.');
} finally {
  await browser.close();
  if (prod) await new Promise(r => prod.httpServer.close(r));
}
