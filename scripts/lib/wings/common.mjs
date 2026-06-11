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
