// Builds the DooMPERF title-screen lump: the caps "DooMPERF" chrome wordmark
// authored once (scripts/gen-wordmark.mjs -> scripts/assets/perfdoom-wordmark.png,
// full TITLEPIC resolution, transparent except the letters), composited here onto
// the IWAD's TITLEPIC lump. This module is the "PNG -> Doom patch" converter.
//
// TITLEPIC's BACKGROUND is no longer Freedoom's demon/gore scene: buildPerfTitlePic
// throws it away and renders a Brendan-Gregg flame graph rising out of a dark ember
// gradient (scripts/lib/titlepic-bg.mjs), then stamps the wordmark on top. The
// deep-red/orange flame keeps the DOOM heat palette while being non-violent and
// on-theme — the hell you stare into is your own call stack.
//
// TITLEPIC (320x200) is the title-screen background (flame graph) + wordmark, and
// the data-source menu composites over it (d_main.c D_PageDrawer), so it doubles as
// the menu's "DOOMPERF" header. (Freedoom also has an M_DOOM menu-title lump, but the
// classic main menu that drew it was removed, so it is no longer built/overridden.)
//
// The lowercase "oo" is tagged with reserved palette indices the engine remaps each
// frame into a live, load-driven amber pulse — see [[title-oo-load-pulse]].
//
// buildPerf* are pure w.r.t. their lump inputs (they additionally read the one
// committed PNG asset) and return replacement lump bytes via the shared encoder.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { renderFlameBackground } from "./titlepic-bg.mjs";

const wordmarkAssetPath = fileURLToPath(new URL("../assets/perfdoom-wordmark.png", import.meta.url));

// ---- Doom picture (patch) decode ----
// (decodePatch / readPalette / nearest are generic Doom-graphic primitives, exported so other
// build steps -- e.g. recolouring a stock IWAD sprite -- can reuse them.)
export const decodePatch = (data) => {
  const width = data.readInt16LE(0);
  const height = data.readInt16LE(2);
  const leftOffset = data.readInt16LE(4);
  const topOffset = data.readInt16LE(6);
  const idx = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    let post = data.readInt32LE(8 + x * 4);
    while (data[post] !== 0xff) {
      const topdelta = data[post];
      const length = data[post + 1];
      for (let y = 0; y < length; y += 1) {
        idx[(topdelta + y) * width + x] = data[post + 3 + y];
        mask[(topdelta + y) * width + x] = 1;
      }
      post += length + 4;
    }
  }
  return { width, height, leftOffset, topOffset, idx, mask };
};

export const readPalette = (playpal) => {
  const pal = [];
  for (let i = 0; i < 256; i += 1) pal.push([playpal[i * 3], playpal[i * 3 + 1], playpal[i * 3 + 2]]);
  return pal;
};

export const nearest = (pal, r, g, b) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 256; i += 1) {
    const [pr, pg, pb] = pal[i];
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
};

// ---- minimal PNG decode (8-bit RGBA, non-interlaced — what gen-wordmark emits) ----
const PAETH = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
export const decodePNG = (buf) => {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (buf[i] !== sig[i]) throw new Error("wordmark asset is not a PNG");
  let off = 8, width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idatChunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced wordmark PNG unsupported");
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`wordmark PNG must be 8-bit RGBA (got depth ${bitDepth}, colorType ${colorType})`);
  const bpp = 4, stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const out = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0;
      let v = raw[rowIn + i];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1; else if (filter === 4) v += PAETH(a, b, c);
      out[y * stride + i] = v & 0xff;
    }
  }
  return { width, height, rgba: out };
};

// Cache the decoded wordmark layer (positioned in TITLEPIC coordinates).
let wordmark;
const getWordmark = () => {
  if (!wordmark) wordmark = decodePNG(readFileSync(wordmarkAssetPath));
  return wordmark;
};

// Exposed for the offline title preview (scripts/preview-titlepic.mjs).
export const loadWordmarkRGBA = () => getWordmark();

// gen-wordmark tags the "oo" pixels with this alpha (vs 255 for caps). They map to
// reserved palette indices (free in TITLEPIC) that the engine remaps each frame to
// a live, load-driven amber pulse — DoomPerf_UpdateTitleLut in wasm/i_video_ems.c
// (HI/MID/LO/RIM = the oo's four shading levels, picked here by pixel brightness).
// Cap pixels quantize to the nearest palette colour as usual.
const OO_ALPHA = 200;
const OO_TAGS = [16, 17, 18, 19];
const wordmarkIndex = (pal, r, g, b, a) => {
  if (Math.abs(a - OO_ALPHA) <= 24) {
    const L = (r + g + b) / 3;
    return L >= 150 ? OO_TAGS[0] : L >= 110 ? OO_TAGS[1] : L >= 70 ? OO_TAGS[2] : OO_TAGS[3];
  }
  return nearest(pal, r, g, b);
};

export const buildPerfTitlePic = ({ titlepicLump, playpalLump, buildPatch }) => {
  const pal = readPalette(playpalLump);
  const pic = decodePatch(titlepicLump); // read only for the canonical 320x200 dims
  const { width, height } = pic;

  // Replace Freedoom's demon scene entirely with a flame-graph vista. Reserved
  // "oo" indices are held out of the ember quantisation so none of them pulses.
  const out = renderFlameBackground({ pal, width, height, reserved: new Set(OO_TAGS) });

  // Stamp the authored wordmark (asset is in TITLEPIC coordinates), lifted up by
  // TITLE_Y_SHIFT. The menu composites over TITLEPIC (see d_main.c V_DrawPatch of
  // the opening page), so this wordmark is the "DOOMPERF" header the data-source
  // menu shows -- M_DOOM/MainDef is never reached. The authored glyphs sit at
  // asset rows 27..53 (centre 40), one line above SELECT DATA SOURCE (y=56);
  // lifting 12px lands them at rows 15..41 (centre 28), halfway between the top
  // of the screen and that header. The flame graph stays below row 57, so the
  // vacated rows just show the dark ember gradient.
  const TITLE_Y_SHIFT = 12;
  const { width: aw, height: ah, rgba } = getWordmark();
  for (let y = 0; y < Math.min(ah, height); y += 1) {
    const dy = y - TITLE_Y_SHIFT;
    if (dy < 0) continue;
    for (let x = 0; x < Math.min(aw, width); x += 1) {
      const o = (y * aw + x) * 4, a = rgba[o + 3];
      if (a < 128) continue;
      out[dy * width + x] = wordmarkIndex(pal, rgba[o], rgba[o + 1], rgba[o + 2], a);
    }
  }

  return buildPatch(out, width, height); // fully opaque
};
