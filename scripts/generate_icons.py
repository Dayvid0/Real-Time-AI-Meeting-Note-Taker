#!/usr/bin/env python3
"""Render the extension/store icons from ``store/icon.svg``.

Usage::

    python scripts/generate_icons.py

Requires ``cairosvg`` (see ``backend/requirements-dev.txt``). The generated
PNGs are committed so the build does not depend on this step.
"""

from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "store" / "icon.svg"
SIZES = (16, 32, 48, 128)

TARGETS = (
    ROOT / "extension" / "icons",
    ROOT / "store" / "icons",
)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Source SVG not found: {SOURCE}")

    for target in TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        for size in SIZES:
            out = target / f"icon{size}.png"
            cairosvg.svg2png(
                url=str(SOURCE),
                write_to=str(out),
                output_width=size,
                output_height=size,
            )
            print(f"wrote {out.relative_to(ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
