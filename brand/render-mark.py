#!/usr/bin/env python3
"""Rasterise one of brand/assets/*.svg to a transparent PNG.

    python3 brand/render-mark.py 160 > brand/assets/mark-email.png
    python3 brand/render-mark.py 192 brand/assets/mark-on-gold.svg > on-gold.png

The first argument is the output width; the height follows the viewBox. The
default source is mark-badge.svg, the mark on its own Paper disc, because that
is the one email needs: the same file sits on Paper in a light client and on
Night in a dark one, and the bare mark's Pine line vanishes on Night.

Email needs a PNG — an inline SVG does not render in Gmail or Outlook — and it
needs a transparent one. Headless Chromium on this machine writes an opaque
PNG whatever it is told about the background, and a rasteriser is a dependency
that would have to be audited to sit next to the thing that handles what
somebody committed to. So the marks, which are filled circles and one stroked
path of cubic curves, are drawn here in plain arithmetic.

The geometry is read out of the SVG rather than restated, so this file cannot
quietly disagree with the drawing it exists to export. It knows exactly the
subset the brand files use — `<circle fill>` and `<path d stroke
stroke-width>` with absolute M, C and Z — and refuses anything else rather
than drawing it wrong.
"""

import math
import re
import struct
import sys
import zlib
from pathlib import Path

DEFAULT_SVG = Path(__file__).parent / 'assets' / 'mark-badge.svg'
SS = 4  # samples per pixel per axis
CURVE_STEPS = 48  # line segments per cubic; well under a pixel at any size we export


def hexrgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def flatten(d: str, source: Path) -> list[tuple[float, float]]:
    """An absolute M/C/Z path as a polyline."""
    tokens = re.findall(r'[MCZ]|-?[\d.]+', d)
    points: list[tuple[float, float]] = []
    start = pen = (0.0, 0.0)
    i = 0
    while i < len(tokens):
        op = tokens[i]
        i += 1
        if op == 'M':
            pen = start = (float(tokens[i]), float(tokens[i + 1]))
            points.append(pen)
            i += 2
        elif op == 'C':
            while i < len(tokens) and tokens[i] not in 'MCZ':
                c1, c2, end = ((float(tokens[i + k]), float(tokens[i + k + 1])) for k in (0, 2, 4))
                for s in range(1, CURVE_STEPS + 1):
                    t = s / CURVE_STEPS
                    u = 1 - t
                    points.append(tuple(  # type: ignore[arg-type]
                        u**3 * pen[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t**3 * end[j] for j in (0, 1)
                    ))
                pen = end
                i += 6
        elif op == 'Z':
            points.append(start)
            pen = start
        else:
            raise SystemExit(f'{source}: path command {op!r} is not one this script draws')
    return points


def layers(svg: str, source: Path):
    """Everything drawn, back to front, as ('disc', ...) or ('stroke', ...)."""
    out = []
    for m in re.finditer(r'<(circle|path)\b([^>]*)/?>', svg):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(2)))
        if m.group(1) == 'circle':
            fill = attrs.get('fill', '')
            if not fill.startswith('#'):
                raise SystemExit(f'{source}: a circle filled with {fill!r} has no colour to export')
            out.append(('disc', float(attrs['cx']), float(attrs['cy']), float(attrs['r']), hexrgb(fill)))
        else:
            stroke = attrs.get('stroke', '')
            if not stroke.startswith('#') or attrs.get('fill') != 'none':
                raise SystemExit(f'{source}: only an unfilled path with a hex stroke is drawn here')
            out.append(('stroke', flatten(attrs['d'], source), float(attrs['stroke-width']) / 2, hexrgb(stroke)))
    if not out:
        raise SystemExit(f'{source} has nothing this script knows how to draw')
    return out


def render(width: int, source: Path = DEFAULT_SVG) -> bytes:
    svg = source.read_text()
    box = re.search(r'viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"', svg)
    if not box:
        raise SystemExit(f'{source} has no viewBox')
    vx, vy, vw, vh = (float(box.group(i)) for i in (1, 2, 3, 4))
    height = round(width * vh / vw)
    gw, gh = width * SS, height * SS
    step = vw / gw
    # One colour per sample, painted back to front; None is transparent.
    grid: list[tuple[int, int, int] | None] = [None] * (gw * gh)

    def cells(x0: float, y0: float, x1: float, y1: float):
        """Sample indices whose centres fall inside a world-space box."""
        c0 = max(0, int((x0 - vx) / step))
        c1 = min(gw - 1, int((x1 - vx) / step) + 1)
        r0 = max(0, int((y0 - vy) / step))
        r1 = min(gh - 1, int((y1 - vy) / step) + 1)
        for r in range(r0, r1 + 1):
            y = vy + (r + 0.5) * step
            for c in range(c0, c1 + 1):
                yield r * gw + c, vx + (c + 0.5) * step, y

    for layer in layers(svg, source):
        if layer[0] == 'disc':
            _, cx, cy, rad, rgb = layer
            for idx, x, y in cells(cx - rad, cy - rad, cx + rad, cy + rad):
                if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad:
                    grid[idx] = rgb
        else:
            _, pts, half, rgb = layer
            # A stroke is the union of capsules around each segment, which is
            # also what makes its joins round, as the SVG asks.
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                dx, dy = bx - ax, by - ay
                length2 = dx * dx + dy * dy
                for idx, x, y in cells(min(ax, bx) - half, min(ay, by) - half, max(ax, bx) + half, max(ay, by) + half):
                    t = 0.0 if not length2 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length2))
                    if (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= half * half:
                        grid[idx] = rgb

    rows = []
    n = SS * SS
    for py in range(height):
        row = bytearray()
        for px in range(width):
            got = [
                grid[(py * SS + sy) * gw + px * SS + sx]
                for sy in range(SS)
                for sx in range(SS)
            ]
            hit = [g for g in got if g is not None]
            if not hit:
                row += bytes(4)
                continue
            # Straight (not premultiplied) colour of what covers the pixel,
            # with coverage as alpha, so an edge fades to transparent rather
            # than to black.
            r, g, b = (round(sum(h[i] for h in hit) / len(hit)) for i in range(3))
            row += bytes((r, g, b, round(len(hit) / n * 255)))
        rows.append(bytes(row))

    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


if __name__ == '__main__':
    width = int(sys.argv[1]) if len(sys.argv) > 1 else 160
    source = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SVG
    sys.stdout.buffer.write(render(width, source))
