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
    sectorTags: [200, 245], // sink mirrors 201-208, lane gates 230-237, io-pen 245
    lineTags: [100, 123], //   base 100, core pillars 101-108, load gauges 121-123
    lights: [144, 160], //     run-queue / core floor-display sentinels
    namePrefixes: ["DPC", "DPL", "DPF", "DPR", "DPSG", "DPP"], // legacy CPU/shared
    spriteReplacements: ["PINSA0", "SOULA0"], // run-queue + I/O-wait orbs
  },
  memory: {
    sectorTags: [500, 559],
    lineTags: [560, 599],
    lights: [136, 140], // reserved sentinels (unused until live page-bank display)
    namePrefix: "DPM", // DPMEM (label) + DPM... for banks/cache/swap/oom art
    spriteReplacements: [],
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
    spriteReplacements: [],
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
