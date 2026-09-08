import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173/';
const realUrl = process.env.CEOBE_TEST_SHARE_URL;
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1092, height: 935 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.goto(new URL('import.html', origin).href, { waitUntil: 'networkidle' });
  const input = page.locator('[data-ceobe-import-input]');
  const submit = page.locator('[data-ceobe-import-submit]');
  const status = page.locator('[data-ceobe-import-status]');
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await page.locator('img[alt="个人资料图片"]').count(), 0);
  assert.ok(await page.locator('.ceobe-local-avatar').count());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok((await page.locator('.ceobe-import-description').innerText()).includes('附件将尽可能保存'));
  await input.fill('https://example.com/share/not-chatgpt');
  await submit.click();
  assert.match(await status.innerText(), /链接格式不正确/);
  assert.equal(await input.getAttribute('aria-invalid'), 'true');

  const valid = 'https://chatgpt.com/share/6a9ffe9f-8af8-83ee-adba-62f5d99b2e15';
  await input.fill('');
  await input.evaluate((element, url) => {
    element.focus();
    const data = new DataTransfer();
    data.setData('text/plain', url); data.setData('text/html', '<b>UNSAFE RICH HTML</b>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, valid);
  assert.equal((await input.innerText()).trim(), valid);
  assert.equal(await input.locator('b').count(), 0);
  assert.equal(await submit.isDisabled(), false);

  if (realUrl) {
    await input.fill(realUrl);
    console.log('REAL_IMPORT_START', realUrl);
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/archive-share') && r.request().method() === 'POST', { timeout: 240000 });
    await submit.click();
    assert.equal(await submit.isDisabled(), true);
    const response = await responsePromise;
    const result = await response.json();
    console.log('REAL_IMPORT_RESULT', JSON.stringify({ status: response.status(), ...result, output: undefined }));
    assert.equal(response.status(), 200, result.error);
    await page.locator('.ceobe-import-open').waitFor({ state: 'visible' });
    console.log('COMPLETION', await status.innerText());
    await Promise.all([page.waitForURL('**/conversations/*.html'), page.locator('.ceobe-import-open').click()]);
    console.log('OPENED', await page.title());
  } else {
    let requests = 0;
    let release;
    let firstSeen;
    const seen = new Promise(resolve => { firstSeen = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/archive-share', async route => {
      requests++;
      if (requests === 1) {
        firstSeen(); await pending;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated upstream failure' }) });
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, title: '测试会话', messageCount: 8, resourceCounts: { downloaded: 2, failed: 1, unresolved: 1 }, page: '/conversations/test.html' }) });
    });
    await submit.click(); await seen;
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await input.getAttribute('contenteditable'), 'false');
    await page.locator('[data-ceobe-import-form]').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    assert.equal(requests, 1);
    release();
    await page.locator('.ceobe-import-retry').waitFor({ state: 'visible' });
    assert.match(await status.innerText(), /导入未完成/);
    assert.equal((await input.innerText()).trim(), valid);
    await page.locator('.ceobe-import-retry').click();
    await page.locator('.ceobe-import-open').waitFor({ state: 'visible' });
    assert.match(await status.innerText(), /2 个资源未保存/);
    assert.equal(requests, 2);
    assert.equal(await input.getAttribute('contenteditable'), 'true');
    console.log('PASS: empty state, invalid URL, plain-text paste, duplicate prevention, retry, partial-resource summary, avatar and viewport.');
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS: browser runtime error check.');
} finally { await browser.close(); }
