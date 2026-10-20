import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('import.html', origin).href, { waitUntil: 'networkidle' });

  // 采集包入口默认收起，展开后才出现上传区。
  const details = page.locator('[data-ceobe-package-details]');
  const zone = page.locator('[data-ceobe-package-zone]');
  assert.equal(await details.count(), 1);
  assert.equal(await details.evaluate(node => node.open), false);
  assert.equal(await zone.isVisible(), false);
  assert.match(await details.locator('summary').innerText(), /上传采集包/);
  await details.locator('summary').click();
  assert.equal(await details.evaluate(node => node.open), true);
  assert.equal(await zone.isVisible(), true);
  const box = await zone.boundingBox();
  assert.ok(box.height > 60 && box.height < 220, `上传区高度异常：${box.height}`);
  assert.ok(box.width > 400, `上传区宽度异常：${box.width}`);

  // 拖入时边框变化，离开后恢复。
  const border = await page.evaluate(() => {
    const node = document.querySelector('[data-ceobe-package-zone]');
    const read = () => node.style.borderColor || getComputedStyle(node).borderColor;
    const original = read();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'probe.zip', { type: 'application/zip' }));
    node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const during = read();
    node.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return { original, during, after: read() };
  });
  assert.notEqual(border.during, border.original, '拖入时边框应变化');
  assert.notEqual(border.after, border.during, '离开后高亮应撤销');

  // 导入说明默认折叠、可展开。
  const help = page.locator('[data-ceobe-import-help]');
  assert.equal(await help.evaluate(node => node.open), false);
  await help.locator('summary').click();
  assert.equal(await help.evaluate(node => node.open), true);
  assert.ok((await help.innerText()).includes('附件将尽可能保存'));

  // 分享链接输入与提交按钮仍在，且没有横向溢出。
  assert.equal(await page.locator('[data-ceobe-import-input]').count(), 1);
  assert.equal(await page.locator('[data-ceobe-import-submit]').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);

  console.log('Import UI: 采集包入口默认收起、展开出现上传区、拖入高亮可恢复、导入说明可折叠。');
} finally {
  await browser.close();
}