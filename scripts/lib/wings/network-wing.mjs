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

// Kernel-TX QDISC BAY placard (NETWORK_QDISC_DISC_PLAN.md): a two-line wall sign naming
// the sunken occupancy disc. The engine (DoomPerf_UpdateNetQdiscCap) swaps the whole
// midtexture DPNQDG <-> DPNQDX by texture identity, keyed on whether tc's qdisc backlog
// is readable: DEPTH = the live gauge; UNKNOWN = the netlink/tc probe returned nothing
// (?qdisc=off or a restricted container), the same honest-fallback affordance the swap-cap
// pipe uses. The disc is the gauge, the KTXT terminal the readout. [[wall-label-centering-width]]
const qdiscPlacards = {
  depth: { texture: tex("QDG"), patch: tex("PQDG"), l1: "QDISC", l2: "DEPTH" },
  unknown: { texture: tex("QDX"), patch: tex("PQDX"), l1: "QDISC", l2: "UNKNOWN" },
};

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

// ===== Socket-lock CAPACITOR BANKS, take 3: authored SUBSTATION CAPACITOR TOWERS. Rather
// than reuse the coils' glowing-rod vocabulary, each level-0 socket bay now stands TWO
// hand-drawn capacitor towers -- a steel rack of stacked white capacitor units on dark-brown
// ribbed porcelain insulator posts (the classic HV shunt-capacitor bank) -- as solid billboard
// PROPS (MT_DP_NETCAPTWR, doomednum 3011, sprite SPR_COL2 frame A -- an unused single-frame IWAD
// decoration. (SPR_COLU is the FLOOR-LAMP thing 2028, which the hub + memory wing DO place, so
// reusing it repainted those lamps into towers; SPR_COL2's thing 31 is never placed.)
// The live signal reads as the TRAVELLING BUS CURRENT the player picked: a bright bead
// (SPR_BFE1 D/E round mote) runs along the wire between the two tower tops, spawned faster as
// the lane's queue fills, plus an ambient charge glow on the bay floor. No jagged bolts -- the
// current running BETWEEN towers is the socket bank's signature, distinct from the coils'
// outward crackle. [[pwad-sprite-override-constraint]] [[prefer-everpresent-over-flicker]]
const capMoteRamp = [4, 4, 192, 194, 196]; // white core -> electric blue (115,115,255)
const capMoteFlash = [4, 4, 4, 192, 196];  // whiter, for the flicker frame
// The capacitor TOWER billboard (overrides IWAD COL2A0): a steel rack of five tiers of white
// capacitor cans, top insulator bushings, standing on three ribbed brown porcelain posts over
// a dark base pad. Floor-standing offset (feet at origin: leftOffset W/2, topOffset H).
const TOWER_W = 64, TOWER_H = 152;
const buildCapTowerSprite = () => {
  const W = TOWER_W, H = TOWER_H, T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) put(x, y, c); };
  const WHITE = 80, WH2 = 83, WSHAD = 89, STEEL = 99, DKG = 105, BLACK = 5; // steel + white cans
  const BRN = 68, BRN2 = 72, DBRN = 15, BRNHI = 63;                          // porcelain browns
  // Base pad.
  rect(6, 142, 58, 149, DKG);
  rect(3, 148, 61, 152, BLACK);
  // Three ribbed brown porcelain insulator posts (the skirted legs).
  for (const cx of [14, 32, 50]) {
    for (let y = 102; y < 143; y += 1) {
      const rib = (y % 4 === 0);
      const half = rib ? 6 : 5;
      for (let x = cx - half; x <= cx + half; x += 1) {
        let c = rib ? BRNHI : ((y % 4 === 2) ? DBRN : BRN);
        if (x < cx - 3) c = DBRN; else if (x > cx + 3) c = (rib ? BRN : BRN2); // round shading
        put(x, y, c);
      }
    }
    rect(cx - 6, 100, cx + 7, 103, STEEL); // cap where the post meets the rack base
  }
  // Steel rack: outer vertical rails + five tiers of paired white cans.
  rect(6, 12, 12, 102, STEEL); rect(52, 12, 58, 102, STEEL);
  rect(6, 12, 8, 102, DKG); rect(56, 12, 58, 102, DKG); // dark rail edges
  const tierTop = 14, tierH = 17;
  for (let t = 0; t < 5; t += 1) {
    const y0 = tierTop + t * tierH;
    rect(8, y0 - 2, 56, y0, STEEL); // shelf rail above the tier
    for (const [bx0, bx1] of [[14, 30], [34, 50]]) {
      rect(bx0, y0, bx1, y0 + tierH - 3, WHITE);
      rect(bx0, y0, bx1, y0 + 2, WH2);                 // top highlight
      rect(bx0, y0 + tierH - 6, bx1, y0 + tierH - 3, WSHAD); // bottom shade
      for (let x = bx0; x < bx1; x += 1) { put(x, y0, DKG); put(x, y0 + tierH - 4, DKG); }
      for (let y = y0; y < y0 + tierH - 3; y += 1) { put(bx0, y, DKG); put(bx1 - 1, y, DKG); }
    }
  }
  // Top bushings: small insulator stacks + grey terminal caps across the rack top.
  rect(8, 12, 56, 14, STEEL);
  for (const bx of [16, 26, 38, 48]) {
    rect(bx - 1, 4, bx + 2, 12, BRN);
    rect(bx - 2, 7, bx + 3, 8, DBRN); // a rib
    put(bx, 2, STEEL); put(bx + 1, 2, STEEL);
  }
  return buildPatch(px, W, H, { transparent: T, leftOffset: Math.floor(W / 2), topOffset: H });
};

// ===== RING-BUFFER (level 2) + send-q (level 0) INSTRUMENT PROPS ("more alive network
// instruments", Phase 3). Three authored substation machines, each a solid billboard prop
// (MF_SOLID, tics -1) drawn feet-at-origin (leftOffset W/2, topOffset H). The wire feeds them
// off signals the engine ALREADY has: the TURBINE/DYNAMO wheels SPIN (orbiting mote-rings in
// p_tick.c) at the live RX/TX throughput and shed sparks on ring drops; the BATTERY banks FILL
// (a rising charge-mote column) with the send-q depth and VENT at overcharge -- never sparking,
// because a full send-q backpressures, it does not drop. Sprite names reuse free IWAD single-
// frame decorations (ELEC/SMT2/COL1, frame A) per [[pwad-sprite-override-constraint]]; the lab
// map never places their stock doomednums so only these props are affected.

// TURBINE WHEEL (overrides SMITA0 -- an unused single-frame IWAD decoration; do NOT use ELEC,
// whose thing 48 the hub places to flank the network entrance): an axial-flow turbine rotor -- a pale steel shroud ring
// around a wheel of dark swept blades on a bright steel hub, bolted to a dark machine pedestal.
// The RX ring's signature; the engine orbits bright motes around the hub so it reads as spin.
const buildTurbineSprite = () => {
  const W = 100, H = 144, T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) put(x, y, c); };
  const SHROUD = 84, SHROUD_HI = 80, SHROUD_SH = 90;   // pale steel shroud ring
  const BLADE = 8, BLADE2 = 6, BLADE_HI = 100;         // dark swept blades (3-tone for depth)
  const HUB = 96, HUB_HI = 4, BOLT = 6;                // bright steel hub
  const BASE = 105, BASE_DK = 5, BASE_HI = 99;         // machine pedestal
  const cx = 50, cy = 54, R = 46, HUBR = 11;
  for (let y = 0; y < 108; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r > R + 0.5) continue;
      if (r > R - 6) { put(x, y, dy < -r * 0.4 ? SHROUD_HI : (dy > r * 0.5 ? SHROUD_SH : SHROUD)); continue; }
      if (r <= HUBR) { put(x, y, r < 4 ? HUB_HI : HUB); continue; }
      // Swept blades: 11 blades whose leading edge curves with radius (the sweep term).
      const a = Math.atan2(dy, dx) + r * 0.06;
      const frac = ((a / (Math.PI * 2)) * 11) % 1;
      put(x, y, frac < 0.30 ? BLADE_HI : (frac < 0.70 ? BLADE : BLADE2));
    }
  }
  for (const [bx, by] of [[cx, cy - 6], [cx + 6, cy + 3], [cx - 6, cy + 3]]) put(bx, by, BOLT);
  rect(28, 98, 72, 112, BASE); rect(30, 98, 70, 100, BASE_HI);
  rect(20, 112, 80, 144, BASE); rect(20, 112, 80, 114, BASE_HI); rect(20, 140, 80, 144, BASE_DK);
  for (let x = 26; x < 80; x += 12) rect(x, 118, x + 2, 138, BASE_DK); // cooling ribs
  return buildPatch(px, W, H, { transparent: T, leftOffset: Math.floor(W / 2), topOffset: H });
};

// DYNAMO (overrides SMT2A0): a Victorian ring-dynamo after the Siemens engraving -- a big banded
// field-magnet DRUM with a dark wound bore and a violet commutator/brush stub, a smaller EXCITER
// box at its side, bolted to a riveted base with two cables snaking off. The TX ring's signature;
// the engine orbits violet output motes and cracks a brush-arc at the commutator on TX drops.
const buildDynamoSprite = () => {
  const W = 116, H = 128, T = 247;
  const px = new Uint8Array(W * H).fill(T);
  const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) put(x, y, c); };
  const DRUM = 96, DRUM_HI = 84, BAND = 80;            // grey field drum + pale pole-shoe band
  const CORE = 6, WIND = 15, WIND2 = 68;               // dark wound bore + copper winding bars
  const STEEL = 99, DK = 5, BOLT = 8;
  const VIO = 251, VIO_HI = 4;                         // commutator violet glow
  const cx = 72, cy = 52, R = 50;
  for (let y = 0; y < 106; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r > R + 0.5) continue;
      if (r > R - 10) { put(x, y, dx < 0 ? DRUM_HI : DRUM); continue; }   // outer yoke ring
      if (r > R - 16) { put(x, y, BAND); continue; }                     // pale pole band
      put(x, y, (y % 4 === 0) ? WIND2 : (r > R - 28 ? WIND : CORE));      // wound bore
    }
  }
  rect(cx + R - 12, cy - 8, cx + R + 6, cy + 8, STEEL);  // commutator housing
  rect(cx + R - 4, cy - 4, cx + R + 2, cy + 4, VIO); put(cx + R - 1, cy, VIO_HI);
  rect(4, 58, 40, 102, STEEL); rect(4, 58, 40, 60, DRUM_HI);            // exciter box
  rect(10, 66, 34, 94, CORE);
  for (let y = 68; y < 94; y += 4) rect(10, y, 34, y + 1, WIND2);
  rect(0, 102, W, 128, DK); rect(0, 102, W, 104, STEEL);               // bolted base plate
  for (let x = 6; x < W; x += 12) put(x, 114, BOLT);
  for (let x = cx; x < W; x += 1) { const yy = 116 + Math.round(4 * Math.sin((x - cx) * 0.3)); put(x, yy, CORE); put(x, yy + 3, CORE); }
  return buildPatch(px, W, H, { transparent: T, leftOffset: Math.floor(W / 2), topOffset: H });
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


// ===== TRAIN-TUNNEL cast-iron LINER wall (DPNTUN): the dark segmented lining of the tube tunnel
// at the switchyard head -- horizontal ring FLANGES (the bolted cast-iron rings a tube tunnel is
// built from) every 32px, vertical SEGMENT seams every 64px, and a bolt head at each crossing.
// Near-black so the bore reads as receding into the dark; 128x128 tiles flush both ways so a tall
// headwall or a long side wall repeats the rings cleanly. [[doom-texture-power-of-two]]
const buildTunnelLinerPatch = () => {
  const W = 128, H = 128;
  const px = new Uint8Array(W * H).fill(110); // (39,39,39) near-black liner base
  const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) put(x, y, c); };
  // Cast-iron ring flanges: a recessed dark groove, a steel flange face, a thin highlight lip.
  for (let ry = 0; ry < H; ry += 32) {
    rect(0, ry, W, ry + 6, 6);        // (19,19,19) recessed groove above the flange
    rect(0, ry + 6, W, ry + 12, 105); // dark-steel flange face
    rect(0, ry + 10, W, ry + 11, 99); // steel highlight lip
  }
  // Vertical segment seams (bolted joints between lining rings).
  for (let cx = 0; cx < W; cx += 64) {
    rect(cx, 0, cx + 3, H, 6);
    for (let y = 0; y < H; y += 1) put(cx + 3, y, 105);
  }
  // Bolt heads at each flange/seam crossing: a bright steel stud.
  for (let ry = 8; ry < H; ry += 32) {
    for (let cx = 12; cx < W; cx += 32) {
      put(cx, ry, 79); put(cx + 1, ry, 80); put(cx, ry + 1, 80);
    }
  }
  return buildPatch(px, W, H);
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

// Authored HAZARD-CROSSING flat for the ring causeway (crossingBridge). The causeway floor used to
// inherit the dark honeycomb catwalk grating and camouflaged into it; this makes it SALIENT -- bold
// diagonal YELLOW/BLACK hazard chevrons (the universal "marked crossing / mind the live current"
// cue) that pop hard against the dark grey grating and the blue hall. 16-unit period (8 yellow / 8
// black), seamless across the 64 flat tiling. A thin darker line rides each stripe edge so the
// chevrons keep definition once distance-shaded. [[riser-texture-and-light-rules]]
const crossFlatName = tex("XNG");
const buildCrossFlat = () => {
  const size = 64;
  const YELLOW = 231, BLACK = 0, EDGE = 163; // (255,255,0) / black / dim gold edge line
  const px = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const band = (x + y) >> 3;        // 8-unit diagonal bands
      const inband = (x + y) & 7;        // position within the band
      let c = (band & 1) ? YELLOW : BLACK;
      if (inband === 0) c = EDGE;        // dim edge line between stripes for definition
      px[y * size + x] = c;
    }
  }
  return lump(crossFlatName, Buffer.from(px));
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

// ===== Depth boundaries (local v). Flat catwalk stages (832) joined by stair / transformer
// transitions (448). The stairs carry a deep descent -- each stage drops 168 (see F1/F2 below)
// at a 12-rise / 32-run step angle, so the stair RUN is 168 * 32/12 = 448. The drop was trimmed
// ~10% (was 192) for a slightly shallower, shorter hall; keeping the SAME step angle pulled the
// run in with it, and both TRANS and LVL_LEN are on the 64-grid (448 = 7*64, run = whole steps)
// so the floor inscriptions stay aligned. The terminal ALCOVES stay a fixed width (BAY_HW) centred
// on each stage. Mirrors the engine's DoomPerf_NET_* region/spawn constants; every stage-derived
// world coord below (V AND Z) is duplicated in p_tick.c / r_draw.c and MUST stay in sync (the
// RING_PITCH discipline).
const V_ENTRY = 704, V_FOYER = 896;
const LVL_LEN = 832, TRANS = 448, GATE_D = 16;
const C0 = V_FOYER + LVL_LEN; //       1728  transformer 0 (socket -> kernel)
const C1 = C0 + TRANS + LVL_LEN; //    3008  transformer 1 (kernel -> ring)
const V_L2END = C1 + TRANS + LVL_LEN;//4288  ring bus end (final step-down -> switchyard head)
const V_PLAZA = V_L2END + 112; //      4400  switchyard-head front edge
const V_TERM_WALL = V_PLAZA + 16; //   4416  portal plane (old back wall) -> now the tunnel mouth
// Terminal-ALCOVE half-width in v: every side instrument bay (socket capacitor / send battery /
// ring turbine-dynamo / kernel-TX qdisc pit / kernel-RX coil) is held to this fixed 512-wide
// window centred on its stage's v-midpoint (vc), regardless of how long the stage is. As the
// stages lengthened this stayed put, so the extra length is plain descending catwalk before and
// after each bay -- "keep the alcoves the same width" while the catwalks grow. 256 == the ORIGINAL
// half-stage, so the bays are byte-for-byte the size they were.
const BAY_HW = 256;

// ===== RING-LEVEL CROSSING CAUSEWAY: a LOW crossing across the current channel low in the hall so
// the player can cross RX<->TX catwalks without climbing back to the foyer. It sits in the plain
// ring catwalk just before the NIC instrument bay (ring stage sv1=3456 .. bay mouth 3616), in a
// GATE-FREE stretch. The feeder SPLITS the ring bus/spine over this v-span and this causeway fills
// the gap. It is deliberately kept JUST BELOW the orb ride-height (CAUSEWAY_Z -356 < ride -352) so
// the current flows VISIBLY over it (a low ford) and -- crucially -- does not DAM the sightline down
// the channel: a raised walk-height deck (-336) sat above the orbs and occluded the whole sunken
// channel behind it, so the crossing was dropped to orb level. The player steps down ~20 from the
// catwalk (-336) onto it and back up the far side; the orbs skim ~4 units above it. No engine logic
// (orbs simply glide through at their normal ring ride-z). World x = -v.
const CAUSEWAY_Z = -356; //  causeway floor: 20 below the catwalk (steppable), 4 below the orb ride-z
const BRIDGE_V1 = 3488; //   foyer-side causeway edge (world x=-3488)
const BRIDGE_V2 = 3616; //   wire-side causeway edge  (world x=-3616, == ring bay mouth)

// ===== TRAIN TUNNEL at the switchyard head (the WIRE beyond the host). The hall opens onto a
// massive tube-style tunnel: a raised STATION PLATFORM either side of a SUNKEN TRACK BED that
// carries the two packet lanes head-on through an arched PORTAL into a long dark BORE that
// narrows, lowers and darkens to a vanishing point. TX orbs stream INTO the bore and shrink into
// the black (departing to the wire); RX orbs emerge FROM it (arriving). The player is railed off
// the track bed (blockEdge) -- looks down the tunnel, can't walk in -- while the NOCLIP orbs ride
// through freely (the same see-through-but-impassable trick the bus troughs use). The orb
// spawn/exit X in p_tick.c (DOOMPERF_NET_RX_SPAWN_X / _TX_EXIT_X = -3440) sits deep in the
// near-black bore and MUST stay inside V_BORE_END below (RING_PITCH discipline).
const BED_Z = -384;              // sunken track-bed floor: 48 below F2 (-336) platform -> a mind-the-gap drop
const BEDHW = POOLHW;            // 112: track-bed half-width (the two lanes + margin, == bus outer edge)
const V_PORTAL = V_TERM_WALL;    // 4416: portal plane -- the arched tunnel mouth
const V_ARCH = V_PORTAL + 24;    // 4440: stepped-arch headwall ring depth
// Stepped horseshoe ARCH across the mouth: u-columns with a RAISED-CENTRE ceiling profile, so the
// upper texture on the portal line reads as an arch cut into the headwall (tall centre, low sides).
// The whole ceiling profile was dropped 160 (from 96/56/8) to make the mouth SHORTER -- a lower,
// wider opening that reads more like an external ethernet port -- keeping the same horseshoe
// silhouette, just brought down. The bore rings drop the same 160 so the ceiling never steps back
// UP as you look into the tunnel; they still recede (each lower than the last) into the dark.
const archCols = [
  { u1: -112, u2: -72, ceil: -152 },
  { u1: -72, u2: -32, ceil: -104 },
  { u1: -32, u2: 32, ceil: -64 },
  { u1: 32, u2: 72, ceil: -104 },
  { u1: 72, u2: 112, ceil: -152 },
];
// Three receding BORE rings -- each narrower + lower + darker for a forced-perspective vanish.
// hw stays > the lane |u|=68 (LANEHW) so the NOCLIP orbs never clip the narrowing walls.
const boreRings = [
  { id: "bore0", v1: V_ARCH, v2: V_ARCH + 260, hw: 112, ceil: -64, light: 84 },
  { id: "bore1", v1: V_ARCH + 260, v2: V_ARCH + 500, hw: 96, ceil: -88, light: 48 },
  { id: "bore2", v1: V_ARCH + 500, v2: V_ARCH + 700, hw: 80, ceil: -112, light: 16 },
];
const V_BORE_END = V_ARCH + 700; // 5140: bore end cap (deep black); orbs fade at x=-5040 just short
const TUNNEL_WALL = tex("TUN");  // authored cast-iron tunnel-liner wall texture (DPNTUN)

// ===== Walk floors (local z): 0 / -168 / -336, a deep descent. The bus drops the full
// 168 through the STEP-DOWN TRANSFORMER at each stage; the catwalks take a 14-step stair.
// Each stage's drop was trimmed ~10% (was 192) for a slightly shallower, shorter hall, at the
// SAME step angle -- so two steps came off (16 -> 14), each riser still STEP_DROP over a 32 run.
// STAIR_STEPS * STEP_DROP must equal the walk drop (F1-F0 = 168); 14*32 run = 448 = TRANS.
const F0 = 0, F1 = -168, F2 = -336;
const STAIR_STEPS = 14; // steps per catwalk staircase (was 16; same 12/32 step angle, ~10% less drop)
const STEP_DROP = 12; //   catwalk staircase riser (unchanged -> 14*12 = 168 total, same grade)
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

// ===== Socket-lock CAPACITOR BANKS (level 0): one bay off each level-0 catwalk (RX/RECV-Q
// left, TX/SEND-Q right), carved into the outer wall like the coil bay, standing TWO authored
// substation CAPACITOR TOWERS (MT_DP_NETCAPTWR props) that flank a clear central walkway to
// the socket terminal on the bay's deep wall. The two towers sit at local (u=+/-412, v=1162)
// and (u=+/-412, v=1462), so at vc=1312 the walk between them stays open. The live effect is
// the TRAVELLING BUS CURRENT (p_tick.c, RING_PITCH discipline): a bead runs along the wire
// between the two tower tops -- world (-v, u) puts the towers at world x=-1162/-1462, world y
// +/-384 (face-front, so the bead reads in front of them), at TOWER top z. Bay floor glows
// with fill (CAP_BAY_TAG). No gauge, no up-the-can crackle.
const CAP_COL_C = 412; //   |u| of the two towers (mid-bay, matches the coil bay depth)
const CAP_SPREAD = 150; //  |v - vc| of the two towers (they flank the walkway to the terminal)
const TOWER_EDNUM = 3011; // MT_DP_NETCAPTWR doomednum (solid billboard prop; see info.c)
const CAP_BAY_TAG = ids.sectorTags[0] + 52; // 752 recv bay / 753 send bay (floor charge glow)
// The ring-buffer (level 2) bays use the two-flanking-props pattern with authored billboard
// machines (doomednums hardcoded like the capacitor tower's 3011, mirrored in info.c mobjinfo +
// p_mobj.c allowlist); their floor glow tracks live throughput. The send-q bay instead uses 3D
// GEOMETRY: two solid CELL-COLUMN pillars whose walkway faces carry a segmented charge gauge
// (R_DoomPerfNetBatteryPixel, dispatched off lineTags 762/763 in r_segs.c) filling bottom-up
// with the send-q depth -- no billboard, no floating motes.
const TURB_EDNUM = 3012;  // MT_DP_NETTURB -- NIC RX ring turbine wheel
const DYN_EDNUM = 3013;   // MT_DP_NETDYN  -- NIC TX ring dynamo drum
const RING_BAY_TAG = ids.sectorTags[0] + 54; // 754 turbine (RX) bay / 755 dynamo (TX) bay glow
const BATT_LINE_TAG = ids.lineTags[0] + 2;   // 762 red (+) cell column / 763 blue (-) cell column
const BATT_HW = 32;       // battery cell-column half-width (64x64 footprint, all faces 64 wide)
const BATT_H = 40;        // battery height: a low block (cap band + 2 cell rows) with its TOP at
//                           eye level and OPEN AIR above it. MUST match H in
//                           R_DoomPerfNetBatteryPixel (the riser the gauge shader fills).

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

// ===== Kernel-TX QDISC floor instrument (NETWORK_QDISC_DISC_PLAN.md). Replaces the
// level-1 TX flush console with a SUNKEN, RAILED disc-pit off the TX catwalk: a
// world-locked OCCUPANCY DISC (violet pie wedge = real qdisc backlog) between two glowing
// FLOW LINES (enqueue-in upstream, dequeue-out downstream) that run PARALLEL to the TX bus
// (along v) so their pulses travel +v like the TX packet-orbs. The pit is `blockEdge` (look
// down over the rail, can't fall in); a walkable F1 frame surrounds it on ALL FOUR SIDES (a
// near walkway inset from the catwalk, a deep walkway at the terminal, plus the front/back
// margins) so the player can circle the display. The disc + line WORLD centres below are
// mirrored in r_draw.c's NET_QDISC_* / NET_FLOW_* #defines and MUST stay in sync (RING_PITCH
// discipline) or the shader reads as drifting with the camera ([[platter-animation-radial]]).
const QD_VC = (C0 + TRANS + C1) / 2;   // 2592: level-1 bay v-centre (== coilTermVC)
const QD_DEEP = 600;                   // bay deep wall (terminal): DEEPER than other bays' ALCHW
//                                        so a wide walkway rings the pit (catwalk opening stays 320)
const QD_PIT_U1 = 384;                 // pit near edge -> a 64-wide NEAR walkway u[320,384]
const QD_PIT_U2 = 528;                 // pit far edge  -> a 72-wide DEEP walkway u[528,600]
const QD_DISC_CU = (QD_PIT_U1 + QD_PIT_U2) / 2; // 456: disc u-centre (world y)
const QD_DISC_R = 72;                  // disc radius: fills the 144-wide pit u-span, reads foreshortened
const QD_FLOW_LEN = 96;                // v-length of each flow-line strip up/down-stream of the disc
const QD_PIT_DROP = 28;                // pit floor sunk below F1 -> look DOWN into it from the walkway rail
const QD_DISC_TAG = ids.sectorTags[0] + 56;    // 756: occupancy disc floor
const QD_INFLOW_TAG = ids.sectorTags[0] + 57;  // 757: inflow (enqueue) line
const QD_OUTFLOW_TAG = ids.sectorTags[0] + 58; // 758: outflow (dequeue) line
// Floor-display sentinels from the NETWORK block [124,128] (NOT storage's 131/132): 126 =
// the occupancy disc (r_plane -> display 5), 127 = both flow lines (display 6). The disc +
// flow sub-features are the only network floors on these exact values (verified no static
// sector authors 126/127); a gate/drain light-ramp that transiently lands on one only
// mis-shades OFF-disc pixels, which the shader returns as background -> no visible artifact.
const QD_DISC_LIGHT = ids.lights[0] + 2;   // 126
const QD_FLOW_LIGHT = ids.lights[0] + 3;   // 127
// The disc CENTRE + flow-line axis in WORLD coords (west wing: local (u,v) -> world (-v,u)).
// Mirrored in r_draw.c: NET_QDISC_CX/CY/OUTER, NET_FLOW_CY.
export const netQdiscWorld = {
  cx: -QD_VC,        // -2592 (world x = -v at the disc centre)
  cy: QD_DISC_CU,    //   456 (world y = u at the disc centre / flow-line axis)
  outer: QD_DISC_R,  //    72
};

const build = (ctx) => {
  const { areaRect, addAreaThing, direction, base, accent, terminalPanelFloor } = ctx;

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
    // The ring level's channel is SPLIT around the crossing causeway (crossingBridge, below): its
    // bus/spine leave a gap [BRIDGE_V1, BRIDGE_V2] the low causeway fills. Other levels lay one
    // continuous run. `layChannel` yields the sub-ranges around any gap.
    const gap = level === 2 ? { v1: BRIDGE_V1, v2: BRIDGE_V2 } : null;
    const layChannel = (baseId, u1, u2, va, vb, opt) => {
      if (gap && gap.v1 > va && gap.v2 < vb) {
        areaRect(direction, `${baseId}-a`, { u1, v1: va, u2, v2: gap.v1 }, opt);
        areaRect(direction, `${baseId}-b`, { u1, v1: gap.v2, u2, v2: vb }, opt);
      } else {
        areaRect(direction, baseId, { u1, v1: va, u2, v2: vb }, opt);
      }
    };
    // The spine is a LOW divider (walk-24, well below the elevated catwalks and below the
    // orb ride-height, above the full charge line) so the player, standing on the raised
    // side catwalks, can see over it into BOTH buses from either side. It is `blockEdge`
    // (impassable, see-through) so it reads as a rail, not a floor to enter; its trough-
    // facing sides glow (SPINE_WALL) as the energised conductor between the two buses.
    layChannel(`${id}-spine`, -MEDHW, MEDHW, cv1, brink, { ...conduit, kind: "net-spine", floor: walk - 24, ceiling, light: 168, blockEdge: true, riserWall: SPINE_WALL });
    // Bus bars run the stage to the signal band; the trough itself carries the CURRENT.
    layChannel(`${id}-bus-rx`, -POOLHW, -MEDHW, cv1, sigV1, busOpts(0, busFlatNames.rx.cool));
    layChannel(`${id}-bus-tx`, MEDHW, POOLHW, cv1, sigV1, busOpts(1, busFlatNames.tx.cool));
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
    const stepV = (s.v2 - s.v1) / STAIR_STEPS;
    for (let k = 0; k < STAIR_STEPS; k += 1) {
      const floor = s.wTop - (k + 1) * STEP_DROP;
      const ceiling = HALL_CEIL;
      const sv1 = s.v1 + k * stepV, sv2 = s.v1 + (k + 1) * stepV;
      areaRect(direction, `${s.id}-l-${k}`, { u1: -EDGEHW, v1: sv1, u2: -POOLHW, v2: sv2 }, { ...hall, kind: "net-stair", floor, ceiling, light: 152 });
      areaRect(direction, `${s.id}-r-${k}`, { u1: POOLHW, v1: sv1, u2: EDGEHW, v2: sv2 }, { ...hall, kind: "net-stair", floor, ceiling, light: 152 });
    }
  };

  // ===== RING-LEVEL CROSSING CAUSEWAY: a LOW crossing across the whole channel (u[-POOLHW,POOLHW])
  // filling the gap the ring feeder left in the bus/spine. Its floor sits at CAUSEWAY_Z (-356) --
  // 20 below the catwalks and 4 BELOW the orb ride-z -- so the player steps down onto it to cross
  // and the current flows VISIBLY over it (skimming ~4 units above) instead of being dammed behind a
  // raised deck. The split bus/spine troughs either side stay `blockEdge` + see-through; the
  // causeway's v-end risers (facing those troughs) inherit the dark bus housing so the crossing
  // reads as the channel floor humping up into a low ford. NOT blockEdge, so the ~20 step from each
  // catwalk is walkable. No engine involvement -- the orbs just glide through at their ring ride-z.
  const crossingBridge = () => {
    areaRect(direction, "net-bridge", { u1: -POOLHW, v1: BRIDGE_V1, u2: POOLHW, v2: BRIDGE_V2 }, {
      ...hall, kind: "net-bridge", floor: CAUSEWAY_Z, ceiling: HALL_CEIL, light: 170,
      floorFlat: crossFlatName, riserWall: BUS_HOUSING,
    });
  };

  levels.forEach(feeder);
  levels.forEach(breaker);
  levels.forEach(catwalks);
  stairs.forEach(gantryStair);
  crossingBridge();

  // ===== Stage TERMINALS: every stage station is now a walk-in INSTRUMENT BAY reading from
  // its bay's deep wall (level 0 socket capacitor/battery banks, level 1 kernel-TX qdisc pit,
  // level 2 ring turbine/dynamo bays); kernel-RX is the coil-bay softnet console. The old
  // per-stage placard wording reads on the catwalk floor in front of each (catwalkSide).
  // SIGN_W is the coil-bay + qdisc-placard wall-sign width. [[terminal-design-principles]]
  const SIGN_W = wallSignSize.width; // 256
  // ===== Socket-lock CAPACITOR BANKS: the two level-0 socket stations are instrument bays
  // holding two authored SUBSTATION CAPACITOR TOWERS (solid billboard props) that flank a clear
  // central walkway to the socket terminal on the bay's deep wall. The bay is one open floor
  // (tagged for an ambient charge glow); the towers are things, so no pillar tiling.
  // [[terminal-design-principles]]
  const socketCapBay = (side, lane, sc) => {
    const lvl = levels[0];
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    const bv1 = vc - BAY_HW, bv2 = vc + BAY_HW; // fixed 512-wide alcove window (plain catwalk outside)
    const sgn = side === "left" ? -1 : 1;
    const inner = sgn * EDGEHW; //  catwalk-side opening (old outer wall)
    const outer = sgn * ALCHW; //   deep wall
    // Open bay floor (front approach + deep, one sector), tagged for the fill charge glow.
    areaRect(direction, `cap-${side}-floor`, uv(outer, inner, bv1, bv2), {
      ...intake, kind: "net-alcove", floor: F0, ceiling: HALL_CEIL, light: 150, tag: CAP_BAY_TAG + lane,
    });
    // Two CAPACITOR towers at (u=+/-412, v = vc +/- CAP_SPREAD), flanking the walkway (recv only;
    // the send-q bay is now the 3D battery cell-columns in batteryBay).
    addAreaThing(direction, TOWER_EDNUM, sgn * CAP_COL_C, vc - CAP_SPREAD);
    addAreaThing(direction, TOWER_EDNUM, sgn * CAP_COL_C, vc + CAP_SPREAD);
    // The socket terminal on the deep wall, centred behind the two towers (== coil-terminal).
    areaRect(direction, `cap-${side}-term`, uv(sgn * (ALCHW + ALC_RECESS), outer, vc - terminalTextureSize.width / 2, vc + terminalTextureSize.width / 2), {
      ...conduit, kind: "terminal",
      floor: F0 + terminalPanelFloor,
      ceiling: F0 + terminalPanelFloor + terminalTextureSize.height,
      light: 184,
      labelSide: side === "left" ? leftWall : rightWall,
      labelTexture: sc.texture,
      controlPanel: true,
      riserWall: BUS_HOUSING,
    });
  };
  // ===== RING-BUFFER (level 2) INSTRUMENT BAYS: the two NIC-ring stations become instrument
  // bays (like the socket capacitor banks), each standing TWO authored machines flanking a clear
  // walkway to the ring terminal on the deep wall -- TURBINE WHEELS on the RX (left) ring, DYNAMO
  // drums on the TX (right) ring. One open floor tagged for the throughput glow; the machines are
  // things (no pillar tiling). The engine spins them (orbiting motes) at the live RX/TX rate.
  const ringInstrumentBay = (side, lane, propEdnum, sc) => {
    const lvl = levels[2];
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    const bv1 = vc - BAY_HW, bv2 = vc + BAY_HW; // fixed 512-wide alcove window (plain catwalk outside)
    const sgn = side === "left" ? -1 : 1;
    const inner = sgn * EDGEHW; //  catwalk-side opening
    const outer = sgn * ALCHW; //   deep wall
    areaRect(direction, `ring-${side}-floor`, uv(outer, inner, bv1, bv2), {
      ...intake, kind: "net-alcove", floor: F2, ceiling: HALL_CEIL, light: 150, tag: RING_BAY_TAG + lane,
    });
    addAreaThing(direction, propEdnum, sgn * CAP_COL_C, vc - CAP_SPREAD);
    addAreaThing(direction, propEdnum, sgn * CAP_COL_C, vc + CAP_SPREAD);
    areaRect(direction, `ring-${side}-term`, uv(sgn * (ALCHW + ALC_RECESS), outer, vc - terminalTextureSize.width / 2, vc + terminalTextureSize.width / 2), {
      ...conduit, kind: "terminal",
      floor: F2 + terminalPanelFloor,
      ceiling: F2 + terminalPanelFloor + terminalTextureSize.height,
      light: 184,
      labelSide: side === "left" ? leftWall : rightWall,
      labelTexture: sc.texture,
      controlPanel: true,
      riserWall: BUS_HOUSING,
    });
  };
  // ===== SEND-Q BATTERY BANK (level 0, right): two 3D BATTERY CELL-COLUMNS -- solid full-height
  // pillars whose faces carry the segmented charge gauge (R_DoomPerfNetBatteryPixel via lineTags
  // 762/763, filling bottom-up with the send-q depth). The near column is the red (+) terminal,
  // the far the blue (-). The bay floor is TILED around the two pillars (the builder forbids
  // overlapping sectors): full-depth front + deep bands flank the middle u-band, itself split in v
  // into three floor gaps + the two pillar footprints.
  const batteryBay = (side, sc) => {
    const lvl = levels[0];
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    const bv1 = vc - BAY_HW, bv2 = vc + BAY_HW; // fixed 512-wide alcove window (plain catwalk outside)
    const sgn = side === "left" ? -1 : 1;
    const uEdge = sgn * EDGEHW, uDeep = sgn * ALCHW;            // catwalk opening / deep wall
    const uColLo = sgn * (CAP_COL_C - BATT_HW), uColHi = sgn * (CAP_COL_C + BATT_HW); // pillar u-band
    const floorOpt = { ...intake, kind: "net-alcove", floor: F0, ceiling: HALL_CEIL, light: 150, tag: CAP_BAY_TAG + 1 };
    const vcols = [vc - CAP_SPREAD, vc + CAP_SPREAD];
    // Front (catwalk-side) + deep floor bands run the alcove window depth.
    areaRect(direction, `batt-${side}-front`, uv(uEdge, uColLo, bv1, bv2), floorOpt);
    areaRect(direction, `batt-${side}-deep`, uv(uColHi, uDeep, bv1, bv2), floorOpt);
    // Middle u-band tiled in v: floor gap, pillar, floor gap, pillar, floor gap.
    [[bv1, vcols[0] - BATT_HW], [vcols[0] + BATT_HW, vcols[1] - BATT_HW], [vcols[1] + BATT_HW, bv2]]
      .forEach(([v1, v2], k) => areaRect(direction, `batt-${side}-gap${k}`, uv(uColLo, uColHi, v1, v2), floorOpt));
    // Each ~1/3-height cell-column BLOCK (floor=BATT_H raised, ceiling=HALL_CEIL, OPEN AIR above so
    // the player sees the top) wears the segmented charge gauge on its perimeter face (762 = red +,
    // 763 = blue -; BATT_H must match H in R_DoomPerfNetBatteryPixel), and carries TWO short grey
    // TERMINAL CONTACTS on top -- raised nubs (floor BATT_H+CT_H). The block top is TILED so the
    // gauge lineTag stays on the four OUTER FRAME strips only; the two contacts sit in the UNtagged
    // interior, never touching a tagged edge -- else lineTagFor would hand the tag to a contact
    // riser and the shader would paint the gauge onto it instead of leaving it grey.
    // (4 corner contacts were declined: they'd sit against the tagged perimeter and bleed.)
    const uMin = Math.min(uColLo, uColHi), uMax = Math.max(uColLo, uColHi), uc = (uMin + uMax) / 2;
    const FR = 4, CT_HW = 7, CT_H = 8, GAPHW = 4; // frame width; contact half-width; height; half-gap
    const gaugeOpt = (tag) => ({ ...conduit, kind: "net-battery", wall: BUS_HOUSING, floor: BATT_H, ceiling: HALL_CEIL, floorFlat: groundFlatName, ceilingFlat: ceilingFlatName, light: 176, lineTag: tag });
    const topOpt = { ...conduit, kind: "net-battery", wall: BUS_HOUSING, floor: BATT_H, ceiling: HALL_CEIL, floorFlat: groundFlatName, ceilingFlat: ceilingFlatName, light: 176 };
    const nubOpt = { ...conduit, kind: "net-instrument", wall: BUS_HOUSING, floor: BATT_H + CT_H, ceiling: HALL_CEIL, floorFlat: groundFlatName, ceilingFlat: ceilingFlatName, light: 210 };
    vcols.forEach((vcb, k) => {
      const id = `batt-col-${side}-${k}`, tag = BATT_LINE_TAG + k, vLo = vcb - BATT_HW, vHi = vcb + BATT_HW;
      // Four gauge FRAME strips (the perimeter faces the charge gauge renders on).
      areaRect(direction, `${id}-fr-s`, uv(uMin, uMax, vLo, vLo + FR), gaugeOpt(tag));
      areaRect(direction, `${id}-fr-n`, uv(uMin, uMax, vHi - FR, vHi), gaugeOpt(tag));
      areaRect(direction, `${id}-fr-w`, uv(uMin, uMin + FR, vLo + FR, vHi - FR), gaugeOpt(tag));
      areaRect(direction, `${id}-fr-e`, uv(uMax - FR, uMax, vLo + FR, vHi - FR), gaugeOpt(tag));
      // Untagged interior floor flanking the central contact column (u).
      areaRect(direction, `${id}-in-w`, uv(uMin + FR, uc - CT_HW, vLo + FR, vHi - FR), topOpt);
      areaRect(direction, `${id}-in-e`, uv(uc + CT_HW, uMax - FR, vLo + FR, vHi - FR), topOpt);
      // Central column (v): floor, contact 0, gap, contact 1, floor -- all untagged interior + 2 nubs.
      areaRect(direction, `${id}-c-s`, uv(uc - CT_HW, uc + CT_HW, vLo + FR, vcb - GAPHW - 2 * CT_HW), topOpt);
      areaRect(direction, `${id}-nub0`, uv(uc - CT_HW, uc + CT_HW, vcb - GAPHW - 2 * CT_HW, vcb - GAPHW), nubOpt);
      areaRect(direction, `${id}-c-gap`, uv(uc - CT_HW, uc + CT_HW, vcb - GAPHW, vcb + GAPHW), topOpt);
      areaRect(direction, `${id}-nub1`, uv(uc - CT_HW, uc + CT_HW, vcb + GAPHW, vcb + GAPHW + 2 * CT_HW), nubOpt);
      areaRect(direction, `${id}-c-n`, uv(uc - CT_HW, uc + CT_HW, vcb + GAPHW + 2 * CT_HW, vHi - FR), topOpt);
    });
    // The send-q terminal on the deep wall, centred behind the two columns.
    areaRect(direction, `batt-${side}-term`, uv(sgn * (ALCHW + ALC_RECESS), uDeep, vc - terminalTextureSize.width / 2, vc + terminalTextureSize.width / 2), {
      ...conduit, kind: "terminal",
      floor: F0 + terminalPanelFloor,
      ceiling: F0 + terminalPanelFloor + terminalTextureSize.height,
      light: 184,
      labelSide: side === "left" ? leftWall : rightWall,
      labelTexture: sc.texture,
      controlPanel: true,
      riserWall: BUS_HOUSING,
    });
  };
  // ===== Kernel-TX QDISC BAY (level 1, RIGHT/TX catwalk): a SUNKEN, RAILED disc-pit
  // mirroring the coil bay's u-footprint on the +u side. The bay floor is an F1 frame the
  // player walks (front margin + back margin + a deep walkway along the terminal wall); the
  // centre is a `blockEdge` pit sunk QD_PIT_DROP below F1, so the player looks DOWN into it
  // over the rail (the vantage fix for floor-disc foreshortening) but cannot fall in. Three
  // pit sub-sectors tile it along v: inflow line (upstream) | occupancy disc | outflow line
  // (downstream), each a dark base flat carrying its floor-display sentinel light. The KTXT
  // terminal sits on the deep wall (tc -s qdisc readout); the QDISC placard on the front end
  // wall names the gauge. [[terminal-design-principles]] [[wall-label-centering-width]]
  const qdiscBay = (side) => {
    const lvl = levels[1];
    const sgn = side === "left" ? -1 : 1;      // "right" here (kernel-TX), kept general
    const vc = QD_VC;
    const bv1 = vc - BAY_HW, bv2 = vc + BAY_HW; // fixed 512-wide alcove window (plain catwalk outside)
    const uOpen = sgn * EDGEHW;                 // 320: catwalk-side opening (bay mouth)
    const uNear = sgn * QD_PIT_U1;              // 384: pit near edge / near-walkway rail
    const uFar = sgn * QD_PIT_U2;               // 528: pit far edge / deep-walkway rail
    const uDeep = sgn * QD_DEEP;                // 600: deep wall (terminal) -- deeper than other bays
    const inflowV1 = vc - QD_DISC_R - QD_FLOW_LEN; // 2520
    const discV1 = vc - QD_DISC_R;             // 2616
    const discV2 = vc + QD_DISC_R;             // 2760
    const outflowV2 = vc + QD_DISC_R + QD_FLOW_LEN; // 2856
    // Walkable F1 frame RINGING the pit on all four sides: full-width front + back margins,
    // a NEAR walkway inset from the catwalk, and a DEEP walkway in front of the terminal --
    // one continuous floor the player can circle the display on. (No rail at the catwalk mouth
    // now: the pit is inset, so u=320 is an open F1->F1 step-in across the whole bay width.)
    const frameOpt = { ...intake, kind: "net-alcove", floor: F1, ceiling: HALL_CEIL, light: 150 };
    areaRect(direction, "qdisc-front", uv(uOpen, uDeep, bv1, inflowV1), frameOpt);
    areaRect(direction, "qdisc-back", uv(uOpen, uDeep, outflowV2, bv2), frameOpt);
    areaRect(direction, "qdisc-nearwalk", uv(uOpen, uNear, inflowV1, outflowV2), frameOpt);
    areaRect(direction, "qdisc-deepwalk", uv(uFar, uDeep, inflowV1, outflowV2), frameOpt);
    // Sunken, RAILED display pit (blockEdge): dark ground flat so the FULLBRIGHT disc/pulses
    // pop against it. Three sub-sectors along v carry the two display sentinels.
    const pitBase = { ...conduit, kind: "net-alcove", floor: F1 - QD_PIT_DROP, ceiling: HALL_CEIL, floorFlat: groundFlatName, blockEdge: true };
    areaRect(direction, "qdisc-inflow", uv(uNear, uFar, inflowV1, discV1), { ...pitBase, light: QD_FLOW_LIGHT, tag: QD_INFLOW_TAG });
    areaRect(direction, "qdisc-disc", uv(uNear, uFar, discV1, discV2), { ...pitBase, light: QD_DISC_LIGHT, tag: QD_DISC_TAG });
    areaRect(direction, "qdisc-outflow", uv(uNear, uFar, discV2, outflowV2), { ...pitBase, light: QD_FLOW_LIGHT, tag: QD_OUTFLOW_TAG });
    // KTXT terminal on the deep wall (control-panel recess), centred on vc.
    areaRect(direction, "qdisc-term", uv(sgn * (QD_DEEP + ALC_RECESS), uDeep, vc - terminalTextureSize.width / 2, vc + terminalTextureSize.width / 2), {
      ...conduit, kind: "terminal",
      floor: F1 + terminalPanelFloor,
      ceiling: F1 + terminalPanelFloor + terminalTextureSize.height,
      light: 184,
      labelSide: side === "left" ? leftWall : rightWall,
      labelTexture: kernelTxScreen.texture,
      controlPanel: true,
      riserWall: BUS_HOUSING,
    });
    // "QDISC DEPTH" placard on the bay's FRONT end wall (low v), swapped to "QDISC UNKNOWN"
    // by DoomPerf_UpdateNetQdiscCap when tc's backlog is unreadable (mirrors coil-label-squeeze).
    areaRect(direction, "qdisc-placard", uv(uOpen, uDeep, bv1 - ALC_RECESS, bv1), {
      ...hall, kind: "net-sign", floor: F1, ceiling: F1 + wallSignSize.height, light: 200,
      labelSide: frontWall, labelTexture: qdiscPlacards.depth.texture, labelWidth: SIGN_W,
    });
  };
  // Level 1 RIGHT (kernel-TX) = the qdisc disc bay; level 0 = recv CAPACITOR bay (left) +
  // send BATTERY cell-columns (right); level 2 = ring turbine (RX) / dynamo (TX) instrument bays.
  stations.filter((st) => st.level === 1).forEach((st) => qdiscBay(st.side));
  stations.filter((st) => st.level === 0 && st.side === "left").forEach((st) => socketCapBay(st.side, 0, st.screen));
  stations.filter((st) => st.level === 0 && st.side === "right").forEach((st) => batteryBay(st.side, st.screen));
  stations.filter((st) => st.level === 2).forEach((st) => ringInstrumentBay(st.side, st.side === "left" ? 0 : 1, st.side === "left" ? TURB_EDNUM : DYN_EDNUM, st.screen));

  // ===== Kernel-RX softnet TESLA-COIL BAY off the kernel stage's LEFT (RX) catwalk. The
  // combined kernel-RX bus bed reads "receive is hot"; this bay DECOMPOSES that into its
  // two real /proc/net/softnet_stat causes -- NAPI time_squeeze vs per-CPU BACKLOG DROP --
  // as two upright ELECTRODES that crackle blue lightning around their tips, denser under
  // load (MT_DP_NETARC bolts spawned in p_tick.c; electrode world coords mirrored there,
  // RING_PITCH discipline). The rods are physical geometry; the labels sit on the deep wall.
  // The walk floor is TILED around the two rod footprints (the builder forbids overlaps).
  const ROD_U1 = -414, ROD_U2 = -386, RHW = 14; // electrode footprint: thin (28) rod
  const coilVc = Math.round((levels[1].sv1 + levels[1].cv2) / 2); // 2592: kernel stage v-midpoint
  const coilBv1 = coilVc - BAY_HW, coilBv2 = coilVc + BAY_HW;      // fixed 512-wide alcove window
  const rodV = [coilVc - 128, coilVc + 128];     // squeeze / drop electrode v-centres (coilVc +/-128; = -coil_x in p_tick.c)
  const ROD_TOP = F1 + 120;                      // tip height = 24 map units (== p_tick COIL_TOPZ)
  // Bay floor/walls off `intake` (base COMPTILE wall) so the walls flanking the softnet console
  // match the other five stage bays (all built from `intake`); only the electrode rods keep the
  // conductor accent below. (Was `conduit`/SILVER1, which made this bay the odd one out.)
  const bayMat = { ...intake, kind: "net-alcove", floor: F1, ceiling: HALL_CEIL, light: 150 };
  areaRect(direction, "coil-bay-deep", { u1: -ALCHW, v1: coilBv1, u2: ROD_U1, v2: coilBv2 }, bayMat);
  areaRect(direction, "coil-bay-front", { u1: ROD_U2, v1: coilBv1, u2: -EDGEHW, v2: coilBv2 }, bayMat);
  [
    [coilBv1, rodV[0] - RHW],
    [rodV[0] + RHW, rodV[1] - RHW],
    [rodV[1] + RHW, coilBv2],
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
  const coilTermVC = (rodV[0] + rodV[1]) / 2; // 2592 (== coilVc), between the rods
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
  areaRect(direction, "coil-label-squeeze", { u1: -ALCHW, v1: coilBv1 - ALC_RECESS, u2: -EDGEHW, v2: coilBv1 }, {
    ...hall, kind: "net-sign", floor: F1, ceiling: F1 + wallSignSize.height, light: 200,
    labelSide: frontWall, labelTexture: coilWallLabels[0].texture, labelWidth: SIGN_W,
  });
  areaRect(direction, "coil-label-backlog", { u1: -ALCHW, v1: coilBv2, u2: -EDGEHW, v2: coilBv2 + ALC_RECESS }, {
    ...hall, kind: "net-sign", floor: F1, ceiling: F1 + wallSignSize.height, light: 200,
    labelSide: backWall, labelTexture: coilWallLabels[1].texture, labelWidth: SIGN_W,
  });

  // ===== Switchyard head = a tube-tunnel STATION (the wire beyond the host). The hall opens onto a
  // massive tunnel: raised PLATFORMS either side of a sunken TRACK BED that runs the two packet
  // lanes head-on through a stepped ARCH into a long dark receding BORE. TX orbs stream into the
  // bore and shrink into the black; RX orbs emerge from it. The player is railed off the track bed
  // (blockEdge -- looks down the tunnel, can't walk in); the NOCLIP orbs ride through. Constants at
  // module scope (BED_Z / BEDHW / archCols / boreRings). The sar -n DEV terminal moved to the entry
  // box, so this back wall is free for the portal (no read-point here). [[network-trackside-signals]]
  // The OUTSIDE of the tunnel (the headwall around the mouth + the station platform walls) wears
  // the wing's SILVER1 accent -- the same brushed-metal wall that flanks the softnet_stat console
  // in the coil bay -- NOT the dark cast-iron liner (that's kept for the tunnel INTERIOR only). The
  // spandrel above the arch is an upper texture drawn by the higher-ceiling sector (the track bed),
  // so the bed also wears the accent; the arch jambs + bore stay on the liner (darkMat).
  const PORTAL_WALL = accent.wall; // SILVER1: matches the walls either side of the softnet terminal
  const platMat = { ...hall, kind: "net-plaza", ceiling: HALL_CEIL, wall: PORTAL_WALL, floor: F2, light: 156 };
  const darkMat = { ...conduit, kind: "net-tunnel", wall: TUNNEL_WALL, floor: BED_Z, floorFlat: groundFlatName, ceilingFlat: groundFlatName };
  // Raised station PLATFORMS flanking the track bed (continue the ring catwalks at F2).
  areaRect(direction, "tunnel-plat-l", { u1: -EDGEHW, v1: V_L2END, u2: -BEDHW, v2: V_PORTAL }, platMat);
  areaRect(direction, "tunnel-plat-r", { u1: BEDHW, v1: V_L2END, u2: EDGEHW, v2: V_PORTAL }, platMat);
  // Sunken TRACK BED between the platforms: blockEdge (look down over the platform lip, can't step
  // in; the NOCLIP orbs ride through). Dark ballast floor, open to the room ceiling; its lip wears
  // the steel bus housing so it reads as a raised platform edge. `wall` is the OUTSIDE accent so the
  // spandrel above the arch mouth reads as headwall, not tunnel interior.
  areaRect(direction, "tunnel-bed", { u1: -BEDHW, v1: V_L2END, u2: BEDHW, v2: V_PORTAL }, {
    ...hall, kind: "net-plaza", floor: BED_Z, ceiling: HALL_CEIL, light: 132,
    floorFlat: groundFlatName, wall: PORTAL_WALL, riserWall: BUS_HOUSING, blockEdge: true,
  });
  // Stepped horseshoe ARCH cut into the headwall at the portal (raised-centre ceiling profile).
  archCols.forEach((c, k) => {
    areaRect(direction, `tunnel-arch${k}`, { u1: c.u1, v1: V_PORTAL, u2: c.u2, v2: V_ARCH }, {
      ...darkMat, ceiling: c.ceil, light: 96,
    });
  });
  // Receding BORE: narrower + lower + darker in three steps -> a vanishing tube the orbs fade into.
  boreRings.forEach((r) => {
    areaRect(direction, `tunnel-${r.id}`, { u1: -r.hw, v1: r.v1, u2: r.hw, v2: r.v2 }, {
      ...darkMat, ceiling: r.ceil, light: r.light,
    });
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
  // Tesla-electrode side-wall labels + the kernel-TX qdisc placard variants, two-line wall signs.
  ...[...coilWallLabels, qdiscPlacards.depth, qdiscPlacards.unknown].map((s) => ({
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
  // Train-tunnel cast-iron liner wall (the switchyard-head tube tunnel).
  { texture: TUNNEL_WALL, patch: tex("PTUN"), width: 128, height: 128, build: () => buildTunnelLinerPatch() },
];

const flats = [
  ...stations.flatMap((st) => [...st.insA.flats, ...st.insB.flats]),
  ...connLabel.flats,
  ...trafLabel.flats,
  ...busFlats,
  buildCeilingFlat(),
  buildCrossFlat(),
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
  // Socket-lock capacitor charge effect (MT_DP_NETCAP): D/E rising charge motes, F flashover.
  // Travelling-bus-current bead (round electric-blue mote, MT_DP_NETCAP D/E) + the authored
  // capacitor-tower prop (SPR_COLU frame A, MT_DP_NETCAPTWR).
  { name: "BFE1D0", build: () => buildFxPatch({ size: 14, ramp: capMoteRamp, outerFrac: 0.85 }) },
  { name: "BFE1E0", build: () => buildFxPatch({ size: 12, ramp: capMoteFlash, outerFrac: 0.8 }) },
  { name: "COL2A0", build: () => buildCapTowerSprite() },
  // Ring-buffer (L2) instrument props: turbine wheel (RX), dynamo drum (TX). Authored over UNUSED
  // single-frame IWAD decorations -- NOT ones whose stock thing the map places (SMIT=47, SMT2 are
  // never placed; ELEC=48 and COLU=2028 ARE, so overriding them leaks into the hub / other wings).
  // (The send-q battery is 3D geometry + a wall shader now, not a billboard sprite.)
  { name: "SMITA0", build: () => buildTurbineSprite() },
  { name: "SMT2A0", build: () => buildDynamoSprite() },
];

const terminals = ({ terminalHalfWidth }) => {
  const segment = ([au, av], [bu, bv]) => {
    const [ax, ay] = rotatePoint([au, av], "west");
    const [bx, by] = rotatePoint([bu, bv], "west");
    return { ax, ay, bx, by };
  };
  const deep = -(ALCHW + ALC_RECESS);
  // Every stage console reads from its bay's DEEP wall (u = +/-(ALCHW+ALC_RECESS)), on the
  // RX (u<0) or TX (u>0) side, centred on the station's vc: level 0 socket capacitor/battery
  // banks, level 1 the kernel-TX qdisc pit, level 2 the ring bays (kernel-RX = softnet console).
  const stationTerminals = stations.map((st) => {
    const lvl = levels[st.level];
    const vc = Math.round((lvl.sv1 + lvl.cv2) / 2);
    // Every station reads from its bay's DEEP wall: level 0 socket + level 2 ring bays from
    // ALCHW; level 1's kernel-TX qdisc pit is a DEEPER bay, so it reads from QD_DEEP.
    const wall = (st.level === 1 ? QD_DEEP : ALCHW) + ALC_RECESS;
    const u = st.side === "left" ? -wall : wall;
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
      // (the rods' midpoint = kernel stage vc +/- 96; matches the coil-terminal sector).
      sign: "network-softnet",
      segments: (() => {
        const kvc = Math.round((levels[1].sv1 + levels[1].cv2) / 2);
        return [segment([deep, kvc - 96], [deep, kvc + 96])];
      })(),
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
