import assert from 'node:assert/strict';
import { sheetTableHtml } from './sheet-table.mjs';

// 一张小表：第 1 行合并 A1:C1，A5:B6 合并，外加数字格式后的文本与转义。
const cell = (value, extra = {}) => ({
  value, bold: false, italic: false, color: '#111111', fill: '#ffffff',
  align: 'left', wrap: false, size: 14.6, ...extra,
});

const sheet = {
  name: '格式 & 合并',
  widths: [80, 90, 70],
  heights: [20, 20, 20, 20, 20, 20],
  merges: [[1, 1, 1, 3], [5, 1, 6, 2]],
  rows: [
    [cell('合并标题'), cell(''), cell('')],
    [cell('项目'), cell('金额'), cell('比例')],
    [cell('甲'), cell('1,234.50', { align: 'right' }), cell('12.3%')],
    [cell('乙'), cell('99.00'), cell('&<b>')],
    [cell('合并格'), cell(''), cell('')],
    [cell(''), cell(''), cell('')],
  ],
};

const html = sheetTableHtml(sheet, 0);

// 合并：左上角带 colspan/rowspan，被覆盖的单元格不出现。
assert.match(html, /<td colspan="3"/, 'A1 应带 colspan=3');
assert.match(html, /<td rowspan="2" colspan="2"/, 'A5 应同时带 rowspan 与 colspan');
assert.equal((html.match(/<td/g) || []).length, 18 - 2 - 3, '被合并覆盖的 5 个单元格不应渲染');

// 数字格式后的文本原样输出。
assert.ok(html.includes('1,234.50') && html.includes('12.3%'), '格式化的金额与百分比应保留');

// 文本转义，表格属性也转义。
assert.match(html, /&amp;&lt;b&gt;/, '单元格文本应转义');
assert.match(html, /aria-label="格式 &amp; 合并"/, '工作表名应转义');

// 第二张表默认隐藏，第一张可见。
assert.ok(!/hidden/.test(sheetTableHtml(sheet, 0)), '第一张表不应隐藏');
assert.match(sheetTableHtml(sheet, 1), /hidden/, '后续工作表默认隐藏');

// 表头列字母按列数生成，行号列存在。
assert.match(html, />A<\/th>.*>B<\/th>.*>C<\/th>/s, '列字母表头');
assert.match(html, /<th scope="row">1<\/th>/, '行号列');

console.log('Sheet table: 合并区域、格式化文本、转义、隐藏与表头均符合预期。');
