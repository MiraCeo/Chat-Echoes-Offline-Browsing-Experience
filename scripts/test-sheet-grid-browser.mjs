import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// 只读表格的两处入口共用 sheet-grid.js：资料库预览窗 + 会话页的附件预览。
// 这里验证“点单元格高亮行列”和“缩放条”，不写任何真实数据。
const origin = process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const check = async (page, scope, label) => {
  // 片段里可能有多张工作表，只有当前那张是可见的。
  const grid = scope.locator('table.ceobe-sheet-grid:visible').first();
  await grid.waitFor({ timeout: 15000 });
  // 取表格中部的单元格：第一行容易被粘性表头盖住，点不到 <td>。
  const rows = grid.locator('tbody tr');
  const rowCount = await rows.count();
  const cell = rows.nth(Math.min(2, Math.max(0, rowCount - 1))).locator('td[data-col="1"]').first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  assert.equal(await cell.getAttribute('aria-selected'), 'true', `${label}: cell must be marked selected`);
  assert.equal(await grid.locator('[data-sheet-band]').count(), 2, `${label}: column + row headers get highlighted`);
  await cell.click();
  assert.equal(await cell.getAttribute('aria-selected'), 'false', `${label}: clicking again clears the selection`);
  assert.equal(await grid.locator('[data-sheet-band]').count(), 0, `${label}: highlight is cleared too`);

  const toolbar = scope.locator('[data-sheet-zoom]').first();
  await toolbar.waitFor({ timeout: 5000 });
  const label_ = toolbar.locator('[data-sheet-zoom-label]');
  assert.equal(await label_.innerText(), '100%');
  await toolbar.locator('[data-sheet-zoom-action="in"]').click();
  assert.equal(await label_.innerText(), '110%', `${label}: zoom in steps by 10%`);
  assert.equal(await grid.evaluate(node => node.style.zoom), '1.1');
  await toolbar.locator('[data-sheet-zoom-action="reset"]').click();
  assert.equal(await label_.innerText(), '100%', `${label}: reset returns to 100%`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  // 1. 资料库：挑一个带表格预览的资源打开
  await page.goto(new URL('assets.html', origin).href, { waitUntil: 'networkidle' });
  const ids = await page.evaluate(() => JSON.parse(document.getElementById('ceobe-assets-data').textContent)
    .filter(item => item.preview?.kind === 'fragment').map(item => item.id));
  let opened = null;
  for (const id of ids.slice(0, 40)) {
    await page.locator(`[data-asset-open="${id}"]`).first().click();
    await page.waitForTimeout(300);
    if (await page.locator('.ceobe-assets-dialog [data-ceobe-sheet]').count()) { opened = id; break; }
    await page.keyboard.press('Escape');
  }
  assert.ok(opened, 'the archive should contain at least one spreadsheet preview');
  await check(page, page.locator('.ceobe-assets-dialog'), 'library');
  await page.keyboard.press('Escape');

  // 2. 会话页：同一套表格增强通过 file-previews.js 生效。找一个真有表格预览的会话。
  const chats = await (await fetch(new URL('api/chats', origin))).json().then(data => data.conversations || []).catch(() => []);
  let target = null;
  for (const chat of chats.slice(0, 40)) {
    const html = await (await fetch(new URL(`conversations/${chat.id}.html`, origin))).text();
    const files = [...html.matchAll(/data-ceobe-preview-file="([^"]+)"/g)].map(match => match[1]);
    for (const file of [...new Set(files)].slice(0, 16)) {
      const fragment = await (await fetch(new URL(`previews/templates/${file}`, origin))).text();
      if (fragment.includes('ceobe-sheet-grid')) { target = { id: chat.id, file }; break; }
    }
    if (target) break;
  }
  if (target) {
    await page.goto(new URL(`conversations/${target.id}.html`, origin).href, { waitUntil: 'networkidle' });
    // 同一个附件在正文引用和来源面板里各有一个入口，其中有的默认不可见。
    await page.locator(`[data-ceobe-preview-file="${target.file}"]:visible`).first().click();
    const dock = page.locator('[data-side-pane-shell-host]').first();
    await check(page, dock, 'conversation');
  } else console.log('SKIP conversation check: no chat in this archive has a spreadsheet preview');

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log('PASS sheet grid UI: cell selection highlights its row and column, second click clears, zoom in/reset work in the library preview (and in the conversation dock when a spreadsheet is reachable).');
} finally {
  await browser.close();
}
