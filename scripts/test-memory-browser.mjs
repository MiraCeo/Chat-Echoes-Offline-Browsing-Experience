import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = (process.env.CEOBE_TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(base + 'memory.html?group=gq', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ceobe-memory-block');
  const memory = await page.evaluate(() => ({
    title: document.title,
    groups: [...document.querySelectorAll('[data-memory-group]')].map(node => node.textContent),
    blocks: [...document.querySelectorAll('.ceobe-memory-block h3')].map(node => node.textContent),
    items: document.querySelectorAll('.ceobe-memory-block li').length,
    active: document.querySelector('[data-ceobe-memory-row]')?.getAttribute('aria-current'),
  }));
  assert.equal(memory.title, '记忆');
  assert.deepEqual(memory.groups, ['国庆组', '01–05 序列']);
  assert.deepEqual(memory.blocks, ['我是谁', '在手的事', '等着的事', '近期变化']);
  assert.ok(memory.items > 0, '记忆库应有条目');
  assert.equal(memory.active, 'page', '侧栏记忆入口应标记当前页');

  await page.goto(base + 'project.html?id=4a801995-cd88-4b62-9686-d21ed87e2980', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-project-memory]');
  const gq = await page.evaluate(() => ({
    href: document.querySelector('[data-project-memory]')?.getAttribute('href'),
    hidden: document.querySelector('[data-project-memory]')?.hidden,
    label: document.querySelector('[data-project-memory]')?.textContent.trim(),
  }));
  assert.equal(gq.href, './memory.html?group=gq');
  assert.equal(gq.hidden, false);
  assert.equal(gq.label, '项目记忆');

  await page.goto(base + 'project.html?id=fe24db15-b1ce-4f1a-9c4b-0db48f0b3089', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-project-memory]');
  const g1 = await page.evaluate(() => ({
    href: document.querySelector('[data-project-memory]')?.getAttribute('href'),
    hidden: document.querySelector('[data-project-memory]')?.hidden,
  }));
  assert.equal(g1.href, './memory.html?group=g1');
  assert.equal(g1.hidden, false);
  assert.deepEqual(errors, [], '记忆页和项目跳转不应产生页面错误');
  console.log('PASS memory L3.1: gq/g1 banks, four blocks, sidebar active and project memory links');
} finally {
  await browser.close();
}
