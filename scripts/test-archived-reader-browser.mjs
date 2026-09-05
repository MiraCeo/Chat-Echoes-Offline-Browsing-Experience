import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const input = process.argv[2];
if (!input) throw new Error('Pass the archived conversation JSON used to build the reader');
const conversation = JSON.parse(await readFile(input, 'utf8'));
const url = process.env.CEOBE_TEST_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const context = await browser.newContext();
  const external = [];
  const failedLocal = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('response', response => { if (response.status() >= 400) failedLocal.push(`${response.status()} ${response.url()}`); });
  await page.goto(url);
  const images = page.locator('[data-ceobe-local-resource] img');
  const expected = conversation.resources.filter(r => r.status === 'downloaded' && r.mime_type?.startsWith('image/') && r.message_ids.some(id => conversation.linear_message_ids.includes(id)));
  assert.equal(await images.count(), expected.length);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-ceobe-local-resource] img')].every(img => img.complete && img.naturalWidth > 0));
  for (const resource of conversation.resources.filter(r => r.status === 'downloaded')) {
    const response = await context.request.get(new URL('archive-resources/' + resource.local_path.split('/').at(-1), url).href);
    assert.equal(response.status(), 200);
    assert.equal((await response.body()).length, resource.bytes);
  }
  assert.deepEqual(failedLocal, [], `Reader requested missing local resources:\n${failedLocal.join('\n')}`);
  console.log(`Offline reader passed: ${expected.length} images loaded; all archived downloads accessible. External requests blocked: ${external.length}.`);
  if (external.length) console.log('Blocked URLs:', [...new Set(external)].join(', '));
} finally { await browser.close(); }
