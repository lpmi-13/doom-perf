// Authoring tool for the DOOMPERF wordmark letterforms (Option A in LOGO_PLAN.md).
//
// Renders "DOOMPERF" from a single condensed bold serif — a leading D, the orange
// lowercase "oo" (standing in for the original stylised ∞), then MPERF — gives the
// caps the Freedoom "engraved chrome" treatment (a vertical metal gradient sampled
// from the IWAD lettering + a black outline) and the oo the same ramp tinted
// orange, and writes them — positioned in TITLEPIC coordinates, transparent
// elsewhere — to scripts/assets/perfdoom-wordmark.png.
//
// This is NOT part of `npm run build:map`; it is a manual design step (it needs
// ImageMagick + the bundled font). The committed PNG is the source of truth that
// the build consumes (scripts/lib/titlepic.mjs decodes it, erases the old wordmark
// off the IWAD title, stamps these letters, and keeps the orange ∞ in front).
//
//   node scripts/gen-wordmark.mjs            regenerate the asset
//   PREVIEW=1 node scripts/gen-wordmark.mjs  also dump a preview PNG next to it
//
// Layout/look knobs are the LAYOUT/FONT env vars (see defaults below).
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assetPath = `${here}/assets/perfdoom-wordmark.png`;
const tmp = process.env.TMPDIR ?? "/tmp";

// TITLEPIC is 320x200; the wordmark sits on the red wall between the demon (left)
// and the right edge. We author at full TITLEPIC resolution so the build can stamp
// the layer at (0,0) for TITLEPIC and at (-81,-18) for the M_DOOM menu header.
const W = 320, H = 200;

// Engraved-chrome vertical ramp (top→bottom grayscale), sampled verbatim from the
// IWAD "E" stem: bright highlight up top, darkening through the middle, a second
// reflection near the base. Matching it keeps the new caps in the scene's lighting.
const RAMP = [255, 239, 239, 219, 191, 171, 151, 139, 127, 111, 99, 87, 71, 55, 47, 35, 67, 91, 119, 147, 167, 191, 191, 191];
const ramp = (t) => {
  const f = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.floor(f), a = f - i;
  return RAMP[i] + (RAMP[Math.min(RAMP.length - 1, i + 1)] - RAMP[i]) * a;
};

const FONT = process.env.FONT ?? "/usr/share/fonts/truetype/dejavu/DejaVuSerifCondensed-Bold.ttf";
const L = JSON.parse(process.env.LAYOUT ?? "{}");
const capH = L.capH ?? 27;          // cap height in px (uniform for every cap, incl. OO)
const xScale = L.xScale ?? 0.69;    // horizontal squeeze to fit DOOMPERF (8 caps)
const leftEdge = L.leftEdge ?? 84;  // x of the leading D's left edge
const mRight = L.mRight ?? 238;     // x of the trailing F's right edge
const baseline = L.baseline ?? 54;  // y of the letters' bottom (outline) row

// Render a caps string to an 8-bit grayscale coverage mask (white on black) via
// ImageMagick, at high resolution so the downscale below is smooth.
const renderMask = (text) => {
  const out = `${tmp}/dp_mask_${text}.pgm`;
  execSync(`convert -depth 8 -background black -fill white -font "${FONT}" -pointsize 120 label:${JSON.stringify(text)} -trim +repage "PGM:${out}"`);
  const buf = execSync(`cat "${out}"`);
  let o = 0;
  const tok = () => { while (buf[o] <= 32) o++; let s = ""; while (buf[o] > 32) { s += String.fromCharCode(buf[o]); o++; } return s; };
  tok(); const w = +tok(), h = +tok(); tok(); o++;
  return { w, h, data: buf.subarray(o, o + w * h) };
};

// Area-average a mask down to target height (px), squeezed horizontally by xScale.
const scaleMask = (mask, targetH) => {
  const tw = Math.round(mask.w * (targetH / mask.h) * xScale), th = targetH;
  const cov = new Float32Array(tw * th), sxk = mask.w / tw, syk = mask.h / th;
  for (let ty = 0; ty < th; ty += 1) for (let tx = 0; tx < tw; tx += 1) {
    let sum = 0, cnt = 0;
    const x0 = Math.floor(tx * sxk), x1 = Math.max(x0 + 1, Math.ceil((tx + 1) * sxk));
    const y0 = Math.floor(ty * syk), y1 = Math.max(y0 + 1, Math.ceil((ty + 1) * syk));
    for (let sy = y0; sy < y1; sy += 1) for (let sx = x0; sx < x1; sx += 1) { sum += mask.data[sy * mask.w + sx] / 255; cnt += 1; }
    cov[ty * tw + tx] = sum / cnt;
  }
  return { w: tw, h: th, cov };
};

// Per-glyph fill. Beyond the flat chrome ramp the caps get (a) a "heated gunmetal"
// vertical tint — cool steel at the top warming to orange at the base — and (b) a
// chiselled bevel: a bright rim on each stroke's top/left inner edge and a dark rim
// on its bottom/right edge. The "oo" (stand-in for the stylised ∞) uses a brighter
// orange core with an orange rim instead of the caps' black outline, so it reads as
// a warm glowing accent. All opaque, so the committed PNG stays binary-alpha.
const clampB = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Sentinel alpha tagging the "oo" pixels so the build can route them to reserved,
// engine-animated palette indices (the live-load pulse) instead of plain orange.
// Distinct from 255 (cap) and 0 (transparent); both halves stay opaque.
const OO_ALPHA = 200;
const STEEL = [0.86, 0.93, 1.04], HOT = [1.06, 0.66, 0.30]; // top vs base tint
const BEVEL_HI = 0.45, BEVEL_LO = 0.45;                     // edge highlight / shadow
const capColor = (v, t) => [clampB(v * lerp(STEEL[0], HOT[0], t)), clampB(v * lerp(STEEL[1], HOT[1], t)), clampB(v * lerp(STEEL[2], HOT[2], t))];
const ooColor = (v) => [clampB(v * 1.18), clampB(v * 0.52), clampB(v * 0.12)];

// RGBA layer (binary alpha).
const layer = { r: new Uint8ClampedArray(W * H), g: new Uint8ClampedArray(W * H), b: new Uint8ClampedArray(W * H), a: new Uint8Array(W * H) };
const paintGroup = (sm, ox, topY, kind) => {
  const core = new Uint8Array(sm.w * sm.h);
  for (let i = 0; i < core.length; i += 1) core[i] = sm.cov[i] > 0.45 ? 1 : 0;
  const isCore = (x, y) => x >= 0 && x < sm.w && y >= 0 && y < sm.h && core[y * sm.w + x];
  for (let y = 0; y < sm.h; y += 1) for (let x = 0; x < sm.w; x += 1) {
    const gx = ox + x, gy = topY + y;
    if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
    const li = gy * W + gx;
    // Alpha is a marker, not a coverage: 255 = chrome cap, OO_ALPHA = part of the
    // "oo" (which the build maps to reserved, engine-animated palette indices).
    const A = kind === "oo" ? OO_ALPHA : 255;
    if (core[y * sm.w + x]) {
      const t = y / (sm.h - 1), v = ramp(t);
      let col = kind === "oo" ? ooColor(v) : capColor(v, t);
      if (!isCore(x, y - 1) || !isCore(x - 1, y)) col = [clampB(lerp(col[0], 255, BEVEL_HI)), clampB(lerp(col[1], 255, BEVEL_HI)), clampB(lerp(col[2], 255, BEVEL_HI))];
      else if (!isCore(x, y + 1) || !isCore(x + 1, y)) col = [clampB(col[0] * (1 - BEVEL_LO)), clampB(col[1] * (1 - BEVEL_LO)), clampB(col[2] * (1 - BEVEL_LO))];
      layer.r[li] = col[0]; layer.g[li] = col[1]; layer.b[li] = col[2]; layer.a[li] = A;
    } else {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (isCore(x + dx, y + dy)) { near = true; break; }
      if (near) {
        if (kind === "oo") { layer.r[li] = 255; layer.g[li] = 150; layer.b[li] = 40; }
        else { layer.r[li] = 0; layer.g[li] = 0; layer.b[li] = 0; }
        layer.a[li] = A;
      }
    }
  }
};

// "DOOMPERF": a leading D, the orange "OO" (the OO of DOOM), then MPERF. The OO is
// full cap height like the rest of the letters (just kept orange + engine-animated).
const mkLead = renderMask("D"), mkTail = renderMask("MPERF"), mkOO = renderMask("OO");
const smLead = scaleMask(mkLead, capH);
const smTail = scaleMask(mkTail, capH);
const smOO = scaleMask(mkOO, capH);
const topCap = baseline - capH;
paintGroup(smLead, leftEdge, topCap, "cap");           // D
const tailLeft = mRight - smTail.w;
paintGroup(smTail, tailLeft, topCap, "cap");           // MPERF
// the OO is centred between the D and the M, aligned to the cap line
const ooLeft = Math.round(((leftEdge + smLead.w) + tailLeft) / 2 - smOO.w / 2);
paintGroup(smOO, ooLeft, topCap, "oo");                // OO
console.log(`D x${leftEdge}..${leftEdge + smLead.w}  OO x${ooLeft}..${ooLeft + smOO.w} (h${smOO.h})  MPERF x${tailLeft}..${mRight}  capH=${capH}`);

// Write the layer as a PAM and convert to 32-bit RGBA PNG (the committed asset).
const pam = ["P7", `WIDTH ${W}`, `HEIGHT ${H}`, "DEPTH 4", "MAXVAL 255", "TUPLTYPE RGB_ALPHA", "ENDHDR\n"].join("\n");
const body = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i += 1) { body[i * 4] = layer.r[i]; body[i * 4 + 1] = layer.g[i]; body[i * 4 + 2] = layer.b[i]; body[i * 4 + 3] = layer.a[i]; }
mkdirSync(`${here}/assets`, { recursive: true });
const pamPath = `${tmp}/dp_wordmark.pam`;
writeFileSync(pamPath, Buffer.concat([Buffer.from(pam, "ascii"), body]));
execSync(`convert "${pamPath}" "PNG32:${assetPath}"`);
console.log(`wrote ${assetPath}`);

if (process.env.PREVIEW) {
  const prev = `${tmp}/dp_wordmark_preview.png`;
  execSync(`convert "${pamPath}" -background gray40 -flatten "${prev}"`);
  console.log(`preview ${prev}`);
}
