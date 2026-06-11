// Storage wing (south). Intended identity: an amber I/O vault and disk foundry —
// a stepped three-level atrium where requests arrive on an upper balcony, pass a
// controller/service deck, and expose service latency in a lower media pit with
// platter rings. See PARALLEL_WINGS_PLAN.md, Track B.
//
// This is the independent editing seam for the storage wing: today build() renders
// the shared generic placeholder (themed only by the storage palette in
// resourceConfigs) and the contribution arrays are empty. The owner replaces
// build() with the real I/O-vault geometry and fills textures/flats/sprites/
// terminals — claiming WAD names via wingName("storage", ...) and tags/lights from
// `ids` so nothing collides with the other wings.
import { buildGenericWing } from "./generic-wing.mjs";
import { reserved } from "./registry.mjs";

export const storageWing = {
  resource: "storage",
  ids: reserved.storage,
  build: (ctx) => buildGenericWing(ctx),
  textures: [],
  flats: [],
  sprites: [],
  terminals: null,
};
