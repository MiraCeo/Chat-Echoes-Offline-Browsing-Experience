"""Read original attachments; produce disposable replay assets, never edit originals."""
import json
import sys
from pathlib import Path

import pypdfium2 as pdfium
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

root, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
pages = []
pdf = pdfium.PdfDocument(root / '技术部-开发组-加分题.pdf')
for index in range(len(pdf)):
    page = pdf[index]
    width, height = page.get_size()
    bitmap = page.render(scale=1.5)
    bitmap.to_pil().save(output / f'pdf-page-{index + 1}.png')
    pages.append({'width': width, 'height': height, 'src': f'pdf-page-{index + 1}.png'})
    bitmap.close()
    page.close()
pdf.close()

def rgb(color, default):
    return '#' + color.rgb[-6:] if color is not None and color.type == 'rgb' else default

book = load_workbook(root / '票据收集情况.xlsx', data_only=True)
sheets = []
for sheet in book:
    rows = []
    for row in sheet:
        rows.append([{
            'value': '' if cell.value is None else str(cell.value),
            'bold': bool(cell.font.b), 'italic': bool(cell.font.i),
            'color': rgb(cell.font.color, '#111111'),
            'fill': rgb(cell.fill.fgColor, '#ffffff') if cell.fill.patternType == 'solid' else '#ffffff',
            'align': cell.alignment.horizontal or ('right' if isinstance(cell.value, (int, float)) else 'left'),
            'wrap': bool(cell.alignment.wrap_text),
            'size': float(cell.font.sz or 11) * 4 / 3,
        } for cell in row])
    sheets.append({
        'name': sheet.title, 'rows': rows,
        'widths': [round((sheet.column_dimensions[get_column_letter(c)].width or 13) * 7 + 5) for c in range(1, sheet.max_column + 1)],
        'heights': [round((sheet.row_dimensions[r].height or sheet.sheet_format.defaultRowHeight or 15) * 4 / 3) for r in range(1, sheet.max_row + 1)],
    })
book.close()
(output / 'manifest.json').write_text(json.dumps({'pages': pages, 'sheets': sheets}, ensure_ascii=False), encoding='utf-8')
print(f'Prepared {len(pages)} PDF pages and {len(sheets)} worksheets.')
