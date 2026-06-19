// Storage wing (south): an enclosed amber I/O vault rebuilt as four separate
// mechanistic disk instruments from DISK_WING_PLAN.md. The wing descends three
// levels along its central axis (PARALLEL_WINGS_PLAN.md, Track B):
//
//   L1  request balcony  — where read/write requests arrive; READ and WRITE
//                          side bays flank it, and "IO VAULT" is inscribed into
//                          the threshold floor.
//   L2  service deck     — a loading hopper whose live QUEUE trough is the queue
//                          depth saturation signal.
//   L3  engine pit       — the central utilization engine/flywheel, left-wall
//                          pneumatic throughput tubes, right-wall AWAIT delay
//                          gauges, and the iostat terminal on the far wall.
//
// This is the storage wing's independent editing seam. build() lays out only
// the geometry (reading the shared builder API + palette from ctx); the screen,
// sign, and gauge art are contributed via `textures`, the floor inscriptions via
// `flats`, and the iostat read-point via `terminals`. Everything is map-only:
// live instruments keep using the storage tag/light contracts: queue light 134,
// utilization tags 620..622, await line tags 660..662, and dashboard line tag 663.
// See [[map-builder-architecture]] and [[telemetry-terminal-seam]].
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

// Floor-name inscriptions. The reading player always faces "south" here (they
// walk away from the hub, into -y), so both names use the south orientation;
// makeInscription bakes the per-cell mirroring, and southCell() lays the cells
// out in the matching (reversed) order — the south mirror of the CPU wing's
// left-to-right placement. names[] are referenced by the geometry below; the
// flat pixel data is generated once in `flats`.
const ioInscription = makeInscription("DPDIO", "IO VAULT", "south", 4);
const queueInscription = makeInscription("DPDQ", "QUEUE", "south", 3);
const southCell = (cells, k) => cells * 32 - 64 * (k + 1);

// Half-widths (local u): the balcony/deck core, the read/write bays' outer edge,
// the engine pit, and the utilization flywheel.
const HW = 320;
const BAY = 576;
const PITHW = 288;
const ENGINEHW = 160;
const ENGINE_CELL = 64; // 5 cells -> 320, == 2 * ENGINEHW

// Floors and ceilings. The axis steps down balcony -> deck -> pit; the terminal
// recess sits a lectern-step above the pit floor (so its riser reads as a
// control panel) and is exactly one screen-texture tall.
const F_BALCONY = 24;
const F_DECK = 0;
const F_PIT = -56;
const F_TERM = -24;
const C_HALL = 200;
const C_PIT = 224;
const C_BAY = F_BALCONY + wallSignSize.height; // back wall == one sign tall
const C_TERM = F_TERM + terminalTextureSize.height;
const SIGN_FLOOR = F_PIT;
const SIGN_CEIL = F_PIT + wallSignSize.height; // pit-wall niches: one sign tall

// Depth boundaries (local v), hub-ward to far wall.
const V_ENTRY = 704; // foyer begins where addWingEntrance's entry throat ends
const V_BALCONY = 1024;
const V_DECK = 1344;
const V_STAIR = 1408; // foot of the descent stairs / engine front edge
const V_ENGINE_END = V_STAIR + 5 * ENGINE_CELL; // 1728
const V_PIT_BACK = 1760;
const V_TERM_WALL = 1776; // the iostat screen face (far one-sided wall)
const DISPLAY_PANEL_DEPTH = 16;
const SERVER_PANEL_HEIGHT = 64;
const DISPLAY_PANEL_HEIGHT = 128;
const serverRack = {
  u1: -PITHW,
  v1: V_PIT_BACK,
  u2: -192,
  v2: V_TERM_WALL,
};
const tubePanels = {
  rate: { u1: -PITHW - DISPLAY_PANEL_DEPTH, v1: 1344, u2: -PITHW, v2: 1408 },
  read: { u1: -PITHW - DISPLAY_PANEL_DEPTH, v1: 1408, u2: -PITHW, v2: 1496 },
  write: { u1: -PITHW - DISPLAY_PANEL_DEPTH, v1: 1504, u2: -PITHW, v2: 1592 },
};
// 128 deep along v so the room-facing face is exactly one 128-wide dashboard
// texture (no column wrap; see storageDisplayTextureSize). This lives below the
// throughput tubes as a secondary live readout/rating plate.
const metricDisplay = {
  u1: -PITHW - DISPLAY_PANEL_DEPTH,
  v1: 1600,
  u2: -PITHW,
  v2: V_ENGINE_END,
};

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, resource, base, accent } = ctx;

  addWingEntrance(ctx);

  // Shared sector styles. The halls use the storage base wall (STONE2); the pit
  // is the engine room, so it takes the accent wall (BROWNHUG) and its own ceiling.
  const balcony = { ...base, kind: "balcony", floor: F_BALCONY, ceiling: C_HALL, light: 176 };
  const deck = { ...base, kind: "deck", floor: F_DECK, ceiling: C_HALL, light: 168 };
  const pit = { ...accent, kind: "pit", floor: F_PIT, ceiling: C_PIT, ceilingFlat: "CEIL5_1", light: 152 };

  // ===== L1: request balcony =====
    // The foyer crests onto the balcony, split so "IO VAULT" inscribes flush into
    // the threshold floor as the player enters (they walk over it).
    areaRect(direction, "balcony-front", { u1: -HW, v1: V_ENTRY, u2: HW, v2: 832 }, balcony);
    areaRect(direction, "balcony-insc-w", { u1: -HW, v1: 832, u2: -128, v2: 896 }, balcony);
    areaRect(direction, "balcony-insc-e", { u1: 128, v1: 832, u2: HW, v2: 896 }, balcony);
    ioInscription.names.forEach((flatName, k) => {
      const u1 = southCell(4, k);
      areaRect(direction, `balcony-io-${k}`, { u1, v1: 832, u2: u1 + 64, v2: 896 }, { ...balcony, floorFlat: flatName });
    });
    areaRect(direction, "balcony-back", { u1: -HW, v1: 896, u2: HW, v2: V_BALCONY }, balcony);

    // READ / WRITE bays: symmetric alcoves off the balcony, named on their back
    // walls (one-sided -> the sign is the mid texture). Distinguished for now by
    // light + floor flat; richer read=cool / write=warm palettes are a later pass.
    areaRect(direction, "read-bay", { u1: -BAY, v1: 768, u2: -HW, v2: 1000 }, {
      ...accent,
      kind: "bay",
      floor: F_BALCONY,
      ceiling: C_BAY,
      floorFlat: "FLOOR4_8",
      light: 192,
      labelSide: "left",
      labelTexture: signs.read.texture,
      tag: 640,
    });
    areaRect(direction, "write-bay", { u1: HW, v1: 768, u2: BAY, v2: 1000 }, {
      ...accent,
      kind: "bay",
      floor: F_BALCONY,
      ceiling: C_BAY,
      floorFlat: "FLOOR0_3",
      light: 176,
      labelSide: "right",
      labelTexture: signs.write.texture,
      tag: 641,
    });

  // ===== L2: service deck =====
    // The deck drops one step below the balcony. "QUEUE" inscribes into the deck
    // floor just before the loading hopper: a raised brass rim around the live,
    // recessed queue trough (reserved sector tag 610). The trough remains at the
    // engine hook's exact world bounds so queue depth keeps painting here.
    areaRect(direction, "deck-front", { u1: -HW, v1: V_BALCONY, u2: HW, v2: 1088 }, deck);
    areaRect(direction, "deck-q-w", { u1: -HW, v1: 1088, u2: -96, v2: 1152 }, deck);
    areaRect(direction, "deck-q-e", { u1: 96, v1: 1088, u2: HW, v2: 1152 }, deck);
    queueInscription.names.forEach((flatName, k) => {
      const u1 = southCell(3, k);
      areaRect(direction, `deck-q-${k}`, { u1, v1: 1088, u2: u1 + 64, v2: 1152 }, { ...deck, floorFlat: flatName });
    });
    const hopperRim = { ...deck, floor: F_DECK + 8, floorFlat: "FLOOR0_3", light: 184 };
    areaRect(direction, "hopper-rim-w", { u1: -HW, v1: 1152, u2: -256, v2: 1216 }, hopperRim);
    areaRect(direction, "hopper-rim-e", { u1: 256, v1: 1152, u2: HW, v2: 1216 }, hopperRim);
    areaRect(direction, "queue-channel", { u1: -256, v1: 1152, u2: 256, v2: 1216 }, {
      ...deck,
      kind: "queue",
      floor: F_DECK - 16,
      floorFlat: "FLOOR1_7",
      // Light sentinel (reserved storage range 130-134): the engine's r_plane
      // hook keys the queue floor display off this exact value, painting the
      // channel floor with flowing request blocks driven by queue depth.
      light: ids.lights[0] + 4, // 134
      tag: ids.sectorTags[0] + 10, // 610
    });
    areaRect(direction, "hopper-back-lip", { u1: -256, v1: 1216, u2: 256, v2: 1248 }, hopperRim);
    areaRect(direction, "deck-back-w", { u1: -HW, v1: 1216, u2: -256, v2: V_DECK }, deck);
    areaRect(direction, "deck-back-e", { u1: 256, v1: 1216, u2: HW, v2: V_DECK }, deck);
    areaRect(direction, "deck-back-center", { u1: -256, v1: 1248, u2: 256, v2: V_DECK }, deck);

  // ===== L3: engine pit =====
    // Central stairs descend from the deck to the pit floor; the flanks of the
    // descent are an open overlook ledge (a 56-unit drop) onto the pit, so the
    // central engine reads from the deck before you walk down to it.
    const stairFloors = [F_DECK - 14, F_DECK - 28, F_DECK - 42, F_PIT];
    stairFloors.forEach((fz, k) => {
      const v1 = V_DECK + k * 16;
      areaRect(direction, `pit-stair-${k}`, { u1: -96, v1, u2: 96, v2: v1 + 16 }, {
        ...pit,
        kind: "pit-stair",
        floor: fz,
        floorFlat: "FLOOR0_3",
        light: 168,
      });
    });
    areaRect(direction, "pit-front-w", { u1: -PITHW, v1: V_DECK, u2: -96, v2: V_STAIR }, pit);
    areaRect(direction, "pit-front-e", { u1: 96, v1: V_DECK, u2: PITHW, v2: V_STAIR }, pit);

    // The Great Engine: a 5x5 flywheel base with a raised central piston. The
    // concentric rings remain the utilization surface driven by tags 620/621/622:
    // idle is a slow glimmer, high %util makes the whole engine strobe.
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const ring = Math.max(Math.abs(col - 2), Math.abs(row - 2));
        const ringStyle =
          ring === 0
            ? { floor: F_PIT + 64, floorFlat: "FLOOR4_8", tag: 620 } // piston
            : ring === 1
              ? { floor: F_PIT + 16, floorFlat: "FLOOR0_3", tag: 621 }
              : { floor: F_PIT + 8, floorFlat: "FLOOR4_8", tag: 622 };
        const u1 = -ENGINEHW + col * ENGINE_CELL;
        const v1 = V_STAIR + row * ENGINE_CELL;
        areaRect(direction, `engine-flywheel-${col}-${row}`, { u1, v1, u2: u1 + ENGINE_CELL, v2: v1 + ENGINE_CELL }, {
          ...pit,
          kind: ring === 0 ? "engine-piston" : "engine-flywheel",
          light: 168,
          ...ringStyle,
        });
      }
    }
    areaRect(direction, "pit-side-w", { u1: -PITHW, v1: V_STAIR, u2: -ENGINEHW, v2: V_ENGINE_END }, pit);
    areaRect(direction, "pit-side-e", { u1: ENGINEHW, v1: V_STAIR, u2: PITHW, v2: V_ENGINE_END }, pit);

    // Pit back wall + the iostat terminal recess. The recess steps up one lectern
    // height from the pit floor, so its front riser renders as a control panel
    // (sideTextures keys that off labelSide:"top" + a label texture), and its far
    // one-sided wall carries the (blurred) DISK I/O screen, exactly one screen
    // texture tall. Read-point wired in `terminals`.
    areaRect(direction, "pit-back", { u1: -PITHW, v1: V_ENGINE_END, u2: PITHW, v2: V_PIT_BACK }, pit);
    areaRect(direction, "pit-back-w", { u1: -192, v1: V_PIT_BACK, u2: -128, v2: V_TERM_WALL }, pit);
    areaRect(direction, "pit-back-e", { u1: 128, v1: V_PIT_BACK, u2: PITHW, v2: V_TERM_WALL }, pit);
    areaRect(direction, "pit-server-rack", serverRack, {
      ...pit,
      kind: "server-rack",
      floor: F_PIT + SERVER_PANEL_HEIGHT,
      ceiling: F_PIT + SERVER_PANEL_HEIGHT,
      floorFlat: "FLOOR0_3",
      wall: rack.texture,
      light: 184,
    });
    areaRect(direction, "storage-terminal", { u1: -128, v1: V_PIT_BACK, u2: 128, v2: V_TERM_WALL }, {
      ...pit,
      kind: "terminal",
      floor: F_TERM,
      ceiling: C_TERM,
      light: 192,
      labelSide: "top",
      labelTexture: screen.texture,
    });

    // Left wall: pneumatic throughput tubes. READ/S and WRITE/S are separate
    // brass/glass panels, capped by an IO RATE plaque; the live dashboard below
    // is a secondary readout and keeps the existing line-tag contract.
    const tubePanel = (id, bounds, texture, extra = {}) =>
      areaRect(direction, id, bounds, {
        ...pit,
        kind: "metric-display",
        floor: F_PIT + DISPLAY_PANEL_HEIGHT,
        ceiling: F_PIT + DISPLAY_PANEL_HEIGHT,
        floorFlat: "FLOOR0_3",
        wall: texture,
        sideWall: accent.wall,
        textureSide: "left",
        light: 192,
        ...extra,
      });
    tubePanel("pit-rate-plaque", tubePanels.rate, signs.rate.texture);
    tubePanel("pit-read-tube", tubePanels.read, tubeRead.texture);
    tubePanel("pit-write-tube", tubePanels.write, tubeWrite.texture);
    tubePanel("pit-metric-display", metricDisplay, display.texture, {
      // Live dashboard line tag: the engine's R_DoomPerfDiskDashboardPixel
      // (patch 0027) repaints this panel's room-facing lower texture with the
      // three scrolling graphs. It gates on the bottom-texture surface so the
      // tag lands only on the dashboard face, not the seal above it or the
      // one-sided side/back walls. 663 (gauges hold 660-662).
      lineTag: ids.lineTags[0] + 3, // 663
    });

    // West wall: a sky slit near the rear pit, kept clear of the equipment bay.
    // It recesses beyond the wall (u < -PITHW) and opens onto the pit back.
    areaRect(direction, "pit-sky-w", { u1: -304, v1: 1730, u2: -PITHW, v2: 1758 }, {
      kind: "outside",
      resource,
      floor: 72,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
    // Right wall: AWAIT delay gauges, the second saturation signal. The three
    // fluid-column niches reserve line tags 660+ so the renderer can drive fill
    // height from service/await time.
    areaRect(direction, "pit-await-sign", { u1: PITHW, v1: 1344, u2: 304, v2: 1408 }, {
      ...pit,
      kind: "pit-sign",
      floor: SIGN_FLOOR,
      ceiling: SIGN_CEIL,
      light: 200,
      labelSide: "right",
      labelTexture: signs.await.texture,
    });
    [1424, 1512, 1600].forEach((v1, k) => {
      areaRect(direction, `pit-delay-gauge-${k}`, { u1: PITHW, v1, u2: 304, v2: v1 + 72 }, {
        ...pit,
        kind: "delay-gauge",
        floor: SIGN_FLOOR,
        ceiling: SIGN_CEIL,
        light: 200,
        labelSide: "right",
        labelTexture: gauge.texture,
        lineTag: ids.lineTags[0] + k, // 660 + k
      });
    });

  // ===== Engine-room torches: amber flicker on the deck and around the pit. =====
    addAreaThing(direction, 46, -296, 1100);
    addAreaThing(direction, 46, 296, 1100);
    addAreaThing(direction, 46, -250, 1430);
    addAreaThing(direction, 46, 250, 1430);
    addAreaThing(direction, 46, -150, 1740);
    addAreaThing(direction, 46, 150, 1740);
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

// Floor-name inscription flats, generated once (the geometry above references
// them by name). "IO VAULT" at the entrance, "QUEUE" before the service channel.
const flats = [...ioInscription.flats, ...queueInscription.flats];

const toWorld = ([u, v]) => [-u, -v];
const segment = (a, b) => {
  const [ax, ay] = toWorld(a);
  const [bx, by] = toWorld(b);
  return { ax, ay, bx, by };
};
// The iostat read-point. Storage is the SOUTH wing, so the map builder rotates
// local (u,v) -> world (-u,-v); the central terminalSegment helper assumes the
// identity (north) rotation, so we emit the screen face in WORLD coords directly.
// The face is the terminal recess's far wall (local v = V_TERM_WALL), centred on
// u=0 and one screen wide, so the browser's USE-distance check (player world
// position) lines up with the actual screen.
const terminals = ({ terminalHalfWidth }) => {
  const [ax, ay] = toWorld([-terminalHalfWidth, V_TERM_WALL]);
  const [bx, by] = toWorld([terminalHalfWidth, V_TERM_WALL]);
  return [{ sign: "storage", segments: [{ ax, ay, bx, by }] }];
};

const easterEggs = () => {
  return [
    {
      id: "disk-server-rack",
      segments: [
        segment([serverRack.u1, serverRack.v1], [serverRack.u2, serverRack.v1]),
      ],
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
