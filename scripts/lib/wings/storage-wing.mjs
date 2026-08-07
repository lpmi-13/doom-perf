// Storage wing (south): a steampunk I/O tower, a TRUE FLAT-TOP DECAGON. A central
// solid round DRUM (the spindle) is ringed by a flush round PLATTER floor (the
// utilization disk), all wrapped by a ten-sided RING OF CLIMBING STEPS that
// spirals one loop up to the platter summit. FIVE instrument halls branch off the
// ring, each on its own face, with a blank face between neighbours:
//
//   drum        a solid round pillar at the centre, 256u tall; its lower faces
//               carry the vertical %util fill + throughput streaks over the FULL
//               height (line tag 664, R_DoomPerfDiskSpindlePixel, DPDSPIN 256-tall
//               base wall). centred on world (0,-1197).
//   platter     a ring of trapezoids around the drum forming a flush round disk
//               floor (utilization display, light sentinel 130, drawn FULLBRIGHT).
//               R_DoomPerfDiskPlatterPixel (patch 0035) fills a round heat-pool;
//               anything beyond R returns background. Open to the summit sky (no
//               cover); the full-height streaked spindle is what the vortex orbs
//               spiral up against and back down.
//   step ring   TEN trapezoidal steps (decagonal annulus outside the platter rim)
//               rising 24u per face CCW from the near (entrance) face up to the
//               summit, where the climb mounts the raised platter dais.
//   AWAIT hall  off step face 2 (right): a bank of latency gauges (one-sided MID
//               walls, line tags 660/661/662).
//   THROUGHPUT  off the FAR (axis-aligned) step face 4 -- occluded from the
//     hall      entrance by the central drum, so no long smeary sightline:
//               pneumatic tubes + IO RATE plaque + iostat dashboard (line tag 663)
//               + iostat terminal at the dead end.
//   QUEUE hall  off step face 7 (lower-left) via a squared (axis-aligned) chamber.
//               Now a plain alcove: the queue-depth trough it used to hold is
//               retired -- queue depth rides the request circuit's spawn
//               burstiness now, not a floor readout.
//   CISTERN     off step face 1 (lower-right, squared chamber): the disk-usage
//     hall      instrument -- a circular SUNBURST display on the back wall that fills
//               with `df /` usage (line tag 665, R_DoomPerfDiskDonutPixel); the df
//               read-point overlay is aimed at it.
//   RAIN GAUGE  off step face 6 (upper-left, squared chamber): a row of FIVE
//     hall      free-standing per-device light-tube gauges (sector tags 630..634),
//               one per busiest block device. Each is a raised glowing pedestal
//               under a bright downlight with a column of RAIN falling through it --
//               fall SPEED = the device's ops/s, density + beam brightness = its
//               %util (DoomPerf_UpdateDiskRain streams MT_DP_DISKRAIN drops). An
//               iostat -x read-point terminal rides the back wall.
//
// Why TEN sides and not six: RISE (24) is Doom's maximum auto-climb, so steps
// cannot be made taller -- tower height comes ONLY from more of them, which makes
// "rounder" and "taller" the same lever. Ten faces at R_STEP 518 are 320 wide
// (every hall needs 224..320, so each still fits on one face) and lift the summit
// from 144 to 240, giving the request circuit a climb worth watching and the head
// room above the platter for the orbs' inward vortex around the full-height spindle.
//
// Await (wait time) and queue depth (size) are deliberately SEPARATE instruments in
// SEPARATE halls; the cistern (capacity) and IOPS bank (operations) are the two new
// stations. Every read-point terminal (iostat / df / iostat -x) is a proper
// simulated screen with the server-details control panel below it (controlPanel).
//
// Why a polygonal spiral: like the old square spiral it has no long receding
// sightline (every view dead-ends on a near wall), killing the 320x200 far-wall
// smear by topology -- but the angled 144-degree joints read as a rotunda, not a
// box, and the tower is far wider. See [[disk-spiral-smear-fix]],
// [[builder-full-switch-polygon-bsp]], [[map-builder-architecture]],
// [[telemetry-terminal-seam]], [[wing-terminal-segment-rotation]].
//
// Live-instrument contracts preserved: platter = flush round ring floor, light 130
// + drum centre world (0,-1197) (R_DoomPerfDiskPlatterPixel, patch 0035 -- its
// DOOMPERF_PLATTER_CY must track CV below); spindle drum line tag 664 (texture-
// space, works on angled faces); await gauges = one-sided MID walls, line tags
// 660/661/662 + wall:gauge (NO labelSide, or lineTagFor zeroes the tag);
// dashboard = line tag 663 on a two-sided LOWER texture. The iostat terminal
// read-point is emitted by terminals() in WORLD coords.
import { addWingEntrance } from "./common.mjs";
import { reserved, wingName } from "./registry.mjs";
import {
  terminalTextureSize,
  wallSignSize,
  serverRackTextureSize,
  storageDisplayTextureSize,
  buildTerminalPatch,
  buildWallSignPatch,
  buildServerRackPatch,
  buildStorageDisplayPatch,
  makeInscription,
  buildShadedOrbPatch,
  buildFxPatch,
  drawCenteredText,
} from "../textures.mjs";
import { buildPatch } from "../wad-bytes.mjs";

const ids = reserved.storage;
const tex = (suffix) => wingName("storage", suffix);

// labelSide / textureSide are stored in WORLD-frame sides; the wing thinks in
// local (u,v) sides and converts. (South is a 180-degree rotation: local "top"
// (+v, the deep/far side) -> world "bottom", local "right" (+u) -> world "left".)
const localSideToWorld = (direction, side) => {
  const turns = { north: 0, east: 1, south: 2, west: 3 }[direction];
  const sides = ["top", "right", "bottom", "left"];
  const index = sides.indexOf(side);
  if (turns === undefined || index === -1) {
    throw new Error(`Cannot rotate side ${side} for direction ${direction}`);
  }
  return sides[(index + turns) % sides.length];
};

// Custom WAD art, all under the reserved "DPD" prefix so it can't collide with
// the other wings' names.
const screen = { texture: tex("TERM"), patch: tex("PTRM"), lines: ["DISK IO", "SERVICE"] };
// Two more read-point screens, one per new instrument hall (cistern / IOPS bank).
// Each is a CPU-wing-style simulated terminal (buildTerminalPatch) so it reads as
// a computer screen with the server-details control panel below it, like the rest.
const usageScreen = { texture: tex("UTRM"), patch: tex("PUTM"), lines: ["DISK USAGE", "DF ROOT"] };
const iopsScreen = { texture: tex("ITRM"), patch: tex("PITM"), lines: ["DEVICE IOPS", "IOSTAT X"] };
const queueScreen = { texture: tex("QTRM"), patch: tex("PQTM"), lines: ["DISK QUEUE", "DEV / SCHED"] };
// Latency-causeway read-point: `iostat -x` narrowed to the await columns.
const awaitScreen = { texture: tex("ATRM"), patch: tex("PATM"), lines: ["DISK LATENCY", "R / W AWAIT"] };
// Latency-causeway PISTON base: the lane-facing lower face of each solid metal
// cylinder. The piston wall shader (R_DoomPerfPistonPixel, line tags 666/667) paints
// a silver round cross-section + scrolling ridge lines over it, so this base is a
// plain fill -- only its 128 height matters (maps the 128-tall column face 1:1).
const pistonBase = { texture: tex("PIST"), patch: tex("PPIST") };
const pistonBaseSize = { width: 64, height: 128 };
const buildPistonBasePatch = () => {
  const px = new Uint8Array(pistonBaseSize.width * pistonBaseSize.height);
  px.fill(84); // silver fallback; the shader overrides every pixel
  return buildPatch(px, pistonBaseSize.width, pistonBaseSize.height);
};
// A ONE-tall placard for the OUTER wall behind each IO-queue shaft, naming its tier
// and tinted to its plate colour (amber = device rack, red = scheduler magazine) so
// the two stacks are unambiguous. It reads "DEVICE / QUEUE" and "SCHEDULER / QUEUE"
// (two stacked words -- the 146u-wide wall is too narrow for one line at a legible
// size). CRUCIAL: 128 tall, and it hangs on a 128-tall SOFFIT wall, because vanilla
// R_DrawColumn masks the texture Y with `& 127` -- a taller wall shows only the top
// 128 rows, tiled, so a 256-tall placard doubled the top word and dropped "QUEUE".
// Only the central ~146px shows on the 146u wall, so border + text sit inside
// [55..201] (labelWidth 256 centres the placard across the wall).
const queueLabelSize = { width: 256, height: 128 };
const buildQueueLabelPatch = (lines, color, scale) => {
  const { width: W, height: H } = queueLabelSize;
  const px = new Uint8Array(W * H); // black placard (fill 0)
  const L = 58;
  const R = 198;
  const T = 8;
  const B = 120;
  const hline = (y) => {
    for (let x = L; x <= R; x += 1) px[y * W + x] = color;
  };
  const vline = (x) => {
    for (let y = T; y <= B; y += 1) px[y * W + x] = color;
  };
  for (let t = 0; t < 3; t += 1) {
    hline(T + t);
    hline(B - t);
    vline(L + t);
    vline(R - t);
  }
  // Two words stacked at ONE shared scale (`scale` = the largest at which the longer
  // word fits) so the placard reads as a balanced pair. The wall is top-pegged (a
  // one-sided 128-tall soffit wall), so line[0] is the upper word.
  drawCenteredText(px, W, H, lines[0], 30, scale, color, L + 10, R - 10);
  drawCenteredText(px, W, H, lines[1], 72, scale, color, L + 10, R - 10);
  return buildPatch(px, W, H);
};
const deviceLabel = { texture: tex("QLDEV"), patch: tex("PQLDV"), lines: ["DEVICE", "QUEUE"], color: 231, scale: 3 };
const schedLabel = { texture: tex("QLSCH"), patch: tex("PQLSC"), lines: ["SCHEDULER", "QUEUE"], color: 176, scale: 2 };
// Latency-causeway lane placards (two stacked words each, gold like the wing).
const readAwaitLabel = { texture: tex("LRAWT"), patch: tex("PLRAW"), lines: ["READ", "AWAIT"], color: 231, scale: 3 };
const writeAwaitLabel = { texture: tex("LWAWT"), patch: tex("PLWAW"), lines: ["WRITE", "AWAIT"], color: 231, scale: 3 };
// Placards naming the two instrument halls that otherwise carry only a display +
// read-point (the queue/latency halls already name themselves on their walls): the
// disk-usage CISTERN ("DISK / USAGE") and the per-device RAIN-GAUGE bank ("IOPS /
// BY DEVICE"). Same two-stacked-word placard, gold like the rest of the wing. Each
// rides a dedicated 256-wide, 128-tall label bay (cist-label / iops-label) so the
// 256 placard maps once, centred.
const usageLabel = { texture: tex("USG"), patch: tex("PUSG"), lines: ["DISK", "USAGE"], color: 231, scale: 3 };
const iopsLabel = { texture: tex("IOPD"), patch: tex("PIOPD"), lines: ["IOPS", "BY DEVICE"], color: 231, scale: 2 };
const signs = {
  read: { texture: tex("READ"), patch: tex("PRD"), text: "READ" },
  write: { texture: tex("WRITE"), patch: tex("PWR"), text: "WRITE" },
  rate: { texture: tex("RATE"), patch: tex("PRAT"), text: "IO RATE" },
};
// Disk-usage SUNBURST base wall (the cistern's +u side-wall display). A dark round
// screen with a glowing electric-blue bezel; the engine shader (line tag 665,
// R_DoomPerfDiskDonutPixel) overrides every pixel INSIDE the circle it draws,
// falling back to this base only in the dark corners outside the disc. 256 square (a
// power of two, so a >128-wide/tall face doesn't tile it): the display face is 160x160
// (floor-to-ceiling), which samples the top-left 160x160 of this texture. The engine
// masks tx/ty with &255 (see R_DrawColumn display 32) so the full 160 maps without
// wrapping.
const discTex = { texture: tex("DISC"), patch: tex("PDSC") };
const DISC_FACE = 160; // the display face is 160x160 (fills the 160-tall side wall)
const discTexSize = { width: 256, height: 256 };
const tubeRead = { texture: tex("RTUB"), patch: tex("PRTU") };
const tubeWrite = { texture: tex("WTUB"), patch: tex("PWTU") };
const rack = { texture: tex("RACK"), patch: tex("PRCK") };
const display = { texture: tex("DASH"), patch: tex("PDSH") };
// Spindle drum base wall: a 256-tall texture so the engine's util-fill + streak
// shader (R_DoomPerfDiskSpindlePixel, line tag 664) spans the FULL drum height in
// one piece. The shader overrides every pixel of this wall, so the base art is
// never seen -- it only needs to EXIST at height 256 so the column's texture
// coordinate wraps at 256 (a 128-tall texture would tile the fill twice). 128 wide
// to keep the streak-column density that METAL1 gave the old 128-tall drum.
const spindleTex = { texture: tex("SPIN"), patch: tex("PSPN") };
const spindleTexSize = { width: 128, height: 256 };

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

// Spindle drum base patch: a plain dark-metal fill at 128x256. The engine shader
// overrides every pixel of this wall (line tag 664), so the exact art never shows
// in game; it exists only to give the drum wall a 256-tall texture so the util
// fill spans the whole drum without tiling. Kept a muted brushed grey so that if
// the shader ever fails to bind, the drum still reads as metal rather than HOM.
const buildSpindlePatch = () => {
  const { width: W, height: H } = spindleTexSize;
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    // Doom grey ramp ~5(dark)..111; a soft vertical brushing plus faint bands.
    const band = 100 - ((y % 32) < 2 ? 8 : 0);
    for (let x = 0; x < W; x += 1) {
      const brush = ((x * 7) ^ (y * 3)) & 7;
      px[y * W + x] = Math.max(96, band - brush);
    }
  }
  return buildPatch(px, W, H);
};

// Disk-usage SUNBURST base patch: a near-black display panel with a thin glowing
// electric-blue bezel, 256x256 but only the top-left DISC_FACE (160x160) is ever seen
// (the 160-tall side wall samples texel rows/cols 0..159). The engine shader (line tag
// 665) paints the circular sunburst over this; the base only shows in the dark corners
// outside the disc, so the bezel reads as a monitor frame. Fullbright in-engine (drawn
// via colormaps[]), so the blue bezel glows even in the dim hall.
const buildDiscPatch = () => {
  const { width: W, height: H } = discTexSize;
  const px = new Uint8Array(W * H).fill(5); // near-black screen
  const bezel = 196; // electric blue
  const F = DISC_FACE; // frame the 160x160 visible region (top-left of the texture)
  for (let t = 0; t < 2; t += 1) {
    for (let x = 0; x < F; x += 1) {
      px[t * W + x] = bezel;
      px[(F - 1 - t) * W + x] = bezel;
    }
    for (let y = 0; y < F; y += 1) {
      px[y * W + t] = bezel;
      px[y * W + (F - 1 - t)] = bezel;
    }
  }
  return buildPatch(px, W, H);
};

// "IO VAULT" inscription flats, generated for the entry threshold (placed below).
const ioInscription = makeInscription("DPDIO", "IO VAULT", "south", 4);

// ===== Flat-top decagon geometry (local u,v) =====
// All three concentric decagons share the platter centre (0, CV) -> world
// (0,-1197); patch 0035's DOOMPERF_PLATTER_CY tracks it. Each ring is flat-top:
// horizontal NEAR (face 9, the entrance) and FAR (face 4, throughput) faces are
// axis-aligned, with eight angled faces between. Radii are circumradii.
// Platter centre sits far enough out that the step ring's near face still meets
// the entrance throat at v=704: a decagon's inradius is R*cos(18deg) = 0.951R,
// not a hexagon's 0.866R, so widening the ring from six sides to ten pushed the
// centre 1153 -> 1197. The disk + deck keep their own size.
const CV = 1197;
const N_SIDES = 10;
const R_DRUM = 100;
const R_PLATTER = 200;
// Summit rim around the round disk. 312 is chosen so that after rounding to
// integers EVERY decagon edge vector divides by DECK_SUBDIV -- see deckOuterPts.
const R_DECK = 312;
const R_STEP = 518; // step ring; 320-wide faces, near face at v=704
const INRADIUS = (R) => Math.round(R * Math.cos(Math.PI / N_SIDES));
const FAR_V = CV + INRADIUS(R_STEP); // 1690: far face v (== throughput mouth)

// CCW from V0 (near-right corner). Vertex k sits at (-90 + 180/n + k*360/n)
// degrees, which puts an edge midpoint dead on -90 (near) and +90 (far), so the
// entrance and throughput faces are axis-aligned. Face i spans vertex i -> i+1.
const ringVerts = (R) =>
  Array.from({ length: N_SIDES }, (_, k) => {
    const theta = ((-90 + 180 / N_SIDES + (k * 360) / N_SIDES) * Math.PI) / 180;
    return [Math.round(R * Math.cos(theta)), CV + Math.round(R * Math.sin(theta))];
  });
const deckRing = ringVerts(R_DECK);
const stepRing = ringVerts(R_STEP);

// addPoly wants a CLOCKWISE loop (interior on the right). A solid loop is the CCW
// vertex list reversed; a ring trapezoid for slice i is [innerI, innerJ, outerJ,
// outerI] (verified clockwise for this orientation), with the modulo taken from
// the inner ring's length so the same helper serves the 10-face step rings and the
// 30-ray round rings.
const solid = (loop) => loop.slice().reverse();
const ringTrap = (inner, outer, i) => {
  const j = (i + 1) % inner.length;
  return [inner[i], inner[j], outer[j], outer[i]];
};

// The drum (round spindle) and disk (round platter floor) are 30-gons; the deck
// is a round-inner -> decagonal-outer ring framing the disk inside the summit.
// The 30 rays are the angles of the THIRD-points walked along the deck decagon's
// edges -- those points must land EXACTLY on integer coords and on the edge, or
// the step ring's long inner edge cannot be T-junction-split against them. That
// is the whole reason R_DECK is 312: it is the only radius near 300 whose rounded
// decagon has every edge vector divisible by 3. (No radius in that range works
// for quarters, which is why the subdivision dropped 4 -> 3 with the side count
// 6 -> 10; the ray total still rose, 24 -> 30, so the disk got rounder.) Drum and
// disk verts sit on concentric circles at those same angles, shared EXACTLY with
// the rings, so no round boundary relies on rounding-sensitive collinear meshing.
const DECK_SUBDIV = 3;
const polarPt = (r, theta) => [Math.round(r * Math.cos(theta)), Math.round(CV + r * Math.sin(theta))];
const deckOuterPts = [];
for (let i = 0; i < N_SIDES; i += 1) {
  const a = deckRing[i];
  const b = deckRing[(i + 1) % N_SIDES];
  for (let q = 0; q < DECK_SUBDIV; q += 1) {
    const u = a[0] + ((b[0] - a[0]) * q) / DECK_SUBDIV;
    const v = a[1] + ((b[1] - a[1]) * q) / DECK_SUBDIV;
    if (!Number.isInteger(u) || !Number.isInteger(v)) {
      throw new Error(`R_DECK ${R_DECK} does not divide by ${DECK_SUBDIV} on edge ${i} (${u},${v})`);
    }
    deckOuterPts.push([u, v]);
  }
}
const rayAngles = deckOuterPts.map(([u, v]) => Math.atan2(v - CV, u));
const drumPts = rayAngles.map((theta) => polarPt(R_DRUM, theta));
const diskPts = rayAngles.map((theta) => polarPt(R_PLATTER, theta));

// Outward (away from the climb) chamber off an outer face edge a->b: a quad
// [a, b, b+o, a+o] where o is the rightward normal of a->b scaled by depth. For a
// step's outer edge authored a=stepRing[i] -> b=stepRing[i+1], "right" points away
// from the centre, so this extrudes the hall outward.
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const unit = (a, b) => {
  const l = len(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
const add = (p, [dx, dy], s) => [Math.round(p[0] + dx * s), Math.round(p[1] + dy * s)];
const extrude = (a, b, depth) => {
  const [ux, uy] = unit(a, b);
  const out = [uy, -ux]; // right normal of a->b
  return [a, b, add(b, out, depth), add(a, out, depth)];
};

// ===== Heights =====
// RISE is Doom's maximum auto-climb, so it CANNOT go up: the tower gets taller
// only by having more faces. Ten of them puts the summit at 240 (was 144 at six)
// and leaves head room above the platter for the circuit's vortex around the
// full-height streaked spindle. The summit is open to sky -- no cover.
const RISE = 24; // Doom max auto-climb; one step per face
const PLATTER_FLOOR = N_SIDES * RISE; // 240: summit, one RISE above the top step
// The spindle is now a FULL-HEIGHT streaked pillar: 256 tall (exact fit to the
// 256-tall DPDSPIN base texture, so the util fill + throughput streaks read once
// from floor to crown instead of tiling). Its top (496) sits above the request
// circuit's vortex apex (an ascending orb tops out at node z=372 + upper-deck 56 =
// 428), so the orbs spiral up and back down against the streaked drum surface --
// the drum itself is the structure they enter/exit. NO cover over the summit: the
// platter and deck are open to sky, so the tower is topless.
const DRUM_FLOOR = PLATTER_FLOOR + 256; // 496: solid spindle, full-height streak wall
const C_TOWER = PLATTER_FLOOR + 160; // 400: solid ceiling over the climb
const C_SKY = PLATTER_FLOOR + 272; // 512: open sky above the platter, clears the taller spindle

// Face index -> that face's step floor. Face i is walked at step k = (i+1)%n, so
// the near face (i = n-1) is the foot (k=0) and the climb runs CCW to the summit.
const stepFloor = (i) => (((i + 1) % N_SIDES) * RISE);

// ===== Throughput hall (off the FAR face 4, floor == that step) =====
// The hall is exactly as wide as the face (2 * 160 = the 320-wide far edge), so
// the whole outer edge of step 4 becomes its mouth.
const TP_FACE = 4;
const TP_FLOOR = stepFloor(TP_FACE); // 120
const TP_HALF = stepRing[TP_FACE][0]; // 160: half the axis-aligned far face
const TP_CEIL = TP_FLOOR + 208; // 328
const TP_PANEL_Z = TP_FLOOR + 128; // 248: top of the 128-tall display band
const TP_BACK = FAR_V + 288; // 1978: dead-end wall (tube-panel decoration)
const SERVER_PANEL_HEIGHT = 64;
const terminalHalfWidthLocal = terminalTextureSize.width / 2; // 128

// Every side hall is an angled throat off one step face that squares up to an
// axis-aligned chamber: recesses on an angled wall round off-line and self-
// overlap, so the instruments themselves all live on integer axis-aligned boxes.
// The five halls sit on faces 1, 2, 4, 6 and 7 -- mirror-symmetric about u=0,
// each with a blank face between it and the next, and none of them adjacent to
// the entrance face (9). Chamber v-extents are derived from their own face so
// they follow the ring if the radii ever move.
const faceSpanV = (i) => {
  const [a, b] = [stepRing[i][1], stepRing[(i + 1) % N_SIDES][1]];
  return { mid: Math.round((a + b) / 2), lo: Math.min(a, b), hi: Math.max(a, b) };
};

// ===== QUEUE hall (off face 7, lower-left): the DISK IO QUEUE two-tier rack =====
// Widened to the FULL face width so a 256-wide read-point screen seats on the back
// (-u) wall; the throat's inner edge already spans the whole face, so matching it
// also removes the old T-junction narrowing at the throat seam.
const QUEUE_FACE = 7;
const QUEUE_FLOOR = stepFloor(QUEUE_FACE); // 192
const queueFace = faceSpanV(QUEUE_FACE); // v 893..1197, mid 1045
const QUEUE_INNER_U = stepRing[QUEUE_FACE][0] - 40; // -558: inner wall of the -u chamber
const queueChamber = { u1: QUEUE_INNER_U - 224, v1: queueFace.lo, u2: QUEUE_INNER_U, v2: queueFace.hi };
const QUEUE_SCREEN_U = queueChamber.u1; // -782: back wall (local -u) carrying the IO QUEUE screen
const QUEUE_SCREEN_CV = queueFace.mid; //  1045: screen centre in v (also the nave centre)

// ===== CISTERN hall (off face 1, lower-right): an angled throat squares up to an
// axis-aligned chamber whose back wall carries a circular SUNBURST disk-usage
// display (df /, line tag 665) inset between two wall flanks. Mirrors the queue
// hall's throat->chamber pattern on the opposite (+u) side. The chamber floor is now
// open (the old central plinth/blue fluid cistern is gone); the sunburst is a
// coarse-grained "percentage full" wheel -- the used fraction fills clockwise from
// the top as a rainbow-ringed sweep, free space stays a dark wedge. =====
const CIST_FACE = 1;
const CIST_FLOOR = stepFloor(CIST_FACE); // 48
const CIST_CEIL = CIST_FLOOR + 160; // 208
const cistFace = faceSpanV(CIST_FACE); // v 893..1197, mid 1045
// Inner wall matches the AWAIT hall's offset (+50) so the two +u throats share an
// identical segment at the stepRing[2] vertex (v=1197) — clean two-sided meshing,
// no collinear split. (The IOPS hall likewise matches the QUEUE hall's -40 on -u.)
const CIST_INNER_U = stepRing[CIST_FACE + 1][0] + 50; // 568: inner (near) wall of the +u chamber
// The df read-point TERMINAL sits centred on the back (+v) wall; the disk-usage
// SUNBURST is on the +u SIDE wall (perpendicular) -- facing the terminal, the player
// turns 90 deg right to face the sunburst. So the chamber keeps its original 320
// width (terminal fits the back wall alone).
const cistChamber = { u1: CIST_INNER_U, v1: cistFace.mid - 132, u2: CIST_INNER_U + 320, v2: cistFace.mid + 132 };
const CIST_TERM_V = cistChamber.v2; // 1177: the chamber's back wall
const CIST_TERM_CX = Math.round((cistChamber.u1 + cistChamber.u2) / 2); // 728
const cistTerm = { u1: CIST_TERM_CX - terminalHalfWidthLocal, v1: CIST_TERM_V - 16, u2: CIST_TERM_CX + terminalHalfWidthLocal, v2: CIST_TERM_V }; // u 600..856
// The disk-usage SUNBURST display: a FULL-HEIGHT solid block inset in the +u SIDE wall
// so the circle runs floor-to-ceiling (block floor == ceiling == CIST_CEIL, so its -u
// lower texture spans the whole 160-tall wall, no cap band). The -u face is DISC_FACE
// (160) wide in v and 160 tall -> a round circle filling the wall. Centred on the
// wall's usable span (between the front wall and the back-wall terminal strip) and
// flanked above/below by solid wall so only that -u face shows it (cist-disc(-f/-b)).
const CIST_DISC_SIZE = DISC_FACE; // 160
const CIST_DISC_DEPTH = 16; // how far the block insets from the +u wall
const CIST_DISC_CV = Math.round((cistChamber.v1 + (CIST_TERM_V - 16)) / 2); // 1037: centre of the usable side wall
const cistDisc = {
  u1: cistChamber.u2 - CIST_DISC_DEPTH, // 872: room-facing (-u) display face
  u2: cistChamber.u2, // 888: the +u wall
  v1: CIST_DISC_CV - CIST_DISC_SIZE / 2, // 957
  v2: CIST_DISC_CV + CIST_DISC_SIZE / 2, // 1117
};

// ===== per-device RAIN GAUGE hall (off face 6, upper-left): a throat squares up to
// a chamber holding a row of FIVE free-standing light-tube gauges (engine sector
// tags 630..634), one per busiest block device, plus an iostat -x read-point
// terminal on the back (+v) wall. Mirror of the cistern hall on the -u side. =====
const IOPS_FACE = 6;
const IOPS_FLOOR = stepFloor(IOPS_FACE); // 168: walkway floor
const IOPS_CEIL = IOPS_FLOOR + 160; // 328
const iopsFace = faceSpanV(IOPS_FACE); // v 1197..1501, mid 1349
const IOPS_INNER_U = stepRing[IOPS_FACE + 1][0] - 40; // -558: inner (near) wall of the -u chamber
// Five gauges in a row. Each gauge footprint is 48x68 (scaled +20% from 40x56, same
// proportions). BETWEEN neighbours sits a very wide 128u walkway (doubled from 64 so
// each rain column stands well clear), with a narrower 40u margin at the two ends. The
// chamber width follows from those, and it is deepened 48 (back/terminal wall pushed
// out by IOPS_BACK_EXTRA); the front (v1) stays on the face. NOTE: the wide gaps make
// this a broad room -- 832 deep on the entry (down-the-row) axis.
const IOPS_TUBE_COUNT = 5;
const IOPS_TUBE_HALF = 24; // gauge half-width (u); 48 wide (+20%)
const IOPS_TUBE_DEPTH = 68; // gauge footprint depth (v); +20% from 56, same proportions
const IOPS_TUBE_GAP = 128; // walkway BETWEEN gauges (doubled from 64)
const IOPS_TUBE_MARGIN = 40; // walkway at the two ends
const IOPS_BACK_EXTRA = 48;
const IOPS_CHAMBER_W =
  2 * IOPS_TUBE_MARGIN + (IOPS_TUBE_COUNT - 1) * (2 * IOPS_TUBE_HALF + IOPS_TUBE_GAP) + 2 * IOPS_TUBE_HALF; // 832
const iopsChamber = { u1: IOPS_INNER_U - IOPS_CHAMBER_W, v1: iopsFace.mid - 132, u2: IOPS_INNER_U, v2: iopsFace.mid + 132 + IOPS_BACK_EXTRA };
// Built left-to-right, centres come out at u = -1326,-1150,-974,-798,-622 -> world x
// 1326,1150,974,798,622 (toWorld negates u), v-band centre held at 1327 -> world y -1327.
// The engine indexes gauges by CENTRE-OUT RANK, not this build order (see iopsRank), so
// DoomPerf_UpdateDiskRain's doomperf_rain_x_u[] lists them rank-ordered:
// {974,1150,798,1326,622}. Those world centres MUST track these (RING_PITCH discipline).
const IOPS_TUBE_V1 = iopsChamber.v1 + 76; // 1293: front of the gauge band (band centred on v=1327)
const IOPS_TUBE_V2 = IOPS_TUBE_V1 + IOPS_TUBE_DEPTH; // 1361: back of the gauge band
// Pedestal top = engine rain floor. A 32-unit step is above Doom's 24 auto-climb, so
// the gauges are un-climbable pillars, and the 200->328 span is exactly the 128-tall
// halo texture height.
const IOPS_TUBE_PED = IOPS_FLOOR + 32; // 200
const IOPS_TUBE_CENTRES = Array.from(
  { length: IOPS_TUBE_COUNT },
  (_, i) => iopsChamber.u1 + IOPS_TUBE_MARGIN + IOPS_TUBE_HALF + i * (2 * IOPS_TUBE_HALF + IOPS_TUBE_GAP)
);
const IOPS_TERM_V = iopsChamber.v2; // 1529: back wall carries the iostat -x screen
const IOPS_TERM_CX = Math.round((iopsChamber.u1 + iopsChamber.u2) / 2); // -974
// Gauges light up from the MIDDLE outward: the busiest device (engine rain slot 0)
// takes the CENTRE gauge, directly in front of the terminal, and further devices fan
// to alternating sides, so a one-disk box shows a single centred pillar rather than a
// lone tube off in the corner. The engine only ever activates rain slots 0..count-1,
// so we make the slot index (== sector tag offset) a CENTRE-OUT RANK of the physical
// gauge positions instead of the left-to-right build order. `iopsRank[i]` is the rank
// (0 = centre) of the i-th built gauge; the engine's doomperf_rain_x_u[] lists the
// gauge world-X in this same rank order and MUST stay in sync.
const iopsRank = IOPS_TUBE_CENTRES
  .map((u, i) => ({ i, d: Math.abs(u - IOPS_TERM_CX), s: Math.sign(u - IOPS_TERM_CX) }))
  .sort((a, b) => a.d - b.d || a.s - b.s) // nearest the centre first; ties -> a stable side order
  .reduce((rank, e, k) => ((rank[e.i] = k), rank), []);
const iopsTerm = { u1: IOPS_TERM_CX - terminalHalfWidthLocal, v1: IOPS_TERM_V - 16, u2: IOPS_TERM_CX + terminalHalfWidthLocal, v2: IOPS_TERM_V };

// ===== LATENCY CAUSEWAY (off face 2, +u): the await instrument. Two lanes whose
// crossing speed is dragged by that lane's iostat await (see the engine's
// DoomPerf_UpdateCauseway / p_user.c). All of it sits OUTSIDE the step ring
// (u>518), sticking out +u into open space, so it runs long without meeting another
// hall; the cistern (u<=888, v<=1177) is the only near neighbour. Shared with
// terminals() so the read-point screen lines up with the geometry. =====
const CW_FLOOR = stepFloor(2); // 72
const CW_CEIL = CW_FLOOR + wallSignSize.height; // 200: 128-tall lane walls map the labels once
const CW_ALCOVE_CEIL = CW_FLOOR + 160; // 232: taller so the terminal recess (floor+16+128) seats under it
const cwFace = faceSpanV(2); // { mid: 1349, lo: 1197, hi: 1501 }
const CW_MOUTH_U = stepRing[2][0] + 50; // 568: squared throat wall (shares the cistern's +u seam at v=1197)
const CW_LABEL_U = CW_MOUTH_U + wallSignSize.width; // 824: end of the 256-wide labelled lane-front wall
const CW_LANE_BACK_U = 1120; // lanes end here; the shared terminal alcove begins
const CW_BACK_U = 1296; // alcove dead-end (+u) wall carrying the await screen
const CW_TERM_U = CW_BACK_U - 16; // 1280: terminal recess (16 deep) seam
const CW_DIV_HALF = 12; // divider half-thickness (24-wide solid void between the lanes)
const CW_READ_V1 = cwFace.lo; // 1197: read lane -v (outer) wall (== stepRing[2][1])
const CW_READ_V2 = cwFace.mid - CW_DIV_HALF; // 1337: read lane | divider seam
const CW_WRITE_V1 = cwFace.mid + CW_DIV_HALF; // 1361: divider | write lane seam
const CW_WRITE_V2 = cwFace.hi; // 1501: write lane +v (outer) wall (== stepRing[3][1])
const CW_TERM_V1 = cwFace.mid - terminalHalfWidthLocal; // 1221: screen left edge
const CW_TERM_V2 = cwFace.mid + terminalHalfWidthLocal; // 1477: screen right edge
// PISTONS: a solid metal OCTAGONAL cylinder stands FREE in each lane (walkway around
// it), toward the outer wall; its 8 faces wear the piston wall shader (silver steel +
// scrolling ridge lines, R_DoomPerfPistonPixel, line tags 666/667) whose scroll tracks
// the stroke tempo. A chamfered-square octagon on integer lattice points -- a REGULAR
// octagon has irrational vertices that can't mesh cleanly ([[map-builder-exact-collinearity]]).
const CW_OCT_CX = 960; // octagon centre u; station spans u 896..1024, clear of the cistern (u<=888)
const CW_OCT_H = 30; // octagon half flat-to-flat (bbox 60 wide/deep)
const CW_OCT_C = 12; // corner chamfer (~0.414*h for a near-regular octagon)
const CW_STATION_U1 = 896;
const CW_STATION_U2 = 1024;
const CW_OCT_BOX_U1 = CW_OCT_CX - CW_OCT_H; // 930: octagon bbox u
const CW_OCT_BOX_U2 = CW_OCT_CX + CW_OCT_H; // 990
// The station BULGES its outer wall out 60u for more room around the octagon (only
// here -- the mouth/label region can't widen without hitting the cistern chamber that
// sits below it, u<=888). vlo/vhi feed octStation; the octagon sits toward the bulged
// outer wall with a ~100u walkway to the divider side.
const CW_READ_STATION_VLO = CW_READ_V1 - 60; // 1137: bulged outer wall (read, toward -v)
const CW_WRITE_STATION_VHI = CW_WRITE_V2 + 60; // 1561: bulged outer wall (write, toward +v)
const CW_READ_OCT_CV = CW_READ_STATION_VLO + 40 + CW_OCT_H; // 1207: 40u back-gap, ~100u walkway
const CW_WRITE_OCT_CV = CW_WRITE_STATION_VHI - 40 - CW_OCT_H; // 1491 (mirror)

// Return pts wound CLOCKWISE (negative shoelace = interior on the right, the winding
// addPoly requires); flips a counter-clockwise loop so callers needn't track order.
const cwLoop = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a > 0 ? pts.slice().reverse() : pts.slice();
};

// A chamfered-square octagon (flats on the four cardinals) centred at (CW_OCT_CX, cv).
const octagonVerts = (cv) => {
  const x = CW_OCT_CX;
  const h = CW_OCT_H;
  const c = CW_OCT_C;
  return [
    [x - h + c, cv - h], [x + h - c, cv - h], [x + h, cv - h + c], [x + h, cv + h - c],
    [x + h - c, cv + h], [x - h + c, cv + h], [x - h, cv + h - c], [x - h, cv - h + c],
  ];
};

// The four right-triangles that fill the octagon bbox corners the chamfers cut away
// (lane floor, so the chamfered corners read as angled rather than filled back square).
const octCornerTris = (cv) => {
  const h = CW_OCT_H;
  const c = CW_OCT_C;
  const [lo, hi] = [CW_OCT_BOX_U1, CW_OCT_BOX_U2];
  return [
    [[lo, cv - h], [lo + c, cv - h], [lo, cv - h + c]],       // lower-left
    [[hi - c, cv - h], [hi, cv - h], [hi, cv - h + c]],       // lower-right
    [[lo, cv + h], [lo + c, cv + h], [lo, cv + h - c]],       // upper-left
    [[hi, cv + h], [hi - c, cv + h], [hi, cv + h - c]],       // upper-right
  ];
};

const build = (ctx) => {
  const { areaRect, areaPoly, addAreaThing, direction, base, accent } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top"); // far/deep wall (local +v)
  const frontWall = localSideToWorld(direction, "bottom"); // near wall (local -v) = cistern df screen
  const leftWall = localSideToWorld(direction, "left"); // queue chamber back wall (local -u)
  const rightWall = localSideToWorld(direction, "right"); // causeway dead-end wall (local +u)

  // Shared styles. The spiral climb's shell walls wear TEKWALL1 — the NETWORK wall
  // texture that now flanks the disk door in the atrium (see sideResource) — so the
  // door threshold's texture carries inside and lines the climb with tech panelling
  // against the BROWN1 foundry halls. Platter + halls keep the engine-room accent
  // (BROWN1). platterStyle carries F_SKY1: the platter, deck and the drum's crown
  // are all open to the summit sky (the drum is a solid pillar rising into it).
  const stepStyle = { ...base, wall: "TEKWALL1", kind: "pit-stair", floorFlat: "FLOOR0_3", ceilingFlat: "CEIL3_2", ceiling: C_TOWER };
  const platterStyle = { ...accent, ceiling: C_SKY, ceilingFlat: "F_SKY1" };
  const hallStyle = { ...accent, floorFlat: "FLOOR4_8", ceilingFlat: "CEIL5_1" };

  // ===== Central SPINDLE drum: a solid round pillar (30-gon), 256u tall; its lower
  // (two-sided) faces carry the vertical utilization fill + throughput streaks
  // over the FULL height (line tag 664, R_DoomPerfDiskSpindlePixel). The base wall
  // is DPDSPIN -- a 256-tall texture exactly matching the drum height so the shader
  // maps floor->crown once (a shorter texture would tile the fill twice). Inherits
  // platterStyle's F_SKY1 ceiling so the open summit sky shows above the crown. ====
  areaPoly(direction, "spindle-drum", solid(drumPts), {
    ...platterStyle,
    kind: "spindle",
    floor: DRUM_FLOOR,
    ceiling: DRUM_FLOOR, // solid pillar
    floorFlat: "FLOOR0_3",
    // The streak wall is the platter->drum LOWER texture, so its base must be set
    // via riserWall (the plain `wall` only drives the upper). It has to be DPDSPIN
    // (256 tall) for the column's texture coordinate to wrap at 256 -- with the
    // default STEP1 riser (128 tall) the frac wraps at 128 and the shader tiles the
    // util fill twice however the mask is set.
    wall: spindleTex.texture,
    riserWall: spindleTex.texture,
    light: 200,
    lineTag: ids.lineTags[0] + 4, // 664
  });

  // ===== PLATTER: a round disk floor (30 quads between the drum and disk circles,
  // light 130, fullbright, open to F_SKY1). The C platter shader keeps R=200; only
  // its centre moved, to world (0,-1197). Open to the summit sky -- no cover; the
  // full-height streaked spindle is what the vortex orbs relate to. =====
  const platterFloor = {
    ...platterStyle,
    kind: "platter",
    floor: PLATTER_FLOOR,
    floorFlat: "FLOOR0_3",
    light: ids.lights[0], // 130
  };
  for (let k = 0; k < drumPts.length; k += 1) {
    areaPoly(direction, `platter-${k}`, ringTrap(drumPts, diskPts, k), platterFloor);
  }

  // ===== DECK: a flush plain-floor margin ring framing the round disk inside the
  // decagonal summit (round inner edge -> decagonal outer edge). Ordinary light
  // (NOT the 130 sentinel) so the platter shader doesn't paint it; the platter
  // rendering is untouched. =====
  const deckFloor = { ...platterStyle, kind: "platter-deck", floor: PLATTER_FLOOR, floorFlat: "FLOOR0_3", light: 176 };
  for (let k = 0; k < diskPts.length; k += 1) {
    areaPoly(direction, `deck-${k}`, ringTrap(diskPts, deckOuterPts, k), deckFloor);
  }

  // ===== Step ring: TEN trapezoids climbing 24u per face CCW from the decagonal
  // DECK rim (R_DECK) out to the step ring (R_STEP) -- each a full-width stair
  // (meshing splits its inner edge at the deck's 30 outer points). Face index ->
  // step index k = (i+1)%10, so the near face (i=9) is the foot (k=0) and the
  // climb runs CCW through all ten faces; the top step (face 8, floor 216) meets
  // the deck (240) at a normal 24u rise, so the summit is walked onto directly. =====
  for (let i = 0; i < N_SIDES; i += 1) {
    const k = (i + 1) % N_SIDES;
    areaPoly(direction, `step-${i}`, ringTrap(deckRing, stepRing, i), {
      ...stepStyle,
      floor: stepFloor(i),
      light: 168 + k * 4, // brighten toward the summit (168..204; skips no sentinel)
    });
  }

  // ===== THROUGHPUT hall (off the FAR face 4, occluded from the entrance by the
  // drum): pneumatic tubes + iostat dashboard + terminal. Its mouth spans the
  // whole 320-wide face, so step 4's entire outer edge is the doorway. =====
  areaRect(direction, "tp-hall", { u1: -TP_HALF, v1: FAR_V, u2: TP_HALF, v2: TP_BACK }, {
    ...hallStyle,
    kind: "metric-hall",
    floor: TP_FLOOR,
    ceiling: TP_CEIL,
    light: 184,
  });
  const panel = (id, bounds, texture, textureSide, extra = {}) =>
    areaRect(direction, id, bounds, {
      ...hallStyle,
      kind: "metric-display",
      floor: TP_PANEL_Z,
      ceiling: TP_PANEL_Z,
      floorFlat: "FLOOR0_3",
      wall: texture,
      sideWall: accent.wall,
      textureSide,
      light: 192,
      ...extra,
    });
  // West wall (room face = world "left"): IO RATE plaque, then read/write tubes.
  panel("tp-rate", { u1: -TP_HALF - 16, v1: FAR_V + 32, u2: -TP_HALF, v2: FAR_V + 96 }, signs.rate.texture, "left");
  panel("tp-read", { u1: -TP_HALF - 16, v1: FAR_V + 96, u2: -TP_HALF, v2: FAR_V + 168 }, tubeRead.texture, "left");
  panel("tp-write", { u1: -TP_HALF - 16, v1: FAR_V + 176, u2: -TP_HALF, v2: FAR_V + 248 }, tubeWrite.texture, "left");
  // East wall (room face = world "right"): the live iostat dashboard (line tag 663).
  panel("tp-dash", { u1: TP_HALF, v1: FAR_V + 56, u2: TP_HALF + 16, v2: FAR_V + 184 }, display.texture, "right", {
    lineTag: ids.lineTags[0] + 3, // 663
  });
  // East wall: the disk-server rack (easter egg), a shorter equipment panel.
  panel("tp-rack", { u1: TP_HALF, v1: FAR_V + 192, u2: TP_HALF + 16, v2: FAR_V + 256 }, rack.texture, "right", {
    kind: "server-rack",
    floor: TP_FLOOR + SERVER_PANEL_HEIGHT,
    ceiling: TP_FLOOR + SERVER_PANEL_HEIGHT,
  });
  // Back wall (dead end, room face = world "top"): read/write tube panels that
  // mirror the west wall's pneumatic tubes. The aggregate `iostat -x 1 2` read-point
  // that used to sit here was removed — its service/queue/IOPS/df detail is already
  // covered by the AWAIT gauges, the IO-QUEUE hall, the per-device IOPS bank and the
  // df cistern — so the dead end is now plain wall decoration rather than a terminal.
  panel("tp-back-read", { u1: -72, v1: TP_BACK, u2: 0, v2: TP_BACK + 16 }, tubeRead.texture, "top");
  panel("tp-back-write", { u1: 0, v1: TP_BACK, u2: 72, v2: TP_BACK + 16 }, tubeWrite.texture, "top");

  // ===== LATENCY CAUSEWAY (off face 2, +u): the await instrument. The player IS the
  // I/O request -- two lanes (READ AWAIT / WRITE AWAIT) whose crossing speed is
  // dragged by that lane's iostat await (p_user.c P_MovePlayer x
  // DoomPerf_CausewayMoveScale, lane sector tags 652/653). A solid silver metal
  // OCTAGON column stands FREE in each lane (walkway around it), floor-to-ceiling (no
  // gaps); all 8 faces wear the piston wall shader (line tags 666/667 ->
  // R_DoomPerfPistonPixel) whose ridge lines scroll at the stroke tempo (faster =
  // lower latency) -- salient from the entrance. The angled throat squares to an axis-aligned
  // pair of lanes running deep in +u, split by a solid VOID divider (no sector -- the
  // gap between the two lane rects is solid), that merge into a shared alcove dead-
  // ending on the iostat await read-point (control panel below). The old bar-gauge
  // chamber (tags 660/661/662) is retired. See [[doomperf-engine-global-externs]]. =====
  const cwLane = { ...hallStyle, kind: "metric-hall", floor: CW_FLOOR, ceiling: CW_CEIL, light: 188 };
  const readTag = ids.sectorTags[0] + 52; // 652
  const writeTag = ids.sectorTags[0] + 53; // 653
  // Solid metal OCTAGON column: floor==ceiling (like the spindle drum) so every one of
  // its 8 lane-facing lower faces is the FULL lane height (72..200) -- no gaps above or
  // below. Each face wears the piston shader (line tag -> R_DoomPerfPistonPixel on
  // surface 2): silver steel with ridge lines scrolling at the stroke tempo. The
  // octagon geometry gives the round silhouette; the player circles it on the walkway.
  const cwPiston = {
    ...hallStyle,
    kind: "cube-plinth",
    floor: CW_CEIL,
    ceiling: CW_CEIL,
    wall: pistonBase.texture,
    riserWall: pistonBase.texture,
    light: 208,
  };
  // One octagonal station: the solid octagon (lineTag -> shader) standing free in the
  // lane at (CW_OCT_CX, cv), tiled around by lane floor -- lower/upper strips (full
  // width), left/right strips (bbox height) and the 4 corner triangles the chamfers
  // cut. vlo/vhi are the lane's v-extent; whichever strip is wide is the walkway.
  const octStation = (name, laneTag, lineTag, cv, vlo, vhi) => {
    const h = CW_OCT_H;
    const laneFloor = { ...cwLane, tag: laneTag };
    areaRect(direction, `${name}-lo`, { u1: CW_STATION_U1, v1: vlo, u2: CW_STATION_U2, v2: cv - h }, laneFloor);
    areaRect(direction, `${name}-hi`, { u1: CW_STATION_U1, v1: cv + h, u2: CW_STATION_U2, v2: vhi }, laneFloor);
    areaRect(direction, `${name}-l`, { u1: CW_STATION_U1, v1: cv - h, u2: CW_OCT_BOX_U1, v2: cv + h }, laneFloor);
    areaRect(direction, `${name}-r`, { u1: CW_OCT_BOX_U2, v1: cv - h, u2: CW_STATION_U2, v2: cv + h }, laneFloor);
    octCornerTris(cv).forEach((tri, k) => areaPoly(direction, `${name}-c${k}`, cwLoop(tri), laneFloor));
    areaPoly(direction, `${name}-oct`, cwLoop(octagonVerts(cv)), { ...cwPiston, lineTag });
  };

  // Throat: the angled face squared to u=CW_MOUTH_U across the full face span. Its +u
  // edge meshes against the two lane mouths; the divider void caps the middle.
  areaPoly(direction, "cw-throat", [
    stepRing[2],
    stepRing[3],
    [CW_MOUTH_U, stepRing[3][1]],
    [CW_MOUTH_U, stepRing[2][1]],
  ], { ...cwLane });

  // READ lane (tag 652): labelled front (256-wide outer wall = one placard), a
  // connector, the octagon station, then the aft run into the alcove.
  areaRect(direction, "cw-read-front", { u1: CW_MOUTH_U, v1: CW_READ_V1, u2: CW_LABEL_U, v2: CW_READ_V2 }, {
    ...cwLane, tag: readTag, labelEdge: 0, labelTexture: readAwaitLabel.texture, labelWidth: queueLabelSize.width,
  });
  areaRect(direction, "cw-read-gap", { u1: CW_LABEL_U, v1: CW_READ_V1, u2: CW_STATION_U1, v2: CW_READ_V2 }, { ...cwLane, tag: readTag });
  octStation("cw-read", readTag, ids.lineTags[0] + 6, CW_READ_OCT_CV, CW_READ_STATION_VLO, CW_READ_V2); // 666
  areaRect(direction, "cw-read-aft", { u1: CW_STATION_U2, v1: CW_READ_V1, u2: CW_LANE_BACK_U, v2: CW_READ_V2 }, { ...cwLane, tag: readTag });

  // WRITE lane (tag 653): mirror across the divider; octagon toward the +v outer wall.
  areaRect(direction, "cw-write-front", { u1: CW_MOUTH_U, v1: CW_WRITE_V1, u2: CW_LABEL_U, v2: CW_WRITE_V2 }, {
    ...cwLane, tag: writeTag, labelEdge: 2, labelTexture: writeAwaitLabel.texture, labelWidth: queueLabelSize.width,
  });
  areaRect(direction, "cw-write-gap", { u1: CW_LABEL_U, v1: CW_WRITE_V1, u2: CW_STATION_U1, v2: CW_WRITE_V2 }, { ...cwLane, tag: writeTag });
  octStation("cw-write", writeTag, ids.lineTags[0] + 7, CW_WRITE_OCT_CV, CW_WRITE_V1, CW_WRITE_STATION_VHI); // 667
  areaRect(direction, "cw-write-aft", { u1: CW_STATION_U2, v1: CW_WRITE_V1, u2: CW_LANE_BACK_U, v2: CW_WRITE_V2 }, { ...cwLane, tag: writeTag });

  // Shared ALCOVE at the far end: both lanes open into it (the divider void caps at
  // u=CW_LANE_BACK_U) and it dead-ends on the iostat await terminal. Ceiling raised so
  // the terminal recess (floor+16+128) seats under it.
  const cwAlcove = { ...cwLane, ceiling: CW_ALCOVE_CEIL, light: 184 };
  areaRect(direction, "cw-alcove", { u1: CW_LANE_BACK_U, v1: CW_READ_V1, u2: CW_TERM_U, v2: CW_WRITE_V2 }, cwAlcove);
  // Terminal recess on the +u dead-end wall: two flanks + the await screen.
  areaRect(direction, "cw-term-l", { u1: CW_TERM_U, v1: CW_READ_V1, u2: CW_BACK_U, v2: CW_TERM_V1 }, cwAlcove);
  areaRect(direction, "cw-terminal", { u1: CW_TERM_U, v1: CW_TERM_V1, u2: CW_BACK_U, v2: CW_TERM_V2 }, {
    ...cwLane,
    kind: "terminal",
    floor: CW_FLOOR + 16,
    ceiling: CW_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: rightWall, // +u dead-end wall = the iostat await screen
    labelTexture: awaitScreen.texture,
    controlPanel: true,
  });
  areaRect(direction, "cw-term-r", { u1: CW_TERM_U, v1: CW_TERM_V2, u2: CW_BACK_U, v2: CW_WRITE_V2 }, cwAlcove);

  // ===== QUEUE hall (off face 7, lower-left): the DISK IO QUEUE instrument. An
  // angled throat squares up to a chamber, entered along -u, laid out front-to-back:
  //
  //   approach walk   (full width, entrance side) -> shaft band -> terminal recess.
  //   DEVICE rack     (tag 650, v 893..1005): in-flight requests dispatched to the
  //                   hardware; its banded RACK riser grows as the engine raises the
  //                   floor with deviceQueue.
  //   central nave    (v 1005..1085): the walkway between the columns, leading to
  //                   the read-point; a scripted dispatcher mobj will shuttle it.
  //   SCHEDULER       (tag 651, v 1085..1197): block-layer backlog. A TALLER well
  //     magazine      (ceiling 480 vs the device's 384) so it can TOWER over the
  //                   device rim when the device saturates.
  //   read-point      the IO QUEUE screen on the back (-u) wall, centred on the nave
  //                   and flanked by the two rising columns; control panel below.
  //
  // ONE adaptive widget: both floors are engine-driven from the live split -- on a
  // deep-queue device the device rack barely rises and the magazine stays flat,
  // which is honest (such a device saturates on %util/await, not tags). Floors rest
  // one short step (16u) below the walk so an empty queue reads as a shallow,
  // escapable recess; the engine lerps them up in MAP UNITS
  // ([[fixed-point-lerp-overflow]]). Reserved sector tags 650/651 from the storage
  // block [600,659] (640-649 freed when the backpressure gutter was removed).
  //
  // The chamber is widened to the full face and the ceiling raised over the old flat
  // 320 to seat the 256-wide screen and give the magazine room to climb. =====
  const queueThroat = [
    stepRing[QUEUE_FACE], //                            (-518,1197)
    stepRing[QUEUE_FACE + 1], //                        (-419, 893)
    [queueChamber.u2, stepRing[QUEUE_FACE + 1][1]], //  (-558, 893)
    [queueChamber.u2, stepRing[QUEUE_FACE][1]], //      (-558,1197)
  ];
  areaPoly(direction, "queue-throat", queueThroat, {
    ...hallStyle,
    kind: "metric-hall",
    floor: QUEUE_FLOOR,
    ceiling: QUEUE_FLOOR + 128,
    light: 184,
  });
  const QUEUE_SHAFT_FLOOR = QUEUE_FLOOR - 16; //       176: flat shaft floor (base of the plate wall)
  const QUEUE_SHAFT_CEIL = QUEUE_SHAFT_FLOOR + 256; // 432: a 256-tall outer wall the plate shader maps once
  const QUEUE_BACK_U = queueChamber.u1; //            -782: back wall (carries the screen)
  const QUEUE_TERM_U = QUEUE_BACK_U + 16; //          -766: terminal recess <-> shaft band seam
  const QUEUE_FRONT_U = queueChamber.u2 - 62; //      -620: approach walk <-> shaft band seam
  const QUEUE_NAVE_V1 = QUEUE_SCREEN_CV - 40; //      1005: device shaft | nave seam
  const QUEUE_NAVE_V2 = QUEUE_SCREEN_CV + 40; //      1085: nave | scheduler shaft seam
  const QUEUE_TERM_V1 = QUEUE_SCREEN_CV - terminalHalfWidthLocal; // 917: screen left edge
  const QUEUE_TERM_V2 = QUEUE_SCREEN_CV + terminalHalfWidthLocal; // 1173: screen right edge
  const queueWalk = { ...hallStyle, kind: "metric-hall", floor: QUEUE_FLOOR, ceiling: QUEUE_FLOOR + 128, floorFlat: "FLOOR0_3", light: 184 };
  // Each shaft is a shallow well that HOLDS a stack of billboard plate sprites
  // (MT_DP_DISKPLATE), hand-positioned by the engine (p_tick.c DoomPerf_UpdateDiskPlates)
  // to the live device/scheduler fill. The walls are plain dark metal so the
  // fullbright amber/red plates read against them; the floor is flat.
  const queueShaft = { ...hallStyle, floorFlat: "FLOOR1_7", light: 148, floor: QUEUE_SHAFT_FLOOR, ceiling: QUEUE_SHAFT_CEIL };
  // Approach walk (full width) + central nave leading to the read-point: the walkway.
  areaRect(direction, "queue-front", { u1: QUEUE_FRONT_U, v1: queueChamber.v1, u2: queueChamber.u2, v2: queueChamber.v2 }, queueWalk);
  areaRect(direction, "queue-nave", { u1: QUEUE_TERM_U, v1: QUEUE_NAVE_V1, u2: QUEUE_FRONT_U, v2: QUEUE_NAVE_V2 }, queueWalk);
  // Device rack (left) and scheduler magazine (right) flank the nave; the engine
  // stacks amber plates in the device well and red plates in the scheduler well
  // (DoomPerf_UpdateDiskPlates spawns at these shafts' world centres).
  //
  // Each shaft's OUTER strip holds a recessed label NICHE: a one-placard (128) tall
  // frame centred on the shaft wall's mid-line (240..368 of the 176..432 wall). The
  // 128 height is what makes the sign render ONCE -- on the full 256-tall wall
  // vanilla's `& 127` column mask tiles the placard (showing the top word twice and
  // dropping "QUEUE"); a 128-tall wall maps the 128-tall placard exactly once. The
  // sign rides the niche's one-sided OUTER wall, named by poly-edge index (edge 0 =
  // the low-v wall for the south wing's device shaft, edge 2 = the high-v wall for
  // the scheduler shaft); labelEdge (not labelSide) is used so the CPU-terminal
  // control-panel heuristic (labelSide === "top") can't misfire on the step riser.
  // The plate stacks live at the shaft centres (v 949 / 1141), clear of the niche.
  const QUEUE_LABEL_FLOOR = QUEUE_SHAFT_FLOOR + 64; //  240: niche sill (centres the 128 band)
  const QUEUE_LABEL_CEIL = QUEUE_LABEL_FLOOR + queueLabelSize.height; // 368
  const QUEUE_NICHE_DEPTH = 18; // outer strip carrying the label
  const deviceNicheV = queueChamber.v1 + QUEUE_NICHE_DEPTH; // 911: main-shaft | niche seam
  const schedNicheV = queueChamber.v2 - QUEUE_NICHE_DEPTH; // 1179
  const queueNiche = { ...queueShaft, floor: QUEUE_LABEL_FLOOR, ceiling: QUEUE_LABEL_CEIL, labelWidth: queueLabelSize.width };
  areaRect(direction, "queue-device", { u1: QUEUE_TERM_U, v1: deviceNicheV, u2: QUEUE_FRONT_U, v2: QUEUE_NAVE_V1 }, {
    ...queueShaft,
    kind: "queue-device",
  });
  areaRect(direction, "queue-device-label", { u1: QUEUE_TERM_U, v1: queueChamber.v1, u2: QUEUE_FRONT_U, v2: deviceNicheV }, {
    ...queueNiche,
    labelEdge: 0, // low-v outer wall
    labelTexture: deviceLabel.texture,
  });
  areaRect(direction, "queue-sched", { u1: QUEUE_TERM_U, v1: QUEUE_NAVE_V2, u2: QUEUE_FRONT_U, v2: schedNicheV }, {
    ...queueShaft,
    kind: "queue-sched",
  });
  areaRect(direction, "queue-sched-label", { u1: QUEUE_TERM_U, v1: schedNicheV, u2: QUEUE_FRONT_U, v2: queueChamber.v2 }, {
    ...queueNiche,
    labelEdge: 2, // high-v outer wall
    labelTexture: schedLabel.texture,
  });
  // Read-point: the IO QUEUE screen on the back (-u) wall, flanked by wall so the
  // 256-wide screen seats, with the control-panel strip on the step riser below it.
  areaRect(direction, "queue-term-l", { u1: QUEUE_BACK_U, v1: queueChamber.v1, u2: QUEUE_TERM_U, v2: QUEUE_TERM_V1 }, queueWalk);
  areaRect(direction, "queue-term-r", { u1: QUEUE_BACK_U, v1: QUEUE_TERM_V2, u2: QUEUE_TERM_U, v2: queueChamber.v2 }, queueWalk);
  areaRect(direction, "queue-terminal", { u1: QUEUE_BACK_U, v1: QUEUE_TERM_V1, u2: QUEUE_TERM_U, v2: QUEUE_TERM_V2 }, {
    ...hallStyle,
    kind: "terminal",
    floor: QUEUE_FLOOR + 16,
    ceiling: QUEUE_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: leftWall, // back (-u) wall = the IO QUEUE screen
    labelTexture: queueScreen.texture,
    controlPanel: true,
  });

  // ===== CISTERN hall (off face 1, stepRing[1..2]): the disk-usage instrument.
  // An angled throat squares up to an axis-aligned chamber; the back wall carries a
  // circular SUNBURST display (line tag 665, `df /` fill) inset between two wall
  // flanks, with the chamber floor left open in front of it. =====
  const cistWalk = { ...hallStyle, kind: "cistern-walk", floorFlat: "FLOOR0_3", light: 184 };
  // No throat placard: the throat's outer edge (edge 1) is the two-sided seam it
  // shares with the adjacent AWAIT throat, which can't carry a label. The hall is
  // identified by its df read-point overlay instead.
  areaPoly(direction, "cist-throat", [stepRing[CIST_FACE], stepRing[CIST_FACE + 1], [CIST_INNER_U, stepRing[CIST_FACE + 1][1]], [CIST_INNER_U, stepRing[CIST_FACE][1]]], {
    ...cistWalk,
    kind: "metric-hall",
    floor: CIST_FLOOR,
    ceiling: CIST_CEIL,
  });
  const cistRim = { ...cistWalk, floor: CIST_FLOOR, ceiling: CIST_CEIL };
  // Terminal and placard are SWAPPED off the raw layout: the DISK USAGE placard rides
  // the +v BACK wall -- the one the player sees head-on approaching up the spiral --
  // and the df read-point TERMINAL moves to the -v FRONT wall (walked up to after
  // entering). Front strip (v cistChamber.v1..+16): terminal recess centred, flanked.
  const CIST_FRONT_V2 = cistChamber.v1 + 16; //                    929: front terminal strip depth
  areaRect(direction, "cist-term-l", { u1: cistChamber.u1, v1: cistChamber.v1, u2: cistTerm.u1, v2: CIST_FRONT_V2 }, cistRim);
  areaRect(direction, "cist-terminal", { u1: cistTerm.u1, v1: cistChamber.v1, u2: cistTerm.u2, v2: CIST_FRONT_V2 }, {
    ...cistWalk,
    kind: "terminal",
    floor: CIST_FLOOR + 16,
    ceiling: CIST_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: frontWall, // near wall (local -v) = the df screen
    labelTexture: usageScreen.texture,
    controlPanel: true,
  });
  areaRect(direction, "cist-term-r", { u1: cistTerm.u2, v1: cistChamber.v1, u2: cistDisc.u1, v2: CIST_FRONT_V2 }, cistRim);
  // Open chamber floor: from the front terminal strip back to the +v label strip, and
  // out to the +u display inset (cistDisc.u1). The +u strip beside it is tiled below.
  areaRect(direction, "cist-floor", { u1: cistChamber.u1, v1: CIST_FRONT_V2, u2: cistDisc.u1, v2: cistTerm.v1 }, cistRim);
  // Back (+v) wall carries the DISK USAGE placard on the approach-visible wall. A
  // shallow lowered-ceiling valance drops its face to exactly 128 tall (48..176) so
  // the 128-tall placard maps once (a 160-tall wall would tile it,
  // [[doom-wall-texture-128-tiling]]); its centre 256 is the label bay (256 wide ->
  // placard maps 1:1, centred), flanked by two plain fillers out to the disc block.
  const CIST_LABEL_CEIL = CIST_FLOOR + queueLabelSize.height; //   176
  const CIST_LABEL_CU = Math.round((cistChamber.u1 + cistChamber.u2) / 2); // 728: back-wall centre
  const CIST_LABEL_U1 = CIST_LABEL_CU - queueLabelSize.width / 2; // 600
  const CIST_LABEL_U2 = CIST_LABEL_CU + queueLabelSize.width / 2; // 856
  const cistBand = { ...cistRim, ceiling: CIST_LABEL_CEIL };
  areaRect(direction, "cist-label-l", { u1: cistChamber.u1, v1: cistTerm.v1, u2: CIST_LABEL_U1, v2: cistChamber.v2 }, cistBand);
  areaRect(direction, "cist-label", { u1: CIST_LABEL_U1, v1: cistTerm.v1, u2: CIST_LABEL_U2, v2: cistChamber.v2 }, {
    ...cistBand,
    labelEdge: 2, // high-v (+v back) wall
    labelTexture: usageLabel.texture,
    labelWidth: queueLabelSize.width,
  });
  areaRect(direction, "cist-label-r", { u1: CIST_LABEL_U2, v1: cistTerm.v1, u2: cistChamber.u2, v2: cistChamber.v2 }, cistBand);
  // Sunburst display block on the +u SIDE wall: a SOLID block (floor == ceiling, like
  // the spindle drum) whose room-facing (-u) lower texture (floor 48 -> block top 176
  // = a 128-tall span matching the 128-tall DPDISC texture 1:1) carries the disk-usage
  // sunburst shader (line tag 665, surface 2). `riserWall` sets that -u face; `wall` is
  // the metal cap (176 -> 208). Flanked in v by solid wall (floor == ceiling == 208,
  // riser = hall wall) so only the -u face shows the circle. Fed by doomperf_storage_usage.
  const cistFlank = { ...cistRim, kind: "cist-wall", floor: CIST_CEIL, ceiling: CIST_CEIL, riserWall: cistWalk.wall };
  areaRect(direction, "cist-disc-f", { u1: cistDisc.u1, v1: cistChamber.v1, u2: cistDisc.u2, v2: cistDisc.v1 }, cistFlank);
  areaRect(direction, "cist-disc-b", { u1: cistDisc.u1, v1: cistDisc.v2, u2: cistDisc.u2, v2: cistTerm.v1 }, cistFlank);
  areaRect(direction, "cist-disc", cistDisc, {
    ...cistWalk,
    kind: "cube-plinth", // solid block: riserWall on the -u face
    floor: CIST_CEIL, // 208: block top == chamber ceiling -> lower texture is the FULL
    ceiling: CIST_CEIL, // 160-tall wall (48..208), floor-to-ceiling, no cap band
    floorFlat: "FLOOR0_3",
    wall: cistWalk.wall,
    riserWall: discTex.texture, // 160-tall circular display on the -u (room-facing) face
    light: 208,
    lineTag: ids.lineTags[0] + 5, // 665
  });

  // ===== per-device RAIN GAUGE hall (off face 6, stepRing[6..7]): the per-device
  // I/O instrument. A throat squares up to a chamber holding a row of five
  // free-standing light-tube gauges (engine sector tags 630..634), one per busiest
  // block device. Each gauge is a raised glowing pedestal under a bright downlight;
  // a column of rain falls through it (fall SPEED = device ops/s, density + beam
  // brightness = device %util; DoomPerf_UpdateDiskRain streams the drops). An
  // iostat -x read-point terminal rides the back (+v) wall. =====
  const iopsWalk = { ...hallStyle, kind: "iops-walk", floorFlat: "FLOOR0_3", light: 184 };
  // No throat placard (see cist-throat): edge 1 is the two-sided seam shared with
  // the adjacent QUEUE throat. The hall is identified by its iostat -x terminal.
  areaPoly(direction, "iops-throat", [stepRing[IOPS_FACE], stepRing[IOPS_FACE + 1], [IOPS_INNER_U, stepRing[IOPS_FACE + 1][1]], [IOPS_INNER_U, stepRing[IOPS_FACE][1]]], {
    ...iopsWalk,
    kind: "metric-hall",
    floor: IOPS_FLOOR,
    ceiling: IOPS_CEIL,
  });
  const iopsRim = { ...iopsWalk, floor: IOPS_FLOOR, ceiling: IOPS_CEIL };
  // The -v wall OPPOSITE the terminal -- the long wall the gauge row stands in front
  // of -- carries the IOPS BY DEVICE placard, pushed to the +u (entrance-side) end,
  // which reads as the LEFT end of the wall, so it's seen without walking into the
  // room, with a bit of margin off the corner. A shallow lowered-ceiling valance along
  // the front of that wall drops its face to exactly 128 tall (168..296) so the 128-tall
  // placard maps once ([[doom-wall-texture-128-tiling]]); the label bay (256 wide ->
  // placard maps 1:1) sits margin-in from the +u end, with the long remainder filling
  // out toward the -u end.
  const IOPS_LABEL_DEPTH = 16;
  const IOPS_LABEL_MARGIN = 40; // gap between the placard and the +u corner
  const IOPS_LABEL_V2 = iopsChamber.v1 + IOPS_LABEL_DEPTH; // 1233: valance strip depth
  const IOPS_LABEL_CEIL = IOPS_FLOOR + queueLabelSize.height; // 296
  const IOPS_LABEL_U2 = iopsChamber.u2 - IOPS_LABEL_MARGIN; // -598: label bay +u edge (margin off the corner)
  const IOPS_LABEL_U1 = IOPS_LABEL_U2 - queueLabelSize.width; // -854
  const iopsBand = { ...iopsRim, ceiling: IOPS_LABEL_CEIL };
  // Front-wall label valance (v iopsChamber.v1..+16): filler | IOPS BY DEVICE | margin filler.
  areaRect(direction, "iops-label-l", { u1: iopsChamber.u1, v1: iopsChamber.v1, u2: IOPS_LABEL_U1, v2: IOPS_LABEL_V2 }, iopsBand);
  areaRect(direction, "iops-label", { u1: IOPS_LABEL_U1, v1: iopsChamber.v1, u2: IOPS_LABEL_U2, v2: IOPS_LABEL_V2 }, {
    ...iopsBand,
    labelEdge: 0, // low-v (-v) wall opposite the terminal
    labelTexture: iopsLabel.texture,
    labelWidth: queueLabelSize.width,
  });
  areaRect(direction, "iops-label-r", { u1: IOPS_LABEL_U2, v1: iopsChamber.v1, u2: iopsChamber.u2, v2: IOPS_LABEL_V2 }, iopsBand);
  // Front walkway (behind the label valance): the player looks across the gauge row.
  areaRect(direction, "iops-front", { u1: iopsChamber.u1, v1: IOPS_LABEL_V2, u2: iopsChamber.u2, v2: IOPS_TUBE_V1 }, iopsRim);
  // The gauge band: five raised light-tube gauges with a walkway gap before, between
  // and after each. Each tube is a raised pedestal (floor +32 = un-climbable pillar)
  // under a bright downlight-panel ceiling; its riser wears a tech-tube base and its
  // four walls wear a faint masked HALO (haloTexture) that outlines the notional tube
  // volume so each device's rain column reads separately. Sector tag 630+i lets
  // DoomPerf_UpdateDiskRain brighten/dim both the beam and its halo with the device's
  // %util (an inactive gauge, past the live device count, rests as a dim outline).
  let cursor = iopsChamber.u1;
  for (let i = 0; i < IOPS_TUBE_COUNT; i += 1) {
    const left = IOPS_TUBE_CENTRES[i] - IOPS_TUBE_HALF;
    const right = IOPS_TUBE_CENTRES[i] + IOPS_TUBE_HALF;
    areaRect(direction, `iops-gap-${i}`, { u1: cursor, v1: IOPS_TUBE_V1, u2: left, v2: IOPS_TUBE_V2 }, iopsRim);
    areaRect(direction, `iops-tube-${i}`, { u1: left, v1: IOPS_TUBE_V1, u2: right, v2: IOPS_TUBE_V2 }, {
      ...iopsWalk,
      kind: "iops-tube",
      floor: IOPS_TUBE_PED, // 200: raised pillar (rain lands here)
      ceiling: IOPS_CEIL,
      floorFlat: "CEIL5_1", // glowing pedestal pad (distinct from the FLOOR0_3 walkway)
      ceilingFlat: "CEIL5_1", // bright downlight panel above -- lightlevel makes it the "beam"
      riserWall: "TEKWALL1", // lit tech-tube pedestal base
      haloTexture: haloTex.texture, // faint masked cage on all 4 walls (200..328 == 128 tall)
      light: 248, // bright default; engine drives 144 (idle/inactive) .. 240 (saturated), tags 630..634
      tag: ids.sectorTags[0] + 30 + iopsRank[i], // 630..634 in CENTRE-OUT rank (630 = centre gauge)
    });
    cursor = right;
  }
  areaRect(direction, "iops-gap-last", { u1: cursor, v1: IOPS_TUBE_V1, u2: iopsChamber.u2, v2: IOPS_TUBE_V2 }, iopsRim);
  areaRect(direction, "iops-back", { u1: iopsChamber.u1, v1: IOPS_TUBE_V2, u2: iopsChamber.u2, v2: iopsTerm.v1 }, iopsRim);
  // iostat -x terminal on the back wall, flanked by wall so the screen seats.
  areaRect(direction, "iops-term-l", { u1: iopsChamber.u1, v1: iopsTerm.v1, u2: iopsTerm.u1, v2: iopsTerm.v2 }, iopsRim);
  areaRect(direction, "iops-term-r", { u1: iopsTerm.u2, v1: iopsTerm.v1, u2: iopsChamber.u2, v2: iopsTerm.v2 }, iopsRim);
  areaRect(direction, "iops-terminal", iopsTerm, {
    ...iopsWalk,
    kind: "terminal",
    floor: IOPS_FLOOR + 16,
    ceiling: IOPS_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: backWall, // far wall (local +v) = the screen
    labelTexture: iopsScreen.texture,
    controlPanel: true,
  });
};

// The rain-gauge HALO: a VERY FAINT masked outline hung on all four walls of each
// device tube (via haloTexture) so the notional tube volume is just barely suggested
// and each device's rain column reads separately. Almost entirely transparent -- a
// single dim, DASHED blue rib per 16u tile plus a whisper of a dim cap line at the
// crown and base; no bright rings, beads or white glints (an earlier version read too
// loud). Its glow is the tube sector's lightlevel, which DoomPerf_UpdateDiskRain
// drives from %util, so it stays subtle. 128 tall == the 200..328 pedestal->ceiling
// opening (fills once, no vertical wrap); 16 wide (power-of-two) tiles cleanly.
const haloTex = { texture: tex("HALO"), patch: tex("PHAL") };
const haloTexSize = { width: 16, height: 128 };
const buildHaloPatch = () => {
  const { width: W, height: H } = haloTexSize;
  const T = 247; // transparent key -> almost entirely see-through
  const px = new Uint8Array(W * H).fill(T);
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const RIB = 197; // dim blue
  // one dim DASHED rib per 16u tile (every 3rd row) -> a faint suggestion of an edge
  for (let y = 0; y < H; y += 3) set(0, y, RIB);
  // a whisper of a cap line at the crown and base (dashed, dim)
  for (let x = 0; x < W; x += 2) {
    set(x, 0, RIB);
    set(x, H - 1, RIB);
  }
  return buildPatch(px, W, H, { transparent: T });
};

// Texture patches this wing contributes: the iostat screen, disk wall signs,
// await gauge, throughput tubes, rack, and live-dashboard fallback art.
const textures = [
  {
    texture: haloTex.texture,
    patch: haloTex.patch,
    width: haloTexSize.width,
    height: haloTexSize.height,
    build: buildHaloPatch,
  },
  // The three read-point screens (iostat / df / iostat -x), each a CPU-wing-style
  // simulated terminal so they match the rest of the game's terminals.
  ...[screen, usageScreen, iopsScreen, queueScreen, awaitScreen].map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: terminalTextureSize.width,
    height: terminalTextureSize.height,
    build: () => buildTerminalPatch(s),
  })),
  ...Object.values(signs).map((sign) => ({
    texture: sign.texture,
    patch: sign.patch,
    width: wallSignSize.width,
    height: wallSignSize.height,
    build: () => buildWallSignPatch(sign.text),
  })),
  // The IO-queue tier placards, the two latency-causeway lane placards, and the
  // disk-usage / per-device IOPS hall placards.
  ...[deviceLabel, schedLabel, readAwaitLabel, writeAwaitLabel, usageLabel, iopsLabel].map((s) => ({
    texture: s.texture,
    patch: s.patch,
    width: queueLabelSize.width,
    height: queueLabelSize.height,
    build: () => buildQueueLabelPatch(s.lines, s.color, s.scale),
  })),
  {
    texture: spindleTex.texture,
    patch: spindleTex.patch,
    width: spindleTexSize.width,
    height: spindleTexSize.height,
    build: buildSpindlePatch,
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
  {
    texture: discTex.texture,
    patch: discTex.patch,
    width: discTexSize.width,
    height: discTexSize.height,
    build: buildDiscPatch,
  },
  {
    texture: pistonBase.texture,
    patch: pistonBase.patch,
    width: pistonBaseSize.width,
    height: pistonBaseSize.height,
    build: buildPistonBasePatch,
  },
];

// Floor-name inscription flat ("IO VAULT").
const flats = [...ioInscription.flats];

const toWorld = ([u, v]) => [-u, -v];
const segment = (a, b) => {
  const [ax, ay] = toWorld(a);
  const [bx, by] = toWorld(b);
  return { ax, ay, bx, by };
};
// The three read-points (iostat / df / iostat -x). Storage is the SOUTH wing, so
// the builder rotates local (u,v) -> world (-u,-v); the central terminalSegment
// helper assumes the identity (north) rotation, so we emit each screen face in
// WORLD coords directly (via segment(), which applies toWorld). Each face is the
// terminal recess's far wall, one screen wide, centred on its chamber so the
// browser's USE-distance check lines up with the screen. The cistern and IOPS
// screens are off-centre (their chambers sit to the +u/-u side), so they run
// terminalHalfWidth either side of the chamber's u-centre, not of u=0.
const terminals = ({ terminalHalfWidth }) => [
  // (The aggregate `iostat -x 1 2` read-point that used to ride the THROUGHPUT hall's
  // dead-end wall was removed — that wall is now tube-panel decoration; its detail is
  // covered by the AWAIT / IO-QUEUE / IOPS / df read-points below.)
  // df read-point: the terminal screen now on the FRONT (-v) wall (swapped with the
  // DISK USAGE placard, which took the approach-visible back wall). cistChamber.v1 is
  // the front wall; the sunburst sits on the +u side wall as a separate instrument.
  { sign: "storage-usage", segments: [segment([CIST_TERM_CX - terminalHalfWidth, cistChamber.v1], [CIST_TERM_CX + terminalHalfWidth, cistChamber.v1])] },
  { sign: "storage-iops", segments: [segment([IOPS_TERM_CX - terminalHalfWidth, IOPS_TERM_V], [IOPS_TERM_CX + terminalHalfWidth, IOPS_TERM_V])] },
  // IO QUEUE read-point: the screen rides the queue chamber's back (-u) wall, so it
  // runs terminalHalfWidth either side of the chamber's v-centre (not of u).
  { sign: "storage-queue", segments: [segment([QUEUE_SCREEN_U, QUEUE_SCREEN_CV - terminalHalfWidth], [QUEUE_SCREEN_U, QUEUE_SCREEN_CV + terminalHalfWidth])] },
  // Latency-causeway iostat await read-point: the screen rides the alcove's +u
  // dead-end wall, centred on the face mid (v), so it runs terminalHalfWidth either
  // side of cwFace.mid.
  { sign: "storage-await", segments: [segment([CW_BACK_U, cwFace.mid - terminalHalfWidth], [CW_BACK_U, cwFace.mid + terminalHalfWidth])] },
];

const easterEggs = () => {
  // The disk-server rack panel lives on the throughput hall's east wall.
  return [
    {
      id: "disk-server-rack",
      segments: [segment([TP_HALF, FAR_V + 192], [TP_HALF, FAR_V + 256])],
    },
  ];
};

// I/O circuit orbs. Amber REQUEST climbing to the device (the wing's own gold
// hue), silver COMPLETION returning to the submitter -- deliberately NOT green or
// cyan, which are the CPU wing's D-state orb and the network wing's RX packet.
// Frames: A = static billboard the engine hand-moves, B/C = spawn bloom (settle,
// ring), D/E = despawn fade. Riding IFOG (item-respawn fog) and TFOG (teleport
// fog): the lab has no teleporters and no item respawn, so nothing else spawns
// them. See [[pwad-sprite-override-constraint]] -- these names/frames must already
// exist in the IWAD, and availability was checked against the C state table, NOT
// registry.mjs (which had drifted).
const amberRamp = [4, 231, 165, 163, 161, 159]; //  white core -> gold -> deep amber rim
const amberFlash = [4, 4, 231, 231, 165, 163]; //   brighter core for the ring flash
const silverRamp = [4, 80, 82, 84, 86, 88]; //      white core -> grey -> dark steel rim
const silverFlash = [4, 4, 80, 80, 82, 84];

// Disk IO QUEUE plate billboards (override IWAD CEYE A/B — an evil-eye decoration
// the lab never spawns). A flattened disc lit from ABOVE (bright top, shadowed
// underside) with a crisp top-rim highlight, so a stack reads as real 3D plates
// from any angle. Ramps are dark->bright: amber = device rack, red = scheduler.
const plateAmberRamp = [159, 161, 163, 165, 231, 4]; // deep amber -> gold -> white glint
const plateRedRamp = [191, 187, 183, 179, 176, 4]; //  deep red   -> bright red -> white glint
const plateSpriteSize = { width: 44, height: 16 };
const buildPlateSprite = (ramp) => {
  const { width: W, height: H } = plateSpriteSize;
  const T = 247; // transparent key
  const px = new Uint8Array(W * H).fill(T);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const rx = W / 2 - 2;
  const ry = H / 2 - 2;
  const last = ramp.length - 1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue; // outside the plate disc
      let t = 0.5 - ny * 0.62; // lit from above: top bright, underside shadowed
      if (ny < -0.35 && d > 0.5) t += 0.35; // bright top-rim lip
      t = Math.max(0, Math.min(1, t));
      px[y * W + x] = ramp[Math.round(t * last)];
    }
  }
  return buildPatch(px, W, H, { leftOffset: Math.round(W / 2), topOffset: H, transparent: T });
};

// Per-device rain-gauge DROP (override the free IWAD frame TFOG F -- the COMPLETION
// orb above spends only TFOG A-E, and the lab has no teleporters). A small icy
// teardrop: a bright white-cored blue head tapering to a thin tail, streamed down
// each gauge by DoomPerf_UpdateDiskRain. Cyan/blue reads as water; the network
// wing's cyan RX orb is in a different wing and never co-visible.
const rainDropRamp = [4, 192, 195, 198]; // white core -> bright blue -> mid-blue rim
const rainDropSize = { width: 7, height: 16 };
const buildRainDropPatch = () => {
  const { width: W, height: H } = rainDropSize;
  const T = 247; // transparent key
  const px = new Uint8Array(W * H).fill(T);
  const cx = (W - 1) / 2;
  const last = rainDropRamp.length - 1;
  for (let y = 0; y < H; y += 1) {
    const t = y / (H - 1); // 0 at the tail (top) .. 1 at the head (bottom)
    const halfW = 0.6 + (W / 2 - 1) * Math.pow(t, 1.4); // narrow tail -> round head
    for (let x = 0; x < W; x += 1) {
      const dx = (x - cx) / halfW;
      if (Math.abs(dx) > 1) continue; // outside the teardrop
      // brightest on the axis, fading to the rim; the head reads brighter than the tail
      const shade = Math.min(1, Math.abs(dx) + (1 - t) * 0.45);
      px[y * W + x] = rainDropRamp[Math.round(shade * last)];
    }
  }
  return buildPatch(px, W, H, { leftOffset: Math.round(W / 2), topOffset: H, transparent: T });
};

const sprites = [
  { name: "IFOGA0", build: () => buildShadedOrbPatch(amberRamp) }, //                               request static orb
  { name: "IFOGB0", build: () => buildFxPatch({ size: 22, ramp: amberRamp, outerFrac: 0.78 }) }, //  settle
  { name: "IFOGC0", build: () => buildFxPatch({ size: 32, ramp: amberFlash, outerFrac: 0.72 }) }, // flash
  { name: "IFOGD0", build: () => buildFxPatch({ size: 32, ramp: amberRamp, innerFrac: 0.55 }) }, //  fade ring
  { name: "IFOGE0", build: () => buildFxPatch({ size: 38, ramp: amberRamp, innerFrac: 0.72 }) }, //  fade out
  { name: "TFOGA0", build: () => buildShadedOrbPatch(silverRamp) }, //                              completion static orb
  { name: "TFOGB0", build: () => buildFxPatch({ size: 22, ramp: silverRamp, outerFrac: 0.78 }) },
  { name: "TFOGC0", build: () => buildFxPatch({ size: 32, ramp: silverFlash, outerFrac: 0.72 }) },
  { name: "TFOGD0", build: () => buildFxPatch({ size: 32, ramp: silverRamp, innerFrac: 0.55 }) },
  { name: "TFOGE0", build: () => buildFxPatch({ size: 38, ramp: silverRamp, innerFrac: 0.72 }) },
  { name: "CEYEA0", build: () => buildPlateSprite(plateAmberRamp) }, // device rack plate (amber)
  { name: "CEYEB0", build: () => buildPlateSprite(plateRedRamp) }, //  scheduler magazine plate (red)
  { name: "TFOGF0", build: buildRainDropPatch }, //                    per-device rain-gauge drop (icy)
];

export const storageWing = {
  resource: "storage",
  ids,
  build,
  textures,
  flats,
  sprites,
  terminals,
  easterEggs,
};
