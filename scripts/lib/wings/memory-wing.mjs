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
//   RIGHT— "fault gallery": a T-gallery over a sunken firing trench where the
//          fault VOLLEY fires beam-bolts (minor->RAM gate 549 / major->disk wall
//          550), watched side-on from a raised overlook carrying the sar terminal.
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
import { terminalTextureSize, buildTerminalPatch, wallSignSize, buildWallSignPatch, drawCenteredText, signTextColor } from "../textures.mjs";
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
const R_PLAT = 304; // platform ring outer / void ring inner (a broad walk around the spire)
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
const CWH = 64; // catwalk half-width (128 wide: a bridge you can walk two abreast)

// ===== Terminals =====
// Five read-point screens, each a CPU-wing-style simulated terminal (blurred
// streaming logs) with the server-details control panel on its riser. Positions
// (below) are shared by build() and terminals() so the map geometry and the
// browser USE-segments agree.
const memoryTerminal = { lines: ["MEMORY", "FREE -M"], texture: wingName("memory", "TERM"), patch: wingName("memory", "PTRM") };
const memoryScreens = {
  rss: { lines: ["RESIDENT SET", "PS SORT RSS"], texture: wingName("memory", "RTRM"), patch: wingName("memory", "PRTR") },
  oom: { lines: ["OOM KILLER", "VMSTAT DMESG"], texture: wingName("memory", "OTRM"), patch: wingName("memory", "POTR") },
  swap: { lines: ["MEM PRESSURE", "PSI VMSTAT"], texture: wingName("memory", "STRM"), patch: wingName("memory", "PSTR") },
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
// The sluice pod is deeper (u) and longer to the south (v) than the other pods: the
// south wall has to carry the vent duct, the SWAP plate and the inflow spout side by
// side, and the outlet needs room to be a wide spillway rather than a slot. It is also
// deeper (u) and longer to the north (v) than the pool needs, so the walkway that rings
// the pool is a full catwalk width (SLUICE_WALK) rather than a ledge you sidle along —
// the back leg is the approach to the swap terminal and has to be stood in comfortably.
// v2 must stay south of the well's left face corner (wellOct[3][1] = 1814) or the pod's
// north wall would overrun the void wedge it borders.
const SLUICE_WALK = 2 * CWH; // 128: back + north walkways around the pool
const LEFT = { u1: wellOct[3][0] - 576, u2: wellOct[3][0], v1: SC - 200, v2: SC + 192 }; // -1093..-517, 1400..1792
// ===== FAULT RANGE (right pod) — a T-gallery, run-queue style. A raised OVERLOOK
// (floor 0) where the player enters and walks, beside a sunken firing TRENCH that
// runs left-right along v: the emitter sits at the -v end, bolts fly +v, minor
// faults burst at the RAM GATE (mid-trench, flanked by glowing posts), major faults
// break through to the far DISK WALL (+v end), each then returning. Watched side-on
// from the overlook, so travel distance (minor short / major long) reads as motion.
// The sar/PSI terminal is on the overlook's +v end wall (walk-up). World frame is
// east: local (u,v)->world (v,-u); DoomPerf_FaultVolley fires along world +x.
const FR = {
  u0: wellOct[7][0], // 517: catwalk edge / overlook near wall (rail over the well)
  uRail: wellOct[7][0] + 256, // 773: overlook|trench boundary (blocking rail; player looks over)
  uBack: wellOct[7][0] + 536, // 1053: trench far backdrop wall
  v0: 1288, // -v end: emitter / RAM side (elongated for the MINOR/MAJOR wall signs)
  v1: 1912, // +v end: far disk wall
  vGate: 1600, // RAM gate (centre): minor bursts here; RAM floor (<vGate) vs disk floor (>vGate)
  floor: -48, // sunken trench floor (the overlook stays at 0)
};
const FR_TERM_U = Math.round((FR.u0 + FR.uRail) / 2); // 645: terminal centre on the overlook end wall (spans 256u)
// MINOR / MAJOR track-side wall signs, recessed into the far backdrop and facing the
// player (like the CPU run-queue's QUEUED/RUNNING signs) -- MINOR over the RAM half,
// MAJOR over the disk half. Each is a 256-wide sign, which is why the gallery is
// elongated to give each half room.
const faultSigns = {
  minor: { texture: wingName("memory", "SGMN"), patch: wingName("memory", "PSGMN"), text: "MINOR", vc: 1444 },
  major: { texture: wingName("memory", "SGMJ"), patch: wingName("memory", "PSGMJ"), text: "MAJOR", vc: 1756 },
};
// Screen faces (the one-sided far wall of each shallow recess). Most are ±u faces
// ({u, v1, v2}); memory-faults is a ±v face ({v, u1, u2}) on the overlook end wall.
const screenFaces = {
  memory: { u: VEST.u1 - REC, v1: VEST_TC - TERM_HALF, v2: VEST_TC + TERM_HALF },
  "memory-rss": { u: FAR.u1 - REC, v1: FAR_TC - TERM_HALF, v2: FAR_TC + TERM_HALF },
  "memory-oom": { u: FAR.u2 + REC, v1: FAR_TC - TERM_HALF, v2: FAR_TC + TERM_HALF },
  "memory-swap": { u: LEFT.u1 - REC, v1: SC - TERM_HALF, v2: SC + TERM_HALF },
  "memory-faults": { v: FR.v1 + REC, u1: FR_TERM_U - TERM_HALF, u2: FR_TERM_U + TERM_HALF },
};

// ===== Instrument tags (reserved memory block [500,559]) =====
// The page-grid tags 500..544 are RETIRED (the spire replaces the grid). Tags
// 546/547 (once the swap-in/out channels) are repurposed as the reclaim sluice's
// pool + dam gate; 557/558 add its swap tributary + inflow. The fault / barrel /
// baron drivers key off their tags unchanged.
const tagBase = reserved.memory.sectorTags[0]; // 500
const memoryTags = {
  pool: tagBase + 46, // 546: reclaim-sluice pool — floor level is the saturation backlog
  drainSlots: tagBase + 47, // 547: the fixed drain slots through the barrier (engine only tints them)
  oomPen: tagBase + 48, // 548
  nearGlow: tagBase + 49, // 549: fault range RAM side — flashes cyan on a minor-fault burst at the gate
  farGlow: tagBase + 50, // 550: fault range disk side — flares amber on a major-fault strike at the far wall
  gate: tagBase + 56, // 556 (baron-dais gate)
  swapTrib: tagBase + 57, // 557: swap tributary — runs when swap is configured, seals dry when not
  inflow: tagBase + 58, // 558: demand inflow stream feeding the pool
  drain: tagBase + 59, // 559: tailwater below the weir — mirrors the pool's colour
};
const barrelTag = (index) => tagBase + 51 + index; // 551..555

// ===== Art (all under the reserved DPM prefix) =====
const barrelPadFlatName = wingName("memory", "BPAD");
const pageFlatNames = { used: wingName("memory", "USED"), cache: wingName("memory", "CACH"), free: wingName("memory", "FREE") };
const bookshelfTexture = { texture: wingName("memory", "SHLF"), patch: wingName("memory", "PSHLF"), width: 128, height: 128 };
const abyssWallTexture = { texture: wingName("memory", "VOID"), patch: wingName("memory", "PVOID"), width: 64, height: 128 };
const rackTexture = { texture: wingName("memory", "RACK"), patch: wingName("memory", "PRACK"), width: 128, height: 128 };
// The fault range's RAM-gate FORCEFIELD: a see-through electric energy field (a
// two-sided mid texture on the gate seam) the bolts pass through. See buildForcefieldPatch.
const forcefieldTexture = { texture: wingName("memory", "FFLD"), patch: wingName("memory", "PFFL"), width: 64, height: 128 };
// The fault range's DISK-SIDE wall: a library CARD CATALOG (a wall of little labelled
// index drawers with brass pulls) -- the disk is the index you consult when a page
// isn't on the open shelf. Distinct from the RAM-side bookshelves, same wood theme.
const cardCatalogTexture = { texture: wingName("memory", "CCAT"), patch: wingName("memory", "PCCT"), width: 128, height: 128 };
// The reclaim sluice's OUTFLOW WATERFALL: a nukage cascade worn on the swap pod's
// well-facing lip so the drain-off pours over the edge into the abyss. The engine
// scrolls every sidedef wearing it downward each tic (found by name in
// DoomPerf_UpdateMemoryFalls), so the still texture only has to read as falling water.
const fallTexture = { texture: wingName("memory", "FALL"), patch: wingName("memory", "PFAL"), width: 64, height: 128 };
// The cascade comes in the same three TEMPERS as the pool surface, and the engine
// swaps them onto the fall sidedefs from the same fill reading that picks the pool
// flat — so the falling water is always the colour of the water it is falling out of.
// (Without this the pool reddens toward the OOM brim while its own outflow stays
// nukage green, which reads as two different fluids.) Doom's palette carries each hue
// as a 16-entry ramp that darkens with index — green 112, red 176, amber 208 — so one
// authored pattern of ramp OFFSETS recolours by moving its base. Amber bases at 210
// rather than 208 because 208 is pure white and blows the cascade's crests out.
const fallTempers = [
  { ...fallTexture, ramp: 112 }, // calm green (the name the map itself wears)
  { ...fallTexture, texture: wingName("memory", "FALA"), patch: wingName("memory", "PFLA"), ramp: 210 }, // amber
  { ...fallTexture, texture: wingName("memory", "FALR"), patch: wingName("memory", "PFLR"), ramp: 176 }, // hot red
];
// The "SWAP" plate beside the relief vent. Both dimensions MUST be powers of two and
// MUST equal the recess face it is hung on (128 wide x 128 floor-to-ceiling). Doom
// masks wall columns to a power of two — r_data.c sets texturewidthmask to the largest
// 2^n <= width, and R_DrawColumn indexes dc_source with `& 127` — so a 96-wide texture
// is drawn as if it were 64 wide and repeats mid-wall (one "SWAP" then half of the
// next). Every other sign in the project is 256x128 for the same reason.
const swapSignSize = { width: 128, height: 128 };
// The SWAP VENT's stand pipe: a fat riveted steel duct rising out of the pool to the
// vent mouth, so the steam visibly comes from somewhere. 64x128 (powers of two) and it
// tiles vertically up the pipe's full height, which is what a real pipe run looks like.
const pipeTexture = { texture: wingName("memory", "PIPE"), patch: wingName("memory", "PPIP"), width: 64, height: 128 };
const swapSign = { texture: wingName("memory", "SWSG"), patch: wingName("memory", "PSWS") };
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

// The reclaim-sluice POOL surface: three tempers the engine swaps by fill level —
// calm green when low, amber as it climbs, hot red as it nears the OOM brim (the
// engine also ramps the sector light to a glow at the top). A mottled liquid so the
// surface doesn't read as a flat slab.
const poolFlatNames = { calm: wingName("memory", "PLG"), warm: wingName("memory", "PLA"), hot: wingName("memory", "PLR") };
const buildPoolFlat = (name, base, hi, lo) => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(base);
  for (let i = 0; i < 150; i += 1) { const x = (i * 29) % size, y = (i * 47) % size; px[y * size + x] = hi; if (x + 1 < size) px[y * size + x + 1] = hi; }
  for (let i = 0; i < 100; i += 1) { const x = (i * 53 + 7) % size, y = (i * 31 + 3) % size; px[y * size + x] = lo; }
  return lump(name, Buffer.from(px));
};
const poolFlats = [
  buildPoolFlat(poolFlatNames.calm, 123, 116, 127), // nukage green
  buildPoolFlat(poolFlatNames.warm, 216, 214, 221), // amber
  buildPoolFlat(poolFlatNames.hot, 180, 176, 187),  // hot red
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

// The fault range's DISK-SIDE wall: a library CARD CATALOG. A regular grid of small
// wood drawers (warm wood ramp 76..79), each with a cream index card up top (a few
// faint text lines) and a brass pull below (215 body / 231 catch-light / 223 shade).
// Deliberately uniform -- a card catalog is orderly where the open shelves are not,
// so the disk side reads as the ordered index/archive vs the RAM-side stacks.
const buildCardCatalogPatch = () => {
  const W = cardCatalogTexture.width;
  const H = cardCatalogTexture.height;
  const { px, rect } = canvas(W, H, 78);
  const cols = 4;
  const rows = 6;
  for (let x = 0; x < W; x += 1) if ((x * 7) % 11 === 0) rect(x, 0, 1, H, 79); // faint frame grain
  for (let r = 0; r < rows; r += 1) {
    for (let cc = 0; cc < cols; cc += 1) {
      const x0 = Math.round((cc * W) / cols);
      const y0 = Math.round((r * H) / rows);
      const w = Math.round(((cc + 1) * W) / cols) - x0;
      const h = Math.round(((r + 1) * H) / rows) - y0;
      rect(x0, y0, w, h, 8); // black seam between drawers
      const fx = x0 + 1;
      const fy = y0 + 1;
      const fw = w - 2;
      const fh = h - 2;
      rect(fx, fy, fw, fh, 77); // drawer face
      rect(fx, fy, fw, 1, 76); // top / left lit edges
      rect(fx, fy, 1, fh, 76);
      rect(fx, fy + fh - 1, fw, 1, 79); // bottom / right shade
      rect(fx + fw - 1, fy, 1, fh, 79);
      // Cream index card, upper-centre.
      const lw = Math.round(fw * 0.62);
      const lh = Math.max(4, Math.round(fh * 0.34));
      const lx = fx + Math.round((fw - lw) / 2);
      const ly = fy + 2;
      rect(lx - 1, ly - 1, lw + 2, lh + 2, 79); // card frame
      rect(lx, ly, lw, lh, 128); // card
      rect(lx, ly, lw, 1, 48); // card catch-light
      rect(lx, ly + lh - 1, lw, 1, 131); // card shade
      for (let ty = ly + 2; ty < ly + lh - 1; ty += 2) rect(lx + 2, ty, lw - 4, 1, 131); // index lines
      // Brass pull below the card.
      const pw = Math.round(fw * 0.42);
      const pxx = fx + Math.round((fw - pw) / 2);
      const py = fy + fh - Math.max(4, Math.round(fh * 0.3));
      rect(pxx - 1, py - 1, pw + 2, 4, 223); // socket shadow
      rect(pxx, py, pw, 2, 215); // brass bar
      rect(pxx, py, pw, 1, 231); // catch-light
    }
  }
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

// The reclaim sluice's OUTFLOW WATERFALL texture: vertical nukage ropes tiled down
// the ~2000-unit drop into the abyss. DoomPerf_UpdateMemoryFalls scrolls every
// sidedef wearing it downward each tic, so the still image only needs to read as
// falling water; the motion is the engine's.
// `ramp` is the palette index the hue's 16-shade ramp starts at; every colour below is
// an OFFSET into it (0 = brightest), so the identical pattern renders green, amber or
// red. Offsets stay within 0..12, which keeps all three tempers inside their ramp.
const buildFallPatch = (ramp) => {
  const W = fallTexture.width;
  const H = fallTexture.height;
  const px = new Uint8Array(W * H).fill(ramp + 11); // deep body of the water
  const col = (x, w, c) => {
    for (let y = 0; y < H; y += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) px[y * W + xx] = c;
    }
  };
  // Ropes of falling water: vertical bands in a few shades of the hue, a couple
  // carrying a bright crest.
  const streaks = [[1, 3, 8], [7, 2, 4], [12, 4, 12], [19, 3, 6], [25, 2, 0], [31, 5, 10], [39, 2, 4], [44, 4, 7], [52, 3, 12], [57, 4, 8]];
  for (const [x, w, c] of streaks) col(x, w, ramp + c);
  // Broken glints so the scroll sparkles rather than reading as flat bars.
  for (let i = 0; i < 90; i += 1) {
    const x = (i * 37) % W;
    const y = (i * 53) % H;
    px[y * W + x] = ramp;
    if (x + 1 < W) px[y * W + x + 1] = ramp + 4;
  }
  return buildPatch(px, W, H);
};

// SWAP-VENT STEAM puffs. These override the IWAD's PUFF A-D frames, which is what
// vanilla MT_PUFF cycles through before despawning itself -- so the vent needs no new
// mobj type or state table, just spawned MT_PUFFs (see DoomPerf_UpdateSwapVent).
// Doom has no alpha blending, so the vapour is STIPPLED: a dither of grey against the
// transparent index, thinning toward the edges and over the puff's life. At Doom's
// resolution, in motion, that reads as translucent steam (the same trick the fault
// range's see-through forcefield uses). Palette 80..95 is the neutral grey ramp
// (80 = brightest); 4 is pure white, used sparingly for the hot core of frame A.
const STEAM_T = 247;
const steamSpriteSize = { width: 88, height: 88 };
const buildSteamPuffFrame = (stage) => {
  const { width: W, height: H } = steamSpriteSize;
  const px = new Uint8Array(W * H).fill(STEAM_T);
  const cx = W / 2;
  const cy = H / 2;
  // Each later frame is bigger, dimmer and sparser: a puff expanding and dissipating.
  const radius = [16, 26, 35, 42][stage];
  const density = [1.0, 0.82, 0.6, 0.36][stage];
  const shades = [
    [4, 80, 82],
    [80, 82, 85],
    [83, 86, 89],
    [87, 90, 93],
  ][stage];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      // Squash slightly so puffs read as billowing rather than perfect circles.
      const dx = (x + 0.5 - cx) / radius;
      const dy = (y + 0.5 - cy) / (radius * 0.85);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      // Radial falloff -> how likely this pixel survives the dither.
      const falloff = (1 - d) * density;
      // Ordered-ish dither from a cheap stable hash, so the stipple is fixed per
      // frame (no RNG: the WAD must rebuild byte-identically).
      const h = ((x * 73 + y * 151 + stage * 37) % 100) / 100;
      if (h > falloff) continue;
      px[y * W + x] = d < 0.35 ? shades[0] : d < 0.7 ? shades[1] : shades[2];
    }
  }
  return buildPatch(px, W, H, {
    leftOffset: Math.floor(W / 2),
    topOffset: Math.floor(H / 2),
    transparent: STEAM_T,
  });
};

// The vent's riveted STAND PIPE. Cylindrical shading (a highlight left of centre
// falling off to dark at both edges) so a flat wall reads as round, banded by flanges
// with rivet rows. Tiles vertically: the flange band sits at the tile seam so a run of
// pipe looks like sections bolted end to end.
const buildPipePatch = () => {
  const W = pipeTexture.width;
  const H = pipeTexture.height;
  const px = new Uint8Array(W * H);
  // Column shading across the barrel: 80 is the brightest neutral grey, 95 the darkest
  // of that ramp, then 5..8 for the deep shadow at the silhouette edges.
  const shadeFor = (x) => {
    const t = Math.abs((x + 0.5 - W * 0.42) / (W * 0.58)); // highlight left of centre
    if (t < 0.12) return 4; // specular
    if (t < 0.30) return 80;
    if (t < 0.48) return 83;
    if (t < 0.66) return 86;
    if (t < 0.82) return 90;
    if (t < 0.94) return 94;
    return 7;
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) px[y * W + x] = shadeFor(x);
  }
  const band = (y1, y2, delta) => {
    for (let y = Math.max(0, y1); y < Math.min(H, y2); y += 1) {
      for (let x = 0; x < W; x += 1) {
        const v = px[y * W + x] + delta;
        px[y * W + x] = Math.max(0, Math.min(255, v));
      }
    }
  };
  // Flange collars at the tile seam (top/bottom) and one mid-run coupling.
  for (const cy of [0, 64, H - 10]) {
    band(cy, cy + 10, -3); // collar body sits a shade darker than the barrel
    for (let x = 0; x < W; x += 1) {
      px[Math.max(0, cy) * W + x] = 5; // hard shadow line above
      px[Math.min(H - 1, cy + 9) * W + x] = 5; // and below
    }
    // Rivet row along the collar: a lit pip with a shadow under it.
    for (let x = 5; x < W - 3; x += 9) {
      const ry = Math.min(H - 4, cy + 3);
      px[ry * W + x] = 4;
      px[ry * W + x + 1] = 80;
      px[(ry + 1) * W + x] = 80;
      px[(ry + 1) * W + x + 1] = 7;
    }
  }
  return buildPatch(px, W, H);
};

// "SWAP" plate hung beside the relief vent: a bolted metal placard, sized to exactly
// fill its recess face so the word appears ONCE.
const buildSwapSignPatch = () => {
  const { width, height } = swapSignSize;
  const px = new Uint8Array(width * height).fill(7);
  const rect = (x1, y1, x2, y2, c) => {
    for (let y = Math.max(0, y1); y < Math.min(height, y2); y += 1) {
      for (let x = Math.max(0, x1); x < Math.min(width, x2); x += 1) px[y * width + x] = c;
    }
  };
  // Plate body with a bevelled edge (light top/left, dark bottom/right).
  rect(6, 6, width - 6, height - 6, 96);
  rect(6, 6, width - 6, 8, 80);
  rect(6, 6, 8, height - 6, 80);
  rect(6, height - 8, width - 6, height - 6, 0);
  rect(width - 8, 6, width - 6, height - 6, 0);
  // Corner bolts.
  for (const [bx, by] of [[12, 12], [width - 15, 12], [12, height - 15], [width - 15, height - 15]]) {
    rect(bx, by, bx + 3, by + 3, 5);
    rect(bx, by, bx + 2, by + 1, 80);
  }
  const scale = 3;
  const startY = Math.floor((height - 7 * scale) / 2);
  drawCenteredText(px, width, height, "SWAP", startY, scale, signTextColor, 12, width - 12);
  return buildPatch(px, width, height);
};

// The RAM-gate FORCEFIELD: a see-through electric energy field hung across the fault
// trench as a two-sided mid texture, so its transparent gaps show the disk side
// beyond while it still reads as a shield the bolts phase through. A diamond mesh
// (crossed diagonals) with bright white nodes at the intersections + faint
// scanlines, all electric-blue on transparent (index 247), so most of the tile is
// see-through. Its glow is the trench sector light, which p_tick.c flashes on a
// burst. Built masked via buildPatch.
const buildForcefieldPatch = () => {
  const W = forcefieldTexture.width;
  const H = forcefieldTexture.height;
  const T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const P = 20; // mesh pitch
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const a = (x + y) % P; // one diagonal family
      const b = (((x - y) % P) + P) % P; // the crossing family
      const onA = a < 2;
      const onB = b < 2;
      if (onA || onB) set(x, y, 194); // electric-blue mesh lines
      if (onA && onB) set(x, y, 4); // white node at each intersection
    }
  }
  for (let y = 2; y < H; y += 6) { // faint horizontal shimmer scanlines
    for (let x = 0; x < W; x += 2) if (px[y * W + x] === T) set(x, y, 192);
  }
  return buildPatch(px, W, H, { transparent: T });
};

// The fault sprites: three energy looks (not weapons), built on the project's orb
// palette (index 4 = white-hot core). The engine assigns them by fault class -- a
// violet plasma STREAK for MINOR faults, a flickering electric ARC for MAJOR faults;
// the gold ORB is the (unseen) spawnstate placeholder. See
// [[pwad-sprite-override-constraint]] (ORB->MISL A, ARC->PLSS A/B, STREAK->BFS1 A;
// nothing in the lab fires those).

// 1) Energy pulse orb (MISL A): a round gold glow -- white core -> gold rim.
const buildFaultOrbSprite = () => {
  const W = 18;
  const H = 18;
  const T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const cx = 8.5;
  const cy = 8.5;
  const r = 8.5;
  const ramp = [4, 231, 215, 216]; // white -> yellow -> amber -> dark amber
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) px[y * W + x] = ramp[Math.min(ramp.length - 1, Math.floor((d / r) * ramp.length))];
    }
  }
  return buildPatch(px, W, H, { transparent: T, leftOffset: 9, topOffset: 9 });
};

// 2) Lightning arc (PLSS A/B): a jagged electric bolt, two frames that flicker as it
// travels (the engine loops ARC1<->ARC2). White core, electric-blue glow.
const buildFaultArcSprite = (frame) => {
  const W = 22;
  const H = 18;
  const T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const plot = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H && (px[y * W + x] === T || c === 4)) px[y * W + x] = c;
  };
  // A horizontal zig-zag polyline; the two frames wobble differently to crackle.
  const pts = frame === 0
    ? [[1, 9], [5, 3], [9, 13], [13, 5], [17, 12], [21, 8]]
    : [[1, 8], [5, 13], [9, 4], [13, 12], [17, 6], [21, 10]];
  for (let s = 0; s < pts.length - 1; s += 1) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let t = 0; t <= steps; t += 1) {
      const x = Math.round(x0 + ((x1 - x0) * t) / steps);
      const y = Math.round(y0 + ((y1 - y0) * t) / steps);
      plot(x, y - 1, 194); // blue glow around the core
      plot(x, y + 1, 194);
      plot(x - 1, y, 194);
      plot(x + 1, y, 194);
      plot(x, y, 4); // white core
    }
  }
  return buildPatch(px, W, H, { transparent: T, leftOffset: 11, topOffset: 9 });
};

// 3) Plasma streak (BFS1 A): a bright energy streak, symmetric so it reads travelling
// either way; white core tapering to a violet fringe.
const buildFaultStreakSprite = () => {
  const W = 24;
  const H = 12;
  const T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const cx = 11.5;
  const cy = 5.5;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = Math.hypot((x - cx) / 2.2, y - cy);
      if (d <= 5) px[y * W + x] = d < 1.4 ? 4 : d < 2.6 ? 250 : d < 3.7 ? 251 : 252;
    }
  }
  return buildPatch(px, W, H, { transparent: T, leftOffset: 12, topOffset: 6 });
};

// Impact effect, spawned where a bolt meets its surface. FOUR styles the engine
// randomizes per burst (so they can be compared live), each a 3-frame animation
// (stage 0->1->2), all electric white->blue energy (not fiery debris):
//   ripple   an expanding thin ring          -- a shield taking a hit
//   bloom    a soft disc that swells + fades  -- energy absorbed into the field
//   implode  a ring converging to a point     -- the request drawn inward
//   spark    a spray of dots scattering        -- an electric spatter
// Ripple rides MISL B/C/D, bloom PLSE A/B/C, implode APBX A/B/C, spark BFE1 A/B/C.
const buildFaultBurstFrame = (kind, stage) => {
  const S = 36;
  const T = 247;
  const px = new Uint8Array(S * S).fill(T);
  const c = (S - 1) / 2;
  const set = (x, y, col) => { if (x >= 0 && x < S && y >= 0 && y < S) px[y * S + x] = col; };
  const ringAt = (r, thick, col) => {
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const d = Math.hypot(x - c, y - c);
        if (d >= r - thick && d <= r + thick) set(x, y, col);
      }
    }
  };
  const shade = stage === 0 ? 4 : stage === 1 ? 200 : 194; // white -> blue -> dim blue
  if (kind === "ripple") {
    ringAt(5 + stage * 7, 1.4, shade); // 5,12,19
  } else if (kind === "bloom") {
    const r = 6 + stage * 4; // 6,10,14
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const d = Math.hypot(x - c, y - c);
        if (d <= r) set(x, y, d / r < 0.45 ? (stage === 0 ? 4 : 200) : d / r < 0.78 ? 200 : 194);
      }
    }
  } else if (kind === "implode") {
    ringAt(Math.max(1.5, 18 - stage * 7), 1.4, stage === 2 ? 4 : shade); // 18,11,4 (converging, white at the end)
  } else { // spark
    const r = 5 + stage * 7;
    const n = 10;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + stage * 0.5;
      const rr = r + ((i % 3) - 1) * 2;
      const x = Math.round(c + Math.cos(a) * rr);
      const y = Math.round(c + Math.sin(a) * rr);
      set(x, y, shade);
      set(x + 1, y, shade);
      set(x, y + 1, shade);
    }
  }
  return buildPatch(px, S, S, { transparent: T, leftOffset: Math.round(S / 2), topOffset: Math.round(S / 2) });
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

  // ===== LEFT POD — "the reclaim sluice" (memory saturation). One clear left-to-
  // right story: a demand INFLOW spout pours from a conduit in the SOUTH wall into a
  // big POOL whose floor level is the saturation backlog (546, engine-driven). The
  // pool is calm green and LOW at rest, and FILLS + REDDENS to a glowing-red brim as
  // pressure climbs — capped just below the walkway so it never overflows (blockEdge:
  // overlooked, never waded into). Nothing here moves except the WATER: the outlet is
  // a FIXED stone SILL (547) the pool spills over into the tailwater DRAIN (559) —
  // a WIDE spillway across the pod's whole south-east end, not a slot — and that fixed
  // aperture IS the system's constant reclaim capacity, so a rising level reads as
  // "work arriving faster than the fixed drain can clear it" rather than as something
  // choking the outlet. When the backlog climbs high enough the kernel vents pressure
  // through SWAP: a grated VENT (557) set ABOVE the waterline hisses steam (spawned
  // MT_PUFFs) whenever swap is paging, and is sealed dark when the host has no swap —
  // in which case there is no relief valve at all and the level runs to the OOM brim.
  // Viewed from a back + north + entrance-ledge walkway; terminal on the -u back wall.
  // See [[memory-reclaim-sluice]]. =====
  const SILL_H = -60; //    FIXED outlet lip: the constant the system can drain
  const POOL_REST = -56; // build-time floor; the engine drives 546 (sill -60 .. brim -4)
  const VENT_H = 96; //     vent mouth sits at the head of the stand pipe, well clear of the water
  const SPOUT_H = 16; //    inflow spout sits above the pool and pours down into it
  const sluiceWalk = { ...podStyle, light: 178 };
  // The entrance LEDGE is the one sluice walkway that owns a one-sided wall: the
  // barrier's exposed north END CAP. The barrier band is un-sectored, so its cap is
  // worn by whichever sector abuts it — and that cap is part of the GATE, so it takes
  // the abyss wall rather than the walkway's inherited bookshelf, matching the slot
  // flanks. (Every other ledge edge is a two-sided seam; its `wall` shows nowhere else.)
  // `riserWall` settles what the ledge shows on its UNDERSIDE where it overhangs the
  // outflow pit and the tailwater: abyss masonry, like every other walkway edge that
  // falls away into the void. It has to be stated here rather than inherited, because
  // the neighbour normally names the riser (`other.riserWall` is resolved first) and
  // the pit names the WATERFALL — correct for the drain's lip it was built for, but it
  // would otherwise sheet water down the mouth's north jamb, out from under a walkway
  // with nothing above it to pour.
  const gateLedge = { ...sluiceWalk, wall: abyssWallTexture.texture, riserWall: abyssWallTexture.texture };
  const fluidBase = { ...podStyle, kind: "memory-sluice", floorFlat: "NUKAGE1", blockEdge: true, light: 176 };
  // Pool basin walls are STONE (a cistern), not the library shelves, so the tank
  // reads as a contained pool rather than a flooded bookcase. No riserWall: that
  // keeps the inflow spout's fall (below) winning on the spout->pool drop.
  const poolStyle = { ...fluidBase, floor: POOL_REST, floorFlat: poolFlatNames.calm, wall: "STONE2", tag: memoryTags.pool };
  // Inflow SPOUT: a stone conduit niche in the south wall, its lip above the pool so
  // its drain pours down as a fall (riserWall) into the basin — a constant stream.
  // Ceiling stays room-height so the spout->pool drop has no top texture to scroll.
  const inflowStyle = { ...fluidBase, floor: SPOUT_H, wall: "STONE2", riserWall: fallTexture.texture, light: 168, tag: memoryTags.inflow };
  // SWAP RELIEF VENT: a broad metal DUCT mouth above the waterline (so it never
  // floods). The engine hisses steam from it while swap is paging and darkens it when
  // the host has no swap. Room-height ceiling so the plume rises clear instead of
  // stacking against a lid. Unlabelled — the SWAP plate is its own recess beside it,
  // because a label smaller than its wall tiles into a grid of SWAPs.
  // The vent's STAND PIPE, set back inside a recessed alcove. It carries the swap tag,
  // so the engine spawns the steam at THIS sector's centre — i.e. straight up out of
  // the middle of the pipe's mouth. (While the tag lived on the alcove behind it, the
  // plume appeared to squeeze out from behind the pipe's back edge.) It is a raised
  // block, so what the room sees is its `riserWall`.
  const pipeStyle = { ...podStyle, kind: "memory-sluice", blockEdge: true, floor: VENT_H, floorFlat: "FLOOR7_1", riserWall: pipeTexture.texture, wall: pipeTexture.texture, light: 168, tag: memoryTags.swapTrib };
  // The single SWAP placard: a recess whose face is EXACTLY the plate's 128x128, so
  // the texture fills it once (see swapSignSize on Doom's power-of-two column masking).
  // Set above the waterline, at reading height.
  const SWAP_PLATE_FLOOR = 32;
  const swapPlateStyle = { ...podStyle, kind: "memory-sluice", blockEdge: true, floor: SWAP_PLATE_FLOOR, ceiling: SWAP_PLATE_FLOOR + swapSignSize.height, wall: "METAL1", light: 200, labelSide: localSideToWorld(direction, "bottom"), labelTexture: swapSign.texture, labelWidth: swapSignSize.width };
  // DRAIN SLOTS through the immobile BARRIER. The barrier itself is not a sector at
  // all — the un-sectored band between these slots becomes solid wall — so it is a
  // fixed stone gate the water can never lift. Only these narrow full-height slits let
  // water through, which is WHY the level rises: work arrives faster than this fixed
  // aperture can pass. Room-height ceiling (matching pool and tailwater) is
  // deliberate: a ceiling step here would put a top texture on the same sidedef as the
  // scrolling fall riser, and rowoffset would drag the bookshelves down with the water
  // (see the falls note). `riserWall` gives the drop into each slot its cascade, and
  // `wall` — worn by each slot's two one-sided pier flanks, the only thing you see
  // looking into a gate — is the ABYSS wall, not the inherited bookshelf: a gate cut
  // through a dam is masonry in shadow, the same near-black as every catwalk underside.
  const slotStyle = { ...podStyle, kind: "memory-sluice", wall: abyssWallTexture.texture, floorFlat: poolFlatNames.calm, riserWall: fallTexture.texture, blockEdge: true, floor: SILL_H, light: 150, tag: memoryTags.drainSlots };
  // TAILWATER drain below the weir: the pool's outflow collects here, so the engine
  // paints it the SAME colour as the pool. Its well-facing edge keeps the dark abyss
  // wall (the void's riserWall wins), so no green leaks outside the pod.
  const drainStyle = { ...fluidBase, floor: -88, floorFlat: poolFlatNames.calm, wall: "STONE2", light: 150, tag: memoryTags.drain };
  // OUTFLOW PIT: the lip the tailwater pours over. A dedicated ABYSS cell carved off
  // the drain's well-facing edge, so what the well sees under the pod's mouth is a
  // ~1960-unit cascade falling all the way to the bottom of the shaft, not a dead
  // black wall. Two things make it a separate sector rather than a fall texture on the
  // pod mouth itself:
  //   1. DoomPerf_UpdateMemoryFalls walks the rowoffset of every sidedef whose BOTTOM
  //      texture is DPMFALL, and a rowoffset drags that sidedef's TOP with it. So the
  //      falling face must sit on a sidedef with NO top texture — i.e. between two
  //      sectors that share a ceiling. The pit takes the pod's ROOM_CEIL, so its seam
  //      with the drain (and with the ledge above) is ceiling-flush and scrolls clean.
  //   2. That parks the mouth's ceiling step on the pit/void seam instead, where the
  //      floors are both ABYSS and there is no bottom texture to scroll — so the
  //      shaft's bookshelf lintel above the opening still renders, and stays put.
  // Its floor is the abyss itself, so the drop is bottomless; `light` matches the
  // tailwater it spills from rather than the void's gloom, or the fall reads as unlit.
  const LIP_D = 32; // pit depth: how far back from the shaft wall the lip sits
  const pitStyle = { ...voidStyle, wall: abyssWallTexture.texture, ceiling: ROOM_CEIL, light: 150, riserWall: fallTexture.texture };

  // Walkways (floor 0). The entrance ledge starts exactly at the catwalk's south edge
  // (SC - CWH) so that arriving down the catwalk there is nothing to step onto on the
  // LEFT — that side is the spillway — and the only way on is to turn right (north)
  // toward the terminal.
  const OUTLET_V = SC - CWH; // spillway occupies everything south of the entrance
  const POOL_U1 = LEFT.u1 + SLUICE_WALK; // pool's back (west) edge; the south-wall fittings hang off it
  areaRect(direction, "sluice-back", { u1: LEFT.u1, v1: LEFT.v1, u2: POOL_U1, v2: LEFT.v2 }, sluiceWalk);
  areaRect(direction, "sluice-north", { u1: POOL_U1, v1: SC + CWH, u2: LEFT.u2, v2: LEFT.v2 }, sluiceWalk);
  areaRect(direction, "sluice-ledge", { u1: LEFT.u2 - 96, v1: OUTLET_V, u2: LEFT.u2, v2: SC + CWH }, gateLedge);
  // The POOL basin (overlooked from back / north / ledge), one clean rect — the pipe
  // now lives in its own alcove rather than standing out in the middle of the water.
  areaRect(direction, "sluice-pool", { u1: POOL_U1, v1: LEFT.v1, u2: LEFT.u2 - 96, v2: SC + CWH }, poolStyle);
  // South wall, west to east across the pool's 352-unit face: the SWAP duct, its
  // placard, then the (now broad) inflow spout — spaced so none of them touch.
  // The VENT ALCOVE: a deep bay cut back into the south wall that the stand pipe sits
  // inside, so the pipe reads as set into the wall rather than planted in the open
  // water. The bay floor is part of the basin (same pool tag + style), so water fills
  // it and rises with the rest; the pipe is a raised island in the middle of it,
  // leaving a margin of water on all four sides.
  const BAY_U1 = POOL_U1 + 8;
  const BAY_U2 = POOL_U1 + 104;
  const BAY_V1 = LEFT.v1 - 96; // 96 deep into the wall
  const PIPE_U1 = POOL_U1 + 24;
  const PIPE_U2 = POOL_U1 + 88;
  const PIPE_V1 = BAY_V1 + 16;
  const PIPE_V2 = PIPE_V1 + 64;
  areaRect(direction, "sluice-bay-back", { u1: BAY_U1, v1: BAY_V1, u2: BAY_U2, v2: PIPE_V1 }, poolStyle);
  areaRect(direction, "sluice-bay-w", { u1: BAY_U1, v1: PIPE_V1, u2: PIPE_U1, v2: PIPE_V2 }, poolStyle);
  areaRect(direction, "sluice-bay-e", { u1: PIPE_U2, v1: PIPE_V1, u2: BAY_U2, v2: PIPE_V2 }, poolStyle);
  areaRect(direction, "sluice-bay-front", { u1: BAY_U1, v1: PIPE_V2, u2: BAY_U2, v2: LEFT.v1 }, poolStyle);
  areaRect(direction, "sluice-pipe", { u1: PIPE_U1, v1: PIPE_V1, u2: PIPE_U2, v2: PIPE_V2 }, pipeStyle);
  areaRect(direction, "sluice-swap-plate", { u1: POOL_U1 + 120, v1: LEFT.v1 - 24, u2: POOL_U1 + 120 + swapSignSize.width, v2: LEFT.v1 }, swapPlateStyle);
  areaRect(direction, "sluice-inflow", { u1: POOL_U1 + 264, v1: LEFT.v1 - 32, u2: POOL_U1 + 344, v2: LEFT.v1 }, inflowStyle);
  // The immobile BARRIER across the outlet, pierced by four narrow drain slots. Only
  // the slots are sectors; the band between them is left un-sectored and so renders as
  // solid stone wall. The tailwater beyond collects whatever gets through.
  const BARRIER_U1 = LEFT.u2 - 96; // pool-side face of the barrier
  const BARRIER_U2 = LEFT.u2 - 68; // tailwater-side face (28 thick)
  const SLOT_W = 14; // narrow: the barrier must read as mostly WALL, or it stops
  const SLOT_COUNT = 4; // explaining why the water backs up behind it
  // Even distribution: N slots separated (and bookended) by N+1 equal piers of wall.
  const slotPier = Math.round((OUTLET_V - LEFT.v1 - SLOT_COUNT * SLOT_W) / (SLOT_COUNT + 1));
  for (let s = 0; s < SLOT_COUNT; s += 1) {
    const v1 = LEFT.v1 + slotPier * (s + 1) + SLOT_W * s;
    areaRect(direction, `sluice-slot-${s}`, { u1: BARRIER_U1, v1, u2: BARRIER_U2, v2: v1 + SLOT_W }, slotStyle);
  }
  areaRect(direction, "sluice-drain", { u1: BARRIER_U2, v1: LEFT.v1, u2: LEFT.u2 - LIP_D, v2: OUTLET_V }, drainStyle);
  areaRect(direction, "sluice-pit", { u1: LEFT.u2 - LIP_D, v1: LEFT.v1, u2: LEFT.u2, v2: OUTLET_V }, pitStyle);
  terminalRecess("swap", { u1: LEFT.u1 - REC, v1: SC - TERM_HALF, u2: LEFT.u1, v2: SC + TERM_HALF }, memoryScreens.swap, "left");

  // ===== RIGHT POD — "the fault gallery" (page faults). A run-queue-style T: a
  // raised OVERLOOK the player enters and walks (sar/PSI terminal on its +v end
  // wall), beside a sunken firing TRENCH running left-right along v. The engine
  // (DoomPerf_FaultVolley) fires beam-bolts from the -v emitter: MINOR faults burst
  // at the RAM GATE mid-trench (flanked by posts; the RAM-side floor flashes), MAJOR
  // faults break through to strike the far DISK WALL at +v (the disk-side floor
  // flares), each then returning. Watched side-on from the overlook, so a minor's
  // short hop vs a major's full crossing reads as motion + distance. See the FR
  // constants + [[fault-range-volley-plan]]. =====
  const overlook = { ...podStyle, light: 176 }; // raised viewing platform (floor 0)
  // Both trench halves carry `fieldTexture`, so ONLY their shared seam (the RAM gate)
  // becomes the see-through forcefield the bolts phase through.
  const trenchRam = { ...podStyle, kind: "fault-trench", blockEdge: true, fieldTexture: forcefieldTexture.texture, floor: FR.floor, floorFlat: "FLOOR5_1", light: 176, tag: memoryTags.nearGlow };
  const trenchDisk = { ...trenchRam, floorFlat: "FLOOR5_2", wall: cardCatalogTexture.texture, light: 138, tag: memoryTags.farGlow };
  areaRect(direction, "fault-overlook", { u1: FR.u0, v1: FR.v0, u2: FR.uRail, v2: FR.v1 }, overlook);
  // sar/PSI terminal recessed into the overlook's +v end wall (walk-up, faces -v).
  terminalRecess("faults", { u1: FR_TERM_U - TERM_HALF, v1: FR.v1, u2: FR_TERM_U + TERM_HALF, v2: FR.v1 + REC }, memoryScreens.faults, "top");
  addAreaThing(direction, 2028, FR.u0 + 40, SC - 96); // reading lamps flanking the entrance threshold
  addAreaThing(direction, 2028, FR.u0 + 40, SC + 96);
  // Sunken firing trench, split at the RAM gate (blockEdge holds the player on the
  // overlook; the -48 drop would soft-lock otherwise). Bolts fly at its u-centre.
  areaRect(direction, "fault-trench-ram", { u1: FR.uRail, v1: FR.v0, u2: FR.uBack, v2: FR.vGate }, trenchRam);
  areaRect(direction, "fault-trench-disk", { u1: FR.uRail, v1: FR.vGate, u2: FR.uBack, v2: FR.v1 }, trenchDisk);
  addAreaThing(direction, 2028, FR.uRail + 24, FR.vGate); // RAM gate posts flanking the lane; bolts pass between
  addAreaThing(direction, 2028, FR.uBack - 24, FR.vGate);
  // MINOR / MAJOR wall signs, recessed into the far backdrop facing the player
  // (labelSide "right" = the +u far wall). Raised to eye level above the trench floor.
  const signRecess = (id, sign) =>
    areaRect(direction, id, { u1: FR.uBack, v1: sign.vc - wallSignSize.width / 2, u2: FR.uBack + REC, v2: sign.vc + wallSignSize.width / 2 }, {
      ...podStyle,
      kind: "fault-sign",
      wall: "METAL1",
      floor: 0,
      ceiling: wallSignSize.height,
      light: 208,
      labelSide: localSideToWorld(direction, "right"),
      labelTexture: sign.texture,
    });
  signRecess("fault-sign-minor", faultSigns.minor);
  signRecess("fault-sign-major", faultSigns.major);
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
  ...fallTempers.map((temper) => ({
    texture: temper.texture,
    patch: temper.patch,
    width: temper.width,
    height: temper.height,
    build: () => buildFallPatch(temper.ramp),
  })),
  {
    texture: swapSign.texture,
    patch: swapSign.patch,
    width: swapSignSize.width,
    height: swapSignSize.height,
    build: buildSwapSignPatch,
  },
  {
    texture: pipeTexture.texture,
    patch: pipeTexture.patch,
    width: pipeTexture.width,
    height: pipeTexture.height,
    build: buildPipePatch,
  },
  {
    texture: rackTexture.texture,
    patch: rackTexture.patch,
    width: rackTexture.width,
    height: rackTexture.height,
    build: buildRackPatch,
  },
  {
    texture: forcefieldTexture.texture,
    patch: forcefieldTexture.patch,
    width: forcefieldTexture.width,
    height: forcefieldTexture.height,
    build: buildForcefieldPatch,
  },
  {
    texture: cardCatalogTexture.texture,
    patch: cardCatalogTexture.patch,
    width: cardCatalogTexture.width,
    height: cardCatalogTexture.height,
    build: buildCardCatalogPatch,
  },
  ...Object.values(faultSigns).map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSignPatch(s.text),
  })),
];

const flats = [...pageFlats, ...poolFlats, buildBarrelPadFlat()];

// Memory is the EAST wing (local u,v -> world (v,-u)); the shared terminalSegment
// helper assumes north=identity, so each screen face is emitted in WORLD coords
// here. Each face is a recess's one-sided far wall, running TERM_HALF either side
// of its centre along the local screen axis.
const terminals = () => {
  // A screen face is either a ±u wall ({u, v1, v2}, fixed u spanning v) or a ±v wall
  // ({v, u1, u2}, fixed v spanning u); emit its two world endpoints either way.
  const seg = (localA, localB) => {
    const [ax, ay] = rotatePoint(localA, "east");
    const [bx, by] = rotatePoint(localB, "east");
    return { ax, ay, bx, by };
  };
  return Object.entries(screenFaces).map(([sign, face]) => ({
    sign,
    segments: [
      face.v !== undefined
        ? seg([face.u1, face.v], [face.u2, face.v])
        : seg([face.u, face.v1], [face.u, face.v2]),
    ],
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
  // Page-fault sprites (fault range). Bolt looks: ORB on MISL A (unseen placeholder),
  // ARC on PLSS A/B (major), STREAK on BFS1 A (minor). Impact effects (randomized):
  // ripple MISL B/C/D, bloom PLSE A/B/C, implode APBX A/B/C, spark BFE1 A/B/C.
  { name: "MISLA0", build: buildFaultOrbSprite },
  { name: "MISLB0", build: () => buildFaultBurstFrame("ripple", 0) },
  { name: "MISLC0", build: () => buildFaultBurstFrame("ripple", 1) },
  { name: "MISLD0", build: () => buildFaultBurstFrame("ripple", 2) },
  { name: "PLSSA0", build: () => buildFaultArcSprite(0) },
  { name: "PLSSB0", build: () => buildFaultArcSprite(1) },
  { name: "BFS1A0", build: buildFaultStreakSprite },
  { name: "PLSEA0", build: () => buildFaultBurstFrame("bloom", 0) },
  { name: "PLSEB0", build: () => buildFaultBurstFrame("bloom", 1) },
  { name: "PLSEC0", build: () => buildFaultBurstFrame("bloom", 2) },
  { name: "APBXA0", build: () => buildFaultBurstFrame("implode", 0) },
  { name: "APBXB0", build: () => buildFaultBurstFrame("implode", 1) },
  { name: "APBXC0", build: () => buildFaultBurstFrame("implode", 2) },
  { name: "BFE1A0", build: () => buildFaultBurstFrame("spark", 0) },
  { name: "BFE1B0", build: () => buildFaultBurstFrame("spark", 1) },
  { name: "BFE1C0", build: () => buildFaultBurstFrame("spark", 2) },
  // Swap-vent steam: MT_PUFF's own four frames, so the vent reuses vanilla's
  // self-animating, self-despawning puff instead of a bespoke mobj type.
  { name: "PUFFA0", build: () => buildSteamPuffFrame(0) },
  { name: "PUFFB0", build: () => buildSteamPuffFrame(1) },
  { name: "PUFFC0", build: () => buildSteamPuffFrame(2) },
  { name: "PUFFD0", build: () => buildSteamPuffFrame(3) },
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
