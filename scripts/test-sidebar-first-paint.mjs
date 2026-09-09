import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { chromium } from 'playwright';
const pages = ['index.html', 'import.html', 'assets.html', 'projects.html', 'project.html', ...(await readdir('replay/conversations')).filter(n => n.endsWith('.html')).map(n => `conversations/${n}`)];
for (const path of pages) {
  const d = parseHTML(await readFile(`replay/${path}`, 'utf8')).document;
  assert.equal(d.querySelectorAll('[aria-label=下载应用],[data-testid=accounts-profile-button]').length,0,path+' no legacy account/download controls');
  for(const profile of d.querySelectorAll('[data-ceobe-local-profile]')){assert.equal(profile.getAttribute('role'),null);assert.equal(profile.getAttribute('tabindex'),null);assert.doesNotMatch(profile.textContent,/Plus|Mira Ceo/)}
  const brand = d.querySelector('#sidebar-header .header-wordmark');
  assert.equal(brand.textContent, 'CEOBE', path);
  assert.equal(brand.closest('a').getAttribute('href'), 'https://github.com/MiraCeo/Chat-Echoes-Offline-Browsing-Experience', path);
  assert.ok(d.querySelector('#stage-sidebar-tiny-bar use[href$="#blossom"]'), 'Original collapsed logo remains');
  const links = [...d.querySelectorAll('[data-ceobe-import-share]')];
  assert.ok(links.length, path);
  for (const a of links) {
    assert.equal(a.getAttribute('aria-label'), '导入会话', path);
    assert.doesNotMatch(a.textContent, /新聊天|新对话|导入对话/);
    assert.equal(a.getAttribute('href'), path.startsWith('conversations/') ? '../import.html' : './import.html');
  }
  if (path === 'import.html') assert.ok(links.every(a => a.getAttribute('aria-current') === 'page'));
  if (path === 'assets.html') {
    assert.ok(links.every(a => !a.hasAttribute('data-active')));
    assert.ok(d.querySelector('[data-ceobe-asset-library-link][aria-current="page"]'));
  }
}
const browser = await chromium.launch({ headless:true, ...(process.platform === 'win32' ? {channel:'msedge'} : {}) });
try {
  const page = await browser.newPage({javaScriptEnabled:false, viewport:{width:1092,height:935},deviceScaleFactor:1.5});
  for (const path of ['index.html', 'import.html', 'assets.html', 'projects.html', 'project.html', pages.at(-1)]) {
    await page.goto(new URL(path, process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173/').href);
    for (let pass=0;pass<2;pass++) {
      const brand=page.locator('#sidebar-header a');
      assert.equal(await brand.textContent(),'CEOBE');
      assert.equal(await brand.getAttribute('href'),'https://github.com/MiraCeo/Chat-Echoes-Offline-Browsing-Experience');
      assert.equal(await brand.evaluate(e=>getComputedStyle(e).pointerEvents),'auto');
      const links=page.locator('[data-ceobe-import-share]');
      assert.ok(await links.count());
      for (const link of await links.all()) {
        assert.equal(await link.getAttribute('aria-label'),'导入会话');
        assert.doesNotMatch(await link.textContent(),/新聊天|新对话|导入对话/);
      }
      if (!pass) await page.reload();
    }
  }
} finally { await browser.close(); }
console.log(`PASS: ${pages.length} generated pages have final sidebar labels and links; first load and reload correct with JavaScript disabled.`);
