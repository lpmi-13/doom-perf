// Network wing (west): a blue conduit hall built around a central PACKET GROVE.
// The defining feature is a sunken central trough — a "skateboard halfpipe" with
// the floor stepping down from the outer walkways (0) through a mid step (-24)
// into a trough (-48) — that runs the whole depth of the wing, from the foyer
// straight back to the /proc/net/dev terminal. Two opposed packet streams flow
// in the trough: cyan RX orbs glide hub-ward in the left lane, violet TX orbs
// glide back-wall-ward in the right lane (the orbs are runtime mobjs spawned by
// the engine network-packets tick; density scales with live RX/TX throughput).
// The player walks the raised edges, or drops into the trough and crosses where
// the packets stream. Everything else is the SECONDARY SATURATION layer flanking
// the grove: a mid-grove CHOKE where the channel necks down and darkens (the
// trough pinches and the ceiling drops, so congestion reads as packets crowding
// the narrows), a DROPS overflow basin and a separate dark ERROR drain, plus the
// RX / TX / NIC / CONGEST signs.
//
// This is the network wing's independent editing seam. build() lays out only the
// geometry (reading the shared builder API + palette from ctx); the screen and
// sign art are contributed via `textures`, the directional lane flats and the
// NETWORK floor inscription via `flats`, the two packet-orb sprites (+ their
// bloom/fade FX) via `sprites`, and the /proc/net/dev read-point via `terminals`.
// The packet motion itself lives in the engine (p_tick.c DoomPerf_UpdateNetwork-
// Packets, fed by DoomPerf_EffectiveNetworkRx/Tx); the lane world-coords below
// are mirrored there. See [[map-builder-architecture]], [[telemetry-terminal-seam]],
// [[wing-terminal-segment-rotation]] and [[pwad-sprite-override-constraint]].
import { addWingEntrance } from "./common.mjs";
import { reserved, wingName } from "./registry.mjs";
import {
  terminalTextureSize,
  netPatchPanelSize,
  netGaugeSize,
  buildTerminalPatch,
  buildNetPatchPanelPatch,
  buildNetGaugePatch,
  buildOrbPatch,
  buildFxPatch,
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
// the other wings' names. The wing carries exactly the instruments the user asked
// for: total traffic in/out (the grove sprites + the one back-wall IFACE screen)
// and the three socket-level instruments, each a visualization + its own terminal
// living together in a widened side alcove.
//   screen        - back-wall IFACE DEV terminal (total traffic in/out)
//   queuesScreen  - the terminal beside each queue standpipe (SendQ/RecvQ backlog)
//   socketsScreen - the terminal beside the socket-state patch panel
//   socketPanel   - the TCP socket-state patch-panel wall (visualization)
//   recvGauge/sendGauge - the twin queue standpipe gauges (visualizations)
const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["NETWORK", "IFACE DEV"] };
const queuesScreen = { texture: tex("QTRM"), patch: tex("PQTR"), lines: ["SOCKET Q", "SEND RECV"] };
const socketsScreen = { texture: tex("STRM"), patch: tex("PSTR"), lines: ["SS -S", "TCP STATES"] };
const socketPanel = { texture: tex("SOCK"), patch: tex("PSOK") };
const recvGauge = { texture: tex("RVQ"), patch: tex("PRVQ") };
const sendGauge = { texture: tex("SDQ"), patch: tex("PSDQ") };

// The two instrument alcoves, shared by build() (geometry) and terminals() (the
// read-points) so a bay's terminal can't drift from its geometry. Each is a walk-in
// bay off an outer wall of grove A: `vizzes` are the framed visualization panels on
// the deep wall; `term` is that instrument's terminal, set apart by the plain-wall
// gap between the last viz and the term v-range. SendQ + RecvQ share one alcove;
// the TCP socket patch panel gets its own. Tags/line-tags reserved for a live hook.
const alcoves = [
  {
    id: "queues", side: "left", sign: "network-queues", bayV1: 928, bayV2: 1376,
    vizzes: [
      { tex: recvGauge, v1: 944, v2: 1072, tag: ids.sectorTags[0] + 50, lineTag: ids.lineTags[0] },
      { tex: sendGauge, v1: 1072, v2: 1200, tag: ids.sectorTags[0] + 51, lineTag: ids.lineTags[0] + 1 },
    ],
    term: { tex: queuesScreen, v1: 1232, v2: 1360 }, // gap 1200..1232 = plain wall
  },
  {
    id: "sockets", side: "right", sign: "network-sockets", bayV1: 944, bayV2: 1344,
    vizzes: [
      { tex: socketPanel, v1: 960, v2: 1152, tag: ids.sectorTags[0] + 45 },
    ],
    term: { tex: socketsScreen, v1: 1184, v2: 1312 }, // gap 1152..1184 = plain wall
  },
];

// "TRAFFIC" inscribed flush into the foyer threshold floor. The reading player
// faces west here (they walk away from the hub, into -x), so it uses the west
// orientation; makeInscription bakes the per-cell rotation, and the geometry
// lays the cells out along the local cross-axis (u) the same way the east/memory
// wing does for its threshold name. Two cells span u[-64,64] (centred on the
// corridor axis), and the word is auto-centred within them by drawCenteredText.
const netInscription = makeInscription(tex("FN"), "TRAFFIC", "west", 2);

// Plain blue conduit-lane flats: a blue floor framed by darker side rails. The
// moving packet orbs now carry the flow direction, so the old directional chevrons
// were dropped — their bright pixels (notably the green TX chevron, palette 112)
// read as stray green dots scattered across the trough floor up close.
const laneFlatNames = { rx: tex("RXL"), tx: tex("TXL") };
const buildLaneFlat = ({ name, base, rail }) => {
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
  return lump(name, Buffer.from(px));
};
const laneFlats = [
  buildLaneFlat({ name: laneFlatNames.rx, base: 200, rail: 204 }),
  buildLaneFlat({ name: laneFlatNames.tx, base: 202, rail: 206 }),
];

// Cross-axis half-widths (local u). The grove is a symmetric halfpipe: trough
// (two lanes) -> step ring -> walkway -> wall.
const EDGEHW = 216; //   walkway outer edge == the wing's outer wall
const STEPHW = 144; //   inner step outer edge
const TROUGHHW = 96; //  trough outer edge (RX lane u=-48, TX lane u=+48)
const CHOKE_TR = 56; //  trough half-width through the pinch (lanes ±48 still fit)
const CHOKE_ST = 104; // step outer edge through the pinch

// Instrument alcoves: deep, walk-in bays cut into the outer walls. The player
// steps in off the walkway (bay floor 0, flush) and reads, on the bay's deep wall,
// framed visualization panels — then, set apart by a stretch of plain wall, that
// instrument's terminal, raised so its step riser wears the control-panel "server
// details" strip (as in the CPU wing). The panels/screen are shallow recesses cut
// ALC_RECESS past the deep wall, each exactly one 128-tall texture high.
const ALCHW = 440; //       alcove bay deep wall (bay depth = ALCHW - EDGEHW = 224)
const ALC_RECESS = 16; //   depth of the framed panel/screen recesses past the deep wall
const ALC_BAY_CEIL = 176; //walk-in bay ceiling
const ALC_VIZ_FLOOR = 16; //visualization panel sill (framed 128-tall inset)
const ALC_VIZ_CEIL = ALC_VIZ_FLOOR + 128; // 144

// Trough halfpipe floor heights (local).
const F_WALK = 0; //     outer walkway (player path / foyer level)
const F_STEP = -24; //   mid step (max auto-step, so the trough is climbable)
const F_TROUGH = -48; // trough floor (packet lanes)

// Depth boundaries (local v), hub-ward to far wall. Grove A is lengthened (and the
// choke + grove B compacted to match) so the merged SendQ/RecvQ alcove and the
// sockets alcove both fit off grove A's tall-ceiling walls; the back wall stays put.
const V_ENTRY = 704; //  foyer begins where addWingEntrance's entry throat ends
const V_FOYER = 896; //  end of foyer / mouth of the grove
const V_GROVEA = 1376; // end of grove section A / start of the choke (lengthened)
const V_CHOKE = 1472; //  end of the choke / start of grove section B (compacted)
const V_GROVEB = 1600; // end of section B / start of the terminal plaza (compacted)
const V_PLAZA = 1744; //  terminal recess front edge
const V_TERM_WALL = 1760; // the back wall: the single IFACE DEV (traffic) screen

// Packet-lane world-coords (west wing: local [u,v] -> world [-v,u]), mirrored in
// the engine's DoomPerf_UpdateNetworkPackets. Lanes sit at u=±48 -> world y=±48;
// they travel along world x = -v over the trough (z = F_TROUGH).
export const networkPacketLanes = {
  laneY: 48, //          |world y| of each lane (RX = -48, TX = +48)
  troughZ: F_TROUGH, //  trough floor the orbs ride
  // RX (incoming) flows hub-ward (+x): spawn far, despawn near the foyer.
  rxSpawnV: 1560,
  rxDespawnV: 940,
  // TX (outgoing) flows back-wall-ward (-x): spawn near the foyer, despawn far.
  txSpawnV: 940,
  txDespawnV: 1560,
};

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, base, accent, terminalPanelFloor } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top");
  const leftWall = localSideToWorld(direction, "left");
  const rightWall = localSideToWorld(direction, "right");

  // Shared sector styles. Hall surfaces use the network base wall (TEKWALL1); the
  // trough and side chambers take the accent wall (COMPSPAN, blue) for identity.
  const hall = { ...base, kind: "net-hall", ceiling: 192 };
  const conduit = { ...accent, kind: "net-conduit", ceiling: 192 };
  const foyer = { ...base, kind: "foyer", light: 200 };

  // ===== Foyer, split so "TRAFFIC" inscribes flush into the threshold floor.
    areaRect(direction, "foyer-left", { u1: -EDGEHW, v1: V_ENTRY, u2: -64, v2: V_FOYER }, { ...foyer, light: 208 });
    areaRect(direction, "foyer-right", { u1: 64, v1: V_ENTRY, u2: EDGEHW, v2: V_FOYER }, { ...foyer, light: 208 });
    areaRect(direction, "foyer-front", { u1: -64, v1: V_ENTRY, u2: 64, v2: 832 }, { ...foyer, light: 208 });
    netInscription.names.forEach((flatName, k) => {
      const u1 = -64 + k * 64;
      areaRect(direction, `net-inscription-${k}`, { u1, v1: 832, u2: u1 + 64, v2: V_FOYER }, {
        ...foyer,
        floorFlat: flatName,
        light: 216,
      });
    });

  // ===== The packet grove: a sunken central trough (two opposed packet lanes)
  // framed by a stepped "halfpipe" — walkway @0 -> step @-24 -> trough @-48 —
  // running the wing's full depth. One band per depth segment; each lays six
  // sectors across u: walk-l, step-l, trough-rx, trough-tx, step-r, walk-r. The
  // two trough halves share a flush seam at u=0 (the player crosses freely) and
  // carry the opposed RX/TX lane flats. tags 700/701 mark the RX/TX trough for a
  // future live congestion-light hook.
  const groveBand = (id, v1, v2, { troughHW, stepHW, ceiling, troughLight, edgeLight }) => {
    areaRect(direction, `${id}-rx`, { u1: -troughHW, v1, u2: 0, v2 }, {
      ...conduit, kind: "net-trough", floor: F_TROUGH, ceiling,
      floorFlat: laneFlatNames.rx, light: troughLight, tag: ids.sectorTags[0],
    });
    areaRect(direction, `${id}-tx`, { u1: 0, v1, u2: troughHW, v2 }, {
      ...conduit, kind: "net-trough", floor: F_TROUGH, ceiling,
      floorFlat: laneFlatNames.tx, light: troughLight, tag: ids.sectorTags[0] + 1,
    });
    areaRect(direction, `${id}-step-l`, { u1: -stepHW, v1, u2: -troughHW, v2 }, { ...hall, kind: "net-step", floor: F_STEP, ceiling, light: edgeLight });
    areaRect(direction, `${id}-step-r`, { u1: troughHW, v1, u2: stepHW, v2 }, { ...hall, kind: "net-step", floor: F_STEP, ceiling, light: edgeLight });
    areaRect(direction, `${id}-walk-l`, { u1: -EDGEHW, v1, u2: -stepHW, v2 }, { ...hall, kind: "net-walk", floor: F_WALK, ceiling, light: edgeLight });
    areaRect(direction, `${id}-walk-r`, { u1: stepHW, v1, u2: EDGEHW, v2 }, { ...hall, kind: "net-walk", floor: F_WALK, ceiling, light: edgeLight });
  };

    groveBand("grove-a", V_FOYER, V_GROVEA, { troughHW: TROUGHHW, stepHW: STEPHW, ceiling: 192, troughLight: 168, edgeLight: 184 });
    // Choke: the channel necks down (trough + steps pinch, the walkway widens to
    // take up the slack) and the ceiling drops, so saturation reads as the packets
    // crowding the narrows. The trough floor carries the reserved network light
    // sentinel (124-128) for a later live congestion-brightness hook; static now.
    groveBand("choke", V_GROVEA, V_CHOKE, { troughHW: CHOKE_TR, stepHW: CHOKE_ST, ceiling: 112, troughLight: ids.lights[1], edgeLight: 176 });
    groveBand("grove-b", V_CHOKE, V_GROVEB, { troughHW: TROUGHHW, stepHW: STEPHW, ceiling: 192, troughLight: 168, edgeLight: 184 });

  // ===== Instrument alcoves: two deep, walk-in bays cut into grove A's outer walls,
  // replacing the old label-only side panels (NIC/RX/TX/CONGEST/DROPS/ERRORS). The
  // player steps in off the walkway (bay floor 0, flush) and reads the framed
  // visualization panels on the deep wall, then — set apart by a stretch of plain
  // wall — that instrument's terminal, raised so its riser wears the control-panel
  // "server details" strip. SendQ + RecvQ share the left bay; the TCP socket patch
  // panel is the right bay. Reserved sector tags (745 sockets / 750-751 queues) and
  // gauge line tags (760-761) are set now for a later live fill/lighting hook.
    alcoves.forEach(({ id, side, bayV1, bayV2, vizzes, term }) => {
      const wall = side === "left" ? leftWall : rightWall;
      // Bay: the walk-in floor-0 room. Its deep wall sits at ±ALCHW; the framed
      // panels/screen are recesses cut ALC_RECESS further out.
      const bayU = side === "left" ? { u1: -ALCHW, u2: -EDGEHW } : { u1: EDGEHW, u2: ALCHW };
      const recU = side === "left"
        ? { u1: -ALCHW - ALC_RECESS, u2: -ALCHW }
        : { u1: ALCHW, u2: ALCHW + ALC_RECESS };
      areaRect(direction, `${id}-bay`, { ...bayU, v1: bayV1, v2: bayV2 }, {
        ...conduit,
        kind: "net-alcove",
        floor: F_WALK,
        ceiling: ALC_BAY_CEIL,
        light: 200,
      });
      // Framed visualization panels inset in the deep wall (seen head-on on entry).
      vizzes.forEach(({ tex, v1, v2, tag, lineTag }, k) => {
        areaRect(direction, `${id}-viz-${k}`, { ...recU, v1, v2 }, {
          ...conduit,
          kind: "net-instrument",
          floor: ALC_VIZ_FLOOR,
          ceiling: ALC_VIZ_CEIL,
          light: 208,
          labelSide: wall,
          labelTexture: tex.texture,
          ...(tag ? { tag } : {}),
          ...(lineTag ? { lineTag } : {}),
        });
      });
      // The instrument's terminal, apart from the panels by a stretch of plain deep
      // wall (the v-gap). Raised to the panel floor so the step riser below the
      // screen carries the control-panel strip (controlPanel: true).
      areaRect(direction, `${id}-term`, { ...recU, v1: term.v1, v2: term.v2 }, {
        ...conduit,
        kind: "terminal",
        floor: terminalPanelFloor,
        ceiling: terminalPanelFloor + terminalTextureSize.height,
        light: 192,
        labelSide: wall,
        labelTexture: term.tex.texture,
        controlPanel: true,
      });
    });

  // ===== Terminal plaza: the grove opens to a floor-0 plaza whose far wall carries
  // the single IFACE DEV screen (total traffic in/out), directly opposite the
  // entrance — the same signal as the live packet-orb lanes. Read-point in
  // `terminals`.
    areaRect(direction, "plaza", { u1: -EDGEHW, v1: V_GROVEB, u2: EDGEHW, v2: V_PLAZA }, {
      ...hall,
      kind: "net-plaza",
      floor: 0,
      light: 184,
    });
    areaRect(direction, "plaza-back-left", { u1: -EDGEHW, v1: V_PLAZA, u2: -128, v2: V_TERM_WALL }, {
      ...hall, kind: "net-plaza", floor: 0, light: 176,
    });
    areaRect(direction, "plaza-back-right", { u1: 128, v1: V_PLAZA, u2: EDGEHW, v2: V_TERM_WALL }, {
      ...hall, kind: "net-plaza", floor: 0, light: 176,
    });
    areaRect(direction, "network-terminal", { u1: -128, v1: V_PLAZA, u2: 128, v2: V_TERM_WALL }, {
      ...hall,
      kind: "terminal",
      floor: terminalPanelFloor,
      ceiling: terminalPanelFloor + terminalTextureSize.height,
      light: 192,
      labelSide: backWall,
      labelTexture: screen.texture,
      controlPanel: true,
    });

  // ===== Techno floor lamps, kept clear of every walking path: only in the two
  // wide open rooms (the foyer and the plaza), hugging the side walls. The grove
  // walkways are narrow and the alcoves lead straight to a terminal, so no lamps
  // stand in them — the bright alcove sectors (light 208) carry the instruments.
    addAreaThing(direction, 2028, -196, 872);
    addAreaThing(direction, 2028, 196, 872);
    addAreaThing(direction, 2028, -196, 1712);
    addAreaThing(direction, 2028, 196, 1712);
};

// Texture patches this wing contributes: the three terminal screens (IFACE DEV /
// SendQ-RecvQ / TCP-states), the socket-state patch panel, and the twin queue
// standpipe gauges. No decorative wall signs — every face in the wing carries a
// live instrument or its terminal.
const textures = [
  ...[screen, queuesScreen, socketsScreen].map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(s),
  })),
  {
    texture: socketPanel.texture,
    patch: socketPanel.patch,
    width: netPatchPanelSize.width,
    height: netPatchPanelSize.height,
    build: buildNetPatchPanelPatch,
  },
  {
    texture: recvGauge.texture,
    patch: recvGauge.patch,
    width: netGaugeSize.width,
    height: netGaugeSize.height,
    // Cyan fill = inbound RecvQ, matching the RX grove lane hue.
    build: () => buildNetGaugePatch({ label: "RECV Q", loColor: 200, hiColor: 196, frameColor: 200, fillFrac: 0.3 }),
  },
  {
    texture: sendGauge.texture,
    patch: sendGauge.patch,
    width: netGaugeSize.width,
    height: netGaugeSize.height,
    // Violet fill = outbound SendQ, matching the TX grove lane hue.
    build: () => buildNetGaugePatch({ label: "SEND Q", loColor: 253, hiColor: 251, frameColor: 254, fillFrac: 0.42 }),
  },
];

// Floor flats: the NETWORK threshold inscription and the two directional lane
// flats (the geometry above references both by name).
const flats = [...netInscription.flats, ...laneFlats];

// Packet-orb sprites for the two grove lanes. The IWAD palette has only a blue
// ramp, so RX "cyan" leans bright/icy; TX is a magenta-violet. Each reuses an
// unused IWAD sprite name (PINV / PMAP) and its A–D frames: frame A is the static
// orb, frames B/C/D are the spawn-bloom (ring -> flash -> settle) and despawn-fade
// FX the engine info.c states chain through. See [[pwad-sprite-override-constraint]].
const cyanRamp = [4, 192, 194, 196, 198, 200]; //   white core -> bright blue rim (RX)
const cyanFlash = [4, 4, 4, 192, 194, 198]; //      whiter bloom/fade burst core
const violetRamp = [4, 250, 251, 252, 253, 254]; // white core -> magenta -> dark violet (TX)
const violetFlash = [4, 4, 250, 251, 252, 254];
const sprites = [
  { name: "PINVA0", build: () => buildOrbPatch(cyanRamp) }, //                                   RX static orb
  { name: "PINVB0", build: () => buildFxPatch({ size: 22, ramp: cyanRamp, outerFrac: 0.78 }) }, // settle / near
  { name: "PINVC0", build: () => buildFxPatch({ size: 32, ramp: cyanFlash, outerFrac: 0.72 }) }, // flash
  { name: "PINVD0", build: () => buildFxPatch({ size: 32, ramp: cyanRamp, innerFrac: 0.55 }) }, //  ring
  { name: "PMAPA0", build: () => buildOrbPatch(violetRamp) }, //                                 TX static orb
  { name: "PMAPB0", build: () => buildFxPatch({ size: 22, ramp: violetRamp, outerFrac: 0.78 }) },
  { name: "PMAPC0", build: () => buildFxPatch({ size: 32, ramp: violetFlash, outerFrac: 0.72 }) },
  { name: "PMAPD0", build: () => buildFxPatch({ size: 32, ramp: violetRamp, innerFrac: 0.55 }) },
];

// Read-points. Network is the WEST wing, so the map builder rotates local (u,v) ->
// world (-v,u); we emit each face in WORLD coords directly. The IFACE DEV (traffic)
// screen is the back wall opposite the entrance (local v = V_TERM_WALL, centred on
// u=0). Each alcove terminal is on its bay's deep-wall recess (local u = ∓(ALCHW +
// ALC_RECESS)), spanning its term stretch v[term.v1,term.v2] — matching build().
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
    ...alcoves.map(({ side, term, sign }) => {
      const deep = side === "left" ? -(ALCHW + ALC_RECESS) : ALCHW + ALC_RECESS;
      return { sign, segments: [segment([deep, term.v1], [deep, term.v2])] };
    }),
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
