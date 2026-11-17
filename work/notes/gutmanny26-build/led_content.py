"""led_content.py out.png — navy / gold gala content for the gutmanny 26 LED canvas (11520×1536), text only."""
import sys, math, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 11520, 1536
rng = np.random.default_rng(2026)
SER = '/usr/share/fonts/opentype/urw-base35/P052-Roman.otf'
BOLD = '/usr/share/fonts/opentype/urw-base35/P052-Bold.otf'
REG = {'wingL': (0, 0, 768, 1536), 'centre': (3264, 0, 4992, 1536), 'wingR': (10752, 0, 768, 1536)}
STR = [(768, 0, 2496, 384), (960, 576, 2112, 384), (768, 1152, 2496, 384), (8256, 0, 2496, 384), (8448, 576, 2112, 384), (8256, 1152, 2496, 384)]

# background: navy, brighter toward the centre bottom
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
d = np.sqrt(((x - W / 2) / (W * 0.42)) ** 2 + ((y - H * 1.05) / (H * 1.25)) ** 2)
g = np.clip(1 - d, 0, 1) ** 1.6
bg = np.stack([4 + 14 * g, 9 + 34 * g, 34 + 96 * g], -1)
img = Image.fromarray(bg.clip(0, 255).astype(np.uint8))
del y, x, d, g, bg

gold = Image.new('RGB', (W, H))
gy = np.linspace(0, 1, H)[:, None, None]
stops = np.array([[255, 236, 160], [226, 178, 74], [150, 100, 26]], np.float32)
gr = np.where(gy < 0.5, stops[0] + (stops[1] - stops[0]) * gy * 2, stops[1] + (stops[2] - stops[1]) * (gy - 0.5) * 2)
gold = Image.fromarray(np.broadcast_to(gr, (H, W, 3)).astype(np.uint8))

def lay(mask, blur=0, glow=0.0):
    """Composite gold through mask (L); optional soft glow underneath."""
    global img
    if glow:
        gl = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * glow))
        img = Image.composite(gold, img, gl)
    img = Image.composite(gold, img, mask)

# sunburst rays from below the centre screen
m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
cx, cy = W // 2, H + 500
for i in range(-60, 61):
    a = math.radians(90 + i * 1.45)
    dr.line([(cx, cy), (cx - math.cos(a) * 9000, cy - math.sin(a) * 9000)], fill=34 if i % 4 else 70, width=3 if i % 4 else 5)
lay(m)

# bokeh / gold dust, denser low
m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
for _ in range(5200):
    px = rng.uniform(0, W); py = H - abs(rng.normal(0, H * 0.42)); r = rng.choice([2, 3, 4, 6, 9, 14], p=[.3, .3, .2, .12, .06, .02])
    dr.ellipse([px - r, py - r, px + r, py + r], fill=int(rng.uniform(40, 200) * (1 if r < 9 else 0.45)))
lay(m.filter(ImageFilter.GaussianBlur(1.2)), 10, 0.5)

def frame(dr, x0, y0, w, h, inset, wd, fill=255):
    dr.rectangle([x0 + inset, y0 + inset, x0 + w - inset - 1, y0 + h - inset - 1], outline=fill, width=wd)

def spaced(dr, text, font, cx, cy, track, fill=255):
    ws = [dr.textlength(c, font=font) for c in text]; tot = sum(ws) + track * (len(text) - 1); px = cx - tot / 2
    for c, w in zip(text, ws):
        dr.text((px, cy), c, font=font, fill=fill, anchor='lm'); px += w + track
    return tot

m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
# centre screen
x0, y0, w, h = REG['centre']; cx = x0 + w // 2
frame(dr, x0, y0, w, h, 40, 6); frame(dr, x0, y0, w, h, 62, 2, 170)
big = ImageFont.truetype(BOLD, 430); mid = ImageFont.truetype(SER, 250); small = ImageFont.truetype(SER, 92)
tot = spaced(dr, 'GUTTMANNY', big, cx, 600, 70)
spaced(dr, '2026', mid, cx, 1010, 150)
for s in (-1, 1):
    dr.line([(cx + s * 520, 1010), (cx + s * (tot / 2), 1010)], fill=220, width=5)
    dr.polygon([(cx + s * 470, 1010), (cx + s * 500, 990), (cx + s * 530, 1010), (cx + s * 500, 1030)], fill=255)
spaced(dr, 'GALA  EVENING', small, cx, 1240, 46, 200)
dr.line([(cx - tot / 2, 330), (cx + tot / 2, 330)], fill=200, width=4)
for k in range(-3, 4):
    dr.polygon([(cx + k * 90, 250), (cx + k * 90 + 26, 200 - 12 * (3 - abs(k))), (cx + k * 90 + 52, 250)], outline=230)
# wings: frame, fan of chevrons, year
for key in ('wingL', 'wingR'):
    x0, y0, w, h = REG[key]; c = x0 + w // 2
    frame(dr, x0, y0, w, h, 30, 6); frame(dr, x0, y0, w, h, 50, 2, 170)
    for k in range(9):
        yy = 250 + k * 62; hw = 250 - k * 22
        dr.line([(c - hw, yy + 90), (c, yy), (c + hw, yy + 90)], fill=255 - k * 18, width=5)
    dr.polygon([(c, 880), (c + 46, 950), (c, 1020), (c - 46, 950)], fill=255)
    spaced(dr, '2026', ImageFont.truetype(SER, 150), c, 1180, 26)
    dr.line([(c - 230, 1300), (c + 230, 1300)], fill=200, width=4)
# stripes: rails, ribbon, diamonds
for (x0, y0, w, h) in STR:
    dr.line([(x0 + 20, y0 + 26), (x0 + w - 20, y0 + 26)], fill=255, width=6); dr.line([(x0 + 20, y0 + h - 27), (x0 + w - 20, y0 + h - 27)], fill=255, width=6)
    dr.line([(x0 + 20, y0 + 44), (x0 + w - 20, y0 + 44)], fill=150, width=2); dr.line([(x0 + 20, y0 + h - 45), (x0 + w - 20, y0 + h - 45)], fill=150, width=2)
    for ph, amp, a in ((0.0, 70, 230), (1.3, 52, 150), (2.6, 34, 100)):
        pts = [(x0 + t, y0 + h / 2 + amp * math.sin(t / 210.0 + ph + x0 * 0.001)) for t in range(0, w + 1, 8)]
        dr.line(pts, fill=a, width=4)
    for t in range(192, w, 384):
        c = x0 + t; dr.polygon([(c, y0 + h / 2 - 34), (c + 22, y0 + h / 2), (c, y0 + h / 2 + 34), (c - 22, y0 + h / 2)], fill=255)
lay(m, 14, 0.55)
img.save(sys.argv[1], optimize=False, compress_level=6); print(sys.argv[1], img.size)
