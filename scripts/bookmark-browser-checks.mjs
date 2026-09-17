import assert from 'node:assert/strict';
export const settleBookmarkFrames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
export async function measureBookmarkResize(page, label) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const requests = [], onRequest = r => { if (r.resourceType() === 'document' || new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url()); };
  await page.setViewportSize({ width: 1440, height: 900 });
  await settleBookmarkFrames(page);
  await page.evaluate(() => {
    window.fixtureResizeCount = 0;
    window.fixtureResizeListener = () => window.fixtureResizeCount++;
    addEventListener('resize', window.fixtureResizeListener);
  });
  page.on('request', onRequest);
  try {
    const before = await metrics(), started = Date.now();
    for (const width of [1380, 1320, 1260, 1200, 1140, 1080, 1020, 960, 900, 960, 1020, 1080, 1140, 1200, 1260, 1320, 1380, 1440, 1500]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    }
    await settleBookmarkFrames(page);
    const after = await metrics();
    const events = await page.evaluate(() => window.fixtureResizeCount);
    const sample = { label, events, elapsedMs: Date.now() - started,
      layouts: after.LayoutCount - before.LayoutCount, styles: after.RecalcStyleCount - before.RecalcStyleCount,
      layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000),
      styleMs: Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000) };
    assert.ok(events >= 15, JSON.stringify(sample));
    assert.ok(sample.layouts <= events * 8 + 24, JSON.stringify(sample));
    assert.ok(sample.styles <= events * 12 + 24, JSON.stringify(sample));
    assert.deepEqual(requests, [], 'Resizing must not reload documents or APIs');
    const stable = await metrics();
    for (let i = 0; i < 6; i++) await settleBookmarkFrames(page);
    const idle = await metrics();
    assert.ok(idle.LayoutCount - stable.LayoutCount <= 4, 'Idle layout feedback loop');
    assert.ok(idle.RecalcStyleCount - stable.RecalcStyleCount <= 8, 'Idle style feedback loop');
    console.log('RESIZE ' + JSON.stringify(sample));
    return sample;
  } finally {
    page.off('request', onRequest);
    await page.evaluate(() => removeEventListener('resize', window.fixtureResizeListener));
    await cdp.detach();
  }
}
export async function assertBookmarkJump(page, bookmark) {
  await page.locator(`[data-bookmark-jump="${bookmark.id}"]`).click();
  await page.waitForFunction(id => {
    const target = document.querySelector(`[data-bookmark-target="${id}"]`);
    return Math.abs(target.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom - 8) < 8;
  }, bookmark.message_id);
  assert.equal(await page.locator('html').getAttribute('data-ceobe-accurate-turn-layout'), '');
}
