"""Cut the street court art out of LimeZu's Modern Exteriors (16x16).

python scripts/court-art.py art/modernexteriors-win
"""
import colorsys, pathlib, random, sys
from PIL import Image

ME = pathlib.Path(sys.argv[1]) / "Modern_Exteriors_16x16"
ALL = ME / "Modern_Exteriors_Complete_Singles_16x16"
SRC = ME / "Character_Generator_Addons_16x16/Characters_16x16"
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "court"
(OUT / "props").mkdir(parents=True, exist_ok=True)
(OUT / "people").mkdir(exist_ok=True)
W, H = 320, 180


def single(name):
    im = Image.open(ALL / f"ME_Singles_{name}.png").convert("RGBA")
    return im.crop(im.getbbox())


# ground: grass with a few tufts and pebbles at the sides, the court in the middle
r = random.Random(11)
ground = Image.new("RGBA", (W, H))
fill = single("Terrains_and_Fences_16x16_Grass_1_22")
for y in range(0, H, 16):
    for x in range(0, W, 16):
        ground.alpha_composite(fill, (x, y))
bits = [single(f"Terrains_and_Fences_16x16_Props_Grass_{i}") for i in (8, 9, 10, 11)] + \
       [single(f"Terrains_and_Fences_16x16_Props_Dirt_{i}") for i in (1, 5, 6, 8, 10, 11, 12, 16)]
for _ in range(30):
    b = r.choice(bits)
    x = r.choice([r.randrange(0, 40), r.randrange(274, W - b.width)])
    ground.alpha_composite(b, (x, r.randrange(0, H - b.height)))
court = Image.open(ALL / "ME_Singles_School_16x16_Basketball_Court_5.png").convert("RGBA")
ground.alpha_composite(court, (48, 2))
ground.save(OUT / "ground.png")

for k, n in {"tree": "Camping_16x16_Tree_1", "tree2": "Camping_16x16_Tree_14", "bench": "School_16x16_Bench_1",
             "bag": "Camping_16x16_Backpack_2", "bottle": "Camping_16x16_Bottle_2",
             "ball": "School_16x16_Basketball_Ball_1", "bush": "Garden_16x16_Bush_3"}.items():
    single(n).save(OUT / "props" / f"{k}.png")

# scouts: idle, walk, phone, book and lift rows from the premade sheets, in three scarf colours
ROWS = [(1, 0, 24), (2, 0, 24), (6, 0, 12), (7, 0, 12), (11, 42, 56)]
SCARF = {1: .0, 2: .0, 3: .58, 4: .40, 5: .40, 6: .58}
ALT = {1: .13, 2: .78, 3: .07, 4: .13, 5: .78, 6: .07}
ALT2 = {1: .50, 2: .30, 3: .88, 4: .62, 5: .10, 6: .95}


def rescarf(im, src_hue, hue):
    im = im.copy()
    p = im.load()
    for y in range(im.height):
        for x in range(im.width):
            cr, cg, cb, a = p[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(cr / 255, cg / 255, cb / 255)
            if s > .55 and v > .25 and min(abs(h - src_hue), 1 - abs(h - src_hue)) < .05:
                nr, ng, nb = colorsys.hsv_to_rgb(hue, s, v)
                p[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return im


for i in range(1, 7):
    full = Image.open(SRC / f"Modern_Exteriors_Characters_Scout_16x16_{i}.png").convert("RGBA")
    sheet = Image.new("RGBA", (384, 32 * len(ROWS)))
    for row, (sr, a, b) in enumerate(ROWS):
        sheet.alpha_composite(full.crop((a * 16, sr * 32, b * 16, sr * 32 + 32)), (0, row * 32))
    for v, s in enumerate([sheet, rescarf(sheet, SCARF[i], ALT[i]), rescarf(sheet, SCARF[i], ALT2[i])]):
        s.save(OUT / "people" / f"scout{i}-{v}.png")
