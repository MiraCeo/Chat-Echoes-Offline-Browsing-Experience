import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractDocxText, extractText, MAX_BYTES, TEXT_FILE } from './asset-content.mjs';

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

// A minimal .docx: a zip whose word/document.xml holds the body text.
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const compressed = deflateRawSync(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(compressed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([head, nameBuf, compressed]);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([entry, nameBuf]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const docx = makeZip([{
  name: 'word/document.xml',
  text: '<w:document><w:body><w:p><w:r><w:t>你好</w:t></w:r></w:p><w:p><w:r><w:t>世界 &amp; 朋友</w:t></w:r></w:p></w:body></w:document>',
}]);
assert.equal(extractDocxText(docx), '你好 世界 & 朋友');
assert.equal(extractText('项目介绍.docx', docx), '你好 世界 & 朋友');

// A zip without word/document.xml is not a docx.
assert.equal(extractDocxText(makeZip([{ name: 'other.xml', text: '<x/>' }])), null);
assert.equal(extractDocxText(Buffer.from('not a zip')), null);

console.log('PASS asset content: extension filter, HTML stripping, size cap, docx unpacking');
