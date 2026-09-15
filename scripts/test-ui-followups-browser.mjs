import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const prod = process.env.CEOBE_TEST_DIST === '1'
  ? await preview({ configFile: 'vite.config.mjs', root: 'replay', build: { outDir: '../dist' }, preview: { host: '127.0.0.1', port: 0 } }) : null;
const base = prod ? `http://127.0.0.1:${prod.httpServer.address().port}/` : 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: process.env.CEOBE_TEST_HEADED !== '1' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 908 }, reducedMotion: 'reduce' });
  const p = await context.newPage();
  const errors = [], modes = new Set();
  p.on('pageerror', e => errors.push(e.message));
  p.setDefaultTimeout(10000);
  const before = await (await p.request.get(base + 'api/bookmarks')).json();
  let bookmarks = [];
  await context.route('**/api/**', async route => {
    assert.equal(route.request().method(), 'GET', 'This test must never write real data');
    if (new URL(route.request().url()).pathname === '/api/bookmarks')
      return route.fulfill({ json: { bookmarks, writable: true } });
    return route.continue();
  });
  // Validate edited source before touching any generated pages. Normal runs use
  // the actual published assets; production runs always exercise built output.
  if (process.env.CEOBE_TEST_SOURCE === '1' && !prod) {
    for (const name of ['bookmarks.js', 'bookmarks.css', 'sidebar-controls.js', 'projects.js']) {
      const [stem, ext] = name.split('.');
      await context.route(new RegExp('/' + stem + '(?:\\.[a-f0-9]+)?\\.' + ext + '(?:\\?.*)?$'), async route =>
        route.fulfill({ contentType: ext === 'js' ? 'text/javascript' : 'text/css', body: await readFile(new URL(name, import.meta.url), 'utf8') }));
    }
  }
  if (process.env.CEOBE_TEST_SOURCE === '1' && !prod)
    await p.route('**/reader-ui.*.css', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + '\n' + await readFile(new URL('./reader-ui.css', import.meta.url), 'utf8') });
    });
  const settle = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.goto(base, { waitUntil: 'networkidle' });
  const seed = await p.locator('#ceobe-bookmark-data').evaluate(e => JSON.parse(e.textContent));
  const targets = ['user', 'assistant'].map(role => seed.targets.find(t => t.role === role));
  assert.ok(targets.every(Boolean), 'Need one archived conversation with user and assistant messages');
  bookmarks = targets.map((t, i) => ({ id: 'layout-fixture-' + i, chat_id: seed.chatId, message_id: t.message_id, role: t.role,
    title: '布局验收：较长的书签标题与完整标题提示', note: '短摘要验收文本。'.repeat(50), version: 1,
    excerpt: '测试摘要', chat_title: '布局验收聊天', order: i, target_state: 'available',
    created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }));
  await p.reload({ waitUntil: 'networkidle' });
  await p.locator('[data-bookmark-caption]').first().waitFor();
  let expanded = false, inlineSeen = false;
  for (const width of [2400, 1920, 1440, 1280, 1024, 768, 390, 1920]) {
    await p.setViewportSize({ width, height: 908 });
    await settle();
    for (const target of targets) {
      const cap = p.locator(`[data-bookmark-caption="${target.message_id}"]`);
      const g = await cap.evaluate(e => {
        const r = e.getBoundingClientRect(), title = e.querySelector('.ceobe-bookmark-caption-title'), note = e.querySelector('.ceobe-bookmark-caption-note');
        return { mode: e.dataset.bookmarkDisplay, inline: e.hasAttribute('data-bookmark-inline'), width: r.width, x: r.x, right: r.right,
          titleVisible: title.checkVisibility(), titleWidth: title.getBoundingClientRect().width, noteVisible: note.checkVisibility(),
          expanded: e.hasAttribute('data-expanded'), expandVisible: e.querySelector('[data-bookmark-caption-expand]').checkVisibility(),
          label: e.getAttribute('aria-label'), tooltip: e.title };
      });
      modes.add(g.mode); inlineSeen ||= g.inline;
      assert.ok(g.x >= -1 && g.right <= width + 1, JSON.stringify({ width, g }));
      assert.match(g.label, /编辑书签/); assert.match(g.tooltip, /完整标题/);
      assert.equal(g.titleVisible, g.mode !== 'icon', JSON.stringify(g));
      assert.equal(g.noteVisible, g.mode === 'summary', JSON.stringify(g));
      if (g.mode === 'icon') assert.ok(Math.abs(g.width - 28) < 1, JSON.stringify(g));
      else assert.ok(g.titleWidth >= 50, JSON.stringify(g));
      if (g.mode !== 'summary') { assert.equal(g.expanded, false); assert.equal(g.expandVisible, false); }
      if (!expanded && g.mode === 'summary' && g.expandVisible) {
        await cap.scrollIntoViewIfNeeded();
        await cap.locator('[data-bookmark-caption-expand]').click();
        assert.equal(await cap.getAttribute('data-expanded'), '');
        // A long expanded card must not be clipped behind the following turn.
        await cap.locator('[data-bookmark-caption-expand]').click();
        assert.equal(await cap.getAttribute('data-expanded'), null);
        await cap.locator('[data-bookmark-caption-expand]').click();
        assert.equal(await cap.getAttribute('data-expanded'), '');
        expanded = true;
      }
    }
  }
  assert.deepEqual([...modes].sort(), ['icon', 'summary', 'title']);
  assert.ok(inlineSeen && expanded, 'Exercise inline fallback and full-note expansion');
  await p.setViewportSize({ width: 390, height: 908 }); await settle();
  const icon = p.locator(`[data-bookmark-caption="${targets[0].message_id}"]`);
  await icon.scrollIntoViewIfNeeded(); await icon.focus(); await p.keyboard.press('Enter');
  const editor = p.locator('[data-bookmark-dialog=editor]'); await editor.waitFor();
  assert.equal(await editor.locator('#bookmark-note').inputValue(), bookmarks[0].note);
  await editor.locator('[data-bookmark-cancel]').click();
  // Opening the current-chat list must not turn zero-width gutters into clipped captions.
  await p.setViewportSize({ width: 1024, height: 908 }); await settle();
  await p.locator('.ceobe-bookmark-rail').click(); await settle();
  for (const cap of await p.locator('[data-bookmark-caption]').all()) {
    const g = await cap.boundingBox(); assert.ok(g.width >= 28 && g.x >= 0 && g.x + g.width <= 1025, JSON.stringify(g));
  }
  await p.keyboard.press('Escape');

  await p.goto(base + 'import.html', { waitUntil: 'networkidle' });
  await p.locator('[data-ceobe-sidebar-toggle=close]').click();
  const trigger = p.locator('[data-ceobe-recent-trigger]'), popup = p.locator('[data-ceobe-rail-recent]');
  // The fresh API catalog can reorder the initial snapshot. Wait for that
  // refresh before asserting row-relative focus (not just initial menu visibility).
  const openRecent = async () => {
    const response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/chats' && r.status() === 200);
    await trigger.press('Enter');
    await (await response).finished();
    await settle();
  };
  await openRecent();
  await popup.locator('li a').first().waitFor();
  const row = popup.locator('li').first(), focused = locator => locator.evaluate(e => e === document.activeElement);
  await row.locator('a').focus();
  await p.keyboard.press('Tab'); assert.equal(await focused(row.locator('[data-rail-action=pin]')), true);
  await p.keyboard.press('Tab'); assert.equal(await focused(row.locator('[data-rail-action=more]')), true);
  await p.keyboard.press('Shift+Tab'); assert.equal(await focused(row.locator('[data-rail-action=pin]')), true);
  await p.keyboard.press('ArrowLeft'); assert.equal(await focused(row.locator('a')), true);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
  assert.equal(await focused(row.locator('[data-rail-action=more]')), true);
  await p.keyboard.press('Enter'); await p.locator('[data-ceobe-chat-menu]').waitFor();
  await p.keyboard.press('Escape'); assert.equal(await focused(row.locator('[data-rail-action=more]')), true);
  await p.keyboard.press('ArrowDown');
  assert.equal(await focused(popup.locator('li').nth(1).locator('[data-rail-action=more]')), true);
  await p.keyboard.press('Home'); assert.equal(await focused(row.locator('[data-rail-action=more]')), true);
  await p.keyboard.press('End'); assert.equal(await focused(popup.locator('li').last().locator('[data-rail-action=more]')), true);
  await p.keyboard.press('Tab'); assert.equal(await popup.isVisible(), false);
  await openRecent(); await row.locator('a').focus();
  await p.keyboard.press('Shift+Tab'); assert.equal(await popup.isVisible(), false);
  await openRecent(); await p.keyboard.press('Escape'); assert.equal(await focused(trigger), true);

  await p.goto(base + 'projects.html', { waitUntil: 'networkidle' });
  const status = await p.locator('[data-project-status]').innerText();
  assert.match(status, /附件会自动汇总到项目文件/);
  assert.match(status, /暂不支持手动上传或云端共享/);
  assert.doesNotMatch(status, /暂未接入附件/);
  assert.deepEqual(errors, []);
  assert.deepEqual(await (await p.request.get(base + 'api/bookmarks')).json(), before, 'Real bookmarks unchanged');
  console.log('PASS UI follow-ups: icon/title/summary, full-note expansion and resize reset, 390–2400px bounds, keyboard icon editor, recent-menu Tab/arrows/actions/exit, project copy; GET-only, mocked notes, no page errors.');
} finally {
  await browser.close();
  if (prod) await new Promise(r => prod.httpServer.close(r));
}
