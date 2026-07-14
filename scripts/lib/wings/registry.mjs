// Reserved-ID registry for the resource wings.
//
// The map's behaviour is keyed off engine-significant numbers (sector tags,
// linedef tags, exact light-level sentinels) and a flat 8-char global WAD name
// space (textures, patches, flats, sprite replacements). Those resources are
// shared across all wings, so two wings built in parallel can silently collide
// on them — a collision git will NOT flag, because each wing edits its own file
// yet both pick, say, sector tag 205 or a flat named "DPM000". This module is the
// one place those allocations are reserved, so each wing can claim from its own
// block without coordinating with the others.
//
// CPU is the legacy wing: its IDs were allocated ad hoc before this registry and
// are recorded here as "occupied" rather than renumbered (renumbering would
// change the generated WAD bytes). New wings must stay inside their own ranges.

// Shared texture names that the central decorate logic (sideTextures in
// build-doomperf-map.mjs) references by name. The texture itself is registered by
// whichever wing currently owns it (the CPU wing today), but the NAME must agree
// in both places, so it lives here.
export const controlPanelTexture = "DPCTRL";
export const controlPanelPatch = "DPPCTRL";

// Per-wing reserved blocks. Ranges are inclusive [lo, hi].
//
// - sectorTags / lineTags: engine tags. CPU's recorded ranges are what it uses
//   today (see cpu-wing.mjs); they are deliberately wide so the new wings start
//   well clear of them.
// - lights: exact light-level values reserved as procedural-display sentinels
//   (the engine switches on these exact numbers). CPU uses 144 and 160 — every
//   wing must keep ordinary lighting off its own and others' sentinel values.
// - namePrefix: the WAD-name prefix a wing may freely allocate under (textures,
//   patches, flats, signs). The four label/door textures (DPCPU/DPMEM/DPDISK/
//   DPNET) and the CPU furniture (DPC*, DPL*, DPF*, DPR*, DPSG*, DPP*) already
//   exist; new wings keep to their prefix so 8-char names never clash.
export const reserved = {
  cpu: {
    sectorTags: [200, 245], // sink mirrors 201-208, lane gates 230-233, io-pen 245
    lineTags: [100, 123], //   base 100, core pillars 101-108, load gauges 121-123
    lights: [144, 160], //     run-queue / core floor-display sentinels
    namePrefixes: ["DPC", "DPL", "DPF", "DPR", "DPSG", "DPP"], // legacy CPU/shared
    // run-queue + I/O-wait orbs (PINS/SOUL); BON1*/BON2* = orb spawn/despawn FX
    // frames (bloom/burst/fade) + completion sparks (engine patch 0037).
    spriteReplacements: ["PINSA0", "SOULA0", "BON1A0", "BON1B0", "BON1C0", "BON1D0", "BON2A0", "BON2B0", "BON2C0", "BON2D0"],
  },
  memory: {
    sectorTags: [500, 559], // page cells 500-544, swap-in/out 546/547, baron pen 548, minor/major fault meters 549/550, RSS-reliquary barrel pads 551-555 (545 retired)
    lineTags: [560, 599],
    lights: [136, 140], // reserved sentinels (unused until live page-bank display)
    namePrefix: "DPM", // DPMEM (label) + DPM... for banks/swap/oom/fault/barrel-pad art
    // The RSS reliquary's barrels (thing 2035) render an OVERSIZED replacement of
    // the IWAD BAR1 sprite (both existing frames) so they read across the plaza.
    // The Memory Well spire's fill books reuse two otherwise-unused single-frame
    // item sprites: SUITA0 (radsuit) -> green working-set book (MT_DP_MEMBOOK),
    // PSTRA0 (berserk) -> blue reclaimable-cache book (MT_DP_MEMBOOKC). See
    // [[pwad-sprite-override-constraint]].
    spriteReplacements: ["BAR1A0", "BAR1B0", "SUITA0", "PSTRA0", "PVISA0"],
  },
  storage: {
    sectorTags: [600, 659],
    lineTags: [660, 699],
    lights: [130, 134], // reserved sentinels (unused until live I/O display)
    namePrefix: "DPD", // DPDISK (label) + DPD... for platters/queue/latency art
    spriteReplacements: [],
  },
  network: {
    sectorTags: [700, 759],
    lineTags: [760, 799],
    lights: [124, 128], // reserved sentinels (unused until live lane display)
    namePrefix: "DPN", // DPNET (label) + DPN... for lanes/choke/drop/error art
    // Packet-orb sprites streaming the two grove lanes (engine network-packets
    // patch). Unlike textures/flats, sprite LUMPS must reuse existing IWAD sprite
    // NAMES + frame letters (the DPN prefix can't apply) — see
    // [[pwad-sprite-override-constraint]]. PINV (A–D) -> cyan RX packet + bloom/
    // fade FX; PMAP (A–D) -> violet TX packet + FX. Both unused by CPU (PINS/
    // SOUL/BON1/BON2).
    spriteReplacements: ["PINVA0", "PINVB0", "PINVC0", "PINVD0", "PMAPA0", "PMAPB0", "PMAPC0", "PMAPD0"],
  },
};

// Allocate a WAD name under a wing's reserved prefix, padded/truncated to Doom's
// 8-char lump-name limit. e.g. wingName("memory", "BANK0") -> "DPMBANK0". Use for
// every new texture/patch/flat a wing introduces so names can't collide.
export const wingName = (resource, suffix) => {
  const prefix = reserved[resource]?.namePrefix;
  if (!prefix) throw new Error(`No reserved name prefix for resource ${resource}`);
  const name = `${prefix}${suffix}`.toUpperCase();
  if (name.length > 8) throw new Error(`WAD name ${name} exceeds 8 chars`);
  return name;
};
