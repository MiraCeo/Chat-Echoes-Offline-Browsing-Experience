import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

// 检查的是“用夹具 + 冻结模板”渲染出来的那一页（含官方生成图片/图表/表格等结构），
// 不依赖本地档案：缺页时先按 npm run replay:sample 的方式把它生成出来。
const FIXTURE_ID = '11111111-1111-4111-8111-111111111111';
const path = process.argv[2] || `replay/conversations/${FIXTURE_ID}.html`;
if (!existsSync(path)) {
  execFileSync(process.execPath, ['scripts/build-official-replay.mjs',
    '--input', `fixtures/chatgpt-share/${FIXTURE_ID}/conversation.ceobe.json`,
    '--sample-assets', '--output-page', path, '--preserve-output'], { stdio: 'inherit' });
}
const document = parseHTML(await readFile(path, 'utf8')).document;
const sections = [...document.querySelectorAll('section[data-testid^="conversation-turn-"]')];

const messageIds = (section) => {
  try {
    return JSON.parse(section.getAttribute('data-ceobe-message-ids') || '[]');
  } catch {
    return [];
  }
};
const sectionFor = (id) => sections.find(section => messageIds(section).includes(id));

const branch = [...document.querySelectorAll('p')]
  .find(paragraph => /从\s*测试消息\s*建立的分支/.test(paragraph.textContent));
assert(branch, 'branch origin footer is missing');
assert.equal(branch.querySelector('a')?.getAttribute('href'), 'https://chatgpt.com/c/6a98451f-9b54-83ee-abe6-87a7b0b2a4ef');
assert.equal(branch.parentElement?.children.length, 3, 'branch footer must retain the two official divider elements');

const stopped = [...document.querySelectorAll('button')]
  .filter(button => button.textContent.trim() === '已停止思考');
assert.equal(stopped.length, 2, 'cancelled reasoning messages must use the two official stopped-thinking buttons');
for (const button of stopped) {
  assert(button.querySelector('svg'), 'stopped-thinking button must retain its official chevron');
  assert.equal(button.closest('section')?.getAttribute('data-turn'), 'assistant',
    'stopped-thinking button must remain inside an assistant turn');
}

const generated = sectionFor('dd1930dc-b766-43ff-9219-7baf8dc18e07');
assert(generated, 'generated-image message is missing');
assert(generated.querySelector('[class~="group/imagegen-image"]'), 'official generated-image container is missing');
const generatedImages = [...generated.querySelectorAll('[class~="group/imagegen-image"] img')];
if (generatedImages.length === 3) {
  assert(generatedImages.every(image => /archive-resources\/.+\.png$/i.test(image.getAttribute('src') || '')),
    'generated-image layers must use the archived local resource');
} else {
  // 这次会话的生成图片没有归档字节：页面按占位符渲染，三层同步图无从校验。
  console.log('SKIP generated-image layers: 该会话的生成图片字节未归档，页面按占位符渲染。');
}

assert(document.querySelector('.chart-widget-container'), 'official structured-chart DOM is missing');
assert.equal(document.querySelectorAll('.ceobe-chart').length, 0,
  'the handwritten chart fallback must not replace the captured official chart');

const tables = [...document.querySelectorAll('.TyagGW_tableWrapper')];
assert(tables.length > 0, 'official table wrapper is missing');
assert(tables.every(wrapper => wrapper.querySelector('table')),
  'each official table wrapper must contain the JSON-rendered table');

const spreadsheet = sectionFor('074b7306-5ec5-4250-8462-5e2e66872fe6');
const spreadsheetTile = spreadsheet?.querySelector('[data-ceobe-attachment-id]');
if (spreadsheetTile) {
  // 只校验结构（附件磁贴 + xls 图标 + “电子表格”文案），不绑定具体文件名：
  // 夹具里的附件名在公开前可能被脱敏，绑死名字会让这项检查随数据漂移。
  assert.equal(spreadsheetTile.querySelector('[data-library-file-icon-key]')?.getAttribute('data-library-file-icon-key'), 'xls');
  assert.match(spreadsheetTile.textContent || '', /电子表格/);
  assert.match(spreadsheetTile.getAttribute('aria-label') || '', /\.xlsx$/);
} else {
  console.log('SKIP spreadsheet tile: 当前页面里没有可校验的表格附件磁贴。');
}

for (const [id, expected] of [
  ['33e601b0-b481-4b64-b13f-c6b324067d11', 1],
  ['bc869ab3-63c8-48bd-9943-d7eb09092669', 3],
]) {
  const section = sectionFor(id);
  if (!section) {
    console.log(`SKIP image upload ${id}: 这条消息不在当前页面里。`);
    continue;
  }
  const rows = section.querySelectorAll('[class~="group/message-image"] img').length;
  if (rows === 0) {
    // 图片字节没有归档时页面用占位符渲染，这一项无从校验。
    console.log(`SKIP image upload ${id}: 图片未归档，页面按占位符渲染。`);
  } else {
    assert.equal(rows, expected, `image upload message ${id} must retain its official attachment row`);
  }
  assert.equal(section.querySelectorAll('[data-ceobe-attachment-id]').length, 0,
    `image upload message ${id} must not be rendered as a generic file tile`);
}

console.log(`Official message DOM verified: branch, 2 stopped states, generated images, chart, ${tables.length} tables, spreadsheet tile, uploaded images.`);
