import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(new URL("../public/maps/doomperf-lab.wad", import.meta.url));
const baseIwadPath = fileURLToPath(new URL("../public/wads/Doom1.WAD", import.meta.url));

const lineFlags = {
  blocking: 1,
  twoSided: 4,
  lowerUnpegged: 16,
};

const hubRadius = 384;
const labelTextureSize = {
  width: 256,
  height: 192,
};
const terminalTextureSize = {
  width: 256,
  height: 128,
};
const signTextureSize = {
  width: 256,
  height: 40,
};
const terminalPanelDepth = 16;
const terminalPanelFloor = 32;
// Control panel filling the wall immediately below each terminal screen. As wide
// as the riser (which is 256), so with flowOffsetFor it maps across the whole
// base exactly once -- no obvious repeat.
const controlPanelTextureSize = { width: 256, height: 32 };
const controlPanelTexture = "DPCTRL";
const controlPanelPatch = "DPPCTRL";
const doorWidth = 192;
const cpuCoreDisplay = {
  u1: -128,
  v1: 992,
  u2: 128,
  v2: 1248,
  light: 160,
};
const cpuRunQueueDisplay = {
  u1: -112,
  v1: 1400,
  u2: 112,
  v2: 1688,
  light: 144,
};
const cpuCoreWallTexture = "DPCOLM";

// CPU core pillars: arranged as the perimeter of a 3x3 lattice laid on a 5x5
// grid of 48px cells. Even-index lattice positions are pillars; the odd cells
// between them are gaps so the ring reads as distinct free-standing columns.
// The uniform grid keeps the map builder's guillotine BSP happy and the cell
// count low enough to stay under vanilla Doom's silent renderer limits
// (drawsegs/openings) -- an 8-pillar octagon is about the same seg budget as
// the original straight row. ringOrder walks the perimeter clockwise so low
// core counts light a contiguous arc. The player views the ring from the
// south edge.
const ringCell = 48;
const ringCells = 5;
const ringU0 = -120;
const ringV0 = 1000;
const ringOrder = [];
for (let c = 0; c <= 4; c += 2) ringOrder.push([c, 0]);
ringOrder.push([4, 2]);
for (let c = 4; c >= 0; c -= 2) ringOrder.push([c, 4]);
ringOrder.push([0, 2]);
const ringPillarIndex = new Map(ringOrder.map(([c, r], i) => [`${c},${r}`, i]));

const cpuRoomBounds = {
  main: { u1: -320, v1: 896, u2: 320, v2: 1624 },
  runQueue: { u1: -768, v1: 896, u2: -384, v2: 1496 },
  load: { u1: 384, v1: 896, u2: 768, v2: 1496 },
  sideEntry: { v1: 1024, v2: 1216 },
};

const cpuTerminalScreens = {
  core: {
    lines: ["CPU CORES", "UTIL"],
    texture: "DPCTERM",
    patch: "DPLCTRM",
    labelColor: 200,
    role: "utilization",
  },
  runQueue: {
    lines: ["RUN QUEUE", "SAT"],
    texture: "DPRQTERM",
    patch: "DPLRQTRM",
    labelColor: 231,
    role: "saturation",
  },
  load: {
    lines: ["LOAD", "AVG"],
    texture: "DPLDTERM",
    patch: "DPLDTRM",
    labelColor: 112,
    role: "saturation",
  },
};

// Free-standing area-identifier signs for the three CPU sub-areas. The wall
// terminals now show only indistinct green static; these carry the readable
// name, in the telemetry popup's green.
const cpuAreaSigns = {
  core: { text: "CPU CORES", texture: "DPSGCOR", patch: "DPSPCOR" },
  runQueue: { text: "RUN QUEUE", texture: "DPSGRQ", patch: "DPSPRQ" },
  load: { text: "LOAD", texture: "DPSGLD", patch: "DPSPLD" },
};
const signTextColor = 112;

// Floor name inscriptions: cell flat names per CPU sub-area. The flat pixel data
// is generated later (once the glyph renderer is defined); the names are static
// so the geometry can reference them while sectors are built.
const coreInscriptionNames = Array.from({ length: 4 }, (_, k) => `DPFCOR${k}`);
const rqInscriptionNames = Array.from({ length: 3 }, (_, k) => `DPFRQ${k}`);
const loadInscriptionNames = Array.from({ length: 3 }, (_, k) => `DPFLD${k}`);

// Linedef tags reserve stable room markers for engine-side telemetry visuals.
const resourceConfigs = {
  cpu: {
    label: "CPU",
    tag: 100,
    labelTexture: "DPCPU",
    labelPatch: "DPLCPU",
    labelColor: 176,
    wall: "COMPTILE",
    accent: "METAL1",
    floor: "FLOOR4_8",
    ceiling: "CEIL3_5",
  },
  memory: {
    label: "MEMORY",
    tag: 200,
    labelTexture: "DPMEM",
    labelPatch: "DPLMEM",
    labelColor: 112,
    wall: "TEKWALL4",
    accent: "BROWNGRN",
    floor: "FLOOR5_1",
    ceiling: "CEIL5_1",
  },
  storage: {
    label: "DISK",
    tag: 300,
    labelTexture: "DPDISK",
    labelPatch: "DPLDSK",
    labelColor: 231,
    wall: "STONE2",
    accent: "BROWNHUG",
    floor: "FLOOR0_3",
    ceiling: "CEIL3_2",
  },
  network: {
    label: "NETWORK",
    tag: 400,
    labelTexture: "DPNET",
    labelPatch: "DPLNET",
    labelColor: 200,
    wall: "TEKWALL1",
    accent: "COMPSPAN",
    floor: "FLOOR1_1",
    ceiling: "CEIL4_3",
  },
};

const directions = ["north", "east", "south", "west"];
const directionResource = {
  north: "cpu",
  east: "memory",
  south: "storage",
  west: "network",
};
const outwardSide = {
  north: "top",
  east: "right",
  south: "bottom",
  west: "left",
};

const lump = (name, data = Buffer.alloc(0)) => ({ name, data });

const i16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16LE(value);
  return buffer;
};

const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const i32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
};

const ascii8 = (value) => {
  if (value.length > 8) {
    throw new Error(`Doom lump field exceeds 8 bytes: ${value}`);
  }
  const buffer = Buffer.alloc(8);
  buffer.write(value, "ascii");
  return buffer;
};

const record = (...parts) => Buffer.concat(parts);

const pointKey = ([x, y]) => `${x},${y}`;

const boundsFor = (points) => ({
  x1: Math.min(...points.map(([x]) => x)),
  y1: Math.min(...points.map(([, y]) => y)),
  x2: Math.max(...points.map(([x]) => x)),
  y2: Math.max(...points.map(([, y]) => y)),
});

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

const rotateBounds = ({ u1, v1, u2, v2 }, direction) =>
  boundsFor([
    rotatePoint([u1, v1], direction),
    rotatePoint([u2, v1], direction),
    rotatePoint([u2, v2], direction),
    rotatePoint([u1, v2], direction),
  ]);

const sectors = [];
const things = [{ x: 0, y: 0, angle: 90, type: 1, options: 7 }];

const addThing = ({ x, y, angle = 0, type, options = 7 }) => {
  things.push({ x, y, angle, type, options });
};

const addAreaThing = (direction, type, u, v, angle = 0) => {
  const [x, y] = rotatePoint([u, v], direction);
  const directionAngle = {
    north: 0,
    east: 270,
    south: 180,
    west: 90,
  }[direction];
  addThing({ x, y, angle: (angle + directionAngle) % 360, type });
};

const addRect = (id, bounds, options) => {
  const sector = {
    id,
    floor: 0,
    ceiling: 192,
    floorFlat: "FLOOR4_8",
    ceilingFlat: "CEIL3_5",
    light: 208,
    wall: "STARTAN3",
    kind: "room",
    resource: undefined,
    labelSide: undefined,
    labelTexture: undefined,
    ...bounds,
    ...options,
  };

  if (sector.x1 >= sector.x2 || sector.y1 >= sector.y2) {
    throw new Error(`Sector ${id} has invalid bounds.`);
  }
  for (const other of sectors) {
    const overlapX = Math.min(sector.x2, other.x2) - Math.max(sector.x1, other.x1);
    const overlapY = Math.min(sector.y2, other.y2) - Math.max(sector.y1, other.y1);
    if (overlapX > 0 && overlapY > 0) {
      throw new Error(`Sectors overlap: ${id} and ${other.id}`);
    }
  }
  sectors.push(sector);
  return sector;
};

addRect("atrium", { x1: -hubRadius, y1: -hubRadius, x2: hubRadius, y2: hubRadius }, {
  kind: "hub",
  floorFlat: "FLOOR4_8",
  ceilingFlat: "CEIL3_5",
  wall: "STARTAN3",
  light: 224,
});

const areaRect = (direction, id, localBounds, options) =>
  addRect(`${direction}-${id}`, rotateBounds(localBounds, direction), options);

const addResourceArea = (direction) => {
  const resource = directionResource[direction];
  const config = resourceConfigs[resource];
  const hasCpuCoreDisplay = resource === "cpu";
  const base = {
    resource,
    wall: config.wall,
    floorFlat: config.floor,
    ceilingFlat: config.ceiling,
  };
  const accent = { ...base, wall: config.accent };

  areaRect(direction, "door", { u1: -doorWidth / 2, v1: hubRadius, u2: doorWidth / 2, v2: 448 }, {
    ...base,
    kind: "door",
    wall: "DOORTRAK",
    ceiling: 0,
    labelTexture: config.labelTexture,
  });
  areaRect(direction, "entry", { u1: -112, v1: 448, u2: 112, v2: 704 }, {
    ...accent,
    kind: "entry",
    light: 192,
  });
  if (hasCpuCoreDisplay) {
    // Split the CPU foyer to inscribe the CPU CORES name flush into the floor at
    // the threshold into the core chamber (the player walks over it).
    const foyer = { ...base, kind: "foyer", light: 216 };
    areaRect(direction, "foyer-west", { u1: -320, v1: 704, u2: -128, v2: cpuRoomBounds.main.v1 }, foyer);
    areaRect(direction, "foyer-east", { u1: 128, v1: 704, u2: 320, v2: cpuRoomBounds.main.v1 }, foyer);
    areaRect(direction, "foyer-south", { u1: -128, v1: 704, u2: 128, v2: 832 }, foyer);
    // CPU CORES name inscribed flush into the foyer floor at the chamber mouth.
    coreInscriptionNames.forEach((flatName, k) => {
      const u1 = -128 + k * 64;
      areaRect(direction, `core-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: cpuRoomBounds.main.v1 }, {
        ...foyer,
        floorFlat: flatName,
      });
    });
  } else {
    areaRect(direction, "foyer", { u1: -320, v1: 704, u2: 320, v2: 960 }, {
      ...base,
      kind: "foyer",
      light: 216,
    });
  }
  if (hasCpuCoreDisplay) {
    // Core ring: a lit metal frame surrounds a 5x5 grid platform whose ceiling
    // vaults upward. The 8 perimeter pillars are solid streak columns (one per
    // logical CPU, viewed from the south edge); the cells between them are
    // walkway/gaps so the ring reads as distinct free-standing columns. The
    // frame is lit rather than a dark pit (Doom's low light levels render as a
    // muddy black); the drama comes from the glowing pads and core streaks.
    const frameLight = 160;
    const frame = {
      ...accent,
      kind: "core-frame",
      wall: "METAL1",
      floorFlat: "FLOOR0_1",
      ceilingFlat: "CEIL5_1",
      light: frameLight,
    };
    // Open-air variant for the core courtyard (ring + balconies + stairs) so the
    // columns are seen rising into the sky from the raised overlook.
    const openSky = { ...frame, ceiling: 288, ceilingFlat: "F_SKY1" };
    areaRect(direction, "main-frame-south", { u1: cpuRoomBounds.main.u1, v1: cpuRoomBounds.main.v1, u2: cpuRoomBounds.main.u2, v2: ringV0 }, frame);
    // Behind the cores the chamber flares wider (rearU vs the +/-320 core area)
    // and leaves a flat breathing space before the stairs, so the overlook feels
    // open and the stairs aren't crammed up against the columns.
    const rearU = 368;                                    // rear half-width (core area stays +/-320)
    const coreRearV = ringV0 + ringCells * ringCell;      // 1240: cores' north edge
    const coreGap = 128;                                  // flat space between cores and stairs
    const stairBaseV = coreRearV + coreGap;               // 1368: foot of the stairs
    const stairCount = 8, stairRun = 24, stairRise = 16;
    const stairTopV = stairBaseV + stairCount * stairRun; // 1560: top landing / platform
    const platformFloor = stairCount * stairRise;         // 128: one floor up
    const mainTerminalPanelV = cpuRoomBounds.main.v2 - terminalPanelDepth;
    // Flat rear courtyard behind the cores, flanking the central terminal corridor.
    areaRect(direction, "core-rear-w", { u1: -rearU, v1: coreRearV, u2: -128, v2: stairBaseV }, openSky);
    areaRect(direction, "core-rear-e", { u1: 128, v1: coreRearV, u2: rearU, v2: stairBaseV }, openSky);
    // Straight flights climbing to viewing platforms at the far back wall, where
    // the cores are seen across the room. They flank the central terminal
    // corridor, which stays at ground level the whole way to the screen.
    for (let s = 1; s <= stairCount; s += 1) {
      const v1 = stairBaseV + (s - 1) * stairRun;
      const step = { ...openSky, floor: s * stairRise };
      areaRect(direction, `core-stair-w${s}`, { u1: -rearU, v1, u2: -128, v2: v1 + stairRun }, step);
      areaRect(direction, `core-stair-e${s}`, { u1: 128, v1, u2: rearU, v2: v1 + stairRun }, step);
    }
    areaRect(direction, "core-platform-w", { u1: -rearU, v1: stairTopV, u2: -128, v2: cpuRoomBounds.main.v2 }, { ...openSky, floor: platformFloor });
    areaRect(direction, "core-platform-e", { u1: 128, v1: stairTopV, u2: rearU, v2: cpuRoomBounds.main.v2 }, { ...openSky, floor: platformFloor });
    // Central terminal corridor: open to the sky and at ground level the whole way
    // to the terminal. The recess keeps ceiling 160, so the step up to the open
    // sky leaves a solid wall (METAL1) above the screen, as tall as the cores.
    areaRect(direction, "main-terminal-walk", { u1: -128, v1: coreRearV, u2: 128, v2: mainTerminalPanelV }, openSky);
    areaRect(direction, "main-terminal", { u1: -128, v1: mainTerminalPanelV, u2: 128, v2: cpuRoomBounds.main.v2 }, {
      ...frame,
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      labelSide: "top",
      labelTexture: cpuTerminalScreens.core.texture,
    });
    // West & east flanks beside the cores stay at ground level (no raised balcony)
    // so the cores aren't crowded and the side doorways + entrance stay reachable.
    areaRect(direction, "core-flank-w", { u1: cpuRoomBounds.main.u1, v1: ringV0, u2: ringU0, v2: coreRearV }, openSky);
    areaRect(direction, "core-flank-e", { u1: ringU0 + ringCells * ringCell, v1: ringV0, u2: cpuRoomBounds.main.u2, v2: coreRearV }, openSky);
    // 5x5 platform grid: pillar cells (solid streak columns, tagged 101+i for
    // the renderer and 201+i for the sink hook) and walkway/gap cells.
    const ringFloor = {
      ...accent,
      kind: "core-grid",
      wall: cpuCoreWallTexture,
      floorFlat: "FLOOR1_7",
      ceiling: 288,
      ceilingFlat: "F_SKY1",
      light: cpuCoreDisplay.light,
    };
    for (let row = 0; row < ringCells; row += 1) {
      for (let col = 0; col < ringCells; col += 1) {
        const bounds = {
          u1: ringU0 + col * ringCell,
          v1: ringV0 + row * ringCell,
          u2: ringU0 + (col + 1) * ringCell,
          v2: ringV0 + (row + 1) * ringCell,
        };
        const idx = ringPillarIndex.get(`${col},${row}`);
        if (idx !== undefined) {
          areaRect(direction, `core-pillar-${idx}`, bounds, {
            ...ringFloor,
            kind: "core-column",
            floor: 288,
            lineTag: 101 + idx,
            tag: 201 + idx,
          });
        } else {
          areaRect(direction, `core-walk-${col}-${row}`, bounds, ringFloor);
        }
      }
    }
    // ===== Open entryways (no doors) into the two side rooms =====
    const corridor = {
      ...base,
      kind: "entry",
      wall: "METAL1",
      floorFlat: "FLOOR0_1",
      ceilingFlat: "CEIL5_1",
      light: frameLight,
      ceiling: 144,
    };
    // RUN QUEUE / LOAD names inscribed flush into the entry-corridor floors at
    // each room's threshold (the player walks over them on the way in).
    rqInscriptionNames.forEach((flatName, k) => {
      const v1 = cpuRoomBounds.sideEntry.v1 + k * 64;
      areaRect(direction, `rq-inscription-${k}`, { u1: cpuRoomBounds.runQueue.u2, v1, u2: cpuRoomBounds.main.u1, v2: v1 + 64 }, { ...corridor, floorFlat: flatName });
    });
    loadInscriptionNames.forEach((flatName, k) => {
      const v1 = cpuRoomBounds.sideEntry.v1 + k * 64;
      areaRect(direction, `load-inscription-${k}`, { u1: cpuRoomBounds.main.u2, v1, u2: cpuRoomBounds.load.u1, v2: v1 + 64 }, { ...corridor, floorFlat: flatName });
    });
    // ===== LEFT room: RUN QUEUE conveyor (light 144) + sky window =====
    const runQueueFloor = {
      ...base,
      kind: "run-queue",
      wall: "METAL1",
      floorFlat: "FLOOR1_7",
      ceilingFlat: "CEIL5_1",
      ceiling: 224,
      light: cpuRunQueueDisplay.light,
    };
    areaRect(direction, "rq-room-west", { ...cpuRoomBounds.runQueue, u2: -704 }, runQueueFloor);
    const rqTerminalPanelV = cpuRoomBounds.runQueue.v2 - terminalPanelDepth;
    areaRect(direction, "rq-terminal-walk", { ...cpuRoomBounds.runQueue, u1: -704, u2: -448, v2: rqTerminalPanelV }, runQueueFloor);
    areaRect(direction, "rq-terminal", { ...cpuRoomBounds.runQueue, u1: -704, u2: -448, v1: rqTerminalPanelV }, {
      ...runQueueFloor,
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      labelSide: "top",
      labelTexture: cpuTerminalScreens.runQueue.texture,
    });
    areaRect(direction, "rq-room-east", { ...cpuRoomBounds.runQueue, u1: -448 }, runQueueFloor);
    areaRect(direction, "rq-view", { u1: cpuRoomBounds.runQueue.u1 - 64, v1: 1080, u2: cpuRoomBounds.runQueue.u1, v2: 1200 }, {
      kind: "outside",
      resource,
      floor: 72,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
    // ===== RIGHT room: LOAD — three vertical load-average gauges + sky window.
    // The player enters walking east, so left->right reads north->south (high->
    // low v): 1m, 5m, 15m. Each gauge is a 128-tall pillar whose lower wall is
    // filled from the bottom by patch 0017 (lineTags 121/122/123). Band edges
    // reuse existing global v-cuts so the carving adds no cuts across the core
    // chamber (only the u=512/640 cuts, which stay east of it).
    const loadWalk = {
      ...base,
      kind: "load-room",
      wall: "METAL1",
      floorFlat: "FLOOR4_8",
      ceilingFlat: "CEIL5_1",
      ceiling: 224,
      light: 176,
    };
    const loadGauge = {
      ...base,
      kind: "load-gauge",
      wall: cpuCoreWallTexture,
      floor: 128,
      ceiling: 128,
      floorFlat: "FLOOR0_1",
      ceilingFlat: "CEIL5_1",
      light: 176,
    };
    areaRect(direction, "load-walk-w", { u1: cpuRoomBounds.load.u1, v1: cpuRoomBounds.load.v1, u2: 512, v2: 1240 }, loadWalk);
    areaRect(direction, "load-margin-s", { u1: 512, v1: cpuRoomBounds.load.v1, u2: 640, v2: 1000 }, loadWalk);
    areaRect(direction, "load-gauge-15m", { u1: 512, v1: 1000, u2: 640, v2: 1048 }, { ...loadGauge, lineTag: 123 });
    areaRect(direction, "load-gap-1", { u1: 512, v1: 1048, u2: 640, v2: 1096 }, loadWalk);
    areaRect(direction, "load-gauge-5m", { u1: 512, v1: 1096, u2: 640, v2: 1144 }, { ...loadGauge, lineTag: 122 });
    areaRect(direction, "load-gap-2", { u1: 512, v1: 1144, u2: 640, v2: 1192 }, loadWalk);
    areaRect(direction, "load-gauge-1m", { u1: 512, v1: 1192, u2: 640, v2: 1240 }, { ...loadGauge, lineTag: 121 });
    areaRect(direction, "load-walk-e", { u1: 640, v1: cpuRoomBounds.load.v1, u2: cpuRoomBounds.load.u2, v2: 1240 }, loadWalk);
    areaRect(direction, "load-north-west", { u1: cpuRoomBounds.load.u1, v1: 1240, u2: 448, v2: cpuRoomBounds.load.v2 }, loadWalk);
    const loadTerminalPanelV = cpuRoomBounds.load.v2 - terminalPanelDepth;
    areaRect(direction, "load-terminal-walk", { u1: 448, v1: 1240, u2: 704, v2: loadTerminalPanelV }, loadWalk);
    areaRect(direction, "load-terminal", { u1: 448, v1: loadTerminalPanelV, u2: 704, v2: cpuRoomBounds.load.v2 }, {
      ...loadWalk,
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      labelSide: "top",
      labelTexture: cpuTerminalScreens.load.texture,
    });
    areaRect(direction, "load-north-east", { u1: 704, v1: 1240, u2: cpuRoomBounds.load.u2, v2: cpuRoomBounds.load.v2 }, loadWalk);
    areaRect(direction, "load-view", { u1: cpuRoomBounds.load.u2, v1: 1080, u2: cpuRoomBounds.load.u2 + 64, v2: 1200 }, {
      kind: "outside",
      resource,
      floor: 72,
      ceiling: 192,
      floorFlat: "FLOOR7_2",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
  } else {
    areaRect(direction, "main", { u1: -320, v1: 960, u2: 320, v2: 1280 }, {
      ...accent,
      kind: "main",
      light: 224,
    });
    areaRect(direction, "side", { u1: -512, v1: 832, u2: -320, v2: 1120 }, {
      ...base,
      kind: "side",
      floorFlat: "FLOOR0_1",
      light: 176,
    });
    areaRect(direction, "side-view", { u1: -640, v1: 896, u2: -512, v2: 1056 }, {
      kind: "outside",
      resource,
      floor: 72,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
    areaRect(direction, "step-1", { u1: 320, v1: 1024, u2: 384, v2: 1216 }, {
      ...base,
      kind: "step",
      floor: 8,
      wall: "STEP1",
    });
    areaRect(direction, "step-2", { u1: 384, v1: 1024, u2: 448, v2: 1216 }, {
      ...base,
      kind: "step",
      floor: 16,
      wall: "STEP1",
    });
    areaRect(direction, "step-3", { u1: 448, v1: 1024, u2: 512, v2: 1216 }, {
      ...base,
      kind: "step",
      floor: 24,
      wall: "STEP1",
    });
    areaRect(direction, "overlook", { u1: 512, v1: 960, u2: 640, v2: 1280 }, {
      ...accent,
      kind: "overlook",
      floor: 24,
      ceiling: 216,
      light: 232,
    });
    areaRect(direction, "overlook-view", { u1: 640, v1: 1024, u2: 704, v2: 1216 }, {
      kind: "outside",
      resource,
      floor: 88,
      ceiling: 216,
      floorFlat: "FLOOR7_2",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
    areaRect(direction, "gallery", { u1: -192, v1: 1280, u2: 192, v2: 1568 }, {
      ...base,
      kind: "gallery",
      floor: 16,
      ceiling: 216,
      light: 208,
      labelSide: outwardSide[direction],
      labelTexture: config.labelTexture,
    });
    areaRect(direction, "nook", { u1: -512, v1: 1280, u2: -192, v2: 1504 }, {
      ...accent,
      kind: "nook",
      floorFlat: "FLOOR1_7",
      light: 184,
    });
    areaRect(direction, "nook-view", { u1: -640, v1: 1344, u2: -512, v2: 1472 }, {
      kind: "outside",
      resource,
      floor: 80,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
  }

  if (hasCpuCoreDisplay) {
    // One torch beside each side-room doorway -- against the side wall and just
    // south of the v=1024..1216 opening (radius 16 reaches only to v=1024, so it
    // never intrudes into the entry/exit) -- and one at the foot of each back
    // staircase (stairs start at v=1368), against the rear side wall.
    addAreaThing(direction, 46, -306, 1008);
    addAreaThing(direction, 46, 306, 1008);
    addAreaThing(direction, 46, -354, 1352);
    addAreaThing(direction, 46, 354, 1352);
  }
};

directions.forEach(addResourceArea);

const xCuts = [...new Set(sectors.flatMap(({ x1, x2 }) => [x1, x2]))].sort((a, b) => a - b);
const yCuts = [...new Set(sectors.flatMap(({ y1, y2 }) => [y1, y2]))].sort((a, b) => a - b);

const cutsBetween = (cuts, start, end) => cuts.filter((cut) => cut > start && cut < end);
const vertexIds = new Map();
const vertices = [];

const vertexId = (point) => {
  const key = pointKey(point);
  const existing = vertexIds.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const index = vertices.length;
  vertexIds.set(key, index);
  vertices.push(point);
  return index;
};

const splitEdge = (sector, side) => {
  const points = [];
  switch (side) {
    case "top":
      points.push([sector.x1, sector.y2]);
      cutsBetween(xCuts, sector.x1, sector.x2).forEach((x) => points.push([x, sector.y2]));
      points.push([sector.x2, sector.y2]);
      break;
    case "right":
      points.push([sector.x2, sector.y2]);
      cutsBetween(yCuts, sector.y1, sector.y2).reverse().forEach((y) => points.push([sector.x2, y]));
      points.push([sector.x2, sector.y1]);
      break;
    case "bottom":
      points.push([sector.x2, sector.y1]);
      cutsBetween(xCuts, sector.x1, sector.x2).reverse().forEach((x) => points.push([x, sector.y1]));
      points.push([sector.x1, sector.y1]);
      break;
    case "left":
      points.push([sector.x1, sector.y1]);
      cutsBetween(yCuts, sector.y1, sector.y2).forEach((y) => points.push([sector.x1, y]));
      points.push([sector.x1, sector.y2]);
      break;
    default:
      throw new Error(`Unknown sector side: ${side}`);
  }
  return points.slice(0, -1).map((point, index) => ({
    a: point,
    b: points[index + 1],
    sector,
    side,
    overrideTexture: sector.labelSide === side ? sector.labelTexture : undefined,
  }));
};

const segmentKey = (a, b) => {
  const first = pointKey(a);
  const second = pointKey(b);
  return first < second ? `${first}:${second}` : `${second}:${first}`;
};

const edgeGroups = new Map();
for (const sector of sectors) {
  sector.edges = ["top", "right", "bottom", "left"].flatMap((side) => splitEdge(sector, side));
  for (const edge of sector.edges) {
    vertexId(edge.a);
    vertexId(edge.b);
    const key = segmentKey(edge.a, edge.b);
    const group = edgeGroups.get(key) ?? [];
    group.push(edge);
    edgeGroups.set(key, group);
  }
}

const angleFor = ([x1, y1], [x2, y2]) => {
  const radians = Math.atan2(y2 - y1, x2 - x1);
  const turns = radians < 0 ? radians / (Math.PI * 2) + 1 : radians / (Math.PI * 2);
  return Math.round(turns * 65536) & 0xffff;
};

const sidedefs = [];
const linedefs = [];

const sidedef = (sectorIndex, topTexture, bottomTexture, midTexture, textureOffset = 0) => {
  const index = sidedefs.length;
  sidedefs.push({
    sectorIndex,
    textureOffset,
    topTexture,
    bottomTexture,
    midTexture,
  });
  return index;
};

const isDoorPair = (first, second) =>
  Boolean(first && second && (first.kind === "door" || second.kind === "door"));

const doorTextureFor = (first, second) =>
  first.kind === "door" ? first.labelTexture : second.labelTexture;

const chooseFrontEdge = (edges) => {
  if (edges.length !== 2) {
    return edges[0];
  }
  const nonDoor = edges.find((edge) => edge.sector.kind !== "door");
  return nonDoor ?? edges[0];
};

const lineTagFor = (front, back, overrideTexture) => {
  if (overrideTexture || isDoorPair(front, back) || front.kind === "outside" || back?.kind === "outside") {
    return 0;
  }
  if (front.lineTag !== undefined) return front.lineTag;
  if (back?.lineTag !== undefined) return back.lineTag;
  const resource = front.resource ?? back?.resource;
  return resource ? resourceConfigs[resource].tag : 0;
};

// A placard's name belongs only on its long faces; the narrow end risers get
// plain metal. The long faces run along the block's wider axis.
const edgeIsLongFace = (edge, sign) => {
  const horizontal = edge.a[1] === edge.b[1];
  const wideX = (sign.x2 - sign.x1) >= (sign.y2 - sign.y1);
  return horizontal === wideX;
};

const sideTextures = (sector, other, overrideTexture, edge) => {
  if (!other) {
    return {
      top: "-",
      bottom: "-",
      mid: overrideTexture ?? sector.wall,
    };
  }
  if (isDoorPair(sector, other)) {
    // The resource word goes only on the outside (hub-facing) door face; the
    // inside gets a plain wall so it isn't left untextured.
    const room = sector.kind === "door" ? other : sector;
    return {
      top: room && room.kind === "hub" ? doorTextureFor(sector, other) : (room ? "BIGDOOR2" : "-"),
      bottom: "-",
      mid: "-",
    };
  }
  const floorStep = sector.floor !== other.floor;
  // A top texture seals the gap above the lower-ceiling sector. Suppress it only
  // when the *neighbour* is sky (so a window/ledge under a higher sky ceiling
  // bleeds sky as intended); a sky sector meeting a LOWER solid ceiling -- the
  // open core courtyard above the terminal recess, the entrance, the side
  // passages -- still needs a real wall, not a sky-bleed gap.
  const ceilingStep = sector.ceiling !== other.ceiling && other.ceilingFlat !== "F_SKY1";
  let bottom = "-";
  if (floorStep) {
    if (other.kind === "sign") bottom = edge && edgeIsLongFace(edge, other) ? other.labelTexture : other.wall;
    else if (sector.kind === "sign") bottom = edge && edgeIsLongFace(edge, sector) ? sector.labelTexture : sector.wall;
    else if (other.kind === "core-column" || other.kind === "load-gauge") bottom = other.wall;
    else if (sector.kind === "core-column" || sector.kind === "load-gauge") bottom = sector.wall;
    // The step up into a wall-terminal recess (the wall just below the screen)
    // gets a keyboard/control panel rather than a plain step riser.
    else if (other.labelSide === "top" && other.labelTexture) bottom = controlPanelTexture;
    else if (sector.kind === "outside" || other.kind === "outside") bottom = "STONE2";
    else bottom = "STEP1";
  }
  return {
    top: ceilingStep ? sector.wall : "-",
    bottom,
    mid: "-",
  };
};

// Door label offset: the label texture is wider than the door and the door
// edge is split into segments by global grid cuts. Centre one word across the
// whole door by giving each segment a continuous offset measured from the
// door's reading-start corner (the segment direction already matches the
// viewer's left-to-right for each wing), instead of re-centering every segment.
const doorTextureOffsetFor = (edge, sector, other) => {
  if (!isDoorPair(sector, other)) return 0;
  const door = sector.kind === "door" ? sector : other;
  const texW = labelTextureSize.width;
  const horizontal = edge.a[1] === edge.b[1];
  if (horizontal) {
    const pad = (texW - (door.x2 - door.x1)) / 2;
    const dist = edge.b[0] >= edge.a[0] ? edge.a[0] - door.x1 : door.x2 - edge.a[0];
    return Math.floor(pad + dist);
  }
  const pad = (texW - (door.y2 - door.y1)) / 2;
  const dist = edge.b[1] >= edge.a[1] ? edge.a[1] - door.y1 : door.y2 - edge.a[1];
  return Math.floor(pad + dist);
};

const overrideTextureOffsetFor = (edge, sector) => {
  const texW = labelTextureSize.width;
  const horizontal = edge.a[1] === edge.b[1];
  if (horizontal) {
    const pad = Math.max(0, (texW - (sector.x2 - sector.x1)) / 2);
    const dist = edge.b[0] >= edge.a[0] ? edge.a[0] - sector.x1 : sector.x2 - edge.a[0];
    return Math.floor(pad + dist);
  }
  const pad = Math.max(0, (texW - (sector.y2 - sector.y1)) / 2);
  const dist = edge.b[1] >= edge.a[1] ? edge.a[1] - sector.y1 : sector.y2 - edge.a[1];
  return Math.floor(pad + dist);
};

// Distance of this segment's start from the wall's start, so a tiling texture
// continues seamlessly across grid-cut segments instead of restarting at each.
const flowOffsetFor = (edge, sector) => {
  const horizontal = edge.a[1] === edge.b[1];
  if (horizontal) return Math.floor(edge.b[0] >= edge.a[0] ? edge.a[0] - sector.x1 : sector.x2 - edge.a[0]);
  return Math.floor(edge.b[1] >= edge.a[1] ? edge.a[1] - sector.y1 : sector.y2 - edge.a[1]);
};

const textureOffsetFor = (edge, sector, other, overrideTexture) => {
  if (isDoorPair(sector, other)) return doorTextureOffsetFor(edge, sector, other);
  if (sector.kind === "sign") return edgeIsLongFace(edge, sector) ? overrideTextureOffsetFor(edge, sector) : 0;
  if (other && other.kind === "sign") return edgeIsLongFace(edge, other) ? overrideTextureOffsetFor(edge, other) : 0;
  // Terminal control-panel riser: flow the tiling panel across its cut segments.
  if (other && other.labelSide === "top" && other.labelTexture && sector.floor < other.floor) return flowOffsetFor(edge, sector);
  if (overrideTexture) return overrideTextureOffsetFor(edge, sector);
  return 0;
};

for (const group of edgeGroups.values()) {
  if (group.length > 2) {
    throw new Error(`More than two sectors share edge ${segmentKey(group[0].a, group[0].b)}`);
  }
  const frontEdge = chooseFrontEdge(group);
  const backEdge = group.find((edge) => edge !== frontEdge);
  const front = frontEdge.sector;
  const back = backEdge?.sector;
  const frontTextures = sideTextures(front, back, frontEdge.overrideTexture, frontEdge);
  const frontSide = sidedef(
    sectors.indexOf(front),
    frontTextures.top,
    frontTextures.bottom,
    frontTextures.mid,
    textureOffsetFor(frontEdge, front, back, frontEdge.overrideTexture)
  );
  const backTextures = back ? sideTextures(back, front, backEdge.overrideTexture, backEdge) : undefined;
  const backSide = back && backTextures
    ? sidedef(
      sectors.indexOf(back),
      backTextures.top,
      backTextures.bottom,
      backTextures.mid,
      textureOffsetFor(backEdge, back, front, backEdge.overrideTexture)
    )
    : -1;
  let flags = back ? lineFlags.twoSided : lineFlags.blocking;
  let special = 0;
  if (back && (front.kind === "outside" || back.kind === "outside")) {
    flags |= lineFlags.blocking | lineFlags.lowerUnpegged;
  }
  if (back && isDoorPair(front, back)) {
    flags |= lineFlags.lowerUnpegged;
    special = 1;
  }

  const linedefIndex = linedefs.length;
  linedefs.push({
    v1: vertexId(frontEdge.a),
    v2: vertexId(frontEdge.b),
    flags,
    special,
    tag: lineTagFor(front, back, frontEdge.overrideTexture ?? backEdge?.overrideTexture),
    frontSide,
    backSide,
  });
  frontEdge.linedef = linedefIndex;
  frontEdge.linedefSide = 0;
  if (backEdge) {
    backEdge.linedef = linedefIndex;
    backEdge.linedefSide = 1;
  }
}

const segs = [];
const subsectors = [];
for (const sector of sectors) {
  const firstSeg = segs.length;
  for (const edge of sector.edges) {
    segs.push({
      v1: vertexId(edge.a),
      v2: vertexId(edge.b),
      angle: angleFor(edge.a, edge.b),
      linedef: edge.linedef,
      side: edge.linedefSide,
    });
  }
  subsectors.push({
    numSegs: segs.length - firstSeg,
    firstSeg,
  });
}

const bboxFor = (indices) => ({
  x1: Math.min(...indices.map((index) => sectors[index].x1)),
  y1: Math.min(...indices.map((index) => sectors[index].y1)),
  x2: Math.max(...indices.map((index) => sectors[index].x2)),
  y2: Math.max(...indices.map((index) => sectors[index].y2)),
});

const splitCandidatesFor = (indices) => {
  const candidates = [];
  for (const coordinate of xCuts) {
    const west = [];
    const east = [];
    let straddled = false;
    for (const index of indices) {
      const sector = sectors[index];
      if (sector.x2 <= coordinate) {
        west.push(index);
      } else if (sector.x1 >= coordinate) {
        east.push(index);
      } else {
        straddled = true;
        break;
      }
    }
    if (!straddled && west.length && east.length) {
      candidates.push({ axis: "x", coordinate, child0: east, child1: west });
    }
  }
  for (const coordinate of yCuts) {
    const south = [];
    const north = [];
    let straddled = false;
    for (const index of indices) {
      const sector = sectors[index];
      if (sector.y2 <= coordinate) {
        south.push(index);
      } else if (sector.y1 >= coordinate) {
        north.push(index);
      } else {
        straddled = true;
        break;
      }
    }
    if (!straddled && south.length && north.length) {
      candidates.push({ axis: "y", coordinate, child0: south, child1: north });
    }
  }
  return candidates.sort((first, second) => {
    const firstBalance = Math.abs(first.child0.length - first.child1.length);
    const secondBalance = Math.abs(second.child0.length - second.child1.length);
    return firstBalance - secondBalance;
  });
};

const nodes = [];

const bspFor = (indices) => {
  const bbox = bboxFor(indices);
  if (indices.length === 1) {
    return {
      ref: 0x8000 | indices[0],
      bbox,
    };
  }
  const split = splitCandidatesFor(indices)[0];
  if (!split) {
    throw new Error(`Cannot split BSP group: ${indices.map((index) => sectors[index].id).join(", ")}`);
  }
  const child0 = bspFor(split.child0);
  const child1 = bspFor(split.child1);
  const index = nodes.length;
  const lineBox = bboxFor(indices);
  nodes.push({
    axis: split.axis,
    coordinate: split.coordinate,
    bounds: lineBox,
    child0,
    child1,
  });
  return {
    ref: index,
    bbox,
  };
};

bspFor(sectors.map((_, index) => index));

const buildThings = () =>
  Buffer.concat(things.map(({ x, y, angle, type, options }) => record(i16(x), i16(y), i16(angle), i16(type), i16(options))));

const buildVertexes = () => Buffer.concat(vertices.map(([x, y]) => record(i16(x), i16(y))));

const buildSideDefs = () =>
  Buffer.concat(
    sidedefs.map(({ sectorIndex, textureOffset, topTexture, bottomTexture, midTexture }) =>
      record(i16(textureOffset), i16(0), ascii8(topTexture), ascii8(bottomTexture), ascii8(midTexture), i16(sectorIndex))
    )
  );

const buildLineDefs = () =>
  Buffer.concat(
    linedefs.map(({ v1, v2, flags, special, tag, frontSide, backSide }) =>
      record(u16(v1), u16(v2), u16(flags), u16(special), u16(tag), i16(frontSide), i16(backSide))
    )
  );

const buildSegs = () =>
  Buffer.concat(
    segs.map(({ v1, v2, angle, linedef, side }) =>
      record(u16(v1), u16(v2), u16(angle), u16(linedef), u16(side), u16(0))
    )
  );

const buildSubsectors = () =>
  Buffer.concat(subsectors.map(({ numSegs, firstSeg }) => record(u16(numSegs), u16(firstSeg))));

const buildSectors = () =>
  Buffer.concat(
    sectors.map(({ floor, ceiling, floorFlat, ceilingFlat, light, special, tag }) =>
      record(i16(floor), i16(ceiling), ascii8(floorFlat), ascii8(ceilingFlat), i16(light), i16(special ?? 0), i16(tag ?? 0))
    )
  );

const bboxRecord = ({ x1, y1, x2, y2 }) => record(i16(y2), i16(y1), i16(x1), i16(x2));

const buildNodes = () =>
  Buffer.concat(
    nodes.map(({ axis, coordinate, bounds, child0, child1 }) => {
      const partition = axis === "x"
        ? record(i16(coordinate), i16(bounds.y1), i16(0), i16(bounds.y2 - bounds.y1))
        : record(i16(bounds.x1), i16(coordinate), i16(bounds.x2 - bounds.x1), i16(0));
      return record(partition, bboxRecord(child0.bbox), bboxRecord(child1.bbox), u16(child0.ref), u16(child1.ref));
    })
  );

const buildReject = () => Buffer.alloc(Math.ceil((sectors.length * sectors.length) / 8));

const buildBlockMap = () => {
  const minX = Math.min(...vertices.map(([x]) => x));
  const minY = Math.min(...vertices.map(([, y]) => y));
  const maxX = Math.max(...vertices.map(([x]) => x));
  const maxY = Math.max(...vertices.map(([, y]) => y));
  const originX = minX - 8;
  const originY = minY - 8;
  const width = Math.ceil((maxX - originX + 1) / 128);
  const height = Math.ceil((maxY - originY + 1) / 128);
  const blockCount = width * height;
  const sharedListOffset = 4 + blockCount;
  const offsets = Buffer.concat(Array.from({ length: blockCount }, () => u16(sharedListOffset)));
  const allLines = Buffer.concat([...linedefs.map((_, index) => u16(index)), i16(-1)]);
  return record(i16(originX), i16(originY), i16(width), i16(height), offsets, allLines);
};

const readWadLump = (wadBytes, lumpName) => {
  const numLumps = wadBytes.readInt32LE(4);
  const directoryOffset = wadBytes.readInt32LE(8);
  for (let index = 0; index < numLumps; index += 1) {
    const entry = directoryOffset + index * 16;
    const name = wadBytes.subarray(entry + 8, entry + 16).toString("ascii").replace(/\0.*$/, "").trim();
    if (name === lumpName) {
      const offset = wadBytes.readInt32LE(entry);
      const size = wadBytes.readInt32LE(entry + 4);
      return Buffer.from(wadBytes.subarray(offset, offset + size));
    }
  }
  throw new Error(`Missing ${lumpName} in ${baseIwadPath}`);
};

const glyphs = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "%": ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
};

const drawRect = (pixels, width, height, x1, y1, x2, y2, color) => {
  for (let y = Math.max(0, y1); y < Math.min(height, y2); y += 1) {
    for (let x = Math.max(0, x1); x < Math.min(width, x2); x += 1) {
      pixels[y * width + x] = color;
    }
  }
};

const buildPatch = (pixels, width, height, {
  leftOffset = 0,
  topOffset = 0,
  transparent,
} = {}) => {
  const headerSize = 8 + width * 4;
  const columns = [];
  let offset = headerSize;
  const header = record(i16(width), i16(height), i16(leftOffset), i16(topOffset));
  const offsets = Buffer.alloc(width * 4);
  for (let x = 0; x < width; x += 1) {
    offsets.writeInt32LE(offset, x * 4);
    const posts = [];
    let y = 0;
    while (y < height) {
      while (y < height && pixels[y * width + x] === transparent) {
        y += 1;
      }
      if (y >= height) {
        break;
      }
      const top = y;
      const columnPixels = [];
      while (y < height && pixels[y * width + x] !== transparent && columnPixels.length < 254) {
        columnPixels.push(pixels[y * width + x]);
        y += 1;
      }
      posts.push(record(
        Buffer.from([top, columnPixels.length, 0]),
        Buffer.from(columnPixels),
        Buffer.from([0])
      ));
    }
    const column = record(...posts, Buffer.from([255]));
    columns.push(column);
    offset += column.length;
  }
  return record(header, offsets, ...columns);
};

const textWidthFor = (text, scale) => text.length * 5 * scale + Math.max(0, text.length - 1) * scale;

const drawCenteredText = (pixels, width, height, text, y, maxScale, color, left = 0, right = width) => {
  let scale = maxScale;
  while (scale > 1 && textWidthFor(text, scale) > right - left - 8) {
    scale -= 1;
  }
  const startX = Math.floor(left + (right - left - textWidthFor(text, scale)) / 2);
  [...text].forEach((character, characterIndex) => {
    const glyph = glyphs[character];
    if (!glyph) {
      throw new Error(`Missing label glyph for ${character}`);
    }
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, pixelIndex) => {
        if (pixel === "1") {
          const x = startX + characterIndex * 6 * scale + pixelIndex * scale;
          const pixelY = y + rowIndex * scale;
          drawRect(pixels, width, height, x + 1, pixelY + 1, x + scale + 1, pixelY + scale + 1, 8);
          drawRect(pixels, width, height, x, pixelY, x + scale, pixelY + scale, color);
        }
      });
    });
  });
};

const buildLabelPatch = (text, color) => {
  const { width, height } = labelTextureSize;
  const panelWidth = doorWidth;
  const panelLeft = Math.floor((width - panelWidth) / 2);
  const panelRight = panelLeft + panelWidth;
  const pixels = new Uint8Array(width * height);
  pixels.fill(5);
  drawRect(pixels, width, height, panelLeft + 4, 0, panelRight - 4, height, 0);
  drawRect(pixels, width, height, panelLeft + 4, 0, panelLeft + 8, height, 96);
  drawRect(pixels, width, height, panelRight - 8, 0, panelRight - 4, height, 96);

  const scale = text.length > 6 ? 2 : 3;
  const startY = Math.floor((height - 7 * scale) / 2);
  drawCenteredText(pixels, width, height, text, startY, scale, color);
  return buildPatch(pixels, width, height);
};

// A short, wide plate for the free-standing floor placards at each CPU sub-area
// entrance: a metal frame around a dark panel with the green area name. Drawn on
// the placard block's low riser, so it must be short (matches signTextureSize).
const buildSignPatch = (text) => {
  const { width, height } = signTextureSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(96);
  drawRect(pixels, width, height, 5, 5, width - 5, height - 5, 0);
  const scale = text.length > 6 ? 4 : 5;
  const startY = Math.floor((height - 7 * scale) / 2);
  drawCenteredText(pixels, width, height, text, startY, scale, signTextColor, 10, width - 10);
  return buildPatch(pixels, width, height);
};

const buildTerminalPatch = ({ lines }) => {
  const { width, height } = terminalTextureSize;
  const screenTop = 8;
  const screenBottom = height - 8;
  const pixels = new Uint8Array(width * height);
  pixels.fill(5);
  // Bezel + dark screen.
  drawRect(pixels, width, height, 6, screenTop - 2, width - 6, screenBottom + 2, 96);
  drawRect(pixels, width, height, 10, screenTop + 2, width - 10, screenBottom - 2, 8);
  drawRect(pixels, width, height, 14, screenTop + 6, width - 14, screenBottom - 6, 0);
  // Simulated console output, then blurred so the individual glyphs can't be
  // read -- it reads as out-of-focus streaming logs. We rasterise gibberish
  // monospace text (left-aligned, ragged right) into an intensity buffer,
  // box-blur it (more horizontally, so log lines stay separate), and map the
  // intensity onto Doom's green ramp (112 bright -> ~124 dim), leaving the
  // screen black where there is no text. Seeded from the screen name
  // (mulberry32) for stable, per-terminal output.
  let a = 0;
  for (const ch of lines.join("|")) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Only glyphs the font actually has (no B/F/H/J/X).
  const pool = "ACDEGIKLMNOPQRSTUVWYZ0123456789:/.-%=_".split("");
  const left = 16;
  const charW = 6;
  const lineH = 9;
  const maxCols = Math.floor((width - 16 - left) / charW);
  const ink = new Float32Array(width * height);
  const mark = (x, y) => {
    if (x >= 0 && x < width && y >= 0 && y < height) ink[y * width + x] = 1;
  };
  const stampGlyph = (ch, gx, gy) => {
    glyphs[ch].forEach((row, ri) => {
      for (let ci = 0; ci < 5; ci += 1) if (row[ci] === "1") mark(gx + ci, gy + ri);
    });
  };
  let cursorX = null;
  let cursorY = 0;
  for (let y = screenTop + 8; y + 7 <= screenBottom - 6; y += lineH) {
    if (rand() < 0.12) continue; // occasional blank line for rhythm
    const cols = 2 + Math.floor(rand() * (maxCols - 2)); // ragged right: variable length
    let c = 0;
    while (c < cols) {
      const wordLen = Math.min(2 + Math.floor(rand() * 8), cols - c);
      for (let i = 0; i < wordLen; i += 1) {
        stampGlyph(pool[Math.floor(rand() * pool.length)], left + c * charW, y);
        c += 1;
      }
      c += 1; // space between words
    }
    cursorX = left + Math.min(c, maxCols) * charW;
    cursorY = y;
  }
  if (cursorX !== null)
    for (let yy = 0; yy < 7; yy += 1) for (let xx = 0; xx < 4; xx += 1) mark(cursorX + xx, cursorY + yy);
  // Separable box blur (horizontal radius rx, vertical radius ry).
  const blur = (rx, ry) => {
    if (rx > 0) {
      const t = new Float32Array(ink.length);
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          let s = 0;
          let n = 0;
          for (let k = -rx; k <= rx; k += 1) {
            const xx = x + k;
            if (xx >= 0 && xx < width) { s += ink[y * width + xx]; n += 1; }
          }
          t[y * width + x] = s / n;
        }
      ink.set(t);
    }
    if (ry > 0) {
      const t = new Float32Array(ink.length);
      for (let x = 0; x < width; x += 1)
        for (let y = 0; y < height; y += 1) {
          let s = 0;
          let n = 0;
          for (let k = -ry; k <= ry; k += 1) {
            const yy = y + k;
            if (yy >= 0 && yy < height) { s += ink[yy * width + x]; n += 1; }
          }
          t[y * width + x] = s / n;
        }
      ink.set(t);
    }
  };
  blur(2, 1);
  blur(2, 1);
  let peak = 0;
  for (let i = 0; i < ink.length; i += 1) if (ink[i] > peak) peak = ink[i];
  if (peak > 0) {
    const sx0 = 15;
    const sy0 = screenTop + 7;
    const sx1 = width - 15;
    const sy1 = screenBottom - 7;
    for (let y = sy0; y < sy1; y += 1)
      for (let x = sx0; x < sx1; x += 1) {
        const v = ink[y * width + x] / peak;
        if (v < 0.15) continue;
        pixels[y * width + x] = Math.min(124, 112 + Math.round((1 - v) * 13));
      }
  }
  return buildPatch(pixels, width, height);
};

const buildCpuColumnPatch = () => {
  const { width, height } = labelTextureSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(96);
  drawRect(pixels, width, height, 0, 0, width, 8, 96);
  drawRect(pixels, width, height, 0, height - 8, width, height, 96);
  for (let x = 0; x < width; x += 32) {
    drawRect(pixels, width, height, x, 0, x + 4, height, 0);
    drawRect(pixels, width, height, x + 28, 0, x + 32, height, 0);
    drawRect(pixels, width, height, x + 4, 12, x + 28, height - 12, 8);
    drawRect(pixels, width, height, x + 7, 12, x + 25, height - 12, 112);
    drawRect(pixels, width, height, x + 9, 16, x + 23, height - 16, 5);
    [200, 112, 231, 176].forEach((color, thread) => {
      const threadX = x + 11 + thread * 3;
      for (let y = 18 + thread * 5; y < height - 18; y += 28) {
        drawRect(pixels, width, height, threadX + 1, y + 2, threadX + 3, y + 18, 8);
        drawRect(pixels, width, height, threadX, y, threadX + 2, y + 16, color);
      }
    });
  }
  for (let y = 24; y < height - 24; y += 48) {
    drawRect(pixels, width, height, 0, y, width, y + 4, 0);
    drawRect(pixels, width, height, 0, y + 4, width, y + 6, 96);
  }
  return buildPatch(pixels, width, height);
};

// Rack-mounted server panel for the wall below the terminal screens. Gray metal
// split by horizontal rack seams into stacked units, each carrying an irregular,
// non-repeating mix of equipment -- black mini-screens with green data, amber/
// green/red LED clusters, vent slots, label plates and bare metal -- placed by a
// seeded RNG so it reads as real gear rather than a uniform decorative pattern.
// 256 wide -> spans the whole riser once (via flowOffsetFor), so nothing repeats.
const buildControlPanelPatch = () => {
  const { width: W, height: H } = controlPanelTextureSize; // 256 x 32
  const px = new Uint8Array(W * H);
  px.fill(96); // gray rack metal
  const R = (x, y, w, h, c) => drawRect(px, W, H, x, y, x + w, y + h, c);
  let a = 0x1a2b3c4d | 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const screen = (x, w, y0, y1) => {                 // black mini-screen, green data
    R(x, y0, w, y1 - y0, 8); R(x + 1, y0 + 1, w - 2, y1 - y0 - 2, 0);
    for (let gx = x + 2; gx < x + w - 2;) {
      const bw = 1 + Math.floor(rnd() * 3);
      if (rnd() > 0.25) { const bh = 1 + Math.floor(rnd() * (y1 - y0 - 4)); R(gx, y1 - 2 - bh, bw, bh, rnd() > 0.4 ? 112 : 118); }
      gx += bw + 1;
    }
  };
  const leds = (x, w, y0, y1) => {                   // recessed bar of small lamps
    const my = y0 + Math.max(0, Math.floor((y1 - y0 - 4) / 2));
    R(x, my, w, 4, 8);
    for (let lx = x + 2; lx < x + w - 2; lx += 4) if (rnd() > 0.3) R(lx, my + 1, 2, 2, pick([231, 231, 112, 176]));
  };
  const vent = (x, w, y0, y1) => { for (let yy = y0 + 1; yy < y1 - 1; yy += 2) R(x, yy, w, 1, 0); };
  const label = (x, w, y0, y1) => { R(x, y0, w, y1 - y0, 8); R(x, y0, w, 1, 96); R(x + 2, y0 + 3, w - 5, 1, 5); R(x + 2, y0 + 5, Math.floor((w - 4) / 2), 1, 5); };
  const fillRow = (y0, y1) => {
    let x = 2 + Math.floor(rnd() * 8);
    while (x < W - 10) {
      const type = pick(["screen", "screen", "leds", "leds", "vent", "label", "blank", "screen"]);
      const w = Math.min(12 + Math.floor(rnd() * 38), W - 4 - x);
      if (w < 8) break;
      if (type === "screen") screen(x, w, y0, y1);
      else if (type === "leds") leds(x, w, y0, y1);
      else if (type === "vent") vent(x, w, y0, y1);
      else if (type === "label") label(x, w, y0, y1);
      else { R(x + 1, y0, 1, 1, 8); R(x + w - 2, y1 - 1, 1, 1, 8); } // bare metal + screws
      x += w + 3 + Math.floor(rnd() * 10);
    }
  };
  fillRow(2, 13);
  fillRow(16, 27);
  // Rack seams: top edge, the unit divider, and a ventilation grille along the base.
  R(0, 0, W, 1, 0); R(0, 1, W, 1, 8);
  R(0, 13, W, 1, 8); R(0, 14, W, 1, 0); R(0, 15, W, 1, 8);
  R(0, 27, W, 1, 8);
  for (let yy = 28; yy < H; yy += 2) { R(0, yy, W, 1, 0); R(0, yy + 1, W, 1, 8); }
  return buildPatch(px, W, H);
};

// ===== Floor name inscriptions (custom flats) =====
// Doom can only add floor flats by re-bundling every stock flat into the map's
// own F_START..F_END (R_InitFlats keys off the last F_START/F_END markers), so
// we copy the IWAD flats and append our generated text flats.
const FLAT_DIM = 64;

const readIwadFlats = () => {
  const wad = readFileSync(baseIwadPath);
  const numLumps = wad.readInt32LE(4);
  const dirOff = wad.readInt32LE(8);
  const entries = [];
  for (let i = 0; i < numLumps; i += 1) {
    const e = dirOff + i * 16;
    const name = wad.subarray(e + 8, e + 16).toString("ascii").replace(/\0.*$/, "").trim();
    entries.push({ name, offset: wad.readInt32LE(e), size: wad.readInt32LE(e + 4) });
  }
  const start = entries.findIndex((x) => x.name === "F_START");
  const end = entries.findIndex((x) => x.name === "F_END");
  return entries.slice(start + 1, end).map(({ name, offset, size }) =>
    lump(name, Buffer.from(wad.subarray(offset, offset + size)))
  );
};

// Build the 64x64 floor flats for a name inscription: the green name on a dark
// high-contrast panel. Doom samples floor flats at
// flat[((-worldY)&63)*64 + (worldX&63)] (note the negated Y), so we map each
// flat pixel back to a world position and then to the text image, oriented for
// the cardinal direction the reading player faces. Cells run along the player's
// left->right axis (worldX for a north/south view, worldY for east/west).
const inscriptionFontScale = 2;
const renderInscriptionText = (text, readLen) => {
  const img = new Uint8Array(readLen * FLAT_DIM); // 0 = black background
  const startY = Math.floor((FLAT_DIM - 7 * inscriptionFontScale) / 2);
  drawCenteredText(img, readLen, FLAT_DIM, text, startY, inscriptionFontScale, signTextColor, 4, readLen - 4);
  return img; // T[letterRow][readPos] = img[letterRow * readLen + readPos]
};
const makeInscription = (prefix, text, facing, cells) => {
  const readLen = cells * FLAT_DIM;
  const T = renderInscriptionText(text, readLen);
  const sample = (letterRow, readPos) =>
    readPos < 0 || readPos >= readLen || letterRow < 0 || letterRow >= FLAT_DIM
      ? 0
      : T[letterRow * readLen + readPos];
  const horiz = facing === "north" || facing === "south";
  const rectW = horiz ? readLen : FLAT_DIM;
  const rectH = horiz ? FLAT_DIM : readLen;
  // World-local (wx,wy) -> text pixel, oriented so the name reads upright with
  // its top away from the approaching player.
  const at = (wx, wy) => {
    if (facing === "north") return sample(rectH - 1 - wy, wx);
    if (facing === "south") return sample(wy, rectW - 1 - wx);
    if (facing === "west") return sample(wx, wy);
    return sample(FLAT_DIM - 1 - wx, rectH - 1 - wy); // east
  };
  const flats = [];
  const names = [];
  for (let k = 0; k < cells; k += 1) {
    const cellXoff = horiz ? k * FLAT_DIM : 0;
    const cellYoff = horiz ? 0 : k * FLAT_DIM;
    const flat = new Uint8Array(FLAT_DIM * FLAT_DIM);
    for (let r = 0; r < FLAT_DIM; r += 1)
      for (let c = 0; c < FLAT_DIM; c += 1)
        flat[r * FLAT_DIM + c] = at(cellXoff + c, cellYoff + ((FLAT_DIM - r) % FLAT_DIM));
    const name = `${prefix}${k}`;
    flats.push(lump(name, Buffer.from(flat)));
    names.push(name);
  }
  return { flats, names };
};

const iwadFlats = readIwadFlats();
// `facing` is the way the reading player looks as they approach each entrance:
// the core chamber from the south (looking north), the run-queue room from the
// east (looking west), the load room from the west (looking east).
const coreInscription = makeInscription("DPFCOR", "CPU CORES", "north", 4);
const rqInscription = makeInscription("DPFRQ", "RUN QUEUE", "west", 3);
const loadInscription = makeInscription("DPFLD", "LOAD", "east", 3);
const inscriptionFlats = [...coreInscription.flats, ...rqInscription.flats, ...loadInscription.flats];

const basePNames = readWadLump(readFileSync(baseIwadPath), "PNAMES");
const basePatchCount = basePNames.readInt32LE(0);
const labelConfigs = Object.values(resourceConfigs);
const textureConfigs = [
  ...labelConfigs.map(({ label, labelTexture, labelPatch, labelColor }) => ({
    texture: labelTexture,
    patch: labelPatch,
    build: () => buildLabelPatch(label, labelColor),
  })),
  {
    texture: cpuCoreWallTexture,
    patch: "DPLCOLM",
    build: buildCpuColumnPatch,
  },
  {
    texture: controlPanelTexture,
    patch: controlPanelPatch,
    width: controlPanelTextureSize.width,
    height: controlPanelTextureSize.height,
    build: buildControlPanelPatch,
  },
  ...Object.values(cpuTerminalScreens).map((config) => ({
    texture: config.texture,
    patch: config.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(config),
  })),
  ...Object.values(cpuAreaSigns).map((sign) => ({
    texture: sign.texture,
    patch: sign.patch,
    width: signTextureSize.width,
    height: signTextureSize.height,
    build: () => buildSignPatch(sign.text),
  })),
];

const buildPNames = () =>
  record(
    i32(basePatchCount + textureConfigs.length),
    basePNames.subarray(4),
    ...textureConfigs.map(({ patch }) => ascii8(patch))
  );

const buildTextureDefinition = ({ texture, width = labelTextureSize.width, height = labelTextureSize.height }, patchIndex) =>
  record(
    ascii8(texture),
    i32(0),
    i16(width),
    i16(height),
    i32(0),
    i16(1),
    i16(0),
    i16(0),
    i16(patchIndex),
    i16(1),
    i16(0)
  );

const buildTexture2 = () => {
  const definitions = textureConfigs.map((config, index) =>
    buildTextureDefinition(config, basePatchCount + index)
  );
  let offset = 4 + definitions.length * 4;
  const offsets = definitions.map((definition) => {
    const current = offset;
    offset += definition.length;
    return i32(current);
  });
  return record(i32(definitions.length), ...offsets, ...definitions);
};

const buildWad = (lumps) => {
  let fileOffset = 12;
  const directory = [];
  const body = Buffer.concat(
    lumps.map(({ name, data }) => {
      directory.push({ name, offset: fileOffset, size: data.length });
      fileOffset += data.length;
      return data;
    })
  );
  const directoryOffset = 12 + body.length;
  const header = Buffer.alloc(12);
  header.write("PWAD", 0, "ascii");
  header.writeInt32LE(lumps.length, 4);
  header.writeInt32LE(directoryOffset, 8);
  const directoryBuffer = Buffer.concat(
    directory.map(({ name, offset, size }) => {
      const entry = Buffer.alloc(16);
      entry.writeInt32LE(offset, 0);
      entry.writeInt32LE(size, 4);
      ascii8(name).copy(entry, 8);
      return entry;
    })
  );
  return record(header, body, directoryBuffer);
};

const mapLumps = [
  lump("PNAMES", buildPNames()),
  ...textureConfigs.map(({ patch, build }) => lump(patch, build())),
  lump("TEXTURE2", buildTexture2()),
  lump("F_START"),
  ...iwadFlats,
  ...inscriptionFlats,
  lump("F_END"),
  lump("E1M1"),
  lump("THINGS", buildThings()),
  lump("LINEDEFS", buildLineDefs()),
  lump("SIDEDEFS", buildSideDefs()),
  lump("VERTEXES", buildVertexes()),
  lump("SEGS", buildSegs()),
  lump("SSECTORS", buildSubsectors()),
  lump("NODES", buildNodes()),
  lump("SECTORS", buildSectors()),
  lump("REJECT", buildReject()),
  lump("BLOCKMAP", buildBlockMap()),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buildWad(mapLumps));
console.log(`Wrote ${outputPath}`);

// Emit the interaction manifest the browser UI consumes (terminal read-points
// and hub-door probes), derived from the same constants that lay out the map.
// This is the single source of truth for those coordinates: src/index.ts reads
// this file instead of re-hardcoding values that silently drift when the map
// layout changes (e.g. when a terminal moves to a new back wall).
const terminalReadOffset = 60; // a wall terminal is read from ~this far in front (< useRange)
const doorOuterRadius = 448;   // a hub door sector spans hubRadius..doorOuterRadius
const roomCenterU = (room) => (room.u1 + room.u2) / 2;
const doorProbeRadius = hubRadius + (doorOuterRadius - hubRadius) / 2;
const mapManifest = {
  useRange: 64,          // engine USERANGE (linuxdoom p_local.h) — USE trace reach
  doorOpenThreshold: 16, // ceiling lift past which a DR door reads as already open
  // CPU/north-wing terminal screens sit centred on each room's back wall; the
  // player reads them from terminalReadOffset units in front (south).
  terminals: [
    { sign: "cores", x: roomCenterU(cpuRoomBounds.main), y: cpuRoomBounds.main.v2 - terminalReadOffset },
    { sign: "runqueue", x: roomCenterU(cpuRoomBounds.runQueue), y: cpuRoomBounds.runQueue.v2 - terminalReadOffset },
    { sign: "load", x: roomCenterU(cpuRoomBounds.load), y: cpuRoomBounds.load.v2 - terminalReadOffset },
  ],
  // Four hub doors, one per cardinal exit, on the trigger line at hubRadius; the
  // probe point sits at the centre of the door sector just beyond it.
  doors: [
    { x: 0, y: hubRadius, probeX: 0, probeY: doorProbeRadius },
    { x: hubRadius, y: 0, probeX: doorProbeRadius, probeY: 0 },
    { x: 0, y: -hubRadius, probeX: 0, probeY: -doorProbeRadius },
    { x: -hubRadius, y: 0, probeX: -doorProbeRadius, probeY: 0 },
  ],
};
const manifestPath = fileURLToPath(new URL("../src/doomperf-map-manifest.ts", import.meta.url));
writeFileSync(
  manifestPath,
  "// GENERATED by scripts/build-doomperf-map.mjs — do not edit by hand.\n" +
    "// Map interaction geometry shared with the browser UI (src/index.ts).\n" +
    `export const mapManifest = ${JSON.stringify(mapManifest, null, 2)} as const;\n`
);
console.log(`Wrote ${manifestPath}`);
