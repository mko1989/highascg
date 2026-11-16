# WO-1103 — the bodies' textures from the MakeHuman CC0 system assets → small WebP files (sizes per role).
import sys, os
from PIL import Image, ImageChops
X, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
def save(img, name, size, q=82, alpha=False):
    img = img.convert("RGBA" if alpha else "RGB").resize((size, size), Image.LANCZOS)
    p = os.path.join(OUT, name + ".webp")
    img.save(p, "WEBP", quality=q, method=6, alpha_quality=90)
    print(name, size, os.path.getsize(p))
def diffuse_ao(d, ao):
    im = Image.open(os.path.join(X, d)).convert("RGB")
    if ao:
        a = Image.open(os.path.join(X, ao)).convert("RGB").resize(im.size)
        a = a.point(lambda v: int(255 - (255 - v) * 0.7))  # 70 % of the baked occlusion
        im = ImageChops.multiply(im, a)
    return im
BODIES = {
  "woman": {"skin": {"light": "skins/young_caucasian_female/young_lightskinned_female_diffuse.png",
                     "dark": "skins/young_african_female/young_darkskinned_female_diffuse.png"},
            "clothes": ("clothes/female_elegantsuit01/female_elegantsuit01_diffuse.png", "clothes/female_elegantsuit01/female_elegantsuit01_ao.png"),
            "clothes_n": "clothes/female_elegantsuit01/female_elegantsuit01_normal.png",
            "hair": "hair/ponytail01/ponytail01_diffuse.png", "eyes": "eyes/materials/brownlight_eye.png",
            "eyebrows": "eyebrows/eyebrow001/eyebrow001.png", "eyelashes": "eyelashes/eyelashes02/eyelashes02.png",
            "shoes": "clothes/shoes03/shoes03_diffuse.png"},
  "man": {"skin": {"light": "skins/young_caucasian_male/young_lightskinned_male_diffuse.png",
                   "dark": "skins/young_african_male/young_darkskinned_male_diffuse.png"},
          "clothes": ("clothes/male_elegantsuit01/male_elegantsuit01_diffuse.png", None),
          "hair": "hair/short02/short02_diffuse.png", "hair_n": "hair/short02/short02_normal.png", "eyes": "eyes/materials/bluegreen_eye.png",
          "eyebrows": "eyebrows/eyebrow002/eyebrow002.png", "eyelashes": "eyelashes/eyelashes01/eyelashes01.png",
          "shoes": "clothes/shoes04/shoes04_diffuse.png", "shoes_n": "clothes/shoes04/shoes04_normal.png"},
}
for b, t in BODIES.items():
    sk = {tone: Image.open(os.path.join(X, p)).convert("RGB") for tone, p in t["skin"].items()}
    sk["mid"] = Image.blend(sk["light"], sk["dark"].resize(sk["light"].size), 0.5)  # a medium brown: same base-mesh UVs
    for tone, img in sk.items():
        save(img, f"{b}_skin_{tone}", 2048, q=80)
    save(diffuse_ao(*t["clothes"]), f"{b}_clothes", 1024)
    if "clothes_n" in t: save(Image.open(os.path.join(X, t["clothes_n"])), f"{b}_clothes_n", 1024, q=90)
    save(Image.open(os.path.join(X, t["hair"])), f"{b}_hair", 1024, alpha=True)
    if "hair_n" in t: save(Image.open(os.path.join(X, t["hair_n"])), f"{b}_hair_n", 512, q=88)
    save(Image.open(os.path.join(X, t["eyes"])), f"{b}_eyes", 512)
    save(Image.open(os.path.join(X, t["eyebrows"])), f"{b}_eyebrows", 256, alpha=True)
    save(Image.open(os.path.join(X, t["eyelashes"])), f"{b}_eyelashes", 256, alpha=True)
    save(Image.open(os.path.join(X, t["shoes"])), f"{b}_shoes", 512)
    if "shoes_n" in t: save(Image.open(os.path.join(X, t["shoes_n"])), f"{b}_shoes_n", 512, q=88)
