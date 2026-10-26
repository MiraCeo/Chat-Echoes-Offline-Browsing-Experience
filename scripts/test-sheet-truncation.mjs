import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sheetTableHtml } from './sheet-table.mjs';

// 大表截断是构建期 Python 的行为：这里造一张 700 行的表，真跑一次解析脚本，再验证渲染。
const root = await mkdtemp(join('data/private', 'sheet-trunc-'));
const source = join(root, 'big.xlsx');
const out = join(root, 'prepared');
try {
  await mkdir(out, { recursive: true });
  execFileSync('python', ['-c', [
    'import openpyxl, sys',
    'book = openpyxl.Workbook()',
    'sheet = book.active',
    'sheet.title = "大表"',
    'for row in range(1, 701):',
    '    sheet.cell(row=row, column=1, value=f"第{row}行")',
    '    sheet.cell(row=row, column=2, value=row)',
    '    sheet.cell(row=row, column=3, value=f"=B{row}*2")',
    'sheet.column_dimensions["B"].hidden = True',
    `book.save(r"${source}")`,
  ].join('\n')], { windowsHide: true });

  execFileSync('python', [resolve('scripts/prepare-preview-data.py'), source, out, 'xlsx'], { windowsHide: true });
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const sheet = manifest.sheets[0];
  assert.equal(sheet.name, '大表');
  assert.equal(sheet.rows.length, 500, 'rows must be capped at 500');
  assert.equal(sheet.widths.length, 3, 'all three columns are kept');
  assert.deepEqual(sheet.truncated, { totalRows: 700, totalCols: 3 }, 'the manifest must report the original size');
  assert.deepEqual(sheet.hiddenCols, [2], 'hidden columns are reported so the preview can mark them');

  const html = sheetTableHtml(sheet, 0);
  assert.match(html, /仅预览前 500 行 × 3 列（原表 700 行 × 3 列）/, 'the caption explains the truncation');
  assert.match(html, /<th data-col="1"[^>]*data-sheet-hidden=""/, 'the hidden column header is marked');
  assert.equal((html.match(/<tr /g) || []).length, 500, 'only 500 rows are rendered');

  // 小表不受影响：没有 truncated 就没有 caption，行列也不标隐藏。
  const small = { name: '小表', widths: [80], heights: [20], rows: [[{ value: 'x', color: '#111', fill: '#fff', size: 14, bold: false, italic: false, align: 'left', wrap: false }]] };
  assert.ok(!sheetTableHtml(small, 0).includes('<caption'));
  assert.ok(!sheetTableHtml(small, 0).includes('data-sheet-hidden'));

  console.log('PASS sheet truncation: 700-row sheet is capped at 500 with the original size in the caption, hidden columns are marked, small sheets are untouched.');
} finally {
  await rm(root, { recursive: true, force: true });
}
