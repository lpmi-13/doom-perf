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
  wallSignSize,
  buildTerminalPatch,
  buildWallSignPatch,
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
  rss: { u: -800, v1: 1088, v2: 1344 },     // RSS sign, north arm far (west) end
  pressure: { v: 912, u1: -512, u2: -256 }, // PSI sign, north arm near wall
  swap: { v: 912, u1: 256, u2: 512 },       // swap sign, south arm near wall
  oom: { u: 800, v1: 1088, v2: 1344 },      // OOM sign, south arm far (east) end
};

const memoryTerminal = {
  lines: ["MEMORY", "FREE -M"],
  texture: wingName("memory", "TERM"),
  patch: wingName("memory", "PTRM"),
};

// Library signage. Signs carry the USE *signal* in reading-room language; the
// Linux *proof* lives on the wing terminals (free -m / vmstat / PSI / ps). The
// bitmap font has no B/F/H/J glyphs, so the words avoid them.
const memoryWallSigns = {
  pages: {
    texture: wingName("memory", "PAGE"),
    patch: wingName("memory", "PPAG"),
    text: "STACKS",
  },
  rss: {
    texture: wingName("memory", "RSS"),
    patch: wingName("memory", "PRSS"),
    text: "TOMES",
  },
  swap: {
    texture: wingName("memory", "SWAP"),
    patch: wingName("memory", "PSWP"),
    text: "ANNEX",
  },
  pressure: {
    texture: wingName("memory", "PSI"),
    patch: wingName("memory", "PPSI"),
    text: "WAITING",
  },
  oom: {
    texture: wingName("memory", "OOM"),
    patch: wingName("memory", "POOM"),
    text: "DISCARD",
  },
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
const memoryTags = {
  cache: tagBase + 45,
  swapIn: tagBase + 46,
  swapOut: tagBase + 47,
  oom: tagBase + 48,
  psiSome: tagBase + 49,
  psiFull: tagBase + 50,
};

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
  const localLeftWall = localSideToWorld(direction, "left");
  const localRightWall = localSideToWorld(direction, "right");

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
    kind: "memory-junction",
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    labelSide: backWall,
    labelTexture: memoryTerminal.texture,
  });
  // Reading lamps flanking the junction mouth.
  addAreaThing(direction, 2028, -112, 968);
  addAreaThing(direction, 2028, 112, 968);

  // ===== NORTH arm — ACTIVE: working-set page banks, RSS, PSI pressure. A
  // walkway runs the arm's length; the live 9x5 page grid is a sunken top-down
  // bank you read from it, the PSI pads are raised platforms at the junction
  // end, and the RSS screen closes the far (west) end. =====
  areaRect(direction, "n-walk", { u1: -768, v1: 944, u2: -288, v2: 1024 }, { ...walkway, kind: "memory-walk" });
  // PSI pressure pads (two raised platforms) + the strip of walk in front of
  // them that links the junction to the arm walkway.
  areaRect(direction, "psi-strip", { u1: -288, v1: 976, u2: -128, v2: 1024 }, { ...walkway, kind: "memory-walk" });
  areaRect(direction, "psi-some-pad", { u1: -288, v1: 944, u2: -208, v2: 976 }, {
    ...bankWall,
    kind: "memory-pressure-pad",
    floor: 20,
    floorFlat: pageFlatNames.cache,
    light: 188,
    tag: memoryTags.psiSome,
  });
  areaRect(direction, "psi-full-pad", { u1: -208, v1: 944, u2: -128, v2: 976 }, {
    ...bankWall,
    kind: "memory-pressure-pad",
    floor: 36,
    floorFlat: pageFlatNames.used,
    light: 172,
    tag: memoryTags.psiFull,
  });
  // Near-wall signs: the STACKS plaque (decorative) and the PSI read-point.
  areaRect(direction, "pages-sign-recess", { u1: -768, v1: 912, u2: -512, v2: 944 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 196,
    labelSide: "left",
    labelTexture: memoryWallSigns.pages.texture,
  });
  areaRect(direction, "pressure-sign-recess", { u1: mem.pressure.u1, v1: mem.pressure.v, u2: mem.pressure.u2, v2: 944 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 188,
    labelSide: "left",
    labelTexture: memoryWallSigns.pressure.texture,
  });
  // Terminal plaza at the far (west) end of the arm, with the RSS screen.
  areaRect(direction, "n-end-walk", { u1: -768, v1: 1024, u2: -704, v2: 1344 }, { ...dimWalkway, kind: "memory-walk" });
  areaRect(direction, "rss-sign-recess", { u1: mem.rss.u, v1: mem.rss.v1, u2: -768, v2: mem.rss.v2 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 184,
    labelSide: localLeftWall,
    labelTexture: memoryWallSigns.rss.texture,
  });

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

  // ===== SOUTH arm — RECLAIM: page-cache reservoir, swap channels, OOM sanctum.
  // A walkway runs the arm; the reclaimable cache (water) and the swap nukage
  // channels are sunken banks read from it, descending into the dark OOM sanctum
  // and its screen at the far (east) end. =====
  areaRect(direction, "s-walk", { u1: 128, v1: 944, u2: 768, v2: 1024 }, { ...walkway, kind: "memory-walk" });
  areaRect(direction, "swap-sign-recess", { u1: mem.swap.u1, v1: mem.swap.v, u2: mem.swap.u2, v2: 944 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 188,
    labelSide: "left",
    labelTexture: memoryWallSigns.swap.texture,
  });
  // Page-cache reservoir (reclaimable memory), engine-driven by tag.
  areaRect(direction, "cache-reservoir", { u1: 128, v1: 1024, u2: 448, v2: 1344 }, {
    ...bankWall,
    kind: "memory-cache-reservoir",
    floor: -12,
    floorFlat: "FWATER1",
    light: 182,
    tag: memoryTags.cache,
  });
  // Swap reclaim channels (in / out), nukage.
  areaRect(direction, "swap-in-channel", { u1: 448, v1: 1024, u2: 512, v2: 1344 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapIn,
  });
  areaRect(direction, "swap-out-channel", { u1: 512, v1: 1024, u2: 576, v2: 1344 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapOut,
  });
  areaRect(direction, "swap-mid-walk", { u1: 576, v1: 1024, u2: 640, v2: 1344 }, { ...dimWalkway, kind: "memory-walk" });
  // OOM sanctum: the darkest, deepest corner, with its screen at the far end.
  areaRect(direction, "oom-bay", { u1: 640, v1: 1024, u2: 768, v2: 1344 }, {
    ...bankWall,
    kind: "memory-oom-bay",
    floor: -16,
    ceiling: 176,
    floorFlat: "FLOOR0_6",
    light: 160,
    tag: memoryTags.oom,
  });
  areaRect(direction, "oom-sign-recess", { u1: 768, v1: mem.oom.v1, u2: mem.oom.u, v2: mem.oom.v2 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 0,
    ceiling: wallSignSize.height,
    light: 120,
    labelSide: localRightWall,
    labelTexture: memoryWallSigns.oom.texture,
  });
};

const textures = [
  {
    texture: memoryTerminal.texture,
    patch: memoryTerminal.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(memoryTerminal),
  },
  {
    texture: bookshelfTexture.texture,
    patch: bookshelfTexture.patch,
    width: bookshelfTexture.width,
    height: bookshelfTexture.height,
    build: buildBookshelfPatch,
  },
  ...Object.values(memoryWallSigns).map((sign) => ({
    texture: sign.texture,
    patch: sign.patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSignPatch(sign.text),
  })),
];

const flats = [
  ...memoryInscription.flats,
  ...pageFlats,
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
    { sign: "memory-rss", segments: [segment([mem.rss.u, mem.rss.v1], [mem.rss.u, mem.rss.v2])] },
    { sign: "memory-pressure", segments: [segment([mem.pressure.u1, mem.pressure.v], [mem.pressure.u2, mem.pressure.v])] },
    { sign: "memory-swap", segments: [segment([mem.swap.u1, mem.swap.v], [mem.swap.u2, mem.swap.v])] },
    { sign: "memory-oom", segments: [segment([mem.oom.u, mem.oom.v1], [mem.oom.u, mem.oom.v2])] },
  ];
};

export const memoryWing = {
  resource: "memory",
  ids: reserved.memory,
  build,
  textures,
  flats,
  sprites: [],
  terminals,
};
