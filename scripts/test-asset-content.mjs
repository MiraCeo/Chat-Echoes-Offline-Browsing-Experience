import assert from 'node:assert/strict';
import { extractText, MAX_BYTES, TEXT_FILE } from './asset-content.mjs';

// Text extensions are indexed; binaries are not.
assert.ok(TEXT_FILE.test('项目介绍.md'));
assert.ok(TEXT_FILE.test('notes.txt'));
assert.ok(TEXT_FILE.test('data.json'));
assert.ok(TEXT_FILE.test('page.html'));
assert.ok(!TEXT_FILE.test('报告.pdf'));
assert.ok(!TEXT_FILE.test('截图.png'));
assert.ok(!TEXT_FILE.test('archive.zip'));

assert.equal(extractText('报告.pdf', Buffer.from('x')), null);
assert.equal(extractText('截图.png', Buffer.from('x')), null);

// Markdown is kept as-is (whitespace collapsed).
assert.equal(extractText('a.md', Buffer.from('# 标题\n\n正文  内容')), '# 标题 正文 内容');

// HTML/SVG are stripped of tags.
assert.equal(extractText('a.html', Buffer.from('<p>你好</p><b>世界</b>')), '你好 世界');
assert.equal(extractText('a.svg', Buffer.from('<svg><text>图标</text></svg>')), '图标');

// Oversized files are skipped.
const big = Buffer.alloc(MAX_BYTES + 1, 0x61);
assert.equal(extractText('big.txt', big), null);
assert.ok(extractText('ok.txt', Buffer.alloc(MAX_BYTES, 0x61)));

// Empty content is not indexable.
assert.equal(extractText('empty.md', Buffer.from('   \n  ')), '');

console.log('PASS asset content: extension filter, HTML stripping, size cap, whitespace collapse');
