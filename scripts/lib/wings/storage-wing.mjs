// Storage wing (south): an enclosed amber I/O vault and disk foundry, the
// southern counterpart to the CPU reactor and the reference for the other
// resource wings' instrument depth. The wing descends three levels along its
// central axis (PARALLEL_WINGS_PLAN.md, Track B):
//
//   L1  request balcony  — where read/write requests arrive; READ and WRITE
//                          side bays flank it, and "IO VAULT" is inscribed into
//                          the threshold floor.
//   L2  service deck     — a controller walkway whose recessed QUEUE channel is
//                          the saturation instrument (queue depth).
//   L3  media pit (sunk) — the disk foundry: a square PLATTER (utilization), a
//                          row of amber LATENCY gauges (service/await time), and
//                          the iostat terminal on the far wall.
//
// This is the storage wing's independent editing seam. build() lays out only
// the geometry (reading the shared builder API + palette from ctx); the screen,
// sign, and gauge art are contributed via `textures`, the floor inscriptions via
// `flats`, and the iostat read-point via `terminals`. Everything is map-only:
// tags/line-tags/lights are reserved from `ids` for future live instruments, but
// no C-renderer hook reads them yet, so the wing lands as static identity first.
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

const ids = reserved.storage;
const tex = (suffix) => wingName("storage", suffix);

// Custom WAD art, all under the reserved "DPD" prefix so it can't collide with
// the other wings' names.
const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["DISK IO", "SERVICE"] };
const signs = {
  read: { texture: tex("READ"), patch: tex("PRD"), text: "READ" },
  write: { texture: tex("WRITE"), patch: tex("PWR"), text: "WRITE" },
  platter: { texture: tex("PLAT"), patch: tex("PPL"), text: "PLATTER" },
  latency: { texture: tex("LAT"), patch: tex("PLT"), text: "LATENCY" },
};
const gauge = { texture: tex("GAUG"), patch: tex("PGAU") };
const rack = { texture: tex("RACK"), patch: tex("PRCK") };
const display = { texture: tex("DASH"), patch: tex("PDSH") };

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
// the media pit, and the platter.
const HW = 320;
const BAY = 576;
const PITHW = 288;
const PLATHW = 160;
const PLAT_CELL = 64; // 5 cells -> 320, == 2 * PLATHW

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
const V_STAIR = 1408; // foot of the descent stairs / platter front edge
const V_PLAT_END = V_STAIR + 5 * PLAT_CELL; // 1728
const V_PIT_BACK = 1760;
const V_TERM_WALL = 1776; // the iostat screen face (far one-sided wall)
const WALL_PANEL_DEPTH = 96;
const DISPLAY_PANEL_DEPTH = 16;
const SERVER_PANEL_HEIGHT = 64;
const DISPLAY_PANEL_HEIGHT = 128;
const serverRack = {
  u1: -PITHW - WALL_PANEL_DEPTH,
  v1: 1424,
  u2: -PITHW,
  v2: 1520,
};
// 128 deep along v so the room-facing face is exactly one 128-wide dashboard
// texture (no column wrap; see storageDisplayTextureSize).
const metricDisplay = {
  u1: -PITHW - DISPLAY_PANEL_DEPTH,
  v1: 1536,
  u2: -PITHW,
  v2: 1664,
};

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, resource, base, accent } = ctx;

  addWingEntrance(ctx);

  // Shared sector styles. The halls use the storage base wall (STONE2); the pit
  // is the foundry, so it takes the accent wall (BROWNHUG) and its own ceiling.
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
    // floor just before the recessed queue channel — the saturation instrument:
    // a sunken trough where queued I/O requests will later stack/stream (reserved
    // sector tag 610). Static depth for now.
    areaRect(direction, "deck-front", { u1: -HW, v1: V_BALCONY, u2: HW, v2: 1088 }, deck);
    areaRect(direction, "deck-q-w", { u1: -HW, v1: 1088, u2: -96, v2: 1152 }, deck);
    areaRect(direction, "deck-q-e", { u1: 96, v1: 1088, u2: HW, v2: 1152 }, deck);
    queueInscription.names.forEach((flatName, k) => {
      const u1 = southCell(3, k);
      areaRect(direction, `deck-q-${k}`, { u1, v1: 1088, u2: u1 + 64, v2: 1152 }, { ...deck, floorFlat: flatName });
    });
    areaRect(direction, "deck-chan-w", { u1: -HW, v1: 1152, u2: -256, v2: 1216 }, deck);
    areaRect(direction, "deck-chan-e", { u1: 256, v1: 1152, u2: HW, v2: 1216 }, deck);
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
    areaRect(direction, "deck-back", { u1: -HW, v1: 1216, u2: HW, v2: V_DECK }, deck);

  // ===== L3: media pit =====
    // Central stairs descend from the deck to the pit floor; the flanks of the
    // descent are an open overlook ledge (a 56-unit drop) onto the pit, so the
    // platter reads from the deck before you walk down to it.
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

    // The PLATTER: a 5x5 grid read as concentric square rings (utilization). The
    // centre cell is a raised spindle; rings alternate flat to read as grooves.
    // Rings carry reserved sector tags (620/621/622) so a later hook can pulse or
    // spin them by disk-busy percentage. Uniform light + at most two heights/flats
    // keep the visplane budget bounded for the vanilla renderer.
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const ring = Math.max(Math.abs(col - 2), Math.abs(row - 2));
        const ringStyle =
          ring === 0
            ? { floor: F_PIT + 8, floorFlat: "FLOOR4_8", tag: 620 } // spindle
            : ring === 1
              ? { floor: F_PIT, floorFlat: "FLOOR0_3", tag: 621 }
              : { floor: F_PIT, floorFlat: "FLOOR4_8", tag: 622 };
        const u1 = -PLATHW + col * PLAT_CELL;
        const v1 = V_STAIR + row * PLAT_CELL;
        areaRect(direction, `platter-${col}-${row}`, { u1, v1, u2: u1 + PLAT_CELL, v2: v1 + PLAT_CELL }, {
          ...pit,
          kind: "platter",
          light: 168,
          ...ringStyle,
        });
      }
    }
    areaRect(direction, "pit-side-w", { u1: -PITHW, v1: V_STAIR, u2: -PLATHW, v2: V_PLAT_END }, pit);
    areaRect(direction, "pit-side-e", { u1: PLATHW, v1: V_STAIR, u2: PITHW, v2: V_PLAT_END }, pit);

    // Pit back wall + the iostat terminal recess. The recess steps up one lectern
    // height from the pit floor, so its front riser renders as a control panel
    // (sideTextures keys that off labelSide:"top" + a label texture), and its far
    // one-sided wall carries the (blurred) DISK I/O screen, exactly one screen
    // texture tall. Read-point wired in `terminals`.
    areaRect(direction, "pit-back", { u1: -PITHW, v1: V_PLAT_END, u2: PITHW, v2: V_PIT_BACK }, pit);
    areaRect(direction, "pit-back-w", { u1: -PITHW, v1: V_PIT_BACK, u2: -128, v2: V_TERM_WALL }, pit);
    areaRect(direction, "pit-back-e", { u1: 128, v1: V_PIT_BACK, u2: PITHW, v2: V_TERM_WALL }, pit);
    areaRect(direction, "storage-terminal", { u1: -128, v1: V_PIT_BACK, u2: 128, v2: V_TERM_WALL }, {
      ...pit,
      kind: "terminal",
      floor: F_TERM,
      ceiling: C_TERM,
      light: 192,
      labelSide: "top",
      labelTexture: screen.texture,
    });

    // West wall: a compact rack plus a single tall dashboard panel. The easter-
    // egg trigger stays tied to the server face and has no popup interaction.
    areaRect(direction, "pit-server-rack", serverRack, {
      ...pit,
      kind: "server-rack",
      floor: F_PIT + SERVER_PANEL_HEIGHT,
      ceiling: F_PIT + SERVER_PANEL_HEIGHT,
      floorFlat: "FLOOR0_3",
      wall: rack.texture,
      light: 184,
    });
    areaRect(direction, "pit-metric-display", metricDisplay, {
      ...pit,
      kind: "metric-display",
      floor: F_PIT + DISPLAY_PANEL_HEIGHT,
      ceiling: F_PIT + DISPLAY_PANEL_HEIGHT,
      floorFlat: "FLOOR0_3",
      wall: display.texture,
      sideWall: accent.wall,
      textureSide: "left",
      // Live dashboard line tag: the engine's R_DoomPerfDiskDashboardPixel
      // (patch 0027) repaints this panel's room-facing lower texture with the
      // three scrolling graphs. It gates on the bottom-texture surface so the
      // tag lands only on the dashboard face, not the seal above it or the
      // one-sided side/back walls. 663 (gauges hold 660-662).
      lineTag: ids.lineTags[0] + 3, // 663
      light: 192,
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
    // East pit wall: the LATENCY sign, then three amber service-latency gauges
    // (await time). Each gauge niche reserves a line tag (660+) so a later hook
    // can drive its fill height. Niches recess beyond the east pit wall.
    areaRect(direction, "pit-latency-sign", { u1: PITHW, v1: V_STAIR, u2: 304, v2: 1568 }, {
      ...pit,
      kind: "pit-sign",
      floor: SIGN_FLOOR,
      ceiling: SIGN_CEIL,
      light: 200,
      labelSide: "right",
      labelTexture: signs.latency.texture,
    });
    [1576, 1632, 1688].forEach((v1, k) => {
      areaRect(direction, `pit-gauge-${k}`, { u1: PITHW, v1, u2: 304, v2: v1 + 40 }, {
        ...pit,
        kind: "pit-gauge",
        floor: SIGN_FLOOR,
        ceiling: SIGN_CEIL,
        light: 200,
        labelSide: "right",
        labelTexture: gauge.texture,
        lineTag: ids.lineTags[0] + k, // 660 + k
      });
    });

  // ===== Foundry torches: amber flicker on the deck and around the pit. =====
    addAreaThing(direction, 46, -296, 1100);
    addAreaThing(direction, 46, 296, 1100);
    addAreaThing(direction, 46, -250, 1430);
    addAreaThing(direction, 46, 250, 1430);
    addAreaThing(direction, 46, -150, 1740);
    addAreaThing(direction, 46, 150, 1740);
};

// Texture patches this wing contributes: the iostat screen, the four wall signs
// (READ / WRITE / PLATTER / LATENCY), and the latency gauge.
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
        segment([serverRack.u2, serverRack.v1], [serverRack.u2, serverRack.v2]),
        segment([serverRack.u1, serverRack.v2], [serverRack.u2, serverRack.v2]),
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
