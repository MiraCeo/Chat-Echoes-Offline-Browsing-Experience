"""Stamp a header on page one and page numbers on every page of an exported PDF.

The reader shell puts its content inside fixed wrappers, so in paged media the body starts
~16mm below the page margin and nothing inside the document can be drawn in that band. A
stamp after export is deterministic and does not fight the layout.

Usage:
  python scripts/pdf-stamp.py --pdf <file> [--title <text>] [--date YYYY-MM-DD] [--no-page-numbers]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover
    print("需要 pymupdf：python -m pip install pymupdf", file=sys.stderr)
    raise SystemExit(2)

MM = 72 / 25.4
GREY = (0.42, 0.47, 0.54)
DARK = (0.12, 0.16, 0.22)
HAIRLINE = (0.89, 0.91, 0.94)


def stamp(pdf: Path, title: str, date: str, page_numbers: bool) -> None:
    document = pymupdf.open(pdf)
    total = document.page_count

    if title or date:
        first = document[0]
        left = 5 * MM
        baseline = 9 * MM
        if title:
            first.insert_text((left, baseline), title[:80], fontname="china-s", fontsize=11, color=DARK)
        if date:
            first.insert_text((left, baseline + 4.6 * MM), f"本地归档 · 导出于 {date}",
                              fontname="china-s", fontsize=7.5, color=GREY)
        rule_y = baseline + 6.6 * MM
        first.draw_line((left, rule_y), (first.rect.width - 5 * MM, rule_y), color=HAIRLINE, width=0.6)

    if page_numbers:
        for index, page in enumerate(document):
            label = f"{index + 1} / {total}"
            width = pymupdf.get_text_length(label, fontname="helv", fontsize=7.5)
            page.insert_text(((page.rect.width - width) / 2, page.rect.height - 5 * MM),
                             label, fontname="helv", fontsize=7.5, color=GREY)

    document.saveIncr()
    document.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--date", default="")
    parser.add_argument("--no-page-numbers", action="store_true")
    values = parser.parse_args()
    target = Path(values.pdf)
    if not target.exists():
        print(f"找不到 PDF：{target}", file=sys.stderr)
        return 2
    stamp(target, values.title, values.date, not values.no_page_numbers)
    print(f"已盖章：{target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
