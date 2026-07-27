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
//     hall      instrument -- a recessed fluid tank whose floor the engine raises
//               with `df /` usage (sector tag 616, DoomPerf_UpdateDiskUsage) plus a
//               df read-point terminal on the back wall.
//   IOPS BANK   off step face 6 (upper-left, squared chamber): a row of four
//     hall      per-device standpipe columns whose floors rise with each device's
//               ops/s (sector tags 630..633, DoomPerf_UpdateDiskDevices) plus an
//               iostat -x read-point terminal on the back wall.
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
  diskGaugeSize,
  serverRackTextureSize,
  storageDisplayTextureSize,
  buildTerminalPatch,
  buildWallSignPatch,
  buildDiskGaugePatch,
  buildServerRackPatch,
  buildStorageDisplayPatch,
  makeInscription,
  buildShadedOrbPatch,
  buildFxPatch,
} from "../textures.mjs";
import { lump, buildPatch } from "../wad-bytes.mjs";

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
const signs = {
  read: { texture: tex("READ"), patch: tex("PRD"), text: "READ" },
  write: { texture: tex("WRITE"), patch: tex("PWR"), text: "WRITE" },
  rate: { texture: tex("RATE"), patch: tex("PRAT"), text: "IO RATE" },
  await: { texture: tex("AWAIT"), patch: tex("PAWT"), text: "AWAIT" },
};
// Cistern fluid flat: a still, dark storage-medium pool (metallic blue), distinct
// from the memory wing's green swap nukage so a full cistern reads as "capacity",
// not "toxic". The engine drives the tank's floor height + glow (p_tick.c
// DoomPerf_UpdateDiskUsage, sector tag 616); this is just its surface.
const cisternFlat = tex("CIST");
const gauge = { texture: tex("GAUG"), patch: tex("PGAU") };
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

// Cistern fluid flat: a still, dark metallic-blue pool with faint horizontal
// ripple bands (Doom blue ramp ~200..204), distinct from the memory wing's green
// swap nukage so a full cistern reads as "capacity", not "toxic". 64x64 flat.
const buildCisternFlat = () => {
  const size = 64;
  const px = new Uint8Array(size * size).fill(202);
  for (let y = 0; y < size; y += 1) {
    const band = y % 16 < 2 ? 204 : y % 8 < 1 ? 200 : 202;
    for (let x = 0; x < size; x += 1) px[y * size + x] = band;
  }
  return lump(cisternFlat, Buffer.from(px));
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
const TP_BACK = FAR_V + 288; // 1978: terminal recess front
const TP_TERM_WALL = TP_BACK + 16; // 1994: screen face (one-sided dead end)
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

// ===== QUEUE hall (off face 7, lower-left -> squared axis-aligned chamber) =====
// A plain alcove now: the queue-depth trough it used to hold is retired.
// Earmarked for the AWAIT instrument's redesign.
const QUEUE_FACE = 7;
const QUEUE_FLOOR = stepFloor(QUEUE_FACE); // 192
const queueFace = faceSpanV(QUEUE_FACE); // v 893..1197, mid 1045
const QUEUE_INNER_U = stepRing[QUEUE_FACE][0] - 40; // -558: inner wall of the -u chamber
const queueChamber = { u1: QUEUE_INNER_U - 224, v1: queueFace.mid - 72, u2: QUEUE_INNER_U, v2: queueFace.mid + 72 };

// ===== CISTERN hall (off face 1, lower-right): an angled throat squares up to an
// axis-aligned chamber holding the recessed disk-usage tank (df /, floor display,
// engine tag 616) with a df read-point terminal on its back (+v) wall. Mirrors the
// queue hall's throat->chamber pattern on the opposite (+u) side. =====
const CIST_FACE = 1;
const CIST_FLOOR = stepFloor(CIST_FACE); // 48
const CIST_CEIL = CIST_FLOOR + 160; // 208
const cistFace = faceSpanV(CIST_FACE); // v 893..1197, mid 1045
// Inner wall matches the AWAIT hall's offset (+50) so the two +u throats share an
// identical segment at the stepRing[2] vertex (v=1197) — clean two-sided meshing,
// no collinear split. (The IOPS hall likewise matches the QUEUE hall's -40 on -u.)
const CIST_INNER_U = stepRing[CIST_FACE + 1][0] + 50; // 568: inner (near) wall of the +u chamber
const cistChamber = { u1: CIST_INNER_U, v1: cistFace.mid - 132, u2: CIST_INNER_U + 320, v2: cistFace.mid + 132 };
const cistTank = { u1: cistChamber.u1 + 38, v1: cistChamber.v1 + 68, u2: cistChamber.u2 - 58, v2: cistChamber.v1 + 180 };
const CIST_TERM_V = cistChamber.v2; // 1177: screen face on the chamber's back wall
const CIST_TERM_CX = Math.round((cistChamber.u1 + cistChamber.u2) / 2); // 728
const cistTerm = { u1: CIST_TERM_CX - terminalHalfWidthLocal, v1: CIST_TERM_V - 16, u2: CIST_TERM_CX + terminalHalfWidthLocal, v2: CIST_TERM_V };

// ===== IOPS BANK hall (off face 6, upper-left): a throat squares up to a chamber
// holding a row of four per-device standpipe columns (engine tags 630..633) whose
// floors rise with each device's ops/s, plus an iostat -x read-point terminal on
// the back (+v) wall. Mirror of the cistern hall on the -u side. =====
const IOPS_FACE = 6;
const IOPS_FLOOR = stepFloor(IOPS_FACE); // 168
const IOPS_CEIL = IOPS_FLOOR + 160; // 328
const iopsFace = faceSpanV(IOPS_FACE); // v 1197..1501, mid 1349
const IOPS_INNER_U = stepRing[IOPS_FACE + 1][0] - 40; // -558: inner (near) wall of the -u chamber
const iopsChamber = { u1: IOPS_INNER_U - 320, v1: iopsFace.mid - 132, u2: IOPS_INNER_U, v2: iopsFace.mid + 132 };
const IOPS_COL_COUNT = 4;
const IOPS_COL_V1 = iopsChamber.v1 + 68; // 1285
const IOPS_COL_V2 = IOPS_COL_V1 + 96; // 1381
const IOPS_COL_LEFT = iopsChamber.u1 + 32; // -846: first column's left edge (32u side walk)
const IOPS_COL_WIDTH = 60; // 4x60 = 240 columns; 32/48 side walks fill the 320 span
const IOPS_TERM_V = iopsChamber.v2; // 1481
const IOPS_TERM_CX = Math.round((iopsChamber.u1 + iopsChamber.u2) / 2); // -718
const iopsTerm = { u1: IOPS_TERM_CX - terminalHalfWidthLocal, v1: IOPS_TERM_V - 16, u2: IOPS_TERM_CX + terminalHalfWidthLocal, v2: IOPS_TERM_V };

const build = (ctx) => {
  const { areaRect, areaPoly, addAreaThing, direction, base, accent } = ctx;

  addWingEntrance(ctx);

  const backWall = localSideToWorld(direction, "top"); // far/deep wall (local +v)

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
  // iostat terminal: a one-step lectern recess at the dead end; its far one-sided
  // wall carries the DISK IO screen (read-point wired in terminals()). controlPanel
  // puts the keyboard/server-details strip on the step riser below the screen, so
  // it matches the CPU/memory/network terminals (the south back wall rotates to
  // world "bottom", so the labelSide==="top" shortcut can't fire — the flag is
  // required; see isControlPanelRecess in build-doomperf-map.mjs).
  areaRect(direction, "storage-terminal", { u1: -terminalHalfWidthLocal, v1: TP_BACK, u2: terminalHalfWidthLocal, v2: TP_TERM_WALL }, {
    ...hallStyle,
    kind: "terminal",
    floor: TP_FLOOR + 16,
    ceiling: TP_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: backWall, // far wall (local +v) = the screen
    labelTexture: screen.texture,
    controlPanel: true,
  });

  // ===== AWAIT hall (off face 2, the +u face just above the cistern): an angled
  // throat squares up to an axis-aligned gauge chamber so the gauge recesses land
  // on integer coords (recesses on an angled wall round off-line and self-
  // overlap). The AWAIT placard rides the throat's far-v wall (labelEdge 1); each
  // gauge is a dead-end recess whose one-sided MID walls carry wall:gauge +
  // lineTag 660/661/662 (NO labelSide, or lineTagFor zeroes the tag). =====
  const AWAIT_FACE = 2;
  const F_AWAIT = stepFloor(AWAIT_FACE); // 72
  // Anchored just outside step face 2 (stepRing[2..3]) so it follows the ring as
  // the tower scales. Its throat shares the +u inner wall (u=568) with the
  // cistern's, meeting exactly at the stepRing[2] vertex.
  const awaitFace = faceSpanV(AWAIT_FACE); // v 1197..1501, mid 1349
  const awaitChamber = { u1: stepRing[AWAIT_FACE][0] + 50, v1: awaitFace.mid - 120, u2: stepRing[AWAIT_FACE][0] + 170, v2: awaitFace.mid + 120 };
  const awaitThroat = [
    stepRing[AWAIT_FACE],
    stepRing[AWAIT_FACE + 1],
    [awaitChamber.u1, stepRing[AWAIT_FACE + 1][1]],
    [awaitChamber.u1, stepRing[AWAIT_FACE][1]],
  ];
  areaPoly(direction, "await-throat", awaitThroat, {
    ...hallStyle,
    kind: "metric-hall",
    floor: F_AWAIT,
    // Ceiling sits exactly one sign-height (128) above the floor so the AWAIT
    // placard fills the far wall with no vertical tiling; a taller wall repeats the
    // 128-tall sign and shows an empty black partial tile below it.
    ceiling: F_AWAIT + wallSignSize.height,
    light: 188,
    labelEdge: 1, // the far-v throat wall carries the AWAIT placard
    labelTexture: signs.await.texture,
  });
  areaRect(direction, "await-hall", { u1: awaitChamber.u1, v1: awaitChamber.v1, u2: awaitChamber.u2, v2: awaitChamber.v2 }, {
    ...hallStyle,
    kind: "metric-hall",
    floor: F_AWAIT,
    ceiling: F_AWAIT + 160,
    light: 188,
  });
  for (let k = 0; k < 3; k += 1) {
    const v0 = awaitChamber.v1 + 10 + k * 80;
    areaRect(direction, `await-gauge-${k}`, { u1: awaitChamber.u2, v1: v0, u2: awaitChamber.u2 + 40, v2: v0 + 64 }, {
      ...hallStyle,
      kind: "delay-gauge",
      floor: F_AWAIT,
      ceiling: F_AWAIT + 128,
      wall: gauge.texture,
      light: 188,
      lineTag: ids.lineTags[0] + k, // 660/661/662
    });
  }

  // ===== QUEUE hall (off face 7, lower-left): an angled throat squares up to a
  // plain axis-aligned chamber.
  //
  // This hall used to hold the recessed queue-depth TROUGH -- a floor display
  // (light sentinel 134, sector tag 610) that painted request blocks along
  // world-x. That instrument is RETIRED, and so is the hydraulic gutter that
  // briefly replaced it (a flooding channel that rang the climb): queue depth now
  // rides the request circuit's spawn burstiness alone. The chamber is left as a
  // plain alcove; it is the natural home for the AWAIT instrument when that gets
  // its redesign. =====
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
  areaRect(direction, "queue-chamber", queueChamber, {
    ...hallStyle,
    kind: "metric-hall",
    floor: QUEUE_FLOOR,
    ceiling: QUEUE_FLOOR + 128,
    floorFlat: "FLOOR0_3",
    light: 184,
  });

  // ===== CISTERN hall (off face 1, stepRing[1..2]): the disk-usage instrument.
  // An angled throat squares up to an axis-aligned chamber; a recessed tank
  // (engine tag 616, `df /` fill) sits centred with a walk-around rim, and a df
  // read-point terminal rides the chamber's back (+v) wall. =====
  const cistWalk = { ...hallStyle, kind: "cistern-walk", floorFlat: "FLOOR0_3", light: 184 };
  // No throat placard: the throat's outer edge (edge 1) is the two-sided seam it
  // shares with the adjacent AWAIT throat, which can't carry a label. The hall is
  // identified by its df read-point terminal instead.
  areaPoly(direction, "cist-throat", [stepRing[CIST_FACE], stepRing[CIST_FACE + 1], [CIST_INNER_U, stepRing[CIST_FACE + 1][1]], [CIST_INNER_U, stepRing[CIST_FACE][1]]], {
    ...cistWalk,
    kind: "metric-hall",
    floor: CIST_FLOOR,
    ceiling: CIST_CEIL,
  });
  const cistRim = { ...cistWalk, floor: CIST_FLOOR, ceiling: CIST_CEIL };
  areaRect(direction, "cist-front", { u1: cistChamber.u1, v1: cistChamber.v1, u2: cistChamber.u2, v2: cistTank.v1 }, cistRim);
  areaRect(direction, "cist-rim-left", { u1: cistChamber.u1, v1: cistTank.v1, u2: cistTank.u1, v2: cistTank.v2 }, cistRim);
  areaRect(direction, "cist-rim-right", { u1: cistTank.u2, v1: cistTank.v1, u2: cistChamber.u2, v2: cistTank.v2 }, cistRim);
  areaRect(direction, "cist-back", { u1: cistChamber.u1, v1: cistTank.v2, u2: cistChamber.u2, v2: cistTerm.v1 }, cistRim);
  // The tank itself: a shallow fluid basin the engine raises with `df /` usage.
  // DOOMPERF_DISK_CISTERN_LOW/HIGH in p_tick.c are absolute map heights and must
  // track CIST_FLOOR (LOW = CIST_FLOOR - 24, HIGH = LOW + 22).
  areaRect(direction, "cist-tank", cistTank, {
    ...cistWalk,
    kind: "cistern",
    floor: CIST_FLOOR - 24, // engine drives 24 (empty) .. 46 (brimming); tag 616
    ceiling: CIST_CEIL,
    floorFlat: cisternFlat,
    light: 164,
    tag: ids.sectorTags[0] + 16, // 616
  });
  // df terminal on the back wall, flanked by wall so the 256-wide screen seats.
  areaRect(direction, "cist-term-l", { u1: cistChamber.u1, v1: cistTerm.v1, u2: cistTerm.u1, v2: cistTerm.v2 }, cistRim);
  areaRect(direction, "cist-term-r", { u1: cistTerm.u2, v1: cistTerm.v1, u2: cistChamber.u2, v2: cistTerm.v2 }, cistRim);
  areaRect(direction, "cist-terminal", cistTerm, {
    ...cistWalk,
    kind: "terminal",
    floor: CIST_FLOOR + 16,
    ceiling: CIST_FLOOR + 16 + terminalTextureSize.height,
    light: 200,
    labelSide: backWall, // far wall (local +v) = the screen
    labelTexture: usageScreen.texture,
    controlPanel: true,
  });

  // ===== IOPS BANK hall (off face 6, stepRing[6..7]): the per-device IOPS
  // instrument. A throat squares up to a chamber holding a row of four device
  // standpipe columns (engine tags 630..633) whose floors rise with each device's
  // ops/s, plus an iostat -x read-point terminal on the back (+v) wall. =====
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
  areaRect(direction, "iops-front", { u1: iopsChamber.u1, v1: iopsChamber.v1, u2: iopsChamber.u2, v2: IOPS_COL_V1 }, iopsRim);
  areaRect(direction, "iops-left-walk", { u1: iopsChamber.u1, v1: IOPS_COL_V1, u2: IOPS_COL_LEFT, v2: IOPS_COL_V2 }, iopsRim);
  for (let c = 0; c < IOPS_COL_COUNT; c += 1) {
    const u1 = IOPS_COL_LEFT + c * IOPS_COL_WIDTH;
    areaRect(direction, `iops-col-${c}`, { u1, v1: IOPS_COL_V1, u2: u1 + IOPS_COL_WIDTH, v2: IOPS_COL_V2 }, {
      ...iopsWalk,
      kind: "iops-column",
      // DOOMPERF_DISK_DEV_LOW/HIGH in p_tick.c are absolute map heights and must
      // track IOPS_FLOOR (LOW = IOPS_FLOOR - 20, HIGH = LOW + 84).
      floor: IOPS_FLOOR - 20, // engine drives 148 (idle slot) .. 232 (busy bar); tags 630..633
      ceiling: IOPS_CEIL,
      floorFlat: "FLOOR1_7", // a metric-floor FLAT; METAL1 is a wall texture, not a flat
      light: 168,
      tag: ids.sectorTags[0] + 30 + c, // 630..633
    });
  }
  areaRect(direction, "iops-right-walk", { u1: IOPS_COL_LEFT + IOPS_COL_COUNT * IOPS_COL_WIDTH, v1: IOPS_COL_V1, u2: iopsChamber.u2, v2: IOPS_COL_V2 }, iopsRim);
  areaRect(direction, "iops-back", { u1: iopsChamber.u1, v1: IOPS_COL_V2, u2: iopsChamber.u2, v2: iopsTerm.v1 }, iopsRim);
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

// Texture patches this wing contributes: the iostat screen, disk wall signs,
// await gauge, throughput tubes, rack, and live-dashboard fallback art.
const textures = [
  // The three read-point screens (iostat / df / iostat -x), each a CPU-wing-style
  // simulated terminal so they match the rest of the game's terminals.
  ...[screen, usageScreen, iopsScreen].map((s) => ({
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
  {
    texture: gauge.texture,
    patch: gauge.patch,
    width: diskGaugeSize.width,
    height: diskGaugeSize.height,
    build: buildDiskGaugePatch,
  },
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
];

// Floor-name inscription flat ("IO VAULT") + the cistern fluid flat.
const flats = [...ioInscription.flats, buildCisternFlat()];

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
  { sign: "storage", segments: [segment([-terminalHalfWidth, TP_TERM_WALL], [terminalHalfWidth, TP_TERM_WALL])] },
  { sign: "storage-usage", segments: [segment([CIST_TERM_CX - terminalHalfWidth, CIST_TERM_V], [CIST_TERM_CX + terminalHalfWidth, CIST_TERM_V])] },
  { sign: "storage-iops", segments: [segment([IOPS_TERM_CX - terminalHalfWidth, IOPS_TERM_V], [IOPS_TERM_CX + terminalHalfWidth, IOPS_TERM_V])] },
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
