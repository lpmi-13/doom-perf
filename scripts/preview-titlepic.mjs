// Offline preview of the DooMPERF title screen: renders the flame-graph background
// (scripts/lib/titlepic-bg.mjs) + the chrome wordmark to a PNG, without the engine.
// The live load-pulse "oo" is faked to a representative amber (in-engine it is a
// palette remap; see [[title-oo-load-pulse]]) so the composite reads truthfully.
//
//   node scripts/preview-titlepic.mjs [out.png]
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { renderFlameBackground } from "./lib/titlepic-bg.mjs";
import { readPalette, loadWordmarkRGBA } from "./lib/titlepic.mjs";

const iwadPath = fileURLToPath(new URL("../public/wads/freedoom1.wad", import.meta.url));
const outPath = process.argv[2] || fileURLToPath(new URL("./assets/titlepic-preview.png", import.meta.url));

// --- tiny WAD lump reader ---
const readLump = (wad, name) => {
  const numLumps = wad.readInt32LE(4), dirOffset = wad.readInt32LE(8);
  for (let i = 0; i < numLumps; i += 1) {
    const o = dirOffset + i * 16;
    const nm = wad.subarray(o + 8, o + 16).toString("ascii").replace(/\0.*$/, "");
    if (nm === name) return wad.subarray(wad.readInt32LE(o), wad.readInt32LE(o) + wad.readInt32LE(o + 4));
  }
  throw new Error(`lump ${name} not found`);
};

// --- minimal RGB PNG encoder ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
const encodePNG = (width, height, rgb) => {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) { raw[y * (stride + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride) : raw.set(rgb.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
};

const wad = readFileSync(iwadPath);
const pal = readPalette(readLump(wad, "PLAYPAL"));
const W = 320, H = 200;
const OO_TAGS = new Set([16, 17, 18, 19]);
const idx = renderFlameBackground({ pal, width: W, height: H, reserved: OO_TAGS });

// background indices -> RGB
const rgb = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i += 1) { const [r, g, b] = pal[idx[i]]; rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b; }

// overlay the wordmark: caps as-authored, the "oo" (alpha ~200) faked to amber.
const { width: aw, height: ah, rgba } = loadWordmarkRGBA();
const AMBER = { hi: [255, 214, 96], mid: [246, 168, 40], lo: [196, 104, 18], rim: [120, 54, 8] };
for (let y = 0; y < Math.min(ah, H); y += 1) for (let x = 0; x < Math.min(aw, W); x += 1) {
  const o = (y * aw + x) * 4, a = rgba[o + 3];
  if (a < 128) continue;
  const p = (y * W + x) * 3;
  if (Math.abs(a - 200) <= 24) {
    const L = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3;
    const c = L >= 150 ? AMBER.hi : L >= 110 ? AMBER.mid : L >= 70 ? AMBER.lo : AMBER.rim;
    rgb[p] = c[0]; rgb[p + 1] = c[1]; rgb[p + 2] = c[2];
  } else { rgb[p] = rgba[o]; rgb[p + 1] = rgba[o + 1]; rgb[p + 2] = rgba[o + 2]; }
}

writeFileSync(outPath, encodePNG(W, H, rgb));
console.log(`wrote ${outPath} (${W}x${H})`);
