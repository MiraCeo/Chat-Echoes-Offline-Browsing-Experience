import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const library = JSON.parse(await readFile('archive/library.ceobe.json', 'utf8'));
const origin = process.env.CEOBE_TEST_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const failed = [];
  page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
  await page.goto(origin);
  assert.equal(await page.title(), library.conversations[0].title);
  const links = page.locator('a[data-sidebar-item][href*="./conversations/"]');
  assert.equal(await links.count(), library.conversations.length);
  // 置顶/项目聊天会给 aria-label 加注解并改变侧边栏顺序，比较标题集合。
  const sidebarTitles = await links.evaluateAll(nodes => nodes.map(node => (node.getAttribute('aria-label') || '').split(' — ')[0]));
  assert.deepEqual([...sidebarTitles].sort(), library.conversations.map(item => item.title).slice().sort());
  const activeTitle = ((await page.locator('a[data-sidebar-item][data-active]').getAttribute('aria-label')) || '').split(' — ')[0];
  assert.ok(library.conversations.some(item => item.title === activeTitle), '当前会话应在档案库中');
  const importTriggers = page.locator('[data-ceobe-import-share]');
  assert.ok(await importTriggers.count() >= 1);
  assert.deepEqual(await importTriggers.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))),
    Array(await importTriggers.count()).fill('导入会话'));
  assert.ok(await importTriggers.evaluateAll(nodes =>
    nodes.some(node => node.textContent.includes('导入会话'))));
  assert.equal(await page.locator('[data-testid="share-chat-button"]').getAttribute('aria-label'), '另存为 MD');
  assert.ok((await page.locator('[data-testid="share-chat-button"]').innerText()).includes('另存为 MD'));
  await Promise.all([
    page.waitForURL(/\/import\.html$/, { waitUntil: 'domcontentloaded' }),
    importTriggers.filter({ hasText: 'CtrlShiftO' }).first().click(),
  ]);
  assert.equal(await page.title(), '导入会话');
  assert.ok(await page.locator('[data-ceobe-import-main]').isVisible());
  assert.ok(await page.locator('[data-ceobe-import-form]').isVisible());
  assert.equal(await page.locator('[data-ceobe-import-input] [data-placeholder]').getAttribute('data-placeholder'), '粘贴 ChatGPT 分享链接');
  await page.goBack();
  // prompt rail 的断言依赖会话内容（需要存在 .docx 上传项）；当前会话没有时跳过这一段。
  if (await page.locator('[data-ceobe-prompt-rail] button[data-ceobe-prompt-kind="file-upload"]').count()) {
    const fileUploadMarker = page.locator('[data-ceobe-prompt-rail] button[data-ceobe-prompt-kind="file-upload"]').first();
    assert.equal(await fileUploadMarker.getAttribute('data-ceobe-prompt-label'), 'File upload');
    assert.match(await fileUploadMarker.getAttribute('aria-label'), /\.[a-z0-9]{2,5}\b/i, '提示项应带文件名扩展名');
    const fileUploadTarget = await fileUploadMarker.getAttribute('data-ceobe-jump');
    await page.locator('[data-ceobe-prompt-rail]').dispatchEvent('mouseenter');
    const fileUploadItem = page.locator(`.ceobe-prompt-menu .ceobe-prompt-item[data-ceobe-prompt-kind="file-upload"][data-ceobe-jump="${fileUploadTarget}"]`);
    await fileUploadItem.hover();
    assert.ok(await fileUploadItem.locator('.ceobe-prompt-item-detail').isVisible());
    assert.match(await fileUploadItem.innerText(), /\.[a-z0-9]{2,5}\b/i, '提示项详情应带文件名扩展名');
    assert.ok((await fileUploadItem.locator('.ceobe-prompt-item-reply').innerText()).length > 20);
    const promptList = page.locator('.ceobe-prompt-menu ul');
    const expandedHeight = await promptList.evaluate(element => element.scrollHeight);
    const anotherPromptItem = page.locator('.ceobe-prompt-menu .ceobe-prompt-item:not([data-ceobe-prompt-kind="file-upload"])').first();
    await anotherPromptItem.hover();
    assert.equal(await page.locator('.ceobe-prompt-item[data-ceobe-detail-active]').count(), 1);
    assert.equal(await fileUploadItem.locator('.ceobe-prompt-item-detail').evaluate(element => getComputedStyle(element).height), '0px');
    assert.equal(await anotherPromptItem.locator('.ceobe-prompt-item-detail').evaluate(element => getComputedStyle(element).height), '37px');
    assert.equal(await promptList.evaluate(element => element.scrollHeight), expandedHeight);
  } else {
    console.log('prompt rail: 当前会话没有文件类提示项，跳过该段断言。');
  }
  const jumpMarkers = page.locator('[data-ceobe-prompt-rail] button[data-toc-item-index][data-ceobe-jump]');
  const distantMarker = jumpMarkers.nth(Math.floor(await jumpMarkers.count() * .75));
  const jumpTarget = await distantMarker.getAttribute('data-ceobe-jump');
  await distantMarker.dispatchEvent('click');
  await page.waitForFunction(targetId => {
    const target = document.querySelector(`[data-testid="${targetId}"]`);
    if (!target || !document.documentElement.hasAttribute('data-ceobe-accurate-turn-layout')) return false;
    let scroller = target.parentElement;
    while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
    scroller ||= document.scrollingElement;
    const offset = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    return Math.abs(target.getBoundingClientRect().top - offset - 60) < 3;
  }, jumpTarget);
  const menuItems = page.locator('.ceobe-prompt-menu .ceobe-prompt-item[data-ceobe-jump]');
  const distantMenuItem = menuItems.nth(Math.floor(await menuItems.count() * .25));
  const menuJumpTarget = await distantMenuItem.getAttribute('data-ceobe-jump');
  await distantMenuItem.click();
  await page.waitForFunction(targetId => {
    const target = document.querySelector(`[data-testid="${targetId}"]`);
    if (!target) return false;
    let scroller = target.parentElement;
    while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
    scroller ||= document.scrollingElement;
    const offset = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    return Math.abs(target.getBoundingClientRect().top - offset - 60) < 3;
  }, menuJumpTarget);
  const target = library.conversations[1];
  // 标题可能重复（同名的不同会话），按 href 里的会话 id 精确定位。
  await page.locator(`a[data-sidebar-item][href*="${target.id}.html"]`).first().click();
  await page.waitForLoadState('load');
  assert.equal(await page.title(), target.title);
  assert.equal(((await page.locator('a[data-sidebar-item][data-active]').getAttribute('aria-label')) || '').split(' — ')[0], target.title);
  assert.match(page.url(), new RegExp(`/conversations/${target.id}\\.html$`));
  assert.deepEqual(failed, [], `Library requested missing resources:\n${failed.join('\n')}`);
  console.log(`Library navigation passed for ${library.conversations.length} conversations.`);
} finally { await browser.close(); }
