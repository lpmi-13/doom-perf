// Relabels the Freedoom Phase 1 chrome wordmark from "FREED∞M" to "PERFD∞M".
//
// Rather than cut-and-paste the IWAD glyphs (which lacked a P and a uniform-height
// M, so reconstructing them never read as one cleanly-designed logo — see the
// history in LOGO_PLAN.md), the caps P E R F D M are authored once as a single
// chrome wordmark image (scripts/gen-wordmark.mjs -> scripts/assets/
// perfdoom-wordmark.png, full TITLEPIC resolution, transparent except the
// letters). This module is the "PNG -> Doom patch" converter: it decodes that
// asset and composites the letters onto the two IWAD lumps, keeping the original
// orange ∞ (in place of "OO") and — for TITLEPIC — the red-wall scene.
//
// The same wordmark appears in TWO lumps, both drawn, so both are replaced:
//   * TITLEPIC (320x200) — title-screen background; wordmark on the red wall.
//   * M_DOOM   (159x37)  — the main-menu header, shifted by (-81,-18) vs TITLEPIC.
// We erase the old chrome lettering (red-fill on TITLEPIC / clear on M_DOOM), stamp
// the authored letters, then re-stamp the orange ∞ in front so it stays a single
// unbroken ribbon weaving over the D and M, exactly as the IWAD authored it.
//
// buildPerf* are pure w.r.t. their lump inputs (they additionally read the one
// committed PNG asset) and return replacement lump bytes via the shared encoder.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

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
const decodePNG = (buf) => {
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

// ---- pixel classifiers (operate on a decoded patch + palette) ----
const isLetterColor = (pal, i) => {
  const [r, g, b] = pal[i];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx <= 46 || (mx - mn <= 30 && mx >= 46); // chrome gray or near-black outline
};
const isBgColor = (pal, i) => {
  const [r, g, b] = pal[i];
  return r >= 40 && r > g * 1.3 && r > b * 1.3 && Math.max(r, g, b) - Math.min(r, g, b) >= 18;
};
const isOrangeColor = (pal, i) => {
  const [r, g, b] = pal[i]; // warm orange ∞ ramp, distinct from the red wall
  return r > 120 && g > 40 && g < 170 && b < 80 && r > g + 30;
};

// The wordmark spans this band on TITLEPIC; M_DOOM is the same shifted by (-81,-18).
const BAND = { x0: 81, x1: 242, y0: 14, y1: 57 };
const grain = (x, y) => ((x * 73 + y * 151) % 7) - 3; // deterministic ±3 wall grain

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
  const pic = decodePatch(titlepicLump);
  const { width, height, idx } = pic;
  const out = idx.slice();
  const at = (x, y) => idx[y * width + x];
  const op = (x, y) => pic.mask[y * width + x];
  // The whole old wordmark is replaced (the "oo" supersedes the old orange ∞ too),
  // so erase both the chrome lettering and the orange.
  const isOldMark = (x, y) => op(x, y) === 1 && (isLetterColor(pal, at(x, y)) || isOrangeColor(pal, at(x, y)));

  // Erase the old wordmark (FREED + ∞ + M), red-filling each column with the wall's
  // local vertical gradient + grain. Dilated to catch the dark anti-alias fringe.
  for (let x = BAND.x0; x < BAND.x1; x += 1) {
    const top = pal[at(x, BAND.y0)];
    let by = BAND.y1;
    while (by > BAND.y0 && !(op(x, by) === 1 && isBgColor(pal, at(x, by)))) by -= 1;
    const bot = op(x, by) === 1 && isBgColor(pal, at(x, by)) ? pal[at(x, by)] : top;
    const span = Math.max(1, by - BAND.y0);
    for (let y = BAND.y0; y <= BAND.y1; y += 1) {
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && isOldMark(nx, ny)) { near = true; break; }
      }
      if (!near) continue;
      const t = Math.min(1, (y - BAND.y0) / span), gg = grain(x, y);
      out[y * width + x] = nearest(pal,
        top[0] + (bot[0] - top[0]) * t + gg,
        top[1] + (bot[1] - top[1]) * t + gg,
        top[2] + (bot[2] - top[2]) * t + gg);
    }
  }

  // Stamp the authored wordmark (asset is already in TITLEPIC coordinates).
  const { width: aw, height: ah, rgba } = getWordmark();
  for (let y = 0; y < Math.min(ah, height); y += 1) {
    for (let x = 0; x < Math.min(aw, width); x += 1) {
      const o = (y * aw + x) * 4, a = rgba[o + 3];
      if (a < 128) continue;
      out[y * width + x] = wordmarkIndex(pal, rgba[o], rgba[o + 1], rgba[o + 2], a);
    }
  }

  return buildPatch(out, width, height); // fully opaque
};

export const buildPerfMenuTitle = ({ mdoomLump, playpalLump, buildPatch }) => {
  const pal = readPalette(playpalLump);
  const pic = decodePatch(mdoomLump);
  const { width, height } = pic;

  const TRANSPARENT = -1;
  const pixels = new Array(width * height).fill(TRANSPARENT);

  // The authored asset is in TITLEPIC space; M_DOOM is that shifted by (-81,-18).
  const { width: aw, height: ah, rgba } = getWordmark();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ax = x + 81, ay = y + 18;
      if (ax < 0 || ax >= aw || ay < 0 || ay >= ah) continue;
      const o = (ay * aw + ax) * 4, a = rgba[o + 3];
      if (a < 128) continue;
      pixels[y * width + x] = wordmarkIndex(pal, rgba[o], rgba[o + 1], rgba[o + 2], a);
    }
  }

  return buildPatch(pixels, width, height, {
    leftOffset: pic.leftOffset,
    topOffset: pic.topOffset,
    transparent: TRANSPARENT,
  });
};
