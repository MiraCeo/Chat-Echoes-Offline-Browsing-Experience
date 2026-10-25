import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 资料库的文件夹（标签）与上传界面。接口全部用内存桩，绝不碰真实数据；
// 上传的字节也由桩提供，用来验证下载/文本预览链接。
const origin = process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const state = { folders: [], tags: {}, uploads: [] };
  const posts = [];
  const snapshot = () => ({ ...state, writable: true });
  await context.route('**/api/library**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') return route.fulfill({ json: snapshot() });
    const body = request.headers()['content-type'] === 'application/json' ? JSON.parse(request.postData() || '{}') : null;
    posts.push({ path: url.pathname, body });
    if (url.pathname === '/api/library/folders') {
      if (body.action === 'create') state.folders.push({ id: 'folder-' + (state.folders.length + 1), name: body.name, created_at: new Date().toISOString() });
      if (body.action === 'rename') state.folders = state.folders.map(folder => folder.id === body.id ? { ...folder, name: body.name } : folder);
      if (body.action === 'delete') {
        state.folders = state.folders.filter(folder => folder.id !== body.id);
        for (const key of Object.keys(state.tags)) {
          state.tags[key] = state.tags[key].filter(id => id !== body.id);
          if (!state.tags[key].length) delete state.tags[key];
        }
      }
      return route.fulfill({ json: snapshot() });
    }
    if (url.pathname === '/api/library/tags') {
      if (body.folders.length) state.tags[body.assetId] = body.folders; else delete state.tags[body.assetId];
      return route.fulfill({ json: snapshot() });
    }
    if (url.pathname === '/api/library/upload') {
      const upload = { id: 'up-test-0001', name: url.searchParams.get('name'), sha256: 'a'.repeat(64), stored: 'test-upload.md', mime: 'text/markdown', kind: 'text', size: 12, added_at: new Date().toISOString() };
      state.uploads.push(upload);
      return route.fulfill({ status: 201, json: { upload, duplicate: false } });
    }
    if (url.pathname === '/api/library/uploads/remove') {
      state.uploads = state.uploads.filter(upload => upload.id !== body.id);
      return route.fulfill({ json: { removed: body.id, fileKept: true, ...snapshot() } });
    }
    return route.fulfill({ status: 404, json: { error: 'unexpected' } });
  });
  await context.route('**/library-files/**', route => route.fulfill({ status: 200, contentType: 'text/markdown', body: '# 上传的提纲\n内容\n' }));

  await page.goto(`${origin}/assets.html`, { waitUntil: 'networkidle' });
  const rows = page.locator('[data-asset-id]');
  const total = await rows.count();
  assert.ok(total > 0, 'the archive should provide some assets');
  const bar = page.locator('[data-asset-folder-bar]');
  await bar.waitFor();
  assert.equal(await bar.locator('[data-asset-folder]').count(), 1, 'only the 全部 chip before any folder exists');
  assert.equal(await bar.locator('[data-asset-folders-manage]').count(), 1);
  assert.equal(await bar.locator('[data-asset-upload]').count(), 1);

  // 1. 新建文件夹（管理对话框）
  await bar.locator('[data-asset-folders-manage]').click();
  const manager = page.locator('[data-library-folders]');
  assert.equal(await manager.evaluate(node => node.open), true);
  await manager.locator('[data-library-name]').fill('课程资料');
  await manager.locator('[data-library-folder-create] button[type=submit]').click();
  await page.locator('[data-asset-folder]', { hasText: '课程资料' }).waitFor();
  assert.equal(await bar.locator('[data-asset-folder]').count(), 2);
  assert.ok(posts.some(post => post.path === '/api/library/folders' && post.body.action === 'create' && post.body.name === '课程资料'));
  await manager.locator('[data-library-close]').click();

  // 2. 给一条资源打标签（预览窗里的文件夹）
  const first = page.locator('[data-asset-id]').first();
  const assetId = await first.getAttribute('data-asset-id');
  await first.locator('[data-asset-open]').click();
  const dialog = page.locator('.ceobe-assets-dialog');
  const chip = dialog.locator(`[data-asset-tag-item="${assetId}"]`).first();
  assert.equal(await chip.getAttribute('aria-pressed'), 'false');
  await chip.click();
  await page.waitForFunction(id => document.querySelector(`[data-asset-tag-item="${id}"]`)?.getAttribute('aria-pressed') === 'true', assetId);
  assert.ok(posts.some(post => post.path === '/api/library/tags' && post.body.assetId === assetId && post.body.folders.length === 1));
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(node => node.open), false);

  // 3. 按文件夹筛选：只剩刚才那一条
  await page.locator('[data-asset-folder]:not([data-asset-folder="all"])', { hasText: '课程资料' }).click();
  assert.equal(await rows.count(), 1);
  assert.equal(await rows.first().getAttribute('data-asset-id'), assetId);
  await page.locator('[data-asset-folder="all"]').click();
  assert.equal(await rows.count(), total);

  // 4. 上传文件：出现新行、状态提示、文本预览可读
  const dir = await mkdtemp(join(tmpdir(), 'ceobe-library-ui-'));
  const file = join(dir, '提纲.md');
  await writeFile(file, '# 上传的提纲\n内容\n', 'utf8');
  await page.locator('[data-asset-upload]').click();
  await page.locator('[data-asset-upload-input]').setInputFiles(file);
  await page.locator('[data-library-status]').filter({ hasText: '已上传' }).waitFor();
  const uploadRow = page.locator('[data-asset-id="up-test-0001"]');
  await uploadRow.waitFor();
  assert.equal(await rows.count(), total + 1);
  await uploadRow.locator('[data-asset-open]').click();
  await page.locator('[data-asset-preview-body] pre.ceobe-asset-text').filter({ hasText: '上传的提纲' }).waitFor();
  assert.equal(await page.locator('.ceobe-assets-dialog a[download]').count(), 1);

  // 5. 移除上传记录（两次点击）：行消失，提示文件保留
  const remove = page.locator('[data-asset-remove-upload]');
  await remove.click();
  assert.match(await remove.innerText(), /再点一次/);
  await remove.click();
  await page.locator('[data-library-status]').filter({ hasText: '文件保留' }).waitFor();
  assert.equal(await page.locator('[data-asset-id="up-test-0001"]').count(), 0);
  assert.ok(posts.some(post => post.path === '/api/library/uploads/remove' && post.body.id === 'up-test-0001'));

  // 6. 删除文件夹（两次点击）：标签消失，资源本身还在
  await bar.locator('[data-asset-folders-manage]').click();
  const folderRow = page.locator('[data-library-folder]').first();
  await folderRow.locator('.ceobe-library-danger').click();
  assert.match(await folderRow.locator('.ceobe-library-danger').innerText(), /确认删除/);
  await folderRow.locator('.ceobe-library-danger').click();
  await page.locator('[data-library-status]').filter({ hasText: '文件夹已删除' }).waitFor();
  await manager.locator('[data-library-close]').click();
  assert.equal(await bar.locator('[data-asset-folder]').count(), 1, 'the folder chip is gone');
  assert.equal(await rows.count(), total, 'the assets themselves are untouched');

  assert.deepEqual(errors, []);
  console.log('PASS library UI: folder bar, create/tag/filter, upload with text preview, remove-record keeps file, delete folder keeps assets, zero page errors.');
} finally {
  await browser.close();
}
