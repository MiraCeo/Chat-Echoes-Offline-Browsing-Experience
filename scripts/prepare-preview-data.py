"""Read one archived attachment and produce disposable replay preview data."""
import json
import sys
import zipfile
from html import escape
from pathlib import Path
from xml.etree import ElementTree

source, output = map(Path, sys.argv[1:3])
kind = sys.argv[3]
output.mkdir(parents=True, exist_ok=True)
data = {'pages': [], 'sheets': [], 'html': '', 'text': None, 'text_metadata': None}

if kind == 'pdf':
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(source)
    for index in range(len(pdf)):
        page = pdf[index]
        width, height = page.get_size()
        bitmap = page.render(scale=1.5)
        filename = f'pdf-page-{index + 1}.png'
        bitmap.to_pil().save(output / filename)
        data['pages'].append({'width': width, 'height': height, 'src': filename})
        bitmap.close()
        page.close()
    pdf.close()

def rgb(color, default):
    return '#' + color.rgb[-6:] if color is not None and color.type == 'rgb' else default

if kind == 'xlsx':
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter
    book = load_workbook(source, data_only=True)
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
        data['sheets'].append({
            'name': sheet.title, 'rows': rows,
            'widths': [round((sheet.column_dimensions[get_column_letter(c)].width or 13) * 7 + 5) for c in range(1, sheet.max_column + 1)],
            'heights': [round((sheet.row_dimensions[r].height or sheet.sheet_format.defaultRowHeight or 15) * 4 / 3) for r in range(1, sheet.max_row + 1)],
        })
    book.close()

if kind == 'txt':
    raw = source.read_bytes()
    encoding = 'utf-8-sig' if raw.startswith(b'\xef\xbb\xbf') else 'utf-8'
    try:
        text = raw.decode(encoding)
    except UnicodeDecodeError:
        encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'gb18030'
        text = raw.decode(encoding, errors='replace')
    data['text'] = text
    data['text_metadata'] = {
        'bytes': len(raw), 'characters': len(text), 'lines': len(text.splitlines()),
        'encoding': encoding, 'replacement_characters': text.count('\ufffd'),
        'line_endings': {
            'crlf': text.count('\r\n'),
            'lf': text.count('\n') - text.count('\r\n'),
            'cr': text.count('\r') - text.count('\r\n'),
        },
    }
    data['html'] = '<pre class="ceobe-text-preview">' + escape(text) + '</pre>'

if kind == 'docx':
    with zipfile.ZipFile(source) as package:
        document = ElementTree.fromstring(package.read('word/document.xml'))
    namespace = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    paragraphs = []
    for paragraph in document.findall('.//w:p', namespace):
        text = ''.join(node.text or '' for node in paragraph.findall('.//w:t', namespace))
        if text:
            paragraphs.append('<p>' + escape(text) + '</p>')
    data['html'] = ''.join(paragraphs)

(output / 'manifest.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
print(f"Prepared {len(data['pages'])} PDF pages, {len(data['sheets'])} worksheets and {kind} document content.")
