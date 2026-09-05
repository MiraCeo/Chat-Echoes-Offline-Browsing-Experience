import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('C:/Users/12782/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(process.env.CEOBE_TEST_URL || 'http://localhost:5173/', { waitUntil: 'networkidle' });
  for (const selector of [
    '[data-turn="user"] [data-testid="copy-turn-action-button"]',
    '[data-turn="assistant"] [data-testid="copy-turn-action-button"]',
    'pre button[data-ceobe-copy]',
    '.ceobe-code-block button[data-ceobe-copy]',
    '.TyagGW_tableWrapper button[data-ceobe-copy]',
  ]) {
    const button = page.locator(selector).first();
    const expected = await button.getAttribute('data-ceobe-copy');
    assert.ok(expected?.length, selector);
    await button.scrollIntoViewIfNeeded();
    await button.hover();
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-ceobe-copy-state="success"]'));
    // Windows clipboard normalizes LF to CRLF.
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), expected.replaceAll('\r\n', '\n'));
    assert.equal(await button.getAttribute('aria-label'), '已复制');
    if (await button.getAttribute('data-ceobe-copy-html')) {
      const rich = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find(item => item.types.includes('text/html'));
        return item ? (await item.getType('text/html')).text() : null;
      });
      assert.ok(rich, 'HTML clipboard format must be present');
      if (selector.includes('tableWrapper')) assert.ok(rich.includes('<table'));
    }
    await page.waitForTimeout(2100);
    assert.equal(await button.getAttribute('data-ceobe-copy-state'), null);
  }
  // Failure must not claim success, even if both APIs are unavailable.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Denied'); } });
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { throw new Error('Denied'); } });
    document.execCommand = () => false;
  });
  const button = page.locator('button[data-ceobe-copy]').first();
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  await button.click();
  await page.waitForFunction(() => document.querySelector('[data-ceobe-copy-state="error"]'));
  assert.equal(await button.getAttribute('aria-label'), '复制失败，请手动选择文本复制');
  console.log('User/assistant, captured/generated code, table clipboard contents, feedback reset and denied permissions passed.');
} finally { await browser.close(); }
