#!/usr/bin/env python3
"""Generate the Anvil project logo PNG from precise SVG layout."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SIZE = 1024
GAP = 12
RADIUS = 28
BORDER = 6  # scaled from extension default 3px

# Extension defaults (stylesheet.css / gschema.xml)
ACTIVE_BORDER = "#ec5e5e"  # rgba(236, 94, 94, 1) — window-tiled-border
SPLIT_BORDER = "#fff66c"  # rgba(255, 246, 108, 1) — window-split-border
INACTIVE_BORDER = "#1e2328"
CYAN_LIGHT = "#3de8f7"
CYAN_MID = "#11c7e0"  # tabbed palette
CYAN_DARK = "#0a6e82"
BG = "#121418"
ANVIL_FILL = "#d8dde3"
ANVIL_STROKE = "#8b939c"
ANVIL_DETAIL = "#5c636b"

LEFT_W = (SIZE - GAP) // 2
RIGHT_W = SIZE - GAP - LEFT_W
TOP_H = (SIZE - GAP) // 2
BOTTOM_H = SIZE - GAP - TOP_H

WINDOWS = [
    {
        "id": "tl",
        "x": 0,
        "y": 0,
        "w": LEFT_W,
        "h": TOP_H,
        "active": True,
        "gradient": ("tl", CYAN_LIGHT, CYAN_MID),
    },
    {
        "id": "bl",
        "x": 0,
        "y": TOP_H + GAP,
        "w": LEFT_W,
        "h": BOTTOM_H,
        "active": False,
        "gradient": ("bl", CYAN_MID, CYAN_DARK),
    },
    {
        "id": "r",
        "x": LEFT_W + GAP,
        "y": 0,
        "w": RIGHT_W,
        "h": SIZE,
        "active": False,
        "gradient": ("r", CYAN_LIGHT, CYAN_DARK),
    },
]

# Anvil path from anvil-logo-symbolic.svg (16×16 viewBox)
ANVIL_BODY = (
    "M 2.5 7 L 4 5.5 H 10 L 12 6.5 L 13.5 7.5 L 12 8 V 9 H 12.5 V 10.5 "
    "H 11.5 V 10 H 4.5 V 10.5 H 3.5 V 9 H 4 V 8 Z"
)
ANVIL_HOLES = [
    (5, 6.75, 1.75, 1.75),
    (7.25, 6.75, 1.75, 1.75),
    (5, 8.75, 1.75, 1.75),
    (7.25, 8.75, 1.75, 1.75),
]


def rounded_rect(x: float, y: float, w: float, h: float, r: float) -> str:
    return (
        f"M {x + r} {y} H {x + w - r} Q {x + w} {y} {x + w} {y + r} "
        f"V {y + h - r} Q {x + w} {y + h} {x + w - r} {y + h} "
        f"H {x + r} Q {x} {y + h} {x} {y + h - r} V {y + r} Q {x} {y} {x + r} {y} Z"
    )


def window_svg(win: dict) -> str:
    x, y, w, h = win["x"], win["y"], win["w"], win["h"]
    gid = win["gradient"][0]
    path = rounded_rect(x, y, w, h, RADIUS)
    stroke = ACTIVE_BORDER if win["active"] else INACTIVE_BORDER
    parts = [
        f'  <path d="{path}" fill="url(#grad-{gid})" stroke="{stroke}" '
        f'stroke-width="{BORDER}" />'
    ]
    if win["active"]:
        # window-split-vertical: yellow accent on the right edge only
        split_x = x + w - BORDER / 2
        parts.append(
            f'  <line x1="{split_x}" y1="{y + RADIUS}" x2="{split_x}" '
            f'y2="{y + h - RADIUS}" stroke="{SPLIT_BORDER}" stroke-width="{BORDER}" '
            f'stroke-linecap="round" />'
        )
    return "\n".join(parts)


def anvil_svg() -> str:
    # Stretch anvil horizontally edge-to-edge; keep aspect for legibility.
    src_w = 11.0
    src_h = 5.0
    src_x0 = 2.5
    src_y0 = 5.5
    pad_x = 0
    scale_x = (SIZE - pad_x * 2) / src_w
    scale_y = scale_x * 0.72
    tx = pad_x - src_x0 * scale_x
    ty = (SIZE - src_h * scale_y) / 2 - src_y0 * scale_y
    transform = f"translate({tx:.3f} {ty:.3f}) scale({scale_x:.3f} {scale_y:.3f})"

    holes = "\n".join(
        f'    <rect x="{hx}" y="{hy}" width="{hw}" height="{hh}" fill="none" '
        f'stroke="{ANVIL_DETAIL}" stroke-width="0.85" />'
        for hx, hy, hw, hh in ANVIL_HOLES
    )

    return f"""  <g transform="{transform}" filter="url(#anvil-shadow)">
    <path d="{ANVIL_BODY}" fill="{ANVIL_FILL}" stroke="{ANVIL_STROKE}" stroke-width="0.35" />
{holes}
  </g>"""


def build_svg() -> str:
    gradients = "\n".join(
        f"""    <linearGradient id="grad-{gid}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}" />
      <stop offset="100%" stop-color="{c2}" />
    </linearGradient>"""
        for gid, c1, c2 in {w["gradient"] for w in WINDOWS}
    )

    windows = "\n".join(window_svg(w) for w in WINDOWS)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
{gradients}
    <filter id="anvil-shadow" x="-5%" y="-10%" width="110%" height="125%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.45" />
    </filter>
  </defs>
  <rect width="{SIZE}" height="{SIZE}" fill="{BG}" />
{windows}
{anvil_svg()}
</svg>
"""


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    out_dir = repo / "src" / "resources" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)
    svg_path = out_dir / "anvil-logo.svg"
    png_path = out_dir / "anvil-logo.png"

    svg_path.write_text(build_svg(), encoding="utf-8")

    subprocess.run(
        ["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), "-o", str(png_path), str(svg_path)],
        check=True,
    )
    print(f"Wrote {svg_path}")
    print(f"Wrote {png_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())