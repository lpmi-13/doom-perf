// Network wing (west). Intended identity: a blue packet switch with RX/TX
// conduits — long, directional, fluid lanes carrying packets, a choke section
// where saturation becomes legible, a drop basin, and a separate error drain.
// Deepens the wing's existing blue hooks. See PARALLEL_WINGS_PLAN.md, Track C.
//
// This is the independent editing seam for the network wing: today build() renders
// the shared generic placeholder (themed only by the network palette in
// resourceConfigs) and the contribution arrays are empty. The owner replaces
// build() with the real conduit-lane geometry and fills textures/flats/sprites/
// terminals — claiming WAD names via wingName("network", ...) and tags/lights from
// `ids` so nothing collides with the other wings.
import { buildGenericWing } from "./generic-wing.mjs";
import { reserved } from "./registry.mjs";

export const networkWing = {
  resource: "network",
  ids: reserved.network,
  build: (ctx) => buildGenericWing(ctx),
  textures: [],
  flats: [],
  sprites: [],
  terminals: null,
};
