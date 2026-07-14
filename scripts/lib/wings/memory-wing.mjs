// Memory wing (east): "The Memory Well" — a vertical library shaft. A short
// vestibule off the hub door (carrying the `free -m` terminal head-on) opens onto
// a narrow ENTRY CATWALK that walks out over a bottomless abyss toward a solid
// central SPIRE (a tiered bookcase cylinder that fills with books as RSS is
// allocated — the hero fill, driven in the engine phase). The spire is ringed by
// a walkable PLATFORM where four catwalks meet (entry + three pod spurs), all over
// a -2048 well whose diagonal wedges let the spire plunge into the dark. Three
// satellite PODS branch off the far/left/right catwalks:
//   FAR  — "condemned stacks": the RSS reliquary barrels (tags 551..555) the OOM
//          BARON (pen tag 548, gate 556) stalks, with the ps/RSS + OOM terminals.
//   LEFT — "scriptorium annex": the swap-in/out channels (tags 546/547) + vmstat.
//   RIGHT— "returns desk": the minor/major page-fault meters (tags 549/550) + sar.
//
// The well + spire + radial catwalks silhouette is distinct from every other wing
// (cpu=core-ring, network=trough, disk=hex-spiral) and breaks every long sightline
// for free, so the anti-smear rule holds by topology. The solid spire is built as
// a POLYGONAL HOLE: the platform ring's inner (octagon) edges are one-sided walls
// wearing the shelf texture, so the cylinder reads full-height with no interior
// sector. Every abyss edge is a two-sided-but-impassable rail (lineFlagsFor,
// kind:"void") so the deep well cannot soft-lock the player. See
// MEMORY_WING_REDESIGN_PLAN.md, [[memory-wing-well-redesign]],
// [[builder-full-switch-polygon-bsp]], [[wing-terminal-segment-rotation]],
// [[memory-wing-use-instruments]].
import { addWingEntrance } from "./common.mjs";
import { reserved, wingName } from "./registry.mjs";
import { terminalTextureSize, buildTerminalPatch } from "../textures.mjs";
import { lump, buildPatch } from "../wad-bytes.mjs";

// labelSide / textureSide are stored WORLD-frame; the wing thinks local (u,v) and
// converts. (East is a +1 quarter-turn: local "top"(+v)->world "right", local
// "left"(-u)->world "top", local "right"(+u)->world "bottom".)
const localSideToWorld = (direction, side) => {
  const turns = { north: 0, east: 1, south: 2, west: 3 }[direction];
  const sides = ["top", "right", "bottom", "left"];
  const index = sides.indexOf(side);
  if (turns === undefined || index === -1) {
    throw new Error(`Cannot rotate side ${side} for direction ${direction}`);
  }
  return sides[(index + turns) % sides.length];
};

const rotatePoint = ([u, v], direction) => {
  switch (direction) {
    case "north":
      return [u, v];
    case "east":
      return [v, -u];
    case "south":
      return [-u, -v];
    case "west":
      return [-v, u];
    default:
      throw new Error(`Unknown map direction: ${direction}`);
  }
};

// Shoelace signed area; the builder wants CLOCKWISE loops (interior on the right,
// signed area < 0). ensureCW flips a loop that came out CCW so hand-ordered
// polygons don't have to be wound perfectly by eye.
const signedArea = (poly) => {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
};
const ensureCW = (poly) => (signedArea(poly) < 0 ? poly : poly.slice().reverse());

// ===== Well geometry (local u,v) =====
// Three concentric octagons share the spire centre (0, SC). Each octagon has a
// FACE (not a vertex) pointing along each axis, so the four axis faces (far +v /
// near -v / left -u / right +u) carry the catwalks and the four diagonal faces
// open onto the void wedges. Vertices sit at 22.5 + 45k degrees.
const SC = 1600; // spire centre depth (world x for east)
const R_SPIRE = 112; // solid cylinder (the hole)
const R_PLAT = 240; // platform ring outer / void ring inner
const R_WELL = 560; // void ring outer / shaft wall
const octVerts = (R) =>
  Array.from({ length: 8 }, (_, k) => {
    const a = ((22.5 + 45 * k) * Math.PI) / 180;
    return [Math.round(R * Math.cos(a)), Math.round(SC + R * Math.sin(a))];
  });
const spireOct = octVerts(R_SPIRE);
const platOct = octVerts(R_PLAT);
const wellOct = octVerts(R_WELL);
// One convex ring trapezoid between two concentric octagons at face i (the disk
// wing's proven ringTrap): [inner[i], inner[j], outer[j], outer[i]].
const ringTrap = (inner, outer, i) => {
  const j = (i + 1) % inner.length;
  return [inner[i], inner[j], outer[j], outer[i]];
};

// ===== Heights =====
const WALK = 0; // catwalk / platform / pod / vestibule floor
const ABYSS = -2048; // the bottomless well floor
const SHAFT_CEIL = 768; // tall dark shaft ceiling (over the well)
const ROOM_CEIL = 200; // vestibule / pod ceiling (feels like a room)
const CWH = 48; // catwalk half-width (96 wide reads as a narrow bridge)

// ===== Terminals =====
// Five read-point screens, each a CPU-wing-style simulated terminal (blurred
// streaming logs) with the server-details control panel on its riser. Positions
// (below) are shared by build() and terminals() so the map geometry and the
// browser USE-segments agree.
const memoryTerminal = { lines: ["MEMORY", "FREE -M"], texture: wingName("memory", "TERM"), patch: wingName("memory", "PTRM") };
const memoryScreens = {
  rss: { lines: ["RESIDENT SET", "PS SORT RSS"], texture: wingName("memory", "RTRM"), patch: wingName("memory", "PRTR") },
  oom: { lines: ["OOM KILLER", "VMSTAT DMESG"], texture: wingName("memory", "OTRM"), patch: wingName("memory", "POTR") },
  swap: { lines: ["SWAP IO", "VMSTAT SI SO"], texture: wingName("memory", "STRM"), patch: wingName("memory", "PSTR") },
  faults: { lines: ["PAGE FAULTS", "SAR -B PSI"], texture: wingName("memory", "FTRM"), patch: wingName("memory", "PFTR") },
};
const REC = 16; // terminal recess depth
const TERM_FLOOR = 32; // riser height (control-panel step, not climbed)
const TERM_CEIL = TERM_FLOOR + terminalTextureSize.height; // 160
const TERM_HALF = terminalTextureSize.width / 2; // 128

// ===== Pod / vestibule extents (local u,v) =====
const VEST = { u1: -256, u2: 256, v1: 704, v2: wellOct[5][1] }; // near, v2 = near well face (1083)
const VEST_TC = 896; // free -m recess centre v
const FAR = { u1: -288, u2: 288, v1: wellOct[1][1], v2: wellOct[1][1] + 320 }; // far well face (2117) .. 2437
const FAR_TC = Math.round((FAR.v1 + FAR.v2) / 2); // 2277
const LEFT = { u1: wellOct[3][0] - 320, u2: wellOct[3][0], v1: SC - 160, v2: SC + 160 }; // -837..-517
const RIGHT = { u1: wellOct[7][0], u2: wellOct[7][0] + 320, v1: SC - 160, v2: SC + 160 }; // 517..837
// Screen faces (the one-sided far wall of each shallow recess): {u, v1, v2}.
const screenFaces = {
  memory: { u: VEST.u1 - REC, v1: VEST_TC - TERM_HALF, v2: VEST_TC + TERM_HALF },
  "memory-rss": { u: FAR.u1 - REC, v1: FAR_TC - TERM_HALF, v2: FAR_TC + TERM_HALF },
  "memory-oom": { u: FAR.u2 + REC, v1: FAR_TC - TERM_HALF, v2: FAR_TC + TERM_HALF },
  "memory-swap": { u: LEFT.u1 - REC, v1: SC - TERM_HALF, v2: SC + TERM_HALF },
  "memory-faults": { u: RIGHT.u2 + REC, v1: SC - TERM_HALF, v2: SC + TERM_HALF },
};

// ===== Instrument tags (reserved memory block [500,559]) =====
// The page-grid tags 500..544 are RETIRED (the spire replaces the grid); the
// tag-driven swap / fault / barrel / baron drivers key off these unchanged, so
// relocating them into the pods needs no engine change.
const tagBase = reserved.memory.sectorTags[0]; // 500
const memoryTags = {
  swapIn: tagBase + 46, // 546
  swapOut: tagBase + 47, // 547
  oomPen: tagBase + 48, // 548
  minFlt: tagBase + 49, // 549
  majFlt: tagBase + 50, // 550
  gate: tagBase + 56, // 556 (baron-dais gate)
};
const barrelTag = (index) => tagBase + 51 + index; // 551..555

// ===== Art (all under the reserved DPM prefix) =====
const barrelPadFlatName = wingName("memory", "BPAD");
const pageFlatNames = { used: wingName("memory", "USED"), cache: wingName("memory", "CACH"), free: wingName("memory", "FREE") };
const bookshelfTexture = { texture: wingName("memory", "SHLF"), patch: wingName("memory", "PSHLF"), width: 128, height: 128 };
const abyssWallTexture = { texture: wingName("memory", "VOID"), patch: wingName("memory", "PVOID"), width: 64, height: 128 };
const rackTexture = { texture: wingName("memory", "RACK"), patch: wingName("memory", "PRACK"), width: 128, height: 128 };
// The spire's shelf pitch, in map units. The engine stacks the book sprites in
// rings this far apart (DOOMPERF_SPIRE_RSTEP in p_tick.c) and the rack texture
// draws a board every RING_PITCH rows; the two MUST agree or the books float.
// The alignment works because a one-sided wall is pegged to its ceiling, the spire
// ceiling is 768 = 6 x 128 (the texture's tiling height), and 128 / RING_PITCH is a
// whole number — so texture row 0 lands exactly on z=768 and every board lands on
// an exact multiple of RING_PITCH.
const RING_PITCH = 32;

const flatRect = (pixels, size, x1, y1, x2, y2, color) => {
  for (let y = Math.max(0, y1); y < Math.min(size, y2); y += 1) {
    for (let x = Math.max(0, x1); x < Math.min(size, x2); x += 1) {
      pixels[y * size + x] = color;
    }
  }
};

// Book-cover / empty-slot flats (DPMUSED green / DPMCACH cyan / DPMFREE recess).
// The spire fill (engine phase) still resolves these by name via R_FlatNumForName,
// so they must stay in the WAD even though the retired page grid no longer uses
// them as sector floors.
const buildBookFlat = ({ name, cover, light, dark }) => {
  const size = 64;
  const pixels = new Uint8Array(size * size).fill(cover);
  const rect = (x1, y1, x2, y2, color) => flatRect(pixels, size, x1, y1, x2, y2, color);
  rect(0, 0, size, 3, dark);
  rect(0, size - 3, size, size, dark);
  rect(0, 0, 3, size, dark);
  rect(size - 3, 0, size, size, dark);
  rect(3, 3, size - 3, 6, light);
  rect(3, size - 6, size - 3, size - 3, dark);
  rect(6, 8, 16, size - 8, dark);
  rect(10, 8, 12, size - 8, light);
  rect(24, 20, size - 10, 44, light);
  rect(27, 26, size - 16, 28, dark);
  rect(27, 32, size - 20, 34, dark);
  rect(27, 38, size - 14, 40, dark);
  return lump(name, Buffer.from(pixels));
};
const buildSlotFlat = (name) => {
  const size = 64;
  const pixels = new Uint8Array(size * size).fill(8);
  const rect = (x1, y1, x2, y2, color) => flatRect(pixels, size, x1, y1, x2, y2, color);
  rect(0, 0, size, 2, 96);
  rect(0, 0, 2, size, 96);
  rect(0, size - 2, size, size, 0);
  rect(size - 2, 0, size, size, 0);
  rect(6, 6, size - 6, size - 6, 0);
  for (let y = 12; y < size - 8; y += 12) rect(8, y, size - 8, y + 1, 96);
  return lump(name, Buffer.from(pixels));
};
const pageFlats = [
  buildBookFlat({ name: pageFlatNames.used, cover: 114, light: 112, dark: 8 }),
  buildBookFlat({ name: pageFlatNames.cache, cover: 202, light: 200, dark: 8 }),
  buildSlotFlat(pageFlatNames.free),
];

// Barrel-pad flat: a dark steel plate with an amber hazard frame around the
// barrel footprint (the per-pad OOM glow is the sector light, driven by p_tick.c).
const buildBarrelPadFlat = () => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(7);
  const rect = (x1, y1, x2, y2, color) => flatRect(px, size, x1, y1, x2, y2, color);
  rect(0, 0, size, 3, 96);
  rect(0, 0, 3, size, 96);
  rect(0, size - 3, size, size, 0);
  rect(size - 3, 0, size, size, 0);
  rect(12, 12, size - 12, size - 12, 5);
  rect(12, 12, size - 12, 14, 215);
  rect(12, size - 14, size - 12, size - 12, 215);
  rect(12, 12, 14, size - 12, 215);
  rect(size - 14, 12, size - 12, size - 12, 215);
  return lump(barrelPadFlatName, Buffer.from(px));
};

// Oversized RSS-reliquary barrel sprite (replaces IWAD BAR1) so the barrels read
// boldly across the far pod. See [[pwad-sprite-override-constraint]].
const buildBarrelSprite = () => {
  const width = 40;
  const height = 56;
  const TRANSPARENT = 247;
  const px = new Uint8Array(width * height).fill(TRANSPARENT);
  const cx = 20;
  const bodyHalf = 17;
  const halfAt = (y) => {
    if (y < 4) return 0;
    if (y < 9) return 11 + (y - 4);
    if (y >= 52) return bodyHalf - 2;
    return bodyHalf;
  };
  for (let y = 3; y < 54; y += 1) {
    const hw = halfAt(y);
    for (let dx = -hw; dx <= hw; dx += 1) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      const f = hw > 0 ? Math.abs(dx) / hw : 0;
      let c = f < 0.35 ? 96 : f < 0.72 ? 7 : 5;
      if (y < 9) c = f < 0.5 ? 8 : 5;
      px[y * width + x] = c;
    }
  }
  const band = (y, c) => {
    for (let dx = -bodyHalf; dx <= bodyHalf; dx += 1) {
      const x = cx + dx;
      if (x >= 0 && x < width && y >= 0 && y < height) px[y * width + x] = c;
    }
  };
  band(9, 8);
  band(53, 0);
  [18, 32, 46].forEach((hy) => { band(hy, 8); band(hy + 1, 5); });
  band(25, 215);
  return buildPatch(px, width, height, { leftOffset: cx, topOffset: height, transparent: TRANSPARENT });
};

// Spire fill-book sprites: small upright tomes billboarded on the central spire,
// one per filled slot. Green = working set (overrides the unused radsuit SUITA0),
// blue = reclaimable cache (overrides the unused berserk PSTRA0); the driver
// (p_tick.c DoomPerf_UpdateMemorySpire) glides them into slots. Frame A only,
// authored fullbright so the green/blue bands read in the dim shaft. See
// [[pwad-sprite-override-constraint]].
// Gauge-cap ring marker: one segment of a continuous amber band. The driver pins
// a DENSE, overlapping ring of these just above the spire's top slot; each segment
// is a clean full-width amber bar (NO end caps or rivets — those cues read as
// discrete "planks"), so the overlapping copies merge seamlessly into a single
// solid amber ring marking the "100% full" line. Overrides the unused light-amp
// visor lump (PVISA0), fullbright, deliberately warm so it never reads as a book.
const buildCapSprite = () => {
  const W = 48;
  const H = 16;
  const T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const rect = (x1, y1, x2, y2, c) => {
    for (let y = Math.max(0, y1); y < Math.min(H, y2); y += 1) {
      for (let x = Math.max(0, x1); x < Math.min(W, x2); x += 1) px[y * W + x] = c;
    }
  };
  // Full-width horizontal bands, no vertical edges, so neighbours tile flush.
  rect(0, 3, W, 13, 215); // amber body
  rect(0, 3, W, 5, 209); // bright top highlight
  rect(0, 5, W, 6, 212);
  rect(0, 11, W, 13, 218); // shadowed underside
  return buildPatch(px, W, H, { leftOffset: Math.floor(W / 2), topOffset: H, transparent: T });
};

// A spine's palette: base plus its ramp neighbours (the Doom palette runs each
// 16-entry ramp bright -> dark, so base-2 lights an edge and base+2 shades one),
// the colour its title is stamped in (gilt on dark bindings, ink on pale ones)
// and the shade of its sunken title panel. Muted warm/grey bindings only — bright
// green/cyan stay reserved for the metric books on the spire.
const spineStyles = [
  { base: 71, light: 69, dark: 73, ink: 162, panel: 73 }, //  brown leather, gilt
  { base: 36, light: 34, dark: 38, ink: 162, panel: 38 }, //  dark red, gilt
  { base: 163, light: 162, dark: 165, ink: 0, panel: 165 }, // ochre cloth, black stamp
  { base: 88, light: 86, dark: 91, ink: 7, panel: 91 }, //    pale grey, ink
  { base: 129, light: 128, dark: 131, ink: 73, panel: 131 }, // cream, brown ink
  { base: 154, light: 152, dark: 156, ink: 162, panel: 156 }, // olive, gilt
  { base: 30, light: 28, dark: 32, ink: 162, panel: 32 }, //  rust, gilt
  { base: 102, light: 100, dark: 104, ink: 162, panel: 104 }, // slate, gilt
  { base: 67, light: 65, dark: 70, ink: 162, panel: 70 }, //  tan, gilt
  { base: 75, light: 73, dark: 77, ink: 164, panel: 77 }, //  dark brown, dim gilt
];

// Deterministic PRNG (mulberry32). The shelf art is generated, but the WAD must be
// byte-reproducible build to build, so nothing here may reach for Math.random.
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// A pixel canvas and the drawing vocabulary the shelf texture and the book SPRITES
// share, so a book is recognisably the same object whether it is painted on a wall
// or flying across the well.
const canvas = (W, H, fill) => {
  const px = new Uint8Array(W * H).fill(fill);
  const rect = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) px[yy * W + xx] = c;
    }
  };
  const dot = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c;
  };
  return { px, rect, dot };
};

const dice = (rnd) => ({
  between: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),
  pick: (list) => list[Math.floor(rnd() * list.length)],
});

// "Writing" at 1 pixel per map unit: 1-3px words separated by a space, sometimes
// stopping short of the margin so no two lines look like the same word. Illegible
// by construction, unmistakably lettering at the range you read a book from.
const lettering = (rnd, dot) => {
  const { between } = dice(rnd);
  return {
    row: (x0, y, width, color) => {
      let x = x0 + (rnd() < 0.4 ? 1 : 0);
      const end = x0 + width;
      while (x < end) {
        const word = between(1, 3);
        for (let k = 0; k < word && x < end; k += 1, x += 1) dot(x, y, color);
        x += 1;
        if (rnd() < 0.25) break; // a title that doesn't fill its panel
      }
    },
    // The same, read top-to-bottom (how a thick book is lettered down its spine).
    column: (x, y0, height, color) => {
      let y = y0;
      const end = y0 + height;
      while (y < end) {
        const word = between(2, 4);
        for (let k = 0; k < word && y < end; k += 1, y += 1) dot(x, y, color);
        y += 2;
      }
    },
  };
};

// Bookshelf wall texture, worn by the SHAFT walls (the library's static stacks) and
// the pods. NOT by the spire: the spire is the live gauge and its only books are
// the sprites that fly in (see rackTexture).
//
// The texture is authored at 1 pixel per MAP UNIT, which fixes how much detail a
// book can hold: a spine is ~10 units wide, so a title cannot be lettering — it is
// drawn as pseudo-glyph dashes, gilt on dark bindings and ink on pale ones, with a
// shorter author line under the lower band. Each spine also gets a rounded profile
// (lit edge / shaded edge), raised leather bands, and some get a stamped panel or a
// library call-number sticker; rows are broken up by borrowed-volume gaps and
// stacks lying flat. The tile is 128 wide (a bay either side of a centre post, so
// the bookcase still posts every 64 units as before) purely to halve the visible
// tiling repeat. The cabinet interior stays dark warm wood so distant undersampling
// lands on brown, not mud.
const buildBookshelfPatch = () => {
  const W = bookshelfTexture.width;
  const H = bookshelfTexture.height;
  const { px, rect, dot } = canvas(W, H, 78);
  const rnd = mulberry32(0xb0045);
  const { between, pick } = dice(rnd);
  const { row: glyphRow, column: glyphColumn } = lettering(rnd, dot);

  // Cabinet grain: a few darker/lighter columns so the dark behind the books isn't
  // a flat field.
  for (let x = 0; x < W; x += 1) {
    if ((x * 7) % 11 === 0) rect(x, 0, 1, H, 79);
    else if ((x * 5) % 13 === 0) rect(x, 0, 1, H, 77);
  }

  const shelfBays = [[2, 61], [66, 125]];
  [6, 46, 86].forEach((sy) => {
    const boardY = sy + 32;
    for (const [bayStart, bayEnd] of shelfBays) {
      let x = bayStart;
      while (x < bayEnd) {
        const room = bayEnd - x;
        const roll = rnd();

        if (room >= 5 && roll < 0.06) {
          // A borrowed volume: an empty slot, shadow pooling on the board.
          const gap = between(3, Math.min(6, room));
          rect(x, boardY - 22, gap, 22, 79);
          rect(x, boardY - 4, gap, 4, 8);
          x += gap;
          continue;
        }

        if (room >= 15 && roll < 0.13) {
          // A stack lying flat: fore-edges out, so these read as cream page blocks
          // between the coloured spines.
          const w = between(11, Math.min(17, room - 1));
          let y = boardY - 1;
          for (let k = between(2, 3); k > 0; k -= 1) {
            const thickness = between(3, 4);
            y -= thickness;
            const s = pick(spineStyles);
            rect(x, y, w, thickness, 128);
            rect(x, y, w, 1, s.base); // the cover, seen edge-on
            rect(x, y + thickness - 1, w, 1, s.dark);
            rect(x, y, 1, thickness, s.dark);
            rect(x + w - 1, y, 1, thickness, s.dark);
            if (thickness === 4) rect(x + 1, y + 2, w - 2, 1, 131); // page shadow
          }
          x += w + 1;
          continue;
        }

        const w = Math.min(between(7, 13), room);
        if (w < 5) break;
        const bh = between(20, 30);
        const s = pick(spineStyles);
        const top = boardY - bh;

        // Body + rounded profile: the lit edge and the shaded edge are what make a
        // row of flat rectangles read as a row of separate objects.
        rect(x, top, w, bh, s.base);
        rect(x, top, 1, bh, s.light);
        rect(x + w - 1, top, 1, bh, s.dark);
        rect(x, top, w, 1, s.dark); // head
        rect(x + 1, top + 1, w - 2, 1, s.light);
        rect(x, boardY - 1, w, 1, s.dark); // tail, standing on the board

        // Raised leather bands bracketing the title panel.
        const bandA = top + between(5, 7);
        const bandB = Math.min(boardY - 7, bandA + between(9, 14));
        const inner = w - 2;
        for (const by of [bandA, bandB]) {
          rect(x + 1, by - 1, inner, 1, s.light);
          rect(x + 1, by, inner, 1, s.dark);
        }

        // The title: stamped straight onto the binding, into a sunken panel, or
        // lettered down the spine on the wider volumes.
        const panelTop = bandA + 2;
        const panelHeight = bandB - panelTop - 1;
        if (panelHeight >= 3) {
          const lettering = rnd();
          if (inner >= 6 && lettering < 0.3) {
            glyphColumn(x + Math.floor(w / 2), panelTop, panelHeight, s.ink);
            if (inner >= 8 && rnd() < 0.5) glyphColumn(x + Math.floor(w / 2) + 2, panelTop + 1, panelHeight - 2, s.ink);
          } else {
            if (lettering > 0.55) rect(x + 1, panelTop - 1, inner, panelHeight + 1, s.panel);
            glyphRow(x + 1, panelTop, inner, s.ink);
            if (panelHeight >= 5) glyphRow(x + 1, panelTop + 2, inner, s.ink);
          }
        }
        // The author, below the lower band: one shorter line, always inset.
        if (inner >= 5 && boardY - bandB >= 5 && rnd() < 0.75) {
          glyphRow(x + 2, bandB + 3, inner - 2, s.ink);
        }
        // An aged library call-number sticker near the tail. Cream, not white —
        // pure white is the hottest entry in the palette and a row of them reads as
        // a row of beacons rather than paper.
        if (inner >= 5 && rnd() < 0.25) {
          const sw = Math.min(4, inner - 1);
          rect(x + 2, boardY - 5, sw, 3, 129);
          rect(x + 2, boardY - 5, sw, 1, 128);
          glyphRow(x + 2, boardY - 4, sw, 7);
        }

        x += w + 1;
      }
    }

    // The board itself: lit top edge, shaded lip, and the shadow it throws.
    rect(2, boardY, W - 4, 4, 96);
    rect(2, boardY, W - 4, 1, 94);
    rect(2, boardY + 3, W - 4, 1, 100);
    rect(2, boardY + 4, W - 4, 1, 0);
  });

  // Steel posts last, so any book running long is clipped by the upright rather
  // than colliding with it. The tile seam (W-2, W-1 | 0, 1) and the centre post are
  // drawn as the same 4px bevel, so both read identically once the tile repeats.
  const post = (columns) => {
    const shades = [94, 96, 97, 100];
    columns.forEach((cx, i) => rect(cx, 0, 1, H, shades[i]));
  };
  post([W - 2, W - 1, 0, 1]);
  post([62, 63, 64, 65]);

  return buildPatch(px, W, H);
};

// The SPIRE's rack: an EMPTY bookcase. This is the live memory gauge, so the only
// books on it are the sprites the engine flies in — a painted-on book here would
// read as "already allocated" and steal the fill's whole point. What's left is the
// case itself: a board every RING_PITCH rows (each ring of book sprites lands
// exactly on one — see RING_PITCH), a dark cabinet recess between the boards for
// the books to stand against, and the wear of a shelf that is constantly emptied
// and refilled. Deliberately dim: the books are fullbright, so every unit of
// contrast here is a unit stolen from them.
const buildRackPatch = () => {
  const W = rackTexture.width;
  const H = rackTexture.height;
  const { px, rect, dot } = canvas(W, H, 79);
  const rnd = mulberry32(0x4ac4);
  const { between } = dice(rnd);

  // Cabinet back: a shallow vertical grain, darkest at the back of each bay.
  for (let x = 0; x < W; x += 1) {
    if ((x * 7) % 13 === 0) rect(x, 0, 1, H, 78);
    else if ((x * 5) % 17 === 0) rect(x, 0, 1, H, 8);
  }

  for (let boardTop = 0; boardTop < H; boardTop += RING_PITCH) {
    // A board's TOP EDGE is the line a ring of books stands on; its face hangs
    // below (rows increase downward = z decreases), and it throws a shadow into
    // the bay beneath.
    rect(0, boardTop, W, 1, 96); // the lit lip the books rest on
    rect(0, boardTop + 1, W, 3, 77); // the board's front face (wood)
    rect(0, boardTop + 1, W, 1, 75);
    rect(0, boardTop + 4, W, 2, 8); // the shadow it casts into the bay below
    // Empty-slot wear along the lip: the ghosts of books that have stood here.
    for (let x = 2; x < W - 2; x += between(5, 11)) {
      rect(x, boardTop + 1, between(2, 5), 1, 76);
      if (rnd() < 0.35) dot(x + 1, boardTop, 97);
    }
    // Dust and grit settled at the back of the empty bay.
    for (let k = between(3, 6); k > 0; k -= 1) {
      dot(between(1, W - 2), boardTop + between(7, RING_PITCH - 3), rnd() < 0.5 ? 77 : 8);
    }
  }

  return buildPatch(px, W, H);
};

// ===== The spire's books (sprites) =====
// The two metric bindings: green = working set, blue = reclaimable cache. Both are
// authored FULLBRIGHT, so they must carry the whole read against a deliberately dim
// rack. Colours are ramp-correct (the Doom palette runs each ramp bright -> dark),
// and the cache blue is pulled well up its ramp from the old near-navy so it still
// reads as blue in the well's gloom.
const bookSkins = {
  working: { cover: 114, light: 112, dark: 119, deep: 123, page: 128, leaf: 131, gilt: 161, seed: 0x9704 },
  cache: { cover: 197, light: 194, dark: 201, deep: 204, page: 128, leaf: 131, gilt: 161, seed: 0xcac4 },
};
const BOOK_T = 247; // transparent key (matches the barrel sprite)
const BOOK_W = 26;
const BOOK_H = 30; // < RING_PITCH, so the board under each ring stays visible

// A SHELVED book: standing on its board, front cover to the player, spine to the
// left. Same binding vocabulary as the wall books — rounded spine, raised bands,
// gilt pseudo-glyph title + author, page edges, call-number sticker — but at 2.5x
// the pixel budget, because this is the one book the player gets close to.
const buildShelvedBookSprite = (skin) => {
  const W = BOOK_W;
  const H = BOOK_H;
  const { px, rect, dot } = canvas(W, H, BOOK_T);
  const rnd = mulberry32(skin.seed);
  const { row, column } = lettering(rnd, dot);

  rect(2, 0, W - 4, H, skin.cover); // the cover
  rect(2, 0, W - 4, 2, skin.deep); // head
  rect(2, H - 2, W - 4, 2, skin.deep); // tail
  rect(3, 2, W - 6, 1, skin.light); // the lit top face of the cover

  // Spine: the rounded, banded edge of the binding.
  rect(2, 0, 5, H, skin.dark);
  rect(3, 1, 1, H - 2, skin.light); // the light rolling off the curve
  rect(7, 0, 1, H, skin.deep); // hinge shadow
  for (const by of [7, H - 9]) {
    rect(2, by, 5, 1, skin.light); // raised band
    rect(2, by + 1, 5, 1, skin.deep);
  }
  column(5, 11, H - 22, skin.gilt); // the title, lettered down the spine

  // Fore edge: the page block, with visible leaves.
  rect(W - 5, 2, 3, H - 4, skin.page);
  for (let y = 3; y < H - 3; y += 2) rect(W - 5, y, 3, 1, skin.leaf);
  rect(W - 6, 2, 1, H - 4, skin.deep); // shadow beside the pages

  // The cover: a gilt rule, the title, the author.
  rect(9, 4, W - 15, 1, skin.gilt);
  row(9, 8, W - 15, skin.gilt);
  row(9, 10, W - 16, skin.gilt);
  row(10, H - 9, W - 18, skin.gilt); // the author, always inset and shorter
  // Call-number sticker, aged cream.
  rect(9, H - 6, 4, 3, skin.page);
  row(9, H - 5, 4, 7);

  return buildPatch(px, W, H, { leftOffset: Math.floor(W / 2), topOffset: H, transparent: BOOK_T });
};

// A book IN FLIGHT: open, flying on its own pages. The spine is the body, held at
// the bottom (so the sprite stays base-aligned with the shelved frame and lands
// without a pop), and the two halves of the book are wings that beat through the
// cycle. `lift` is the height of the wing tip above the spine — positive on the
// upbeat, negative on the downbeat — and `span` how far the wings are spread, so
// folding them in (small span, high lift) is the book snapping shut.
//
// Frame budget is exactly five (BAL1/BAL2 A-E, the only unused multi-frame rot-0
// sprite names left in the IWAD; see [[pwad-sprite-override-constraint]]), spent as
// A=upbeat, B=level, C=downbeat, D=half-shut, E=shut. The engine flaps A-B-C-B and
// lands through D-E into the static shelved sprite.
const buildFlyingBookSprite = (skin, { lift, span, thick }) => {
  const W = 44;
  const H = BOOK_H;
  const { px, rect, dot } = canvas(W, H, BOOK_T);
  const cx = Math.floor(W / 2);
  const pivot = H - 11; // where the wings hinge: the top of the spine block

  for (const side of [-1, 1]) {
    for (let d = 3; d <= span; d += 1) {
      const f = (d - 3) / Math.max(1, span - 3); // 0 at the hinge .. 1 at the tip
      const y = pivot - Math.round(lift * f);
      const x = cx + side * d;
      // The cover is a flat BOARD: constant thickness, square-edged. A wing that
      // tapers to a point reads as a bird, which is exactly the wrong animal.
      rect(x, y - thick, 1, thick, skin.cover);
      dot(x, y - thick, skin.light); // the lit top face of the board
      dot(x, y - 1, skin.deep); // the cover's edge, in its own shadow
      rect(x, y, 1, 2, skin.page); // the page block hanging under the cover
      dot(x, y + 1, skin.leaf);
      if (d % 6 === 3) dot(x, y + 2, skin.page); // a leaf loose in the slipstream
      if (d % 5 === 0) dot(x, y - thick + 2, skin.gilt); // gilt catching the light
    }
    // The board's outer edge, squared off.
    const tipX = cx + side * span;
    const tipY = pivot - lift;
    rect(tipX, tipY - thick, 1, thick + 2, skin.dark);
  }

  // The spine block: the bound edge of the book, which is what actually flies.
  rect(cx - 4, pivot - 2, 8, 13, skin.dark);
  rect(cx - 4, pivot - 2, 1, 13, skin.light);
  rect(cx + 3, pivot - 2, 1, 13, skin.deep);
  rect(cx - 3, pivot + 1, 6, 1, skin.gilt); // a band, so the gilt reads in flight
  rect(cx - 3, pivot + 6, 6, 1, skin.gilt);

  return buildPatch(px, W, H, { leftOffset: cx, topOffset: H, transparent: BOOK_T });
};

// The flight cycle. E (shut) is drawn by the shelved builder itself, so the moment
// the book lands and swaps to its static sprite there is no visible change of image.
const flightFrames = {
  A: { lift: 9, span: 18, thick: 7 }, // upbeat
  B: { lift: 0, span: 19, thick: 6 }, // level: the widest silhouette
  C: { lift: -8, span: 18, thick: 7 }, // downbeat
  D: { lift: 13, span: 9, thick: 9 }, // half-shut, wings folding in
};

// Abyss wall: the riser every catwalk / platform / pod turns to the void — i.e.
// everything the eye finds BELOW the shelves. Every colour is drawn from the
// palette's darkest greys (mortar in pure black, slab faces at 8/7, a 6 catch-
// light on each course lip), so the drop reads as shadow rather than furniture,
// while the pilasters + running-bond courses keep it unmistakably a built wall
// and not a hole in the world. The shaft's bookshelves are one-sided mid
// textures and are untouched by this.
const buildAbyssWallPatch = () => {
  const W = abyssWallTexture.width;
  const H = abyssWallTexture.height;
  const px = new Uint8Array(W * H).fill(8);
  const rect = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) px[yy * W + xx] = c;
    }
  };
  for (let course = 0, y = 0; y < H; y += 32, course += 1) {
    rect(0, y, W, 1, 6); // the only light in the well catches the course lip
    rect(0, y + 1, W, 2, 0); // mortar
    rect(course % 2 === 0 ? 20 : 44, y + 3, 2, 29, 0); // running-bond joint
    rect(4, y + 3, W - 8, 1, 7); // slab face, a shade off the base
  }
  rect(0, 0, 4, H, 7); // pilasters at the tile seams
  rect(W - 4, 0, 4, H, 7);
  rect(1, 0, 1, H, 5);
  rect(W - 2, 0, 1, H, 5);
  return buildPatch(px, W, H);
};

const build = (ctx) => {
  const { areaRect, areaPoly, addAreaThing, direction, base } = ctx;

  addWingEntrance(ctx);

  const shelfWall = bookshelfTexture.texture;
  // Base library style; the well (shaft) sectors raise the ceiling into the dark
  // and swap to a dim ceiling flat, while pods/vestibule stay room-height.
  const mbase = { ...base, wall: shelfWall, floorFlat: "FLOOR5_1", ceilingFlat: "CEIL5_1", ceiling: ROOM_CEIL };
  const shaft = { ...mbase, ceiling: SHAFT_CEIL, ceilingFlat: "CEIL5_2" };
  // The platform ring's `wall` is worn by exactly one thing: the spire's one-sided
  // inner octagon (every other plat edge is a flush two-sided seam). So this is the
  // spire's skin — and it is the EMPTY rack, not the bookshelf. The spire's books
  // are the sprites that fly to it.
  const platStyle = { ...shaft, kind: "memory-walk", floor: WALK, light: 168, wall: rackTexture.texture };
  const catwalkStyle = { ...shaft, kind: "memory-walk", floor: WALK, light: 150 };
  // `wall` stays the shelf: the well's one-sided outer wall is books top to
  // bottom. `riserWall` is what the void shows on the *other* sectors' undersides
  // — every catwalk/platform/pod edge that falls away into it.
  const voidStyle = { ...shaft, kind: "void", floor: ABYSS, floorFlat: "FLOOR7_2", light: 112, riserWall: abyssWallTexture.texture };
  const podStyle = { ...mbase, kind: "memory-walk", floor: WALK, light: 180 };

  // A shallow control-panel terminal recess whose one-sided far wall is the
  // screen. `local` is the recess's local screen side ("left"/"right"); the riser
  // between the room floor and the raised recess floor wears the keyboard panel.
  const terminalRecess = (id, bounds, screen, local, light = 200) =>
    areaRect(direction, id, bounds, {
      ...podStyle,
      kind: "terminal",
      floor: TERM_FLOOR,
      ceiling: TERM_CEIL,
      light,
      labelSide: localSideToWorld(direction, local),
      labelTexture: screen.texture,
      controlPanel: true,
    });

  // ===== VESTIBULE: a low room off the entry throat. The `free -m` terminal is a
  // recess on its left wall, seen as you enter and pass before stepping out onto
  // the abyss catwalk. Its far wall opens (centre) onto the entry catwalk, flanked
  // by rail-windows down into the void. =====
  areaRect(direction, "vestibule", { u1: VEST.u1, v1: VEST.v1, u2: VEST.u2, v2: VEST.v2 }, { ...podStyle, light: 176 });
  terminalRecess("free-m", { u1: VEST.u1 - REC, v1: VEST_TC - TERM_HALF, u2: VEST.u1, v2: VEST_TC + TERM_HALF }, memoryTerminal, "left");
  addAreaThing(direction, 2028, VEST.u1 + 40, VEST.v1 + 64); // reading lamps flanking the mouth
  addAreaThing(direction, 2028, VEST.u2 - 40, VEST.v1 + 64);

  // ===== SPIRE + PLATFORM RING: the platform is eight convex trapezoids between
  // the spire octagon (a solid HOLE — its edges become the one-sided rack walls the
  // books fly to) and the platform octagon. All floor 0, so the ring is one
  // continuous walk around the cylinder where the four catwalks meet. =====
  for (let i = 0; i < 8; i += 1) {
    areaPoly(direction, `plat-${i}`, ensureCW(ringTrap(spireOct, platOct, i)), platStyle);
  }

  // ===== VOID RING: the four DIAGONAL wedges are pure abyss (the spire plunges
  // into them); the four AXIS slots are split into a narrow central catwalk (floor
  // 0) + two flank wedges (abyss). Every catwalk/platform/pod edge onto a void
  // sector is an impassable rail (kind:"void", lineFlagsFor). =====
  for (const i of [0, 2, 4, 6]) {
    areaPoly(direction, `void-diag-${i}`, ensureCW(ringTrap(platOct, wellOct, i)), voidStyle);
  }

  // FAR axis (+v): entry to the OOM/RSS pod.
  areaRect(direction, "cw-far", { u1: -CWH, v1: platOct[1][1], u2: CWH, v2: wellOct[1][1] }, catwalkStyle);
  areaPoly(direction, "void-far-r", ensureCW([platOct[1], [CWH, platOct[1][1]], [CWH, wellOct[1][1]], wellOct[1]]), voidStyle);
  areaPoly(direction, "void-far-l", ensureCW([platOct[2], wellOct[2], [-CWH, wellOct[2][1]], [-CWH, platOct[2][1]]]), voidStyle);

  // NEAR axis (-v): the entry catwalk back to the vestibule.
  areaRect(direction, "cw-near", { u1: -CWH, v1: wellOct[5][1], u2: CWH, v2: platOct[5][1] }, catwalkStyle);
  areaPoly(direction, "void-near-r", ensureCW([platOct[6], wellOct[6], [CWH, wellOct[6][1]], [CWH, platOct[6][1]]]), voidStyle);
  areaPoly(direction, "void-near-l", ensureCW([platOct[5], [-CWH, platOct[5][1]], [-CWH, wellOct[5][1]], wellOct[5]]), voidStyle);

  // LEFT axis (-u): the swap pod.
  areaRect(direction, "cw-left", { u1: wellOct[3][0], v1: SC - CWH, u2: platOct[3][0], v2: SC + CWH }, catwalkStyle);
  areaPoly(direction, "void-left-t", ensureCW([platOct[3], wellOct[3], [wellOct[3][0], SC + CWH], [platOct[3][0], SC + CWH]]), voidStyle);
  areaPoly(direction, "void-left-b", ensureCW([platOct[4], [platOct[4][0], SC - CWH], [wellOct[4][0], SC - CWH], wellOct[4]]), voidStyle);

  // RIGHT axis (+u): the page-fault pod.
  areaRect(direction, "cw-right", { u1: platOct[7][0], v1: SC - CWH, u2: wellOct[7][0], v2: SC + CWH }, catwalkStyle);
  areaPoly(direction, "void-right-t", ensureCW([platOct[0], [platOct[0][0], SC + CWH], [wellOct[0][0], SC + CWH], wellOct[0]]), voidStyle);
  areaPoly(direction, "void-right-b", ensureCW([platOct[7], wellOct[7], [wellOct[7][0], SC - CWH], [platOct[7][0], SC - CWH]]), voidStyle);

  // ===== FAR POD — "condemned stacks" (OOM + RSS). A plaza of RSS reliquary
  // barrels (top-RSS processes, tags 551..555, glow by per-process oom_score) that
  // the OOM-killer BARON stalks from a gated dais at the deep end. The ps/RSS and
  // OOM terminals are recessed into the side walls. =====
  const barrelRowV = FAR.v1 + 63;
  const barrelPadDepth = 64;
  areaRect(direction, "far-plaza-front", { u1: FAR.u1, v1: FAR.v1, u2: FAR.u2, v2: barrelRowV }, { ...podStyle, light: 178 });
  [-224, -112, 0, 112, 224].forEach((cx, slot) => {
    areaRect(direction, `rss-pad-${slot}`, { u1: cx - 32, v1: barrelRowV, u2: cx + 32, v2: barrelRowV + barrelPadDepth }, {
      ...podStyle,
      floorFlat: barrelPadFlatName,
      light: 150,
      tag: barrelTag(slot),
    });
    // Open plaza between the pads so the player can weave between the barrels.
    if (slot < 4) {
      areaRect(direction, `rss-gap-${slot}`, { u1: cx + 32, v1: barrelRowV, u2: cx + 80, v2: barrelRowV + barrelPadDepth }, { ...podStyle, light: 178 });
    }
    addAreaThing(direction, 2035, cx, barrelRowV + 32); // explosive barrel = a heavy process
  });
  areaRect(direction, "far-plaza-lead-l", { u1: FAR.u1, v1: barrelRowV, u2: -256, v2: barrelRowV + barrelPadDepth }, { ...podStyle, light: 178 });
  areaRect(direction, "far-plaza-lead-r", { u1: 256, v1: barrelRowV, u2: FAR.u2, v2: barrelRowV + barrelPadDepth }, { ...podStyle, light: 178 });
  areaRect(direction, "far-plaza-back", { u1: FAR.u1, v1: barrelRowV + barrelPadDepth, u2: FAR.u2, v2: FAR.v1 + 183 }, { ...podStyle, light: 176 });
  // Baron gate (waist-high sill, tag 556) + raised dais/pen (tag 548). The engine
  // holds the gate up at rest so the dormant baron reads as caged, and drops it on
  // an OOM kill so the baron walks out to detonate the fattest tenant.
  areaRect(direction, "oom-gate", { u1: -160, v1: FAR.v1 + 183, u2: 160, v2: FAR.v1 + 215 }, {
    ...podStyle,
    kind: "memory-oom-gate",
    floor: 64,
    floorFlat: "FLOOR5_2",
    light: 150,
    tag: memoryTags.gate,
  });
  areaRect(direction, "oom-dais", { u1: -160, v1: FAR.v1 + 215, u2: 160, v2: FAR.v2 }, {
    ...podStyle,
    kind: "memory-oom-pen",
    floor: 40,
    floorFlat: "FLOOR5_2",
    ceiling: 208,
    light: 120,
    tag: memoryTags.oomPen,
  });
  addAreaThing(direction, 3003, 0, FAR.v1 + 250); // Baron of Hell = the OOM killer
  // Flanks beside the dais keep the far pod rectangular for the side-wall screens.
  areaRect(direction, "far-flank-l", { u1: FAR.u1, v1: FAR.v1 + 183, u2: -160, v2: FAR.v2 }, { ...podStyle, light: 168 });
  areaRect(direction, "far-flank-r", { u1: 160, v1: FAR.v1 + 183, u2: FAR.u2, v2: FAR.v2 }, { ...podStyle, light: 168 });
  terminalRecess("rss", { u1: FAR.u1 - REC, v1: FAR_TC - TERM_HALF, u2: FAR.u1, v2: FAR_TC + TERM_HALF }, memoryScreens.rss, "left", 184);
  terminalRecess("oom", { u1: FAR.u2, v1: FAR_TC - TERM_HALF, u2: FAR.u2 + REC, v2: FAR_TC + TERM_HALF }, memoryScreens.oom, "right", 150);

  // ===== LEFT POD — "scriptorium annex" (swap). Two sunken nukage channels the
  // engine lifts/pulses as pages are swapped in / out (vmstat si/so, tags
  // 546/547), read from the vmstat/sar terminal on the back wall. =====
  const swapChannel = { ...podStyle, kind: "memory-swap-channel", floor: -20, floorFlat: "NUKAGE1", light: 176 };
  areaRect(direction, "swap-front", { u1: LEFT.u1, v1: LEFT.v1, u2: LEFT.u2, v2: SC - 96 }, { ...podStyle, light: 178 });
  areaRect(direction, "swap-back", { u1: LEFT.u1, v1: SC + 96, u2: LEFT.u2, v2: LEFT.v2 }, { ...podStyle, light: 178 });
  areaRect(direction, "swap-walk-a", { u1: LEFT.u1, v1: SC - 96, u2: LEFT.u1 + 56, v2: SC + 96 }, { ...podStyle, light: 176 });
  areaRect(direction, "swap-in", { u1: LEFT.u1 + 56, v1: SC - 96, u2: LEFT.u1 + 120, v2: SC + 96 }, { ...swapChannel, tag: memoryTags.swapIn });
  areaRect(direction, "swap-walk-b", { u1: LEFT.u1 + 120, v1: SC - 96, u2: LEFT.u1 + 152, v2: SC + 96 }, { ...podStyle, light: 176 });
  areaRect(direction, "swap-out", { u1: LEFT.u1 + 152, v1: SC - 96, u2: LEFT.u1 + 216, v2: SC + 96 }, { ...swapChannel, tag: memoryTags.swapOut });
  areaRect(direction, "swap-walk-c", { u1: LEFT.u1 + 216, v1: SC - 96, u2: LEFT.u2, v2: SC + 96 }, { ...podStyle, light: 176 });
  terminalRecess("swap", { u1: LEFT.u1 - REC, v1: SC - TERM_HALF, u2: LEFT.u1, v2: SC + TERM_HALF }, memoryScreens.swap, "left");

  // ===== RIGHT POD — "returns desk" (page faults). A minor-fault meter (steady
  // workload) and a hotter, spikier major-fault meter (the disk/swap refault
  // saturation signal), tags 549/550 (sar -B), read from the back-wall terminal. =
  const faultMeter = { ...podStyle, kind: "memory-fault-meter", floor: -24, light: 168 };
  areaRect(direction, "faults-front", { u1: RIGHT.u1, v1: RIGHT.v1, u2: RIGHT.u2, v2: SC - 96 }, { ...podStyle, light: 178 });
  areaRect(direction, "faults-back", { u1: RIGHT.u1, v1: SC + 96, u2: RIGHT.u2, v2: RIGHT.v2 }, { ...podStyle, light: 178 });
  areaRect(direction, "faults-walk-a", { u1: RIGHT.u1, v1: SC - 96, u2: RIGHT.u2 - 216, v2: SC + 96 }, { ...podStyle, light: 176 });
  areaRect(direction, "minflt", { u1: RIGHT.u2 - 216, v1: SC - 96, u2: RIGHT.u2 - 152, v2: SC + 96 }, { ...faultMeter, floorFlat: "FLOOR5_3", tag: memoryTags.minFlt });
  areaRect(direction, "faults-walk-b", { u1: RIGHT.u2 - 152, v1: SC - 96, u2: RIGHT.u2 - 120, v2: SC + 96 }, { ...podStyle, light: 176 });
  areaRect(direction, "majflt", { u1: RIGHT.u2 - 120, v1: SC - 96, u2: RIGHT.u2 - 56, v2: SC + 96 }, { ...faultMeter, floorFlat: "NUKAGE1", light: 176, tag: memoryTags.majFlt });
  areaRect(direction, "faults-walk-c", { u1: RIGHT.u2 - 56, v1: SC - 96, u2: RIGHT.u2, v2: SC + 96 }, { ...podStyle, light: 176 });
  terminalRecess("faults", { u1: RIGHT.u2, v1: SC - TERM_HALF, u2: RIGHT.u2 + REC, v2: SC + TERM_HALF }, memoryScreens.faults, "right");
};

const textures = [
  ...[memoryTerminal, ...Object.values(memoryScreens)].map((screen) => ({
    texture: screen.texture,
    patch: screen.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(screen),
  })),
  {
    texture: bookshelfTexture.texture,
    patch: bookshelfTexture.patch,
    width: bookshelfTexture.width,
    height: bookshelfTexture.height,
    build: buildBookshelfPatch,
  },
  {
    texture: abyssWallTexture.texture,
    patch: abyssWallTexture.patch,
    width: abyssWallTexture.width,
    height: abyssWallTexture.height,
    build: buildAbyssWallPatch,
  },
  {
    texture: rackTexture.texture,
    patch: rackTexture.patch,
    width: rackTexture.width,
    height: rackTexture.height,
    build: buildRackPatch,
  },
];

const flats = [...pageFlats, buildBarrelPadFlat()];

// Memory is the EAST wing (local u,v -> world (v,-u)); the shared terminalSegment
// helper assumes north=identity, so each screen face is emitted in WORLD coords
// here. Each face is a recess's one-sided far wall, running TERM_HALF either side
// of its centre along the local screen axis.
const terminals = () => {
  const segment = (u, v1, v2) => {
    const [ax, ay] = rotatePoint([u, v1], "east");
    const [bx, by] = rotatePoint([u, v2], "east");
    return { ax, ay, bx, by };
  };
  return Object.entries(screenFaces).map(([sign, face]) => ({
    sign,
    segments: [segment(face.u, face.v1, face.v2)],
  }));
};

// Every sprite here PWAD-overrides an IWAD lump by name and frame letter — new
// names and new frame letters are silently ignored, so the flight animation had to
// be fitted into sprite names the IWAD already animates. See
// [[pwad-sprite-override-constraint]].
//
//   BAR1 A-B   the RSS reliquary's oversized barrels (both frames, one image)
//   SUIT / PSTR (frame A only)  the SHELVED books: green working set / blue cache
//   BAL1 / BAL2 (A-E)  the same two books IN FLIGHT. These are the imp and
//     cacodemon fireballs: five rot-0 frames each, and nothing in the map fires
//     them (our Baron uses BAL7), which makes them the last unused multi-frame
//     sprite names in the IWAD. A-C are the wingbeat, D-E the book snapping shut;
//     E is drawn by the shelved builder, so the swap to the static sprite on
//     landing is invisible.
//   PVIS A     the amber "100% full" gauge-cap ring
const flightSprites = (name, skin) => [
  ...Object.entries(flightFrames).map(([frame, shape]) => ({
    name: `${name}${frame}0`,
    build: () => buildFlyingBookSprite(skin, shape),
  })),
  { name: `${name}E0`, build: () => buildShelvedBookSprite(skin) },
];
const sprites = [
  { name: "BAR1A0", build: buildBarrelSprite },
  { name: "BAR1B0", build: buildBarrelSprite },
  { name: "SUITA0", build: () => buildShelvedBookSprite(bookSkins.working) },
  { name: "PSTRA0", build: () => buildShelvedBookSprite(bookSkins.cache) },
  ...flightSprites("BAL1", bookSkins.working),
  ...flightSprites("BAL2", bookSkins.cache),
  { name: "PVISA0", build: buildCapSprite },
];

export const memoryWing = {
  resource: "memory",
  ids: reserved.memory,
  build,
  textures,
  flats,
  sprites,
  terminals,
};
