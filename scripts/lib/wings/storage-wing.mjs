// Storage wing (south): a steampunk I/O tower. Rebuilt from the old descending
// engine-pit hall into a SQUARE-SPIRAL STAIRCASE that ascends one loop around a
// central column; the column's top is the spinning-disk PLATTER (the utilization
// instrument), revealed at the summit under open sky. The wing's other three
// instruments live in hallways branching off the climb:
//
//   ascent      a square ring of 10 stepped sectors rising 24 units each, CCW
//               around the central column, from the entry foot to the summit.
//   PLATTER     the column top: a 5x5 concentric ring grid (utilization tags
//               620/621/622) that pulses/"spins" with disk %util, open to F_SKY1.
//   AWAIT hall  off an early east step: a bank of service-latency gauges
//               (one-sided MID walls, line tags 660/661/662).
//   THROUGHPUT  off the far step (occluded from the entrance by the column, so it
//     hall      never presents a long smeary sightline): pneumatic read/write
//               tube panels + IO RATE plaque + the iostat dashboard (line tag
//               663) + the iostat terminal screen at the dead end.
//   QUEUE hall  off a high west step: the recessed queue-depth trough (floor
//               display, light sentinel 134, sector tag 610).
//
// Why a spiral: the old straight hall presented a distant low-contrast far wall
// at a glancing angle, which the 320x200 software renderer (no mipmapping)
// undersamples into smear. A spiral around a column has no long receding
// sightline -- every view dead-ends on a near wall within ~160-320 units. See
// [[disk-spiral-smear-fix]], [[map-builder-architecture]],
// [[telemetry-terminal-seam]], [[wing-terminal-segment-rotation]].
//
// Live-instrument contracts preserved verbatim: platter tags 620/621/622 (scanned
// by DoomPerf_UpdatePlatter); await gauges = one-sided MID walls with line tags
// 660/661/662 + wall:gauge (NO labelSide -- a labelSide override would zero the
// tag, see lineTagFor); dashboard = line tag 663 on a two-sided LOWER texture;
// queue floor display = light 134 + sector tag 610 (its world bounds are hardcoded
// in patch 0023, updated to this wing's new trough box). The iostat terminal
// read-point is emitted by terminals() in WORLD coords.
import { addWingEntrance } from "./common.mjs";
import { reserved, wingName } from "./registry.mjs";
import {
  terminalTextureSize,
  wallSignSize,
  diskGaugeSize,
  serverRackTextureSize,
  storageDisplayTextureSize,
  buildTerminalPatch,
  buildWallSignPatch,
  buildDiskGaugePatch,
  buildServerRackPatch,
  buildStorageDisplayPatch,
  makeInscription,
} from "../textures.mjs";
import { buildPatch } from "../wad-bytes.mjs";

const ids = reserved.storage;
const tex = (suffix) => wingName("storage", suffix);

// labelSide / textureSide are stored in WORLD-frame sides; the wing thinks in
// local (u,v) sides and converts. (South is a 180-degree rotation: local "top"
// (+v, the deep/far side) -> world "bottom", local "right" (+u) -> world "left".)
const localSideToWorld = (direction, side) => {
  const turns = { north: 0, east: 1, south: 2, west: 3 }[direction];
  const sides = ["top", "right", "bottom", "left"];
  const index = sides.indexOf(side);
  if (turns === undefined || index === -1) {
    throw new Error(`Cannot rotate side ${side} for direction ${direction}`);
  }
  return sides[(index + turns) % sides.length];
};

// Custom WAD art, all under the reserved "DPD" prefix so it can't collide with
// the other wings' names.
const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["DISK IO", "SERVICE"] };
const signs = {
  read: { texture: tex("READ"), patch: tex("PRD"), text: "READ" },
  write: { texture: tex("WRITE"), patch: tex("PWR"), text: "WRITE" },
  rate: { texture: tex("RATE"), patch: tex("PRAT"), text: "IO RATE" },
  await: { texture: tex("AWAIT"), patch: tex("PAWT"), text: "AWAIT" },
};
const gauge = { texture: tex("GAUG"), patch: tex("PGAU") };
const tubeRead = { texture: tex("RTUB"), patch: tex("PRTU") };
const tubeWrite = { texture: tex("WTUB"), patch: tex("PWTU") };
const rack = { texture: tex("RACK"), patch: tex("PRCK") };
const display = { texture: tex("DASH"), patch: tex("PDSH") };

const tubeTextureSize = { width: 128, height: 128 };
const buildTubePatch = ({ capsule, glint }) => {
  const { width: W, height: H } = tubeTextureSize;
  const px = new Uint8Array(W * H);
  px.fill(8);
  const R = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) {
        px[yy * W + xx] = c;
      }
    }
  };
  R(0, 0, W, H, 96);
  R(4, 4, W - 8, H - 8, 0);
  [36, 84].forEach((cy, lane) => {
    R(10, cy - 13, W - 20, 26, 167); // brass tube clamp
    R(12, cy - 10, W - 24, 20, 8);
    R(14, cy - 8, W - 28, 16, 200); // blue glass
    R(14, cy - 7, W - 28, 3, 204);
    for (let x = 18 + lane * 12; x < W - 22; x += 32) {
      R(x, cy - 5, 18, 10, capsule);
      R(x + 2, cy - 7, 10, 2, glint);
      R(x + 15, cy - 4, 3, 8, 96);
    }
  });
  for (let x = 16; x < W - 16; x += 32) {
    R(x, 61, 18, 3, 167);
    R(x + 18, 58, 3, 9, 167);
  }
  return buildPatch(px, W, H);
};

// "IO VAULT" inscribed into the entry threshold floor. The reading player faces
// "south" (walks away from the hub into -y), so the south orientation is correct.
const ioInscription = makeInscription("DPDIO", "IO VAULT", "south", 4);
const southCell = (cells, k) => cells * 32 - 64 * (k + 1);

// ===== Tower grid (local u,v) =====
// A 4x4 grid of 160-unit cells; the central 2x2 (u[-160,160] x v[864,1184]) is
// the platter column, the 10 perimeter cells are the spiral steps. The body
// begins at v=704 (addWingEntrance's throat ends there).
const CW = 160; // column half-extent (the platter is 320x320)
const RING = 160; // ring step / hall width
const V0 = 704; // entry foot (hub-ward)
const VC1 = V0 + RING; // 864  column near edge
const VC2 = VC1 + 2 * CW; // 1184 column far edge
const V3 = VC2 + RING; // 1344 far outer edge

const RISE = 24; // Doom max auto-climb: one step per ring cell
const F_BASE = 0;
const C_TOWER = 304; // solid shaft ceiling over the climb
const C_SKY = 384; // platter sky ceiling (open shaft above the disk)
const PLATTER_FLOOR = 8 * RISE; // 192, flush with the west summit landing (walk-on)
const DRUM_FLOOR = PLATTER_FLOOR + 128; // 320: solid spindle-drum cap; 128-tall streak wall
// 96x96 spindle drum, centred on the platter (local u=0, v=1024 -> world 0,-1024,
// matching DOOMPERF_PLATTER_CX/CY in patch 0035).
const drumBox = { u1: -48, v1: 976, u2: 48, v2: 1072 };

// Throughput hall: panels mount on a floor==ceiling slot whose room-facing LOWER
// texture carries the art (128 tall, matching the tube/dashboard textures).
const TP_FLOOR = 5 * RISE; // 120, == far-landing step
const TP_CEIL = 280;
const TP_PANEL_Z = TP_FLOOR + 128; // 248: top of the 128-tall display band
const TP_BACK = V3 + 288; // 1632  terminal recess front
const TP_TERM_WALL = TP_BACK + 16; // 1648  screen face (one-sided dead end)
const SERVER_PANEL_HEIGHT = 64;

// Queue hall trough (south wing -> world (-u,-v)): local box below maps to world
// x[336,496], y[-1152,-1088]; patch 0023's R_DoomPerfDiskQueuePixel is updated to
// these bounds. Kept axis-aligned along u so the fill axis stays world-x.
const QUEUE_FLOOR = 7 * RISE; // 168, == step-w2
const queueTrough = { u1: -496, v1: 1088, u2: -336, v2: 1152 };

// Local half-width of the terminal screen (256-wide screen, centred on u=0).
const terminalHalfWidthLocal = terminalTextureSize.width / 2;

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, resource, base, accent } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top"); // far/deep wall (local +v)
  const eWall = localSideToWorld(direction, "right"); // local +u end wall

  // Shared styles. Steps use the bold base wall (BROWN96); the platter + halls are
  // the engine-room accent (BROWN1).
  const stepStyle = { ...base, kind: "pit-stair", floorFlat: "FLOOR0_3", ceilingFlat: "CEIL3_2", ceiling: C_TOWER };
  const platterStyle = { ...accent, ceiling: C_SKY, ceilingFlat: "F_SKY1" };
  const hallStyle = { ...accent, floorFlat: "FLOOR4_8", ceilingFlat: "CEIL5_1" };

  // ===== Spiral steps (CCW: entry -> east -> far -> west -> summit) =====
  // [id, u1, v1, u2, v2, stepIndex]; floor = stepIndex * RISE.
  const steps = [
    ["entry", -CW, V0, CW, 800, 0], // bottom centre, ahead of the IO VAULT band
    ["step-e0", CW, V0, CW + RING, VC1, 1],
    ["step-e1", CW, VC1, CW + RING, VC1 + 160, 2], // await hall mouth (+u)
    ["step-e2", CW, VC1 + 160, CW + RING, VC2, 3],
    ["step-ne", CW, VC2, CW + RING, V3, 4],
    ["far-landing", -CW, VC2, CW, V3, 5], // throughput hall mouth (+v)
    ["step-nw", -CW - RING, VC2, -CW, V3, 6],
    ["step-w2", -CW - RING, VC1 + 160, -CW, VC2, 7], // queue hall mouth (-u)
    // One wide summit landing (replaces the old w1+w0 corner): flush at 192 with
    // the platter's west edge so you walk straight onto the disk, no narrow step.
    ["west-landing", -CW - RING, V0, -CW, VC1 + 160, 8],
  ];
  steps.forEach(([id, u1, v1, u2, v2, k]) => {
    areaRect(direction, id, { u1, v1, u2, v2 }, {
      ...stepStyle,
      floor: F_BASE + k * RISE,
      light: 168 + k * 4, // subtle brighten toward the sky-lit summit (skips 160)
    });
  });

  // "IO VAULT" inscribed flush into the entry threshold band (u[-128,128],
  // v[800,864]); the foot sector ahead of it and the flanking strips keep the
  // band tiling without overlap.
  areaRect(direction, "entry-band-w", { u1: -CW, v1: 800, u2: -128, v2: VC1 }, { ...stepStyle, floor: F_BASE, light: 168 });
  areaRect(direction, "entry-band-e", { u1: 128, v1: 800, u2: CW, v2: VC1 }, { ...stepStyle, floor: F_BASE, light: 168 });
  ioInscription.names.forEach((flatName, k) => {
    const u1 = southCell(4, k);
    areaRect(direction, `entry-io-${k}`, { u1, v1: 800, u2: u1 + 64, v2: VC1 }, {
      ...stepStyle,
      floor: F_BASE,
      light: 168,
      floorFlat: flatName,
    });
  });

  // ===== The PLATTER: a flat painted disk floor at the summit, open to F_SKY1.
  // Light sentinel 130 makes R_DrawPlanes hand the floor to R_DoomPerfDiskPlatterPixel
  // (patch 0035), which paints concentric utilization tracks + a rotating throughput
  // read-head. Flush at 192 with the west landing so you walk straight on. Carved
  // into bands around the central spindle drum. (Replaces the old 5x5 ring grid;
  // tags 620/621/622 and the light-pulse hook are retired.)
  const platterFloor = {
    ...platterStyle,
    kind: "platter",
    floor: PLATTER_FLOOR,
    floorFlat: "FLOOR0_3",
    light: ids.lights[0], // 130: platter floor-display sentinel
  };
  areaRect(direction, "platter-s", { u1: -CW, v1: VC1, u2: CW, v2: drumBox.v1 }, platterFloor);
  areaRect(direction, "platter-n", { u1: -CW, v1: drumBox.v2, u2: CW, v2: VC2 }, platterFloor);
  areaRect(direction, "platter-w", { u1: -CW, v1: drumBox.v1, u2: drumBox.u1, v2: drumBox.v2 }, platterFloor);
  areaRect(direction, "platter-e", { u1: drumBox.u2, v1: drumBox.v1, u2: CW, v2: drumBox.v2 }, platterFloor);
  // The central SPINDLE drum: a solid 128-tall pillar; its lower (two-sided) wall
  // faces carry the throughput streaks (line tag 664, painted on the bottom surface
  // by R_DoomPerfDiskSpindlePixel). The fill height rises with %util.
  areaRect(direction, "spindle-drum", drumBox, {
    ...platterStyle,
    kind: "spindle",
    floor: DRUM_FLOOR,
    ceiling: DRUM_FLOOR, // solid pillar
    floorFlat: "FLOOR0_3",
    wall: "METAL1",
    light: 200,
    lineTag: ids.lineTags[0] + 4, // 664: spindle throughput streaks
  });

  // ===== AWAIT hall (off step-e1, floor 48): a latency-gauge bank. =====
  // Each gauge is a dead-end recess whose one-sided MID walls carry wall:gauge +
  // lineTag 660/661/662 (NO labelSide, or lineTagFor would zero the tag). AWAIT
  // is named on the hall's far end wall via labelSide.
  const F_AWAIT = 2 * RISE; // 48
  const awaitStyle = { ...hallStyle, floor: F_AWAIT, ceiling: F_AWAIT + 128, light: 192 };
  areaRect(direction, "await-hall", { u1: CW + RING, v1: VC1, u2: 512, v2: VC1 + 160 }, {
    ...awaitStyle,
    kind: "pit-sign",
    labelSide: eWall, // far end wall (local +u) carries the AWAIT placard
    labelTexture: signs.await.texture,
  });
  const gaugeRecess = (id, bounds, k) =>
    areaRect(direction, id, bounds, { ...awaitStyle, kind: "delay-gauge", wall: gauge.texture, lineTag: ids.lineTags[0] + k });
  gaugeRecess("await-gauge-0", { u1: 344, v1: 816, u2: 408, v2: VC1 }, 0); // 660 (-v side)
  gaugeRecess("await-gauge-1", { u1: 424, v1: 816, u2: 488, v2: VC1 }, 1); // 661 (-v side)
  gaugeRecess("await-gauge-2", { u1: 384, v1: VC1 + 160, u2: 448, v2: VC1 + 160 + 48 }, 2); // 662 (+v side)

  // ===== THROUGHPUT hall (off far-landing, floor 120): pneumatic tubes + iostat
  // dashboard + terminal. Occluded from the entrance by the platter column. =====
  areaRect(direction, "tp-hall", { u1: -CW, v1: V3, u2: CW, v2: TP_BACK }, {
    ...hallStyle,
    kind: "metric-hall",
    floor: TP_FLOOR,
    ceiling: TP_CEIL,
    light: 184,
  });
  // Wall-mounted display panels: a floor==ceiling slot whose room-facing LOWER
  // texture is the art (textureSide picks the room face; sideWall caps the rest).
  const panel = (id, bounds, texture, textureSide, extra = {}) =>
    areaRect(direction, id, bounds, {
      ...hallStyle,
      kind: "metric-display",
      floor: TP_PANEL_Z,
      ceiling: TP_PANEL_Z,
      floorFlat: "FLOOR0_3",
      wall: texture,
      sideWall: accent.wall,
      textureSide,
      light: 192,
      ...extra,
    });
  // West wall (room face = world "left"): IO RATE plaque, then read/write tubes.
  panel("tp-rate", { u1: -CW - 16, v1: V3 + 32, u2: -CW, v2: V3 + 96 }, signs.rate.texture, "left");
  panel("tp-read", { u1: -CW - 16, v1: V3 + 96, u2: -CW, v2: V3 + 168 }, tubeRead.texture, "left");
  panel("tp-write", { u1: -CW - 16, v1: V3 + 176, u2: -CW, v2: V3 + 248 }, tubeWrite.texture, "left");
  // East wall (room face = world "right"): the live iostat dashboard (line tag
  // 663 on its room-facing LOWER texture, 128 wide == storageDisplayTextureSize).
  panel("tp-dash", { u1: CW, v1: V3 + 56, u2: CW + 16, v2: V3 + 184 }, display.texture, "right", {
    lineTag: ids.lineTags[0] + 3, // 663
  });
  // East wall: the disk-server rack (easter egg), a shorter equipment panel.
  panel("tp-rack", { u1: CW, v1: V3 + 192, u2: CW + 16, v2: V3 + 256 }, rack.texture, "right", {
    kind: "server-rack",
    floor: TP_FLOOR + SERVER_PANEL_HEIGHT,
    ceiling: TP_FLOOR + SERVER_PANEL_HEIGHT,
  });
  // iostat terminal: a one-step lectern recess at the dead end; its far one-sided
  // wall carries the DISK IO screen (read-point wired in terminals()).
  areaRect(direction, "storage-terminal", { u1: -terminalHalfWidthLocal, v1: TP_BACK, u2: terminalHalfWidthLocal, v2: TP_TERM_WALL }, {
    ...hallStyle,
    kind: "terminal",
    floor: TP_FLOOR + 16,
    ceiling: TP_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: backWall, // far wall (local +v) = the screen
    labelTexture: screen.texture,
  });

  // ===== QUEUE hall (off step-w2, floor 168): the queue-depth trough. =====
  // The recessed channel floor uses light sentinel 134 + sector tag 610; patch
  // 0023 paints request blocks here, scaled by queue depth.
  // The hall floor is the brass rim; it's carved around the recessed trough.
  const rim = {
    ...hallStyle,
    kind: "queue-rim",
    floor: QUEUE_FLOOR,
    ceiling: QUEUE_FLOOR + 128,
    floorFlat: "FLOOR0_3",
    light: 184,
  };
  const QO1 = -512, QO2 = -CW - RING; // hall outer u-bounds: [-512, -320]
  areaRect(direction, "queue-rim-front", { u1: QO1, v1: VC1 + 160, u2: QO2, v2: queueTrough.v1 }, rim);
  areaRect(direction, "queue-rim-back", { u1: QO1, v1: queueTrough.v2, u2: QO2, v2: VC2 }, rim);
  areaRect(direction, "queue-rim-w", { u1: QO1, v1: queueTrough.v1, u2: queueTrough.u1, v2: queueTrough.v2 }, rim);
  areaRect(direction, "queue-rim-e", { u1: queueTrough.u2, v1: queueTrough.v1, u2: QO2, v2: queueTrough.v2 }, rim);
  areaRect(direction, "queue-channel", queueTrough, {
    ...hallStyle,
    kind: "queue",
    floor: QUEUE_FLOOR - 16,
    ceiling: QUEUE_FLOOR + 128,
    floorFlat: "FLOOR1_7",
    light: ids.lights[0] + 4, // 134: the r_plane queue-floor display sentinel
    tag: ids.sectorTags[0] + 10, // 610
  });

  // ===== Engine-room torches: amber flicker up the climb, set hard against the
  // outer walls (24u clearance > the 16u torch radius) so they never stand in the
  // stair path. =====
  addAreaThing(direction, 46, 296, 776); // east foot, against the outer wall
  addAreaThing(direction, 46, 296, 1108); // east climb, against the outer wall
  addAreaThing(direction, 46, -296, 1108); // west climb, against the outer wall
  addAreaThing(direction, 46, -296, 776); // summit corner, against the outer wall
  addAreaThing(direction, 46, 120, 1208); // far landing, tucked against the column base
};

// Texture patches this wing contributes: the iostat screen, disk wall signs,
// await gauge, throughput tubes, rack, and live-dashboard fallback art.
const textures = [
  {
    texture: screen.texture,
    patch: screen.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(screen),
  },
  ...Object.values(signs).map((sign) => ({
    texture: sign.texture,
    patch: sign.patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSignPatch(sign.text),
  })),
  {
    texture: gauge.texture,
    patch: gauge.patch,
    width: diskGaugeSize.width,
    height: diskGaugeSize.height,
    build: buildDiskGaugePatch,
  },
  {
    texture: tubeRead.texture,
    patch: tubeRead.patch,
    width: tubeTextureSize.width,
    height: tubeTextureSize.height,
    build: () => buildTubePatch({ capsule: 231, glint: 167 }),
  },
  {
    texture: tubeWrite.texture,
    patch: tubeWrite.patch,
    width: tubeTextureSize.width,
    height: tubeTextureSize.height,
    build: () => buildTubePatch({ capsule: 176, glint: 164 }),
  },
  {
    texture: rack.texture,
    patch: rack.patch,
    width: serverRackTextureSize.width,
    height: serverRackTextureSize.height,
    build: buildServerRackPatch,
  },
  {
    texture: display.texture,
    patch: display.patch,
    width: storageDisplayTextureSize.width,
    height: storageDisplayTextureSize.height,
    build: buildStorageDisplayPatch,
  },
];

// Floor-name inscription flat, generated once ("IO VAULT" at the entrance).
const flats = [...ioInscription.flats];

const toWorld = ([u, v]) => [-u, -v];
const segment = (a, b) => {
  const [ax, ay] = toWorld(a);
  const [bx, by] = toWorld(b);
  return { ax, ay, bx, by };
};
// The iostat read-point. Storage is the SOUTH wing, so the builder rotates local
// (u,v) -> world (-u,-v); the central terminalSegment helper assumes the identity
// (north) rotation, so we emit the screen face in WORLD coords directly. The face
// is the terminal recess's far wall (local v = TP_TERM_WALL), centred on u=0 and
// one screen wide, so the browser's USE-distance check lines up with the screen.
const terminals = ({ terminalHalfWidth }) => {
  const [ax, ay] = toWorld([-terminalHalfWidth, TP_TERM_WALL]);
  const [bx, by] = toWorld([terminalHalfWidth, TP_TERM_WALL]);
  return [{ sign: "storage", segments: [{ ax, ay, bx, by }] }];
};

const easterEggs = () => {
  // The disk-server rack panel lives on the throughput hall's east wall.
  return [
    {
      id: "disk-server-rack",
      segments: [segment([CW, V3 + 192], [CW, V3 + 256])],
    },
  ];
};

export const storageWing = {
  resource: "storage",
  ids,
  build,
  textures,
  flats,
  sprites: [],
  terminals,
  easterEggs,
};
