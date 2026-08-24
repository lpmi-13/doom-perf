// Shared helpers for the four resource wings (cpu/memory/storage/network). Each
// wing is authored in its own local (u,v) frame with north as identity, then
// rotated onto its cardinal; the orientation helpers below are the one definition
// of that rotation, and the geometry helpers are primitives several wings reuse.

// A side label is stored WORLD-frame, but each wing thinks in local (u,v) sides
// (top +v, right +u, bottom -v, left -u) and converts here. north=0, east=+1,
// south=+2, west=+3 quarter-turns.
export const localSideToWorld = (direction, side) => {
  const turns = { north: 0, east: 1, south: 2, west: 3 }[direction];
  const sides = ["top", "right", "bottom", "left"];
  const index = sides.indexOf(side);
  if (turns === undefined || index === -1) {
    throw new Error(`Cannot rotate side ${side} for direction ${direction}`);
  }
  return sides[(index + turns) % sides.length];
};

// Rotate a local (u,v) point onto its cardinal wing (north is identity).
export const rotatePoint = ([u, v], direction) => {
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

// One convex clockwise ring trapezoid between two concentric rings at face i:
// [inner[i], inner[j], outer[j], outer[i]]. The modulo is taken from the inner
// ring so the same helper serves rings of any side count.
export const ringTrap = (inner, outer, i) => {
  const j = (i + 1) % inner.length;
  return [inner[i], inner[j], outer[j], outer[i]];
};

// Shared wing entrance. Every resource wing begins with the same threshold: a
// hub-facing door carrying the resource's name texture, then a short entry
// throat in the accent wall, before the wing's own foyer and body. Kept here so
// the four wing builders (cpu/memory/storage/network) share one definition of
// that geometry rather than each re-deriving the door sector.
//
// The per-wing builders receive a context object (see scripts/build-doomperf-map.mjs)
// bundling the generic map-builder API (areaRect/addAreaThing) and the shared
// layout constants; this helper consumes the subset it needs from that context.
export const addWingEntrance = (ctx) => {
  const { areaRect, direction, config, base, accent, doorWidth, hubRadius } = ctx;
  areaRect(direction, "door", { u1: -doorWidth / 2, v1: hubRadius, u2: doorWidth / 2, v2: 448 }, {
    ...base,
    kind: "door",
    wall: "DOORTRAK",
    ceiling: 0,
    labelTexture: config.labelTexture,
  });
  areaRect(direction, "entry", { u1: -112, v1: 448, u2: 112, v2: 704 }, {
    ...accent,
    kind: "entry",
    light: 192,
  });
};
