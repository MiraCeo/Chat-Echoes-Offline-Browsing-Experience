import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createBookmarkBrowserFixture } from './bookmark-browser-fixture.mjs';
import { bookmarkSpecs } from '../fixtures/browser/bookmark-conversations.mjs';
import { assertBookmarkJump, measureBookmarkResize, settleBookmarkFrames as frames } from './bookmark-browser-checks.mjs';

const fixture = await createBookmarkBrowserFixture();
let browser;
try {
  const seeded = new Map();
  for (const profile of fixture.profiles) seeded.set(profile.id, await fixture.seed(bookmarkSpecs(profile)));
  const before = await fixture.snapshot();
  browser = await chromium.launch({ channel: 'msedge', headless: process.env.CEOBE_TEST_HEADED !== '1' });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('**/*', route => {
    assert.equal(new URL(route.request().url()).origin, new URL(fixture.base).origin, 'No external or personal API requests');
    assert.equal(route.request().method(), 'GET', 'Performance tests must be read-only');
    return route.continue();
  });
  for (const profile of fixture.profiles) {
    const notes = seeded.get(profile.id), url = fixture.base + `conversations/${profile.id}.html`;
    for (const panelOpen of [false, true]) {
      await p.goto(url, { waitUntil: 'networkidle' }); await frames(p);
      assert.equal(await p.locator('[data-bookmark-target]').count(), profile.messages);
      assert.equal(await p.locator('[data-bookmark-caption]').count(), profile.bookmarks);
      assert.equal(await p.locator('[data-bookmark-target]').last().evaluate(e => getComputedStyle(e).contentVisibility), 'auto');
      if (panelOpen) { await p.locator('.ceobe-bookmark-rail').click(); await frames(p); }
      await measureBookmarkResize(p, `${profile.id}/panel-${panelOpen}/lazy`);
    }
    // Test lazy scrolling BEFORE accurate-jump mode disables deferred layout.
    await p.goto(url, { waitUntil: 'networkidle' }); await frames(p);
    for (const width of [390, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      for (const note of [notes[0], notes.at(-1), notes[3], notes[Math.floor(notes.length / 2)]]) {
        const target = p.locator(`[data-bookmark-target="${note.message_id}"]`);
        // A large native scroll first uses intrinsic sizes; let the browser
        // settle newly rendered message heights before asserting visibility.
        for (let attempt = 0; attempt < 5; attempt++) {
          await target.scrollIntoViewIfNeeded(); await frames(p); await frames(p);
          if (await target.evaluate(e => e.hasAttribute('data-bookmark-near') && e.getBoundingClientRect().bottom > 0 && e.getBoundingClientRect().top < innerHeight)) break;
        }
        const g = await p.locator(`[data-bookmark-caption="${note.message_id}"]`).evaluate(e => {
          const r = e.getBoundingClientRect(); return { mode: e.dataset.bookmarkDisplay, x: r.x, right: r.right, width: r.width };
        });
        assert.ok(['icon', 'title', 'summary'].includes(g.mode) && g.width >= 28 && g.x >= -1 && g.right <= width + 1, JSON.stringify(g));
        const visible = await target.evaluate(e => ({ near: e.hasAttribute('data-bookmark-near'), top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom }));
        assert.ok(visible.near && visible.bottom > 0 && visible.top < 900, JSON.stringify({ profile: profile.id, width, id: note.message_id, ...visible }));
      }
    }
    await p.goto(url, { waitUntil: 'networkidle' }); await frames(p);
    await p.locator('.ceobe-bookmark-rail').click();
    await assertBookmarkJump(p, notes.at(-1));
    await measureBookmarkResize(p, `${profile.id}/panel-true/after-jump`);
    await p.keyboard.press('Escape');
    await measureBookmarkResize(p, `${profile.id}/panel-false/after-jump`);
  }
  assert.deepEqual(errors, []);
  assert.equal(await fixture.snapshot(), before, 'Fixture data unchanged by performance checks');
  console.log(`PASS independent bookmark resize (${fixture.production ? 'production' : 'development'}): 100/500 messages, 20/100 bookmarks, lazy scroll, exact jump, resize before/after jump, panel open/closed, no idle feedback loop.`);
} finally {
  if (browser) await browser.close();
  await fixture.close();
}
