// Network wing (west): a blue packet switch and conduit hall. The wing reads as
// long, directional and fluid — a central catwalk runs the length of the wing
// between two sunken RX/TX conduit lanes that flow in opposite directions, past
// interface (NIC) branch bays, through a low CHOKE pinch where saturation
// becomes legible, out into a wide section that spills DROPS into a side basin
// and bleeds NIC ERRORS down a separate dark drain, and finally onto a terminal
// plaza whose far wall carries the /proc/net/dev screen. This is the static
// baseline for Track C in PARALLEL_WINGS_PLAN.md: clear conduit grammar, blue
// identity art, signs and a terminal.
//
// This is the network wing's independent editing seam. build() lays out only the
// geometry (reading the shared builder API + palette from ctx); the screen and
// sign art are contributed via `textures`, the directional lane flats and the
// NETWORK floor inscription via `flats`, and the /proc/net/dev read-point via
// `terminals`. Everything is map-only: lane/choke/drop/error tags and the choke
// light sentinel are reserved from `ids` for future live instruments, but no
// C-renderer hook reads them yet, so the wing lands as static identity first.
// See [[map-builder-architecture]], [[telemetry-terminal-seam]] and
// [[wing-terminal-segment-rotation]].
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

// Network is fixed to the WEST cardinal wing. Local (u,v) -> world (-v,u); the
// two helpers below carry that rotation so the wing can be authored in local
// terms (u = cross-axis, v = depth from hub) and still place signs on the right
// world wall and emit the terminal read-segment in world coordinates.
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

const ids = reserved.network;
const tex = (suffix) => wingName("network", suffix);

// Custom WAD art, all under the reserved "DPN" prefix so it can't collide with
// the other wings' names.
const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["NETWORK", "NET DEV"] };
const signs = {
  rx: { texture: tex("RX"), patch: tex("PRX"), text: "RX" },
  tx: { texture: tex("TX"), patch: tex("PTX"), text: "TX" },
  congest: { texture: tex("CNG"), patch: tex("PCNG"), text: "CONGEST" },
  drops: { texture: tex("DRP"), patch: tex("PDRP"), text: "DROPS" },
  errors: { texture: tex("ERR"), patch: tex("PERR"), text: "ERRORS" },
  nic0: { texture: tex("NIC0"), patch: tex("PNI0"), text: "NIC 0" },
  nic1: { texture: tex("NIC1"), patch: tex("PNI1"), text: "NIC 1" },
};

// "NETWORK" inscribed flush into the foyer threshold floor. The reading player
// faces west here (they walk away from the hub, into -x), so it uses the west
// orientation; makeInscription bakes the per-cell rotation, and the geometry
// lays the cells out along the local cross-axis (u) the same way the east/memory
// wing does for its threshold name.
const netInscription = makeInscription(tex("FN"), "NETWORK", "west", 2);

// Directional blue conduit-lane flats: a blue floor framed by darker rails with
// chevrons streaming along the lane. RX chevrons (cyan) point hub-ward (incoming),
// TX chevrons (green) point outward (outgoing), so the two lanes read as opposed
// flows. Static here; a later engine hook can animate the flow under throughput.
const laneFlatNames = { rx: tex("RXL"), tx: tex("TXL") };
const buildLaneFlat = ({ name, base, rail, chevron, outward }) => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(base);
  const put = (x, y, color) => {
    if (x >= 0 && x < size && y >= 0 && y < size) px[y * size + x] = color;
  };
  // Side rails along the flow axis.
  for (let y = 0; y < size; y += 1) {
    put(0, y, rail);
    put(1, y, rail);
    put(size - 2, y, rail);
    put(size - 1, y, rail);
  }
  // A chevron every 16px so the lane tiles into a continuous arrow stream.
  for (let band = 0; band < size; band += 16) {
    for (let k = 0; k < 13; k += 1) {
      const y = outward ? band + k : band + 12 - k;
      put(31 - k, y, chevron);
      put(32 + k, y, chevron);
    }
  }
  return lump(name, Buffer.from(px));
};
const laneFlats = [
  buildLaneFlat({ name: laneFlatNames.rx, base: 200, rail: 204, chevron: 193, outward: false }),
  buildLaneFlat({ name: laneFlatNames.tx, base: 202, rail: 206, chevron: 112, outward: true }),
];

// Cross-axis half-widths (local u).
const CATHW = 56; //    catwalk spine
const LANEHW = 216; //  conduit lane outer edge (lane width 160)
const CHOKEHW = 120; // narrowed lane outer edge in the choke (lane width 64)
const BAYHW = 408; //   NIC branch-bay outer edge
const BASINHW = 456; // drop-basin outer edge
const DRAINHW = 360; // error-drain outer edge

// Depth boundaries (local v), hub-ward to far wall.
const V_ENTRY = 704; //  foyer begins where addWingEntrance's entry throat ends
const V_FOYER = 896; //  end of foyer / mouth of the conduit hall
const V_HALLA = 1216; // end of wide section A / start of the choke
const V_CHOKE = 1408; // end of the choke / start of wide section B
const V_HALLB = 1600; // end of section B / start of the terminal plaza
const V_PLAZA = 1744; // terminal recess front edge
const V_TERM_WALL = 1760; // the /proc/net/dev screen face (far one-sided wall)

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, base, accent, terminalPanelFloor } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top");
  const leftWall = localSideToWorld(direction, "left");
  const rightWall = localSideToWorld(direction, "right");

  // Shared sector styles. The hall walls use the network base wall (TEKWALL1);
  // the conduit lanes and side chambers take the accent wall (COMPSPAN, a blue
  // computer-panel texture) for the wing's blue identity.
  const hall = { ...base, kind: "net-hall", ceiling: 192 };
  const conduit = { ...accent, kind: "net-conduit", ceiling: 160 };
  const foyer = { ...base, kind: "foyer", light: 200 };

  // ===== Foyer, split so "NETWORK" inscribes flush into the threshold floor.
    areaRect(direction, "foyer-left", { u1: -LANEHW, v1: V_ENTRY, u2: -64, v2: V_FOYER }, { ...foyer, light: 208 });
    areaRect(direction, "foyer-right", { u1: 64, v1: V_ENTRY, u2: LANEHW, v2: V_FOYER }, { ...foyer, light: 208 });
    areaRect(direction, "foyer-front", { u1: -64, v1: V_ENTRY, u2: 64, v2: 832 }, { ...foyer, light: 208 });
    netInscription.names.forEach((flatName, k) => {
      const u1 = -64 + k * 64;
      areaRect(direction, `net-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: V_FOYER }, {
        ...foyer,
        floorFlat: flatName,
        light: 216,
      });
    });

  // ===== Conduit hall, section A: catwalk between the two RX/TX lanes.
    const catwalk = (id, v1, v2, light = 184) =>
      areaRect(direction, id, { u1: -CATHW, v1, u2: CATHW, v2 }, { ...hall, kind: "net-catwalk", floor: 0, light });
    const lane = (id, side, v1, v2, light, tag, narrow = false) => {
      const outer = narrow ? CHOKEHW : LANEHW;
      const bounds = side === "rx"
        ? { u1: -outer, v1, u2: -CATHW, v2 }
        : { u1: CATHW, v1, u2: outer, v2 };
      areaRect(direction, id, bounds, {
        ...conduit,
        kind: "net-lane",
        floor: -16,
        floorFlat: side === "rx" ? laneFlatNames.rx : laneFlatNames.tx,
        light,
        tag,
      });
    };

    catwalk("catwalk-a", V_FOYER, V_HALLA);
    lane("rx-lane-a", "rx", V_FOYER, V_HALLA, 180, ids.sectorTags[0]); //     700
    lane("tx-lane-a", "tx", V_FOYER, V_HALLA, 168, ids.sectorTags[0] + 1); // 701

    // NIC branch bays: symmetric interface alcoves off section A, one-sided so
    // the back wall carries the NIC sign. Seen across the lanes from the catwalk.
    areaRect(direction, "nic0-bay", { u1: -BAYHW, v1: 960, u2: -LANEHW, v2: 1152 }, {
      ...conduit,
      kind: "net-bay",
      floor: 8,
      floorFlat: "FLOOR1_1",
      light: 176,
      labelSide: leftWall,
      labelTexture: signs.nic0.texture,
      tag: ids.sectorTags[0] + 40, // 740
    });
    areaRect(direction, "nic1-bay", { u1: LANEHW, v1: 960, u2: BAYHW, v2: 1152 }, {
      ...conduit,
      kind: "net-bay",
      floor: 8,
      floorFlat: "FLOOR1_1",
      light: 168,
      labelSide: rightWall,
      labelTexture: signs.nic1.texture,
      tag: ids.sectorTags[0] + 41, // 741
    });
    // RX / TX lane signs: shallow recesses in the outer hall walls, one screen
    // tall, read across each lane from the catwalk.
    areaRect(direction, "rx-sign", { u1: -BAYHW, v1: 1168, u2: -LANEHW, v2: 1208 }, {
      ...conduit,
      kind: "net-sign",
      floor: 16,
      ceiling: 16 + wallSignSize.height,
      light: 184,
      labelSide: leftWall,
      labelTexture: signs.rx.texture,
    });
    areaRect(direction, "tx-sign", { u1: LANEHW, v1: 1168, u2: BAYHW, v2: 1208 }, {
      ...conduit,
      kind: "net-sign",
      floor: 16,
      ceiling: 16 + wallSignSize.height,
      light: 176,
      labelSide: rightWall,
      labelTexture: signs.tx.texture,
    });

  // ===== Choke: the lanes pinch inward and the ceiling drops, so the constriction
  // (saturation) reads from the wide hall. The pinched lane floors carry a network
  // light sentinel (reserved range 124-128): a later r_plane/light hook keys the
  // choke brightness off this exact value to show congestion. Static for now.
    catwalk("catwalk-choke", V_HALLA, V_CHOKE, 208);
    const chokeLane = (id, side, tag) => {
      lane(id, side, V_HALLA, V_CHOKE, ids.lights[1], tag, true); // light 128 (sentinel)
    };
    chokeLane("rx-choke", "rx", ids.sectorTags[0] + 10); // 710
    chokeLane("tx-choke", "tx", ids.sectorTags[0] + 11); // 711
    // CONGEST sign recessed into the left pinch wall, raised so it reads above the
    // sunken choke lane.
    areaRect(direction, "congest-sign", { u1: -184, v1: 1280, u2: -CHOKEHW, v2: 1344 }, {
      ...conduit,
      kind: "net-sign",
      floor: 16,
      ceiling: 16 + wallSignSize.height,
      light: 200,
      labelSide: leftWall,
      labelTexture: signs.congest.texture,
    });

  // ===== Conduit hall, section B: the lanes open back out before the plaza.
    catwalk("catwalk-b", V_CHOKE, V_HALLB);
    lane("rx-lane-b", "rx", V_CHOKE, V_HALLB, 180, ids.sectorTags[0]); //     700
    lane("tx-lane-b", "tx", V_CHOKE, V_HALLB, 168, ids.sectorTags[0] + 1); // 701

    // DROP basin: a wide, deep blue overflow off the RX lane where dropped
    // packets spill and pool (animated FWATER). Sign on the basin's far wall.
    areaRect(direction, "drop-basin", { u1: -BASINHW, v1: V_CHOKE, u2: -LANEHW, v2: V_HALLB }, {
      ...conduit,
      kind: "net-drop-basin",
      floor: -40,
      floorFlat: "FWATER1",
      light: 152,
      labelSide: leftWall,
      labelTexture: signs.drops.texture,
      tag: ids.sectorTags[0] + 20, // 720
    });
    // ERROR drain: a narrow, dark side channel off the TX lane, deliberately
    // separate from the drop basin and kept quiet — the red error treatment is
    // reserved for a later live NIC-error hook so static decor doesn't compete
    // with telemetry.
    areaRect(direction, "error-drain", { u1: LANEHW, v1: 1440, u2: DRAINHW, v2: 1568 }, {
      ...conduit,
      kind: "net-error-drain",
      floor: -24,
      ceiling: 152,
      floorFlat: "FLOOR0_6",
      light: 112,
      labelSide: rightWall,
      labelTexture: signs.errors.texture,
      tag: ids.sectorTags[0] + 30, // 730
    });

  // ===== Terminal plaza: the conduit converges to a floor-0 plaza, then a raised
  // recess whose far one-sided wall carries the /proc/net/dev screen (exactly one
  // screen texture tall). Read-point wired in `terminals`.
    areaRect(direction, "plaza", { u1: -LANEHW, v1: V_HALLB, u2: LANEHW, v2: V_PLAZA }, {
      ...hall,
      kind: "net-plaza",
      floor: 0,
      light: 184,
    });
    areaRect(direction, "plaza-back-left", { u1: -LANEHW, v1: V_PLAZA, u2: -128, v2: V_TERM_WALL }, {
      ...hall,
      kind: "net-plaza",
      floor: 0,
      light: 176,
    });
    areaRect(direction, "plaza-back-right", { u1: 128, v1: V_PLAZA, u2: LANEHW, v2: V_TERM_WALL }, {
      ...hall,
      kind: "net-plaza",
      floor: 0,
      light: 176,
    });
    areaRect(direction, "network-terminal", { u1: -128, v1: V_PLAZA, u2: 128, v2: V_TERM_WALL }, {
      ...hall,
      kind: "terminal",
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      light: 192,
      labelSide: backWall,
      labelTexture: screen.texture,
    });

  // ===== Cool techno floor lamps, set off the catwalk so they light the conduit
  // without blocking the spine.
    addAreaThing(direction, 2028, -180, 760);
    addAreaThing(direction, 2028, 180, 760);
    addAreaThing(direction, 2028, -360, 1056);
    addAreaThing(direction, 2028, 360, 1056);
    addAreaThing(direction, 2028, -180, 1660);
    addAreaThing(direction, 2028, 180, 1660);
};

// Texture patches this wing contributes: the /proc/net/dev screen plus the seven
// wall signs (RX / TX / CONGEST / DROPS / ERRORS / NIC 0 / NIC 1).
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
];

// Floor flats: the NETWORK threshold inscription and the two directional lane
// flats (the geometry above references both by name).
const flats = [...netInscription.flats, ...laneFlats];

// The /proc/net/dev read-point. Network is the WEST wing, so the map builder
// rotates local (u,v) -> world (-v,u); the central terminalSegment helper assumes
// the identity (north) rotation, so we emit the screen face in WORLD coords
// directly. The face is the terminal recess's far wall (local v = V_TERM_WALL),
// centred on u=0 and one screen wide.
const terminals = ({ terminalHalfWidth }) => {
  const segment = ([au, av], [bu, bv]) => {
    const [ax, ay] = rotatePoint([au, av], "west");
    const [bx, by] = rotatePoint([bu, bv], "west");
    return { ax, ay, bx, by };
  };
  return [
    {
      sign: "network",
      segments: [segment([-terminalHalfWidth, V_TERM_WALL], [terminalHalfWidth, V_TERM_WALL])],
    },
  ];
};

export const networkWing = {
  resource: "network",
  ids,
  build,
  textures,
  flats,
  sprites: [],
  terminals,
};
