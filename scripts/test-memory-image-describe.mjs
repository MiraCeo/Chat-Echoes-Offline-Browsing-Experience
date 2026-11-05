import assert from 'node:assert/strict';
import { compact, shaOf } from './memory-image-describe.mjs';

// The archived filename is the sha256 plus an extension.
assert.equal(shaOf('D:/x/library-assets/abc123.png'), 'abc123');
assert.equal(shaOf('abc123.jpg'), 'abc123');
assert.equal(shaOf('no-extension'), 'no-extension');

// compact() keeps the summary and OCR, and caps the entity list.
const entry = compact({
  summary: '  一张招聘截图  ',
  ocr: { full_text: ' 交互策划（实习） 筛选中 ' },
  semantics: { entities: Array.from({ length: 30 }, (_, index) => ({ name: `e${index}` })) },
  uncertainty: ['a', 'b', 'c', 'd', 'e', 'f'],
}, { name: 'a.png', session: '会话' });
assert.equal(entry.summary, '一张招聘截图');
assert.equal(entry.ocr, '交互策划（实习） 筛选中');
assert.equal(entry.entities.length, 20);
assert.equal(entry.uncertainty.length, 5);
assert.equal(entry.session, '会话');
assert.ok(entry.at);

assert.equal(compact(null, { name: 'a.png' }), null);

console.log('PASS image describe: sha key, compact summary/ocr, entity and uncertainty caps');
