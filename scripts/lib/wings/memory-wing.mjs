// Memory wing (east): green page banks, a cache/reserve reservoir, swap
// reclaim channels, and a dark OOM alcove. This is the first static baseline
// for Track A in PARALLEL_WINGS_PLAN.md: clear room grammar, signs, a terminal,
// and page-cell/swap/PSI/OOM tags driven by the memory page-bank engine hook.
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

const memoryRoomBounds = {
  foyer: { u1: -384, v1: 704, u2: 384, v2: 896 },
  main: { u1: -448, v1: 896, u2: 448, v2: 1520 },
  cache: { u1: -736, v1: 976, u2: -448, v2: 1280 },
  oom: { u1: 448, v1: 1120, u2: 640, v2: 1280 },
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
  const px = new Uint8Array(W * H).fill(8); // dark cabinet interior
  const rect = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) {
        px[yy * W + xx] = c;
      }
    }
  };
  rect(0, 0, 2, H, 96); // cabinet uprights
  rect(W - 2, 0, 2, H, 96);
  const spineColors = [176, 231, 96, 47, 5, 231, 176, 96];
  [6, 46, 86].forEach((sy, shelf) => {
    const boardY = sy + 32;
    let x = 4;
    let i = 0;
    while (x < W - 5) {
      const bw = 5 + ((i * 3 + shelf) % 4); // 5..8 px spines
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
  const dimWalkway = { ...walkway, light: 168 };
  const bankCell = {
    ...bankWall,
    kind: "memory-page-cell",
    floorFlat: "FLOOR5_3",
    ceiling: 200,
  };

  // Entry foyer, with a three-cell "TOTAL MEMORY" floor inscription at the
  // threshold (u[-96,96]).
  areaRect(direction, "foyer-left", { u1: memoryRoomBounds.foyer.u1, v1: 704, u2: -96, v2: 896 }, {
    ...memoryBase,
    kind: "foyer",
    light: 208,
  });
  memoryInscription.names.forEach((flatName, k) => {
    // Forward placement: buildMemoryLabel bakes cell k for world y in this slot.
    const u1 = -96 + k * 64;
    areaRect(direction, `memory-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: 896 }, {
      ...memoryBase,
      kind: "foyer",
      floorFlat: flatName,
      light: 216,
    });
  });
  areaRect(direction, "foyer-right", { u1: 96, v1: 704, u2: memoryRoomBounds.foyer.u2, v2: 896 }, {
    ...memoryBase,
    kind: "foyer",
    light: 208,
  });
  areaRect(direction, "foyer-front", { u1: -96, v1: 704, u2: 96, v2: 832 }, {
    ...memoryBase,
    kind: "foyer",
    light: 208,
  });

  // Broad horizontal page-bank chamber. The 9x5 cellular grid is driven by
  // p_tick.c's memory hook: page cells rise/brighten with utilization while the
  // side channels and pressure pads pulse under saturation.
  // Front approach + coliseum descent. The page grid is sunk into a pit (the
  // engine drives the cells to negative floor heights for a top-down view); a
  // single tier at -24 rings the grid so the player can step down (and back up:
  // every grade is <= the 24-unit step limit). The side corridors stay at floor
  // level, with the descent in the centre, in front of the grid.
  const pitTier = -24;
  areaRect(direction, "front-walk-left", { u1: -448, v1: 896, u2: -288, v2: 960 }, walkway);
  areaRect(direction, "front-walk-right", { u1: 288, v1: 896, u2: 448, v2: 960 }, walkway);
  areaRect(direction, "front-walk-center", { u1: -288, v1: 896, u2: 288, v2: 932 }, walkway);
  areaRect(direction, "front-step", { u1: -288, v1: 932, u2: 288, v2: 960 }, {
    ...walkway,
    kind: "memory-pit-step",
    floor: pitTier,
  });
  areaRect(direction, "left-walk", { u1: -448, v1: 960, u2: -352, v2: 1280 }, dimWalkway);
  areaRect(direction, "left-swap-channel", { u1: -352, v1: 960, u2: -320, v2: 1280 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapIn,
  });
  areaRect(direction, "left-inner-walk", { u1: -320, v1: 960, u2: -288, v2: 1280 }, {
    ...walkway,
    kind: "memory-pit-step",
    floor: pitTier,
  });
  areaRect(direction, "right-inner-walk", { u1: 288, v1: 960, u2: 320, v2: 1280 }, {
    ...walkway,
    kind: "memory-pit-step",
    floor: pitTier,
  });
  areaRect(direction, "right-swap-channel", { u1: 320, v1: 960, u2: 352, v2: 1280 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapOut,
  });
  areaRect(direction, "right-walk", { u1: 352, v1: 960, u2: 448, v2: 1280 }, dimWalkway);

  const cellSize = 64;
  const cols = 9;
  const rows = 5;
  const gridU1 = -288;
  const gridV1 = 960;
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
        // Sunk below floor level (the engine drives these to negative heights at
        // runtime); the initial values match so the pit reads correctly pre-tick.
        floor: used ? -16 : (cacheTint ? -32 : -48),
        floorFlat: used ? pageFlatNames.used : (cacheTint ? pageFlatNames.cache : pageFlatNames.free),
        light: used ? 204 : (cacheTint ? 188 : 164),
        tag: pageCellTag(index),
      });
    }
  }

  areaRect(direction, "rear-walk-west", { u1: -448, v1: 1312, u2: -256, v2: 1376 }, walkway);
  areaRect(direction, "rear-walk-center", { u1: -256, v1: 1280, u2: 256, v2: 1376 }, walkway);
  areaRect(direction, "rear-walk-east", { u1: 256, v1: 1280, u2: 448, v2: 1376 }, walkway);
  areaRect(direction, "page-sign-recess", { u1: -448, v1: 1280, u2: -256, v2: 1312 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 204,
    labelSide: backWall,
    labelTexture: memoryWallSigns.pages.texture,
  });
  areaRect(direction, "terminal-walk", { u1: -128, v1: 1376, u2: 128, v2: memoryRoomBounds.main.v2 - terminalPanelDepth }, walkway);
  areaRect(direction, "terminal", { u1: -128, v1: memoryRoomBounds.main.v2 - terminalPanelDepth, u2: 128, v2: memoryRoomBounds.main.v2 }, {
    ...walkway,
    floor: terminalPanelFloor,
    ceiling: terminalPanelFloor + terminalTextureSize.height,
    labelSide: backWall,
    labelTexture: memoryTerminal.texture,
  });
  areaRect(direction, "rear-right-gallery", { u1: 128, v1: 1376, u2: 256, v2: memoryRoomBounds.main.v2 }, dimWalkway);
  areaRect(direction, "pressure-sign-recess", { u1: -448, v1: 1376, u2: -256, v2: 1408 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 188,
    labelSide: backWall,
    labelTexture: memoryWallSigns.pressure.texture,
  });
  areaRect(direction, "pressure-walk-west", { u1: -448, v1: 1408, u2: -416, v2: memoryRoomBounds.main.v2 }, dimWalkway);
  areaRect(direction, "pressure-some-pad", { u1: -416, v1: 1408, u2: -368, v2: memoryRoomBounds.main.v2 }, {
    ...bankWall,
    kind: "memory-pressure-pad",
    floor: 20,
    floorFlat: pageFlatNames.cache,
    light: 188,
    tag: memoryTags.psiSome,
  });
  areaRect(direction, "pressure-walk-mid", { u1: -368, v1: 1408, u2: -336, v2: memoryRoomBounds.main.v2 }, dimWalkway);
  areaRect(direction, "pressure-full-pad", { u1: -336, v1: 1408, u2: -288, v2: memoryRoomBounds.main.v2 }, {
    ...bankWall,
    kind: "memory-pressure-pad",
    floor: 36,
    floorFlat: pageFlatNames.used,
    light: 172,
    tag: memoryTags.psiFull,
  });
  areaRect(direction, "pressure-walk-east", { u1: -288, v1: 1408, u2: -256, v2: memoryRoomBounds.main.v2 }, dimWalkway);
  areaRect(direction, "pressure-walk-back", { u1: -256, v1: 1376, u2: -128, v2: memoryRoomBounds.main.v2 }, dimWalkway);
  areaRect(direction, "swap-sign-recess", { u1: 256, v1: 1376, u2: 448, v2: 1408 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 188,
    labelSide: backWall,
    labelTexture: memoryWallSigns.swap.texture,
  });

  // Cache/reserve side bay: lower, calmer, and more liquid than the page grid.
  const cacheSplitU = -512;
  areaRect(direction, "cache-ledge", {
    u1: cacheSplitU,
    v1: memoryRoomBounds.cache.v1,
    u2: memoryRoomBounds.cache.u2,
    v2: memoryRoomBounds.cache.v2,
  }, {
    ...dimWalkway,
    kind: "memory-cache-ledge",
  });
  areaRect(direction, "cache-reservoir", {
    u1: memoryRoomBounds.cache.u1,
    v1: memoryRoomBounds.cache.v1,
    u2: cacheSplitU,
    v2: memoryRoomBounds.cache.v2,
  }, {
    ...bankWall,
    kind: "memory-cache-reservoir",
    floor: -12,
    floorFlat: "FWATER1",
    light: 156,
    tag: memoryTags.cache,
  });
  areaRect(direction, "cache-sign-recess", { u1: memoryRoomBounds.cache.u1 - 32, v1: 1088, u2: memoryRoomBounds.cache.u1, v2: 1216 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 8,
    ceiling: 8 + wallSignSize.height,
    light: 172,
    labelSide: localLeftWall,
    labelTexture: memoryWallSigns.rss.texture,
  });

  // OOM bay: deliberately dark and quiet; the red/error treatment is reserved
  // for a later live OOM hook so static decor does not compete with telemetry.
  areaRect(direction, "oom-threshold", { u1: memoryRoomBounds.oom.u1, v1: 1120, u2: 512, v2: 1280 }, {
    ...dimWalkway,
    kind: "memory-oom-threshold",
    light: 132,
  });
  areaRect(direction, "oom-bay", { u1: 512, v1: 1120, u2: memoryRoomBounds.oom.u2, v2: 1280 }, {
    ...bankWall,
    kind: "memory-oom-bay",
    floor: -16,
    ceiling: 176,
    floorFlat: "FLOOR0_6",
    light: 112,
    tag: memoryTags.oom,
  });
  areaRect(direction, "oom-sign-recess", { u1: memoryRoomBounds.oom.u2, v1: 1152, u2: 672, v2: 1248 }, {
    ...bankWall,
    kind: "memory-sign",
    floor: 0,
    ceiling: wallSignSize.height,
    light: 116,
    labelSide: localRightWall,
    labelTexture: memoryWallSigns.oom.texture,
  });

  // Reading-room lamps (floor lamp, thing 2028) flanking the foyer threshold.
  addAreaThing(direction, 2028, -432, 928);
  addAreaThing(direction, 2028, 432, 928);
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
  const v = memoryRoomBounds.main.v2;
  return [
    { sign: "memory", segments: [segment([-terminalHalfWidth, v], [terminalHalfWidth, v])] },
    { sign: "memory-rss", segments: [segment([memoryRoomBounds.cache.u1 - 32, 1088], [memoryRoomBounds.cache.u1 - 32, 1216])] },
    { sign: "memory-pressure", segments: [segment([-448, 1408], [-256, 1408])] },
    { sign: "memory-swap", segments: [segment([256, 1408], [448, 1408])] },
    { sign: "memory-oom", segments: [segment([memoryRoomBounds.oom.u2 + 32, 1152], [memoryRoomBounds.oom.u2 + 32, 1248])] },
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
