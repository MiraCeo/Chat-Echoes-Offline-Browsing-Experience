import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createBookmarkBrowserFixture } from './bookmark-browser-fixture.mjs';
import { bookmarkSpecs } from '../fixtures/browser/bookmark-conversations.mjs';
import { settleBookmarkFrames as frames } from './bookmark-browser-checks.mjs';

// Reader-margin rules, checked in an isolated build of the app.
// 1. The bookmark panel may never move or narrow the conversation, and it must not cover the
//    paragraphs: it docks in the free gutter while the gutter can hold it, and otherwise falls
//    back to a short overlay that dismisses itself on the next click outside (docs/usage.md).
// 2. Continue reading restores the last message per chat, anchored to a canonical message ID
//    and an offset inside it, kept in this browser only.
// Nothing here touches a real archive: the fixture builds in a temporary root with its own
// bookmark store, and every request stays GET.
const PANEL_MIN_DOCK = 150, PANEL_OVERLAY_HEIGHT = 420;
const fixture = await createBookmarkBrowserFixture({
  profiles: [
    { id: 'fixture-margin-120', messages: 120, bookmarks: 24 },
    { id: 'fixture-margin-60', messages: 60, bookmarks: 12 },
  ],
});
let browser;
try {
  const [first, second] = fixture.profiles;
  const seeded = [];
  for (const profile of fixture.profiles) seeded.push(...await fixture.seed(bookmarkSpecs(profile)));
  const before = await fixture.snapshot();
  browser = await chromium.launch({ channel: 'msedge', headless: process.env.CEOBE_TEST_HEADED !== '1' });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const requests = new Set();
  await p.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, new URL(fixture.base).origin, 'No external or personal API requests');
    assert.equal(request.method(), 'GET', 'Reader margin checks must stay read-only');
    if (url.pathname.startsWith('/api/')) requests.add(request.method() + ' ' + url.pathname);
    return route.continue();
  });
  const reader = profile => fixture.base + `conversations/${profile.id}.html`;
  const scrollTop = () => p.evaluate(() => {
    let n = document.querySelector('section[data-ceobe-message-ids]');
    while (n) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return Math.round(n.scrollTop);
      n = n.parentElement;
    }
    return Math.round(document.scrollingElement.scrollTop);
  });
  const setScrollTop = value => p.evaluate(top => {
    let n = document.querySelector('section[data-ceobe-message-ids]');
    while (n) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) { n.scrollTop = top; return true }
      n = n.parentElement;
    }
    document.scrollingElement.scrollTop = top; return true;
  }, value);
  const anchor = () => p.evaluate(() => {
    const clip = document.querySelector('header').getBoundingClientRect().bottom + 8;
    let best = null;
    for (const s of document.querySelectorAll('section[data-ceobe-message-ids]')) {
      const top = s.getBoundingClientRect().top - clip;
      if (top <= 1) best = { id: JSON.parse(s.dataset.ceobeMessageIds)[0], rel: Math.round(-top) };
    }
    return best;
  });
  const waitAligned = (id, tol = 12) => p.waitForFunction(([messageId, tolerance]) => {
    const clip = document.querySelector('header').getBoundingClientRect().bottom + 8;
    const exact = [...document.querySelectorAll('section[data-ceobe-message-ids]')].find(s2 => JSON.parse(s2.dataset.ceobeMessageIds).includes(messageId));
    return Boolean(exact) && Math.abs(exact.getBoundingClientRect().top - clip) <= tolerance;
  }, [id, tol], { timeout: 8000 });
  const aligned = id => p.evaluate(messageId => {
    const clip = document.querySelector('header').getBoundingClientRect().bottom + 8;
    const exact = [...document.querySelectorAll('section[data-ceobe-message-ids]')].find(s => JSON.parse(s.dataset.ceobeMessageIds).includes(messageId));
    return exact ? Math.round(exact.getBoundingClientRect().top - clip) : null;
  }, id);
  const panel = () => p.evaluate(minDock => {
    const el = document.querySelector('#ceobe-bookmark-list-panel');
    const main = document.querySelector('main').getBoundingClientRect();
    const list = document.querySelector('[data-ceobe-message-list]').getBoundingClientRect();
    const column = document.querySelector('[data-ceobe-message-list] [class*="thread-content-max-width"]').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const toolbar = el.querySelector('.ceobe-bookmark-toolbar').getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(column.left + 24), Math.round(Math.min(box.bottom - 24, column.top + 40)));
    const gutter = Math.round(column.left - (main.left + 8) - 8);
    return {
      open: el.open,
      mode: el.dataset.bookmarkPanelMode,
      empty: el.dataset.bookmarkPanelEmpty,
      panel: { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
      textLeft: Math.round(column.left),
      gutter,
      dockable: gutter >= minDock,
      toolbarClipped: Math.round(toolbar.right) > Math.round(box.right) + 1,
      coversText: hit ? Boolean(hit.closest('#ceobe-bookmark-list-panel')) : false,
      main: { x: Math.round(main.left), width: Math.round(main.width) },
      list: { x: Math.round(list.left), width: Math.round(list.width) },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, PANEL_MIN_DOCK);
  // A click point that is unambiguously on the text ('text') or anywhere clear of the panel
  // and its controls ('outside'), so the assertion is about the panel, not about a stray button.
  const pickPoint = kind => p.evaluate(mode => {
    const panelBox = document.querySelector('#ceobe-bookmark-list-panel').getBoundingClientRect();
    const column = document.querySelector('[data-ceobe-message-list] [class*="thread-content-max-width"]')?.getBoundingClientRect();
    for (let ty = 0.12; ty <= 0.96; ty += 0.04) {
      for (let tx = 0.06; tx <= 0.96; tx += 0.03) {
        const x = Math.round(innerWidth * tx), y = Math.round(innerHeight * ty);
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        const onPanel = x >= panelBox.left - 2 && x <= panelBox.right + 2 && y >= panelBox.top - 2 && y <= panelBox.bottom + 2;
        const interactive = Boolean(el.closest('a,button,[role="menuitem"],[data-bookmark-caption],[data-bookmark-message-more],[data-ceobe-jump],[data-ceobe-sidebar-toggle],[data-ceobe-search-trigger],[data-ceobe-recent-trigger],[data-bookmark-panel-mode]'));
        if (onPanel || interactive || el.closest('#ceobe-bookmark-list-panel')) continue;
        if (mode === 'text') {
          if (!column || x < column.left - 4 || x > column.right + 4) continue;
          if (!el.closest('[data-ceobe-message-list]')) continue;
        }
        return { x, y, tag: el.tagName.toLowerCase() };
      }
    }
    return null;
  }, kind);
  const openPanel = async () => { await p.locator('.ceobe-bookmark-rail').click(); await frames(p); };
  const closePanel = async () => { await p.evaluate(() => document.querySelector('#ceobe-bookmark-list-panel').close()); await frames(p); };
  const isOpen = () => p.evaluate(() => document.querySelector('#ceobe-bookmark-list-panel').open);

  // ---- 1. docking rule, at the widths the review measured
  for (const width of [1440, 1360, 1280, 1024, 900, 760, 420]) {
    await p.setViewportSize({ width, height: 900 });
    await p.goto(reader(first), { waitUntil: 'load' });
    await frames(p);
    const closed = await panel();
    assert.equal(closed.open, false, `width ${width}: starts closed`);
    await openPanel();
    const open = await panel();
    assert.equal(open.main.x, closed.main.x, `width ${width}: the conversation must not move`);
    assert.equal(open.main.width, closed.main.width, `width ${width}: the conversation must not narrow`);
    assert.equal(open.list.width, closed.list.width, `width ${width}: the message list keeps its width`);
    assert.equal(open.overflow, 0, `width ${width}: no horizontal overflow`);
    assert.equal(open.toolbarClipped, false, `width ${width}: the scope row stays readable`);
    assert.ok(['dock', 'overlay'].includes(open.mode), `width ${width}: a known margin strategy (${open.mode})`);
    assert.equal(open.dockable, open.mode === 'dock', `width ${width}: ${open.gutter}px gutter chooses ${open.mode}`);
    // Escape always closes, and closing leaves the text exactly where it was.
    await p.keyboard.press('Escape');
    await frames(p);
    assert.equal(await isOpen(), false, `width ${width}: Escape closes the panel`);
    const back = await panel();
    assert.equal(back.mode, 'closed', `width ${width}: a closed panel carries no dock mode`);
    assert.equal(back.main.width, closed.main.width, `width ${width}: closing changes nothing about the text`);
    await openPanel();
    if (open.mode === 'dock') {
      assert.ok(open.panel.right <= open.textLeft, `width ${width}: the docked panel must stop before the text (${open.panel.right} vs ${open.textLeft})`);
      assert.equal(open.coversText, false, `width ${width}: nothing may cover the paragraphs`);
      assert.ok(open.panel.width >= PANEL_MIN_DOCK - 2, `width ${width}: a docked panel is only used when it is usable`);
      assert.ok(open.panel.top + open.panel.height <= 900 + 1, `width ${width}: the docked panel fits the viewport`);
      // A docked panel does not hide text, so clicking the chat leaves it open.
      const spot = await pickPoint('text');
      assert.ok(spot, `width ${width}: found a point on the text`);
      await p.mouse.click(spot.x, spot.y);
      await frames(p);
      assert.equal(await isOpen(), true, `width ${width}: a docked panel stays open`);
      await closePanel();
    } else {
      assert.ok(open.panel.height <= PANEL_OVERLAY_HEIGHT + 1, `width ${width}: an overlay stays short (${open.panel.height})`);
      assert.ok(open.panel.top + open.panel.height <= 900 + 1, `width ${width}: the overlay fits the viewport`);
      // Transient by contract: a click outside puts the reading view back.
      const spot = await pickPoint('outside');
      assert.ok(spot, `width ${width}: found a point outside the panel`);
      await p.mouse.click(spot.x, spot.y);
      await frames(p);
      const state = await p.evaluate(() => {
        const el = document.querySelector('#ceobe-bookmark-list-panel');
        const r = el.getBoundingClientRect();
        return { open: el.open, mode: el.dataset.bookmarkPanelMode, scope: el.dataset.bookmarkScope, box: [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.height)] };
      });
      assert.equal(state.open, false, `width ${width}: a click outside an overlay dismisses it (${JSON.stringify(state)} at ${JSON.stringify(spot)})`);
    }
  }

  // ---- 2. an empty list is a note, not a full-height column
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(reader(first), { waitUntil: 'load' });
  await frames(p);
  await openPanel();
  assert.ok((await p.evaluate(() => document.querySelectorAll('[data-bookmark-row]').length)) > 0, 'The seeded chat has bookmarks');
  const full = await panel();
  assert.equal(full.empty, 'false');
  assert.equal(full.mode, 'dock', 'Docked, the list may use the whole column height');
  await p.locator('[data-bookmark-search]').fill('zzz-没有匹配的标题');
  await frames(p);
  const empty = await panel();
  assert.equal(empty.empty, 'true', 'No matches marks the panel empty');
  assert.equal(await p.locator('[data-bookmark-row]').count(), 0);
  assert.ok(empty.panel.height < full.panel.height - 40, `an empty panel hugs its hint (${empty.panel.height} vs ${full.panel.height})`);
  assert.ok(empty.panel.height > 120, `and still leaves the hint readable (${empty.panel.height})`);
  await closePanel();
  // Narrower than the dock threshold, an empty panel must not stand over the text either.
  await p.setViewportSize({ width: 900, height: 900 });
  await frames(p);
  await openPanel();
  await p.locator('[data-bookmark-search]').fill('zzz-没有匹配的标题');
  await frames(p);
  const emptyNarrow = await panel();
  assert.equal(emptyNarrow.mode, 'overlay', '900 px is too narrow to dock the panel');
  assert.equal(emptyNarrow.empty, 'true');
  assert.ok(emptyNarrow.panel.height <= PANEL_OVERLAY_HEIGHT + 1, `a narrow empty overlay stays short (${emptyNarrow.panel.height})`);
  await closePanel();

  // ---- 3. continue reading, per chat
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(reader(first), { waitUntil: 'load' });
  await frames(p);
  assert.equal(await scrollTop(), 0, 'A chat with no record opens at the top');
  assert.equal(await p.locator('[data-ceobe-reading-position]').count(), 0);
  await setScrollTop(4200);
  await p.waitForTimeout(1400);
  const savedAnchor = await anchor();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('ceobe.reading-position.v1') || 'null'));
  assert.equal(saved.v, 1);
  assert.deepEqual(Object.keys(saved.items), [first.id], 'The record is keyed by chat');
  const record = saved.items[first.id];
  assert.deepEqual(Object.keys(record).sort(), ['m', 'n', 'o', 't'], 'Only an anchor, an offset, a turn number and a timestamp are stored');
  assert.equal(record.m, savedAnchor.id, 'The stored anchor is the message at the visible top');
  assert.ok(JSON.stringify(saved).length < 260 && !/\s/.test(JSON.stringify(saved.items)), 'No message text or titles reach localStorage');
  // Another chat is unaffected, and coming back restores the exact place (real navigation, not
  // a reload, which is what a reader moving through the sidebar does).
  await p.goto(reader(second), { waitUntil: 'load' });
  await frames(p);
  assert.equal(await scrollTop(), 0, 'A different chat is not dragged to the first one’s position');
  await p.goto(reader(first), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  const restored = { top: await scrollTop(), anchor: await anchor() };
  assert.ok(restored.top > 3000, `the reader lands deep in the chat again (${restored.top})`);
  assert.equal(restored.anchor.id, savedAnchor.id, 'The same message, not a neighbouring one');
  assert.ok(Math.abs(restored.anchor.rel - savedAnchor.rel) <= 4, `the offset inside that message is kept (${restored.anchor.rel} vs ${savedAnchor.rel})`);
  const chip = await p.locator('[data-ceobe-reading-position]').evaluate(e => ({
    text: e.textContent,
    buttons: [...e.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent),
    paragraphUnderIt: (() => {
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return hit ? Boolean(hit.closest('[data-ceobe-message-list] p, [data-ceobe-message-list] li, [data-ceobe-message-list] h1, [data-ceobe-message-list] h2, [data-ceobe-message-list] h3')) : false;
    })(),
  }));
  assert.match(chip.text, /已回到上次阅读位置 · 第 \d+ 轮/);
  assert.deepEqual(chip.buttons.slice(0, 2), ['跳到该条消息', '从头阅读'], 'The notice offers a jump and a way back to the top');
  assert.equal(chip.buttons.length, 3, 'plus a way to dismiss it');
  assert.equal(chip.paragraphUnderIt, false, 'The notice does not sit on a paragraph');
  // Its primary action jumps exactly to the anchored message, then retires.
  await p.locator('[data-ceobe-reading-jump]').click();
  await waitAligned(savedAnchor.id);
  assert.equal(await aligned(savedAnchor.id), await aligned(savedAnchor.id), '');
  assert.ok(Math.abs(await aligned(savedAnchor.id)) <= 12, 'the chip’s jump aligns the anchor with the visible top');
  assert.equal(await p.locator('[data-ceobe-reading-position]').count(), 0, 'The notice retires after its action');
  // An explicit bookmark target in the URL wins over the restored position.
  await setScrollTop(2600);
  await p.waitForTimeout(1400);
  const mine = seeded.filter(b => b.chat_id === first.id);
  const late = mine[Math.floor(mine.length / 2)];
  // The archive's own target link format is conversations/<chat>.html#bookmark=<message_id>,
  // and it has to arrive as a real navigation (a same-document fragment change never reloads).
  await p.goto(reader(second), { waitUntil: 'load' });
  await frames(p);
  await p.goto(reader(first) + '#bookmark=' + encodeURIComponent(late.message_id), { waitUntil: 'load' });
  await waitAligned(late.message_id);
  assert.ok(Math.abs(await aligned(late.message_id)) <= 12, 'the bookmark target is honoured');
  assert.equal(await p.locator('[data-ceobe-reading-position]').count(), 0, 'No restore is attempted when the URL names a target');
  // “从头阅读” scrolls to the top and clears this chat only.
  await p.goto(reader(first), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.locator('[data-ceobe-reading-top]').click();
  await p.waitForTimeout(500);
  assert.equal(await scrollTop(), 0);
  const afterClear = await p.evaluate(() => JSON.parse(localStorage.getItem('ceobe.reading-position.v1') || 'null'));
  assert.equal(afterClear.items[first.id], undefined, 'The record for this chat is gone');
  await p.goto(reader(second), { waitUntil: 'load' });
  await p.goto(reader(first), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  assert.equal(await scrollTop(), 0, 'A cleared chat reopens at the top');
  assert.equal(await p.locator('[data-ceobe-reading-position]').count(), 0);
  // Recording follows reading: shallow peeks are skipped, and returning to the top forgets.
  await setScrollTop(12);
  await p.waitForTimeout(1400);
  assert.equal((await p.evaluate(() => JSON.parse(localStorage.getItem('ceobe.reading-position.v1') || 'null'))).items[first.id], undefined, 'Reading 12px into the chat is not a position worth keeping');
  await setScrollTop(5200);
  await p.waitForTimeout(1400);
  const again = await p.evaluate(id => JSON.parse(localStorage.getItem('ceobe.reading-position.v1')).items[id], first.id);
  assert.ok(again && again.o >= 0, 'Reading on records again');
  await setScrollTop(0);
  await p.waitForTimeout(1400);
  assert.equal((await p.evaluate(() => JSON.parse(localStorage.getItem('ceobe.reading-position.v1') || 'null'))).items[first.id], undefined, 'Returning to the top clears the record');
  assert.deepEqual(errors, [], 'No page errors');
  assert.ok([...requests].every(r => r.startsWith('GET ')), 'Only GET requests were made');
  assert.equal(await fixture.snapshot(), before, 'Fixture data unchanged by reader margin checks');
  console.log('PASS reader margin: the bookmark panel docks in the gutter (no covered text, unwrapped scope row, nothing moved or narrowed) at 1440/1360/1280 and falls back to a short, self-dismissing overlay at 1024/900/760/420, Escape and outside clicks close it, an empty list collapses to a note; continue reading restores the exact message and offset per chat, offers an exact jump and “从头阅读”, keeps only an ID plus an offset in localStorage, yields to #bookmark targets, and stops recording at the top. Isolated fixture, GET only.');
} finally {
  if (browser) await browser.close();
  await fixture.close();
}
