// Network wing (west): a long DESCENDING HALL carrying the packet stream down the
// network stack. The player walks STAIRS down either side of the hall, railed off
// (they cannot step into the middle). Down the centre run TWO TROUGH CHANNELS -- deep
// contained water channels, RX (left) and TX (right), split by a raised median wall --
// that carry the packet-orbs the length of the hall and drop them over a CLIFF
// (waterfall) at each of the two lock boundaries and again into the terminal plaza.
//
// The three flat levels are the three real queue levels a packet crosses -- socket /
// OS queue -> kernel buffer -> device ring buffer. Each channel's floor RISES with its
// lock's live queue fill (the water level); the orbs ride down the channel above it
// and tumble each cliff. The player is kept out of the channels by an impassable
// see-through rail (the trench sectors are `blockEdge`: two-sided so you look down
// into them, blocking so you can't fall in and the NOCLIP orbs pass freely). The deep
// back wall carries the /proc/net/dev IFACE DEV terminal (the wire). NETWORK_CANAL_PLAN.md.
//
// This is the network wing's independent editing seam. build() lays out only the
// geometry; screens via `textures`, channel lane flats + TRAFFIC inscription + drain
// flat via `flats`, packet-orb sprites via `sprites`, read-points via `terminals`. The
// channel/orb ANIMATION lives in the engine (p_tick.c, fed by the DoomPerf_SetNetLock*
// setters); the world-centres + walk levels + WATERFALL lines below are mirrored there
// and MUST stay in sync (the RING_PITCH discipline). See [[map-builder-architecture]],
// [[telemetry-terminal-seam]], [[wing-terminal-segment-rotation]],
// [[pwad-sprite-override-constraint]], [[doomperf-engine-global-externs]].
import { addWingEntrance } from "./common.mjs";
import { reserved, wingName } from "./registry.mjs";
import {
  terminalTextureSize,
  wallSignSize,
  buildTerminalPatch,
  buildWallSign2Patch,
  buildOrbPatch,
  buildFxPatch,
  makeInscription,
} from "../textures.mjs";
import { lump } from "../wad-bytes.mjs";

// Network is fixed to the WEST cardinal wing. Local (u,v) -> world (-v,u).
const localSideToWorld = (direction, side) => {
  const turns = { north: 0, east: 1, south: 2, west: 3 }[direction];
  const sides = ["top", "right", "bottom", "left"];
  const index = sides.indexOf(side);
  if (turns === undefined || index === -1) {
    throw new Error(`Cannot rotate side ${side} for direction ${direction}`);
  }
  return sides[(index + turns) % sides.length];
};

const rotatePoint = ([u, v], direction) => {
  switch (direction) {
    case "north": return [u, v];
    case "east": return [v, -u];
    case "south": return [-u, -v];
    case "west": return [-v, u];
    default: throw new Error(`Unknown map direction: ${direction}`);
  }
};

const ids = reserved.network;
const tex = (suffix) => wingName("network", suffix);

const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["NETWORK", "IFACE DEV"] };
const socketsScreen = { texture: tex("STRM"), patch: tex("PSTR"), lines: ["SS -S", "TCP STATES"] };

// Level placards: a two-line wall sign naming each level's queue -- socket/OS queue,
// kernel buffer, device ring buffer -- mounted in a niche on the outer walls so the
// player reads which buffer they're descending through. Indexed by level (0/1/2).
const levelSigns = [
  { texture: tex("SGOS"), patch: tex("PGOS"), l1: "OS", l2: "BUFFER" },
  { texture: tex("SGKR"), patch: tex("PGKR"), l1: "KERNEL", l2: "BUFFER" },
  { texture: tex("SGDV"), patch: tex("PGDV"), l1: "DEVICE", l2: "BUFFER" },
];

const netInscription = makeInscription(tex("FN"), "TRAFFIC", "west", 2);

// Blue channel water flats (RX/TX, framed by rails) + a dark still-water drain flat.
const laneFlatNames = { rx: tex("RXL"), tx: tex("TXL") };
const buildLaneFlat = ({ name, base, rail }) => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(base);
  const put = (x, y, color) => {
    if (x >= 0 && x < size && y >= 0 && y < size) px[y * size + x] = color;
  };
  for (let y = 0; y < size; y += 1) {
    put(0, y, rail); put(1, y, rail); put(size - 2, y, rail); put(size - 1, y, rail);
  }
  return lump(name, Buffer.from(px));
};
const drainFlatName = tex("DRN");
const buildDrainFlat = () => lump(drainFlatName, Buffer.from(new Uint8Array(64 * 64).fill(207)));
const laneFlats = [
  buildLaneFlat({ name: laneFlatNames.rx, base: 200, rail: 204 }),
  buildLaneFlat({ name: laneFlatNames.tx, base: 202, rail: 206 }),
  buildDrainFlat(),
];

// ===== Cross-axis half-widths (local u). Centre-out: median wall | RX/TX trough |
// player walkway. The centre band (median + troughs, u[-112,112]) is the TRAFFIC that
// cliffs between levels and is railed off from the player; the side bands (u[112..320])
// are the walkways/stairs the player descends -- WIDE (208 each) so the player has
// plenty of room either side of the traffic. Widening these leaves the traffic lanes
// (and every engine coord) untouched -- only the outer wall + alcove move out.
const EDGEHW = 320; //   outer wall (walkways doubled to 208 wide each)
const POOLHW = 112; //   trough outer edge (== traffic-channel outer edge / walkway inner edge)
const MEDHW = 24; //     central median-wall half-width (48-wide divider between the two troughs)
const LANEHW = (MEDHW + POOLHW) / 2; // 68 -> |world y| of each lane (trough centre)
const ALCHW = 504; //    SYN alcove bay deep wall (kept 184 deep past the wider outer wall)
const ALC_RECESS = 16;

// ===== Depth boundaries (local v). Long flat levels (512) joined by compact stair /
// cliff transitions (128). Mirrors the engine's DoomPerf_NET_* region/spawn constants.
const V_ENTRY = 704, V_FOYER = 896;
const LVL_LEN = 512, TRANS = 128, GATE_D = 16;
const C0 = V_FOYER + LVL_LEN; //       1408  waterfall 0 (socket -> kernel)
const C1 = C0 + TRANS + LVL_LEN; //    2048  waterfall 1 (kernel -> ring)
const V_L2END = C1 + TRANS + LVL_LEN;//2688  ring channel end (final cliff -> plaza)
const V_PLAZA = V_L2END + 112; //      2800  terminal plaza front edge
const V_TERM_WALL = V_PLAZA + 16; //   2816  back wall: IFACE DEV screen

// ===== Walk floors (local z): 0 / -96 / -192, a deep descent. The channel drops the
// full 96 as a CLIFF at each waterfall; the walkways take a 4-step staircase.
const F0 = 0, F1 = -96, F2 = -192;
const STEP_DROP = 24; //   walkway staircase riser
const POOL_EMPTY = 64; //  trough floor below walk when drained (a deep channel)
const POOL_FULL = 32; //   trough floor below walk when brimming (stays below the low median top)
const ORB_RIDE = -16; //   orb ride-height RELATIVE to walk: down IN the channel, above the median top (mirrored in p_tick.c)
const HALL_CEIL = 176; //  FLAT ceiling (absolute) for the whole hall -- it does NOT
//                         drop with the levels, so the space grows more cavernous as
//                         the floor descends and the far depths open up from the top.

const POOL_TAG = ids.sectorTags[0]; //       700 + level*2 + lane
const GATE_TAG = ids.sectorTags[0] + 10; //  710 + level

// The walls of the TRAFFIC channels (trough sides, median, gate brink) wear a distinct
// blue computer-tile texture so they read clearly as the network-data area, NOT the
// same STEP1 tan risers the player's stairs/walkways use (the builder defaults every
// floor-step riser to STEP1; a sector's `riserWall` overrides the riser its neighbours
// show it — build-doomperf-map.mjs sideTextures). [[riser-texture-and-light-rules]]
const TROUGH_WALL = "COMPTILE";

// Per level: channel v-range [cv1,cv2] and walkway start `sv1` (later than cv1 by the
// previous staircase). Level walk floor `walk`.
const levels = [
  { level: 0, walk: F0, cv1: V_FOYER, cv2: C0,     sv1: V_FOYER },
  { level: 1, walk: F1, cv1: C0,      cv2: C1,     sv1: C0 + TRANS },
  { level: 2, walk: F2, cv1: C1,      cv2: V_L2END, sv1: C1 + TRANS },
];
const stairs = [
  { id: "stair0", v1: C0, v2: C0 + TRANS, wTop: F0 },
  { id: "stair1", v1: C1, v2: C1 + TRANS, wTop: F1 },
];

// Packet-lane world-coords (west wing), mirrored in p_tick.c. Lanes y=+/-68 (trough
// centres) along x = -v; RX up-stack (+x), TX down (-x). Waterfalls at world x=-C0/-C1.
export const networkCanal = {
  laneY: LANEHW,
  rxSpawnV: V_L2END - 48, rxExitV: 960,
  txSpawnV: 960, txExitV: V_L2END - 48,
  fall: [C0, C1],
};

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, base, accent, terminalPanelFloor } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top");
  const leftWall = localSideToWorld(direction, "left");
  const rightWall = localSideToWorld(direction, "right");

  const hall = { ...base, kind: "net-hall" };
  const conduit = { ...accent, kind: "net-conduit" };
  const foyer = { ...base, kind: "foyer", light: 200 };

  // ===== Foyer, split so "TRAFFIC" inscribes flush into the threshold floor.
  areaRect(direction, "foyer-left", { u1: -EDGEHW, v1: V_ENTRY, u2: -64, v2: V_FOYER }, { ...foyer, ceiling: HALL_CEIL, light: 208 });
  areaRect(direction, "foyer-right", { u1: 64, v1: V_ENTRY, u2: EDGEHW, v2: V_FOYER }, { ...foyer, ceiling: HALL_CEIL, light: 208 });
  areaRect(direction, "foyer-front", { u1: -64, v1: V_ENTRY, u2: 64, v2: 832 }, { ...foyer, ceiling: HALL_CEIL, light: 208 });
  netInscription.names.forEach((flatName, k) => {
    const u1 = -64 + k * 64;
    areaRect(direction, `net-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: V_FOYER }, {
      ...foyer, ceiling: HALL_CEIL, floorFlat: flatName, light: 216,
    });
  });

  // ===== The central TRAFFIC CHANNEL, per level: a raised median WALL divider and two
  // deep TROUGH channels (RX/TX) either side of it, floor rising with the lock's fill.
  // The troughs are `blockEdge` -- an impassable, see-through rail: the player looks
  // down into them but cannot enter, and the NOCLIP orbs pass through.
  const channel = (lvl) => {
    const { level, walk, cv1 } = lvl;
    const id = `net${level}`;
    const brink = lvl.cv2 - GATE_D; // troughs run to the brink; the gate sill is the last GATE_D
    const ceiling = HALL_CEIL;
    // The median is a LOW divider (walk-24, well below the elevated walkways and below
    // the orb ride-height, above the full water line) so the player, standing on the
    // raised side walkways, can see over it into BOTH troughs from either side. It is
    // `blockEdge` (impassable, see-through) so it reads as a rail, not a floor to enter.
    areaRect(direction, `${id}-median`, { u1: -MEDHW, v1: cv1, u2: MEDHW, v2: brink }, { ...conduit, kind: "net-median", floor: walk - 24, ceiling, light: 176, blockEdge: true, riserWall: TROUGH_WALL });
    areaRect(direction, `${id}-trough-rx`, { u1: -POOLHW, v1: cv1, u2: -MEDHW, v2: brink }, { ...conduit, kind: "net-pool", floor: walk - POOL_EMPTY, ceiling, floorFlat: laneFlatNames.rx, light: 168, tag: POOL_TAG + level * 2 + 0, blockEdge: true, riserWall: TROUGH_WALL });
    areaRect(direction, `${id}-trough-tx`, { u1: MEDHW, v1: cv1, u2: POOLHW, v2: brink }, { ...conduit, kind: "net-pool", floor: walk - POOL_EMPTY, ceiling, floorFlat: laneFlatNames.tx, light: 168, tag: POOL_TAG + level * 2 + 1, blockEdge: true, riserWall: TROUGH_WALL });
  };

  // The brink sill (last GATE_D of a level's channel): a lit band across the troughs at
  // the water's edge that BRIGHTENS with the lock's saturation (the congestion gate),
  // the water pooling behind it before spilling over the cliff. Overspill orbs plop
  // here on drops (engine). Also `blockEdge` so the player can't drop onto it.
  const gateSill = (lvl) => {
    const { level, walk, cv2 } = lvl;
    const v1 = cv2 - GATE_D;
    const ceiling = HALL_CEIL;
    areaRect(direction, `net${level}-gate`, { u1: -POOLHW, v1, u2: POOLHW, v2: cv2 }, { ...conduit, kind: "net-gate", floor: walk - POOL_EMPTY, ceiling, floorFlat: drainFlatName, light: 150, tag: GATE_TAG + level, blockEdge: true, riserWall: TROUGH_WALL });
  };

  // The player BANK walkways of a level: a flat walk on each side, run the FULL level
  // [sv1, cv2] (the gate sill is centre-only, so the walkway must span past it or the
  // player hits a dead-end wall there). It meets the next staircase at cv2.
  const banks = (lvl) => {
    const { level, walk, sv1, cv2 } = lvl;
    const ceiling = HALL_CEIL;
    areaRect(direction, `net${level}-walk-l`, { u1: -EDGEHW, v1: sv1, u2: -POOLHW, v2: cv2 }, { ...hall, kind: "net-walk", floor: walk, ceiling, light: 186 });
    areaRect(direction, `net${level}-walk-r`, { u1: POOLHW, v1: sv1, u2: EDGEHW, v2: cv2 }, { ...hall, kind: "net-walk", floor: walk, ceiling, light: 186 });
  };

  // The BANK staircase between two levels: constant-grade 24-unit steps on the side
  // bands ONLY (u[POOLHW..EDGEHW]); the centre band is the next level's channel,
  // already dropped over its cliff -- so the water falls while the player steps down.
  const sideStair = (s) => {
    const stepV = (s.v2 - s.v1) / 4;
    for (let k = 0; k < 4; k += 1) {
      const floor = s.wTop - (k + 1) * STEP_DROP;
      const ceiling = HALL_CEIL;
      const sv1 = s.v1 + k * stepV, sv2 = s.v1 + (k + 1) * stepV;
      areaRect(direction, `${s.id}-l-${k}`, { u1: -EDGEHW, v1: sv1, u2: -POOLHW, v2: sv2 }, { ...hall, kind: "net-stair", floor, ceiling, light: 172 });
      areaRect(direction, `${s.id}-r-${k}`, { u1: POOLHW, v1: sv1, u2: EDGEHW, v2: sv2 }, { ...hall, kind: "net-stair", floor, ceiling, light: 172 });
    }
  };

  levels.forEach(channel);
  levels.forEach(gateSill);
  levels.forEach(banks);
  stairs.forEach(sideStair);

  // ===== Level placards: a two-line wall sign (OS / KERNEL / DEVICE + BUFFER) in a
  // shallow 256-wide x 128-tall niche in each level's outer wall, naming the queue the
  // player is descending through. The niche is floor-flush with a lowered valance so
  // the 128-tall sign maps once ([[doom-wall-texture-128-tiling]]); labelWidth=256
  // centres it ([[wall-label-centering-width]]). Placed on BOTH outer walls of every
  // level (the SYN alcove was tucked to the socket-level entrance to keep this centre
  // clear).
  const SIGN_W = wallSignSize.width; // 256
  const placard = (lvl, side) => {
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    const uNiche = side === "left"
      ? { u1: -EDGEHW - ALC_RECESS, u2: -EDGEHW }
      : { u1: EDGEHW, u2: EDGEHW + ALC_RECESS };
    areaRect(direction, `net${lvl.level}-sign-${side}`, { ...uNiche, v1: vc - SIGN_W / 2, v2: vc + SIGN_W / 2 }, {
      ...hall,
      kind: "net-sign",
      floor: lvl.walk,
      ceiling: lvl.walk + wallSignSize.height, // a 128-tall labelled face (no tiling)
      light: 210,
      labelSide: side === "left" ? leftWall : rightWall,
      labelTexture: levelSigns[lvl.level].texture,
      labelWidth: SIGN_W,
    });
  };
  placard(levels[0], "left"); placard(levels[0], "right"); // socket / OS buffer
  placard(levels[1], "left"); placard(levels[1], "right"); // kernel
  placard(levels[2], "left"); placard(levels[2], "right"); // device

  // ===== SYN-RECV alcove off the socket level's left bank: a walk-in bay whose deep
  // wall carries a backlog COLUMN (floor rises into a pillar with the half-open count,
  // tag 730) and the ss census terminal. Sits near the level ENTRANCE (v 904..1016) so
  // it leaves the level centre clear for the OS BUFFER placard on this same left wall.
  areaRect(direction, "syn-bay", { u1: -ALCHW, v1: 904, u2: -EDGEHW, v2: 1016 }, {
    ...conduit, kind: "net-alcove", floor: F0, ceiling: HALL_CEIL, light: 196,
  });
  areaRect(direction, "syn-column", { u1: -ALCHW - ALC_RECESS, v1: 912, u2: -ALCHW, v2: 960 }, {
    ...conduit, kind: "net-instrument", floor: F0, ceiling: F0 + 160, light: 208, tag: ids.sectorTags[0] + 30,
  });
  areaRect(direction, "syn-term", { u1: -ALCHW - ALC_RECESS, v1: 968, u2: -ALCHW, v2: 1016 }, {
    ...conduit,
    kind: "terminal",
    floor: F0 + terminalPanelFloor,
    ceiling: F0 + terminalPanelFloor + terminalTextureSize.height,
    light: 192,
    labelSide: leftWall,
    labelTexture: socketsScreen.texture,
    controlPanel: true,
  });

  // ===== Terminal plaza at the wire/ring level: the back wall carries the IFACE DEV
  // screen on its control-panel riser above the deep plaza floor.
  areaRect(direction, "plaza", { u1: -EDGEHW, v1: V_L2END, u2: EDGEHW, v2: V_PLAZA }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 176,
  });
  areaRect(direction, "plaza-back-left", { u1: -EDGEHW, v1: V_PLAZA, u2: -128, v2: V_TERM_WALL }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 168,
  });
  areaRect(direction, "plaza-back-right", { u1: 128, v1: V_PLAZA, u2: EDGEHW, v2: V_TERM_WALL }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 168,
  });
  areaRect(direction, "network-terminal", { u1: -128, v1: V_PLAZA, u2: 128, v2: V_TERM_WALL }, {
    ...hall,
    kind: "terminal",
    floor: F2 + terminalPanelFloor,
    ceiling: F2 + terminalPanelFloor + terminalTextureSize.height,
    light: 192,
    labelSide: backWall,
    labelTexture: screen.texture,
    controlPanel: true,
  });

  // ===== Techno floor lamps, only in the two wide open rooms (foyer + plaza), hugging
  // the (now wider) side walls so they stay clear of the walking area.
  addAreaThing(direction, 2028, -288, 800);
  addAreaThing(direction, 2028, 288, 800);
  addAreaThing(direction, 2028, -288, V_PLAZA - 24);
  addAreaThing(direction, 2028, 288, V_PLAZA - 24);
};

const textures = [
  ...[screen, socketsScreen].map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(s),
  })),
  // Level placards (OS / KERNEL / DEVICE buffer), two-line wall signs.
  ...levelSigns.map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSign2Patch(s.l1, s.l2),
  })),
];

const flats = [...netInscription.flats, ...laneFlats];

const cyanRamp = [4, 192, 194, 196, 198, 200];
const cyanFlash = [4, 4, 4, 192, 194, 198];
const violetRamp = [4, 250, 251, 252, 253, 254];
const violetFlash = [4, 4, 250, 251, 252, 254];
const sprites = [
  { name: "PINVA0", build: () => buildOrbPatch(cyanRamp) },
  { name: "PINVB0", build: () => buildFxPatch({ size: 22, ramp: cyanRamp, outerFrac: 0.78 }) },
  { name: "PINVC0", build: () => buildFxPatch({ size: 32, ramp: cyanFlash, outerFrac: 0.72 }) },
  { name: "PINVD0", build: () => buildFxPatch({ size: 32, ramp: cyanRamp, innerFrac: 0.55 }) },
  { name: "PMAPA0", build: () => buildOrbPatch(violetRamp) },
  { name: "PMAPB0", build: () => buildFxPatch({ size: 22, ramp: violetRamp, outerFrac: 0.78 }) },
  { name: "PMAPC0", build: () => buildFxPatch({ size: 32, ramp: violetFlash, outerFrac: 0.72 }) },
  { name: "PMAPD0", build: () => buildFxPatch({ size: 32, ramp: violetRamp, innerFrac: 0.55 }) },
];

const terminals = ({ terminalHalfWidth }) => {
  const segment = ([au, av], [bu, bv]) => {
    const [ax, ay] = rotatePoint([au, av], "west");
    const [bx, by] = rotatePoint([bu, bv], "west");
    return { ax, ay, bx, by };
  };
  const deep = -(ALCHW + ALC_RECESS);
  return [
    {
      sign: "network",
      segments: [segment([-terminalHalfWidth, V_TERM_WALL], [terminalHalfWidth, V_TERM_WALL])],
    },
    {
      sign: "network-sockets",
      segments: [segment([deep, 968], [deep, 1016])],
    },
  ];
};

export const networkWing = {
  resource: "network",
  ids,
  build,
  textures,
  flats,
  sprites,
  terminals,
};
