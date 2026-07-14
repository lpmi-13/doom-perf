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
const bookshelfTexture = { texture: wingName("memory", "SHLF"), patch: wingName("memory", "PSHLF"), width: 64, height: 128 };

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
const buildBookSprite = ({ cover, light, dark, page }) => {
  const W = 26;
  const H = 34;
  const T = 247; // transparent key (matches the barrel sprite)
  const px = new Uint8Array(W * H).fill(T);
  const rect = (x1, y1, x2, y2, c) => {
    for (let y = Math.max(0, y1); y < Math.min(H, y2); y += 1) {
      for (let x = Math.max(0, x1); x < Math.min(W, x2); x += 1) px[y * W + x] = c;
    }
  };
  rect(3, 2, W - 2, H - 2, cover); // cover
  rect(3, 2, W - 2, 3, dark); // top board
  rect(3, H - 3, W - 2, H - 2, dark); // bottom board
  rect(3, 2, 4, H - 2, dark); // spine outer
  rect(W - 3, 2, W - 2, H - 2, dark); // fore edge
  rect(4, 3, 8, H - 3, dark); // spine band
  rect(6, 4, 7, H - 4, light); // spine rule
  rect(W - 6, 3, W - 3, H - 3, page); // page edges (cream)
  rect(W - 7, 3, W - 6, H - 3, dark); // shadow beside the pages
  rect(8, 3, W - 7, 5, light); // top-cover highlight
  rect(11, 12, W - 9, 14, light); // title band
  rect(11, 17, W - 10, 18, light);
  rect(11, 21, W - 11, 22, light);
  return buildPatch(px, W, H, { leftOffset: Math.floor(W / 2), topOffset: H, transparent: T });
};

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

// Bookshelf wall texture, worn by the spire and the receding shaft walls. Muted
// warm/grey spines (bright green/cyan stay reserved for the metric books); a dark
// wood cabinet interior so distant undersampling lands on warm brown, not mud.
const buildBookshelfPatch = () => {
  const W = bookshelfTexture.width;
  const H = bookshelfTexture.height;
  const px = new Uint8Array(W * H).fill(78);
  const rect = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) px[yy * W + xx] = c;
    }
  };
  rect(0, 0, 2, H, 96);
  rect(W - 2, 0, 2, H, 96);
  const spineColors = [88, 71, 163, 36, 128, 102, 215, 30, 64, 154];
  [6, 46, 86].forEach((sy, shelf) => {
    const boardY = sy + 32;
    let x = 4;
    let i = 0;
    while (x < W - 5) {
      const bw = 8 + ((i * 3 + shelf) % 5);
      const bh = 22 + ((i * 5 + shelf * 3) % 9);
      const c = spineColors[(i + shelf) % spineColors.length];
      rect(x, boardY - bh, bw, bh, c);
      rect(x, boardY - bh, 1, bh, 0);
      rect(x + bw - 1, boardY - bh, 1, bh, 0);
      rect(x + 1, boardY - bh + 2, bw - 2, 1, 8);
      x += bw + 1;
      i += 1;
    }
    rect(2, boardY, W - 4, 4, 96);
    rect(2, boardY + 4, W - 4, 1, 0);
  });
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
  const platStyle = { ...shaft, kind: "memory-walk", floor: WALK, light: 168 };
  const catwalkStyle = { ...shaft, kind: "memory-walk", floor: WALK, light: 150 };
  const voidStyle = { ...shaft, kind: "void", floor: ABYSS, floorFlat: "FLOOR7_2", light: 112 };
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
  // the spire octagon (a solid HOLE — its edges become one-sided shelf walls) and
  // the platform octagon. All floor 0, so the ring is one continuous walk around
  // the cylinder where the four catwalks meet. =====
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

// Oversized barrel overrides the IWAD BAR1 (both existing frames; the barrels
// stand static, so A0/B0 share one image).
const sprites = [
  { name: "BAR1A0", build: buildBarrelSprite },
  { name: "BAR1B0", build: buildBarrelSprite },
  // Spire fill books (frame A): green working-set (SUIT) / blue cache (PSTR).
  { name: "SUITA0", build: () => buildBookSprite({ cover: 114, light: 112, dark: 123, page: 4 }) },
  { name: "PSTRA0", build: () => buildBookSprite({ cover: 202, light: 200, dark: 205, page: 4 }) },
  // Gauge-cap ring marker (frame A): amber rail (PVIS).
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
