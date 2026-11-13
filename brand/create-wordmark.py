#!/usr/bin/env python3
"""Regenerate the outlined wordmark source from the licensed local Fraunces font.
Requires fonttools[woff]; the normal Node build reads the committed output.
"""
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

root = Path(__file__).resolve().parent
source = root / 'fonts/fraunces-latin-v1.woff2'
font = instantiateVariableFont(TTFont(source), {'opsz': 36, 'wght': 500}, inplace=True)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
pen = SVGPathPen(glyphs)
bounds = BoundsPen(glyphs)
advance = 0
for char in '8&80':
    name = cmap[ord(char)]
    transform = (1, 0, 0, 1, advance, 0)
    glyphs[name].draw(TransformPen(pen, transform))
    glyphs[name].draw(TransformPen(bounds, transform))
    advance += font['hmtx'].metrics[name][0]
data = {'family': 'Fraunces', 'weight': 500, 'opticalSize': 36,
        'unitsPerEm': font['head'].unitsPerEm, 'advance': advance,
        'bounds': bounds.bounds, 'path': pen.getCommands(),
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest()}
(root / 'wordmark-outline.json').write_text(json.dumps(data, indent=2) + '\n')
print('Built brand/wordmark-outline.json')
