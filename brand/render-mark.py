#!/usr/bin/env python3
"""Rasterise brand/assets/mark.svg to a transparent PNG.

    python3 brand/render-mark.py 192 > brand/assets/mark-192.png

Email needs a PNG — an inline SVG does not render in Gmail or Outlook — and it
needs a transparent one, because the same file sits on Mist in a light client
and on Night in a dark one. Headless Chromium on this machine writes an opaque
PNG whatever it is told about the background, and a rasteriser is a dependency
that would have to be audited to sit next to the thing that handles what
somebody committed to. So the mark, which is one disc and four stroked
ellipses, is drawn here in fifty lines of arithmetic and checked against a
browser's rendering of the same SVG.

The geometry is read out of mark.svg rather than restated, so this file cannot
quietly disagree with the drawing it exists to export.
"""

import math
import re
import struct
import sys
import zlib
from pathlib import Path

SVG = Path(__file__).parent / 'assets' / 'mark.svg'
SS = 4  # samples per pixel per axis


def hexrgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def geometry(svg: str):
    box = re.search(r'viewBox="0 0 (\d+) \1"', svg)
    ball = re.search(r'<circle cx="(\d+)" cy="(\d+)" r="(\d+)" fill="(#\w+)"', svg)
    group = re.search(r'translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\) translate\(-([\d.]+),-([\d.]+)\)', svg)
    if not (box and ball and group):
        raise SystemExit(f'{SVG} is not the drawing this script knows how to read')
    ellipses = []
    for m in re.finditer(
        r'<ellipse cx="(-?[\d.]+)" cy="(-?[\d.]+)" rx="([\d.]+)" ry="([\d.]+)"[^>]*?'
        r'stroke="(#\w+)" stroke-width="([\d.]+)" transform="rotate\((-?[\d.]+) (-?[\d.]+) (-?[\d.]+)\)"',
        svg,
    ):
        cx, cy, rx, ry = (float(m.group(i)) for i in (1, 2, 3, 4))
        ang, ox, oy = (float(m.group(i)) for i in (7, 8, 9))
        ellipses.append((cx, cy, rx, ry, math.radians(-ang), ox, oy, float(m.group(6)) / 2, hexrgb(m.group(5))))
    if len(ellipses) != 4:
        raise SystemExit(f'expected the two 8s to be four ellipses, found {len(ellipses)}')
    return (
        int(box.group(1)),
        (float(ball.group(1)), float(ball.group(2)), float(ball.group(3)), hexrgb(ball.group(4))),
        (float(group.group(1)), float(group.group(2)), float(group.group(3)), float(group.group(4)), float(group.group(5))),
        ellipses,
    )


def render(size: int) -> bytes:
    view, (bx, by, br, ballrgb), (tx, ty, scale, ux, uy), ellipses = geometry(SVG.read_text())
    ink = ellipses[0][8]
    step = view / (size * SS)
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            hits = ink_hits = 0
            for sy in range(SS):
                v = (py * SS + sy + 0.5) * step
                for sx in range(SS):
                    u = (px * SS + sx + 0.5) * step
                    if (u - bx) ** 2 + (v - by) ** 2 > br * br:
                        continue
                    hits += 1
                    # World point into the 88's own coordinates.
                    gx, gy = (u - tx) / scale + ux, (v - ty) / scale + uy
                    for cx, cy, rx, ry, a, ox, oy, half, _ in ellipses:
                        dx, dy = gx - ox, gy - oy
                        ex = ox + dx * math.cos(a) - dy * math.sin(a) - cx
                        ey = oy + dx * math.sin(a) + dy * math.cos(a) - cy
                        f = (ex / rx) ** 2 + (ey / ry) ** 2 - 1
                        grad = math.hypot(2 * ex / rx**2, 2 * ey / ry**2)
                        # First order distance to the path. Exact where it
                        # matters — within a stroke width of the curve — and
                        # wrong only far away, where the sign is all we use.
                        if grad and abs(f / grad) <= half:
                            ink_hits += 1
                            break
            n = SS * SS
            if not hits:
                row += bytes(4)
                continue
            # Ink over ball, ball over nothing: composite in that order so the
            # 88 does not pick up a gold fringe at its edge.
            cover, inked = hits / n, ink_hits / n
            r, g, b = (
                round((ink[i] * inked + ballrgb[i] * (cover - inked)) / cover) if cover else 0 for i in range(3)
            )
            row += bytes((r, g, b, round(cover * 255)))
        rows.append(bytes(row))

    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


if __name__ == '__main__':
    sys.stdout.buffer.write(render(int(sys.argv[1]) if len(sys.argv) > 1 else 192))
