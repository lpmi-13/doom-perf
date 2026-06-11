import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lump, i16, i32, ascii8, record, buildWad } from "./lib/wad-bytes.mjs";
import {
  labelTextureSize,
  terminalTextureSize,
  signTextureSize,
  controlPanelTextureSize,
  signTextColor,
  drawCenteredText,
  buildLabelPatch,
  buildSignPatch,
  buildTerminalPatch,
  buildCpuColumnPatch,
  buildControlPanelPatch,
  buildOrbPatch,
  wallSignSize,
  buildWallSignPatch,
} from "./lib/textures.mjs";
import { createMapBuilder } from "./lib/map-builder.mjs";

const outputPath = fileURLToPath(new URL("../public/maps/doomperf-lab.wad", import.meta.url));
const baseIwadPath = fileURLToPath(new URL("../public/wads/freedoom1.wad", import.meta.url));

const lineFlags = {
  blocking: 1,
  twoSided: 4,
  lowerUnpegged: 16,
};

const hubRadius = 384;
const terminalPanelDepth = 16;
const terminalPanelFloor = 32;
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
  runQueue: { u1: -1024, v1: 768, u2: -384, v2: 1600 },
  load: { u1: 384, v1: 896, u2: 884, v2: 1676 },
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

// The geometry builder owns the sectors/things state and the WAD compile
// pipeline; we destructure its construction API so the layout code below reads
// the same as before (areaRect/addAreaThing/addThing), then call compile() near
// the end (with the map-specific texturing) to emit the binary map lumps.
const { addThing, addRect, areaRect, addAreaThing, compile } = createMapBuilder();

addRect("atrium", { x1: -hubRadius, y1: -hubRadius, x2: hubRadius, y2: hubRadius }, {
  kind: "hub",
  floorFlat: "FLOOR4_8",
  ceilingFlat: "CEIL3_5",
  wall: "STARTAN3",
  light: 224,
});


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
    // ===== LEFT wing: RUN QUEUE — a "subway" hall. The player enters from the
    // east onto a raised PLATFORM (floor 0; RUN QUEUE wall terminal on its north
    // end wall) and looks WEST down into the sunken TRACKS (a ravine at floor -56)
    // that run far north & south past the platform, like a subway. Task-orbs
    // stream along the tracks (north->south) through a constriction whose open
    // lanes track CPU core count; stairs run the full west edge of the platform.
    // The footprint is a T: a long N-S track trench (west) with the platform as an
    // east nub at the middle, so the platform's N/S end walls are solid (terminal
    // fits) and the tracks extend past it both ways. Orbs, lane gates (sector tags
    // 230..237) and load halos are animated by patch 0018; this is static geometry
    // + tags only. Light levels avoid the floor-display sentinels (144/160).
    const rqRavineFloor = -56;
    const rqCeil = 224;
    const rqPlatU1 = -704, rqPlatU2 = cpuRoomBounds.runQueue.u2; // platform E-W (-704..-384)
    const rqPlatV1 = 928, rqPlatV2 = 1312;                        // platform N-S (384 long)
    const rqStairU1 = -768, rqStairU2 = -704;                     // egress stairs (64 wide)
    const rqTrU1 = -1024, rqTrU2 = -768;                          // track trench E-W (256 wide)
    // South end held at v768 so the trench clears the west (network) wing, whose
    // geometry tops out near y704 — a solid-wall gap keeps the wings unconnected.
    const rqTrV1 = 768, rqTrV2 = 1600;                            // track trench N-S
    const rqHall = { ...base, wall: "METAL1", ceilingFlat: "CEIL5_1", ceiling: rqCeil };
    const platform = { ...rqHall, kind: "rq-overlook", floorFlat: "FLOOR4_8", floor: 0, light: 176 };
    const tracks = { ...rqHall, kind: "rq-ravine", floorFlat: "FLOOR1_7", floor: rqRavineFloor, light: 168 };

    // Platform (raised) + RUN QUEUE wall terminal on its solid north end wall.
    const rqTermV = rqPlatV2 - terminalPanelDepth;   // 1296
    const rqTermU1 = -640;                            // 256-wide screen, east-aligned
    areaRect(direction, "rq-platform", { u1: rqPlatU1, v1: rqPlatV1, u2: rqPlatU2, v2: rqTermV }, platform);
    areaRect(direction, "rq-plat-nw", { u1: rqPlatU1, v1: rqTermV, u2: rqTermU1, v2: rqPlatV2 }, platform);
    areaRect(direction, "rq-terminal", { u1: rqTermU1, v1: rqTermV, u2: rqPlatU2, v2: rqPlatV2 }, {
      ...platform,
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      labelSide: "top",
      labelTexture: cpuTerminalScreens.runQueue.texture,
    });

    // Egress stairs: full length of the platform's west edge, -56 -> 0 eastward.
    const rqStep = [-42, -28, -14, 0];
    rqStep.forEach((fz, k) => {
      const su1 = rqStairU1 + k * 16;
      areaRect(direction, `rq-stair-${k}`, { u1: su1, v1: rqPlatV1, u2: su1 + 16, v2: rqPlatV2 }, {
        ...tracks, kind: "rq-stair", floor: fz, floorFlat: "FLOOR4_8", light: 176,
      });
    });

    // Tracks (sunken ravine) running far north & south past the platform.
    const rqConV1 = 1104, rqConV2 = 1136;            // constriction band (mid, at the platform)
    areaRect(direction, "rq-spawn", { u1: rqTrU1, v1: 1500, u2: rqTrU2, v2: rqTrV2 }, { ...tracks, kind: "rq-spawn", light: 184 });
    areaRect(direction, "rq-flow-up", { u1: rqTrU1, v1: rqConV2, u2: rqTrU2, v2: 1500 }, tracks);
    // Constriction: 8 lane gates (tags 230..237) split by solid dividers across
    // the track width; the tick sinks `cores` gates open and raises the rest.
    const rqLanes = 8;
    const rqCell = (rqTrU2 - rqTrU1) / rqLanes;      // 32
    for (let i = 0; i < rqLanes; i += 1) {
      const cu = rqTrU1 + i * rqCell;
      areaRect(direction, `rq-divider-${i}`, { u1: cu, v1: rqConV1, u2: cu + 4, v2: rqConV2 }, {
        ...tracks, kind: "rq-divider", floor: rqCeil, ceiling: rqCeil, wall: cpuCoreWallTexture, light: 176,
      });
      areaRect(direction, `rq-gate-${i}`, { u1: cu + 4, v1: rqConV1, u2: cu + rqCell, v2: rqConV2 }, {
        ...tracks, kind: "rq-gate", tag: 230 + i, wall: cpuCoreWallTexture,
      });
    }
    areaRect(direction, "rq-flow-down", { u1: rqTrU1, v1: 868, u2: rqTrU2, v2: rqConV1 }, tracks);
    areaRect(direction, "rq-exit", { u1: rqTrU1, v1: rqTrV1, u2: rqTrU2, v2: 868 }, { ...tracks, kind: "rq-exit" });

    // D-state I/O-wait PEN: a single recess cut WEST into the track wall just south
    // of the gates, off the run-queue flow. Blocked (uninterruptible-sleep) threads
    // STACK here as motionless green orbs (patch 0018) in a 2x2 footprint that piles
    // up level by level -- the taller the pile, the more threads asleep on I/O. The
    // sector light (tag 245) PULSES ~once/sec so the sleeping pile glows. Only this
    // one pen remains (the southern one was dropped so it no longer blocks the
    // QUEUED sign behind it). World coords (CPU/north wing = identity): x[-1136,-1024].
    const rqPenU1 = rqTrU1 - 112;                    // -1136: back wall of the pen
    areaRect(direction, "rq-io-pen", { u1: rqPenU1, v1: 988, u2: rqTrU1, v2: 1072 }, {
      ...tracks,
      kind: "rq-io-pen",
      wall: "METAL1",
      floorFlat: "FLOOR4_8",
      floor: rqRavineFloor,                          // -56: track level; orbs stack up from here
      light: 192,                                    // base; patch 0018 pulses it ~1/sec
      tag: 245,
    });

    // West sky window high in the tracks' far wall.
    areaRect(direction, "rq-view", { u1: rqTrU1 - 64, v1: 1080, u2: rqTrU1, v2: 1200 }, {
      kind: "outside",
      resource,
      floor: 72,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });

    // Side signs recessed into the far (west) track wall, facing the overlook:
    // QUEUED at the far south (arrival/left end of the queue), RUNNING on the north
    // (dispatch/right, past the gates). The I/O pools now occupy the near-gate
    // stretch the QUEUED sign used to hold. Floor is raised above the track floor
    // so the text sits near eye level; labelSide "left" paints the sign on each
    // recess's far wall.
    const rqSignDepth = 32;
    const rqSignFloor = 0;
    const rqSignCeil = rqSignFloor + wallSignSize.height;
    [
      { name: "rq-sign-queue", v1: 780, v2: 972, tex: "DPSGQUE" },
      { name: "rq-sign-run", v1: 1208, v2: 1400, tex: "DPSGRUN" },
    ].forEach(({ name, v1, v2, tex }) => {
      areaRect(direction, name, { u1: rqTrU1 - rqSignDepth, v1, u2: rqTrU1, v2 }, {
        ...tracks,
        kind: "rq-sign",
        wall: "METAL1",
        floor: rqSignFloor,
        ceiling: rqSignCeil,
        light: 208,
        labelSide: "left",
        labelTexture: tex,
      });
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
    // Gauge column + terminal are centred on the (now wider) room centre u=634.
    const loadGU1 = 570, loadGU2 = 698;            // gauge column (128 wide), centred
    const loadTermU1 = 506, loadTermU2 = 762;      // terminal (256 wide), centred
    const loadGaugeV2 = 1240;                       // south gauge band top
    areaRect(direction, "load-walk-w", { u1: cpuRoomBounds.load.u1, v1: cpuRoomBounds.load.v1, u2: loadGU1, v2: loadGaugeV2 }, loadWalk);
    areaRect(direction, "load-margin-s", { u1: loadGU1, v1: cpuRoomBounds.load.v1, u2: loadGU2, v2: 1000 }, loadWalk);
    areaRect(direction, "load-gauge-15m", { u1: loadGU1, v1: 1000, u2: loadGU2, v2: 1048 }, { ...loadGauge, lineTag: 123 });
    areaRect(direction, "load-gap-1", { u1: loadGU1, v1: 1048, u2: loadGU2, v2: 1096 }, loadWalk);
    areaRect(direction, "load-gauge-5m", { u1: loadGU1, v1: 1096, u2: loadGU2, v2: 1144 }, { ...loadGauge, lineTag: 122 });
    areaRect(direction, "load-gap-2", { u1: loadGU1, v1: 1144, u2: loadGU2, v2: 1192 }, loadWalk);
    areaRect(direction, "load-gauge-1m", { u1: loadGU1, v1: 1192, u2: loadGU2, v2: 1240 }, { ...loadGauge, lineTag: 121 });
    areaRect(direction, "load-walk-e", { u1: loadGU2, v1: cpuRoomBounds.load.v1, u2: cpuRoomBounds.load.u2, v2: loadGaugeV2 }, loadWalk);
    areaRect(direction, "load-north-west", { u1: cpuRoomBounds.load.u1, v1: loadGaugeV2, u2: loadTermU1, v2: cpuRoomBounds.load.v2 }, loadWalk);
    const loadTerminalPanelV = cpuRoomBounds.load.v2 - terminalPanelDepth;
    areaRect(direction, "load-terminal-walk", { u1: loadTermU1, v1: loadGaugeV2, u2: loadTermU2, v2: loadTerminalPanelV }, loadWalk);
    areaRect(direction, "load-terminal", { u1: loadTermU1, v1: loadTerminalPanelV, u2: loadTermU2, v2: cpuRoomBounds.load.v2 }, {
      ...loadWalk,
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      labelSide: "top",
      labelTexture: cpuTerminalScreens.load.texture,
    });
    areaRect(direction, "load-north-east", { u1: loadTermU2, v1: loadGaugeV2, u2: cpuRoomBounds.load.u2, v2: cpuRoomBounds.load.v2 }, loadWalk);
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

const WAD_HEADER_SIZE = 12;
const WAD_DIRECTORY_ENTRY_SIZE = 16;

const wadLumpName = (wadBytes, offset) =>
  wadBytes.subarray(offset, offset + 8).toString("ascii").replace(/\0.*$/, "").trim();

const readWadDirectory = (wadBytes, sourcePath = baseIwadPath) => {
  if (wadBytes.length < WAD_HEADER_SIZE) {
    throw new Error(`${sourcePath} is too small to be a WAD.`);
  }

  const identification = wadBytes.subarray(0, 4).toString("ascii");
  if (identification !== "IWAD" && identification !== "PWAD") {
    throw new Error(`${sourcePath} has unsupported WAD type ${identification}.`);
  }

  const numLumps = wadBytes.readInt32LE(4);
  const directoryOffset = wadBytes.readInt32LE(8);
  if (numLumps < 0) {
    throw new Error(`${sourcePath} has an invalid negative lump count.`);
  }
  if (directoryOffset < 0) {
    throw new Error(`${sourcePath} has an invalid negative directory offset.`);
  }

  const directorySize = numLumps * WAD_DIRECTORY_ENTRY_SIZE;
  if (directoryOffset > wadBytes.length - directorySize) {
    throw new Error(`${sourcePath} WAD directory exceeds file length.`);
  }

  const entries = [];
  for (let index = 0; index < numLumps; index += 1) {
    const entryOffset = directoryOffset + index * WAD_DIRECTORY_ENTRY_SIZE;
    const offset = wadBytes.readInt32LE(entryOffset);
    const size = wadBytes.readInt32LE(entryOffset + 4);
    const name = wadLumpName(wadBytes, entryOffset + 8);

    if (offset < 0 || size < 0 || offset > wadBytes.length - size) {
      throw new Error(`${sourcePath} has invalid lump bounds for ${name || `entry ${index}`}.`);
    }

    entries.push({ name, offset, size });
  }

  return entries;
};

const readWadLump = (wadBytes, lumpName, sourcePath = baseIwadPath) => {
  const entry = readWadDirectory(wadBytes, sourcePath).find((candidate) => candidate.name === lumpName);
  if (!entry) {
    throw new Error(`Missing ${lumpName} in ${sourcePath}`);
  }
  return Buffer.from(wadBytes.subarray(entry.offset, entry.offset + entry.size));
};

// ===== Floor name inscriptions (custom flats) =====
// Doom can only add floor flats by re-bundling every stock flat into the map's
// own F_START..F_END (R_InitFlats keys off the last F_START/F_END markers), so
// we copy the IWAD flats and append our generated text flats.
const FLAT_DIM = 64;

const readIwadFlats = () => {
  const wad = readFileSync(baseIwadPath);
  const entries = readWadDirectory(wad, baseIwadPath);
  const start = entries.findIndex((x) => x.name === "F_START");
  const end = entries.findIndex((x) => x.name === "F_END");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${baseIwadPath} is missing a valid F_START..F_END flat range.`);
  }

  return entries.slice(start + 1, end).map(({ name, offset, size }) => {
    if (size !== 0 && size !== FLAT_DIM * FLAT_DIM) {
      throw new Error(`${baseIwadPath} flat ${name} has invalid size ${size}.`);
    }
    return lump(name, Buffer.from(wad.subarray(offset, offset + size)));
  });
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
    build: () => buildLabelPatch(label, labelColor, doorWidth),
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
  // RUN QUEUE track-side wall signs (recessed into the far wall, facing the player).
  ...[
    { texture: "DPSGQUE", patch: "DPPQUE", text: "QUEUED" },
    { texture: "DPSGRUN", patch: "DPPRUN", text: "RUNNING" },
  ].map(({ texture, patch, text }) => ({
    texture,
    patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSignPatch(text),
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

// Per-line flags: two-sided where there's a back sector, blocking otherwise; an
// outside edge also blocks and lower-unpegs; a door pair lower-unpegs and gets
// the DR-door special. Passed to compile() so the builder stays map-agnostic.
const lineFlagsFor = (front, back) => {
  let flags = back ? lineFlags.twoSided : lineFlags.blocking;
  let special = 0;
  if (back && (front.kind === "outside" || back.kind === "outside")) {
    flags |= lineFlags.blocking | lineFlags.lowerUnpegged;
  }
  if (back && isDoorPair(front, back)) {
    flags |= lineFlags.lowerUnpegged;
    special = 1;
  }
  return { flags, special };
};

const map = compile({
  chooseFrontEdge,
  sideTextures,
  textureOffsetFor,
  lineFlagsFor,
  lineTagFor,
});

const mapLumps = [
  lump("PNAMES", buildPNames()),
  ...textureConfigs.map(({ patch, build }) => lump(patch, build())),
  lump("TEXTURE2", buildTexture2()),
  // Doom Perf: replace the (unused) blursphere sprite with a blue run-queue task
  // orb. modifiedgame + W_GetNumForName resolve PINSA0 to this PWAD copy, and
  // patch 0009 supplies its sprite metadata; MT_DP_CPUTASK renders frame A only.
  lump("PINSA0", buildOrbPatch([4, 194, 196, 198, 200, 203])),
  // ...and the (unused) soulsphere sprite with a green I/O-wait orb -- a third
  // hue, distinct from the blue CPU orbs and the (red) trench floor.
  lump("SOULA0", buildOrbPatch([4, 112, 114, 116, 118, 121])),
  lump("F_START"),
  ...iwadFlats,
  ...inscriptionFlats,
  lump("F_END"),
  lump("E1M1"),
  lump("THINGS", map.things),
  lump("LINEDEFS", map.linedefs),
  lump("SIDEDEFS", map.sidedefs),
  lump("VERTEXES", map.vertexes),
  lump("SEGS", map.segs),
  lump("SSECTORS", map.subsectors),
  lump("NODES", map.nodes),
  lump("SECTORS", map.sectors),
  lump("REJECT", map.reject),
  lump("BLOCKMAP", map.blockmap),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buildWad(mapLumps));
console.log(`Wrote ${outputPath}`);

// Emit the interaction manifest the browser UI consumes (terminal read-points
// and hub-door probes), derived from the same constants that lay out the map.
// This is the single source of truth for those coordinates: src/index.ts reads
// this file instead of re-hardcoding values that silently drift when the map
// layout changes (e.g. when a terminal moves to a new back wall).
const doorOuterRadius = 448;   // a hub door sector spans hubRadius..doorOuterRadius
const roomCenterU = (room) => (room.u1 + room.u2) / 2;
const doorProbeRadius = hubRadius + (doorOuterRadius - hubRadius) / 2;
// Each interactable is described by one or more trigger *segments* — the
// object's actual interactable face/line(s) — rather than a single centre point,
// so the browser UI can offer the prompt anywhere along the object (including
// its edges) by measuring the player's distance to a segment instead of to its
// midpoint. Crucially a segment sits ON the object's face (a terminal's screen
// wall, a door's trigger line), so the prompt's range (useRange) is measured
// straight from the screen/door — the player must be within useRange of the
// actual object, not of a point standing out in front of it. A terminal's
// screen spans the panel's full width (terminalTextureSize.width); a door's
// trigger lines span doorWidth on the axis the door faces. Half-widths:
const terminalHalfWidth = terminalTextureSize.width / 2;
const doorHalfWidth = doorWidth / 2;
// Terminal read segment: the screen face itself, on the room's back wall (v2),
// running terminalHalfWidth either side of the room centre (all CPU/north-wing
// screens are on a back wall, so the face is x-axis).
const terminalSegment = (room) => {
  const cx = roomCenterU(room);
  const y = room.v2;
  return { ax: cx - terminalHalfWidth, ay: y, bx: cx + terminalHalfWidth, by: y };
};
// A hub door's two trigger lines. Both lines bounding the door sector are DR
// doors (special 1) — the inner line at hubRadius (entered from the hub) and the
// outer line at doorOuterRadius (entered from inside the wing) — so USE/space
// opens the door from either side. We surface the prompt for whichever line the
// player is near, so leaving a wing prompts just like entering it does. `dir` is
// the cardinal the door faces; the line spans doorHalfWidth on the cross axis.
const doorSegments = (dir) => {
  const line = (radius) => {
    switch (dir) {
      case "north":
        return { ax: -doorHalfWidth, ay: radius, bx: doorHalfWidth, by: radius };
      case "south":
        return { ax: -doorHalfWidth, ay: -radius, bx: doorHalfWidth, by: -radius };
      case "east":
        return { ax: radius, ay: -doorHalfWidth, bx: radius, by: doorHalfWidth };
      case "west":
        return { ax: -radius, ay: -doorHalfWidth, bx: -radius, by: doorHalfWidth };
      default:
        throw new Error(`Unknown door direction: ${dir}`);
    }
  };
  return [line(hubRadius), line(doorOuterRadius)];
};
const mapManifest = {
  useRange: 64,          // engine USERANGE (linuxdoom p_local.h) — USE trace reach
  doorOpenThreshold: 16, // ceiling lift past which a DR door reads as already open
  // CPU/north-wing terminal screens sit centred on each room's back wall; the
  // player reads one from anywhere within useRange of its screen face (a single
  // segment lying on that back wall).
  terminals: [
    { sign: "cores", segments: [terminalSegment(cpuRoomBounds.main)] },
    // RUN QUEUE terminal sits on the platform's north end wall (v 1312, the
    // platform's v2 — not the long track trench's v2), centred at u -512.
    { sign: "runqueue", segments: [{ ax: -512 - terminalHalfWidth, ay: 1312, bx: -512 + terminalHalfWidth, by: 1312 }] },
    { sign: "load", segments: [terminalSegment(cpuRoomBounds.load)] },
  ],
  // Four hub doors, one per cardinal exit. Each has two trigger segments (the
  // inner line at hubRadius and the outer line at doorOuterRadius), so the
  // prompt shows whether the player approaches from the hub or from inside the
  // wing. The probe point sits at the centre of the door sector between them and
  // reports that sector's live ceiling opening (shut vs. already open).
  doors: [
    { segments: doorSegments("north"), probeX: 0, probeY: doorProbeRadius },
    { segments: doorSegments("east"), probeX: doorProbeRadius, probeY: 0 },
    { segments: doorSegments("south"), probeX: 0, probeY: -doorProbeRadius },
    { segments: doorSegments("west"), probeX: -doorProbeRadius, probeY: 0 },
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
