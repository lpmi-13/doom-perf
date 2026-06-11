// CPU wing (north): the high-energy reactor and scheduler wing, and the
// reference quality bar for instrument clarity. Core utilization lives in the
// central core-ring chamber; saturation in the left run-queue "subway"
// (streaming task orbs through a core-count-gated constriction, plus a D-state
// I/O-wait pen); the right room carries the three load-average gauges. Three
// wall terminals correlate the instruments with mpstat / uptime / vmstat.
//
// This wing is self-registering: it exports a descriptor whose build() lays out
// the geometry and whose textures/flats/sprites/terminals are collected by
// build-doomperf-map.mjs. Everything CPU-specific (room bounds, ring geometry,
// terminal/sign definitions, reserved IDs) lives here; build() reads only the
// shared builder API + shared layout constants from the per-direction ctx.
import { addWingEntrance } from "./common.mjs";
import { controlPanelTexture, controlPanelPatch } from "./registry.mjs";
import {
  terminalTextureSize,
  signTextureSize,
  controlPanelTextureSize,
  wallSignSize,
  buildTerminalPatch,
  buildSignPatch,
  buildWallSignPatch,
  buildCpuColumnPatch,
  buildControlPanelPatch,
  buildOrbPatch,
  makeInscription,
} from "../textures.mjs";

const cpuCoreDisplay = {
  u1: -128,
  v1: 992,
  u2: 128,
  v2: 1248,
  light: 160,
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

// RUN QUEUE track-side wall signs (recessed into the far wall, facing the player).
const cpuWallSigns = [
  { texture: "DPSGQUE", patch: "DPPQUE", text: "QUEUED" },
  { texture: "DPSGRUN", patch: "DPPRUN", text: "RUNNING" },
];

// Floor name inscriptions: cell flat names per CPU sub-area. The flat pixel data
// is generated in `flats` below (via makeInscription with the same prefix/count);
// these names are static so the geometry can reference them while sectors build.
const coreInscriptionNames = Array.from({ length: 4 }, (_, k) => `DPFCOR${k}`);
const rqInscriptionNames = Array.from({ length: 3 }, (_, k) => `DPFRQ${k}`);
const loadInscriptionNames = Array.from({ length: 3 }, (_, k) => `DPFLD${k}`);

const build = (ctx) => {
  const {
    areaRect,
    addAreaThing,
    direction,
    resource,
    config,
    base,
    accent,
    terminalPanelDepth,
    terminalPanelFloor,
  } = ctx;

  addWingEntrance(ctx);

  // ===== Foyer: split to inscribe the CPU CORES name into the threshold floor.
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

  // ===== Core chamber + run-queue and load side rooms.
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

  // ===== Wall torches flanking the side-room doorways and the back staircases.
    // One torch beside each side-room doorway -- against the side wall and just
    // south of the v=1024..1216 opening (radius 16 reaches only to v=1024, so it
    // never intrudes into the entry/exit) -- and one at the foot of each back
    // staircase (stairs start at v=1368), against the rear side wall.
    addAreaThing(direction, 46, -306, 1008);
    addAreaThing(direction, 46, 306, 1008);
    addAreaThing(direction, 46, -354, 1352);
    addAreaThing(direction, 46, 354, 1352);
};

// Texture patches this wing contributes. Order is preserved from the original
// monolithic textureConfigs so the generated WAD stays byte-identical: streak
// column, terminal control-panel riser, the three terminal screens, the three
// area signs, then the two track-side wall signs. The control-panel texture is
// shared infrastructure (central sideTextures references its name) but is
// registered here, its only consumer today; promote it to a shared list when a
// second wing grows a top-label terminal.
const textures = [
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
  ...Object.values(cpuTerminalScreens).map((screen) => ({
    texture: screen.texture,
    patch: screen.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(screen),
  })),
  ...Object.values(cpuAreaSigns).map((sign) => ({
    texture: sign.texture,
    patch: sign.patch,
    width: signTextureSize.width,
    height: signTextureSize.height,
    build: () => buildSignPatch(sign.text),
  })),
  ...cpuWallSigns.map(({ texture, patch, text }) => ({
    texture,
    patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSignPatch(text),
  })),
];

// Floor-name flats. `facing` is the way the reading player looks as they approach
// each entrance: the core chamber from the south (looking north), the run-queue
// room from the east (looking west), the load room from the west (looking east).
const flats = [
  ...makeInscription("DPFCOR", "CPU CORES", "north", 4).flats,
  ...makeInscription("DPFRQ", "RUN QUEUE", "west", 3).flats,
  ...makeInscription("DPFLD", "LOAD", "east", 3).flats,
];

// Sprite replacements: each PWAD-replaces an unused IWAD item sprite by name.
// PINSA0 (blursphere) -> blue run-queue task orb; SOULA0 (soulsphere) -> green
// I/O-wait orb, a third hue distinct from the blue CPU orbs and the red trench
// floor. modifiedgame + W_GetNumForName resolve the names to these PWAD copies.
const sprites = [
  { name: "PINSA0", build: () => buildOrbPatch([4, 194, 196, 198, 200, 203]) },
  { name: "SOULA0", build: () => buildOrbPatch([4, 112, 114, 116, 118, 121]) },
];

// Terminal read-points for the interaction manifest. `api` supplies the central
// geometry helpers (terminalSegment puts the read segment on a room's back wall;
// terminalHalfWidth is half the screen width). The RUN QUEUE screen is on the
// platform's north end wall (v 1312), not the long track trench's v2, so it is
// given an explicit segment.
const terminals = ({ terminalSegment, terminalHalfWidth }) => [
  { sign: "cores", segments: [terminalSegment(cpuRoomBounds.main)] },
  { sign: "runqueue", segments: [{ ax: -512 - terminalHalfWidth, ay: 1312, bx: -512 + terminalHalfWidth, by: 1312 }] },
  { sign: "load", segments: [terminalSegment(cpuRoomBounds.load)] },
];

export const cpuWing = {
  resource: "cpu",
  build,
  textures,
  flats,
  sprites,
  terminals,
};
