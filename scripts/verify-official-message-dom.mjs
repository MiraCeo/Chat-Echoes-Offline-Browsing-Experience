import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const path = process.argv[2]
  || 'replay/conversations/6a9849f6-3bec-83ee-b032-618d95fc0917.html';
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
assert.equal(generatedImages.length, 3, 'official generated-image DOM keeps three synchronized image layers');
assert(generatedImages.every(image => /archive-resources\/.+\.png$/i.test(image.getAttribute('src') || '')),
  'generated-image layers must use the archived local resource');

assert(document.querySelector('.chart-widget-container'), 'official structured-chart DOM is missing');
assert.equal(document.querySelectorAll('.ceobe-chart').length, 0,
  'the handwritten chart fallback must not replace the captured official chart');

const tables = [...document.querySelectorAll('.TyagGW_tableWrapper')];
assert(tables.length > 0, 'official table wrapper is missing');
assert(tables.every(wrapper => wrapper.querySelector('table')),
  'each official table wrapper must contain the JSON-rendered table');

const spreadsheet = sectionFor('074b7306-5ec5-4250-8462-5e2e66872fe6');
assert(spreadsheet, 'spreadsheet upload message is missing');
const spreadsheetTile = spreadsheet.querySelector('[data-ceobe-attachment-id]');
assert.equal(spreadsheetTile?.getAttribute('aria-label'), '2025美亚团体赛分值与答案.xlsx');
assert.equal(spreadsheetTile?.querySelector('[data-library-file-icon-key]')?.getAttribute('data-library-file-icon-key'), 'xls');
assert.match(spreadsheetTile?.textContent || '', /2025美亚团体赛分值与答案\.xlsx电子表格/);

for (const [id, expected] of [
  ['33e601b0-b481-4b64-b13f-c6b324067d11', 1],
  ['bc869ab3-63c8-48bd-9943-d7eb09092669', 3],
]) {
  const section = sectionFor(id);
  assert(section, `image upload message ${id} is missing`);
  assert.equal(section.querySelectorAll('[class~="group/message-image"] img').length, expected,
    `image upload message ${id} must retain its official attachment row`);
  assert.equal(section.querySelectorAll('[data-ceobe-attachment-id]').length, 0,
    `image upload message ${id} must not be rendered as a generic file tile`);
}

console.log(`Official message DOM verified: branch, 2 stopped states, generated image, chart, ${tables.length} tables, files, and 4 uploaded images.`);
