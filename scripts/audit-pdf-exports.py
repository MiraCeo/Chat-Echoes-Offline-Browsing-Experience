"""Audit the PDF exports written by `npm run export:pdf`.

Checks every file in data/private/pdf for pages that overflow the text box and reports
totals, fonts used and short pages. Short pages are informational: a page holding a
short, line-broken message legitimately has little text.

Usage:
  python scripts/audit-pdf-exports.py [--dir data/private/pdf] [--short 120] [--strict]

Exit code is 1 when an overflow is found, or when --strict is passed and any short page
exists.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - dependency check
    print("需要 pymupdf：python -m pip install pymupdf", file=sys.stderr)
    raise SystemExit(2)

EDGE_TOLERANCE = 20


def audit(directory: Path, short_threshold: int) -> int:
    pdfs = sorted(directory.glob("*.pdf"))
    if not pdfs:
        print(f"没有可审计的 PDF：{directory}")
        return 0

    total_pages = 0
    short_pages: list[tuple[str, int, int]] = []
    trailing_blanks: list[str] = []
    overflows: list[tuple[str, int]] = []
    fonts: dict[str, int] = {}

    for pdf in pdfs:
        document = pymupdf.open(pdf)
        total_pages += document.page_count
        last = document[document.page_count - 1]
        if not last.get_text().strip() and not last.get_images():
            trailing_blanks.append(pdf.stem[:8])
        for page in document:
            text = page.get_text().strip()
            if len(text) < short_threshold:
                short_pages.append((pdf.stem[:8], page.number + 1, len(text)))
            for block in page.get_text("dict")["blocks"]:
                box = block.get("bbox")
                if box and (box[2] > page.rect.width - EDGE_TOLERANCE or box[0] < EDGE_TOLERANCE):
                    overflows.append((pdf.stem[:8], page.number + 1))
                    break
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        fonts[span["font"]] = fonts.get(span["font"], 0) + len(span["text"])
        document.close()

    size_mb = sum(pdf.stat().st_size for pdf in pdfs) / 1048576
    print(f"PDF {len(pdfs)} 个 / {total_pages} 页 / {size_mb:.1f} MB")
    print("字体 Top5：" + "、".join(f"{name} {count}" for name, count in
                                    sorted(fonts.items(), key=lambda item: -item[1])[:5]))
    print(f"越界页：{len(overflows)}" + (f"（前 5：{overflows[:5]}）" if overflows else ""))
    if trailing_blanks:
        print(f"末页空白：{len(trailing_blanks)} 个（{trailing_blanks[:5]}），属收尾元素溢出，不影响内容")
    print(f"短页（<{short_threshold} 字符）：{len(short_pages)}"
          + (f"（前 5：{short_pages[:5]}）" if short_pages else ""))

    if overflows:
        print("结论：存在越界，需检查 print.css")
        return 1
    print("结论：无越界；短页多见于逐行书写的消息，属内容驱动")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default="data/private/pdf")
    parser.add_argument("--short", type=int, default=120)
    parser.add_argument("--strict", action="store_true", help="有短页也返回非零")
    values = parser.parse_args()
    code = audit(Path(values.dir), values.short)
    if values.strict and code == 0:
        pdfs = sorted(Path(values.dir).glob("*.pdf"))
        for pdf in pdfs:
            document = pymupdf.open(pdf)
            if any(len(page.get_text().strip()) < values.short for page in document):
                document.close()
                return 1
            document.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
