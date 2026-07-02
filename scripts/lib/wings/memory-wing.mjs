// Memory wing (east): a T-junction. A short library stem off the hub door opens
// into a crossbar whose back wall carries the `free -m` terminal (seen head-on
// on entry), then the player turns into one of two perpendicular hallway arms:
// the NORTH arm is ACTIVE memory (the sunken working-set page grid, RSS, PSI
// pressure pads), the SOUTH arm is RECLAIM/overflow (page-cache reservoir, swap
// nukage channels, a dark OOM sanctum). The T means no long grazing hall ever
// faces the player on entry — the topology, not a wall patch, is what resolves
// the old wide-open-hall smear, and it reads distinct from the network wing's
// straight-in corridor and the disk wing's spiral tower. Page-cell/cache/swap/
// PSI/OOM sector tags still drive the live instruments from the engine hook.
import { addWingEntrance } from "./common.mjs";
import { reserved, wingName } from "./registry.mjs";
import {
  terminalTextureSize,
  buildTerminalPatch,
  drawCenteredText,
  signTextColor,
} from "../textures.mjs";
import { lump, buildPatch } from "../wad-bytes.mjs";

const localSideToWorld = (direction, side) => {
  const turns = {
    north: 0,
    east: 1,
    south: 2,
    west: 3,
  }[direction];
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

// Shared screen/sign face lines (local u,v) so build() and terminals() agree on
// where each read-point sits. Local v -> world x, local u -> world -y (east
// rotation). free -m is on the junction back wall; the four arm signs are on the
// near walls / far ends of the two arms.
const mem = {
  termFaceV: 1200,                          // free -m screen wall (junction back)
  rss: { v: 1616, u1: -736, u2: -576 },     // RSS screen, reliquary deep wall (west of the baron gate)
  oom: { v: 1616, u1: -320, u2: -160 },     // OOM screen, reliquary deep wall (east of the baron gate)
  swap: { v: 912, u1: 416, u2: 608 },       // swap screen, south arm near wall
  faults: { v: 912, u1: 160, u2: 352 },     // page-fault screen, south arm near wall
};

// Every read-point is a proper terminal — a simulated computer screen (blurred
// streaming logs) with the "server details" control-panel strip on the riser
// below, exactly like the CPU wing. buildTerminalPatch seeds its per-screen
// gibberish from `lines` (the lines are not shown verbatim), so each terminal
// looks distinct. The USE proof for each is in the terminal overlay you open
// (free -m / ps / vmstat / sar), not painted on the wall.
const memoryTerminal = {
  lines: ["MEMORY", "FREE -M"],
  texture: wingName("memory", "TERM"),
  patch: wingName("memory", "PTRM"),
};
const memoryScreens = {
  rss: { lines: ["RESIDENT SET", "PS SORT RSS"], texture: wingName("memory", "RTRM"), patch: wingName("memory", "PRTR") },
  oom: { lines: ["OOM KILLER", "VMSTAT DMESG"], texture: wingName("memory", "OTRM"), patch: wingName("memory", "POTR") },
  swap: { lines: ["SWAP IO", "VMSTAT SI SO"], texture: wingName("memory", "STRM"), patch: wingName("memory", "PSTR") },
  faults: { lines: ["PAGE FAULTS", "SAR -B PSI"], texture: wingName("memory", "FTRM"), patch: wingName("memory", "PFTR") },
};

// Names the whole central element at the highest level of abstraction: the
// shelf is all of physical RAM. makeInscription's "east" orientation renders
// mirrored when the cells are laid laterally across this threshold (the east
// wing maps local u -> world -y), so instead we paint the desired upright
// on-screen image and invert Doom's floor sampling, flat[((-y)&63)*64 + (x&63)],
// to bake each cell. Cells sit at v[832,896] (world x in [832,896)); cell p is
// placed at u1=-96+p*64 and covers world y in [labelCells*32-64-p*64, ...).
const labelCells = 3;
const buildMemoryLabel = (prefix, text) => {
  const screenW = labelCells * 64;
  const screenH = 64;
  const screen = new Uint8Array(screenW * screenH);
  const scale = 2;
  // row 0 = far (the inscription top points away from the entering player).
  drawCenteredText(screen, screenW, screenH, text, Math.floor((screenH - 7 * scale) / 2), scale, signTextColor, 4, screenW - 4);
  const names = [];
  const flats = [];
  for (let p = 0; p < labelCells; p += 1) {
    const cell = new Uint8Array(64 * 64);
    const yLo = labelCells * 32 - 64 - p * 64; // world-y start of cell p
    for (let x = 832; x < 896; x += 1) {
      for (let y = yLo; y < yLo + 64; y += 1) {
        const screenRow = 895 - x; // far -> near
        const screenCol = labelCells * 32 - 1 - y; // +y (left) -> -y (right)
        if (screenRow < 0 || screenRow >= screenH || screenCol < 0 || screenCol >= screenW) continue;
        cell[((-y) & 63) * 64 + (x & 63)] = screen[screenRow * screenW + screenCol];
      }
    }
    const name = `${prefix}${p}`;
    flats.push(lump(name, Buffer.from(cell)));
    names.push(name);
  }
  return { names, flats };
};
const memoryInscription = buildMemoryLabel(wingName("memory", "FM"), "TOTAL MEMORY");
const pageFlatNames = {
  used: wingName("memory", "USED"),
  cache: wingName("memory", "CACH"),
  free: wingName("memory", "FREE"),
};

// Library shelf flats: the TOP face of each page slot. An occupied slot is a
// book cover seen from above (solid cover, dark board edge, spine band, light
// title plaque); an empty slot is a dark parquet recess. The engine (p_tick.c)
// swaps a cell's floorpic among these three by name as the live `free -m`
// composition changes, so cover colour = memory composition: working-set books
// (DPMUSED) are green, reclaimable page-cache books (DPMCACH) are cyan, and a
// freed slot (DPMFREE) is an empty recess.
const flatRect = (pixels, size, x1, y1, x2, y2, color) => {
  for (let y = Math.max(0, y1); y < Math.min(size, y2); y += 1) {
    for (let x = Math.max(0, x1); x < Math.min(size, x2); x += 1) {
      pixels[y * size + x] = color;
    }
  }
};

const buildBookFlat = ({ name, cover, light, dark }) => {
  const size = 64;
  const pixels = new Uint8Array(size * size).fill(cover);
  const rect = (x1, y1, x2, y2, color) => flatRect(pixels, size, x1, y1, x2, y2, color);
  // Board edge around the cover, with a top highlight and bottom shadow so the
  // cover reads as a raised volume rather than a flat tile.
  rect(0, 0, size, 3, dark);
  rect(0, size - 3, size, size, dark);
  rect(0, 0, 3, size, dark);
  rect(size - 3, 0, size, size, dark);
  rect(3, 3, size - 3, 6, light);
  rect(3, size - 6, size - 3, size - 3, dark);
  // Spine band down the left with a bright rule.
  rect(6, 8, 16, size - 8, dark);
  rect(10, 8, 12, size - 8, light);
  // Title plaque with a few engraved lines.
  rect(24, 20, size - 10, 44, light);
  rect(27, 26, size - 16, 28, dark);
  rect(27, 32, size - 20, 34, dark);
  rect(27, 38, size - 14, 40, dark);
  return lump(name, Buffer.from(pixels));
};

const buildSlotFlat = (name) => {
  const size = 64;
  const pixels = new Uint8Array(size * size).fill(8); // dark shelf bottom
  const rect = (x1, y1, x2, y2, color) => flatRect(pixels, size, x1, y1, x2, y2, color);
  // Lit top/left rim, dark bottom/right rim, and a recessed inner well so an
  // empty slot reads as a gap on the shelf, not another (dark) book.
  rect(0, 0, size, 2, 96);
  rect(0, 0, 2, size, 96);
  rect(0, size - 2, size, size, 0);
  rect(size - 2, 0, size, size, 0);
  rect(6, 6, size - 6, size - 6, 0);
  for (let y = 12; y < size - 8; y += 12) {
    rect(8, y, size - 8, y + 1, 96);
  }
  return lump(name, Buffer.from(pixels));
};

const pageFlats = [
  buildBookFlat({ name: pageFlatNames.used, cover: 114, light: 112, dark: 8 }), // working set (green)
  buildBookFlat({ name: pageFlatNames.cache, cover: 202, light: 200, dark: 8 }), // page cache (cyan)
  buildSlotFlat(pageFlatNames.free), // freed/empty slot
];

// Pad a reliquary barrel stands on: a dark steel plate with a bevelled rim and
// an amber hazard frame around the barrel's footprint, so the row reads as a
// line of marked plinths even before the engine's per-pad glow kicks in. The
// glow itself is the sector light (driven by p_tick.c), not baked into the flat.
const barrelPadFlatName = wingName("memory", "BPAD");
const buildBarrelPadFlat = () => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(7); // dark steel base
  const rect = (x1, y1, x2, y2, color) => flatRect(px, size, x1, y1, x2, y2, color);
  rect(0, 0, size, 3, 96); // lit top rim
  rect(0, 0, 3, size, 96); // lit left rim
  rect(0, size - 3, size, size, 0); // shadow bottom rim
  rect(size - 3, 0, size, size, 0); // shadow right rim
  rect(12, 12, size - 12, size - 12, 5); // inner plate
  // Amber hazard frame around the barrel footprint.
  rect(12, 12, size - 12, 14, 215);
  rect(12, size - 14, size - 12, size - 12, 215);
  rect(12, 12, 14, size - 12, 215);
  rect(size - 14, 12, size - 12, size - 12, 215);
  return lump(barrelPadFlatName, Buffer.from(px));
};

// Oversized RSS-reliquary barrel sprite, replacing the small IWAD BAR1 so the
// resident-set barrels read boldly across the opened-up plaza. Procedural (no IWAD
// read): a ~40x56 steel cylinder shaded bright-centre -> dark-edge, banded with
// dark hoops and one amber hazard stripe, on a dark lid. Reuses the IWAD sprite
// name BAR1 (frames A0/B0 both exist), so it overrides by name like the orb
// sprites — see [[pwad-sprite-override-constraint]]. leftOffset centres it and
// topOffset = height sits it on the floor.
const buildBarrelSprite = () => {
  const width = 40;
  const height = 56;
  const TRANSPARENT = 247;
  const px = new Uint8Array(width * height).fill(TRANSPARENT);
  const cx = 20;
  const bodyHalf = 17;
  // Column half-width by row: a domed lid tapering into the straight body.
  const halfAt = (y) => {
    if (y < 4) return 0;
    if (y < 9) return 11 + (y - 4);       // lid widening 11..16
    if (y >= 52) return bodyHalf - 2;     // slight foot taper
    return bodyHalf;
  };
  for (let y = 3; y < 54; y += 1) {
    const hw = halfAt(y);
    for (let dx = -hw; dx <= hw; dx += 1) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      const f = hw > 0 ? Math.abs(dx) / hw : 0;
      let c = f < 0.35 ? 96 : f < 0.72 ? 7 : 5; // cylinder shade
      if (y < 9) c = f < 0.5 ? 8 : 5;           // dark lid
      px[y * width + x] = c;
    }
  }
  const band = (y, c) => {
    for (let dx = -bodyHalf; dx <= bodyHalf; dx += 1) {
      const x = cx + dx;
      if (x >= 0 && x < width && y >= 0 && y < height) px[y * width + x] = c;
    }
  };
  band(9, 8);            // rim under the lid
  band(53, 0);           // foot shadow
  [18, 32, 46].forEach((hy) => { band(hy, 8); band(hy + 1, 5); }); // hoops
  band(25, 215);         // amber hazard stripe
  return buildPatch(px, width, height, { leftOffset: cx, topOffset: height, transparent: TRANSPARENT });
};

// Bookshelf wall texture for the reading hall. Decor stays neutral per the lab's
// palette discipline (bright green/cyan is reserved for the metric books), so the
// spines use muted warm/grey tones. 64x128 tiles along the hall walls; the three
// shelves carry books of varied widths/heights so it does not read as a grid.
const bookshelfTexture = {
  texture: wingName("memory", "SHLF"),
  patch: wingName("memory", "PSHLF"),
  width: 64,
  height: 128,
};

const buildBookshelfPatch = () => {
  const W = bookshelfTexture.width;
  const H = bookshelfTexture.height;
  // Doom Perf: cabinet interior is a dark *wood* tone (78) rather than near-black
  // (8). Roughly half the texture is interior/gap, so when 320x200 undersampling
  // averages the whole wall at distance the result lands on a readable warm
  // brown instead of the black mud the near-black fill produced. The per-spine
  // shadows (idx 0) still give crisp contrast up close.
  const px = new Uint8Array(W * H).fill(78); // dark wood cabinet interior
  const rect = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) {
        px[yy * W + xx] = c;
      }
    }
  };
  rect(0, 0, 2, H, 96); // cabinet uprights
  rect(W - 2, 0, 2, H, 96);
  // Doom Perf: a wider, more varied set of muted spine tones (light grey, brown,
  // ochre, deep red, pale beige, dark grey, orange, muted red, tan, olive) in
  // place of the old 5-value warm set that leaned on the two most-saturated
  // primaries (pure red 176 / pure yellow 231). Adjacent entries deliberately
  // alternate light/dark luminance so neighbouring spines stay distinguishable
  // under 320x200 undersampling — the shelf keeps structure at distance instead
  // of averaging into one smeared band. Bright green/cyan stay reserved for the
  // metric books.
  const spineColors = [88, 71, 163, 36, 128, 102, 215, 30, 64, 154];
  [6, 46, 86].forEach((sy, shelf) => {
    const boardY = sy + 32;
    let x = 4;
    let i = 0;
    while (x < W - 5) {
      // Doom Perf: wider spines (8..12 px vs the old 5..8) lower the texture's
      // spatial frequency, so the shelf survives 320x200 undersampling at
      // distance instead of smearing into an undifferentiated band.
      const bw = 8 + ((i * 3 + shelf) % 5); // 8..12 px spines
      const bh = 22 + ((i * 5 + shelf * 3) % 9); // varied heights
      const c = spineColors[(i + shelf) % spineColors.length];
      rect(x, boardY - bh, bw, bh, c);
      rect(x, boardY - bh, 1, bh, 0); // left shadow
      rect(x + bw - 1, boardY - bh, 1, bh, 0); // right shadow
      rect(x + 1, boardY - bh + 2, bw - 2, 1, 8); // title band
      x += bw + 1;
      i += 1;
    }
    rect(2, boardY, W - 4, 4, 96); // shelf board
    rect(2, boardY + 4, W - 4, 1, 0); // shadow under board
  });
  return buildPatch(px, W, H);
};

const tagBase = reserved.memory.sectorTags[0];
const pageCellTag = (index) => tagBase + index;
// One tag per independent instrument, matching DoomPerf_UpdateMemoryWing /
// DoomPerf_UpdateOomBaron in p_tick.c: swap-in/out channels (Station B), the
// minor/major page-fault meters (Station C), and the OOM-killer Baron's pen
// (Station D). 545 (old page-cache reservoir) and PSI 549/550 are retired; the
// fault meters reuse 549/550.
const memoryTags = {
  swapIn: tagBase + 46,
  swapOut: tagBase + 47,
  oomPen: tagBase + 48,
  minFlt: tagBase + 49,
  majFlt: tagBase + 50,
  gate: tagBase + 56, // baron-dais gate (drops open on an OOM kill)
};
// RSS "reliquary" barrels: the top processes from `ps --sort=-rss`, one barrel
// per pad, each pad an independently-lit sector so the engine can glow a barrel
// brighter the closer its process is to an OOM kill (p_tick.c, by tag). Tags
// 551..555 sit inside the memory wing's reserved [500,559] block.
const barrelTag = (index) => tagBase + 51 + index;

const build = (ctx) => {
  const {
    areaRect,
    addAreaThing,
    direction,
    base,
    accent,
    terminalPanelDepth,
    terminalPanelFloor,
  } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top");

  const memoryBase = {
    ...base,
    wall: bookshelfTexture.texture,
    floorFlat: "FLOOR0_1",
    ceilingFlat: "CEIL5_1",
    ceiling: 192,
  };
  const bankWall = {
    ...accent,
    wall: bookshelfTexture.texture,
    floorFlat: "FLOOR5_2",
    ceilingFlat: "CEIL5_1",
    ceiling: 192,
  };
  const walkway = { ...memoryBase, kind: "memory-walk", light: 184 };
  // Doom Perf: the left/cache flank reads as the smear partly because it was the
  // dimmest walkway (168) — Doom's light diminishing crushes a dark, high-
  // frequency bookshelf wall toward black at distance. Lift it to 178 (still
  // below the lit walk at 184) so the texture survives the falloff.
  const dimWalkway = { ...walkway, light: 178 };
  const bankCell = {
    ...bankWall,
    kind: "memory-page-cell",
    floorFlat: "FLOOR5_3",
    ceiling: 200,
  };

  // ===== Entry stem: a short library throat off the hub door, carrying the
  // three-cell "TOTAL MEMORY" floor inscription. It is deliberately short and
  // ends on the junction, so the player never looks down a long hall on entry.
  areaRect(direction, "stem-front", { u1: -112, v1: 704, u2: 112, v2: 832 }, {
    ...memoryBase,
    kind: "memory-stem",
    light: 200,
  });
  areaRect(direction, "stem-insc-left", { u1: -112, v1: 832, u2: -96, v2: 896 }, {
    ...memoryBase,
    kind: "memory-stem",
    light: 200,
  });
  memoryInscription.names.forEach((flatName, k) => {
    // Forward placement: buildMemoryLabel bakes cell k for world y in this slot.
    const u1 = -96 + k * 64;
    areaRect(direction, `memory-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: 896 }, {
      ...memoryBase,
      kind: "memory-stem",
      floorFlat: flatName,
      light: 208,
    });
  });
  areaRect(direction, "stem-insc-right", { u1: 96, v1: 832, u2: 112, v2: 896 }, {
    ...memoryBase,
    kind: "memory-stem",
    light: 200,
  });
  areaRect(direction, "stem-back", { u1: -112, v1: 896, u2: 112, v2: 944 }, {
    ...memoryBase,
    kind: "memory-stem",
    light: 200,
  });

  // ===== Junction: the T crossing. The `free -m` screen sits dead ahead on the
  // back wall (seen head-on as the player enters); the two arms branch left
  // (north) and right (south) so no long grazing hall is ever in front of you.
  areaRect(direction, "junction-walk", { u1: -128, v1: 944, u2: 128, v2: mem.termFaceV - terminalPanelDepth }, {
    ...walkway,
    kind: "memory-junction",
    light: 192,
  });
  areaRect(direction, "junction-term", { u1: -128, v1: mem.termFaceV - terminalPanelDepth, u2: 128, v2: mem.termFaceV }, {
    ...walkway,
    kind: "terminal",
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    labelSide: backWall,
    labelTexture: memoryTerminal.texture,
    controlPanel: true,
  });
  // Reading lamps flanking the junction mouth.
  addAreaThing(direction, 2028, -112, 968);
  addAreaThing(direction, 2028, 112, 968);

  // ===== NORTH arm — RESIDENT SETS + OOM (Stations A + D). The near band is the
  // walkway; the sunken 9x5 page grid (Station A, read at the junction free -m
  // screen) fills the east half. A west-side walkway leads DEEP past the grid into
  // a broad RSS RELIQUARY PLAZA: the five barrels (top-RSS processes, tags
  // 551..555) stand on a 128-pitch row with open floor front and back, so the
  // player can weave between and circle them. At the far deep end the OOM-killer
  // BARON waits on a raised, gated DAIS: a set-apart sanctum flanked by columns
  // and framed by the RSS + OOM screens. On an OOM kill the gate drops and the
  // baron walks out to detonate the victim barrel (DoomPerf_UpdateOomBaron). =====
  areaRect(direction, "n-walk", { u1: -768, v1: 944, u2: -128, v2: 1024 }, { ...walkway, kind: "memory-walk" });
  // West-side walkway running alongside the page grid to the deep plaza.
  areaRect(direction, "n-west-walk", { u1: -768, v1: 1024, u2: -704, v2: 1344 }, { ...walkway, kind: "memory-walk", light: 182 });

  // Open plaza floor in front of and behind a 128-pitch barrel row (64u gaps, so
  // the player weaves between the barrels), opened up deep past the grid.
  areaRect(direction, "plaza-front", { u1: -768, v1: 1344, u2: -128, v2: 1408 }, { ...walkway, kind: "memory-walk", light: 182 });
  areaRect(direction, "plaza-back", { u1: -768, v1: 1472, u2: -128, v2: 1600 }, { ...walkway, kind: "memory-walk", light: 178 });
  const padU = [-704, -576, -448, -320, -192]; // 64-wide pads on a 128 pitch
  areaRect(direction, "plaza-row-lead", { u1: -768, v1: 1408, u2: -704, v2: 1472 }, { ...walkway, kind: "memory-walk", light: 182 });
  padU.forEach((u1, slot) => {
    areaRect(direction, `rss-barrel-pad-${slot}`, { u1, v1: 1408, u2: u1 + 64, v2: 1472 }, {
      ...dimWalkway,
      kind: "memory-walk",
      floorFlat: barrelPadFlatName,
      light: 176,
      tag: barrelTag(slot),
    });
    addAreaThing(direction, 2035, u1 + 32, 1440); // explosive barrel = a heavy process
    if (slot < padU.length - 1) {
      areaRect(direction, `plaza-row-gap-${slot}`, { u1: u1 + 64, v1: 1408, u2: padU[slot + 1], v2: 1472 }, { ...walkway, kind: "memory-walk", light: 182 });
    }
  });

  // RSS + OOM screens flank the baron gate on the plaza's deep (far) wall, read
  // across the barrel row.
  areaRect(direction, "rss-term-recess", { u1: mem.rss.u1, v1: 1600, u2: mem.rss.u2, v2: mem.rss.v }, {
    ...bankWall,
    kind: "terminal",
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    light: 184,
    labelSide: backWall,
    labelTexture: memoryScreens.rss.texture,
    controlPanel: true,
  });
  areaRect(direction, "oom-term-recess", { u1: mem.oom.u1, v1: 1600, u2: mem.oom.u2, v2: mem.oom.v }, {
    ...bankWall,
    kind: "terminal",
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    light: 150,
    labelSide: backWall,
    labelTexture: memoryScreens.oom.texture,
    controlPanel: true,
  });

  // OOM-killer BARON's gate + dais close the plaza's deep end (u[-576,-320]). The
  // GATE is a waist-high sill (tag 556) the engine holds up (closed) at rest, so
  // the dormant baron reads as caged behind a railing, and drops (open) during a
  // kill so the baron walks out (DoomPerf_UpdateOomBaron).
  areaRect(direction, "oom-gate", { u1: -576, v1: 1600, u2: -320, v2: 1632 }, {
    ...bankWall,
    kind: "memory-oom-gate",
    floor: 64,
    floorFlat: "FLOOR5_2",
    light: 150,
    tag: memoryTags.gate,
  });
  // Raised DAIS: distinct flat + engine-driven glow (tag 548), lifted so the
  // baron is visible over the gate and across the plaza.
  areaRect(direction, "oom-dais", { u1: -576, v1: 1632, u2: -320, v2: 1776 }, {
    ...bankWall,
    kind: "memory-oom-pen",
    floor: 40,
    floorFlat: "FLOOR5_2",
    ceiling: 208,
    light: 120,
    tag: memoryTags.oomPen,
  });
  addAreaThing(direction, 3003, -448, 1704); // Baron of Hell = the OOM killer

  // Sunken working-set page grid (9 cols x 5 rows), engine-driven per cell by
  // tag. The pit is shallow (<=24) so it is escapable; the engine drives live
  // heights at runtime and the floorpic encodes used/cache/free.
  const cellSize = 64;
  const cols = 9;
  const rows = 5;
  const gridU1 = -704;
  const gridV1 = 1024;
  const staticUsedCells = 31;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const used = index < staticUsedCells;
      const cacheTint = !used && index < staticUsedCells + 8;
      const u1 = gridU1 + col * cellSize;
      const v1 = gridV1 + row * cellSize;
      areaRect(direction, `page-cell-${row}-${col}`, { u1, v1, u2: u1 + cellSize, v2: v1 + cellSize }, {
        ...bankCell,
        floor: used ? -8 : (cacheTint ? -16 : -24),
        floorFlat: used ? pageFlatNames.used : (cacheTint ? pageFlatNames.cache : pageFlatNames.free),
        light: used ? 204 : (cacheTint ? 188 : 168),
        tag: pageCellTag(index),
      });
    }
  }

  // ===== SOUTH arm — SATURATION (Stations B + C). A walkway runs the arm; the
  // sunken banks read from it are the two swap channels (swap-in / swap-out,
  // vmstat si/so) and the two page-fault meters (minor / major, sar -B). Their
  // read-point screens line the near wall. This reclaim/thrash arm keeps the T's
  // anti-smear shape — no long grazing hall faces the entrance. =====
  areaRect(direction, "s-walk", { u1: 128, v1: 944, u2: 768, v2: 1024 }, { ...walkway, kind: "memory-walk" });
  areaRect(direction, "faults-term-recess", { u1: mem.faults.u1, v1: mem.faults.v, u2: mem.faults.u2, v2: 944 }, {
    ...bankWall,
    kind: "terminal",
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    light: 186,
    labelSide: "left",
    labelTexture: memoryScreens.faults.texture,
    controlPanel: true,
  });
  areaRect(direction, "swap-term-recess", { u1: mem.swap.u1, v1: mem.swap.v, u2: mem.swap.u2, v2: 944 }, {
    ...bankWall,
    kind: "terminal",
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    light: 188,
    labelSide: "left",
    labelTexture: memoryScreens.swap.texture,
    controlPanel: true,
  });
  // Page-fault meters (Station C): minor (served from RAM = workload) and major
  // (refault from disk/swap = the saturation signal). Engine drives the floor
  // height + light per tag; distinct flats keep the two lanes readable.
  areaRect(direction, "fault-walk-l", { u1: 128, v1: 1024, u2: 192, v2: 1344 }, { ...dimWalkway, kind: "memory-walk" });
  areaRect(direction, "minflt-meter", { u1: 192, v1: 1024, u2: 256, v2: 1344 }, {
    ...bankWall,
    kind: "memory-fault-meter",
    floor: -24,
    floorFlat: "FLOOR5_3",
    light: 168,
    tag: memoryTags.minFlt,
  });
  areaRect(direction, "majflt-meter", { u1: 256, v1: 1024, u2: 320, v2: 1344 }, {
    ...bankWall,
    kind: "memory-fault-meter",
    floor: -24,
    floorFlat: "NUKAGE1",
    light: 176,
    tag: memoryTags.majFlt,
  });
  areaRect(direction, "fault-swap-walk", { u1: 320, v1: 1024, u2: 416, v2: 1344 }, { ...dimWalkway, kind: "memory-walk" });
  // Swap channels (Station B): in / out reclaim, nukage.
  areaRect(direction, "swap-in-channel", { u1: 416, v1: 1024, u2: 480, v2: 1344 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapIn,
  });
  areaRect(direction, "swap-out-channel", { u1: 480, v1: 1024, u2: 544, v2: 1344 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapOut,
  });
  areaRect(direction, "s-walk-r", { u1: 544, v1: 1024, u2: 768, v2: 1344 }, { ...walkway, kind: "memory-walk" });
};

const textures = [
  // Every read-point screen is a CPU-wing-style simulated terminal (blurred
  // streaming logs); the free -m screen plus the four instrument screens.
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

const flats = [
  ...memoryInscription.flats,
  ...pageFlats,
  buildBarrelPadFlat(),
];

// Memory is fixed to the east cardinal wing. The terminal screen sits on the
// local back wall (v2), which rotates to a vertical world segment at x = v2.
const terminals = ({ terminalHalfWidth }) => {
  const segment = ([au, av], [bu, bv]) => {
    const [ax, ay] = rotatePoint([au, av], "east");
    const [bx, by] = rotatePoint([bu, bv], "east");
    return { ax, ay, bx, by };
  };
  return [
    { sign: "memory", segments: [segment([-terminalHalfWidth, mem.termFaceV], [terminalHalfWidth, mem.termFaceV])] },
    { sign: "memory-rss", segments: [segment([mem.rss.u1, mem.rss.v], [mem.rss.u2, mem.rss.v])] },
    { sign: "memory-oom", segments: [segment([mem.oom.u1, mem.oom.v], [mem.oom.u2, mem.oom.v])] },
    { sign: "memory-swap", segments: [segment([mem.swap.u1, mem.swap.v], [mem.swap.u2, mem.swap.v])] },
    { sign: "memory-faults", segments: [segment([mem.faults.u1, mem.faults.v], [mem.faults.u2, mem.faults.v])] },
  ];
};

// Oversized barrel overrides the IWAD BAR1 (both existing frames) so the
// reliquary barrels are large. Same image for A0/B0 (the barrels stand static).
const sprites = [
  { name: "BAR1A0", build: buildBarrelSprite },
  { name: "BAR1B0", build: buildBarrelSprite },
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
