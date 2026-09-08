import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1092, height: 935 }, deviceScaleFactor: 1.5 });
  const errors = [], failures = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  let origin = process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173';
  if (process.env.CEOBE_TEST_DIST) {
    origin = 'http://ceobe.test';
    const root = resolve('dist');
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (url.origin !== origin || relative(root, path).startsWith('..')) return route.abort();
      try { const body = await readFile(path); await route.fulfill({ body, contentType: ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.woff2':'font/woff2' })[extname(path)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status:404, body:'Not found' }); }
    });
  }
  await page.goto(`${origin}/assets.html`, { waitUntil: 'networkidle' });
  const data = await page.locator('#ceobe-assets-data').evaluate(e => JSON.parse(e.textContent));
  const rows = page.locator('[data-asset-id]');
  assert.equal(await rows.count(), data.length);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok(await page.locator('[data-ceobe-asset-library-link]').count());
  const input = page.locator('[data-asset-search]');
  await input.fill('NO_MATCH_绝不存在'); assert.equal(await rows.count(), 0); assert.ok(await page.locator('[data-asset-empty]').isVisible());
  await input.fill('');
  await page.locator('[data-asset-filter="image"]').click(); assert.equal(await rows.count(), data.filter(x => x.kind === 'image').length);
  await page.locator('[data-asset-filter="file"]').click(); assert.equal(await rows.count(), data.filter(x => x.kind === 'file').length);
  await page.locator('[data-asset-filter="all"]').click();
  await page.locator('[data-asset-sort="name"]').click();
  assert.deepEqual(await rows.evaluateAll(es => es.map(e => e.dataset.assetId)), [...data].sort((a,b) => a.name.localeCompare(b.name,'zh-CN',{numeric:true}) || a.id.localeCompare(b.id)).map(x=>x.id));
  const source = data[0]?.sources[0];
  if (source) { await input.fill(source.title); assert.equal(await rows.count(), data.filter(x => `${x.name} ${x.names.join(' ')} ${x.sources.map(s=>s.title).join(' ')}`.toLocaleLowerCase().includes(source.title.toLocaleLowerCase())).length); await input.fill(''); }
  for (const item of data.filter(x => x.preview)) {
    await page.locator(`[data-asset-open="${item.id}"]`).click();
    const body = page.locator('[data-asset-preview-body]');
    if (item.preview.kind === 'image') await body.locator('img').waitFor();
    else {
      await body.locator('[data-ceobe-close-preview]').first().waitFor();
      for (const tab of await body.locator('[data-ceobe-sheet-tab]').all()) { await tab.click(); assert.equal(await tab.getAttribute('aria-pressed'),'true'); }
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ceobe-assets-dialog').evaluate(e=>e.open),false);
  }
  const missing=data.find(x=>!x.download);
  if (missing) { await page.locator(`[data-asset-open="${missing.id}"]`).click(); assert.match(await page.locator('[data-asset-preview-body]').innerText(),/尚未保存/); assert.equal(await page.locator('.ceobe-assets-dialog a[download]').count(),0); await page.keyboard.press('Escape'); }
  for (const item of data.filter(x=>x.download)) {
    if (process.env.CEOBE_TEST_DIST) {
      assert.equal((await readFile(resolve('dist', item.download))).length, item.size);
    } else {
      const response=await page.request.get(`${origin}/${item.download.replace('./','')}`);
      assert.equal(response.status(),200); assert.equal((await response.body()).length,item.size);
    }
  }
  if (source) {
    await page.goto(new URL(source.page, origin + '/').href, { waitUntil:'networkidle' });
    await Promise.all([page.waitForURL('**/assets.html'), page.locator('[data-ceobe-asset-library-link]').filter({visible:true}).first().click()]);
    assert.equal(await page.locator('[data-asset-id]').count(),data.length);
  }
  console.log('RESULT', JSON.stringify({rows:data.length,previews:data.filter(x=>x.preview).length,errors,failures}));
  assert.deepEqual(errors,[]);
  assert.deepEqual(failures,[]);
  console.log('PASS: library search, filters, sorting, source search, all previews, worksheet tabs, Escape, missing state and download sizes.');
} finally { await browser.close(); }
