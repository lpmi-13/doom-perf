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
  makeInscription,
} from "../textures.mjs";
import { lump } from "../wad-bytes.mjs";

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

const memoryWallSigns = {
  pages: {
    texture: wingName("memory", "PAGE"),
    patch: wingName("memory", "PPAG"),
    text: "PAGES",
  },
  rss: {
    texture: wingName("memory", "RSS"),
    patch: wingName("memory", "PRSS"),
    text: "TOP RSS",
  },
  swap: {
    texture: wingName("memory", "SWAP"),
    patch: wingName("memory", "PSWP"),
    text: "SWAP",
  },
  pressure: {
    texture: wingName("memory", "PSI"),
    patch: wingName("memory", "PPSI"),
    text: "PSI",
  },
  oom: {
    texture: wingName("memory", "OOM"),
    patch: wingName("memory", "POOM"),
    text: "OOM",
  },
};

const memoryInscription = makeInscription(wingName("memory", "FM"), "MEMORY", "east", 2);
const pageFlatNames = {
  used: wingName("memory", "USED"),
  cache: wingName("memory", "CACH"),
  free: wingName("memory", "FREE"),
};

const buildPageFlat = ({ name, background, border, primary, secondary }) => {
  const size = 64;
  const pixels = new Uint8Array(size * size).fill(background);
  const put = (x, y, color) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      pixels[y * size + x] = color;
    }
  };
  const rect = (x1, y1, x2, y2, color) => {
    for (let y = y1; y < y2; y += 1) {
      for (let x = x1; x < x2; x += 1) {
        put(x, y, color);
      }
    }
  };

  rect(0, 0, size, 2, border);
  rect(0, size - 2, size, size, border);
  rect(0, 0, 2, size, border);
  rect(size - 2, 0, size, size, border);
  rect(6, 6, size - 6, size - 6, primary);
  rect(10, 10, size - 10, size - 10, background);
  for (let y = 14; y < size - 12; y += 10) {
    rect(14, y, size - 14, y + 2, secondary);
  }
  for (let x = 14; x < size - 14; x += 16) {
    rect(x, 14, x + 2, size - 14, secondary);
  }
  rect(4, 4, 8, 8, secondary);
  rect(size - 8, size - 8, size - 4, size - 4, secondary);
  return lump(name, Buffer.from(pixels));
};

const pageFlats = [
  buildPageFlat({ name: pageFlatNames.used, background: 8, border: 96, primary: 112, secondary: 118 }),
  buildPageFlat({ name: pageFlatNames.cache, background: 8, border: 96, primary: 114, secondary: 200 }),
  buildPageFlat({ name: pageFlatNames.free, background: 0, border: 96, primary: 5, secondary: 112 }),
];

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
    wall: "TEKWALL4",
    floorFlat: "FLOOR0_1",
    ceilingFlat: "CEIL5_1",
    ceiling: 192,
  };
  const bankWall = {
    ...accent,
    wall: "BROWNGRN",
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

  // Entry foyer, with a two-cell MEMORY floor inscription at the threshold.
  areaRect(direction, "foyer-left", { u1: memoryRoomBounds.foyer.u1, v1: 704, u2: -64, v2: 896 }, {
    ...memoryBase,
    kind: "foyer",
    light: 208,
  });
  memoryInscription.names.forEach((flatName, k) => {
    const u1 = -64 + k * 64;
    areaRect(direction, `memory-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: 896 }, {
      ...memoryBase,
      kind: "foyer",
      floorFlat: flatName,
      light: 216,
    });
  });
  areaRect(direction, "foyer-right", { u1: 64, v1: 704, u2: memoryRoomBounds.foyer.u2, v2: 896 }, {
    ...memoryBase,
    kind: "foyer",
    light: 208,
  });
  areaRect(direction, "foyer-front", { u1: -64, v1: 704, u2: 64, v2: 832 }, {
    ...memoryBase,
    kind: "foyer",
    light: 208,
  });

  // Broad horizontal page-bank chamber. The 9x5 cellular grid is driven by
  // p_tick.c's memory hook: page cells rise/brighten with utilization while the
  // side channels and pressure pads pulse under saturation.
  areaRect(direction, "front-walk", { u1: -448, v1: 896, u2: 448, v2: 960 }, walkway);
  areaRect(direction, "left-walk", { u1: -448, v1: 960, u2: -352, v2: 1280 }, dimWalkway);
  areaRect(direction, "left-swap-channel", { u1: -352, v1: 960, u2: -320, v2: 1280 }, {
    ...bankWall,
    kind: "memory-swap-channel",
    floor: -20,
    floorFlat: "NUKAGE1",
    light: 180,
    tag: memoryTags.swapIn,
  });
  areaRect(direction, "left-inner-walk", { u1: -320, v1: 960, u2: -288, v2: 1280 }, walkway);
  areaRect(direction, "right-inner-walk", { u1: 288, v1: 960, u2: 320, v2: 1280 }, walkway);
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
        floor: used ? 12 : 4,
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

  addAreaThing(direction, 46, -432, 928);
  addAreaThing(direction, 46, 432, 928);
  addAreaThing(direction, 46, -496, 1296);
  addAreaThing(direction, 46, 496, 1296);
};

const textures = [
  {
    texture: memoryTerminal.texture,
    patch: memoryTerminal.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(memoryTerminal),
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
