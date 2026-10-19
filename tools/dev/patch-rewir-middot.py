#!/usr/bin/env python3
"""WO-620 — give Rewir-Light's empty "·" (U+00B7) and "•" (U+2022) glyphs an outline.

Rewir maps both codepoints to glyphs with no contours, so every " · " separator renders as a blank gap — and no font
fallback can help, because the font claims the codepoint. Both become composites of Rewir's own period, centred in
their advance at half the x-height ("•" scaled 1.5×). DSIG is dropped (any change invalidates it); name ID 5 records
the patch. Idempotent: a glyph that already has an outline is left alone. OFL permits modified versions; Rewir declares
no Reserved Font Name. Needs python3-fonttools.

usage: patch-rewir-middot.py IN.ttf OUT.ttf
"""
import sys

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

TARGETS = {0x00B7: 1.0, 0x2022: 1.5}  # codepoint → scale of the period
NOTE = 'middot/bullet outlines (HighAsCG WO-620)'


def main(src, dst):
    font = TTFont(src)
    cmap = font.getBestCmap()
    glyf, hmtx = font['glyf'], font['hmtx']
    period = glyf[cmap[0x2E]]
    half_x = font['OS/2'].sxHeight / 2
    changed = []
    for code, scale in TARGETS.items():
        name = cmap[code]
        if glyf[name].numberOfContours != 0:
            continue
        cx = (period.xMin + period.xMax) / 2 * scale
        cy = (period.yMin + period.yMax) / 2 * scale
        comp = GlyphComponent()
        comp.glyphName = cmap[0x2E]
        comp.x = round(hmtx[name][0] / 2 - cx)
        comp.y = round(half_x - cy)
        comp.flags = 0x4  # ROUND_XY_TO_GRID
        if scale != 1.0:
            comp.transform = [[scale, 0], [0, scale]]
        g = Glyph()
        g.numberOfContours = -1
        g.components = [comp]
        glyf[name] = g
        g.recalcBounds(glyf)
        hmtx[name] = (hmtx[name][0], g.xMin)
        changed.append('%s U+%04X' % (name, code))
    if changed:
        if 'DSIG' in font:
            del font['DSIG']
        for rec in font['name'].names:
            if rec.nameID == 5 and NOTE not in str(rec):
                rec.string = '%s; %s' % (rec.toUnicode(), NOTE)
    font.save(dst)
    print('patched: ' + (', '.join(changed) if changed else 'nothing (already outlined)'))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
