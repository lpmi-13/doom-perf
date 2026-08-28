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
    // SOUL B/C are the D-state ATTRIBUTION tints (amber = blocked on storage,
    // violet = blocked on the network). They live here, not in the storage/network
    // blocks, because the pen and the SOUL name belong to the CPU wing — one wing
    // owns one sprite name, which is the invariant that keeps this registry useful.
    spriteReplacements: ["PINSA0", "SOULA0", "SOULB0", "SOULC0", "BON1A0", "BON1B0", "BON1C0", "BON1D0", "BON2A0", "BON2B0", "BON2C0", "BON2D0"],
  },
  memory: {
    sectorTags: [500, 559], // page cells 500-544 (retired), reclaim-sluice pool 546 + dam gate 547, baron pen 548, minor/major fault meters 549/550, RSS-reliquary barrel pads 551-555, swap tributary 557 + inflow 558 (545 retired)
    lineTags: [560, 599],
    lights: [136, 140], // reserved sentinels (unused until live page-bank display)
    namePrefix: "DPM", // DPMEM (label) + DPM... for banks/swap/oom/fault/barrel-pad art
    // The RSS reliquary's barrels (thing 2035) render an OVERSIZED replacement of
    // the IWAD BAR1 sprite (both existing frames) so they read across the plaza.
    // The Memory Well spire's fill books reuse two otherwise-unused single-frame
    // item sprites for their SHELVED state: SUITA0 (radsuit) -> green working-set
    // book (MT_DP_MEMBOOK), PSTRA0 (berserk) -> blue reclaimable-cache book
    // (MT_DP_MEMBOOKC). Their FLIGHT animation needs five frames apiece, which no
    // item sprite has: BAL1 (imp fireball) and BAL2 (cacodemon fireball) are the
    // last unused multi-frame rot-0 names in the IWAD — nothing in the map fires
    // them (the OOM Baron uses BAL7). See [[pwad-sprite-override-constraint]].
    spriteReplacements: [
      "BAR1A0", "BAR1B0",
      "SUITA0", "PSTRA0",
      "BAL1A0", "BAL1B0", "BAL1C0", "BAL1D0", "BAL1E0",
      "BAL2A0", "BAL2B0", "BAL2C0", "BAL2D0", "BAL2E0",
      "PVISA0",
      // Swap-vent steam. PUFF A-D is vanilla MT_PUFF's own animation, reused so the
      // vent needs no new mobj/state; nothing else in the map spawns puffs (the
      // player firing a hitscan weapon at a wall is the only other source).
      "PUFFA0", "PUFFB0", "PUFFC0", "PUFFD0",
      // Page-fault RANGE (fault-range-volley). Bolt looks: MISL A = gold orb,
      // PLSS A/B = electric arc, BFS1 A = violet streak. Impact styles: MISL B-D =
      // ripple, PLSE A-C = soft absorb, APBX A-C = converging ring, BFE1 A-C =
      // spark spray. Nothing in the lab fires rockets/plasma/BFG/arachno rounds.
      // (These were consumed by the fault range but went UNRECORDED here until the
      // disk wing tried to claim APBX/PLSE -- the collision this registry exists to
      // prevent. Record a claim in the SAME change that spends it.)
      "MISLA0", "MISLB0", "MISLC0", "MISLD0",
      "PLSSA0", "PLSSB0",
      "BFS1A0",
      "PLSEA0", "PLSEB0", "PLSEC0",
      "APBXA0", "APBXB0", "APBXC0",
      "BFE1A0", "BFE1B0", "BFE1C0",
    ],
  },
  storage: {
    sectorTags: [600, 659],
    lineTags: [660, 699],
    lights: [130, 134], // reserved sentinels (unused until live I/O display)
    namePrefix: "DPD", // DPDISK (label) + DPD... for platters/queue/latency art
    // I/O request CIRCUIT orbs (disk queue circuit, DISK_QUEUE_CIRCUIT_PLAN.md).
    // IFOG (item-respawn fog) = amber REQUEST ascending to the platter; TFOG
    // (teleport fog) = silver COMPLETION descending back. Both are 5+-frame rot-0
    // names the IWAD already animates, and the lab has no teleporters and no item
    // respawn, so nothing else can spawn them. Silver, NOT green or cyan -- green
    // is the CPU wing's D-state orb, cyan the network wing's RX packet.
    // Verified free against the C state table, not just this file: APBX/PLSE/BFE1/
    // MISL/PLSS/BFS1 all LOOK free here but are spent by the memory fault range.
    // CEYE A/B (evil-eye decoration, doomednum 41, never spawned in the lab) are
    // overridden as the disk IO QUEUE plate billboards: A = amber device plate,
    // B = red scheduler plate (MT_DP_DISKPLATE, hand-stacked by p_tick.c).
    // TFOG F = the per-device rain-gauge DROP (MT_DP_DISKRAIN, hand-streamed by
    // DoomPerf_UpdateDiskRain). Doom's teleport fog is a 10-frame sprite (A-J); the
    // COMPLETION orb above only spends A-E, so frame F is a free IWAD frame (and the
    // lab still has no teleporters, so nothing else can spawn it).
    spriteReplacements: [
      "IFOGA0", "IFOGB0", "IFOGC0", "IFOGD0", "IFOGE0",
      "TFOGA0", "TFOGB0", "TFOGC0", "TFOGD0", "TFOGE0", "TFOGF0",
      "CEYEA0", "CEYEB0",
    ],
  },
  network: {
    // Three-lock canal (NETWORK_CANAL_PLAN.md). Per-lock/lane pools drive their own
    // floor+light from live fills; the sub-allocations within 700-759 are:
    //   700-705 lock pools  (700+level*2+lane; level 0/1/2 = socket/kernel/ring,
    //           lane 0/1 = rx/tx) -- floor rises with queue fill
    //   710-712 lock gates  (710+level) -- congestion light brightens with saturation
    //   720-725 side drains (720+level*2+lane) -- overspill basin per pool
    //   730     SYN-RECV backlog column (socket-lock alcove)
    //   740-745 trackside signal posts (740+level*2+lane) -- lamp swapped green/red by
    //           the engine off the lane's stall state (network-wing.mjs signalPost)
    //   752-753 socket capacitor BAYS (752+lane) -- floor glow ramps with recv-q/send-q fill
    //           (the travelling-current bead runs faster too); 750-751 free
    //   754-755 ring turbine (RX) / dynamo (TX) instrument-bay floor glow
    //   756-758 kernel-TX QDISC pit (NETWORK_QDISC_DISC_PLAN.md): 756 occupancy disc floor,
    //           757 inflow (enqueue) line, 758 outflow (dequeue) line. 759 free.
    // Lights: gate glow is driven by TAG (no sentinel spent), but 126/127 ARE now spent as
    // floor-display sentinels for the qdisc pit -- 126 = the disc (r_plane -> display 5),
    // 127 = both flow lines (display 6). 124/125/128 stay reserved. These live in the network
    // block on purpose (NOT storage's 130-134): storage owns the disk-platter 130 sentinel.
    // The qdisc instrument's four engine globals + two setters (i_video_ems.c / compat.h):
    //   doomperf_net_qdisc_fill/known  <- DoomPerf_SetNetQdiscFill/Known (browser push)
    //   doomperf_net_qdisc_flow/sat    <- published each tick by p_tick, read by r_draw.
    // Placard textures DPNQDG (QDISC DEPTH) / DPNQDX (QDISC UNKNOWN) swap by texture identity
    // in DoomPerf_UpdateNetQdiscCap. Line tags 760-799 currently unused.
    sectorTags: [700, 759],
    lineTags: [760, 799],
    lights: [124, 128], // 126 = qdisc disc, 127 = qdisc flow-line floor-display sentinels; 124/125/128 free
    namePrefix: "DPN", // DPNET (label) + DPN... for lock pools/gates/drains/signs
    // Packet-orb sprites streaming the two grove lanes (engine network-packets
    // patch). Unlike textures/flats, sprite LUMPS must reuse existing IWAD sprite
    // NAMES + frame letters (the DPN prefix can't apply) — see
    // [[pwad-sprite-override-constraint]]. PINV (A–D) -> cyan RX packet + bloom/
    // fade FX; PMAP (A–D) -> violet TX packet + FX. Both unused by CPU (PINS/
    // SOUL/BON1/BON2). BLUD A/B/C -> softnet Tesla-coil lightning (MT_DP_NETARC): A/B a
    // small flickering bolt, C the tall branchy bolt fired at very high saturation. Blood
    // is never spawned in a combat-free lab, so the frames are free. BFE1 (BFG-burst, no BFG in
    // the lab): A/B/C are the memory-fault SPRK spray (memory wing); D = the blue orbiting/charge
    // MOTE (stock frame D, rendered as-is); E/F -> the VIOLET twin of the drop-spark bolt for the
    // TX ring (MT_DP_NETARC via S_DP_NETARC_V1/2) -- the SAME shape as BLUD A/B, violet rim.
    // COLU A -> the authored capacitor-tower prop (MT_DP_NETCAPTWR); the lab places no stock
    // COLU things, so overriding it is safe. FCAN A/B/C -> the tunnel-mouth ethernet PORT LEDs
    // (MT_DP_NETLED): A green, B yellow, C dark/off. FCAN is the burning-barrel decoration
    // (thing 70), never placed in the lab, so overriding its frames is safe. PLSE D -> the TX
    // ring's big VIOLET mote (S_DP_NETSPIN_V) -- a recolour of stock BFE1 D so it matches the RX
    // blue mote's size; borrowed from PLSE (memory wing owns A/B/C), built in build-doomperf-map.mjs.
    // BFE2 A-D (blue) + SAWG A-D (violet) -> the socket-lock crackle-bolt fragments used by the
    // TRAVELING CURRENT (looping, MT_DP_NETCUR). BFE2 = the BFG-ball burst (no BFG in the lab);
    // SAWG = the chainsaw weapon view (no weapons placed) -- both free. SHTG A-D (blue) + MISF A-D
    // (violet) -> the OVERFLOW FLASHOVER shooting-star COMETS (SOCKET_VIZ_REVAMP_PLAN.md): SHTG =
    // shotgun view, MISF = rocket muzzle-flash -- weapon-view sprites the weaponless lab never draws
    // (the player only ever holds fist/pistol, so PUNG/PISG are the only off-limits view sprites).
    spriteReplacements: ["PINVA0", "PINVB0", "PINVC0", "PINVD0", "PMAPA0", "PMAPB0", "PMAPC0", "PMAPD0", "BLUDA0", "BLUDB0", "BLUDC0", "BFE1D0", "BFE1E0", "BFE1F0", "BFE2A0", "BFE2B0", "BFE2C0", "BFE2D0", "SAWGA0", "SAWGB0", "SAWGC0", "SAWGD0", "SHTGA0", "SHTGB0", "SHTGC0", "SHTGD0", "MISFA0", "MISFB0", "MISFC0", "MISFD0", "PLSED0", "COLUA0", "FCANA0", "FCANB0", "FCANC0"],
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
