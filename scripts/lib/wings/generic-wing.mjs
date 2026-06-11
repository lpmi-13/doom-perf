// Generic placeholder wing. The memory, storage, and network wings each delegate
// here until their owner builds resource-specific geometry, so this shape still
// renders three readable cardinal wings while only the CPU wing is finalized.
// It is themed purely by the resource palette handed in via base/accent (wall,
// floor, ceiling, accent), so the same layout reads as memory/storage/network
// depending on the direction. The geometry below is unchanged from when it lived
// inline in scripts/build-doomperf-map.mjs as the non-CPU branch.
import { addWingEntrance } from "./common.mjs";

export const buildGenericWing = (ctx) => {
  const { areaRect, direction, resource, config, base, accent, outwardSide } = ctx;

  addWingEntrance(ctx);

  // ===== Foyer.
    areaRect(direction, "foyer", { u1: -320, v1: 704, u2: 320, v2: 960 }, {
      ...base,
      kind: "foyer",
      light: 216,
    });

  // ===== Main room, side overlook + steps, gallery, and nook.
    areaRect(direction, "main", { u1: -320, v1: 960, u2: 320, v2: 1280 }, {
      ...accent,
      kind: "main",
      light: 224,
    });
    areaRect(direction, "side", { u1: -512, v1: 832, u2: -320, v2: 1120 }, {
      ...base,
      kind: "side",
      floorFlat: "FLOOR0_1",
      light: 176,
    });
    areaRect(direction, "side-view", { u1: -640, v1: 896, u2: -512, v2: 1056 }, {
      kind: "outside",
      resource,
      floor: 72,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
    areaRect(direction, "step-1", { u1: 320, v1: 1024, u2: 384, v2: 1216 }, {
      ...base,
      kind: "step",
      floor: 8,
      wall: "STEP1",
    });
    areaRect(direction, "step-2", { u1: 384, v1: 1024, u2: 448, v2: 1216 }, {
      ...base,
      kind: "step",
      floor: 16,
      wall: "STEP1",
    });
    areaRect(direction, "step-3", { u1: 448, v1: 1024, u2: 512, v2: 1216 }, {
      ...base,
      kind: "step",
      floor: 24,
      wall: "STEP1",
    });
    areaRect(direction, "overlook", { u1: 512, v1: 960, u2: 640, v2: 1280 }, {
      ...accent,
      kind: "overlook",
      floor: 24,
      ceiling: 216,
      light: 232,
    });
    areaRect(direction, "overlook-view", { u1: 640, v1: 1024, u2: 704, v2: 1216 }, {
      kind: "outside",
      resource,
      floor: 88,
      ceiling: 216,
      floorFlat: "FLOOR7_2",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
    areaRect(direction, "gallery", { u1: -192, v1: 1280, u2: 192, v2: 1568 }, {
      ...base,
      kind: "gallery",
      floor: 16,
      ceiling: 216,
      light: 208,
      labelSide: outwardSide[direction],
      labelTexture: config.labelTexture,
    });
    areaRect(direction, "nook", { u1: -512, v1: 1280, u2: -192, v2: 1504 }, {
      ...accent,
      kind: "nook",
      floorFlat: "FLOOR1_7",
      light: 184,
    });
    areaRect(direction, "nook-view", { u1: -640, v1: 1344, u2: -512, v2: 1472 }, {
      kind: "outside",
      resource,
      floor: 80,
      ceiling: 192,
      floorFlat: "FLOOR7_1",
      ceilingFlat: "F_SKY1",
      wall: "STONE3",
      light: 255,
    });
};
