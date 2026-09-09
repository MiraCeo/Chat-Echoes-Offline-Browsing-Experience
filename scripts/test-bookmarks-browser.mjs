import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { parseHTML } from 'linkedom';
const prod =
    process.env.CEOBE_TEST_DIST === '1'
      ? await preview({
          configFile: 'vite.config.mjs',
          root: 'replay',
          build: { outDir: '../dist' },
          preview: { host: '127.0.0.1', port: 0 },
        })
      : null,
  base = prod
    ? 'http://127.0.0.1:' + prod.httpServer.address().port + '/'
    : 'http://127.0.0.1:5173/',
  browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const p = await browser.newPage({
      viewport: { width: 1028, height: 908 },
      deviceScaleFactor: 1.5,
    }),
    errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  p.setDefaultTimeout(10000);
  const real = await (await p.request.get(base + 'api/bookmarks')).json(),
    chats = (await (await p.request.get(base + 'api/chats')).json()).conversations;
  let state = [],
    writes = 0,
    offline = false;
  const date = '2026-09-09T00:00:00.000Z';
  await p.route('**/api/**', async (route) => {
    const req = route.request();
    if (new URL(req.url()).pathname !== '/api/bookmarks') {
      assert.equal(req.method(), 'GET', 'Never write real data');
      return route.continue();
    }
    if (offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (req.method() === 'GET')
      return route.fulfill({ json: { bookmarks: state, writable: true } });
    writes++;
    const b = req.postDataJSON(),
      old = state.find((x) =>
        b.action === 'delete'
          ? x.id === b.id
          : x.chat_id === b.chatId && x.message_id === b.messageId,
      );
    if (
      (old?.version || 0) !== b.expectedVersion ||
      (b.action === 'save' && (old?.id || null) !== (b.expectedId || null))
    )
      return route.fulfill({
        status: 409,
        json: { error: '书签已在其他窗口修改，请保留草稿并重新打开' },
      });
    if (b.action === 'delete') {
      state = state.filter((x) => x.id !== b.id);
      return route.fulfill({ json: { deleted: b.id } });
    }
    const item = {
      ...(old || {
        id: 'bookmark-' + writes,
        chat_id: b.chatId,
        message_id: b.messageId,
        role: b.messageId === assistant.message_id ? 'assistant' : 'user',
        excerpt: '原消息摘要',
        chat_title: '测试聊天标题',
        created_at: date,
        order: writes,
        target_state: 'available',
      }),
      title: b.title,
      note: b.note,
      version: (old?.version || 0) + 1,
      updated_at: date,
    };
    if (old) state[state.indexOf(old)] = item;
    else state.push(item);
    return route.fulfill({ json: { bookmark: item } });
  });
  await p.goto(base, { waitUntil: 'networkidle' });
  const seed = await p.locator('#ceobe-bookmark-data').evaluate((e) => JSON.parse(e.textContent)),
    user = seed.targets.find((t) => t.role === 'user'),
    assistant = seed.targets.find((t) => t.role === 'assistant');
  assert.ok(user && assistant);
  assert.ok(!user.message_id.startsWith('ceobe-replay-turn-'));
  assert.equal(await p.locator('[data-bookmark-target]').count(), seed.targets.length);
  assert.equal(await p.locator('#prompt-textarea').count(), 0);
  assert.equal(await p.locator('[data-bookmark-composer]').count(), 1);
  const editor = p.locator('[data-bookmark-dialog=editor]'),
    list = p.locator('[data-bookmark-dialog=list]'),
    open = async (t) => {
      await p.locator('[data-bookmark-target="' + t.message_id + '"]').hover();
      await p.locator('[data-bookmark-message-more="' + t.message_id + '"]').click();
      await p.locator('[data-bookmark-menu-action]').click();
      await editor.waitFor({ state: 'visible' });
    },
    save = async () => {
      await p.locator('[data-bookmark-save]').click();
      await editor.waitFor({ state: 'hidden' });
    };
  await open(user);
  await p.locator('#bookmark-title').fill('书签 <img src=x onerror=alert(1)>');
  await p
    .locator('#bookmark-note')
    .fill(
      'note-only-token：' +
        '这是一条用于验收两行截断和尾端编辑图标的很长测试备注。'.repeat(10) +
        '\n末尾内容保留在编辑窗中。',
    );
  await save();
  assert.equal(state.length, 1);
  const first = state[0];
  await p.reload({ waitUntil: 'networkidle' });
  assert.equal(await p.locator('[data-bookmark-mark]:visible').count(), 1);
  await open(assistant);
  await p.locator('#bookmark-title').fill('助手关键结论');
  await p.locator('#bookmark-note').fill('');
  await save();
  assert.equal(state.length, 2);
  const readingBoxBefore = await p.locator('[data-ceobe-message-list]').boundingBox();
  await p.locator('.ceobe-bookmark-rail').click();
  const readingBoxAfter = await p.locator('[data-ceobe-message-list]').boundingBox();
  assert.equal(readingBoxAfter.x, readingBoxBefore.x);
  assert.equal(readingBoxAfter.width, readingBoxBefore.width);
  await list.waitFor({ state: 'visible' });
  assert.equal(await p.locator('[data-bookmark-row]').count(), 2);
  assert.equal(await p.locator('[data-bookmark-row] img').count(), 0);
  assert.equal(await list.locator('[data-bookmark-chat-source]').count(), 0);
  assert.equal(await list.locator('.ceobe-bookmark-role svg').count(), 2);
  assert.equal(await list.locator('.ceobe-bookmark-role[aria-label="GPT 回复"] svg').count(), 1);
  await p.waitForFunction(() =>
    document.querySelector('.ceobe-bookmark-preview-last')?.textContent.endsWith('...'),
  );
  const previewGeometry = await list
    .locator('.ceobe-bookmark-preview')
    .first()
    .evaluate((e) => {
      const a = e.querySelector('.ceobe-bookmark-preview-first').getBoundingClientRect(),
        b = e.querySelector('.ceobe-bookmark-preview-last').getBoundingClientRect(),
        edit = e.querySelector('[data-bookmark-edit]').getBoundingClientRect(),
        box = e.getBoundingClientRect();
      return {
        height: box.height,
        line: a.height,
        secondY: b.y,
        editY: edit.y,
        textRight: b.right,
        editLeft: edit.left,
        editRight: edit.right,
        right: box.right,
        label: e.querySelector('[data-bookmark-edit]').getAttribute('aria-label'),
      };
    });
  assert.equal(previewGeometry.height, 48);
  assert.equal(previewGeometry.line, 24);
  assert.equal(previewGeometry.secondY, previewGeometry.editY);
  assert.ok(
    previewGeometry.textRight < previewGeometry.editLeft &&
      previewGeometry.editRight <= previewGeometry.right + 1,
    JSON.stringify(previewGeometry),
  );
  assert.equal(previewGeometry.label, '编辑备注');
  const rect = await list.boundingBox();
  assert.ok(
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1029 && rect.y + rect.height <= 909,
    JSON.stringify(rect),
  );
  for (const viewport of [
    { width: 1092, height: 935 },
    { width: 720, height: 540 },
    { width: 390, height: 720 },
  ]) {
    await p.setViewportSize(viewport);
    await p.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const box = await list.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
      JSON.stringify({ viewport, box }),
    );
  }
  await p.setViewportSize({ width: 1028, height: 908 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (process.env.CEOBE_CAPTURE_BOOKMARKS === '1')
    await list.screenshot({ path: 'data/private/bookmarks-ui.png' });
  await p.locator('[data-bookmark-search]').fill('note-only-token');
  assert.equal(await p.locator('[data-bookmark-row]').count(), 0);
  await p.locator('[data-bookmark-search]').fill('原消息摘要');
  assert.equal(await p.locator('[data-bookmark-row]').count(), 0);
  for (const b of state) b.chat_title = '重新命名后的聊天';
  await p.evaluate(() => document.dispatchEvent(new Event('ceobe:chat-updated')));
  await p.locator('[data-bookmark-search]').fill('重新命名');
  await p.locator('[data-bookmark-row]').first().waitFor();
  assert.equal(await p.locator('[data-bookmark-row]').count(), 2);
  await p.locator('[data-bookmark-edit="' + first.id + '"]').click();
  await p.locator('#bookmark-note').fill('我的未提交草稿');
  state.find((x) => x.id === first.id).version++;
  await p.locator('[data-bookmark-save]').click();
  await p.locator('[data-bookmark-editor-status]').filter({ hasText: '其他窗口' }).waitFor();
  assert.equal(await p.locator('#bookmark-note').inputValue(), '我的未提交草稿');
  assert.ok(await editor.isVisible());
  await p.locator('[data-bookmark-cancel]').click();
  await p.locator('[data-bookmark-edit="' + first.id + '"]').click();
  await p.locator('#bookmark-note').fill('已合并的备注');
  await save();
  assert.equal(state.find((x) => x.id === first.id).note, '已合并的备注');
  await p.locator('[data-bookmark-jump="' + first.id + '"]').click();
  await p
    .locator('[data-bookmark-target="' + user.message_id + '"].ceobe-bookmark-highlight')
    .waitFor();
  assert.ok(p.url().endsWith('#bookmark=' + encodeURIComponent(user.message_id)));
  assert.ok(await list.isVisible(), 'The left panel stays open after a bookmark jump');
  assert.equal(await list.evaluate((e) => e.matches(':modal')), false);
  const alignment = await p
    .locator('[data-bookmark-target="' + user.message_id + '"]')
    .evaluate((e) => ({
      top: e.getBoundingClientRect().top,
      expected: document.querySelector('header').getBoundingClientRect().bottom + 8,
    }));
  assert.ok(
    alignment.top >= alignment.expected - 8 && alignment.top <= alignment.expected + 2,
    JSON.stringify(alignment),
  );
  const panelLayout = await p.evaluate(() => ({
    right: document.querySelector('[data-bookmark-dialog=list]').getBoundingClientRect().right,
    body: document.querySelector('[data-ceobe-message-list]').getBoundingClientRect().left,
  }));
  assert.ok(panelLayout.body < panelLayout.right, JSON.stringify(panelLayout));
  assert.equal(
    await p.locator('[data-ceobe-message-list]').evaluate((e) => e.getBoundingClientRect().width),
    readingBoxBefore.width,
  );
  const marker = p.locator('[data-ceobe-prompt-rail] [data-ceobe-jump]').nth(2),
    turnId = await marker.getAttribute('data-ceobe-jump');
  await marker.focus();
  await p.locator('.ceobe-prompt-menu [data-ceobe-jump="' + turnId + '"]').click();
  await p.waitForFunction(
    (id) =>
      Math.abs(
        document.querySelector('section[data-testid="' + id + '"]').getBoundingClientRect().top -
          document.querySelector('header').getBoundingClientRect().bottom -
          8,
      ) < 2,
    turnId,
  );
  await list.locator('[data-bookmark-close]').click();
  assert.equal(
    await p.locator('main').evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft)),
    0,
  );
  await p.locator('.ceobe-bookmark-rail').click();
  assert.equal(await list.evaluate((e) => e.matches(':modal')), false);
  const other = chats.find((c) => c.id !== seed.chatId),
    html = await (await p.request.get(new URL(other.page, base).href)).text(),
    otherSeed = JSON.parse(
      parseHTML(html).document.querySelector('#ceobe-bookmark-data').textContent,
    ),
    cross = {
      ...state[0],
      id: 'cross-bookmark',
      chat_id: other.id,
      message_id: otherSeed.targets[0].message_id,
      title: '跨聊天书签',
      chat_title: other.title,
    };
  state.push(cross);
  await p.locator('[data-bookmark-sidebar-more]').click();
  await p.locator('[data-bookmark-menu-action]').filter({ hasText: '全部书签' }).click();
  await p.locator('[data-bookmark-row="cross-bookmark"]').waitFor();
  assert.equal(await list.locator('[data-bookmark-chat-source]').count(), 3);
  await p.locator('[data-bookmark-jump="cross-bookmark"]').click();
  await p.waitForURL('**/' + other.id + '.html#bookmark=*');
  await p.locator('.ceobe-bookmark-highlight').waitFor();
  assert.equal(
    await p.locator('.ceobe-bookmark-highlight').getAttribute('data-bookmark-target'),
    otherSeed.targets[0].message_id,
  );
  await p.locator('[data-bookmark-sidebar-more]').click();
  await p.locator('[data-bookmark-menu-action]').click();
  state.find((b) => b.id === 'cross-bookmark').target_state = 'message_missing';
  await p.locator('[data-bookmark-jump="cross-bookmark"]').click();
  await p.locator('[data-bookmark-status]').filter({ hasText: '无法定位' }).waitFor();
  assert.ok(await list.isVisible());
  await p.locator('[data-bookmark-edit="cross-bookmark"]').click();
  const beforeDelete = writes;
  await p.locator('[data-bookmark-delete]').click();
  assert.equal(writes, beforeDelete);
  await p.locator('[data-bookmark-cancel]').click();
  assert.ok(state.some((b) => b.id === 'cross-bookmark'));
  await p.locator('[data-bookmark-edit="cross-bookmark"]').click();
  await p.locator('[data-bookmark-delete]').click();
  await p.locator('[data-bookmark-delete]').click();
  await editor.waitFor({ state: 'hidden' });
  assert.ok(!state.some((b) => b.id === 'cross-bookmark'));
  offline = true;
  await p.locator('[data-bookmark-edit]').first().click();
  await p.locator('[data-bookmark-save]:disabled').waitFor();
  assert.equal(await p.locator('#bookmark-note').inputValue(), '已合并的备注');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  offline = false;
  for (const path of ['projects.html', 'project.html', 'assets.html', 'import.html']) {
    await p.goto(base + path, { waitUntil: 'networkidle' });
    await p.locator('[data-bookmark-sidebar-more]').focus();
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter');
    await list.waitFor({ state: 'visible' });
    assert.ok(await p.locator('[data-bookmark-scope=current]').isDisabled());
    await p.keyboard.press('Escape');
  }
  await p.goto(base + '#bookmark=' + encodeURIComponent(seed.targets.at(-1).message_id), {
    waitUntil: 'networkidle',
  });
  await p.locator('.ceobe-bookmark-highlight').waitFor();
  const lastTop = await p
    .locator('.ceobe-bookmark-highlight')
    .evaluate(
      (e) =>
        e.getBoundingClientRect().top -
        document.querySelector('header').getBoundingClientRect().bottom,
    );
  assert.ok(Math.abs(lastTop - 8) < 2, 'Last-message top alignment: ' + lastTop);
  assert.deepEqual(errors, []);
  assert.deepEqual(await (await p.request.get(base + 'api/bookmarks')).json(), real);
  console.log(
    'PASS bookmarks browser ' +
      (prod ? 'production' : 'development') +
      ': whole-message actions, local editor, persistence, optional/plain notes, title-only search, current/global lists, exact highlight/cross-chat anchors, missing target, conflict draft retention, cancel/confirmed delete, unavailable-service readonly, all-page keyboard entry, bounded modal, no page errors. All writes mocked.',
  );
} finally {
  await browser.close();
  if (prod) await new Promise((r) => prod.httpServer.close(r));
}
