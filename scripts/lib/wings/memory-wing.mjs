// Memory wing (east). Intended identity: green page banks, a cache/buffer
// reservoir, swap/reclaim channels, and a dark OOM fault alcove — a dense,
// horizontal, cellular space (capacity spread across address space, not a
// queue). See PARALLEL_WINGS_PLAN.md, Track A.
//
// This is the independent editing seam for the memory wing: today build() renders
// the shared generic placeholder (themed only by the memory palette in
// resourceConfigs) and the contribution arrays are empty. The owner replaces
// build() with real page-bank geometry and fills textures/flats/sprites/terminals
// — claiming WAD names via wingName("memory", ...) and tags/lights from `ids` so
// nothing collides with the other wings.
import { buildGenericWing } from "./generic-wing.mjs";
import { reserved } from "./registry.mjs";

export const memoryWing = {
  resource: "memory",
  ids: reserved.memory,
  build: (ctx) => buildGenericWing(ctx),
  textures: [],
  flats: [],
  sprites: [],
  terminals: null,
};
