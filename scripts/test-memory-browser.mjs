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
    mainlines: document.querySelectorAll('[data-memory-mainline]').length,
    status: document.querySelector('[data-memory-status]')?.textContent,
    active: document.querySelector('[data-ceobe-memory-row]')?.getAttribute('aria-current'),
  }));
  assert.equal(memory.title, '记忆');
  assert.deepEqual(memory.groups, ['国庆组', '01–05 序列', '未分组 15']);
  assert.deepEqual(memory.blocks, ['我是谁', '在手的事', '等着的事', '近期变化']);
  assert.ok(memory.items > 0, '记忆库应有条目');
  assert.equal(memory.mainlines, 5, 'gq 应显示 5 条主线');
  assert.match(memory.status, /截至 2026-10-13/);
  assert.equal(memory.active, 'page', '侧栏记忆入口应标记当前页');

  await page.goto(base + 'memory.html?group=g1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ceobe-memory-block');
  const g1memory = await page.evaluate(() => ({
    status: document.querySelector('[data-memory-status]')?.textContent,
    mainlines: document.querySelectorAll('[data-memory-mainline]').length,
    themes: [...document.querySelectorAll('.ceobe-memory-theme')].map(node => node.textContent),
    delta: document.querySelector('.ceobe-memory-delta summary')?.textContent,
  }));
  assert.match(g1memory.status, /6 个会话/);
  assert.match(g1memory.status, /截至 2026-10-26/);
  assert.equal(g1memory.mainlines, 5, 'g1 应显示 5 条主线');
  assert.match(g1memory.themes.join(' '), /设计心理学/);
  assert.match(g1memory.delta || '', /8 项/);

  await page.goto(base + 'memory.html?group=ungrouped', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ceobe-memory-ungrouped-list');
  const ungrouped = await page.evaluate(() => ({
    count: document.querySelectorAll('.ceobe-memory-ungrouped-list > li').length,
    status: document.querySelector('[data-memory-status]')?.textContent,
    hasSummary: Boolean(document.querySelector('.ceobe-memory-ungrouped-list p')),
  }));
  assert.equal(ungrouped.count, 15, '未分组应列 15 个会话');
  assert.match(ungrouped.status, /仅 L1\/L2\/L4/);
  assert.equal(ungrouped.hasSummary, true);

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
  console.log('PASS memory v2: gq/g1 L3.1 banks, 5 mainlines, as_of, delta, ungrouped and project links');
} finally {
  await browser.close();
}
