#!/usr/bin/env python3
# Authoring tool for the engine menu typeface (wasm/menu_font_data.h).
#
# Doom's HUD font is 8px pixel art; blown up to the 640x400 / 960x600 engines its
# pixels become 4-6 framebuffer pixels wide and the menu is hard to read. The
# menu instead draws Chakra Petch (OFL, bundled under scripts/assets/fonts/)
# rasterised onto a coarser-than-native pixel grid -- deliberately still pixel
# art, about halfway between the HUD font's blocks and a smooth font -- and
# given the HUD font's treatment: hard pixels, a dark one-pixel outline, and a
# top-to-bottom shade. wasm/menu_font.c draws each glyph pixel as a PIX x PIX
# block. The 320x200 engine keeps the HUD font, so there is no 1x data.
#
# Glyph pixels are nibbles (two per byte, low first): 0 = empty, 1 = outline,
# 2..15 = ink at brightness level/15.
#
# Like scripts/gen-wordmark.mjs this is a manual design step, not part of the
# build: it needs Python + Pillow, and the committed header is the source of
# truth the engine build consumes.
#
#   python3 scripts/gen-menu-font.py              regenerate the header
#   python3 scripts/gen-menu-font.py --preview    also write preview PNGs to $TMPDIR
import os
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "wasm", "menu_font_data.h")
FONTS = os.path.join(HERE, "assets", "fonts")

STYLES = [
    ("item", "ChakraPetch-SemiBold.ttf"),
    ("small", "ChakraPetch-Medium.ttf"),
]
SCALES = [(640, 2), (960, 3)]

# Per engine width and style: (framebuffer pixels per glyph pixel, cap height in
# UI units -- one unit = one 320x200 pixel).
#
# Pixelation steps down with resolution: 320x200 draws the HUD font (items at 2x
# = 2 units per glyph pixel, small 1x = 1 unit), 640x400 sits halfway on items
# (1.5 units), 960x600 is finest (1 unit). Legibility, though, depends on how
# many GLYPH pixels a capital spans, not its size on screen: below ~9 the
# counters of e/s/a close up. So item caps are sized to the HUD font at 320
# (7 px at 2x = 14 units) at both widths, which gives the coarser 640 grid 10
# glyph pixels (Chakra Petch's hinting skips 9, so 15 units) and 960 14. Small
# text at 640 stays at half a unit: a 1-unit grid leaves its caps illegible.
GRID = {
    640: {"item": (3, 14.0), "small": (1, 6.5)},
    960: {"item": (3, 14.0), "small": (2, 6.5)},
}


SHADE_TOP, SHADE_BASE = 1.0, 0.45  # ink brightness at cap top / at the baseline;
# a steep ramp like the HUD font's, which is much of what makes it read well
FIRST, LAST = 32, 126
THRESHOLD = 110  # coverage (0-255) at which a glyph pixel is inked
# Pixel-font spacing: every glyph advances by its own ink width plus this many
# glyph pixels, so neighbours always sit the same distance apart. (Rounding the
# outline font's fractional advances to a coarse grid leaves random 0-3 px gaps
# that split words: "u tilization".) Two pixels = the two letters' outlines.
INK_GAP = 2


def load(path, cap_px):
    # Pick the pixel size whose rendered "H" is closest to the wanted cap height.
    best = None
    for size in range(4, 200):
        font = ImageFont.truetype(path, size)
        top, bottom = font.getbbox("H")[1], font.getbbox("H")[3]
        err = abs((bottom - top) - cap_px)
        if best is None or err < best[0]:
            best = (err, size, font)
        if bottom - top > cap_px + 2:
            break
    return best[2]


def bake(font):
    # Baseline-relative glyph boxes. getbbox is measured from the ascender line,
    # so subtract the ascent to get offsets from the baseline. Each box grows by
    # one pixel on every side for the outline.
    ascent, _ = font.getmetrics()
    cap = ascent - font.getbbox("H")[1]  # cap top's height above the baseline
    glyphs, data = [], bytearray()
    for code in range(FIRST, LAST + 1):
        ch = chr(code)
        adv = round(font.getlength(ch))
        box = font.getbbox(ch)
        w, h = box[2] - box[0], box[3] - box[1]
        if ch == " " or w <= 0 or h <= 0:
            glyphs.append((adv, 0, 0, 0, 0, len(data)))
            continue
        img = Image.new("L", (w, h), 0)
        ImageDraw.Draw(img).text((-box[0], -box[1]), ch, font=font, fill=255)
        # Crop to the columns that actually ink at THRESHOLD: getbbox counts
        # faint coverage too, which would skew the spacing below.
        cols = [x for x in range(w) if any(img.getpixel((x, y)) >= THRESHOLD for y in range(h))]
        if cols:
            img = img.crop((cols[0], 0, cols[-1] + 1, h))
            w = img.width
        ink = img.load()
        W, H = w + 2, h + 2
        on = lambda x, y: 0 < x <= w and 0 < y <= h and ink[x - 1, y - 1] >= THRESHOLD
        levels = []
        for y in range(H):
            above = cap + (box[1] - ascent + y - 1)  # 0 at cap top, cap at baseline
            k = SHADE_TOP - (SHADE_TOP - SHADE_BASE) * min(1.15, max(0.0, above / cap))
            for x in range(W):
                if on(x, y):
                    levels.append(max(2, min(15, round(15 * k))))
                elif any(on(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                    levels.append(1)
                else:
                    levels.append(0)
        offset = len(data)
        if len(levels) % 2:
            levels.append(0)
        for i in range(0, len(levels), 2):
            data.append(levels[i] | (levels[i + 1] << 4))
        glyphs.append((w + INK_GAP, W, H, -1, box[1] - ascent - 1, offset))
    return glyphs, bytes(data), cap


def emit_c():
    out = [
        "// GENERATED by scripts/gen-menu-font.py -- do not edit by hand.",
        "// Chakra Petch (SIL Open Font License 1.1, scripts/assets/fonts/OFL.txt),",
        "// baked per engine resolution onto a coarse pixel grid (DP_MF_*_PIX framebuffer",
        "// pixels per glyph pixel). Nibbles, low first: 0 empty, 1 outline, 2..15 ink",
        "// brightness/15. Offsets are in glyph pixels from the pen on the baseline.",
        "// See wasm/menu_font.c.",
        "",
        "#define DP_MF_FIRST %d" % FIRST,
        "#define DP_MF_LAST  %d" % LAST,
        "",
        "typedef struct",
        "{",
        "    short adv, w, h, xoff, yoff;",
        "    int   ofs;",
        "} dp_mf_glyph_t;",
        "",
    ]
    previews = []
    for i, (width, scale) in enumerate(SCALES):
        out.append(("#if" if i == 0 else "#elif") + " SCREENWIDTH == %d" % width)
        out.append("#define DP_MF_AVAILABLE 1")
        for name, file in STYLES:
            p, cap = GRID[width][name]
            font = load(os.path.join(FONTS, file), cap * scale / p)
            glyphs, data, cap_px = bake(font)
            previews.append((width, scale, name, glyphs, data, cap_px, p))
            out.append("#define DP_MF_%s_PIX %d" % (name.upper(), p))
            out.append("#define DP_MF_%s_CAP %d" % (name.upper(), cap_px))
            out.append("static const dp_mf_glyph_t dp_mf_%s_glyphs[] = {" % name)
            for g in glyphs:
                out.append("    {%d,%d,%d,%d,%d,%d}," % g)
            out.append("};")
            out.append("static const unsigned char dp_mf_%s_data[] = {" % name)
            for j in range(0, len(data), 24):
                out.append("    " + ",".join(str(b) for b in data[j:j + 24]) + ",")
            out.append("};")
    out.append("#else")
    out.append("#define DP_MF_AVAILABLE 0")
    out.append("#endif")
    with open(OUT, "w") as f:
        f.write("\n".join(out) + "\n")
    return previews


def preview(previews):
    # Decode the baked data exactly as wasm/menu_font.c will draw it.
    tmp = os.environ.get("TMPDIR", "/tmp")
    tones = {0: (236, 240, 248), 1: (150, 160, 178)}
    for width, scale in SCALES:
        styles = {e[2]: e for e in previews if e[0] == width}
        img = Image.new("RGB", (width, width * 5 // 8), (70, 64, 60))

        def text(xu, yu, s, style, tone):
            _, _, _, glyphs, data, cap, p = styles[style]
            pen, base = xu * scale, yu * scale + cap * p
            for passno in (1, 2):
                x = pen
                for ch in s:
                    g = glyphs[ord(ch) - FIRST]
                    adv, w, h, xo, yo, ofs = g
                    for gy in range(h):
                        for gx in range(w):
                            i = gy * w + gx
                            v = data[ofs + i // 2]
                            v = v >> 4 if i & 1 else v & 15
                            if (passno == 1 and v == 1) or (passno == 2 and v >= 2):
                                c = (12, 12, 14) if v == 1 else tuple(t * v // 15 for t in tones[tone])
                                X, Y = x + (xo + gx) * p, base + (yo + gy) * p
                                img.paste(c, (X, Y, X + p, Y + p))
                    x += adv * p

        text(60, 58, "Mode / Simulated / Memory", "small", 1)
        text(60, 76, "High utilization", "item", 0)
        text(60, 108, "Saturation", "small", 1)
        text(60, 120, "With swap", "item", 0)
        text(60, 140, "Without swap", "item", 0)
        text(60, 184, "Enter select    Backspace back", "small", 1)
        path = os.path.join(tmp, "menu-font-%d.png" % width)
        img.save(path)
        print("preview:", path)


if __name__ == "__main__":
    previews = emit_c()
    print("wrote", os.path.relpath(OUT, ROOT), os.path.getsize(OUT), "bytes")
    if "--preview" in sys.argv:
        preview(previews)
