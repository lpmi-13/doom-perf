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
  buildFxPatch,
  fxBlueRamp,
  fxBlueFlash,
  fxGreenRamp,
  fxSparkRamp,
  buildCpuIconFlat,
  cpuIconFlatName,
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

// The two side rooms are pushed ~5x farther from the core chamber: the angled
// entry connectors keep their 45-degree mouths, and a straight extension corridor
// (built in build()) bridges the new 256u gap, so the entry passage grows from 64u
// to 320u (5x). The run-queue moves a pure 256u WEST so only its X-coordinates
// shift -- the run-queue engine patches (0018 orb coords, 0007 display origin) are
// shifted by the same RQ_ROOM_DX. The load room moves 256u EAST; its gauges are tag
// + texture-space driven, so no engine change is needed there.
const RQ_ROOM_DX = -256;
const LOAD_ROOM_DX = 256;
const cpuRoomBounds = {
  main: { u1: -320, v1: 896, u2: 320, v2: 1624 },
  runQueue: { u1: -1024 + RQ_ROOM_DX, v1: 768, u2: -384 + RQ_ROOM_DX, v2: 1600 },
  // v2 (back/terminal wall) pulled south from 1676 to halve the empty walkway
  // between the load-average gauge bank (north edge v=1240) and the LOAD AVG
  // terminal: 436u -> 216u. The north-strip sectors, terminal panel, and the
  // terminalSegment read-point all derive from v2, so they move together.
  load: { u1: 384 + LOAD_ROOM_DX, v1: 896, u2: 884 + LOAD_ROOM_DX, v2: 1456 },
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
// Per-gauge floor nameplates inscribed in the walkway just west of each LOAD
// pillar, so the player can tell which column is which timescale on approach.
// Each is one 64x64 east-facing inscription cell (floor flats must sit on the
// 64-grid), laid contiguously and snapped to the cell that best fronts its gauge
// (5m lands dead-centre; the outer two are pulled ~32u inward by the grid). The
// flat pixel data is generated in `flats` below.
const loadGaugeNameplates = [
  { v1: 1024, inscription: makeInscription("DPLB15", "15M", "east", 1) }, // load-gauge-15m
  { v1: 1088, inscription: makeInscription("DPLB05", "5M", "east", 1) },  // load-gauge-5m
  { v1: 1152, inscription: makeInscription("DPLB01", "1M", "east", 1) },  // load-gauge-1m
];

const build = (ctx) => {
  const {
    areaRect,
    areaPoly,
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
    // Recessed blue light strips framed by support beams, lining the foyer side
    // walls (classic spacelab detailing). Each niche cuts 16u into the side wall:
    // its back face is a LITEBLU4 light strip (full-bright) and its return jambs
    // carry SUPPORT2 beams. Two per side, clear of the v=704 entry throat and the
    // v=896 chamber mouth.
    const foyerLight = { ...foyer, kind: "wall-light", wall: "SUPPORT2", light: 255 };
    [768, 832].forEach((vc, k) => {
      areaRect(direction, `foyer-lite-w${k}`, { u1: -336, v1: vc - 16, u2: -320, v2: vc + 16 }, { ...foyerLight, labelSide: "left", labelTexture: "LITEBLU4" });
      areaRect(direction, `foyer-lite-e${k}`, { u1: 320, v1: vc - 16, u2: 336, v2: vc + 16 }, { ...foyerLight, labelSide: "right", labelTexture: "LITEBLU4" });
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
      wall: "COMP2", // computer banks framing the cores + the back terminal recess (no AGM screen)
      floorFlat: "FLOOR0_1",
      ceilingFlat: "CEIL5_1",
      light: frameLight,
    };
    // Open-air variant for the core courtyard (ring + balconies + stairs) so the
    // columns are seen rising into the sky from the raised overlook. STARTAN2 walls
    // keep the big courtyard surfaces varied against the COMPUTE1 core frame.
    const openSky = { ...frame, wall: "STARTAN2", ceiling: 288, ceilingFlat: "F_SKY1" };
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
    // ===== Angled entryways (no doors) into the two side rooms. Each connector is
    // a parallelogram that leans 45 degrees off the chamber's N-S axis (run-queue
    // NW, load NE): main mouth on the chamber side wall, room mouth shifted 64u
    // north over the 64u gap, so the player veers ~45 degrees to enter instead of
    // turning a square 90. The rooms stay axis-aligned (their live instruments are
    // bound to fixed world coords); only the connector splays. The RUN QUEUE / LOAD
    // floor names are inscribed flush just inside each room at the threshold (see
    // rq-platform and load-walk-w-west below), since an angled floor can't carry
    // the 64-grid-aligned inscription cells.
    const connector = {
      ...base,
      kind: "entry",
      wall: "SUPPORT2", // angled passages framed as braced, support-beam structural throats
      floorFlat: "FLOOR0_1",
      ceilingFlat: "CEIL5_1",
      light: frameLight,
      ceiling: 144,
    };
    // Clockwise loops (interior on the right). Run-queue: room-top, main-top,
    // main-bottom, room-bottom. Load is its mirror across u=0.
    areaPoly(direction, "rq-connector", [[-384, 1224], [-320, 1160], [-320, 1000], [-384, 1064]], connector);
    areaPoly(direction, "load-connector", [[320, 1160], [384, 1224], [384, 1064], [320, 1000]], connector);
    // Straight extension corridors bridging each angled mouth (u=+/-384) to the
    // now-distant room walls, making the entry passage ~5x longer. Floor flush with
    // the connectors; SUPPORT2 walls continue the braced look. v[1064,1224] matches
    // the angled mouths' room-side edge.
    areaRect(direction, "rq-extension", { u1: cpuRoomBounds.runQueue.u2, v1: 1064, u2: -384, v2: 1224 }, connector);
    areaRect(direction, "load-extension", { u1: 384, v1: 1064, u2: cpuRoomBounds.load.u1, v2: 1224 }, connector);
    // ===== LEFT wing: RUN QUEUE — a "subway" hall. The player enters from the
    // east onto a raised PLATFORM (floor 0; RUN QUEUE wall terminal on its north
    // end wall) and looks WEST down into the sunken TRACKS (a ravine at floor -56)
    // that run far north & south past the platform, like a subway. Task-orbs
    // stream along the tracks (north->south) through a constriction whose open
    // lanes track CPU core count; stairs run the full west edge of the platform.
    // The footprint is a T: a long N-S track trench (west) with the platform as an
    // east nub at the middle, so the platform's N/S end walls are solid (terminal
    // fits) and the tracks extend past it both ways. The orbs are animated by
    // patch 0018; the CPU towers at the constriction are STATIC (see below). Light
    // levels avoid the floor-display sentinels (144/160).
    const rqRavineFloor = -56;
    const rqCeil = 224;
    // All run-queue u-coords shift by RQ_ROOM_DX (room pushed west); v unchanged.
    const rqPlatU1 = -704 + RQ_ROOM_DX, rqPlatU2 = cpuRoomBounds.runQueue.u2; // platform E-W
    const rqPlatV1 = 928, rqPlatV2 = 1312;                        // platform N-S (384 long)
    const rqStairU1 = -768 + RQ_ROOM_DX, rqStairU2 = -704 + RQ_ROOM_DX; // egress stairs (64 wide)
    const rqTrU1 = -1024 + RQ_ROOM_DX, rqTrU2 = -768 + RQ_ROOM_DX; // track trench E-W (256 wide)
    // South end held at v768 so the trench clears the west (network) wing, whose
    // geometry tops out near y704 — a solid-wall gap keeps the wings unconnected.
    const rqTrV1 = 768, rqTrV2 = 1600;                            // track trench N-S
    const rqHall = { ...base, wall: "STARTAN3", ceilingFlat: "CEIL5_1", ceiling: rqCeil };
    const platform = { ...rqHall, kind: "rq-overlook", floorFlat: "FLOOR4_8", floor: 0, light: 176 };
    const tracks = { ...rqHall, kind: "rq-ravine", floorFlat: "FLOOR1_7", floor: rqRavineFloor, light: 168 };

    // Platform (raised) + RUN QUEUE wall terminal on its solid north end wall. The
    // east strip (u[-448,-384], against the angled connector mouth) is carved to
    // inscribe RUN QUEUE flush into the floor at the threshold; the bulk of the
    // platform stays one sector to its west.
    const rqTermV = rqPlatV2 - terminalPanelDepth;   // 1296
    const rqTermU1 = -640 + RQ_ROOM_DX;              // 256-wide screen, east-aligned
    const rqInscU1 = -448 + RQ_ROOM_DX;             // east threshold strip (64 wide)
    areaRect(direction, "rq-platform", { u1: rqPlatU1, v1: rqPlatV1, u2: rqInscU1, v2: rqTermV }, platform);
    areaRect(direction, "rq-plat-thresh-s", { u1: rqInscU1, v1: rqPlatV1, u2: rqPlatU2, v2: 1024 }, platform);
    rqInscriptionNames.forEach((flatName, k) => {
      const v1 = 1024 + k * 64;
      areaRect(direction, `rq-inscription-${k}`, { u1: rqInscU1, v1, u2: rqPlatU2, v2: v1 + 64 }, { ...platform, floorFlat: flatName });
    });
    areaRect(direction, "rq-plat-thresh-n", { u1: rqInscU1, v1: 1216, u2: rqPlatU2, v2: rqTermV }, platform);
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
    // Constriction: FOUR free-standing CPU TOWERS, with the orb lanes threading
    // between them. The towers are deliberately STATIC -- never driven by
    // telemetry. The orbs alone carry the live queue/run/blocked state (patch
    // 0018), so the towers can stand permanently raised. They sit centred in the
    // four 64-unit grid cells (centres -1248/-1184/-1120/-1056), 32u square, so
    // each shows the icon flat's centre (no seam wrap) and the three orb lanes run
    // in the 32u gaps between them (centres -1216/-1152/-1088, matching patch
    // 0018's LANE_X0/PITCH) with ~10u clearance. Each tower rises to a pedestal
    // whose top sits just below eye level (viewable from the overlook): floor -16,
    // ~40u above the track. The tower HEIGHT is fixed (no sector sink tag), but the
    // riser faces carry linedef tag 101+i, so patch 0013's rising-streak renderer
    // paints them exactly like the main-room cores -- streak colour and density
    // driven by core i's live utilization (doomperf_cpu_cores[i]). kind rq-tower is
    // an equipmentKind so the riser draws the wall (DPCOLM) the streaks overpaint,
    // not STEP1; tops carry the chip icon. Gate animation in patch 0018 is a no-op
    // (no sector carries the gate tags).
    const rqCell = (rqTrU2 - rqTrU1) / 4;            // 64: cell pitch (matches 0018)
    const rqTowerHalf = 16;                          // 32u-square tower footprint
    const rqTowerFloor = -16;                        // ~40u pedestal; top just below eye
    const rqTowerXs = [0, 1, 2, 3].map((i) => rqTrU1 + rqCell / 2 + i * rqCell); // -1248..-1056
    const strip = { ...tracks, kind: "rq-lane" };    // orb lanes / end fillers: plain track floor
    const tower = {
      ...tracks,
      kind: "rq-tower",
      floor: rqTowerFloor,
      floorFlat: cpuIconFlatName,
      wall: cpuCoreWallTexture,                      // streak fallback; matches the cores
      light: 200,
    };
    let cu = rqTrU1;
    rqTowerXs.forEach((tx, i) => {
      areaRect(direction, `rq-lane-${i}`, { u1: cu, v1: rqConV1, u2: tx - rqTowerHalf, v2: rqConV2 }, strip);
      areaRect(direction, `rq-tower-${i}`, { u1: tx - rqTowerHalf, v1: rqConV1, u2: tx + rqTowerHalf, v2: rqConV2 }, { ...tower, lineTag: 101 + i });
      cu = tx + rqTowerHalf;
    });
    areaRect(direction, "rq-lane-4", { u1: cu, v1: rqConV1, u2: rqTrU2, v2: rqConV2 }, strip);
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
    // low v): 1m, 5m, 15m. Each gauge is a full-height (256-tall, floor->ceiling)
    // pillar whose floor-facing lower wall fills from the bottom by patches 0017/
    // 0029 (lineTags 121/122/123). Full scale is 2x cores; the load==cores
    // saturation line lands at the mid-height (world 128). Band edges reuse
    // existing global v-cuts so the carving adds no cuts across the core chamber
    // (only the u=512/640 cuts, which stay east of it).
    const loadWalk = {
      ...base,
      kind: "load-room",
      wall: "STARTAN2",
      floorFlat: "FLOOR4_8",
      ceilingFlat: "CEIL5_1",
      ceiling: 256,
      light: 176,
    };
    const loadGauge = {
      ...base,
      kind: "load-gauge",
      wall: cpuCoreWallTexture,
      floor: 256,
      ceiling: 256,
      floorFlat: "FLOOR0_1",
      ceilingFlat: "CEIL5_1",
      light: 176,
    };
    // Gauge column + terminal centred on the room centre (u=634 + LOAD_ROOM_DX);
    // all load u-coords shift east by LOAD_ROOM_DX with the room. v is unchanged.
    const loadGU1 = 570 + LOAD_ROOM_DX, loadGU2 = 698 + LOAD_ROOM_DX; // gauge column (128 wide)
    const loadTermU1 = 506 + LOAD_ROOM_DX, loadTermU2 = 762 + LOAD_ROOM_DX; // terminal (256 wide)
    const loadGaugeV2 = 1240;                       // south gauge band top
    // West walkway in front of the gauges, split so the per-gauge floor
    // nameplates (a 64-deep u-strip at u448..512) can be inscribed without
    // overlapping sectors. West/east strips flank the nameplate strip; the
    // nameplate strip itself is plain walk except for the three label cells.
    const loadLabelU1 = 448 + LOAD_ROOM_DX, loadLabelU2 = 512 + LOAD_ROOM_DX;
    // West walkway strip (u[384,448], against the angled connector mouth), carved to
    // inscribe LOAD flush into the floor at the threshold.
    areaRect(direction, "load-walk-w-west-s", { u1: cpuRoomBounds.load.u1, v1: cpuRoomBounds.load.v1, u2: loadLabelU1, v2: 1024 }, loadWalk);
    loadInscriptionNames.forEach((flatName, k) => {
      const v1 = 1024 + k * 64;
      areaRect(direction, `load-inscription-${k}`, { u1: cpuRoomBounds.load.u1, v1, u2: loadLabelU1, v2: v1 + 64 }, { ...loadWalk, floorFlat: flatName });
    });
    areaRect(direction, "load-walk-w-west-n", { u1: cpuRoomBounds.load.u1, v1: 1216, u2: loadLabelU1, v2: loadGaugeV2 }, loadWalk);
    areaRect(direction, "load-walk-w-strip-n", { u1: loadLabelU1, v1: cpuRoomBounds.load.v1, u2: loadLabelU2, v2: loadGaugeNameplates[0].v1 }, loadWalk);
    loadGaugeNameplates.forEach(({ v1, inscription }, k) => {
      areaRect(direction, `load-nameplate-${k}`, { u1: loadLabelU1, v1, u2: loadLabelU2, v2: v1 + 64 }, { ...loadWalk, floorFlat: inscription.names[0] });
    });
    areaRect(direction, "load-walk-w-strip-s", { u1: loadLabelU1, v1: loadGaugeNameplates[loadGaugeNameplates.length - 1].v1 + 64, u2: loadLabelU2, v2: loadGaugeV2 }, loadWalk);
    areaRect(direction, "load-walk-w-east", { u1: loadLabelU2, v1: cpuRoomBounds.load.v1, u2: loadGU1, v2: loadGaugeV2 }, loadWalk);
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
    // One torch beside each angled side-room mouth -- against the side wall and just
    // south of the new v=1000..1160 opening (radius 16 reaches only to v=1000, so it
    // never intrudes into the entry/exit) -- and one at the foot of each back
    // staircase (stairs start at v=1368), against the rear side wall.
    addAreaThing(direction, 46, -306, 984);
    addAreaThing(direction, 46, 306, 984);
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
  ...loadGaugeNameplates.flatMap(({ inscription }) => inscription.flats),
  ...buildCpuIconFlat(), // CPU-chip flat capping the RUN QUEUE lane gates
];

// Sprite replacements: each PWAD-replaces an unused IWAD item sprite by name.
// PINSA0 (blursphere) -> blue run-queue task orb; SOULA0 (soulsphere) -> green
// I/O-wait orb, a third hue distinct from the blue CPU orbs and the red trench
// floor. modifiedgame + W_GetNumForName resolve the names to these PWAD copies.
const sprites = [
  { name: "PINSA0", build: () => buildOrbPatch([4, 194, 196, 198, 200, 203]) },
  { name: "SOULA0", build: () => buildOrbPatch([4, 112, 114, 116, 118, 121]) },
  // Spawn/despawn polish frames (engine patch 0037). The orb mobj states chain
  // bloom -> static orb on spawn, and burst/fade -> S_NULL on despawn; sparks are
  // a separate completion mobj. BON1* = blue CPU-orb FX, BON2* = green I/O-orb FX
  // plus the blue completion sparks (C/D). Frame letters must stay A..D -- those
  // are the only BON1/BON2 frames in the IWAD, so only they can be PWAD-overridden.
  { name: "BON1A0", build: () => buildFxPatch({ size: 22, ramp: fxBlueRamp, outerFrac: 0.4 }) },   // CPU grow / small
  { name: "BON1B0", build: () => buildFxPatch({ size: 22, ramp: fxBlueRamp, outerFrac: 0.78 }) },  // CPU grow / near-orb
  { name: "BON1C0", build: () => buildFxPatch({ size: 32, ramp: fxBlueFlash, outerFrac: 0.72 }) }, // CPU burst flash
  { name: "BON1D0", build: () => buildFxPatch({ size: 32, ramp: fxBlueRamp, innerFrac: 0.55 }) },  // CPU burst ring
  { name: "BON2A0", build: () => buildFxPatch({ size: 22, ramp: fxGreenRamp, outerFrac: 0.4 }) },  // I/O grow / small
  { name: "BON2B0", build: () => buildFxPatch({ size: 22, ramp: fxGreenRamp, outerFrac: 0.78 }) }, // I/O grow / near-orb
  { name: "BON2C0", build: () => buildFxPatch({ size: 12, ramp: fxSparkRamp, outerFrac: 0.62 }) }, // spark frame 1
  { name: "BON2D0", build: () => buildFxPatch({ size: 12, ramp: fxBlueRamp, outerFrac: 0.4 }) },   // spark frame 2 (dimmer)
];

// Terminal read-points for the interaction manifest. `api` supplies the central
// geometry helpers (terminalSegment puts the read segment on a room's back wall;
// terminalHalfWidth is half the screen width). The RUN QUEUE screen is on the
// platform's north end wall (v 1312), not the long track trench's v2, so it is
// given an explicit segment.
const terminals = ({ terminalSegment, terminalHalfWidth }) => [
  { sign: "cores", segments: [terminalSegment(cpuRoomBounds.main)] },
  { sign: "runqueue", segments: [{ ax: -512 + RQ_ROOM_DX - terminalHalfWidth, ay: 1312, bx: -512 + RQ_ROOM_DX + terminalHalfWidth, by: 1312 }] },
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
