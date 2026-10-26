/**
 * Render one worksheet as a read-only table for the attachment preview.
 *
 * Kept out of build-file-previews so it can be tested on its own: merged ranges become
 * rowspan/colspan on the top-left cell and the covered cells are dropped.
 */
export const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const hiddenMark = (hidden, label) => (hidden ? ` data-sheet-hidden="" title="原表里这一${label}是隐藏的"` : '');

export const sheetTableHtml = (sheet, index) => {
  const spans = new Map();
  const covered = new Set();
  for (const [r1, c1, r2, c2] of sheet.merges || []) {
    spans.set(`${r1}:${c1}`, { rowspan: r2 - r1 + 1, colspan: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    }
  }
  const hiddenRows = new Set(sheet.hiddenRows || []);
  const hiddenCols = new Set(sheet.hiddenCols || []);

  const columns = sheet.widths
    .map((width, column) => `<th data-col="${column}" style="min-width:${width}px;width:${width}px"${hiddenMark(hiddenCols.has(column + 1), '列')}>${String.fromCharCode(65 + column)}</th>`)
    .join('');

  const rows = sheet.rows.map((row, rowIndex) => {
    const rowHidden = hiddenRows.has(rowIndex + 1);
    const cells = row.map((cell, columnIndex) => {
      if (covered.has(`${rowIndex + 1}:${columnIndex + 1}`)) return '';
      const span = spans.get(`${rowIndex + 1}:${columnIndex + 1}`);
      const attrs = span
        ? `${span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ''}${span.colspan > 1 ? ` colspan="${span.colspan}"` : ''}`
        : '';
      const align = ['left', 'right', 'center'].includes(cell.align) ? cell.align : 'left';
      const style = `color:${cell.color};background:${cell.fill};font-size:${cell.size}px;`
        + `font-weight:${cell.bold ? 700 : 400};font-style:${cell.italic ? 'italic' : 'normal'};`
        + `text-align:${align};white-space:${cell.wrap ? 'pre-wrap' : 'pre'}`;
      return `<td data-col="${columnIndex}"${attrs} style="${style}"${rowHidden || hiddenCols.has(columnIndex + 1) ? ' data-sheet-hidden=""' : ''}>${escapeHtml(cell.value)}</td>`;
    }).join('');
    return `<tr style="height:${sheet.heights[rowIndex]}px"${hiddenMark(rowHidden, '行')}><th scope="row">${rowIndex + 1}</th>${cells}</tr>`;
  }).join('');

  // 大表只渲染前 N 行/列；把截断说明放在 caption 里，切换工作表时会一起隐藏。
  const note = sheet.truncated
    ? `<caption style="caption-side:top;text-align:left;padding:6px 4px 8px;color:#98a2b3;font-size:11px">`
      + `仅预览前 ${sheet.rows.length} 行 × ${sheet.widths.length} 列（原表 ${sheet.truncated.totalRows} 行 × ${sheet.truncated.totalCols} 列）；完整内容请下载原文件。</caption>`
    : '';
  return `<table class="ceobe-sheet-grid" data-ceobe-sheet="${index}" aria-label="${escapeHtml(sheet.name)}"`
    + `${index ? ' hidden' : ''}>${note}<thead><tr><th></th>${columns}</tr></thead><tbody>${rows}</tbody></table>`;
};
