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
  main: { u1: -320, v1: 896, u2: 320, v2: 1496 },
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
  areaRect(direction, "foyer", { u1: -320, v1: 704, u2: 320, v2: hasCpuCoreDisplay ? cpuRoomBounds.main.v1 : 960 }, {
    ...base,
    kind: "foyer",
    light: 216,
  });
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
    areaRect(direction, "main-frame-south", { u1: cpuRoomBounds.main.u1, v1: cpuRoomBounds.main.v1, u2: cpuRoomBounds.main.u2, v2: ringV0 }, frame);
    areaRect(direction, "main-frame-north-west", { u1: cpuRoomBounds.main.u1, v1: ringV0 + ringCells * ringCell, u2: -128, v2: cpuRoomBounds.main.v2 }, frame);
    areaRect(direction, "main-terminal", { u1: -128, v1: ringV0 + ringCells * ringCell, u2: 128, v2: cpuRoomBounds.main.v2 }, {
      ...frame,
      labelSide: "top",
      labelTexture: cpuTerminalScreens.core.texture,
    });
    areaRect(direction, "main-frame-north-east", { u1: 128, v1: ringV0 + ringCells * ringCell, u2: cpuRoomBounds.main.u2, v2: cpuRoomBounds.main.v2 }, frame);
    areaRect(direction, "main-frame-west", { u1: cpuRoomBounds.main.u1, v1: ringV0, u2: ringU0, v2: ringV0 + ringCells * ringCell }, frame);
    areaRect(direction, "main-frame-east", { u1: ringU0 + ringCells * ringCell, v1: ringV0, u2: cpuRoomBounds.main.u2, v2: ringV0 + ringCells * ringCell }, frame);
    // 5x5 platform grid: pillar cells (solid streak columns, tagged 101+i for
    // the renderer and 201+i for the sink hook) and walkway/gap cells.
    const ringFloor = {
      ...accent,
      kind: "core-grid",
      wall: cpuCoreWallTexture,
      floorFlat: "FLOOR1_7",
      ceiling: 288,
      ceilingFlat: "CEIL5_2",
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
    areaRect(direction, "rq-entry", {
      u1: cpuRoomBounds.runQueue.u2,
      v1: cpuRoomBounds.sideEntry.v1,
      u2: cpuRoomBounds.main.u1,
      v2: cpuRoomBounds.sideEntry.v2,
    }, corridor);
    areaRect(direction, "load-entry", {
      u1: cpuRoomBounds.main.u2,
      v1: cpuRoomBounds.sideEntry.v1,
      u2: cpuRoomBounds.load.u1,
      v2: cpuRoomBounds.sideEntry.v2,
    }, corridor);
    // ===== LEFT room: RUN QUEUE conveyor (light 144) + sky window =====
    const runQueueFloor = {
      ...base,
      kind: "run-queue",
      wall: "METAL1",
      floorFlat: "FLOOR1_7",
      ceilingFlat: "CEIL5_1",
      light: cpuRunQueueDisplay.light,
    };
    areaRect(direction, "rq-room-west", { ...cpuRoomBounds.runQueue, u2: -704 }, runQueueFloor);
    areaRect(direction, "rq-terminal", { ...cpuRoomBounds.runQueue, u1: -704, u2: -448 }, {
      ...runQueueFloor,
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
    areaRect(direction, "load-terminal", { u1: 448, v1: 1240, u2: 704, v2: cpuRoomBounds.load.v2 }, {
      ...loadWalk,
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
    // Decorative torches stay in the corners so the side entries and wall
    // terminal screens have clear sightlines and walk-up space.
    addAreaThing(direction, 46, -288, 936);
    addAreaThing(direction, 46, 288, 936);
    addAreaThing(direction, 46, -288, 1456);
    addAreaThing(direction, 46, 288, 1456);
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

const sideTextures = (sector, other, overrideTexture) => {
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
      top: room && room.kind === "hub" ? doorTextureFor(sector, other) : (room ? room.wall : "-"),
      bottom: "-",
      mid: "-",
    };
  }
  const floorStep = sector.floor !== other.floor;
  const ceilingStep = sector.ceiling !== other.ceiling && sector.ceilingFlat !== "F_SKY1" && other.ceilingFlat !== "F_SKY1";
  let bottom = "-";
  if (floorStep) {
    if (other.kind === "core-column" || other.kind === "load-gauge") bottom = other.wall;
    else if (sector.kind === "core-column" || sector.kind === "load-gauge") bottom = sector.wall;
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

const textureOffsetFor = (edge, sector, other, overrideTexture) => {
  if (isDoorPair(sector, other)) return doorTextureOffsetFor(edge, sector, other);
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
  const frontTextures = sideTextures(front, back, frontEdge.overrideTexture);
  const frontSide = sidedef(
    sectors.indexOf(front),
    frontTextures.top,
    frontTextures.bottom,
    frontTextures.mid,
    textureOffsetFor(frontEdge, front, back, frontEdge.overrideTexture)
  );
  const backTextures = back ? sideTextures(back, front, backEdge.overrideTexture) : undefined;
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

const buildTerminalPatch = ({ lines, labelColor, role }) => {
  const { width, height } = labelTextureSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(5);

  drawRect(pixels, width, height, 10, 12, width - 10, height - 10, 8);
  drawRect(pixels, width, height, 6, 8, width - 14, height - 14, 96);
  drawRect(pixels, width, height, 14, 16, width - 22, height - 22, 0);
  drawRect(pixels, width, height, 20, 22, width - 28, 28, labelColor);
  drawRect(pixels, width, height, 20, height - 34, width - 28, height - 28, 96);

  [
    [15, 17],
    [width - 32, 17],
    [15, height - 36],
    [width - 32, height - 36],
  ].forEach(([x, y]) => {
    drawRect(pixels, width, height, x, y, x + 8, y + 8, 231);
    drawRect(pixels, width, height, x + 2, y + 2, x + 6, y + 6, 96);
  });

  drawCenteredText(pixels, width, height, lines[0], 54, 2, 200, 28, width - 36);
  drawCenteredText(pixels, width, height, lines[1], 80, 2, labelColor, 28, width - 36);
  drawCenteredText(pixels, width, height, "READY", 126, 1, 112, 28, width - 36);

  if (role === "utilization") {
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const x = 76 + column * 28;
        const y = 108 + row * 12;
        const color = [200, 112, 231, labelColor][(row * 4 + column) % 4];
        drawRect(pixels, width, height, x + 2, y + 2, x + 18, y + 9, 8);
        drawRect(pixels, width, height, x, y, x + 16, y + 7, color);
      }
    }
  } else {
    [0, 1, 2, 3, 4].forEach((bar) => {
      const x = 70 + bar * 24;
      const barHeight = 10 + bar * 4;
      drawRect(pixels, width, height, x + 2, 120 - barHeight + 2, x + 14, 122, 8);
      drawRect(pixels, width, height, x, 120 - barHeight, x + 12, 120, bar % 2 ? labelColor : 231);
    });
  }

  drawRect(pixels, width, height, width - 48, height - 30, width - 36, height - 28, 112);
  drawRect(pixels, width, height, width - 35, height - 30, width - 28, height - 28, labelColor);
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
  ...Object.values(cpuTerminalScreens).map((config) => ({
    texture: config.texture,
    patch: config.patch,
    build: () => buildTerminalPatch(config),
  })),
];

const buildPNames = () =>
  record(
    i32(basePatchCount + textureConfigs.length),
    basePNames.subarray(4),
    ...textureConfigs.map(({ patch }) => ascii8(patch))
  );

const buildTextureDefinition = (textureName, patchIndex) =>
  record(
    ascii8(textureName),
    i32(0),
    i16(labelTextureSize.width),
    i16(labelTextureSize.height),
    i32(0),
    i16(1),
    i16(0),
    i16(0),
    i16(patchIndex),
    i16(1),
    i16(0)
  );

const buildTexture2 = () => {
  const definitions = textureConfigs.map(({ texture }, index) =>
    buildTextureDefinition(texture, basePatchCount + index)
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
