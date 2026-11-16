#!/usr/bin/env python3
"""WO-1103 build step: a Rocketbox avatar's TGA maps -> the shipped WebP textures.

  python3 -I rocketbox_tex.py <avatar Textures dir> <prefix e.g. f020> <out dir> <body e.g. woman>

<body>_<map>.webp for map in body / head (colour, 2048), body_n / head_n (normal, 1024), body_s / head_s
(specular, 1024, grey), hair (the opacity sheet: hair cards, eyelashes; RGBA, as authored)."""
import os
import sys

from PIL import Image

src, prefix, out, body = sys.argv[1:5]
MAPS = {
    "body": ("body_color", 2048, "RGB", 88),
    "head": ("head_color", 2048, "RGB", 90),
    "body_n": ("body_normal", 1024, "RGB", 92),
    "head_n": ("head_normal", 1024, "RGB", 92),
    "body_s": ("body_specular", 1024, "L", 85),
    "head_s": ("head_specular", 1024, "L", 85),
    "hair": ("opacity_color", None, "RGBA", 92),
}
os.makedirs(out, exist_ok=True)
for name, (tga, size, mode, q) in MAPS.items():
    im = Image.open(os.path.join(src, "%s_%s.tga" % (prefix, tga))).convert(mode)
    if size and im.size[0] > size:
        im = im.resize((size, size * im.size[1] // im.size[0]), Image.LANCZOS)
    if mode == "L":
        im = im.convert("RGB")
    path = os.path.join(out, "%s_%s.webp" % (body, name))
    im.save(path, "WEBP", quality=q, method=6)
    print("%s %dx%d %d B" % (path, im.size[0], im.size[1], os.path.getsize(path)))
