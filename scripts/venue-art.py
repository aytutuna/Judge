"""Compose the venue backdrops for the court from LimeZu's Modern Exteriors,
Modern Interiors and Modern Farm (16x16), one 320x180 picture each.

python scripts/venue-art.py art
"""
import math, pathlib, random, sys
from PIL import Image

ART = pathlib.Path(sys.argv[1])
ME = ART / "modernexteriors-win/Modern_Exteriors_16x16"
SINGLES = ME / "Modern_Exteriors_Complete_Singles_16x16"
MI = ART / "moderninteriors-win"
DESIGNS = MI / "6_Home_Designs"
THEMES = MI / "1_Interiors/16x16/Theme_Sorter"
BUILDER = MI / "1_Interiors/16x16/Room_Builder_subfiles"
FARM = ART / "Modern_Farm_v1.3/16x16"
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "court" / "venues"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 320, 180


def load(p):
    return Image.open(p).convert("RGBA")


def trim(im):
    return im.crop(im.getbbox())


class Scene:
    def __init__(self):
        self.g = Image.new("RGBA", (W, H))
        self.queue = []  # drawn at the end, lowest baseline first

    def fill(self, tile, x0=0, y0=0, x1=W, y1=H):
        for y in range(y0, y1, tile.height):
            for x in range(x0, x1, tile.width):
                self.paste(tile.crop((0, 0, min(tile.width, x1 - x), min(tile.height, y1 - y))), x, y)

    def row(self, strip, y, x0=0, x1=W):
        for x in range(x0, x1, strip.width):
            self.paste(strip.crop((0, 0, min(strip.width, x1 - x), strip.height)), x, y)

    def paste(self, im, x, y):
        layer = Image.new("RGBA", (W, H))
        layer.paste(im, (x, y))
        self.g = Image.alpha_composite(self.g, layer)

    def put(self, im, cx, base):
        """Centred on cx with its feet at base."""
        self.queue.append((base, im, int(round(cx - im.width / 2)), base - im.height))

    def at(self, im, x, y):
        self.queue.append((y + im.height, im, x, y))

    def finish(self):
        for _, im, x, y in sorted(self.queue, key=lambda q: q[0]):
            self.paste(im, x, y)
        self.queue = []
        return self.g


def ext(name):
    return trim(load(SINGLES / f"ME_Singles_{name}.png"))


def design(folder, stem):
    return load(DESIGNS / folder / "16x16" / stem)


def bin_(n=13):
    return ext(f"City_Props_16x16_Trashbin_{n}")


def basin(s, im, x, y):
    """A bin, bucket or basket the ball drops into: x is its middle, y the height of its opening.
    The engine's TARGETS (components/court/engine.ts) hold the same points."""
    s.put(im, x, y + im.height - 3)


def ice():
    d = "Ice-Cream_Shop_Designs"
    l1, l2, l3 = (design(d, f"Ice_Cream_Shop_Design_layer_{i}.png") for i in (1, 2, 3))
    s = Scene()
    s.row(l1.crop((88, 0, 104, 144)), 0)
    for y in (144, 160, 176):
        s.row(l1.crop((88, 128, 104, 144)), y)
    top = Image.alpha_composite(l2, l3)
    o = lambda b: top.crop(b)
    shift, up = 65, 18
    s.at(o((18, 7, 46, 32)), 8, 6)
    s.at(o((146, 7, 174, 32)), 284, 6)
    s.at(o((49, 10, 79, 44)), 44, 8)
    s.at(o((113, 10, 143, 44)), 246, 8)
    s.at(o((82, 9, 110, 37)), 92, 3)
    s.at(o((82, 9, 110, 37)), 200, 3)
    s.at(o((19, 48, 46, 80)), 19 + shift, 48 - up)
    s.at(o((49, 50, 143, 88)), 49 + shift, 50 - up)
    s.at(o((146, 53, 173, 80)), 146 + shift, 53 - up)
    s.at(o((18, 92, 61, 128)), 8, 84)
    s.at(o((130, 92, 172, 128)), 270, 84)
    basin(s, bin_(), 75, 64)
    basin(s, bin_(), 245, 64)
    return s.finish()


def tv():
    d = "TV_Studio_Designs"
    l1, l2, l3 = (design(d, f"Tv_Studio_Design_layer_{i}.png") for i in (1, 2, 3))
    s = Scene()
    s.row(l1.crop((132, 0, 148, 48)), 0)
    s.fill(l1.crop((96, 112, 112, 128)), 0, 48, W, H)
    s.fill(l1.crop((80, 64, 96, 80)), 56, 48, 264, 112)
    s.g.paste((58, 52, 70, 255), (56, 112, 264, 114))
    top = Image.alpha_composite(l2, l3)
    o = lambda b: top.crop(b)
    dx = 72
    s.paste(l1.crop((47, 16, 129, 40)), 47 + dx, 16)
    s.at(o((7, 8, 169, 32)), 7 + dx, 8)
    s.at(o((16, 32, 47, 72)), 16 + dx, 32)
    s.at(o((129, 32, 160, 72)), 129 + dx, 32)
    s.at(o((50, 39, 126, 78)), 50 + dx, 39)
    s.at(o((16, 96, 46, 143)), 8, 82)
    s.at(o((146, 119, 159, 143)), 296, 106)
    s.at(o((49, 97, 63, 128)), 16, 130)
    s.at(o((81, 97, 95, 128)), 36, 130)
    basin(s, bin_(7), 70, 88)
    basin(s, bin_(7), 250, 88)
    return s.finish()


def museum():
    d = "Museum_Designs"
    l1, l2 = design(d, "Museum_room_1_layer_1.png"), design(d, "Museum_room_1_layer_2.png")
    s = Scene()
    s.row(l1.crop((100, 0, 116, 63)), 0)
    s.fill(l1.crop((100, 63, 116, 79)), 0, 63, W, H)
    o = lambda b: l2.crop(b)
    s.at(o((33, 17, 63, 39)), 40, 14)
    s.at(o((68, 23, 77, 37)), 76, 20)
    s.at(o((243, 9, 269, 44)), 98, 6)
    s.at(o((129, 16, 159, 40)), 204, 12)
    s.at(o((292, 18, 301, 32)), 282, 20)
    s.at(o((81, 145, 111, 167)), 244, 20)
    s.at(o((38, 45, 156, 60)), 101, 50)
    s.put(o((16, 135, 32, 192)), 12, 66)
    s.put(o((64, 135, 80, 192)), 308, 66)
    s.at(o((34, 211, 62, 256)), 30, 58)
    s.at(o((242, 211, 270, 256)), 262, 58)
    basin(s, bin_(5), 78, 86)
    basin(s, bin_(5), 242, 86)
    return s.finish()


def beach_prop(name):
    return trim(load(SINGLES / f"21_Beach_16x16_{name}.png"))


def beach():
    sheet = load(ME / "ME_Theme_Sorter_16x16/21_Beach_16x16.png")
    s = Scene()
    s.fill(sheet.crop((160, 112, 176, 128)))
    water = sheet.crop((208, 16, 224, 32))
    px = water.load()
    for y in range(16):
        for x in range(16):
            if px[x, y][0] > 150 and px[x, y][2] < 150:
                px[x, y] = (60, 163, 178, 255)
    s.fill(water, 0, 0, W, 48)
    px = s.g.load()
    for x in range(W):
        shore = 38 + int(round(2.2 * math.sin(x / 13.0) + 1.3 * math.sin(x / 5.3 + 1)))
        for y in range(shore, 48):
            px[x, y] = (230, 174, 85, 255) if (x * 7 + y * 13) % 11 else (232, 187, 91, 255)
        px[x, shore] = (225, 147, 75, 255)
        px[x, shore - 1] = (135, 236, 230, 255)
        px[x, shore - 2] = (135, 236, 230, 255) if (x // 3) % 2 else (91, 201, 210, 255)
    s.put(beach_prop("Ship_Bar"), 52, 92)
    s.put(beach_prop("Palm_Tree"), 282, 72)
    s.put(beach_prop("Blue_Beach_Umbrella_Opened"), 236, 74)
    s.put(beach_prop("Blue_Beach_Towel_1"), 238, 86)
    s.put(beach_prop("Sand_Castle_2_Vers_2"), 292, 108)
    s.put(beach_prop("Medium_Sea_Rock_1_Vers_1"), 130, 36)
    s.put(beach_prop("Medium_Sea_Rock_1_Vers_2"), 186, 38)
    basin(s, beach_prop("Small_Red_Bucket_1"), 100, 82)
    basin(s, beach_prop("Small_Blue_Bucket_1"), 212, 82)
    return s.finish()


def grass(seed, dirt=True):
    s = Scene()
    s.fill(ext("Terrains_and_Fences_16x16_Grass_1_22"))
    r = random.Random(seed)
    bits = [ext(f"Terrains_and_Fences_16x16_Props_Grass_{i}") for i in (8, 9, 10, 11)]
    if dirt:
        bits += [ext(f"Terrains_and_Fences_16x16_Props_Dirt_{i}") for i in (1, 5, 6, 8, 10, 11, 12, 16)]
    for _ in range(34):
        t = r.choice(bits)
        x = r.choice([r.randrange(0, 50), r.randrange(268, W - t.width)])
        s.paste(t, x, r.randrange(0, H - t.height))
    return s


def camp():
    c = lambda n: ext(f"Camping_16x16_{n}")
    s = grass(5)
    s.put(c("Tree_1"), 26, 60)
    s.put(c("Tree_14"), 298, 62)
    s.put(c("Tent_1"), 84, 66)
    s.put(c("Tent_3"), 236, 68)
    s.put(c("Hanging_Cooking_Pot_5"), 160, 54)
    s.put(c("Cut_Wood_Bench_1"), 132, 60)
    s.put(c("Cut_Wood_Bench_1"), 190, 60)
    s.put(c("Benched_Table_2"), 34, 108)
    s.put(c("Benched_Table_4"), 286, 108)
    s.put(c("Backpack_2"), 52, 78)
    s.put(c("Lantern_2"), 266, 74)
    s.put(c("Barbecue_2"), 282, 80)
    basin(s, c("Bucket_2"), 100, 84)
    basin(s, c("Basket_1"), 222, 84)
    return s.finish()


def farm():
    f = lambda n: trim(load(FARM / "Single_Files_16x16/Props_and_Buildings_16x16" / f"{n}_16x16.png"))
    fences = load(FARM / "2_Fences_16x16.png")
    s = grass(3, dirt=False)
    seg = fences.crop((152, 18, 176, 32))
    for x in range(0, W, seg.width):
        s.paste(seg, x, 34)
    s.put(f("Chicken_Coop"), 40, 92)
    s.put(f("Well_Usable"), 94, 84)
    s.put(f("Scarecrow"), 232, 80)
    s.put(f("Tractor_Right_Side"), 292, 100)
    s.put(f("Raw_Bale_Big"), 28, 112)
    s.put(f("Raw_Bale_Big"), 44, 112)
    s.put(f("Milk_Can_1"), 72, 100)
    s.put(f("Pimpkin_Big"), 226, 100)
    s.put(f("Crate_Brown_Empty"), 250, 108)
    basin(s, f("Bucket_1_Single"), 122, 88)
    return s.finish()


def room(s, wall, floor):
    walls = load(BUILDER / "Room_Builder_Walls_16x16.png")
    floors = load(BUILDER / "Room_Builder_Floors_16x16.png")
    s.row(walls.crop((wall[0] * 16, wall[1] * 16, wall[0] * 16 + 16, wall[1] * 16 + 32)), 0)
    s.fill(floors.crop((floor[0] * 16, floor[1] * 16, floor[0] * 16 + 16, floor[1] * 16 + 16)), 0, 32, W, H)


def library():
    sheet = load(THEMES / "5_Classroom_and_library_16x16.png")
    s = Scene()
    room(s, (23, 24), (1, 13))
    cut = lambda x, y, w, h: trim(sheet.crop((x, y, x + w, y + h)))
    shelves = [cut(0, y - 2, 48, 50) for y in (208, 256, 304)]
    for i, x in enumerate((2, 54)):
        s.put(shelves[i % 3], x + 24, 66)
    for i, x in enumerate((218, 270)):
        s.put(shelves[(i + 1) % 3], x + 24, 66)
    s.put(cut(160, 80, 32, 32), 160, 44)
    s.put(cut(208, 16, 16, 32), 112, 64)
    s.put(cut(80, 16, 34, 34), 30, 112)
    s.put(cut(80, 16, 34, 34), 290, 112)
    basin(s, ext("Camping_16x16_Basket_1"), 80, 84)
    basin(s, ext("Camping_16x16_Basket_1"), 240, 84)
    return s.finish()


def street():
    s = Scene()
    s.fill(ext("City_Terrains_16x16_Sidewalk_1_25"))

    def front(n):
        im = ext(f"Shopping_Center_and_Markets_16x16_{n}")
        return im.crop((0, im.height - 66, im.width, im.height))

    s.at(front("Market_Medium_1"), 4, 0)
    s.at(front("Market_Medium_9"), 204, 0)
    s.put(ext("City_Props_16x16_Tree_1"), 160, 70)
    s.put(ext("City_Props_16x16_Bench_2"), 40, 104)
    s.put(ext("City_Props_16x16_Bench_2"), 280, 104)
    basin(s, bin_(), 72, 82)
    basin(s, bin_(), 248, 82)
    s.put(ext("Villas_16x16_Potted_Flowers_2"), 120, 72)
    s.put(ext("Villas_16x16_Potted_Flowers_3"), 200, 72)
    return s.finish()


VENUES = {"beach": beach, "camp": camp, "farm": farm, "ice": ice, "library": library, "museum": museum, "street": street, "tv": tv}

for name, make in VENUES.items():
    make().save(OUT / f"{name}.png", optimize=True)
