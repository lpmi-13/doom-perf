// Network wing (west): an electrical SUBSTATION carrying the packet stream down the
// network stack as CURRENT through the gear. The player walks CATWALK stairs down
// either side of a long descending hall, railed off the live equipment in the middle.
// Down the centre run TWO BUS BARS -- deep contained conductor channels, RX (left) and
// TX (right), split by a raised INSULATOR SPINE -- that carry the packet-orbs the
// length of the hall and drop them through a STEP-DOWN TRANSFORMER at each of the two
// switchyard-stage boundaries and again into the switchyard head.
//
// The three flat levels are the three real queue stages a packet crosses -- socket /
// OS queue -> kernel buffer -> device ring buffer. Each bus's floor RISES with its
// stage's live queue fill (the charge level); the orbs ride down the bus above it and
// tumble each transformer. The player is kept off the live gear by an impassable
// see-through rail (the bus trenches are `blockEdge`: two-sided so you look down into
// them, blocking so you can't fall in and the NOCLIP orbs pass freely). The deep back
// wall carries the /proc/net/dev IFACE DEV terminal (the grid tie). This is a SKIN over
// the three-lock canal geometry -- NETWORK_POWERPLANT_PLAN.md supersedes
// NETWORK_CANAL_PLAN.md: the geometry and every engine coord are retained, only the
// palette/materials/lighting/vocabulary change.
//
// This is the network wing's independent editing seam. build() lays out only the
// geometry; screens via `textures`, bus lane flats + CURRENT inscription + ground flat
// via `flats`, packet-orb sprites via `sprites`, read-points via `terminals`. The
// bus/orb ANIMATION lives in the engine (p_tick.c, fed by the DoomPerf_SetNetLock*
// setters); the world-centres + walk levels + TRANSFORMER lines below are mirrored
// there and MUST stay in sync (the RING_PITCH discipline). See [[map-builder-architecture]],
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
  FLAT_DIM,
} from "../textures.mjs";
import { lump, buildPatch } from "../wad-bytes.mjs";

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

// The two OVERVIEW terminals live in recessed control-panel niches on the entry BOX's FAR
// wall, one either side of the central doorway, each FACING the entering player so it reads
// head-on with no turn (see build): TRAFFIC PER INTERFACE (sar -n DEV, sign "network") RIGHT
// of the doorway, CONNECTIONS (ss -s census, sign "network-sockets") LEFT -- the wall you
// look at the moment you walk in, well clear of the six saturation terminals down the hall.
// The far-wall geometry (below, used by build() and terminals()) fixes both.
const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["TRAFFIC PER", "INTERFACE"] };
const socketsScreen = { texture: tex("STRM"), patch: tex("PSTR"), lines: ["CONNECTIONS", "SS -S"] };
// Entry-box far-wall terminal placement, shared by build() (geometry) + terminals() (read
// segments). The box is a WIDE, shallow antechamber; the two 256-wide screens flank the
// central doorway. The screen sits on the recess BACK (V_TERM_BACK), which must back onto
// SOLID rock to render -- so the doorway is a THICK CORRIDOR (V_FARWALL..V_LAND) and the far
// wall is the corridor's length, leaving solid fill (V_TERM_BACK..V_LAND) behind each recess.
// (A too-thin far wall made the recess back a two-sided wall onto the landing -> the screen
// rendered see-through.) BOX_WALK_HW is the doorway/corridor half-width (== the bus boundary).
const BOX_WALK_HW = 112;
const TERM_W = terminalTextureSize.width; // 256: screen width (each recess is exactly one screen)
const BOX_OUTER = BOX_WALK_HW + 2 * TERM_W; // 624: each far-wall segment (corridor edge..box wall)
//   holds one screen CENTRED, with TERM_W/2 (128 = 50% of the screen) of bare wall on each side
const TERM_INNER = BOX_WALK_HW + TERM_W / 2; // 240: screen inner edge (128 of wall past the corridor)
const TERM_OUTER = TERM_INNER + TERM_W; //     496: screen outer edge (128 of wall before BOX_OUTER)
// The far end is pulled FORWARD (was 800/816/848) so the full-width LANDING between the corridor
// and the hall is ~3x deeper (V_FOYER 896 - V_LAND 752 = 144, was 48): the player exits the
// centred corridor and now has real room to fan onto the catwalks either side of the bus lanes
// before the buses begin. Keeps V_FOYER (and every engine coord) put -- only the box shrinks.
const V_FARWALL = 720;      // box far wall = terminal recess opening (into the box)
const V_TERM_BACK = 736;    // recess back = the SCREEN plane; solid rock behind it -> it renders
const V_LAND = 752;         // doorway corridor ends / the deep full-width landing begins
// FLOOR LABELS naming each far-wall terminal, inscribed on the box floor just in front of it
// so the player reads it walking up: CONNECTIONS under the ss -s screen (left), TX/RX PER
// INTERFACE under the sar -n DEV screen (right). One line, 4 cells (256) wide, facing "west"
// like the stage-terminal labels; the cells are laid on the 64-grid in build(). Unique lump
// prefixes (DPNBC/DPNBT). [[angled-floor-label-technique]] [[riser-texture-and-light-rules]]
const connLabel = makeInscription("DPNBC", "CONNECTIONS", "west", 4);
const trafLabel = makeInscription("DPNBT", "TX/RX PER INTERFACE", "west", 4);
// The softnet terminal that stands between the two Tesla electrodes: the shell view that
// confirms the saturation the coils crackle (cat /proc/net/softnet_stat). This is the
// kernel-RX cell of the six directional stage terminals below.
const softnetScreen = { texture: tex("KTRM"), patch: tex("PKTR"), lines: ["SOFTNET", "STAT"] };

// The six directional STAGE TERMINALS: one walk-up console per lane per stage
// (socket -> kernel -> NIC, each split RX/TX), replacing the old passive placards.
// Each opens a DIFFERENT real Linux command scoped to that stage+lane's saturation
// (see src/ui/terminalOverlay.ts); the wall SCREEN is command-forward, and the old
// placard wording drops to a FLOOR label in front of the console (see `stations` +
// `catwalkSide`). kernel-RX is the coil-bay softnet terminal above, so only five new
// consoles are laid here. [[terminal-design-principles]]
const socketRxScreen = { texture: tex("SRXT"), patch: tex("PSRX"), lines: ["SS -TM", "RECV-Q"] };
const socketTxScreen = { texture: tex("STXT"), patch: tex("PSTX"), lines: ["SS -TO", "SEND-Q"] };
const kernelTxScreen = { texture: tex("KTXT"), patch: tex("PKTX"), lines: ["TC QDISC", "BACKLOG"] };
const nicRxScreen = { texture: tex("NRXT"), patch: tex("PNRX"), lines: ["IP -S LINK", "NIC RX"] };
const nicTxScreen = { texture: tex("NTXT"), patch: tex("PNTX"), lines: ["NET DEV", "NIC TX"] };

// Per station: which stage/side it sits on, its screen + manifest sign, and the two
// placard lines now inscribed on the catwalk floor in front of it. `lp` is the floor-
// inscription lump prefix (makeInscription appends the line letter + cell index). RX
// on the LEFT wall (u<0), TX on the RIGHT (u>0); kernel-RX omitted (= coil bay).
const stations = [
  { level: 0, side: "left", screen: socketRxScreen, sign: "network-socket-rx", label: ["SOCKET", "RECV-Q"], lp: "DPNL0" },
  { level: 0, side: "right", screen: socketTxScreen, sign: "network-socket-tx", label: ["SOCKET", "SEND-Q"], lp: "DPNL1" },
  { level: 1, side: "right", screen: kernelTxScreen, sign: "network-kernel-tx", label: ["KERNEL TX", "QUEUE"], lp: "DPNL2" },
  { level: 2, side: "left", screen: nicRxScreen, sign: "network-nic-rx", label: ["NIC RX", "RING"], lp: "DPNL3" },
  { level: 2, side: "right", screen: nicTxScreen, sign: "network-nic-tx", label: ["NIC TX", "RING"], lp: "DPNL4" },
];
// Two-line floor inscriptions per station (west-facing, matching the CURRENT band):
// line A over line B, each 2 cells wide along the outer wall. Attached here so both
// the flat data (flats export) and the placement (catwalkSide) share one source.
stations.forEach((st) => {
  st.insA = makeInscription(`${st.lp}A`, st.label[0], "west", 2);
  st.insB = makeInscription(`${st.lp}B`, st.label[1], "west", 2);
});

// Kernel-RX softnet decomposition COILS: two upright TESLA electrodes (physical rods) in
// a bay off the kernel-RX catwalk, each crackling blue lightning around its tip at a rate
// set by its /proc/net/softnet_stat cause -- NAPI time_squeeze vs per-CPU backlog drop.
// The rods are geometry; the lightning is MT_DP_NETARC bolts the engine spawns (see
// p_tick.c). A single softnet_stat terminal stands on the back wall between the two rods,
// with a wall label on each SIDE wall (orthogonal to the terminal) naming its electrode:
// left = time_squeeze, right = backlog drop (matching p_tick's coil 0 / 1).
const coilWallLabels = [
  { texture: tex("WLKS"), patch: tex("PWKS"), l1: "NAPI", l2: "SQUEEZE" },   // left / squeeze
  { texture: tex("WLKD"), patch: tex("PWKD"), l1: "BACKLOG", l2: "DROP" },    // right / backlog
];

// Tesla-coil lightning bolt (SPR_BLUD A/B, MT_DP_NETARC): a jagged white-core / electric-
// blue arc that the engine crackles around the electrode tips. Two frames wobble so a bolt
// flickers over its brief life; the arc DENSITY (spawn rate) carries the load, not the art.
const buildNetLightningSprite = (frame) => {
  const W = 20, H = 26, T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const plot = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H && (px[y * W + x] === T || c === 4)) px[y * W + x] = c;
  };
  const main = frame === 0
    ? [[10, 25], [7, 19], [12, 13], [8, 7], [11, 1]]
    : [[10, 25], [13, 19], [8, 13], [12, 7], [9, 1]];
  const branch = frame === 0 ? [[12, 13], [17, 9], [15, 4]] : [[8, 13], [3, 10], [5, 5]];
  const stroke = (pts) => {
    for (let s = 0; s < pts.length - 1; s += 1) {
      const [x0, y0] = pts[s];
      const [x1, y1] = pts[s + 1];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let t = 0; t <= steps; t += 1) {
        const x = Math.round(x0 + ((x1 - x0) * t) / steps);
        const y = Math.round(y0 + ((y1 - y0) * t) / steps);
        plot(x - 1, y, 196); plot(x + 1, y, 196); // electric-blue glow
        plot(x, y - 1, 196); plot(x, y + 1, 196);
        plot(x, y, 4); // white-hot core
      }
    }
  };
  stroke(main);
  stroke(branch);
  return buildPatch(px, W, H, { transparent: T, leftOffset: 10, topOffset: 13 });
};

// The BIG bolt (SPR_BLUD C): taller and branchier, fired only at very high saturation so
// a storm reads as escalating, not just denser. Anchored near its base (topOffset ~= H)
// so it rises UP from the spawn point -- higher reach when the coil is hammered.
const buildNetLightningBig = () => {
  const W = 30, H = 40, T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const plot = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H && (px[y * W + x] === T || c === 4)) px[y * W + x] = c;
  };
  const strokes = [
    [[15, 39], [11, 31], [17, 23], [12, 15], [16, 7], [13, 1]], // tall main spine
    [[17, 23], [24, 19], [21, 12], [27, 8]],                     // right branch
    [[12, 15], [5, 12], [8, 5], [3, 2]],                         // left branch
    [[11, 31], [4, 28], [7, 22]],                                // low-left fork
  ];
  strokes.forEach((pts) => {
    for (let s = 0; s < pts.length - 1; s += 1) {
      const [x0, y0] = pts[s];
      const [x1, y1] = pts[s + 1];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let t = 0; t <= steps; t += 1) {
        const x = Math.round(x0 + ((x1 - x0) * t) / steps);
        const y = Math.round(y0 + ((y1 - y0) * t) / steps);
        plot(x - 1, y, 196); plot(x + 1, y, 196);
        plot(x, y - 1, 196); plot(x, y + 1, 196);
        plot(x, y, 4);
      }
    }
  });
  return buildPatch(px, W, H, { transparent: T, leftOffset: 15, topOffset: H - 2 });
};

// ===== Trackside SIGNAL HEAD (railway block signal) beside each bus lane. A dark
// riveted backboard carries two round lamps -- red (STOP, upper) over green (GO, lower)
// -- with exactly ONE burning. The engine swaps the lit lamp per post by texture name in
// DoomPerf_UpdateNetworkLocks: DPNSIGGO (green lit / red dark) = line clear, orbs
// flowing; DPNSIGST (red lit / green dark) = the block is saturated enough that orbs
// stall. Authored 64 wide (maps 1:1) x 96 tall (<=128 -> no vertical tiling); the lamp
// sits in the upper band so it clears the rail at head height.
// [[doom-texture-power-of-two]] [[doom-wall-texture-128-tiling]] [[prefer-everpresent-over-flicker]]
const signalScreens = { go: tex("SIGGO"), stop: tex("SIGST") };
const SIGTEX_W = 64, SIGTEX_H = 96;
const buildSignalPatch = ({ redLit }) => {
  const px = new Uint8Array(SIGTEX_W * SIGTEX_H).fill(6); // (19,19,19) dark backboard
  const put = (x, y, c) => { if (x >= 0 && x < SIGTEX_W && y >= 0 && y < SIGTEX_H) px[y * SIGTEX_W + x] = c; };
  // Riveted metal frame around the backboard.
  for (let x = 0; x < SIGTEX_W; x += 1) { put(x, 0, 110); put(x, 1, 111); put(x, SIGTEX_H - 2, 111); put(x, SIGTEX_H - 1, 110); }
  for (let y = 0; y < SIGTEX_H; y += 1) { put(0, y, 110); put(1, y, 111); put(SIGTEX_W - 2, y, 111); put(SIGTEX_W - 1, y, 110); }
  // Two lamps on the centre line: red upper, green lower. Each is a disc in a dark
  // housing ring; the LIT one glows from a white-hot core out through its colour, the
  // dark one is a deep unlit bulb -- so the head still reads as two-aspect (which lamp
  // is which) even when only one is burning.
  const disc = (cy, ramp) => {
    const R = 15;
    for (let y = cy - R - 2; y <= cy + R + 2; y += 1) {
      for (let x = 32 - R - 2; x <= 32 + R + 2; x += 1) {
        const d = Math.hypot(x - 32, y - cy);
        if (d > R + 1.5) continue;
        if (d > R - 1) { put(x, y, 8); continue; } // dark housing rim
        const step = Math.min(ramp.length - 1, Math.floor((d / R) * ramp.length));
        put(x, y, ramp[step]);
      }
    }
  };
  const redOn = [4, 176, 179, 183, 187];    // white core -> bright red -> deep red halo
  const redOff = [188, 190, 191, 191, 191]; // unlit: deep red bulb, no glow
  const grnOn = [4, 112, 114, 117, 120];    // white core -> bright green -> deep green halo
  const grnOff = [125, 126, 127, 127, 127]; // unlit: deep green bulb
  disc(30, redLit ? redOn : redOff);
  disc(66, redLit ? grnOff : grnOn);
  return buildPatch(px, SIGTEX_W, SIGTEX_H);
};


// Bus-bar bed flats: a DEEP BLUE conductor bed with lane identity kept in a single
// bright ENERGISED RAIL stripe (RX cyan, TX violet). The engine tempers the BED colour
// with the stage's live queue fill -- deep blue (cool) -> electric blue -> white-hot blue
// -- so a saturated bus visibly runs at full charge. This is an ELECTRICAL-INTENSITY ramp
// (brightness climbs within the blue family), not the old heat ramp (graphite->amber->red)
// -- the wing standardised on blue to match its entryway/conductor palette. The idle bed
// stays dark enough that the bright packet-orbs still separate from the floor they ride on
// (the contrast fix), and the rail stripe keeps RX/TX identity. Plus a near-black
// ground/earth grate for the discharge basin at each transformer. The engine swaps floorpic
// among the cool/warm/hot tiers BY NAME (Phase 2, DoomPerf_UpdateNetworkLocks) so recolouring
// here needs no engine rebuild. [[doom-texture-power-of-two]] [[memory-reclaim-sluice]]
const busFlatNames = {
  rx: { cool: tex("RXL"), amber: tex("RXA"), hot: tex("RXR") },
  tx: { cool: tex("TXL"), amber: tex("TXA"), hot: tex("TXR") },
};
const BUS_COOL = 206; // (0,0,107)     deep blue conductor bed (idle / cool)
const BUS_WARM = 196; // (115,115,255) electric blue, charging under load
const BUS_HOT = 192; //  (231,231,255) white-hot blue, running saturated (alarm)
const buildBusFlat = ({ name, base, rail }) => {
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
const groundFlatName = tex("GND");
const buildGroundFlat = () => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(110); // (39,39,39) near-black earth
  const put = (x, y, color) => {
    if (x >= 0 && x < size && y >= 0 && y < size) px[y * size + x] = color;
  };
  // A faint darker grille (16-unit bars) so the discharge basin reads as an earth
  // grate ("to ground"), not more conductor bed.
  for (let i = 0; i < size; i += 16) {
    for (let k = 0; k < size; k += 1) { put(i, k, 111); put(k, i, 111); }
  }
  return lump(groundFlatName, Buffer.from(px));
};

// Authored BLUE service-lit ceiling flat (DPNCEIL) -- replaces freedoom's TLITE6_5, whose
// four RED lamps were the wing's dominant warm cue. A dark charcoal panel grid (a 2x2
// ceiling panel, seamed with a darker cross) carrying four recessed BLUE lamps, one per
// panel, each a radial bloom from a bright core down to a deep-blue halo. Cool-lit to echo
// the LITEBLU conductor spine + wall light-strips so the whole hall reads blue overhead.
// Tiles flush: seams at 0/32, lamps centred in each 32-panel (16,48), bloom radius < 16 so
// no lamp crosses a seam or its neighbour. [[riser-texture-and-light-rules]]
const ceilingFlatName = tex("CEIL"); // DPNCEIL (referenced as `ceiling` in resourceConfigs.network)
const buildCeilingFlat = () => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(111); // (35,35,35) charcoal ceiling panel
  const put = (x, y, color) => {
    if (x >= 0 && x < size && y >= 0 && y < size) px[y * size + x] = color;
  };
  // Panel seams: a darker cross every 32 units -> a flush 2x2 ceiling-panel grid.
  for (let k = 0; k < size; k += 1) {
    for (const s of [0, 32]) { put(s, k, 6); put(k, s, 6); } // (19,19,19) seam
  }
  // Four recessed blue lamps, one per panel; radial bloom bright core -> deep-blue halo.
  const lampColor = (d) =>
    d <= 2.0 ? 192 : //  (231,231,255) bright core
    d <= 3.5 ? 194 : //  (171,171,255)
    d <= 5.0 ? 196 : //  (115,115,255) electric blue
    d <= 6.5 ? 199 : //  (27,27,255)
    d <= 8.0 ? 204 : //  (0,0,155)
    d <= 8.8 ? 206 : //  (0,0,107) dark halo
    -1;
  for (const [cx, cy] of [[16, 16], [48, 16], [16, 48], [48, 48]]) {
    for (let y = cy - 9; y <= cy + 9; y += 1) {
      for (let x = cx - 9; x <= cx + 9; x += 1) {
        const color = lampColor(Math.hypot(x - cx, y - cy));
        if (color >= 0) put(x, y, color);
      }
    }
  }
  return lump(ceilingFlatName, Buffer.from(px));
};
const busFlats = [
  // RX rail: bright cyan (83,83,255); TX rail: bright violet (207,0,207). Three temper
  // tiers per lane (cool/amber/hot), the sector starts on `cool` and the engine swaps.
  buildBusFlat({ name: busFlatNames.rx.cool, base: BUS_COOL, rail: 197 }),
  buildBusFlat({ name: busFlatNames.rx.amber, base: BUS_WARM, rail: 197 }),
  buildBusFlat({ name: busFlatNames.rx.hot, base: BUS_HOT, rail: 197 }),
  buildBusFlat({ name: busFlatNames.tx.cool, base: BUS_COOL, rail: 252 }),
  buildBusFlat({ name: busFlatNames.tx.amber, base: BUS_WARM, rail: 252 }),
  buildBusFlat({ name: busFlatNames.tx.hot, base: BUS_HOT, rail: 252 }),
  buildGroundFlat(),
];

// ===== Cross-axis half-widths (local u). Centre-out: insulator spine | RX/TX bus |
// player catwalk. The centre band (spine + buses, u[-112,112]) is the live CURRENT that
// steps down between stages and is railed off from the player; the side bands
// (u[112..320]) are the maintenance catwalks the player descends -- WIDE (208 each) so
// the player has plenty of room either side of the gear. Widening these leaves the bus
// bars (and every engine coord) untouched -- only the outer wall + alcove move out.
const EDGEHW = 320; //   outer wall (catwalks doubled to 208 wide each)
const POOLHW = 112; //   bus outer edge (== current-channel outer edge / catwalk inner edge)
const MEDHW = 24; //     central insulator-spine half-width (48-wide divider between the two buses)
const LANEHW = (MEDHW + POOLHW) / 2; // 68 -> |world y| of each lane (bus centre)
const ALCHW = 504; //    ss-census alcove bay deep wall (kept 184 deep past the wider outer wall)
const ALC_RECESS = 16;

// ===== Depth boundaries (local v). Long flat stages (512) joined by compact catwalk /
// transformer transitions (128). Mirrors the engine's DoomPerf_NET_* region/spawn constants.
const V_ENTRY = 704, V_FOYER = 896;
const LVL_LEN = 512, TRANS = 128, GATE_D = 16;
const C0 = V_FOYER + LVL_LEN; //       1408  transformer 0 (socket -> kernel)
const C1 = C0 + TRANS + LVL_LEN; //    2048  transformer 1 (kernel -> ring)
const V_L2END = C1 + TRANS + LVL_LEN;//2688  ring bus end (final step-down -> switchyard head)
const V_PLAZA = V_L2END + 112; //      2800  switchyard-head front edge
const V_TERM_WALL = V_PLAZA + 16; //   2816  back wall: IFACE DEV screen

// ===== Walk floors (local z): 0 / -96 / -192, a deep descent. The bus drops the full
// 96 through the STEP-DOWN TRANSFORMER at each stage; the catwalks take a 4-step stair.
const F0 = 0, F1 = -96, F2 = -192;
const STEP_DROP = 24; //   catwalk staircase riser
const POOL_EMPTY = 64; //  bus floor below walk when drained (a deep channel)
const POOL_FULL = 32; //   bus floor below walk when brimming (stays below the low spine top)
const ORB_RIDE = -16; //   orb ride-height RELATIVE to walk: down IN the bus, above the spine top (mirrored in p_tick.c)
const HALL_CEIL = 176; //  FLAT ceiling (absolute) for the whole hall -- it does NOT
//                         drop with the stages, so the space grows more cavernous as
//                         the floor descends and the far depths open up from the top.

const POOL_TAG = ids.sectorTags[0]; //       700 + level*2 + lane
const GATE_TAG = ids.sectorTags[0] + 10; //  710 + level

// Trackside SIGNAL-HEAD posts (one per lane per stage): a thin plate carved off each
// bus's OUTER edge at the stage brink, raised SIG_H above the catwalk so its catwalk-
// facing face reads as a railway block signal the descending player passes. Each is
// tagged SIG_SEC_TAG + level*2 + lane so the engine can swap its lit lamp (green while
// the lane flows, red while it is saturated enough to stall the orbs) in
// DoomPerf_UpdateNetworkLocks -- reading the same per-lane fills the orbs slow on, so no
// new telemetry. [[prefer-everpresent-over-flicker]]
const SIG_SEC_TAG = ids.sectorTags[0] + 40; // 740 + level*2 + lane
const SIG_LEN = 64; //   post face width (v-extent); a 64-wide texture maps 1:1
const SIG_DEPTH = 16; // post depth (u): carved off the bus's outermost 16 units, at the rail
const SIG_H = 96; //     signal-head height above the catwalk (<=128 -> no vertical tiling)

// Substation material kit (all verified exclusive to this wing -- no element shared with
// the cpu/memory/storage wings; see NETWORK_POWERPLANT_PLAN.md). Every riser is named
// off the builder's STEP1 default so the catwalks never read as the disk wing's tan
// planks. [[riser-texture-and-light-rules]]
const GANTRY_RISER = "A-GRATE"; //  catwalk stairs/treads -- metal grating (the STEP1 killer)
const BUS_HOUSING = "METAL2"; //    bus-bar side walls -- dark riveted steel housing
const SPINE_WALL = "LITEBLU1"; //   insulator spine -- glowing blue conductor edge
const BREAKER_WALL = "GRAYWARN"; // breaker/transformer risers -- high-voltage hazard bands

// Per stage: bus v-range [cv1,cv2] and catwalk start `sv1` (later than cv1 by the
// previous staircase). Stage walk floor `walk`.
const levels = [
  { level: 0, walk: F0, cv1: V_FOYER, cv2: C0,     sv1: V_FOYER },
  { level: 1, walk: F1, cv1: C0,      cv2: C1,     sv1: C0 + TRANS },
  { level: 2, walk: F2, cv1: C1,      cv2: V_L2END, sv1: C1 + TRANS },
];
const stairs = [
  { id: "stair0", v1: C0, v2: C0 + TRANS, wTop: F0 },
  { id: "stair1", v1: C1, v2: C1 + TRANS, wTop: F1 },
];

// Packet-lane world-coords (west wing), mirrored in p_tick.c. Lanes y=+/-68 (bus
// centres) along x = -v; RX up-stack (+x), TX down (-x). Transformers at world x=-C0/-C1.
export const networkFeeder = {
  laneY: LANEHW,
  rxSpawnV: V_L2END - 48, rxExitV: 960,
  txSpawnV: 960, txExitV: V_L2END - 48,
  fall: [C0, C1],
};

const build = (ctx) => {
  const { areaRect, direction, base, accent, terminalPanelFloor } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top");
  const frontWall = localSideToWorld(direction, "bottom");
  const leftWall = localSideToWorld(direction, "left");
  const rightWall = localSideToWorld(direction, "right");

  const hall = { ...base, kind: "net-hall", riserWall: GANTRY_RISER };
  const conduit = { ...accent, kind: "net-conduit" };
  const intake = { ...base, kind: "net-intake", light: 176 };

  // ===== ENTRY BOX: a WIDE, shallow antechamber right inside the door (right angles only). The
  // player steps through the shared entry throat straight into it. Both OVERVIEW terminals sit
  // on the FAR wall the player faces on entry -- one either side of the central doorway, each
  // turned to FACE the entrance so it reads head-on with NO turn: CONNECTIONS (ss -s) LEFT of
  // the doorway, TRAFFIC PER INTERFACE (sar -n DEV) RIGHT. Each screen sits on the BACK of a
  // shallow recess, which must back onto SOLID rock to render -- so the doorway is a THICK
  // CORRIDOR (V_FARWALL..V_LAND) and the far wall is that corridor's whole length, leaving solid
  // fill (V_TERM_BACK..V_LAND) behind each recess. (When the far wall was thin, the recess back
  // was a two-sided wall straight onto the landing and the screen rendered see-through.) Floor F0
  // throughout; the box ceiling matches the throat (192) so door + throat + box read as one room,
  // the corridor drops to a lower header. Purely visual -- everything stays v < the stage/orb
  // region (V_FOYER 896), so no engine coord is touched.
  const BOX_CEIL = 192; //     antechamber ceiling (matches the entry throat -> seamless)
  const WALK_CEIL = 152; //    lower corridor header, so the far opening reads as a passage
  const boxOpts = { ...intake, floor: F0, ceiling: BOX_CEIL, light: 184 };
  // Box floor: two WIDE side ARMS flanking the throat (the shared entrance already laid the
  // throat from the door to V_ENTRY) plus the CENTRE behind it -- same floor + ceiling as the
  // throat, so door + throat + box read as one room. Each arm is tiled around a 4-cell FLOOR
  // LABEL band (V_LABEL1..V_LABEL2, on the 64-grid) just in front of its terminal, naming it.
  const V_LABEL1 = 640, V_LABEL2 = 704; // 64-aligned label band a little in front of the far wall
  const boxArm = (side, names) => {
    const uLo = side === "left" ? -BOX_OUTER : BOX_WALK_HW; // arm inner (min u)
    const uHi = side === "left" ? -BOX_WALK_HW : BOX_OUTER; // arm outer (max u)
    const bandLo = side === "left" ? -512 : 256; // 64-aligned 4-cell band, ~centred under the screen
    const bandHi = bandLo + 4 * FLAT_DIM; //       (256 wide; 16u off the screen centre to stay on-grid)
    const id = `box-arm-${side}`;
    areaRect(direction, `${id}-front`, { u1: uLo, v1: 448, u2: uHi, v2: V_LABEL1 }, boxOpts);
    areaRect(direction, `${id}-back`, { u1: uLo, v1: V_LABEL2, u2: uHi, v2: V_FARWALL }, boxOpts);
    areaRect(direction, `${id}-bandL`, { u1: uLo, v1: V_LABEL1, u2: bandLo, v2: V_LABEL2 }, boxOpts);
    areaRect(direction, `${id}-bandR`, { u1: bandHi, v1: V_LABEL1, u2: uHi, v2: V_LABEL2 }, boxOpts);
    for (let k = 0; k < 4; k += 1) {
      areaRect(direction, `${id}-lab${k}`, { u1: bandLo + k * FLAT_DIM, v1: V_LABEL1, u2: bandLo + (k + 1) * FLAT_DIM, v2: V_LABEL2 }, { ...boxOpts, floorFlat: names[k] });
    }
  };
  boxArm("left", connLabel.names); //  CONNECTIONS under the ss -s screen
  boxArm("right", trafLabel.names); // TX/RX PER INTERFACE under the sar screen
  areaRect(direction, "box-center", { u1: -BOX_WALK_HW, v1: V_ENTRY, u2: BOX_WALK_HW, v2: V_FARWALL }, boxOpts);
  // The elongated DOORWAY CORRIDOR out of the box (the only way on): a narrow low-header passage
  // through the thick far wall. Its length is what gives the flanking terminal recesses their
  // solid backing (the fill either side of it), so the screens render instead of showing through.
  areaRect(direction, "box-corridor", { u1: -BOX_WALK_HW, v1: V_FARWALL, u2: BOX_WALK_HW, v2: V_LAND }, { ...intake, floor: F0, ceiling: WALK_CEIL, light: 184 });
  // Full-width landing: the corridor opens out here and the player fans onto the stage-0
  // catwalks (the centre becomes the impassable buses at V_FOYER).
  areaRect(direction, "box-landing", { u1: -EDGEHW, v1: V_LAND, u2: EDGEHW, v2: V_FOYER }, { ...intake, ceiling: HALL_CEIL, light: 176 });

  // The two OVERVIEW terminals: a 256-wide control-panel recess on either side of the corridor,
  // its SCREEN on the recess BACK (V_TERM_BACK, labelSide = backWall) which backs onto the solid
  // fill beside the corridor -> the screen renders. Each recess is CENTRED on its far-wall
  // segment (corridor edge BOX_WALK_HW .. box wall BOX_OUTER), leaving TERM_W/2 (128) of bare wall
  // on each side. CONNECTIONS (ss -s) left, TRAFFIC PER INTERFACE (sar -n DEV) right.
  const boxTerminal = (side, sc) => {
    const uSeg = side === "left"
      ? { u1: -TERM_OUTER, u2: -TERM_INNER }
      : { u1: TERM_INNER, u2: TERM_OUTER };
    areaRect(direction, `box-term-${side}`, { ...uSeg, v1: V_FARWALL, v2: V_TERM_BACK }, {
      ...conduit,
      kind: "terminal",
      floor: F0 + terminalPanelFloor,
      ceiling: F0 + terminalPanelFloor + terminalTextureSize.height,
      light: 184,
      labelSide: backWall,
      labelTexture: sc.texture,
      controlPanel: true,
      riserWall: BUS_HOUSING,
    });
  };
  boxTerminal("left", socketsScreen);
  boxTerminal("right", screen);

  // ===== The central CURRENT PATH, per stage: a raised INSULATOR SPINE divider and two
  // deep BUS BARS (RX/TX) either side of it, floor rising with the stage's charge level.
  // The buses are `blockEdge` -- an impassable, see-through rail: the player looks down
  // into them but cannot enter, and the NOCLIP orbs pass through.
  // A trackside SIGNAL POST: a thin plate raised SIG_H above the catwalk, its catwalk-
  // facing face wearing the block-signal lamp (green DPNSIGGO initially). `net-signal` is
  // an equipment kind so ONLY the player-facing side shows the lamp (textureSide -> the
  // catwalk-facing riser); the other three faces wear the dark bus housing. Tagged
  // SIG_SEC_TAG + level*2 + lane -- the engine swaps the lit lamp per post in
  // DoomPerf_UpdateNetworkLocks (match-then-swap, so only the lamp face flips).
  const signalPost = (id, level, lane, { u1, u2, v1, v2, walk }) => {
    areaRect(direction, `${id}-signal-${lane}`, { u1, v1, u2, v2 }, {
      ...conduit,
      kind: "net-signal",
      floor: walk + SIG_H,
      ceiling: HALL_CEIL,
      light: 200,
      floorFlat: groundFlatName,
      wall: signalScreens.go, //     player-facing lamp face (swapped green<->red by the engine)
      sideWall: BUS_HOUSING, //      dark housing on the other three faces
      textureSide: lane === 0 ? leftWall : rightWall,
      tag: SIG_SEC_TAG + level * 2 + lane,
    });
  };

  const feeder = (lvl) => {
    const { level, walk, cv1 } = lvl;
    const id = `net${level}`;
    const brink = lvl.cv2 - GATE_D; // buses run to the brink; the breaker sill is the last GATE_D
    const sigV1 = brink - SIG_LEN; // the bus's last SIG_LEN before the breaker becomes the signal band
    const ceiling = HALL_CEIL;
    const busOpts = (lane, flat) => ({ ...conduit, kind: "net-bus", floor: walk - POOL_EMPTY, ceiling, floorFlat: flat, light: 144, tag: POOL_TAG + level * 2 + lane, blockEdge: true, riserWall: BUS_HOUSING });
    // The spine is a LOW divider (walk-24, well below the elevated catwalks and below the
    // orb ride-height, above the full charge line) so the player, standing on the raised
    // side catwalks, can see over it into BOTH buses from either side. It is `blockEdge`
    // (impassable, see-through) so it reads as a rail, not a floor to enter; its trough-
    // facing sides glow (SPINE_WALL) as the energised conductor between the two buses.
    areaRect(direction, `${id}-spine`, { u1: -MEDHW, v1: cv1, u2: MEDHW, v2: brink }, { ...conduit, kind: "net-spine", floor: walk - 24, ceiling, light: 168, blockEdge: true, riserWall: SPINE_WALL });
    // Bus bars run the stage to the signal band; the trough itself carries the CURRENT.
    areaRect(direction, `${id}-bus-rx`, { u1: -POOLHW, v1: cv1, u2: -MEDHW, v2: sigV1 }, busOpts(0, busFlatNames.rx.cool));
    areaRect(direction, `${id}-bus-tx`, { u1: MEDHW, v1: cv1, u2: POOLHW, v2: sigV1 }, busOpts(1, busFlatNames.tx.cool));
    // Signal band (the last SIG_LEN before the breaker): the outermost SIG_DEPTH of each
    // bus rises into a trackside SIGNAL POST; the rest of the band stays trough (same fill
    // tag + rail), so the current still runs the full length under the signal.
    areaRect(direction, `${id}-bus-rx-sig`, { u1: -POOLHW + SIG_DEPTH, v1: sigV1, u2: -MEDHW, v2: brink }, busOpts(0, busFlatNames.rx.cool));
    areaRect(direction, `${id}-bus-tx-sig`, { u1: MEDHW, v1: sigV1, u2: POOLHW - SIG_DEPTH, v2: brink }, busOpts(1, busFlatNames.tx.cool));
    signalPost(id, level, 0, { u1: -POOLHW, u2: -POOLHW + SIG_DEPTH, v1: sigV1, v2: brink, walk });
    signalPost(id, level, 1, { u1: POOLHW - SIG_DEPTH, u2: POOLHW, v1: sigV1, v2: brink, walk });
  };

  // The breaker sill (last GATE_D of a stage's bus): a lit hazard band across the buses
  // at the charge's edge that BRIGHTENS with the stage's saturation (the load lamp / trip
  // breaker), the charge pooling behind it before spilling through the transformer.
  // Overspill orbs plop here on drops (engine). Also `blockEdge` so the player can't drop
  // onto it. Its risers wear the high-voltage hazard band so the whole breaker zone reads
  // as live equipment from the catwalk.
  const breaker = (lvl) => {
    const { level, walk, cv2 } = lvl;
    const v1 = cv2 - GATE_D;
    const ceiling = HALL_CEIL;
    areaRect(direction, `net${level}-breaker`, { u1: -POOLHW, v1, u2: POOLHW, v2: cv2 }, { ...conduit, kind: "net-breaker", floor: walk - POOL_EMPTY, ceiling, floorFlat: groundFlatName, light: 128, tag: GATE_TAG + level, blockEdge: true, riserWall: BREAKER_WALL });
  };

  // The player CATWALK of a stage: a flat gantry on each side, run the FULL stage
  // [sv1, cv2] (the breaker sill is centre-only, so the catwalk must span past it or the
  // player hits a dead-end wall there). It meets the next staircase at cv2. Where a
  // station sits, the catwalk is TILED around a two-line FLOOR LABEL at the outer wall
  // (the retired placard's wording) -- two 64-cells + an inner fill strip per line, so
  // no sector overlaps (the builder forbids them). [[map-builder-exact-collinearity]]
  const uv = (ua, ub, va, vb) => ({ u1: Math.min(ua, ub), u2: Math.max(ua, ub), v1: Math.min(va, vb), v2: Math.max(va, vb) });
  const catwalkSide = (lvl, side) => {
    const { level, walk, sv1, cv2 } = lvl;
    const ceiling = HALL_CEIL;
    const outer = side === "left" ? -EDGEHW : EDGEHW; // outer wall (the terminal wall)
    const inner = side === "left" ? -POOLHW : POOLHW; // bus-side edge
    const id = `net${level}-walk-${side[0]}`;
    const wopt = { ...hall, kind: "net-walk", floor: walk, ceiling, light: 160 };
    const station = stations.find((s) => s.level === level && s.side === side);
    if (!station) {
      areaRect(direction, id, uv(outer, inner, sv1, cv2), wopt);
      return;
    }
    const lopt = (flat) => ({ ...hall, kind: "net-walk", floor: walk, ceiling, light: 176, floorFlat: flat });
    const vc = Math.round((sv1 + cv2) / 2);
    const vT = vc - 64, vB = vc + 64;
    // Label cells hug the outer wall (name0 at the smaller |u| of the pair); the fill
    // strip carries the plain catwalk between the label and the bus edge.
    const [c0a, c0b, c1a, c1b, fa, fb] = side === "left"
      ? [outer, outer + 64, outer + 64, outer + 128, outer + 128, inner]
      : [outer - 128, outer - 64, outer - 64, outer, inner, outer - 128];
    areaRect(direction, `${id}-a`, uv(outer, inner, sv1, vT), wopt); // catwalk above the label
    areaRect(direction, `${id}-b`, uv(outer, inner, vB, cv2), wopt); // catwalk below the label
    // Line A (nearer the entrance / lower v) over line B, read as the player descends.
    areaRect(direction, `${id}-la0`, uv(c0a, c0b, vT, vc), lopt(station.insA.names[0]));
    areaRect(direction, `${id}-la1`, uv(c1a, c1b, vT, vc), lopt(station.insA.names[1]));
    areaRect(direction, `${id}-laf`, uv(fa, fb, vT, vc), wopt);
    areaRect(direction, `${id}-lb0`, uv(c0a, c0b, vc, vB), lopt(station.insB.names[0]));
    areaRect(direction, `${id}-lb1`, uv(c1a, c1b, vc, vB), lopt(station.insB.names[1]));
    areaRect(direction, `${id}-lbf`, uv(fa, fb, vc, vB), wopt);
  };
  const catwalks = (lvl) => {
    catwalkSide(lvl, "left");
    catwalkSide(lvl, "right");
  };

  // The CATWALK staircase between two stages: constant-grade 24-unit steps on the side
  // bands ONLY (u[POOLHW..EDGEHW]); the centre band is the next stage's bus, already
  // stepped down through its transformer -- so the current drops while the player steps
  // down. The grated treads (GANTRY_RISER via `hall`) read as a maintenance gantry.
  const gantryStair = (s) => {
    const stepV = (s.v2 - s.v1) / 4;
    for (let k = 0; k < 4; k += 1) {
      const floor = s.wTop - (k + 1) * STEP_DROP;
      const ceiling = HALL_CEIL;
      const sv1 = s.v1 + k * stepV, sv2 = s.v1 + (k + 1) * stepV;
      areaRect(direction, `${s.id}-l-${k}`, { u1: -EDGEHW, v1: sv1, u2: -POOLHW, v2: sv2 }, { ...hall, kind: "net-stair", floor, ceiling, light: 152 });
      areaRect(direction, `${s.id}-r-${k}`, { u1: POOLHW, v1: sv1, u2: EDGEHW, v2: sv2 }, { ...hall, kind: "net-stair", floor, ceiling, light: 152 });
    }
  };

  levels.forEach(feeder);
  levels.forEach(breaker);
  levels.forEach(catwalks);
  stairs.forEach(gantryStair);

  // ===== Stage TERMINALS: a walk-up console in a shallow 256-wide niche in each stage's
  // outer wall (RX on the left u<0, TX on the right u>0), the command-forward SCREEN over
  // a control-panel riser. The old placard wording now reads on the catwalk floor in
  // front of each (catwalkSide). kernel-RX is the coil-bay softnet console, so only the
  // five `stations` are laid here. [[terminal-design-principles]] [[doom-wall-texture-128-tiling]]
  const SIGN_W = wallSignSize.width; // 256 (still used by the coil-bay side labels)
  const stageTerminal = (lvl, side, sc) => {
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    const uNiche = side === "left"
      ? { u1: -EDGEHW - ALC_RECESS, u2: -EDGEHW }
      : { u1: EDGEHW, u2: EDGEHW + ALC_RECESS };
    areaRect(direction, `net${lvl.level}-term-${side}`, { ...uNiche, v1: vc - terminalTextureSize.width / 2, v2: vc + terminalTextureSize.width / 2 }, {
      ...conduit,
      kind: "terminal",
      floor: lvl.walk + terminalPanelFloor,
      ceiling: lvl.walk + terminalPanelFloor + terminalTextureSize.height,
      light: 184,
      labelSide: side === "left" ? leftWall : rightWall,
      labelTexture: sc.texture,
      controlPanel: true,
      riserWall: BUS_HOUSING, // metal base under the panel; keep STEP1 off this recess
    });
  };
  stations.forEach((st) => stageTerminal(levels[st.level], st.side, st.screen));

  // ===== Kernel-RX softnet TESLA-COIL BAY off the kernel stage's LEFT (RX) catwalk. The
  // combined kernel-RX bus bed reads "receive is hot"; this bay DECOMPOSES that into its
  // two real /proc/net/softnet_stat causes -- NAPI time_squeeze vs per-CPU BACKLOG DROP --
  // as two upright ELECTRODES that crackle blue lightning around their tips, denser under
  // load (MT_DP_NETARC bolts spawned in p_tick.c; electrode world coords mirrored there,
  // RING_PITCH discipline). The rods are physical geometry; the labels sit on the deep wall.
  // The walk floor is TILED around the two rod footprints (the builder forbids overlaps).
  const ROD_U1 = -414, ROD_U2 = -386, RHW = 14; // electrode footprint: thin (28) rod
  const rodV = [1664, 1920];                     // squeeze / drop electrode v-centres
  const ROD_TOP = F1 + 120;                      // tip height = 24 map units (== p_tick COIL_TOPZ)
  const bayMat = { ...conduit, kind: "net-alcove", floor: F1, ceiling: HALL_CEIL, light: 150 };
  areaRect(direction, "coil-bay-deep", { u1: -ALCHW, v1: levels[1].sv1, u2: ROD_U1, v2: levels[1].cv2 }, bayMat);
  areaRect(direction, "coil-bay-front", { u1: ROD_U2, v1: levels[1].sv1, u2: -EDGEHW, v2: levels[1].cv2 }, bayMat);
  [
    [levels[1].sv1, rodV[0] - RHW],
    [rodV[0] + RHW, rodV[1] - RHW],
    [rodV[1] + RHW, levels[1].cv2],
  ].forEach(([v1, v2], k) => {
    areaRect(direction, `coil-bay-mid${k}`, { u1: ROD_U1, v1, u2: ROD_U2, v2 }, bayMat);
  });
  // The two electrodes: thin blue conductor rods standing 120 tall, tip cap fullbright-ish.
  rodV.forEach((vc, k) => {
    areaRect(direction, k === 0 ? "coil-rod-squeeze" : "coil-rod-drop",
      { u1: ROD_U1, v1: vc - RHW, u2: ROD_U2, v2: vc + RHW }, {
        ...conduit, kind: "net-instrument", floor: ROD_TOP, ceiling: HALL_CEIL, light: 210,
        floorFlat: busFlatNames.rx.hot, riserWall: SPINE_WALL,
      });
  });
  // The softnet_stat TERMINAL on the deep wall, centred BETWEEN the two electrodes: a
  // control-panel console showing the command that confirms this saturation + its live
  // output (see terminalOverlay formatNetworkSoftnet). Sits at the rods' v-midpoint, on
  // the deep wall behind them, so it reads as the readout the two coils crackle from.
  const coilTermVC = (rodV[0] + rodV[1]) / 2; // 1792, between the rods
  areaRect(direction, "coil-terminal", { u1: -ALCHW - ALC_RECESS, v1: coilTermVC - 96, u2: -ALCHW, v2: coilTermVC + 96 }, {
    ...conduit,
    kind: "terminal",
    floor: F1 + terminalPanelFloor,
    ceiling: F1 + terminalPanelFloor + terminalTextureSize.height,
    light: 184,
    labelSide: leftWall,
    labelTexture: softnetScreen.texture,
    controlPanel: true,
    riserWall: BUS_HOUSING,
  });
  // Electrode labels on the bay's two SIDE walls (orthogonal to the terminal): a shallow
  // recess in each end wall, its back face carrying the name of the rod on that side.
  // Left end (v = stage start, screen-left) = squeeze; right end = backlog drop.
  areaRect(direction, "coil-label-squeeze", { u1: -ALCHW, v1: levels[1].sv1 - ALC_RECESS, u2: -EDGEHW, v2: levels[1].sv1 }, {
    ...hall, kind: "net-sign", floor: F1, ceiling: F1 + wallSignSize.height, light: 200,
    labelSide: frontWall, labelTexture: coilWallLabels[0].texture, labelWidth: SIGN_W,
  });
  areaRect(direction, "coil-label-backlog", { u1: -ALCHW, v1: levels[1].cv2, u2: -EDGEHW, v2: levels[1].cv2 + ALC_RECESS }, {
    ...hall, kind: "net-sign", floor: F1, ceiling: F1 + wallSignSize.height, light: 200,
    labelSide: backWall, labelTexture: coilWallLabels[1].texture, labelWidth: SIGN_W,
  });

  // ===== Switchyard head at the wire/ring level: the back wall carries the IFACE DEV
  // screen (the grid tie / /proc/net/dev boundary) on its control-panel riser above the
  // deep floor.
  areaRect(direction, "plaza", { u1: -EDGEHW, v1: V_L2END, u2: EDGEHW, v2: V_PLAZA }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 156,
  });
  areaRect(direction, "plaza-back-left", { u1: -EDGEHW, v1: V_PLAZA, u2: -128, v2: V_TERM_WALL }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 146,
  });
  areaRect(direction, "plaza-back-right", { u1: 128, v1: V_PLAZA, u2: EDGEHW, v2: V_TERM_WALL }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 146,
  });
  // The per-interface (sar -n DEV) terminal lives in the entry box, so the
  // switchyard-head back wall is now plain plaza (no read-point here).
  areaRect(direction, "plaza-back-center", { u1: -128, v1: V_PLAZA, u2: 128, v2: V_TERM_WALL }, {
    ...hall, kind: "net-plaza", floor: F2, ceiling: HALL_CEIL, light: 146,
  });

  // ===== Wall-mounted BUS LIGHT STRIPS: narrow full-height LITEBLU pilasters recessed
  // into the side walls of the two wide open rooms (intake + switchyard head), a glowing
  // energised conductor strip flanking each. This replaces the old shared floor-lamp
  // thing (2028, also in the memory wing) with a fixture exclusive to this wing and made
  // of geometry -- no engine prop-allowlist change (that's Phase 2). The strip is a
  // seamless full-height bump-out (floor/ceiling flush with the room) whose walls wear
  // the blue conductor texture; lit bright so it reads as a live light strip.
  const STRIP_W = 32;
  const lightStrip = (id, sideSign, vCenter, floor) => {
    const uNiche = sideSign < 0
      ? { u1: -EDGEHW - ALC_RECESS, u2: -EDGEHW }
      : { u1: EDGEHW, u2: EDGEHW + ALC_RECESS };
    areaRect(direction, id, { ...uNiche, v1: vCenter - STRIP_W / 2, v2: vCenter + STRIP_W / 2 }, {
      ...hall, kind: "net-strip", wall: SPINE_WALL, floor, ceiling: HALL_CEIL, light: 216,
    });
  };
  lightStrip("plaza-strip-l", -1, V_PLAZA - 40, F2);
  lightStrip("plaza-strip-r", 1, V_PLAZA - 40, F2);
};

const textures = [
  ...[screen, socketsScreen, softnetScreen, socketRxScreen, socketTxScreen, kernelTxScreen, nicRxScreen, nicTxScreen].map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(s),
  })),
  // Tesla-electrode side-wall labels, two-line wall signs.
  ...coilWallLabels.map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSign2Patch(s.l1, s.l2),
  })),
  // Trackside block-signal lamp heads (green flowing / red stalling), swapped per post
  // by the engine (DoomPerf_UpdateNetworkLocks).
  { texture: signalScreens.go, patch: tex("PSGO"), width: SIGTEX_W, height: SIGTEX_H, build: () => buildSignalPatch({ redLit: false }) },
  { texture: signalScreens.stop, patch: tex("PSST"), width: SIGTEX_W, height: SIGTEX_H, build: () => buildSignalPatch({ redLit: true }) },
];

const flats = [
  ...stations.flatMap((st) => [...st.insA.flats, ...st.insB.flats]),
  ...connLabel.flats,
  ...trafLabel.flats,
  ...busFlats,
  buildCeilingFlat(),
];

// Packet-orb ramps (core -> rim). The core is a whiter double-spark and the rim stops
// BRIGHTER than the graphite bus bed it rides on, so the packet reads as a hot electrical
// spark against dark steel (the contrast fix, belt-and-suspenders with the bed flat).
const cyanRamp = [4, 4, 192, 194, 195, 196]; // white core -> electric-blue rim (115,115,255)
const cyanFlash = [4, 4, 4, 192, 194, 196];
const violetRamp = [4, 4, 250, 251, 251, 252]; // white core -> hot-violet rim (207,0,207)
const violetFlash = [4, 4, 250, 251, 252, 252];
const sprites = [
  { name: "PINVA0", build: () => buildOrbPatch(cyanRamp) },
  { name: "PINVB0", build: () => buildFxPatch({ size: 22, ramp: cyanRamp, outerFrac: 0.78 }) },
  { name: "PINVC0", build: () => buildFxPatch({ size: 32, ramp: cyanFlash, outerFrac: 0.72 }) },
  { name: "PINVD0", build: () => buildFxPatch({ size: 32, ramp: cyanRamp, innerFrac: 0.55 }) },
  { name: "PMAPA0", build: () => buildOrbPatch(violetRamp) },
  { name: "PMAPB0", build: () => buildFxPatch({ size: 22, ramp: violetRamp, outerFrac: 0.78 }) },
  { name: "PMAPC0", build: () => buildFxPatch({ size: 32, ramp: violetFlash, outerFrac: 0.72 }) },
  { name: "PMAPD0", build: () => buildFxPatch({ size: 32, ramp: violetRamp, innerFrac: 0.55 }) },
  // Softnet Tesla-coil lightning bolts (MT_DP_NETARC): A/B small flicker, C big & branchy.
  { name: "BLUDA0", build: () => buildNetLightningSprite(0) },
  { name: "BLUDB0", build: () => buildNetLightningSprite(1) },
  { name: "BLUDC0", build: () => buildNetLightningBig() },
];

const terminals = ({ terminalHalfWidth }) => {
  const segment = ([au, av], [bu, bv]) => {
    const [ax, ay] = rotatePoint([au, av], "west");
    const [bx, by] = rotatePoint([bu, bv], "west");
    return { ax, ay, bx, by };
  };
  const deep = -(ALCHW + ALC_RECESS);
  // The five directional stage consoles read from the back face of their niche: the
  // outer wall pushed out by ALC_RECESS, on the RX (u<0) or TX (u>0) side, centred on
  // the station's vc (kernel-RX is the softnet console below, not a niche).
  const stationTerminals = stations.map((st) => {
    const lvl = levels[st.level];
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    const u = st.side === "left" ? -(EDGEHW + ALC_RECESS) : EDGEHW + ALC_RECESS;
    return { sign: st.sign, segments: [segment([u, vc - terminalHalfWidth], [u, vc + terminalHalfWidth])] };
  });
  return [
    {
      // TRAFFIC PER INTERFACE (sar -n DEV): the far-wall screen RIGHT of the corridor,
      // read head-on from the box (== the box-term-right recess back, the screen plane).
      sign: "network",
      segments: [segment([TERM_INNER, V_TERM_BACK], [TERM_OUTER, V_TERM_BACK])],
    },
    {
      // CONNECTIONS (ss -s census): the far-wall screen LEFT of the corridor
      // (== the box-term-left recess back, the screen plane).
      sign: "network-sockets",
      segments: [segment([-TERM_OUTER, V_TERM_BACK], [-TERM_INNER, V_TERM_BACK])],
    },
    {
      // softnet_stat terminal on the kernel-RX Tesla bay deep wall, between the rods
      // (v 1696..1888 = the rods' midpoint 1792 +/- 96; matches the coil-terminal sector).
      sign: "network-softnet",
      segments: [segment([deep, 1696], [deep, 1888])],
    },
    ...stationTerminals,
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
