import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const library = JSON.parse(await readFile('archive/library.ceobe.json', 'utf8'));
const origin = process.env.CEOBE_TEST_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  const failed = [];
  page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
  await page.goto(origin);
  assert.equal(await page.title(), library.conversations[0].title);
  const links = page.locator('a[data-sidebar-item][href*="./conversations/"]');
  assert.equal(await links.count(), library.conversations.length);
  assert.deepEqual(await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), library.conversations.map(item => item.title));
  assert.equal(await page.locator('a[data-sidebar-item][data-active]').getAttribute('aria-label'), library.conversations[0].title);
  const target = library.conversations[1];
  await page.locator(`a[data-sidebar-item][aria-label="${target.title.replaceAll('"', '\\"')}"]`).click();
  await page.waitForLoadState('load');
  assert.equal(await page.title(), target.title);
  assert.equal(await page.locator('a[data-sidebar-item][data-active]').getAttribute('aria-label'), target.title);
  assert.match(page.url(), new RegExp(`/conversations/${target.id}\\.html$`));
  assert.deepEqual(failed, [], `Library requested missing resources:\n${failed.join('\n')}`);
  console.log(`Library navigation passed for ${library.conversations.length} conversations.`);
} finally { await browser.close(); }
