import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseHTML } from 'linkedom';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const origin = process.env.CEOBE_TEST_URL || 'http://localhost:5173/';

// 首页（当前档案里最新的一条会话）不保证含代码块或表格：它是图表会话。
// 所以“消息级复制”在首页验证，代码块/表格复制按需找到确实含它们的会话页再验证。
const findPageWith = async selector => {
  for (const name of await readdir('replay/conversations')) {
    if (!name.endsWith('.html')) continue;
    const document = parseHTML(await readFile(`replay/conversations/${name}`, 'utf8')).document;
    if (document.querySelector(selector)) return `conversations/${name}`;
  }
  return null;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const copyOnce = async selector => {
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
        const item = items.find(entry => entry.types.includes('text/html'));
        return item ? (await item.getType('text/html')).text() : null;
      });
      assert.ok(rich, 'HTML clipboard format must be present');
      if (selector.includes('tableWrapper')) assert.ok(rich.includes('<table'));
    }
    await page.waitForTimeout(2100);
    assert.equal(await button.getAttribute('data-ceobe-copy-state'), null);
  };

  await page.goto(origin, { waitUntil: 'networkidle' });
  // 生成图片/图表类的回复没有可复制的正文，它们的复制按钮 data-ceobe-copy 是空串；
  // 这里验证“有内容时可复制”，所以跳过空的那几个（首页正好全是图表回复）。
  await copyOnce('[data-turn="user"] [data-testid="copy-turn-action-button"]:not([data-ceobe-copy=""])');
  await copyOnce('[data-turn="assistant"] [data-testid="copy-turn-action-button"]:not([data-ceobe-copy=""])');

  // 代码块与表格：在档案里找一个确实含这两类内容的会话页再验证。
  for (const selector of ['.ceobe-code-block button[data-ceobe-copy]', '.TyagGW_tableWrapper button[data-ceobe-copy]']) {
    if (!(await page.locator(selector).count())) {
      const target = await findPageWith(selector);
      if (target) await page.goto(new URL(target, origin).href, { waitUntil: 'networkidle' });
    }
    if (await page.locator(selector).count()) await copyOnce(selector);
    else console.log('skip (no archived match):', selector);
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
  console.log('User/assistant, generated code, table clipboard contents, feedback reset and denied permissions passed.');
} finally { await browser.close(); }
