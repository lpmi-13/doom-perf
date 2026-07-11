// Storage wing (south): a steampunk I/O tower, rebuilt as a TRUE FLAT-TOP HEXAGON.
// A central solid hex DRUM (the spindle) is ringed by a flush hexagonal PLATTER
// floor (the utilization disk), all wrapped by a hexagonal RING OF CLIMBING STEPS
// that spirals one loop up to the platter summit. FIVE instrument halls branch
// off the ring -- one per free step face, so all six faces (near = entrance) are
// used:
//
//   drum        a solid hex pillar at the centre; its lower faces carry the
//               vertical %util fill + throughput streaks (line tag 664,
//               R_DoomPerfDiskSpindlePixel). centred on world (0,-1024).
//   platter     six trapezoids around the drum forming a flush hex disk floor
//               (utilization display, light sentinel 130, drawn FULLBRIGHT, open
//               to F_SKY1). R_DoomPerfDiskPlatterPixel (patch 0035) fills a round
//               heat-pool inside the hex frame; corners beyond R return sky/bg.
//   step ring   six trapezoidal steps (hex annulus outside the platter rim)
//               rising 24u per face CCW from the near (entrance) face up to the
//               summit, where the climb mounts the raised platter dais.
//   AWAIT hall  off the upper-right (angled) step face: a bank of latency gauges
//               (one-sided MID walls, line tags 660/661/662).
//   THROUGHPUT  off the FAR (axis-aligned) step face -- occluded from the entrance
//     hall      by the central drum, so no long smeary sightline: pneumatic tubes
//               + IO RATE plaque + iostat dashboard (line tag 663) + iostat
//               terminal at the dead end.
//   QUEUE hall  off the lower-left step face via a squared (axis-aligned) chamber
//               so the recessed queue-depth trough stays axis-aligned and patch
//               0023's world-x fill keeps working (light sentinel 134, tag 610).
//   CISTERN     off the lower-right step face (squared chamber): the disk-usage
//     hall      instrument -- a recessed fluid tank whose floor the engine raises
//               with `df /` usage (sector tag 616, DoomPerf_UpdateDiskUsage) plus a
//               df read-point terminal on the back wall.
//   IOPS BANK   off the upper-left step face (squared chamber): a row of four
//     hall      per-device standpipe columns whose floors rise with each device's
//               ops/s (sector tags 630..633, DoomPerf_UpdateDiskDevices) plus an
//               iostat -x read-point terminal on the back wall.
//
// Await (wait time) and queue depth (size) are deliberately SEPARATE instruments in
// SEPARATE halls; the cistern (capacity) and IOPS bank (operations) are the two new
// stations. Every read-point terminal (iostat / df / iostat -x) is a proper
// simulated screen with the server-details control panel below it (controlPanel).
//
// Why a hexagon spiral: like the old square spiral it has no long receding
// sightline (every view dead-ends on a near wall), killing the 320x200 far-wall
// smear by topology -- but the angled 60/120-degree joints read as a hexagon, not
// a box, and the tower is ~25% wider. See [[disk-spiral-smear-fix]],
// [[builder-full-switch-polygon-bsp]], [[map-builder-architecture]],
// [[telemetry-terminal-seam]], [[wing-terminal-segment-rotation]].
//
// Live-instrument contracts preserved: platter = flush hex ring floor, light 130
// + drum centre world (0,-1024) (R_DoomPerfDiskPlatterPixel, patch 0035, R/HUB/
// INNER scaled +25%); spindle drum line tag 664 (texture-space, works on angled
// faces); await gauges = one-sided MID walls, line tags 660/661/662 + wall:gauge
// (NO labelSide, or lineTagFor zeroes the tag); dashboard = line tag 663 on a
// two-sided LOWER texture; queue floor display = light 134 + sector tag 610 (its
// world bounds are hardcoded in patch 0023, updated to the new axis-aligned
// trough box). The iostat terminal read-point is emitted by terminals() in WORLD
// coords.
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

// ===== Flat-top hexagon geometry (local u,v) =====
// All three concentric hexagons share the platter centre (0, CV) -> world (0,-1024)
// so the platter C-shader centre (DOOMPERF_PLATTER_CX/CY) is unchanged. Each is
// flat-top: horizontal NEAR (v = CV - h) and FAR (v = CV + h) faces (axis-aligned),
// with four angled faces between. Radii are circumradii; +25% over the old square
// tower (old platter R 160 -> 200, old drum half-width 80 -> 100).
// Platter centre pushed out (1024 -> 1153) so the much wider step ring still meets
// the entrance throat at the near face (v=704); only the step ring grows, the disk
// + deck keep their size. World centre is now (0,-1153): patch 0035's CY follows.
const CV = 1153;
const SQRT3_2 = Math.sqrt(3) / 2;
const R_DRUM = 100;
const R_PLATTER = 200;
const R_DECK = 296; // hexagonal summit rim around the round disk; wide margin, edges /4-integer
const R_STEP = 518; // ~3x wider step ring (R_STEP - R_DECK = 222u); near face stays at v=704
const FAR_V = CV + Math.round(R_STEP * SQRT3_2); // 1602: far face v (== throughput mouth)

// CCW (V0 near-right .. V5 near-left); see the face map in build().
const hexVerts = (R) => {
  const half = Math.round(R / 2);
  const h = Math.round(R * SQRT3_2);
  return [
    [half, CV - h], // 0 near-right
    [R, CV], //        1 right
    [half, CV + h], // 2 far-right
    [-half, CV + h], // 3 far-left
    [-R, CV], //       4 left
    [-half, CV - h], // 5 near-left
  ];
};
const deckHex = hexVerts(R_DECK);
const stepHex = hexVerts(R_STEP);

// addPoly wants a CLOCKWISE loop (interior on the right). A solid loop is the CCW
// vertex list reversed; a ring trapezoid for slice i is [innerI, innerJ, outerJ,
// outerI] (verified clockwise for this orientation), with the modulo taken from
// the inner ring's length so the same helper serves the 6-face hex rings and the
// 24-ray round rings.
const solid = (loop) => loop.slice().reverse();
const ringTrap = (inner, outer, i) => {
  const j = (i + 1) % inner.length;
  return [inner[i], inner[j], outer[j], outer[i]];
};

// The drum (round spindle) and disk (round platter floor) are 24-gons; the deck
// is a round-inner -> hexagonal-outer ring framing the disk inside the hexagonal
// summit. The 24 rays are the angles of quarter-points walked along the deck
// hexagon's edges -- those points stay EXACTLY integer and on-edge (R_DECK=296,
// every edge vector divisible by 4), so the hexagonal step ring meshes cleanly
// with the round deck. Drum/disk verts sit on concentric circles at those same
// angles, shared EXACTLY with the rings, so no round boundary relies on
// rounding-sensitive collinear meshing.
const polarPt = (r, theta) => [Math.round(r * Math.cos(theta)), Math.round(CV + r * Math.sin(theta))];
const deckOuterPts = [];
for (let i = 0; i < 6; i += 1) {
  const a = deckHex[i];
  const b = deckHex[(i + 1) % 6];
  for (let q = 0; q < 4; q += 1) {
    deckOuterPts.push([a[0] + ((b[0] - a[0]) * q) / 4, a[1] + ((b[1] - a[1]) * q) / 4]);
  }
}
const rayAngles = deckOuterPts.map(([u, v]) => Math.atan2(v - CV, u));
const drumPts = rayAngles.map((theta) => polarPt(R_DRUM, theta));
const diskPts = rayAngles.map((theta) => polarPt(R_PLATTER, theta));

// Outward (away from the climb) chamber off an outer face edge a->b: a quad
// [a, b, b+o, a+o] where o is the rightward normal of a->b scaled by depth. For a
// step's outer edge authored a=stepHex[i] -> b=stepHex[i+1], "right" points away
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
const RISE = 24; // Doom max auto-climb; one step per hex face
const PLATTER_FLOOR = 6 * RISE; // 144: summit, one RISE above the top step
const DRUM_FLOOR = PLATTER_FLOOR + 128; // 272: solid spindle cap, 128-tall streak wall
const C_TOWER = 304; // solid ceiling over the climb
const C_SKY = 384; // open shaft above the platter

// ===== Throughput hall (off the FAR face, floor == far step) =====
const TP_FLOOR = 3 * RISE; // 72: far step floor
const TP_HALF = 160; // hall half-width (fits inside the 370-wide far face)
const TP_CEIL = 280;
const TP_PANEL_Z = TP_FLOOR + 128; // 200: top of the 128-tall display band
const TP_BACK = FAR_V + 288; // 1632: terminal recess front
const TP_TERM_WALL = TP_BACK + 16; // 1648: screen face (one-sided dead end)
const SERVER_PANEL_HEIGHT = 64;
const terminalHalfWidthLocal = terminalTextureSize.width / 2; // 128

// ===== Queue hall (off the lower-left face -> squared axis-aligned chamber) =====
// Anchored to the lower-left step face (stepHex[4..5]) so it follows the hexagon.
// The trough stays an axis-aligned rectangle so patch 0023's world-x fill is
// unchanged (only its bounds move): local u[-750,-590] x v[897,961] maps to world
// x[590,750], y[-961,-897].
const QUEUE_FLOOR = 5 * RISE; // 120: lower-left step floor
const queueFaceMidV = Math.round((stepHex[4][1] + stepHex[5][1]) / 2);
const queueChamber = { u1: stepHex[4][0] - 264, v1: queueFaceMidV - 72, u2: stepHex[4][0] - 40, v2: queueFaceMidV + 72 };
const queueTrough = { u1: queueChamber.u1 + 32, v1: queueChamber.v1 + 40, u2: queueChamber.u2 - 32, v2: queueChamber.v2 - 40 };

// ===== CISTERN hall (off the lower-right face stepHex[0..1], the last free +u
// near face): an angled throat squares up to an axis-aligned chamber holding the
// recessed disk-usage tank (df /, floor display, engine tag 616) with a df read-
// point terminal on its back (+v) wall. Mirrors the queue hall's throat->chamber
// pattern on the opposite (+u) side. =====
const CIST_FLOOR = 1 * RISE; // 24: lower-right step floor
const CIST_CEIL = CIST_FLOOR + 160; // 184
// Inner wall matches the AWAIT hall's offset (+50) so the two +u throats share an
// identical segment at the stepHex[1] vertex (v=1153) — clean two-sided meshing,
// no collinear split. (The IOPS hall likewise matches the QUEUE hall's -40 on -u.)
const CIST_INNER_U = stepHex[1][0] + 50; // 568: inner (near) wall of the +u chamber
const cistChamber = { u1: CIST_INNER_U, v1: 812, u2: CIST_INNER_U + 320, v2: 1116 };
const cistTank = { u1: 606, v1: 900, u2: 830, v2: 1012 }; // engine tag 616 (df / fill)
const CIST_TERM_V = cistChamber.v2; // 1116: screen face on the chamber's back wall
const CIST_TERM_CX = Math.round((cistChamber.u1 + cistChamber.u2) / 2); // 718
const cistTerm = { u1: CIST_TERM_CX - terminalHalfWidthLocal, v1: CIST_TERM_V - 16, u2: CIST_TERM_CX + terminalHalfWidthLocal, v2: CIST_TERM_V };

// ===== IOPS BANK hall (off the upper-left face stepHex[3..4], the last free -u
// far face): a throat squares up to a chamber holding a row of four per-device
// standpipe columns (engine tags 630..633) whose floors rise with each device's
// ops/s, plus an iostat -x read-point terminal on the back (+v) wall. Point-mirror
// of the cistern hall on the -u/far side. =====
const IOPS_FLOOR = 4 * RISE; // 96: upper-left step floor
const IOPS_CEIL = IOPS_FLOOR + 160; // 256
const IOPS_INNER_U = stepHex[4][0] - 40; // -558: inner (near) wall of the -u chamber
const iopsChamber = { u1: IOPS_INNER_U - 320, v1: 1220, u2: IOPS_INNER_U, v2: 1516 };
const IOPS_COL_COUNT = 4;
const IOPS_COL_V1 = 1300;
const IOPS_COL_V2 = 1396;
const IOPS_COL_LEFT = iopsChamber.u1 + 32; // -846: first column's left edge (32u side walk)
const IOPS_COL_WIDTH = 60; // 4x60 = 240 columns; 32/48 side walks fill the 320 span
const IOPS_TERM_V = iopsChamber.v2; // 1516
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
  // (BROWN1). The drum/platter inherit F_SKY1 so the open shaft shows sky above them
  // rather than a sealing upper texture.
  const stepStyle = { ...base, wall: "TEKWALL1", kind: "pit-stair", floorFlat: "FLOOR0_3", ceilingFlat: "CEIL3_2", ceiling: C_TOWER };
  const platterStyle = { ...accent, ceiling: C_SKY, ceilingFlat: "F_SKY1" };
  const hallStyle = { ...accent, floorFlat: "FLOOR4_8", ceilingFlat: "CEIL5_1" };

  // ===== Central SPINDLE drum: a solid round pillar (24-gon); its lower (two-
  // sided) faces carry the vertical utilization fill + streaks (line tag 664). ====
  areaPoly(direction, "spindle-drum", solid(drumPts), {
    ...platterStyle,
    kind: "spindle",
    floor: DRUM_FLOOR,
    ceiling: DRUM_FLOOR, // solid pillar
    floorFlat: "FLOOR0_3",
    wall: "METAL1",
    light: 200,
    lineTag: ids.lineTags[0] + 4, // 664
  });

  // ===== PLATTER: a round disk floor (24 quads between the drum and disk circles,
  // light 130, fullbright, open to F_SKY1). The C platter shader (R=200, centre
  // 0,-1024) is unchanged -- only the sector shape is now round. =====
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
  // hexagonal summit (round inner edge -> hexagonal outer edge). Ordinary light
  // (NOT the 130 sentinel) so the platter shader doesn't paint it; the platter
  // rendering is untouched. =====
  const deckFloor = { ...platterStyle, kind: "platter-deck", floor: PLATTER_FLOOR, floorFlat: "FLOOR0_3", light: 176 };
  for (let k = 0; k < diskPts.length; k += 1) {
    areaPoly(direction, `deck-${k}`, ringTrap(diskPts, deckOuterPts, k), deckFloor);
  }

  // ===== Step ring: six trapezoids climbing 24u per face CCW from the hexagonal
  // DECK rim outward (meshing splits each step's inner edge at the deck's 24 outer
  // points). Face index -> step index k = (i+1)%6, so the near face (i=5) is the
  // foot (k=0) and the climb runs near -> lower-right -> upper-right -> far ->
  // upper-left -> lower-left, then mounts the deck. =====
  const stepFloor = (i) => (((i + 1) % 6) * RISE);
  for (let i = 0; i < 6; i += 1) {
    const k = (i + 1) % 6;
    areaPoly(direction, `step-${i}`, ringTrap(deckHex, stepHex, i), {
      ...stepStyle,
      floor: stepFloor(i),
      light: 168 + k * 4, // brighten toward the summit (skips 160)
    });
  }

  // ===== THROUGHPUT hall (off the FAR face, occluded from the entrance by the
  // drum): pneumatic tubes + iostat dashboard + terminal. =====
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

  // ===== AWAIT hall (off the upper-right angled face, floor == that step): an
  // angled throat squares up to an axis-aligned gauge chamber so the gauge
  // recesses land on integer coords (recesses on an angled wall round off-line and
  // self-overlap). The AWAIT placard rides the throat's far-v wall (labelEdge 1);
  // each gauge is a dead-end recess whose one-sided MID walls carry wall:gauge +
  // lineTag 660/661/662 (NO labelSide, or lineTagFor zeroes the tag). =====
  const F_AWAIT = stepFloor(1); // 48
  // Anchored just outside the upper-right step face (stepHex[1..2]) so it follows
  // the hexagon as the tower scales.
  const awaitFaceMidV = Math.round((stepHex[1][1] + stepHex[2][1]) / 2);
  const awaitChamber = { u1: stepHex[1][0] + 50, v1: awaitFaceMidV - 120, u2: stepHex[1][0] + 170, v2: awaitFaceMidV + 120 };
  const awaitThroat = [
    stepHex[1],
    stepHex[2],
    [awaitChamber.u1, stepHex[2][1]],
    [awaitChamber.u1, stepHex[1][1]],
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

  // ===== QUEUE hall (off the lower-left face): an angled throat squares up to an
  // axis-aligned chamber holding the recessed queue-depth trough (floor display,
  // light 134, sector tag 610; patch 0023 paints request blocks along world-x). ==
  const queueThroat = [
    stepHex[4], // (-370,1024)
    stepHex[5], // (-185,704)
    [queueChamber.u2, stepHex[5][1]], // (-408,704)
    [queueChamber.u2, stepHex[4][1]], // (-408,1024)
  ];
  areaPoly(direction, "queue-throat", queueThroat, {
    ...hallStyle,
    kind: "metric-hall",
    floor: QUEUE_FLOOR,
    ceiling: QUEUE_FLOOR + 128,
    light: 184,
  });
  const rim = {
    ...hallStyle,
    kind: "queue-rim",
    floor: QUEUE_FLOOR,
    ceiling: QUEUE_FLOOR + 128,
    floorFlat: "FLOOR0_3",
    light: 184,
  };
  areaRect(direction, "queue-rim-front", { u1: queueChamber.u1, v1: queueChamber.v1, u2: queueChamber.u2, v2: queueTrough.v1 }, rim);
  areaRect(direction, "queue-rim-back", { u1: queueChamber.u1, v1: queueTrough.v2, u2: queueChamber.u2, v2: queueChamber.v2 }, rim);
  areaRect(direction, "queue-rim-left", { u1: queueChamber.u1, v1: queueTrough.v1, u2: queueTrough.u1, v2: queueTrough.v2 }, rim);
  areaRect(direction, "queue-rim-right", { u1: queueTrough.u2, v1: queueTrough.v1, u2: queueChamber.u2, v2: queueTrough.v2 }, rim);
  areaRect(direction, "queue-channel", queueTrough, {
    ...hallStyle,
    kind: "queue",
    floor: QUEUE_FLOOR - 16,
    ceiling: QUEUE_FLOOR + 128,
    floorFlat: "FLOOR1_7",
    light: ids.lights[0] + 4, // 134
    tag: ids.sectorTags[0] + 10, // 610
  });

  // ===== CISTERN hall (off the lower-right face stepHex[0..1]): the disk-usage
  // instrument. An angled throat squares up to an axis-aligned chamber; a recessed
  // tank (engine tag 616, `df /` fill) sits centred with a walk-around rim, and a
  // df read-point terminal rides the chamber's back (+v) wall. =====
  const cistWalk = { ...hallStyle, kind: "cistern-walk", floorFlat: "FLOOR0_3", light: 184 };
  // No throat placard: the throat's outer edge (edge 1) is the two-sided seam it
  // shares with the adjacent AWAIT throat, which can't carry a label. The hall is
  // identified by its df read-point terminal instead.
  areaPoly(direction, "cist-throat", [stepHex[0], stepHex[1], [CIST_INNER_U, stepHex[1][1]], [CIST_INNER_U, stepHex[0][1]]], {
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
  areaRect(direction, "cist-tank", cistTank, {
    ...cistWalk,
    kind: "cistern",
    floor: 0, // engine drives 0 (empty) .. 22 (brimming); tag 616
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

  // ===== IOPS BANK hall (off the upper-left face stepHex[3..4]): the per-device
  // IOPS instrument. A throat squares up to a chamber holding a row of four device
  // standpipe columns (engine tags 630..633) whose floors rise with each device's
  // ops/s, plus an iostat -x read-point terminal on the back (+v) wall. =====
  const iopsWalk = { ...hallStyle, kind: "iops-walk", floorFlat: "FLOOR0_3", light: 184 };
  // No throat placard (see cist-throat): edge 1 is the two-sided seam shared with
  // the adjacent QUEUE throat. The hall is identified by its iostat -x terminal.
  areaPoly(direction, "iops-throat", [stepHex[3], stepHex[4], [IOPS_INNER_U, stepHex[4][1]], [IOPS_INNER_U, stepHex[3][1]]], {
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
      floor: 76, // engine drives 76 (idle slot) .. 160 (busy bar); tags 630..633
      ceiling: IOPS_CEIL,
      floorFlat: "FLOOR1_7", // a metric-floor FLAT (as the queue channel uses); METAL1 is a wall texture, not a flat
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

export const storageWing = {
  resource: "storage",
  ids,
  build,
  textures,
  flats,
  sprites: [],
  terminals,
  easterEggs,
};
