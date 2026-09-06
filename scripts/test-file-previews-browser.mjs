import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/runtime-test.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5180/', { waitUntil: 'networkidle' });
  for (const key of ['txt', 'docx', 'pdf', 'xlsx']) {
    console.log('Checking preview:', key);
    const wrapper = page.locator(`[data-ceobe-open-preview="${key}"]`).first();
    const opener = await wrapper.evaluate(e => e.tagName === 'BUTTON') ? wrapper : wrapper.locator('button');
    await opener.click();
    const dock = page.locator('.ceobe-preview-dock');
    await dock.waitFor({ state: 'visible' });
    assert.ok(await dock.locator('[data-testid="artifact-preview-side-pane-surface"]').isVisible());
    if (key === 'pdf') {
      assert.equal(await dock.locator('[data-testid^="artifact-pdf-page-"] img').count(), 7);
      const first = dock.locator('[data-testid="artifact-pdf-page-1"] img');
      await first.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('.ceobe-preview-dock img')?.naturalWidth > 0);
    }
    if (key === 'xlsx') {
      await dock.locator('[data-ceobe-sheet-tab="1"]').click();
      assert.ok(await dock.locator('[data-ceobe-sheet="1"]').isVisible());
      assert.ok(!await dock.locator('[data-ceobe-sheet="0"]').isVisible());
      await dock.locator('[data-ceobe-sheet-tab="0"]').click();
    }
    await dock.locator('[data-ceobe-close-preview]').click();
    assert.equal(await page.locator('.ceobe-preview-dock').count(), 0);
    const citation = page.locator(`[data-file-citation-primary-file-id][data-ceobe-open-preview="${key}"]`).first();
    await citation.locator('button').click();
    assert.equal(await citation.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await citation.getAttribute('aria-expanded'), 'false');
  }
  await page.setViewportSize({ width: 600, height: 800 });
  await page.locator('button[data-ceobe-open-preview="pdf"]').first().click();
  assert.ok(await page.locator('.ceobe-preview-dock [data-ceobe-close-preview]').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ceobe-preview-dock').count(), 0);
  for (const width of [1600, 600]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('button[data-ceobe-open-preview="pasted"]').click();
    const dialog = page.locator('dialog.ceobe-pasted-dialog');
    await dialog.waitFor({ state: 'visible' });
    assert.ok((await dialog.innerText()).includes('BUILD SUCCESSFUL in 4m 42s'));
    assert.ok(await dialog.locator('[data-ceobe-close-preview]').isVisible());
    assert.ok(await dialog.locator('.writing-block-editor').evaluate(e => e.scrollHeight > e.clientHeight));
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - width / 2) < 2);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - 500) < 2);
    if (width === 1600) await page.screenshot({ path: process.env.TEMP + '/ceobe-pasted-dialog.png' });
    await dialog.locator('[data-ceobe-close-preview]').click();
    const citation = page.locator('[data-file-citation-primary-file-id][data-ceobe-open-preview="pasted-reference"]').first();
    await citation.locator('button').click();
    assert.ok(await page.locator('.ceobe-preview-dock [data-ceobe-pasted-reference]').isVisible());
    assert.equal(await page.locator('dialog.ceobe-pasted-dialog').count(), 0);
    assert.ok(await page.locator('.ceobe-preview-dock .cm-content').innerText().then(text =>
      text.includes("'.\\gradlew.bat' ':app' '--console=plain'") && text.includes('BUILD SUCCESSFUL in 4m 42s')));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog.ceobe-pasted-dialog').count(), 0);
    assert.equal(await citation.getAttribute('aria-expanded'), 'false');
  }
  assert.deepEqual(errors, []);
  console.log('Browser previews and pasted-text modal: open/close, scrolling, narrow-screen layout and Escape passed.');
} finally { await browser.close(); }
