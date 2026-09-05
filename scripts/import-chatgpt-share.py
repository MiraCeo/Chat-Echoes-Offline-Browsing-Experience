#!/usr/bin/env python3
"""CLI for importing saved ChatGPT share HTML into CEOBE JSON."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from importers.chatgpt_share.importer import import_share_file  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Saved ChatGPT share-page HTML")
    parser.add_argument("--output", "-o", type=Path, required=True, help="CEOBE JSON output")
    parser.add_argument("--source-url", help="Original public share URL")
    args = parser.parse_args()

    conversation = import_share_file(args.input, args.output, source_url=args.source_url)
    print(
        f"Imported {len(conversation['messages'])} messages and "
        f"{len(conversation['nodes'])} nodes -> {args.output}"
    )


if __name__ == "__main__":
    main()

