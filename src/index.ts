import { bootstrapEngine } from "./engine_bootstrap";
import { D_DoomMain } from "./d_main";
import { createTelemetryClient, createTerminalOverlay, resolveTelemetrySource } from "./telemetry";
import type {
  TelemetrySnapshot,
  TerminalSign,
  SimCpuTelemetry,
  SimMemoryTelemetry,
  SimStorageTelemetry,
  SimNetworkTelemetry,
} from "./telemetry";
import { createInteractPrompt } from "./interact";
import { createMovementPad } from "./ui/movementPad";
import { createMenuControls, type MenuAction } from "./ui/menuControls";
import { createMenuButton } from "./ui/menuButton";
import { mapManifest } from "./doomperf-map-manifest";
import { playAssetSound, preloadAssetSound } from "./asset_sounds";

// Cache-bust versions injected at build time by scripts/build-web.mjs (content
// hashes of the WAD / engine). Under `--watch` they arrive as the "dev" sentinel,
// which we expand to a runtime timestamp so dev never serves a stale copy.
declare const __WAD_VERSION__: string;
declare const __ENGINE_VERSION__: string;
declare const __IWAD_VERSION__: string;
const assetVersion = (version: string): string => (version === "dev" ? String(Date.now()) : version);

// The prebuilt engine calls emscripten_set_window_title at startup, which sets
// document.title to "DOOM" and clobbers our <title>. Pin the tab to the product
// name by shadowing the title setter so any engine write resolves back to it.
const lockDocumentTitle = (title: string): void => {
  const titleEl = document.querySelector("title") ?? document.head.appendChild(document.createElement("title"));
  titleEl.textContent = title;
  Object.defineProperty(document, "title", {
    configurable: true,
    get: () => title,
    set: () => { titleEl.textContent = title; },
  });
};

// The engine's USE trace reaches USERANGE (linuxdoom p_local.h = 64 map units)
// in front of the player, so pressing space — or tapping the on-screen prompt,
// which synthesizes a space press — only opens a door or activates a terminal
// once the player is within that distance. The interact prompt is gated on the
// same value so it never advertises an interaction the player is still too far
// away to perform. useRange and the terminal/door coordinates below all come
// from the generated map manifest (scripts/build-doomperf-map.mjs) so they can't
// drift out of sync with the actual map layout.
const useRange = mapManifest.useRange;

// World positions (CPU/north wing) of the wall terminal screens. Each carries
// one or more trigger *segments* spanning an interactable face (ax,ay)-(bx,by);
// pressing USE/space within range of a segment — anywhere along the screen, not
// just in front of its centre — opens that terminal. (A terminal has a single
// segment, its screen face.)
type TriggerSegment = { ax: number; ay: number; bx: number; by: number };
// The player's world pose, sampled from the engine for facing/range checks
// (easter eggs, terminals, doors).
type PlayerPose = { active: boolean; x: number; y: number; angleDeg: number };
const copySegments = (segments: readonly TriggerSegment[]): TriggerSegment[] =>
  segments.map(({ ax, ay, bx, by }) => ({ ax, ay, bx, by }));
const terminalSigns: { sign: TerminalSign; segments: TriggerSegment[] }[] =
  mapManifest.terminals.map((terminal) => ({
    sign: terminal.sign,
    segments: copySegments(terminal.segments),
  }));
const terminalRange = useRange;
const easterEggs = mapManifest.easterEggs.map((egg) => ({
  id: egg.id,
  segments: copySegments(egg.segments),
}));

// The four hub doors, one per cardinal exit. These derive from
// build-doomperf-map.mjs: each door sits at hubRadius (384) along its direction
// (north/east/south/west -> +y/+x/-y/-x). Each door carries two trigger
// segments — the inner line at hubRadius and the outer line at doorOuterRadius
// (448) — because both lines bounding the door sector are DR doors, so the
// player can open it from the hub side or from inside the wing. Measuring the
// player's distance to a segment matches the engine's USE trace, which opens the
// door from anywhere along its width — not just dead-centre. Used only to decide
// when to surface the interact prompt; the engine itself handles the door once
// it receives the USE/space press.
// `probe` is a point at the centre of the door sector between the two lines (the
// 64-deep door sector spans hubRadius..448, so its centre is at 416). The engine
// reports that sector's live ceiling opening there, letting us tell a shut door
// from one the player has already opened.
const doorSigns: { segments: TriggerSegment[]; probeX: number; probeY: number }[] =
  mapManifest.doors.map((door) => ({
    segments: copySegments(door.segments),
    probeX: door.probeX,
    probeY: door.probeY,
  }));
const doorRange = useRange;
// A shut DR door reports a ceiling opening of 0; once it has lifted past this
// many map units it is opening/open, so the "Open Door" prompt is suppressed.
const doorOpenThreshold = mapManifest.doorOpenThreshold;

const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const audio = document.getElementById("audio") as HTMLAudioElement | null;
// The loading veil from game/index.html. Shown until the engine renders its
// first frame; until then the on-screen touch controls stay hidden so a phone
// never offers buttons that do nothing.
const loadingOverlay = document.getElementById("loading");

if (!canvas) {
  throw new Error("Missing #canvas canvas element.");
}

if (!audio) {
  throw new Error("Missing #audio element.");
}

// Flipped true once the WASM engine has produced its first frame; gates both
// the loading veil and the touch controls (see updatePrompt / finishLoading).
let engineReady = false;

// Resolve once the engine has drawn its first frame. The engine bumps the
// canvas backing store off its 300x150 default to Doom's native resolution
// (>=320x200) as soon as SDL video is up and drawing, so a size change is our
// "first frame" signal. A timeout fallback guarantees the veil is never stuck
// up if that signal is ever missed.
const waitForFirstFrame = (timeoutMs = 12000): Promise<void> =>
  new Promise((resolve) => {
    // A wall-clock fallback in case rAF is paused (e.g. a backgrounded tab) so
    // the veil never sticks; resolve() is idempotent if the rAF loop wins.
    window.setTimeout(resolve, timeoutMs);
    const tick = () => {
      if (canvas.width > 300 || canvas.height > 150) {
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });

// Reveal the game: mark it interactive (so the controls may appear) and fade
// out the veil, removing the node after the fade so it can't intercept taps.
const finishLoading = () => {
  engineReady = true;
  if (loadingOverlay) {
    loadingOverlay.classList.add("is-hidden");
    window.setTimeout(() => loadingOverlay.remove(), 450);
  }
};

// Let the engine set the canvas backing resolution — CSS stretches it to fill viewport
audio.preload = "auto";

// Touch devices (phones/tablets) get the on-screen movement pad and have the
// engine's drag-to-look suppressed; desktops keep mouse + keyboard untouched.
// `(pointer: coarse)` (the same query interact.ts uses to reposition its button)
// means the primary pointer is touch — true on phones/tablets, false on a
// mouse-driven laptop even if its screen happens to be touch-capable.
const isTouchDevice =
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

// Resume any AudioContext on first user interaction (browser autoplay policy)
const attachAudioUnlock = () => {
  const unlock = () => {
    audio.muted = false;
    audio.volume = 1;
    void audio.play().catch(() => undefined);
  };
  for (const event of ["pointerdown", "keydown", "mousedown", "touchstart"]) {
    window.addEventListener(event, unlock, { once: true });
  }
};

// ?psi=off renders the terminals as if this kernel had no /proc/pressure/memory,
// so the memory-faults terminal's vmstat-derived fallback can be checked without
// finding a CONFIG_PSI=n host. Display only — the collector still reports PSI.
const psiDisabled = new URLSearchParams(window.location.search).get("psi") === "off";
const applyPsiOverride = (telemetry: TelemetrySnapshot): TelemetrySnapshot =>
  psiDisabled
    ? { ...telemetry, memory: { ...telemetry.memory, pressureAvailable: false } }
    : telemetry;

// ?swap=off renders the wing as if the host had no swap device configured, so the
// reclaim sluice's CAPPED vent (welded pipe + "NO SWAP / RELIEF / OOM KILL" placard +
// its brim alarm) and the terminal's OOM relief-path block can be checked without
// finding a swapless host. Unlike ?psi=off this feeds the ENGINE too (not just the
// terminal), so the fittings actually change. LIVE MODE ONLY: the memory sims assert a
// swap-backed host engine-side and deliberately keep doing so, because the capped state
// is a claim about the real host being watched — not something a scenario should
// fabricate. To see it saturated as well, drive real memory pressure on a swapless box.
const swapDisabled = new URLSearchParams(window.location.search).get("swap") === "off";
const applySwapOverride = (telemetry: TelemetrySnapshot): TelemetrySnapshot =>
  swapDisabled
    ? {
        ...telemetry,
        memory: {
          ...telemetry.memory,
          swapTotalBytes: 0,
          swapFreeBytes: 0,
          swapUsedBytes: 0,
          swapInPagesPerSecond: 0,
          swapOutPagesPerSecond: 0,
          swapPagesPerSecond: 0,
        },
      }
    : telemetry;

// ?ring=off / ?qdisc=off force the network canal's ring-lock and kernel-TX-lock
// fallbacks (ring brim omitted -> overruns only; kernel TX uses the tx-drop proxy
// estimate) without needing a host that actually lacks ethtool/tc. Like ?swap=off
// these reach the ENGINE feed, since they change which lock inputs are "known".
const ringDisabled = new URLSearchParams(window.location.search).get("ring") === "off";
const qdiscDisabled = new URLSearchParams(window.location.search).get("qdisc") === "off";

const wadParam = new URLSearchParams(window.location.search).get("wad")?.toLowerCase();
const wadMap: Record<string, string> = {
  freedoom1: "/wads/freedoom1.wad",
};
// Content-hash the IWAD like the map WAD so a slimmed/updated freedoom1.wad is
// fetched fresh instead of served from a stale browser cache.
const iwadPath = wadParam && wadMap[wadParam] ? wadMap[wadParam] : "/wads/freedoom1.wad";
const wadUrl = `${iwadPath}?v=${assetVersion(__IWAD_VERSION__)}`;
const telemetrySource = resolveTelemetrySource();
const doomPerfMapWad = {
  url: `/maps/doomperf-lab.wad?v=${assetVersion(__WAD_VERSION__)}`,
  name: "doomperf-lab.wad",
};
const doomPerfCpuCoreCapacity = 64;
console.log(`Loading WAD from ${wadUrl}.`);

const engineAssetVersion = assetVersion(__ENGINE_VERSION__);
const engineScriptUrl = `/engine/doom.js?v=${engineAssetVersion}`;
const engineWasmUrl = `/engine/doom.wasm?v=${engineAssetVersion}`;
const interactionSound = {
  name: "interaction-sting",
  url: "/assets/sounds/interaction-sting.ogg",
  volume: 11,
} as const;

type DoomPerfEngine = {
  _DoomPerf_SetCpuCoreCount?: (count: number) => void;
  _DoomPerf_SetCpuCore?: (id: number, permille: number) => void;
  _DoomPerf_SetCpuRunQueuePressure?: (permille: number) => void;
  _DoomPerf_SetCpuRunQueueCount?: (count: number) => void;
  _DoomPerf_SetCpuBlockedCount?: (count: number) => void;
  _DoomPerf_SetCpuLoadPressure?: (permille: number) => void;
  // Overall CPU load (per-mille) driving the title wordmark "oo" pulse.
  _DoomPerf_SetTitleLoad?: (permille: number) => void;
  _DoomPerf_SetLoad?: (index: number, milliLoad: number) => void;
  // Storage service time (await) as permille of a 250ms full scale, driving the
  // media-pit latency gauges in the disk wing; and disk busy fraction (%util) in
  // permille, driving the platter's pulsing rings.
  _DoomPerf_SetStorageAwait?: (permille: number) => void;
  // r_await / w_await (worst-await device) as permille of the same 250ms full scale,
  // driving the latency causeway's read/write lanes: the player's crossing speed in
  // each lane is dragged by its await, with a piston beating out the service tempo.
  _DoomPerf_SetStorageReadAwait?: (permille: number) => void;
  _DoomPerf_SetStorageWriteAwait?: (permille: number) => void;
  _DoomPerf_SetStorageUtil?: (permille: number) => void;
  // Disk request-queue depth (iostat aqu-sz) as permille of a 24-request full
  // channel, driving the media-pit queue channel's flowing request blocks.
  _DoomPerf_SetStorageQueue?: (permille: number) => void;
  // Two-tier DISK IO QUEUE fills for the face-7 rack, each a permille: the device
  // tier (in-flight, tag 650) and the scheduler backlog (tag 651). The cap-adaptive
  // scaling is done here in JS (see storageQueueFillPermille); sims 3/4 synthesize.
  _DoomPerf_SetStorageDeviceQueue?: (permille: number) => void;
  _DoomPerf_SetStorageSchedBacklog?: (permille: number) => void;
  // Pulse the media-pit metrics dashboard's IOPS graph (disk server-rack easter
  // egg). The engine decays the spike over a few seconds and scrolls it across
  // the IOPS section.
  _DoomPerf_TriggerStorageIopsSpike?: () => void;
  // Root-filesystem usage (`df /`) as permille of capacity, driving the disk-usage
  // cistern's fluid level.
  _DoomPerf_SetStorageUsage?: (permille: number) => void;
  // Aggregate completed-operations rate (reads+writes/s) as permille of a full
  // scale, driving the metrics-dashboard IOPS graph with the real signal.
  _DoomPerf_SetStorageIops?: (permille: number) => void;
  // Per-device rain gauges: how many tube gauges carry a live device, and each
  // busiest-first device's ops/s (drives rain FALL SPEED) and utilization (drives
  // rain DENSITY + beam brightness), both as permille of a per-device full scale.
  _DoomPerf_SetStorageDeviceCount?: (count: number) => void;
  _DoomPerf_SetStorageDeviceIops?: (index: number, permille: number) => void;
  _DoomPerf_SetStorageDeviceUtil?: (index: number, permille: number) => void;
  // One character of a device's name (slot, position, ASCII code) for the floating
  // in-world gauge labels; the browser uppercases/truncates and writes a 0 terminator.
  _DoomPerf_SetStorageDeviceName?: (slot: number, pos: number, code: number) => void;
  _DoomPerf_SetMemoryUtil?: (permille: number) => void;
  _DoomPerf_SetMemorySaturation?: (permille: number) => void;
  _DoomPerf_SetMemoryErrors?: (permille: number) => void;
  _DoomPerf_SetMemoryCacheFraction?: (permille: number) => void;
  _DoomPerf_SetMemoryProcessCount?: (count: number) => void;
  _DoomPerf_SetMemoryProcessOom?: (index: number, permille: number) => void;
  // Page-fault rates as permille of a reference rate, driving the paging bay's
  // minor/major fault meters in the memory wing.
  _DoomPerf_SetMemoryMinorFaults?: (permille: number) => void;
  _DoomPerf_SetMemoryMajorFaults?: (permille: number) => void;
  // Reclaim sluice swap RELIEF VENT: whether a swap device is configured (0 caps the
  // duct — welded pipe, "NO SWAP / RELIEF / OOM KILL" placard — so a swapless host
  // reads unmistakably) and the swap si+so paging rate (permille) glowing and steaming
  // the vent when present.
  _DoomPerf_SetMemorySwapPresent?: (present: number) => void;
  _DoomPerf_SetMemorySwapActivity?: (permille: number) => void;
  // Fire the Baron-of-Hell OOM-kill event: the baron walks to reliquary barrel
  // `slot` (0 = largest resident set) and detonates it. Called when the live
  // oom_kill counter increments; the memory saturation sim self-fires it engine-side.
  _DoomPerf_TriggerMemoryOomKill?: (slot: number) => void;
  // Network RX/TX throughput as permille of a 1 Gbit reference link, driving the
  // density of the two packet-orb streams in the network wing's grove.
  _DoomPerf_SetNetworkRx?: (permille: number) => void;
  _DoomPerf_SetNetworkTx?: (permille: number) => void;
  // Three-lock canal (NETWORK_CANAL_PLAN.md). Per lock (0/1/2 = socket/kernel/ring)
  // and lane (0/1 = rx/tx): the pool fill (queue occupancy) and its overspill/drop
  // rate. Plus the global softnet squeeze, the socket backlog + SYN-RECV counts, and
  // a per-lane gate on whether the ring depth is known (0 -> the "unknown rim" state).
  _DoomPerf_SetNetLockFill?: (level: number, lane: number, permille: number) => void;
  _DoomPerf_SetNetLockDrops?: (level: number, lane: number, permille: number) => void;
  _DoomPerf_SetNetSoftnetSqueeze?: (permille: number) => void;
  // Pure softnet backlog-drop rate (permille) for the kernel-RX decomposition coils'
  // DROP pillar; distinct from the blended kernel-RX lock-drop so the coil isolates
  // per-CPU input-queue overflow from NIC-ring drops.
  _DoomPerf_SetNetSoftnetDrops?: (permille: number) => void;
  _DoomPerf_SetNetBacklogged?: (count: number) => void;
  _DoomPerf_SetNetSynRecv?: (count: number) => void;
  _DoomPerf_SetNetRingDepthKnown?: (lane: number, known: number) => void;
  // Kernel-TX qdisc floor instrument (NETWORK_QDISC_DISC_PLAN.md): the occupancy disc's fill
  // (real backlog permille, 0 when unknown) and whether tc's backlog is readable (drives the
  // disc's known/unknown mode + the DPNQDG<->DPNQDX "QDISC UNKNOWN" placard swap).
  _DoomPerf_SetNetQdiscFill?: (permille: number) => void;
  _DoomPerf_SetNetQdiscKnown?: (known: number) => void;
  _DoomPerf_GetSimMode?: () => number;
  _DoomPerf_GetEffectiveCpuCoreCount?: () => number;
  _DoomPerf_GetEffectiveCpuCore?: (id: number) => number;
  _DoomPerf_GetEffectiveCpuRunQueuePressure?: () => number;
  _DoomPerf_GetEffectiveCpuBlockedCount?: () => number;
  _DoomPerf_GetEffectiveCpuLoadPressure?: () => number;
  _DoomPerf_GetEffectiveLoad?: (index: number) => number;
  _DoomPerf_PlayerActive?: () => number;
  _DoomPerf_PlayerX?: () => number;
  _DoomPerf_PlayerY?: () => number;
  // Player facing in degrees [0,360): 0 = east (+x), 90 = north (+y).
  _DoomPerf_PlayerAngle?: () => number;
  _DoomPerf_SectorOpenRange?: (x: number, y: number) => number;
};

const getEngine = () =>
  (
    globalThis as {
      DoomEngine?: DoomPerfEngine;
    }
  ).DoomEngine;

const clampRatio = (value: number) => Math.max(0, Math.min(1, value));

// Display full-scale references for the disk IOPS instruments (ops/s at a full
// bar). Unlike %util/await/queue these have no natural 0..1 scale, so we pick a
// reference: the aggregate dashboard graph tops out at STORAGE_IOPS_FULLSCALE and
// each per-device column at STORAGE_DEVICE_IOPS_FULLSCALE. Tunable — raise these if
// a fast NVMe pins the meters; the disk sims give a fixed preview regardless.
const STORAGE_IOPS_FULLSCALE = 10000;
const STORAGE_DEVICE_IOPS_FULLSCALE = 5000;
// Max device-name length for the floating in-world gauge labels (matches the
// engine's DOOMPERF_DEV_NAME_MAX buffer). Longer names are truncated.
const STORAGE_DEVICE_NAME_MAX = 15;

// Rolling high-water marks for the two-tier queue rack. A deep-queue device (NVMe:
// cap 1023+) never approaches tag exhaustion, so its rack fill can't scale to the
// cap or it would read as permanently empty; instead it scales to a slowly-decaying
// peak so occupancy is still legible. The scheduler backlog is unbounded, so it
// always scales to its own peak. Reset would only matter on a device-class change.
const QUEUE_HIGH_WATER_DECAY = 0.995; // per telemetry frame; ~slow bleed toward calm
const QUEUE_SHALLOW_CAP = 64; // at/below this the rack is literal (SATA-class tags)
const queueHighWater = { device: 0 };

// The plate pool the engine stacks per shaft (p_tick.c DOOMPERF_PLATE_MAX). Kept in
// sync here so the browser can drive LITERAL whole-plate COUNTS (one plate per queued
// request) rather than a percentage fill scaled to the pool — which read as ~12
// plates for a 7.8/8 device and didn't match the "N / cap in-flight" terminal.
const DOOMPERF_PLATE_MAX = 12;
// Permille that makes the engine's `permille * MAX / 1000` (integer) land on exactly
// `count` plates — the +0.5 midpoint absorbs the truncation.
const plateCountPermille = (count: number): number =>
  Math.round(clampRatio((Math.max(0, count) + 0.5) / DOOMPERF_PLATE_MAX) * 1000);

// Device-tier plate fill (permille) for the face-7 rack. Shallow cap (SATA-class):
// LITERAL — one plate per in-flight request, topping out at the hardware cap, so the
// stack height reads directly as "N of cap" and matches the terminal. Deep/unknown
// cap (NVMe, 1023+): can't render hundreds of tags as plates, so occupancy scales to
// a slowly-decaying high-water — a moving, readable column that never pegs on noise.
const storageDeviceFillPermille = (storage: TelemetrySnapshot["storage"]): number => {
  const cap = storage.deviceQueueCap ?? 0;
  const dq = Math.max(0, storage.deviceQueue ?? 0);
  if (cap > 0 && cap <= QUEUE_SHALLOW_CAP) {
    return plateCountPermille(Math.min(Math.round(dq), cap, DOOMPERF_PLATE_MAX));
  }
  queueHighWater.device = Math.max(dq, queueHighWater.device * QUEUE_HIGH_WATER_DECAY);
  const ref = Math.max(queueHighWater.device, 4); // floor so noise doesn't slam full
  return Math.round(clampRatio(dq / ref) * 1000);
};

// Scheduler-tier plate fill (permille). The backlog is the tier that TOWERS, so it is
// shown as a LITERAL waiting count (one plate per request) capped at the rack height
// — it climbs above the device rack's shallow cap when the device saturates, and a
// backlog past the rack height simply pegs full (the terminal carries the exact
// number). A deep device keeps this near-empty, matching reality.
const storageSchedFillPermille = (storage: TelemetrySnapshot["storage"]): number => {
  const sb = Math.max(0, storage.schedBacklog ?? 0);
  return plateCountPermille(Math.min(Math.round(sb), DOOMPERF_PLATE_MAX));
};

// Cumulative oom_kill count from the previous LIVE sample. When it rises we fire
// the in-world Baron OOM-kill event once per new kill. This is gated on `isLive`:
// in a scenario we push simulated telemetry (below), whose synthetic oom_kill
// count must never fire the event — the memory saturation sim self-fires it
// engine-side instead.
let lastOomKills: number | undefined;

// Drives the in-world instruments. `telemetry` is the LIVE snapshot in live mode
// and the SIMULATED snapshot in a scenario (stressed active wing + baseline
// others), so the non-active wings' instruments show a simulated baseline rather
// than live host values — the same self-containment the terminals have. Every
// instrument reads a global set below, and the active wing synthesizes its own
// stress engine-side (ignoring the push), so feeding baseline here is what keeps
// the other wings quiet. `isLive` is false in a scenario and gates the one
// side-effecting call (the OOM-kill Baron) to live telemetry only.
const pushTelemetryToEngine = (
  engine: DoomPerfEngine | undefined,
  telemetry: TelemetrySnapshot,
  isLive: boolean
) => {
  const displayCores = telemetry.cpu.cores.filter(({ id }) => id < doomPerfCpuCoreCapacity);
  const lastDisplayCore = displayCores.reduce((largest, { id }) => Math.max(largest, id), -1);
  engine?._DoomPerf_SetCpuCoreCount?.(lastDisplayCore + 1);
  displayCores.forEach(({ id, utilization }) => {
    engine?._DoomPerf_SetCpuCore?.(id, Math.round(utilization * 1000));
  });
  engine?._DoomPerf_SetCpuRunQueuePressure?.(Math.round(telemetry.cpu.runQueuePressure * 1000));
  engine?._DoomPerf_SetCpuRunQueueCount?.(Math.max(0, Math.round(telemetry.cpu.runQueue ?? 0)));
  engine?._DoomPerf_SetCpuBlockedCount?.(Math.max(0, Math.round(telemetry.cpu.blocked ?? 0)));
  engine?._DoomPerf_SetCpuLoadPressure?.(Math.round(telemetry.cpu.loadPressure * 1000));
  engine?._DoomPerf_SetTitleLoad?.(Math.round(telemetry.cpu.loadPressure * 1000));
  engine?._DoomPerf_SetLoad?.(0, Math.round(telemetry.cpu.load1 * 1000));
  engine?._DoomPerf_SetLoad?.(1, Math.round(telemetry.cpu.load5 * 1000));
  engine?._DoomPerf_SetLoad?.(2, Math.round(telemetry.cpu.load15 * 1000));
  // Disk service time (iostat await) for the media-pit latency gauges, scaled to
  // a 250ms full bar — the same scale the iostat terminal's await bar uses. In a
  // disk sim the engine synthesizes its own await, so this live value is ignored.
  engine?._DoomPerf_SetStorageAwait?.(Math.round(clampRatio((telemetry.storage.awaitMillis ?? 0) / 250) * 1000));
  // Latency-causeway lanes. Same 250ms full scale as the aggregate await; the engine
  // slew-limits these so a worst-device switch eases in rather than snapping the
  // player's speed. In disk sims (3/4/5) telemetry.storage IS the sim storage, so the
  // causeway reacts without a real workload; other sims carry the calm baseline.
  engine?._DoomPerf_SetStorageReadAwait?.(Math.round(clampRatio((telemetry.storage.readAwaitMillis ?? 0) / 250) * 1000));
  engine?._DoomPerf_SetStorageWriteAwait?.(Math.round(clampRatio((telemetry.storage.writeAwaitMillis ?? 0) / 250) * 1000));
  engine?._DoomPerf_SetStorageUtil?.(Math.round(clampRatio(telemetry.storage.utilization) * 1000));
  engine?._DoomPerf_SetStorageQueue?.(Math.round(clampRatio((telemetry.storage.queueDepth ?? 0) / 24) * 1000));
  // Two-tier IO queue rack (face-7): device rack + scheduler magazine fills. Sims
  // 3/4 synthesize a shallow-queue signature engine-side, so these are ignored then.
  engine?._DoomPerf_SetStorageDeviceQueue?.(storageDeviceFillPermille(telemetry.storage));
  engine?._DoomPerf_SetStorageSchedBacklog?.(storageSchedFillPermille(telemetry.storage));
  // Root-filesystem usage (`df /`) fills the disk-usage cistern.
  engine?._DoomPerf_SetStorageUsage?.(Math.round(clampRatio(telemetry.storage.usedRatio ?? 0) * 1000));
  // Aggregate IOPS drives the dashboard's (now real) IOPS graph; the per-device
  // breakdown (busiest first) drives the IOPS counter bank's columns. Sims 3/4
  // synthesize their own values engine-side, so these live values are ignored then.
  engine?._DoomPerf_SetStorageIops?.(
    Math.round(clampRatio((telemetry.storage.iops ?? 0) / STORAGE_IOPS_FULLSCALE) * 1000)
  );
  const diskDevices = telemetry.storage.devices ?? [];
  const diskDeviceSlots = 5;
  engine?._DoomPerf_SetStorageDeviceCount?.(Math.min(diskDevices.length, diskDeviceSlots));
  for (let slot = 0; slot < diskDeviceSlots; slot += 1) {
    const device = diskDevices[slot];
    // ops/s -> rain fall speed; %util -> rain density + beam brightness.
    engine?._DoomPerf_SetStorageDeviceIops?.(
      slot,
      device ? Math.round(clampRatio(device.iops / STORAGE_DEVICE_IOPS_FULLSCALE) * 1000) : 0
    );
    engine?._DoomPerf_SetStorageDeviceUtil?.(
      slot,
      device ? Math.round(clampRatio(device.utilization) * 1000) : 0
    );
    // Device name for the floating in-world label: uppercase (the HUD font is
    // uppercase-only) + truncate to the engine's buffer, written char-by-char with a
    // trailing 0 terminator. Empty for an idle slot (no label drawn).
    const label = (device?.name ?? "").toUpperCase().slice(0, STORAGE_DEVICE_NAME_MAX);
    for (let pos = 0; pos <= STORAGE_DEVICE_NAME_MAX; pos += 1) {
      engine?._DoomPerf_SetStorageDeviceName?.(slot, pos, pos < label.length ? label.charCodeAt(pos) : 0);
    }
  }
  engine?._DoomPerf_SetMemoryUtil?.(Math.round(clampRatio(telemetry.memory.utilization) * 1000));
  engine?._DoomPerf_SetMemorySaturation?.(Math.round(clampRatio(telemetry.memory.saturation) * 1000));
  engine?._DoomPerf_SetMemoryErrors?.(Math.round(clampRatio(telemetry.memory.errors) * 1000));
  // Reclaimable page cache (Buffers+Cached) as a fraction of MemTotal, straight
  // from `free -m`/meminfo. Splits the library shelf's books into working-set
  // (green) vs page cache (cyan); 0 when total is unknown so the shelf is all
  // working set rather than guessing.
  const { totalBytes, cachedBytes, buffersBytes } = telemetry.memory;
  const cacheFraction = totalBytes && totalBytes > 0
    ? ((cachedBytes ?? 0) + (buffersBytes ?? 0)) / totalBytes
    : 0;
  engine?._DoomPerf_SetMemoryCacheFraction?.(Math.round(clampRatio(cacheFraction) * 1000));
  // RSS "reliquary": the top processes from `ps -eo pid,rss,comm --sort=-rss`
  // stand as barrels in front of the RSS terminal, slot 0 being the largest
  // resident set. Push each one's kernel OOM badness (/proc/<pid>/oom_score) so
  // the engine can glow a barrel brighter the closer that process is to being
  // the OOM killer's next victim. Live values only — the memory sims (modes 6/7/8)
  // synthesize their own glow engine-side.
  const topRss = telemetry.memory.topRss ?? [];
  const barrelSlots = 5;
  engine?._DoomPerf_SetMemoryProcessCount?.(Math.min(topRss.length, barrelSlots));
  for (let slot = 0; slot < barrelSlots; slot += 1) {
    const proc = topRss[slot];
    engine?._DoomPerf_SetMemoryProcessOom?.(
      slot,
      proc ? Math.round(clampRatio((proc.oomScore ?? 0) / 1000) * 1000) : 0
    );
  }
  // Page-fault rates as permille of reference rates (minor mostly workload at a
  // busy 50k/s reference; major = disk/swap refaults, a saturation signal, at a
  // 200/s reference). Drive the paging bay's two fault meters. Sims 5/6 synthesize
  // their own fault levels engine-side.
  engine?._DoomPerf_SetMemoryMinorFaults?.(
    Math.round(clampRatio((telemetry.memory.minorFaultsPerSecond ?? 0) / 50000) * 1000)
  );
  engine?._DoomPerf_SetMemoryMajorFaults?.(
    Math.round(clampRatio((telemetry.memory.majorFaultsPerSecond ?? 0) / 200) * 1000)
  );
  // Reclaim sluice swap RELIEF VENT: whether swap is configured (swapTotalBytes > 0)
  // so a swapless host renders the duct capped, plus the swap si+so paging rate as
  // permille of a 2500 pages/s reference to glow and steam it when present. Sims 5/6
  // assume a swap-backed host engine-side, so the capped rendering is live-mode only.
  engine?._DoomPerf_SetMemorySwapPresent?.((telemetry.memory.swapTotalBytes ?? 0) > 0 ? 1 : 0);
  engine?._DoomPerf_SetMemorySwapActivity?.(
    Math.round(
      clampRatio(
        ((telemetry.memory.swapInPagesPerSecond ?? 0) + (telemetry.memory.swapOutPagesPerSecond ?? 0)) / 2500
      ) * 1000
    )
  );
  // OOM-kill event: when the live oom_kill counter rises, send the Baron after the
  // hottest resident-set barrel (highest oom_score = the kernel's likeliest victim).
  // Live-only: a scenario's synthetic oom_kill count must not fire it, and we leave
  // lastOomKills tracking the live series so it resumes correctly after the sim.
  if (isLive) {
    const oomKills = telemetry.memory.oomKills ?? 0;
    if (lastOomKills !== undefined && oomKills > lastOomKills) {
      let victim = 0;
      let worst = -1;
      topRss.slice(0, barrelSlots).forEach((proc, slot) => {
        if ((proc.oomScore ?? 0) > worst) {
          worst = proc.oomScore ?? 0;
          victim = slot;
        }
      });
      engine?._DoomPerf_TriggerMemoryOomKill?.(victim);
    }
    lastOomKills = oomKills;
  }
  // ===== Network THREE-LOCK CANAL feed (NETWORK_CANAL_PLAN.md). Two things flow: the
  // packet-orb LANE DENSITY (RX/TX throughput), and the per-lock/lane POOL FILLS +
  // overspill DROPS the canal animates as a packet descends socket -> kernel -> ring.
  const net = telemetry.network;
  const netPm = (ratio: number) => Math.round(clampRatio(ratio) * 1000);
  // Lane density scales to % of the REAL link rate (full-duplex, so each lane may use
  // the whole capacity), so a maxed slow NIC visibly saturates — falling back to a
  // 1 Gbit reference when the collector reports no link speed. The engine maps this
  // through a sqrt gradient to orb density (representative, not one orb per packet).
  const linkRefBytes = net.linkCapacityBps && net.linkCapacityBps > 0 ? net.linkCapacityBps / 8 : 125_000_000;
  engine?._DoomPerf_SetNetworkRx?.(netPm((net.rxBytesPerSecond ?? 0) / linkRefBytes));
  engine?._DoomPerf_SetNetworkTx?.(netPm((net.txBytesPerSecond ?? 0) / linkRefBytes));

  // Reference scales, chosen so a stressed host reads near a pool's brim.
  const SOCKET_Q_FULL = 512 * 1024; // recvq/sendq backlog bytes -> full socket pool
  const SOFTNET_FULL = 200; //         softnet squeeze/s -> full kernel-RX pool
  const KERN_TX_FULL = 100; //         tx-drop proxy /s -> full kernel-TX pool (est.)
  const RING_FIFO_FULL = 100; //       fifo overruns/s -> ring pool pressure proxy
  const DROP_FULL = 100; //            per-lane drop rate/s -> full overspill

  // Socket lock (0): recvq -> RX pool, sendq -> TX pool; a backlogged-accept pile
  // lifts both toward the brim (the socket-lock saturation signal).
  const backlogLift = clampRatio((net.backloggedSockets ?? 0) / 200) * 0.6;
  engine?._DoomPerf_SetNetLockFill?.(0, 0, netPm(Math.max((net.recvQueueBytes ?? 0) / SOCKET_Q_FULL, backlogLift)));
  engine?._DoomPerf_SetNetLockFill?.(0, 1, netPm(Math.max((net.sendQueueBytes ?? 0) / SOCKET_Q_FULL, backlogLift)));
  engine?._DoomPerf_SetNetLockDrops?.(0, 0, 0); // no cheap per-socket drop counter
  engine?._DoomPerf_SetNetLockDrops?.(0, 1, 0);

  // Kernel lock (1): RX = softnet backlog (squeeze), always present; TX = qdisc
  // backlog when known, else a labelled tx-drop proxy. ?qdisc=off forces the proxy.
  // Overspill is direction-scoped: the RX lane surfaces receive-side drops (the
  // softnet backlog drop plus the /proc/net/dev rx-drop column), the TX lane only
  // transmit-side drops — so rx-drops no longer bleed onto the TX lane the way the
  // aggregate dropsPerSecond used to.
  const qdiscKnown = net.qdiscBacklogBytes !== undefined && !qdiscDisabled;
  engine?._DoomPerf_SetNetLockFill?.(1, 0, netPm((net.softnetSqueezePerSecond ?? 0) / SOFTNET_FULL));
  engine?._DoomPerf_SetNetLockFill?.(1, 1, netPm(
    qdiscKnown ? (net.qdiscBacklogBytes ?? 0) / SOCKET_Q_FULL : (net.txDropsPerSecond ?? 0) / KERN_TX_FULL
  ));
  engine?._DoomPerf_SetNetLockDrops?.(1, 0, netPm(
    Math.max(net.softnetDropsPerSecond ?? 0, net.rxDropsPerSecond ?? 0) / DROP_FULL
  ));
  engine?._DoomPerf_SetNetLockDrops?.(1, 1, netPm((net.txDropsPerSecond ?? 0) / DROP_FULL));
  // Kernel-TX QDISC floor disc: fill = the real backlog occupancy when tc is readable, else 0
  // so the disc draws its indeterminate "scanning" state (the red inflow line carries the loss
  // instead). `known` also swaps the DPNQDG "QDISC DEPTH" placard to DPNQDX "QDISC UNKNOWN".
  engine?._DoomPerf_SetNetQdiscKnown?.(qdiscKnown ? 1 : 0);
  engine?._DoomPerf_SetNetQdiscFill?.(qdiscKnown ? netPm((net.qdiscBacklogBytes ?? 0) / SOCKET_Q_FULL) : 0);

  // Ring lock (2): overruns (fifo) are always present; the pool fill is a pressure
  // proxy off the overrun rate (no instantaneous ring occupancy lives in /proc). Ring
  // depth (ethtool) gates only the BRIM line; ?ring=off forces the "unknown rim".
  engine?._DoomPerf_SetNetRingDepthKnown?.(0, net.ringDepthRx !== undefined && !ringDisabled ? 1 : 0);
  engine?._DoomPerf_SetNetRingDepthKnown?.(1, net.ringDepthTx !== undefined && !ringDisabled ? 1 : 0);
  engine?._DoomPerf_SetNetLockFill?.(2, 0, netPm((net.rxFifoPerSecond ?? 0) / RING_FIFO_FULL));
  engine?._DoomPerf_SetNetLockFill?.(2, 1, netPm((net.txFifoPerSecond ?? 0) / RING_FIFO_FULL));
  engine?._DoomPerf_SetNetLockDrops?.(2, 0, netPm((net.rxFifoPerSecond ?? 0) / DROP_FULL));
  engine?._DoomPerf_SetNetLockDrops?.(2, 1, netPm((net.txFifoPerSecond ?? 0) / DROP_FULL));

  // Global + socket-alcove signals: the aggregate softnet squeeze, the socket accept
  // backlog, and the SYN-RECV half-open count (the alcove's backlog column). Plus the
  // pure softnet backlog-drop rate feeding the kernel-RX decomposition coils' DROP
  // pillar — kept SEPARATE from the blended kernel-RX drop above (which folds in the
  // NIC-ring rx-drop) so the coil reads only per-CPU input-queue overflow.
  engine?._DoomPerf_SetNetSoftnetSqueeze?.(netPm((net.softnetSqueezePerSecond ?? 0) / SOFTNET_FULL));
  engine?._DoomPerf_SetNetSoftnetDrops?.(netPm((net.softnetDropsPerSecond ?? 0) / DROP_FULL));
  engine?._DoomPerf_SetNetBacklogged?.(Math.max(0, Math.round(net.backloggedSockets ?? 0)));
  engine?._DoomPerf_SetNetSynRecv?.(Math.max(0, Math.round(net.tcp?.synRecv ?? 0)));
};

// The network saturation sims (RX = mode 10, TX = mode 11) rotate the bottleneck through
// the three stages (0 socket / 1 kernel / 2 NIC ring) instead of saturating the whole
// column at once: a real path has ONE dominant bottleneck, and the stages downstream of it
// are starved (which the engine's gate model reproduces on its own). Every NET_HOT_STAGE_MS
// the active lane's hot stage jumps to a DIFFERENT one at random (+1 or +2 mod 3, so never
// an immediate repeat). RX and TX keep independent rotation state so switching between the
// two demos doesn't reset the other. This is sim-only shaping of the per-stage fill/drops
// the gates already read — no engine change. [[network-trackside-signals]]
const NET_HOT_STAGE_MS = 20000;
const netHotStageByLane = [0, 0]; //  [rx, tx] currently-bottlenecked stage
const netHotSlotByLane = [-1, -1]; // [rx, tx] last NET_HOT_STAGE_MS slot each lane advanced on
const netPickHotStage = (now: number, lane: number): number => {
  const slot = Math.floor(now / NET_HOT_STAGE_MS);
  if (slot !== netHotSlotByLane[lane]) {
    netHotSlotByLane[lane] = slot;
    netHotStageByLane[lane] = (netHotStageByLane[lane] + 1 + Math.floor(Math.random() * 2)) % 3;
  }
  return netHotStageByLane[lane];
};

// A scenario is a SELF-CONTAINED simulation: every resource is synthesized here,
// never read from the host. Only the chosen wing shows its stressed signal; the
// other three show a quiet simulated baseline (identical across scenarios). Live
// host telemetry appears only in live mode (mode 0), which never calls this — so
// this function deliberately takes no live snapshot to read from.
const scenarioTelemetry = (
  engine: DoomPerfEngine | undefined
): TelemetrySnapshot | undefined => {
  const mode = engine?._DoomPerf_GetSimMode?.() ?? 0;
  if (mode < 1 || mode > 11) {
    return undefined;
  }

  const cpuMode = mode === 1 || mode === 2;
  // Disk has THREE scenarios: 3 utilization (busy-healthy), 4 saturation on a
  // SHALLOW device queue (SATA-class cap ~8 → tag exhaustion, the scheduler towers),
  // 5 saturation on a DEEP queue (NVMe cap 1023 → tags never exhaust, so it
  // saturates on %util/await and the scheduler stays near-empty). 4 and 5 are a
  // matched, ADJACENT pair: same %util pegged, opposite queue signatures. Inserting
  // 5 renumbers memory to 6/7/8 and network to 9/10; mirrors m_menu.c mode ordering.
  const diskMode = mode === 3 || mode === 4 || mode === 5;
  const diskSaturated = mode === 4;
  const diskDeep = mode === 5;
  // Memory has THREE scenarios: 5 utilization, 6 saturation on a swap-backed host,
  // 7 the same saturation on a host with NO swap configured. 6 and 7 are a matched
  // pair — identical pressure, one difference (is a relief valve fitted), and every
  // divergence below is a consequence of that one difference. Mirrors the engine's
  // DOOMPERF_SIM_MEM_* modes in p_tick.c; the two must stay in step or the terminal
  // and the room disagree.
  const memoryMode = mode === 6 || mode === 7 || mode === 8;
  const memorySaturated = mode === 7 || mode === 8;
  const memoryNoSwap = mode === 8;
  // Network has THREE scenarios: 9 utilization (throughput pinned, no loss), then a
  // RECEIVE / TRANSMIT saturation pair (10 / 11). In each saturation demo ONE stage of the
  // active direction is the bottleneck at a time (socket / kernel / NIC ring), and it
  // ROTATES every NET_HOT_STAGE_MS — so over a run you watch each gate in turn back a queue
  // up and overspill while the others flow, matching how a real path has a single dominant
  // bottleneck (downstream stages are starved, which the engine's gate model handles). The
  // hot stage folds PRESSURE (steady high fill -> gate red) -> LOSS (drops pulse -> the full
  // queue overspills), the "saturation precedes errors" lesson, without a separate mode.
  const networkMode = mode >= 9 && mode <= 11;
  const netRecvSat = mode === 10; // receive-path saturation (RX lane backs up + drops)
  const netXmitSat = mode === 11; // transmit-path saturation (TX lane backs up + drops)
  const networkSaturated = netRecvSat || netXmitSat;
  const count = Math.max(1, Math.min(doomPerfCpuCoreCapacity, engine?._DoomPerf_GetEffectiveCpuCoreCount?.() ?? 8));
  const now = Date.now();
  // Which single stage is the bottleneck this instant (rotates every NET_HOT_STAGE_MS).
  // Only the hot stage's queue-pressure fields are driven; the rest stay idle so their
  // gates flow green. RX (lane 0) and TX (lane 1) rotate independently.
  const netHotStage = netRecvSat ? netPickHotStage(now, 0) : netXmitSat ? netPickHotStage(now, 1) : -1;
  const socHotRx = netRecvSat && netHotStage === 0;
  const kerHotRx = netRecvSat && netHotStage === 1;
  const ringHotRx = netRecvSat && netHotStage === 2;
  const socHotTx = netXmitSat && netHotStage === 0;
  const kerHotTx = netXmitSat && netHotStage === 1;
  const ringHotTx = netXmitSat && netHotStage === 2;
  // CPU is the stressed signal only in the CPU scenario, where the engine
  // synthesizes the per-core / load / run-queue values and we read them back so
  // the terminal matches the CPU room. In every OTHER scenario those same getters
  // would return the live browser-pushed values, so we synthesize a quiet baseline
  // instead — keeping the scenario free of host telemetry.
  const cores = Array.from({ length: count }, (_, id) => ({
    id,
    utilization: cpuMode
      ? clampRatio((engine?._DoomPerf_GetEffectiveCpuCore?.(id) ?? 0) / 1000)
      : clampRatio(0.09 + 0.035 * Math.abs(Math.sin(now / 1800 + id))),
  }));
  const utilization = cores.reduce((sum, { utilization: core }) => sum + core, 0) / cores.length;
  const runQueuePressure = cpuMode ? clampRatio((engine?._DoomPerf_GetEffectiveCpuRunQueuePressure?.() ?? 0) / 1000) : 0;
  const loadPressure = cpuMode ? clampRatio((engine?._DoomPerf_GetEffectiveCpuLoadPressure?.() ?? 0) / 1000) : 0;
  const cpuPressure = mode === 2 ? Math.max(runQueuePressure, loadPressure) : runQueuePressure;
  const source =
    mode === 1 ? "sim: high CPU utilization"
    : mode === 2 ? "sim: high CPU saturation"
    : mode === 3 ? "sim: high disk utilization"
    : mode === 4 ? "sim: disk saturation, shallow queue"
    : mode === 5 ? "sim: disk saturation, deep queue"
    : mode === 6 ? "sim: high memory utilization"
    : mode === 7 ? "sim: memory saturation, swap configured"
    : mode === 8 ? "sim: memory saturation, no swap configured"
    : mode === 9 ? "sim: high network utilization"
    : mode === 10 ? "sim: network receive saturation"
    : "sim: network transmit saturation";
  // Background memory stats so the memory and vmstat terminals are meaningful in
  // every scenario. Modes 5/6 follow the USE memory lab pattern: mode 5 is a
  // large resident set with low MemAvailable but quiet swap/PSI; mode 6 adds
  // reclaim stalls and swap churn, which is the saturation evidence.
  const gib = 1024 ** 3;
  const genericTotalBytes = 8 * gib;
  const genericMemUtil = clampRatio(0.22 + utilization * 0.12 + cpuPressure * 0.05 + 0.02 * Math.sin(now / 5000));
  const genericCacheFrac = clampRatio(0.4 - genericMemUtil * 0.35);
  const genericFreeFrac = clampRatio(1 - 0.03 - genericCacheFrac - genericMemUtil);
  const genericSwapTotalBytes = 2 * gib;
  const genericSwapUsedBytes = genericMemUtil > 0.85 ? genericTotalBytes * (genericMemUtil - 0.85) * 1.2 : 0;
  const memoryTotalBytes = 16 * gib;
  const memoryWave = Math.abs(Math.sin(now / 2600));
  const memoryAvailableBytes = memorySaturated
    ? (420 + 180 * memoryWave) * 1024 ** 2
    : (1500 + 360 * memoryWave) * 1024 ** 2;
  // No swap device at all in mode 7 — every swap field is zero, not "small". That is
  // what makes the terminal print "(no swap devices)" and the vent render capped.
  const memorySwapTotalBytes = memoryNoSwap ? 0 : 4 * gib;
  const memorySwapUsedBytes = memoryNoSwap
    ? 0
    : memorySaturated
      ? (2450 + 500 * memoryWave) * 1024 ** 2
      : (96 + 48 * memoryWave) * 1024 ** 2;
  const memorySwapIn = memorySaturated && !memoryNoSwap ? 260 + 220 * memoryWave : 0;
  const memorySwapOut =
    memorySaturated && !memoryNoSwap ? 520 + 360 * Math.abs(Math.sin(now / 1900)) : 0;
  // Major faults are the counter-intuitive one. Mode 6 thrashes because pages keep
  // being pushed to swap and dragged back; with no swap those refaults cannot happen,
  // so mode 7's majors are LOW — only file-backed pages (executables, mmap'd files,
  // evicted cache) can fault back in. Higher pressure, fewer major faults.
  const memoryMajorFaults = memoryNoSwap
    ? 22 + 14 * memoryWave
    : memorySaturated
      ? 150 + 90 * memoryWave
      : 2 + 3 * memoryWave;
  // With no swap, page cache is the ONLY reclaimable pool, so it is scoured much
  // harder than mode 6 and direct reclaim runs hotter for less benefit.
  const memoryCachedBytes = memoryNoSwap
    ? 150 * 1024 ** 2
    : memorySaturated
      ? 520 * 1024 ** 2
      : 1500 * 1024 ** 2;
  const memoryBuffersBytes = memoryNoSwap
    ? 28 * 1024 ** 2
    : memorySaturated
      ? 96 * 1024 ** 2
      : 260 * 1024 ** 2;
  // OOM is the relief path in mode 7, so unlike every other scenario it reports real
  // kills — matching the engine's faster baron self-fire (DOOMPERF_OOM_SIM_PERIOD_NOSWAP).
  const memoryOomKills = memoryNoSwap ? 17 + Math.floor(now / 4000) % 9 : 0;
  // Page-frame reclaim throughput, and the %vmeff story it produces. This is where
  // modes 6 and 7 diverge in NUMBERS rather than fittings: reclaim can only free a
  // page it is permitted to evict, and with no swap every anonymous page it walks past
  // is untouchable. So mode 7 scans two-and-a-half times as hard as mode 6 and frees a
  // quarter as much per page examined — the classic swapless signature, and the reason
  // its pool never comes down without a kill. Efficiency is expressed as a ratio here
  // so scan and steal cannot drift into an implausible pairing.
  const memoryScanPages = memoryNoSwap
    ? 46000 + 16000 * memoryWave
    : memorySaturated
      ? 18000 + 6000 * memoryWave
      : 2600 + 800 * memoryWave;
  const memoryVmeff = memoryNoSwap
    ? 0.14 + 0.05 * memoryWave // scanning hard, freeing almost nothing
    : memorySaturated
      ? 0.55 + 0.08 * memoryWave // working for it, but swap lets the work land
      : 0.86 + 0.06 * memoryWave; // healthy: most of what it looks at is evictable
  const memoryStealPages = memoryScanPages * memoryVmeff;
  const simMemory: SimMemoryTelemetry = memoryMode
    ? {
        utilization: clampRatio(1 - memoryAvailableBytes / memoryTotalBytes),
        saturation: memoryNoSwap
          ? clampRatio(0.82 + 0.16 * memoryWave)
          : memorySaturated
            ? clampRatio(0.76 + 0.18 * memoryWave)
            : 0.04,
        // The only scenario that reports OOM errors: with no swap there is no other
        // way for the backlog to come down, so the kill channel is the relief channel.
        errors: memoryNoSwap ? clampRatio(0.62 + 0.3 * memoryWave) : 0,
        totalBytes: memoryTotalBytes,
        freeBytes: memorySaturated ? 190 * 1024 ** 2 : 640 * 1024 ** 2,
        buffersBytes: memoryBuffersBytes,
        cachedBytes: memoryCachedBytes,
        availableBytes: memoryAvailableBytes,
        swapTotalBytes: memorySwapTotalBytes,
        swapFreeBytes: Math.max(0, memorySwapTotalBytes - memorySwapUsedBytes),
        swapUsedBytes: memorySwapUsedBytes,
        swapInPagesPerSecond: memorySwapIn,
        swapOutPagesPerSecond: memorySwapOut,
        swapPagesPerSecond: memorySwapIn + memorySwapOut,
        // Paging: mode 6 (saturation) thrashes — heavy major faults refaulting
        // from disk/swap; mode 5 (utilization) has only light minor-fault churn;
        // mode 7 keeps the workload's minor churn but loses the majors (see above).
        minorFaultsPerSecond: memorySaturated ? 9000 + 5000 * memoryWave : 1200 + 400 * memoryWave,
        majorFaultsPerSecond: memoryMajorFaults,
        pressureAvailable: true,
        pressureSomeAvg10: memorySaturated ? 18 + 10 * memoryWave : 0.35,
        pressureSomeAvg60: memorySaturated ? 15 + 6 * memoryWave : 0.2,
        pressureSomeAvg300: memorySaturated ? 7 + 3 * memoryWave : 0.05,
        pressureSomeTotal: memorySaturated ? 1280000 + Math.round(12000 * memoryWave) : 42000,
        pressureFullAvg10: memorySaturated ? 1.4 + 1.8 * memoryWave : 0,
        pressureFullAvg60: memorySaturated ? 0.8 + 0.8 * memoryWave : 0,
        pressureFullAvg300: memorySaturated ? 0.15 + 0.25 * memoryWave : 0,
        pressureFullTotal: memorySaturated ? 144000 + Math.round(2600 * memoryWave) : 0,
        // vmstat reclaim counters — what the PSI-less fallback reads (?psi=off). A
        // thrashing host refaults hard and drives the allocator into direct reclaim;
        // stallEstimate mirrors the collector's model at a ~1.2ms nominal await.
        // Mode 7 refaults LESS (nothing anonymous to bring back) but scans and direct-
        // reclaims MORE: the allocator keeps walking the LRU looking for something it
        // is allowed to evict, finds only page cache, and stalls doing it. That is the
        // shape of swapless pressure — lots of reclaim work, little relief.
        refaultPagesPerSecond: memoryNoSwap
          ? 420 + 260 * memoryWave
          : memorySaturated
            ? 2400 + 1400 * memoryWave
            : 40 + 30 * memoryWave,
        directReclaimsPerSecond: memoryNoSwap
          ? 96 + 54 * memoryWave
          : memorySaturated
            ? 38 + 22 * memoryWave
            : 0,
        directScanPagesPerSecond: memoryNoSwap
          ? 14000 + 7000 * memoryWave
          : memorySaturated
            ? 5200 + 2600 * memoryWave
            : 0,
        compactStallsPerSecond: memorySaturated ? 3 + 2 * memoryWave : 0,
        scanPagesPerSecond: memoryScanPages,
        stealPagesPerSecond: memoryStealPages,
        // The PSI-less estimate is (majflt + swapin) x await. Mode 7 has neither term
        // to speak of, so the modelled stall would read misleadingly calm on a host
        // that is in fact grinding — direct reclaim is where its stall time actually
        // goes. Fold that in so ?psi=off does not tell a comfortable lie.
        stallEstimate: clampRatio(
          (memoryMajorFaults + memorySwapIn) * 0.0012 +
            (memoryNoSwap ? (96 + 54 * memoryWave) * 0.006 : 0)
        ),
        oomKills: memoryOomKills,
        oomKillsPerSecond: memoryNoSwap ? 0.24 + 0.12 * memoryWave : 0,
        // oomScore mirrors the engine's barrel-glow synthesis for modes 6/7/8
        // (DoomPerf_EffectiveMemoryProcOom — both saturation modes take the
        // full-badness profile), so the terminal's OOM readout and the in-world
        // barrels tell the same story in the demo.
        topRss: memorySaturated
          ? [
              { pid: 4210, rssBytes: 11264 * 1024 ** 2, command: "mem-pressure-worker", oomScore: 950 },
              { pid: 4217, rssBytes: 1870 * 1024 ** 2, command: "allocator-churn", oomScore: 880 },
              { pid: 2891, rssBytes: 780 * 1024 ** 2, command: "doomperf", oomScore: 800 },
              { pid: 1773, rssBytes: 460 * 1024 ** 2, command: "browser", oomScore: 720 },
            ]
          : [
              { pid: 4210, rssBytes: 9728 * 1024 ** 2, command: "mem-resident-worker", oomScore: 520 },
              { pid: 2891, rssBytes: 820 * 1024 ** 2, command: "doomperf", oomScore: 430 },
              { pid: 1773, rssBytes: 440 * 1024 ** 2, command: "browser", oomScore: 360 },
              { pid: 914, rssBytes: 180 * 1024 ** 2, command: "journald", oomScore: 300 },
            ],
      }
    : {
        utilization: genericMemUtil,
        saturation: clampRatio((genericMemUtil - 0.9) * 6),
        errors: 0,
        totalBytes: genericTotalBytes,
        freeBytes: genericTotalBytes * genericFreeFrac,
        buffersBytes: genericTotalBytes * 0.03,
        cachedBytes: genericTotalBytes * genericCacheFrac,
        availableBytes: genericTotalBytes * (genericFreeFrac + genericCacheFrac * 0.85),
        swapTotalBytes: genericSwapTotalBytes,
        swapFreeBytes: Math.max(0, genericSwapTotalBytes - genericSwapUsedBytes),
        swapUsedBytes: genericSwapUsedBytes,
        swapInPagesPerSecond: 0,
        swapOutPagesPerSecond: genericSwapUsedBytes > 0 ? 60 + utilization * 200 : 0,
        swapPagesPerSecond: genericSwapUsedBytes > 0 ? 60 + utilization * 200 : 0,
        minorFaultsPerSecond: 400 + utilization * 2200,
        majorFaultsPerSecond: 0,
        pressureAvailable: true,
        pressureSomeAvg10: 0,
        pressureSomeAvg60: 0,
        pressureSomeAvg300: 0,
        pressureSomeTotal: 0,
        pressureFullAvg10: 0,
        pressureFullAvg60: 0,
        pressureFullAvg300: 0,
        pressureFullTotal: 0,
        refaultPagesPerSecond: 20 + utilization * 60,
        directReclaimsPerSecond: 0,
        directScanPagesPerSecond: 0,
        compactStallsPerSecond: 0,
        // Quiet background reclaim: kswapd ticking over and freeing nearly everything
        // it looks at (~90% vmeff), which is what a healthy host looks like. Non-zero
        // rather than 0, so the CPU/disk/network scenarios don't render "n/a" vmeff
        // and imply the memory instruments are broken.
        scanPagesPerSecond: 900 + utilization * 1400,
        stealPagesPerSecond: (900 + utilization * 1400) * 0.9,
        stallEstimate: 0,
        oomKills: 0,
        oomKillsPerSecond: 0,
        topRss: [
          { pid: 2891, rssBytes: 520 * 1024 ** 2, command: "doomperf", oomScore: 180 },
          { pid: 1773, rssBytes: 310 * 1024 ** 2, command: "browser", oomScore: 120 },
          { pid: 914, rssBytes: 140 * 1024 ** 2, command: "journald", oomScore: 70 },
        ],
      };
  // Storage: the disk sims drive the media to high utilization (mode 3 — pinned
  // busy, but the queue and service time stay low) or full saturation (mode 4 —
  // the request queue and await blow out while throughput plateaus under
  // contention), and also stand up the two other USE axes with their own in-world
  // instruments: root-filesystem capacity (`df /`, the disk-usage CUBE plinth, line
  // tag 665) and per-device IOPS (the IOPS BANK, tags 630-633). In the disk sims
  // the engine synthesizes ALL of these instruments itself (DoomPerf_UpdateDisk*),
  // so the terminal mirrors those synthesized values to tell the same story:
  // mode 3 is ~61% full with a busy-but-healthy bank, mode 4 ~93% full and shallow-
  // queue saturated, mode 5 ~72% full and deep-queue saturated (fast NVMe screaming
  // near its bandwidth ceiling). Every OTHER scenario shows `storageBase` — a quiet, healthy
  // simulated disk (same across all non-disk scenarios), never the host's real
  // stats. Fields map onto the iostat terminal's columns (rkB/s, wkB/s, await,
  // aqu-sz, %util) plus the df / per-device-IOPS terminals.
  const mib = 1024 * 1024;
  const wobble = 0.85 + 0.3 * Math.abs(Math.sin(now / 900));
  const diskSimTotalBytes = 512 * gib;
  const diskSimUsedRatio = diskDeep
    ? clampRatio(0.72 + 0.01 * Math.abs(Math.sin(now / 2100)))
    : diskSaturated
      ? clampRatio(0.93 + 0.008 * Math.abs(Math.sin(now / 2100)))
      : clampRatio(0.61 + 0.012 * Math.abs(Math.sin(now / 2100)));
  // Five block devices, busiest first, in the same ops/s range the engine's rain
  // gauges read. Mode 4 (shallow) runs hotter than mode 3 but is seek-capped;
  // mode 5 (deep) is a fast NVMe SCREAMING near its ceiling, so it pins the bank.
  // The terminal's aggregate is their sum so rows and total stay self-consistent.
  const diskSimDevices = ["nvme0n1", "sda", "sdb", "dm-0", "sdc"].map((name, slot) => ({
    name,
    iops: Math.max(
      0,
      (diskDeep ? 8200 - slot * 900 : diskSaturated ? 3950 - slot * 450 : 2900 - slot * 600) +
        (diskDeep ? 200 : diskSaturated ? 120 : 80) * Math.abs(Math.sin(now / 1400 + slot))
    ),
    utilization: diskDeep
      ? clampRatio(0.97 - slot * 0.03)
      : diskSaturated
        ? clampRatio(0.9 - slot * 0.05)
        : clampRatio(0.7 - slot * 0.08),
  }));
  // The disk-sim branch is guarded by SimStorageTelemetry, so omitting any field a
  // storage terminal reads is a compile error (see src/telemetry/types.ts).
  const storageSim: SimStorageTelemetry = {
    utilization: diskDeep
      ? clampRatio(0.99 + 0.008 * Math.sin(now / 2000))
      : diskSaturated
        ? clampRatio(0.985 + 0.012 * Math.sin(now / 2000))
        : clampRatio(0.93 + 0.045 * Math.sin(now / 2000)),
    // Saturation (not raw utilization) is the health signal: ~100% busy is fine
    // until it actually backs up. Mode 4 backs up in the QUEUE (tag exhaustion);
    // mode 5 backs up in %util + await (a deep device never exhausts tags).
    saturation: diskDeep
      ? clampRatio(0.55 + 0.4 * Math.abs(Math.sin(now / 2300)))
      : diskSaturated
        ? clampRatio(0.6 + 0.4 * Math.abs(Math.sin(now / 2300)))
        : clampRatio(0.05 + 0.04 * Math.abs(Math.sin(now / 1900))),
    errors: 0,
    // aqu-sz total. Mode 4: a shallow queue backed up past the 8.0 bar. Mode 10: a
    // deep queue with MANY in-flight (aqu-sz ≈ in-flight, since almost nothing waits).
    queueDepth: diskDeep ? 92 + 42 * Math.abs(Math.sin(now / 1700)) : diskSaturated ? 13 + 6 * Math.abs(Math.sin(now / 1700)) : 1.3 + 0.6 * Math.abs(Math.sin(now / 1500)),
    // Two-tier split. Mode 4: shallow cap (8), device PEGS at its rim and the
    // scheduler backlog towers. Mode 10: deep cap (1023), in-flight rises but stays
    // FAR under the cap and the scheduler stays near-empty. Mode 3: a few in flight.
    deviceQueueCap: diskDeep ? 1023 : 8,
    deviceQueue: diskDeep ? 92 + 40 * Math.abs(Math.sin(now / 1900)) : diskSaturated ? 7.6 + 0.4 * Math.abs(Math.sin(now / 1900)) : 1.0 + 0.4 * Math.abs(Math.sin(now / 1600)),
    schedBacklog: diskDeep ? 0.4 + 0.4 * Math.abs(Math.sin(now / 1700)) : diskSaturated ? 6 + 6 * Math.abs(Math.sin(now / 1700)) : 0.3 + 0.2 * Math.abs(Math.sin(now / 1500)),
    // await (ms): mode 4 climbs toward a quarter-second (queue wait); mode 5 is
    // elevated but far lower (fast media, just maxed); mode 3 stays single digit.
    awaitMillis: diskDeep ? 48 + 26 * Math.abs(Math.sin(now / 1300)) : diskSaturated ? 165 + 55 * Math.abs(Math.sin(now / 1300)) : 6.5 + 3 * Math.abs(Math.sin(now / 1100)),
    // Read/write await bracket the combined await and shimmer on their own phases so
    // the causeway's two lanes visibly diverge; writes run slower than reads (the
    // common asymmetry — read-ahead helps reads, write-back stalls under pressure).
    readAwaitMillis: diskDeep ? 36 + 20 * Math.abs(Math.sin(now / 1250)) : diskSaturated ? 120 + 45 * Math.abs(Math.sin(now / 1250)) : 5 + 2.5 * Math.abs(Math.sin(now / 1050)),
    writeAwaitMillis: diskDeep ? 62 + 30 * Math.abs(Math.sin(now / 1350)) : diskSaturated ? 210 + 60 * Math.abs(Math.sin(now / 1350)) : 8 + 3.5 * Math.abs(Math.sin(now / 1150)),
    // Throughput: shallow-saturated media serves SLOWLY (seek-bound); the deep device
    // is bandwidth-bound, moving data near its ceiling; mode 3 is merely busy.
    readBytesPerSecond: (diskDeep ? 1250 : diskSaturated ? 96 : 168) * mib * wobble,
    writeBytesPerSecond: (diskDeep ? 820 : diskSaturated ? 64 : 120) * mib * wobble,
    iops: diskSimDevices.reduce((sum, d) => sum + d.iops, 0),
    devices: diskSimDevices,
    totalBytes: diskSimTotalBytes,
    usedBytes: diskSimTotalBytes * diskSimUsedRatio,
    availBytes: diskSimTotalBytes * (1 - diskSimUsedRatio),
    usedRatio: diskSimUsedRatio,
  };
  // Quiet baseline disk for every non-disk scenario: ~45% full, light I/O, low
  // await, a calm 5-device bank. Also SimStorageTelemetry-guarded, so it can never
  // silently drop a field a storage terminal reads.
  const baseDiskUsedRatio = 0.45;
  const baseDiskDevices = ["nvme0n1", "sda", "sdb", "dm-0", "sdc"].map((name, slot) => ({
    name,
    iops: Math.max(0, 240 - slot * 55 + 40 * Math.abs(Math.sin(now / 1600 + slot))),
    utilization: clampRatio(0.06 - slot * 0.012 + 0.02 * Math.abs(Math.sin(now / 1500 + slot))),
  }));
  const storageBase: SimStorageTelemetry = {
    utilization: clampRatio(0.05 + 0.03 * Math.abs(Math.sin(now / 1700))),
    saturation: 0,
    errors: 0,
    queueDepth: 0.2 + 0.2 * Math.abs(Math.sin(now / 1500)),
    deviceQueueCap: 8,
    deviceQueue: 0.15 + 0.15 * Math.abs(Math.sin(now / 1500)),
    schedBacklog: 0.05 + 0.05 * Math.abs(Math.sin(now / 1500)),
    awaitMillis: 1.6 + 1.2 * Math.abs(Math.sin(now / 1300)),
    readAwaitMillis: 1.2 + 0.9 * Math.abs(Math.sin(now / 1250)),
    writeAwaitMillis: 2.0 + 1.4 * Math.abs(Math.sin(now / 1350)),
    readBytesPerSecond: (7 + 5 * Math.abs(Math.sin(now / 1100))) * mib,
    writeBytesPerSecond: (5 + 4 * Math.abs(Math.sin(now / 1250))) * mib,
    iops: baseDiskDevices.reduce((sum, d) => sum + d.iops, 0),
    devices: baseDiskDevices,
    totalBytes: diskSimTotalBytes,
    usedBytes: diskSimTotalBytes * baseDiskUsedRatio,
    availBytes: diskSimTotalBytes * (1 - baseDiskUsedRatio),
    usedRatio: baseDiskUsedRatio,
  };
  const simStorage: SimStorageTelemetry = diskMode ? storageSim : storageBase;

  // Network: the network scenario drives the link to high utilization (mode 9 —
  // throughput pinned near line rate, but drops stay near zero) or full saturation
  // (mode 10 — the link is maxed and packets start dropping while throughput
  // plateaus under contention); every other scenario shows `networkBase`, a quiet
  // simulated link (same across all non-network scenarios), never the host's real
  // stats. The fields map straight onto the /proc/net/dev terminal's columns
  // (rx/tx kB/s, drops/s, errs/s) and its util/saturation/errors bars.
  const linkBeat = 0.85 + 0.3 * Math.abs(Math.sin(now / 1000));
  const netWave = Math.abs(Math.sin(now / 1700));
  // Two interfaces: eth0 carries the bulk, eth1 idles alongside. The grove reflects
  // the AGGREGATE, so the top-level rx/tx below is their sum (as the real collector
  // reports it).
  const eth0Rx = (networkSaturated ? 116 : 108) * mib * linkBeat;
  const eth0Tx = (networkSaturated ? 92 : 84) * mib * linkBeat;
  const eth1Rx = (2 + 3 * netWave) * mib;
  const eth1Tx = (1 + 2 * netWave) * mib;
  const netRx = eth0Rx + eth1Rx; // aggregate rx (drives the grove)
  const netTx = eth0Tx + eth1Tx; // aggregate tx
  // TCP census: high-utilization is a busy-but-healthy server (many ESTABLISHED,
  // modest TIME-WAIT); saturation adds the pathology the patch-panel wall reads —
  // a SYN-RECV accept backlog, a TIME-WAIT/CLOSE-WAIT pile from churn, established
  // plateauing. Counts feed both the sockets terminal and (later) the wall glow.
  const netEstab = networkSaturated ? 1500 + Math.round(80 * netWave) : 1800 + Math.round(120 * netWave);
  const netTimeWait = networkSaturated ? 2400 + Math.round(300 * netWave) : 380 + Math.round(60 * netWave);
  const netSynRecv = socHotRx ? 160 + Math.round(60 * netWave) : 6;
  const netCloseWait = networkSaturated ? 120 + Math.round(30 * netWave) : 4;
  const netListen = 12;
  const netClosing = networkSaturated ? 8 : 0;
  const netTcp = {
    established: netEstab,
    synRecv: netSynRecv,
    timeWait: netTimeWait,
    closeWait: netCloseWait,
    listen: netListen,
    closing: netClosing,
    total: netEstab + netTimeWait + netSynRecv + netCloseWait + netListen + netClosing,
  };
  // Send/Recv-Q backlog is the STEADY queue-pressure signal: near-zero under high-
  // utilization (throughput pinned but draining fine), high and sustained under its
  // direction's saturation — inbound app-read lag (RecvQ, receive) / outbound peer-
  // drain lag (SendQ, transmit). Held high across the whole sim so the saturation
  // reads even in the loss troughs (pressure persists; only the drops come and go).
  // A hot stage sits in a HIGH BAND that dips and brims with netWave, so its gate stays RED
  // (a queue is always present) but only OVERFLOWS -- sheds drops -- near the brim. The
  // 0.5*mib / 200 / 100 scales below match the SOCKET_Q_FULL / SOFTNET_FULL / RING_FIFO_FULL
  // divisors in refreshEffectiveTelemetry, so netHotFill maps straight onto the fill permille.
  const netHotFill = 0.62 + 0.55 * netWave; // ~0.62..1.17 of full -> ~620..1000 permille
  const netRecvQ = socHotRx ? netHotFill * 0.5 * mib : 12 * 1024;
  const netSendQ = socHotTx ? netHotFill * 0.5 * mib : 48 * 1024;
  // Loss PULSES against that steady pressure: netLossPulse dips through ~0 each cycle,
  // so a saturated lane visibly brims (pressure high, drops ~0) and then overspills
  // (drops spike) on the same run. Receive-sat drops on the RX side only, transmit-sat
  // on the TX side; dropsPerSecond is their sum (the loss half of USE Saturation, the
  // steady queue/softnet backlog being the pressure half).
  const netLossPulse = Math.abs(Math.sin(now / 1500));
  const netRxDrops = kerHotRx ? 760 * netLossPulse : 0;
  const netTxDrops = kerHotTx ? 640 * netLossPulse : 0;
  // The network-sim branch is guarded by SimNetworkTelemetry, so omitting any
  // field a network terminal reads is a compile error (see src/telemetry/types.ts).
  const networkSim: SimNetworkTelemetry = {
        utilization: networkSaturated
          ? clampRatio(0.965 + 0.03 * Math.sin(now / 2100))
          : clampRatio(0.9 + 0.06 * Math.sin(now / 2100)),
        // Saturation (not raw utilization) is the health signal: a maxed link is
        // fine until packets are dropped, which only mode 8 does.
        saturation: networkSaturated
          ? clampRatio(0.6 + 0.38 * Math.abs(Math.sin(now / 2200)))
          : clampRatio(0.04 + 0.04 * Math.abs(Math.sin(now / 1800))),
        errors: 0,
        // ~1 GbE link (≈125 MB/s each way); the saturated link carries a little
        // less than the merely-busy one as contention caps goodput.
        rxBytesPerSecond: netRx,
        txBytesPerSecond: netTx,
        // drops/s pulse against the steady queue pressure, on one direction at a time so
        // the terminal names rx-drops vs tx-drops and the receive/transmit demos isolate
        // each; NIC errors are a separate signal kept at zero here.
        dropsPerSecond: netRxDrops + netTxDrops,
        rxDropsPerSecond: netRxDrops,
        txDropsPerSecond: netTxDrops,
        errorsPerSecond: 0,
        // eth0 is the primary (noisiest) NIC, eth1 idles alongside, so the interface
        // terminal shows a real breakdown with a marked primary; their rx/tx sum to
        // the aggregate (netRx/netTx) the grove shows.
        primaryInterface: "eth0",
        interfaces: [
          { name: "eth0", rxBytesPerSecond: eth0Rx, txBytesPerSecond: eth0Tx },
          { name: "eth1", rxBytesPerSecond: eth1Rx, txBytesPerSecond: eth1Tx },
        ],
        tcp: netTcp,
        recvQueueBytes: netRecvQ,
        sendQueueBytes: netSendQ,
        backloggedSockets: socHotRx ? 130 + Math.round(30 * netWave) : 2,
        topSockets: networkSaturated
          ? [
              { local: "10.0.0.5:443", remote: "203.0.113.9:52344", state: "ESTAB", recvQueueBytes: 0.2 * mib, sendQueueBytes: (1.4 + 0.3 * netWave) * mib },
              { local: "10.0.0.5:443", remote: "198.51.100.7:41022", state: "ESTAB", recvQueueBytes: (0.9 + 0.2 * netWave) * mib, sendQueueBytes: 0.1 * mib },
              { local: "10.0.0.5:8080", remote: "192.0.2.44:33900", state: "CLOSE-WAIT", recvQueueBytes: (0.5 + 0.1 * netWave) * mib, sendQueueBytes: 0 },
            ]
          : [
              { local: "10.0.0.5:443", remote: "203.0.113.9:52344", state: "ESTAB", recvQueueBytes: 0, sendQueueBytes: 24 * 1024 },
            ],
        // Per-stage lock signals, driven for the ONE hot stage of the active lane (the
        // rotating bottleneck): its fill sits in netHotFill's high band so its gate stays
        // shut/red, and its drops pulse so the full queue overspills near the brim. The
        // OTHER two stages read idle here, so their gates flow green. Which stage is hot
        // (socket/kernel/ring) cycles every NET_HOT_STAGE_MS; see netPickHotStage above.
        // Socket = recvQ/sendQ + accept backlog; kernel = softnet squeeze / qdisc + drops;
        // ring = rx/tx fifo overruns.
        softnetSqueezePerSecond: kerHotRx ? netHotFill * 200 : 6,
        softnetDropsPerSecond: kerHotRx ? 130 * netLossPulse : 0,
        rxFifoPerSecond: ringHotRx ? netHotFill * 100 : 0,
        txFifoPerSecond: ringHotTx ? netHotFill * 100 : 0,
        ringDepthRx: 1024,
        ringDepthTx: 1024,
        qdiscBacklogBytes: kerHotTx ? netHotFill * 0.5 * mib : 4 * 1024,
        linkCapacityBps: 1_000_000_000,
  };
  // Calm baseline link for every non-network scenario: a lightly-used eth0 (~11%
  // of a 1 GbE link) with eth1 idle, a small healthy TCP census, empty queues. The
  // level matches the packet grove's own engine-side ambient stream in non-network
  // sims (DoomPerf_EffectiveNetworkValue default) so the grove and this terminal
  // agree. SimNetworkTelemetry-guarded so it can't silently drop a read field.
  const baseEth0Rx = (12 + 3 * netWave) * mib;
  const baseEth0Tx = (9 + 3 * netWave) * mib;
  const baseEth1Rx = 0.6 * mib;
  const baseEth1Tx = 0.4 * mib;
  const baseEstab = 42 + Math.round(6 * netWave);
  const baseTimeWait = 18 + Math.round(4 * netWave);
  const baseListen = 12;
  const networkBase: SimNetworkTelemetry = {
    utilization: clampRatio(0.11 + 0.025 * Math.abs(Math.sin(now / 1900))),
    saturation: 0,
    errors: 0,
    rxBytesPerSecond: baseEth0Rx + baseEth1Rx,
    txBytesPerSecond: baseEth0Tx + baseEth1Tx,
    dropsPerSecond: 0,
    rxDropsPerSecond: 0,
    txDropsPerSecond: 0,
    errorsPerSecond: 0,
    primaryInterface: "eth0",
    interfaces: [
      { name: "eth0", rxBytesPerSecond: baseEth0Rx, txBytesPerSecond: baseEth0Tx },
      { name: "eth1", rxBytesPerSecond: baseEth1Rx, txBytesPerSecond: baseEth1Tx },
    ],
    tcp: {
      established: baseEstab,
      timeWait: baseTimeWait,
      listen: baseListen,
      total: baseEstab + baseTimeWait + baseListen,
    },
    recvQueueBytes: 4 * 1024,
    sendQueueBytes: 12 * 1024,
    backloggedSockets: 0,
    topSockets: [
      { local: "10.0.0.5:443", remote: "203.0.113.9:52344", state: "ESTAB", recvQueueBytes: 0, sendQueueBytes: 8 * 1024 },
    ],
    // Quiet canal: no backlog, no overruns; the ring depth/qdisc are left unknown so
    // the non-network sims exercise the honest fallbacks too.
    softnetSqueezePerSecond: 0,
    softnetDropsPerSecond: 0,
    rxFifoPerSecond: 0,
    txFifoPerSecond: 0,
    linkCapacityBps: 1_000_000_000,
  };
  const simNetwork: SimNetworkTelemetry = networkMode ? networkSim : networkBase;

  // Guarded by SimCpuTelemetry: omitting any field the CPU terminals read is a
  // compile error (see src/telemetry/types.ts). CPU is always fully synthesized —
  // even under the other wings' sims it is the coherent background, never live.
  const simCpu: SimCpuTelemetry = {
    utilization,
    saturation: cpuPressure,
    errors: 0,
    logicalCpus: count,
    runQueuePressure,
    loadPressure,
    load1: cpuMode ? Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(0) ?? 0) / 1000) : count * 0.18,
    load5: cpuMode ? Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(1) ?? 0) / 1000) : count * 0.16,
    load15: cpuMode ? Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(2) ?? 0) / 1000) : count * 0.14,
    cores,
    // vmstat r/b track the CPU room's run-queue reservoir and D-state orb stack
    // exactly (the engine's single source of truth in sim mode): r derives from the
    // same run-queue pressure the reservoir uses (baseline 0 → one runnable per
    // core), and b reads the engine's D-state count directly — both are sim-safe
    // (synthesized for the CPU scenario, a flat baseline otherwise, never live).
    runQueue: Math.max(count, Math.round(count * (1 + runQueuePressure))),
    blocked: Math.max(0, engine?._DoomPerf_GetEffectiveCpuBlockedCount?.() ?? 0),
    user: clampRatio(utilization * 0.7),
    system: clampRatio(utilization * 0.3),
    idle: clampRatio(1 - utilization),
    iowait: 0,
    steal: 0,
    contextSwitchesPerSecond: Math.round(1200 + cpuPressure * 28000 + utilization * 6000 + (memorySaturated ? 4200 : 0)),
    interruptsPerSecond: Math.round(800 + utilization * 7000 + (memorySaturated ? 1800 : 0)),
  };

  return {
    status: "live",
    source,
    updatedAt: now,
    host: "doomperf-simulation",
    health: clampRatio(1 - Math.max(
      utilization,
      cpuPressure,
      diskMode ? simStorage.saturation : 0,
      memoryMode ? Math.max(simMemory.utilization, simMemory.saturation) : 0,
      networkMode ? Math.max(simNetwork.utilization, simNetwork.saturation) : 0
    )),
    uptimeSeconds: 3 * 86400 + performance.now() / 1000,
    // Every resource is simulated: the chosen scenario's wing carries the stressed
    // signal, the other three a quiet simulated baseline. Nothing here reads host
    // telemetry — live stats appear only in live mode.
    cpu: simCpu,
    memory: simMemory,
    storage: simStorage,
    network: simNetwork,
  };
};

const start = async () => {
  lockDocumentTitle("Doom Perf");
  // Probe for the engine bundle by importing it directly rather than with a
  // blocking HEAD round trip. A missing bundle (dev without a built engine)
  // throws here and we fall back to the pure-TS stub renderer; the import is
  // module-cached, so bootstrapEngine reuses it below without a second fetch.
  let engineAvailable = true;
  try {
    await import(engineScriptUrl);
  } catch {
    engineAvailable = false;
  }
  if (engineAvailable) {
    attachAudioUnlock();
    preloadAssetSound(interactionSound);

    // --- Mobile menu ---------------------------------------------------------
    // A phone has no Esc key, so the top-right menu icon opens the Doom
    // data-source menu (the "new game" / sim picker) just like Esc on desktop,
    // letting the player abandon a running sim and choose a different one. While
    // it is open we show the ▲▼/SELECT/BACK menu buttons instead of the movement
    // pad. The prebuilt engine exposes no menuactive flag, so we mirror the menu
    // here: on touch every menu key comes from our own buttons or the menu icon,
    // so this model tracks what the engine is showing. menuScreen "closed" means
    // ordinary gameplay (or, when the player isn't in a level, the title screen).
    type MenuScreen = "closed" | "main" | "mode" | "options";
    let menuScreen: MenuScreen = "closed";
    let mainItem = 0; // main-menu cursor row: 0 = NEW GAME, 1 = OPTIONS
    let lastSimMode = 0;

    const synthesizeEscapePress = () => {
      const dispatchEscape = (type: "keydown" | "keyup") => {
        const event = new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
        Object.defineProperty(event, "keyCode", { get: () => 27 });
        Object.defineProperty(event, "which", { get: () => 27 });
        document.dispatchEvent(event);
      };
      dispatchEscape("keydown");
      window.setTimeout(() => dispatchEscape("keyup"), 90);
    };

    // Keep menuScreen in step with the on-screen Doom menu as the player drives
    // it from the touch buttons. Mirrors m_menu.c: BACK (Esc) closes the whole
    // menu; on the main menu SELECT opens NEW GAME's data-source list or the
    // options page; on the data-source list SELECT starts the chosen sim and
    // closes the menu; ▲▼ move the main-menu cursor between its two items.
    const handleMenuAction = (action: MenuAction) => {
      if (menuScreen === "closed") return; // title-screen menu: the engine drives it
      if (action === "back") {
        menuScreen = "closed";
      } else if (menuScreen === "main") {
        if (action === "select") menuScreen = mainItem === 0 ? "mode" : "options";
        else mainItem = mainItem === 0 ? 1 : 0; // up/down toggles the two rows
      } else if (menuScreen === "mode" && action === "select") {
        menuScreen = "closed"; // a data source was chosen; the sim (re)starts
      }
    };

    const terminal = createTerminalOverlay();
    const movementPad = createMovementPad();
    const menuControls = createMenuControls(handleMenuAction);
    // The discoverable top-right menu icon: the way to open the in-game menu on a
    // phone. It toggles the menu via onOpenMenu, forward-declared so the icon can
    // close over it before toggleInGameMenu is defined below.
    const menuButton = createMenuButton(() => onOpenMenu());

    // On touch, the engine's SDL layer turns canvas drags into mouse-look. Stop
    // canvas-targeted touch/pointer/mouse events in the capture phase (which runs
    // before SDL's own canvas listeners) so the movement pad is the only steering
    // input. The pad and interact button have their own element as the event
    // target, so their taps pass through untouched.
    // The server-rack easter egg has no on-screen prompt (by design). On mobile
    // it is fired instead by tapping the rack where it appears in the view. The
    // tap handler is assigned once the easter-egg helpers below exist; the canvas
    // swallow (which already sees every canvas touch) calls it.
    let onCanvasTap: (fractionX: number) => void = () => {};
    // Opens/closes the in-game menu (the phone's Esc). Fired by the top-right
    // menu icon. Assigned below once the menu helpers exist; forward-declared
    // here so the icon (created above) can close over it.
    let onOpenMenu: () => void = () => {};
    if (isTouchDevice) {
      // A tap is a brief, near-stationary touch; a drag is a look/steer gesture
      // and is ignored. Track the touch start so touchend can tell them apart.
      let touchStartX = 0;
      let touchStartY = 0;
      let touchStartAt = 0;
      let touchIsTap = false;
      const tapMaxMovePx = 16;
      const tapMaxMs = 400;
      const swallowCanvasInput = (event: Event) => {
        if (event.target !== canvas) return;
        if (event.type === "touchstart") {
          // changedTouches (not touches[0]): the finger that started THIS touch,
          // so a finger already held on the movement pad isn't mistaken for it.
          const touch = (event as TouchEvent).changedTouches[0];
          if (touch) {
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchStartAt = Date.now();
            touchIsTap = true;
          }
        } else if (event.type === "touchmove") {
          const touch = (event as TouchEvent).changedTouches[0];
          if (
            touch &&
            (Math.abs(touch.clientX - touchStartX) > tapMaxMovePx ||
              Math.abs(touch.clientY - touchStartY) > tapMaxMovePx)
          ) {
            touchIsTap = false; // a drag is a look/steer gesture, not a tap
          }
        } else if (event.type === "touchend") {
          const touch = (event as TouchEvent).changedTouches[0];
          if (touchIsTap && touch && Date.now() - touchStartAt <= tapMaxMs) {
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0) onCanvasTap((touch.clientX - rect.left) / rect.width);
          }
          touchIsTap = false;
        } else if (event.type === "touchcancel") {
          touchIsTap = false;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const canvasInputEvents = [
        "touchstart", "touchmove", "touchend", "touchcancel",
        "pointerdown", "pointermove", "pointerup",
        "mousedown", "mousemove", "mouseup",
      ];
      for (const type of canvasInputEvents) {
        window.addEventListener(type, swallowCanvasInput, { capture: true, passive: false });
      }
    }

    let lastLiveTelemetry: TelemetrySnapshot | undefined;
    let lastEffectiveTelemetry: TelemetrySnapshot | undefined;
    // A simulated scenario is re-sampled at the command's interval (1s) and the
    // sample is held between ticks, so the terminal popups advance once per
    // second like a real `vmstat 1`/`mpstat 1` instead of flickering at the
    // 250ms engine-refresh rate. Live telemetry is left alone — the collector
    // already streams a fresh snapshot once per second.
    const scenarioSampleMs = 1000;
    let lastScenario: TelemetrySnapshot | undefined;
    let lastScenarioAt = 0;

    const refreshEffectiveTelemetry = (forceScenarioSample = false) => {
      const engine = getEngine();
      const mode = engine?._DoomPerf_GetSimMode?.() ?? 0;
      // Must match scenarioTelemetry's own range check (1..11 — 3/4/5 disk, 6/7/8 memory, 9/10/11 network).
      const inScenario = mode >= 1 && mode <= 11;
      const now = Date.now();
      if (!inScenario) {
        lastScenario = undefined;
      } else if (forceScenarioSample || !lastScenario || now - lastScenarioAt >= scenarioSampleMs) {
        lastScenario = scenarioTelemetry(engine);
        lastScenarioAt = now;
      }
      lastEffectiveTelemetry = lastScenario ?? lastLiveTelemetry;
      // Drive both the terminals AND the in-world instruments from the effective
      // snapshot: in a scenario that's the simulated telemetry, so the physical
      // instruments in the non-active wings show a simulated baseline instead of
      // live host values (the active wing synthesizes its own stress engine-side).
      // Live host values reach the engine only in live mode. isLive tracks which
      // snapshot we actually push, so the OOM-kill event stays tied to live data.
      if (lastEffectiveTelemetry) {
        // ?swap=off seals the swap tributary, so it must reach the engine feed too,
        // not just the terminal (unlike ?psi=off, which is display-only).
        const shown = applySwapOverride(lastEffectiveTelemetry);
        pushTelemetryToEngine(engine, shown, lastScenario === undefined);
        terminal.update(applyPsiOverride(shown));
      }
    };

    const telemetryClient = createTelemetryClient(telemetrySource, (telemetry) => {
      lastLiveTelemetry = telemetry;
      refreshEffectiveTelemetry();
    });

    const terminalRefresh = window.setInterval(refreshEffectiveTelemetry, 250);

    const currentPlayerPose = (): PlayerPose => {
      const engine = getEngine();
      return {
        active: !!engine?._DoomPerf_PlayerActive?.(),
        x: engine?._DoomPerf_PlayerX?.() ?? 0,
        y: engine?._DoomPerf_PlayerY?.() ?? 0,
        angleDeg: engine?._DoomPerf_PlayerAngle?.() ?? 0,
      };
    };

    // Closest point on a trigger segment to the player. Working against the
    // whole segment (the object's full face/width) rather than its midpoint is
    // what lets the prompt fire when the player stands at an *edge* of a
    // terminal or door, not only in front of its centre. For points alongside
    // the segment the closest point is the foot of the perpendicular; past the
    // ends it is the nearer endpoint (so the in-range zone is a capsule of
    // radius useRange hugging the face).
    const closestPointOnSegment = (
      px: number,
      py: number,
      { ax, ay, bx, by }: TriggerSegment
    ): { x: number; y: number } => {
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
      return { x: ax + t * dx, y: ay + t * dy };
    };

    // True when the player is close enough to a trigger segment AND roughly
    // facing it. "Facing" = the player's view direction is within 90° of the
    // direction to the nearest point on the object: the dot product of the two
    // is non-negative. This mirrors the engine's USE trace (which only reaches a
    // door the player faces) and stops a terminal/door prompt from showing when
    // the player has walked past and turned away. Angle comes from the engine in
    // degrees (0 = +x, 90 = +y); when the player is essentially on top of the
    // object the direction is undefined, so proximity alone qualifies.
    const inRangeAndFacing = (
      px: number,
      py: number,
      facingX: number,
      facingY: number,
      segment: TriggerSegment,
      range: number
    ): boolean => {
      const { x, y } = closestPointOnSegment(px, py, segment);
      const toX = x - px;
      const toY = y - py;
      const distance = Math.hypot(toX, toY);
      if (distance > range) return false;
      if (distance < 1) return true;
      return facingX * toX + facingY * toY >= 0;
    };

    // The interactable (terminal or door) the player is currently standing
    // close enough to use and facing, or null. Doors are checked only when no
    // terminal is in range; the two never overlap in the map, but terminals win
    // to be safe.
    const currentTarget = ():
      | { kind: "terminal"; sign: TerminalSign }
      | { kind: "door"; probeX: number; probeY: number }
      | null => {
      const pose = currentPlayerPose();
      if (!pose.active) return null;
      const px = pose.x;
      const py = pose.y;
      const angle = (pose.angleDeg * Math.PI) / 180;
      const facingX = Math.cos(angle);
      const facingY = Math.sin(angle);
      const nearTerminal = terminalSigns.find((terminal) =>
        terminal.segments.some((seg) =>
          inRangeAndFacing(px, py, facingX, facingY, seg, terminalRange)
        )
      );
      if (nearTerminal) return { kind: "terminal", sign: nearTerminal.sign };
      const door = doorSigns.find((door) =>
        door.segments.some((seg) => inRangeAndFacing(px, py, facingX, facingY, seg, doorRange))
      );
      if (door) return { kind: "door", probeX: door.probeX, probeY: door.probeY };
      return null;
    };

    const currentEasterEgg = (): { id: string } | null => {
      const pose = currentPlayerPose();
      if (!pose.active) return null;
      const px = pose.x;
      const py = pose.y;
      const angle = (pose.angleDeg * Math.PI) / 180;
      const facingX = Math.cos(angle);
      const facingY = Math.sin(angle);
      const egg = easterEggs.find((candidate) =>
        candidate.segments.some((seg) =>
          inRangeAndFacing(px, py, facingX, facingY, seg, useRange)
        )
      );
      return egg ? { id: egg.id } : null;
    };

    let lastEasterEggAt = 0;
    const easterEggCooldownMs = 7000;
    // Onset (ms) of each audible yell in the 5.2s interaction sting. The dashboard
    // fires one IOPS spike at each so the two spikes land on the two yells.
    const interactionSpikeOffsetsMs = [100, 3100];
    // Play the sting and drive the dashboard's two IOPS spikes, once per cooldown.
    // Shared by the desktop space-bar path and the mobile tap-on-rack path.
    const fireEasterEgg = () => {
      const now = Date.now();
      if (now - lastEasterEggAt < easterEggCooldownMs) return;
      lastEasterEggAt = now;
      playAssetSound(interactionSound);
      for (const offset of interactionSpikeOffsetsMs) {
        window.setTimeout(
          () => getEngine()?._DoomPerf_TriggerStorageIopsSpike?.(),
          offset
        );
      }
    };

    // Mobile: with no prompt button, the server-rack easter egg fires when a
    // canvas tap lands on the rack's on-screen projection (within range). Doom's
    // horizontal FOV is 90deg, so a world point projects to normalized device
    // X = lateral/depth, |X| < 1 on screen; the canvas spans X in [-1, 1].
    const easterEggTapRange = 256;
    const easterEggTapPadNdc = 0.12;
    const projectNdcX = (wx: number, wy: number, pose: PlayerPose): number | null => {
      const angle = (pose.angleDeg * Math.PI) / 180;
      const facingX = Math.cos(angle);
      const facingY = Math.sin(angle);
      const rightX = Math.sin(angle);
      const rightY = -Math.cos(angle);
      const dx = wx - pose.x;
      const dy = wy - pose.y;
      const depth = dx * facingX + dy * facingY;
      if (depth <= 1) return null;
      return (dx * rightX + dy * rightY) / depth;
    };
    const easterEggTapHits = (
      egg: { segments: TriggerSegment[] },
      pose: PlayerPose,
      fractionX: number
    ): boolean => {
      let nearest = Infinity;
      let lo = Infinity;
      let hi = -Infinity;
      for (const seg of egg.segments) {
        const closest = closestPointOnSegment(pose.x, pose.y, seg);
        nearest = Math.min(nearest, Math.hypot(closest.x - pose.x, closest.y - pose.y));
        for (const [wx, wy] of [[seg.ax, seg.ay], [seg.bx, seg.by]] as const) {
          const ndc = projectNdcX(wx, wy, pose);
          if (ndc !== null) {
            lo = Math.min(lo, ndc);
            hi = Math.max(hi, ndc);
          }
        }
      }
      if (nearest > easterEggTapRange) return false; // too far to be tapping it
      if (lo === Infinity) return false; // entirely behind the camera
      if (hi < -1 || lo > 1) return false; // off screen
      const tapNdc = fractionX * 2 - 1;
      return tapNdc >= lo - easterEggTapPadNdc && tapNdc <= hi + easterEggTapPadNdc;
    };

    onCanvasTap = (fractionX: number) => {
      if (terminal.isOpen() || menuScreen !== "closed") return;
      const pose = currentPlayerPose();
      if (!pose.active) return;
      if (easterEggs.some((egg) => easterEggTapHits(egg, pose, fractionX))) {
        fireEasterEgg();
      }
    };

    // True when the door at the given probe point has already lifted open. Used
    // to suppress the "Open Door" prompt while the door is open (it auto-closes
    // a few seconds later, at which point the prompt returns).
    const doorIsOpen = (probeX: number, probeY: number) =>
      (getEngine()?._DoomPerf_SectorOpenRange?.(probeX, probeY) ?? 0) > doorOpenThreshold;

    const openTerminal = (sign: TerminalSign) => {
      movementPad.hide();
      menuButton.hide();
      refreshEffectiveTelemetry(true);
      const telemetry = lastEffectiveTelemetry ?? lastLiveTelemetry;
      if (telemetry) {
        terminal.open(sign, telemetry);
      }
    };

    // The prebuilt WASM engine handles door USE from its own SDL keydown
    // listener on `document`. There is no DoomPerf export for "use", so the
    // on-screen button synthesizes a space press (keyCode 32) the engine reads
    // as key_use -> BT_USE. Forced via defineProperty because the KeyboardEvent
    // constructor ignores keyCode/which. Dispatched on `document` so it reaches
    // the engine and bubbles up to our own window keydown handler.
    const dispatchSpace = (type: "keydown" | "keyup") => {
      const event = new KeyboardEvent(type, {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "keyCode", { get: () => 32 });
      Object.defineProperty(event, "which", { get: () => 32 });
      document.dispatchEvent(event);
    };
    // Hold the key for a few tics before releasing. Doom samples key state once
    // per tic (~28ms); a synchronous down+up could be set and cleared before a
    // single tic observes it, dropping the USE entirely.
    const synthesizeUsePress = () => {
      dispatchSpace("keydown");
      window.setTimeout(() => dispatchSpace("keyup"), 100);
    };

    // Shared by the keyboard ([space]) and the on-screen button. `fromButton`
    // distinguishes the two: a real key press already reaches the engine for
    // doors, so only the button needs to synthesize one.
    const interact = (fromButton: boolean) => {
      if (terminal.isOpen()) {
        terminal.close();
        return;
      }
      const target = currentTarget();
      if (!target) {
        if (!fromButton && currentEasterEgg()) {
          fireEasterEgg();
        }
        return;
      }
      if (target.kind === "terminal") {
        openTerminal(target.sign);
      } else if (fromButton) {
        synthesizeUsePress();
      }
    };

    const prompt = createInteractPrompt(() => interact(true));
    const updatePrompt = () => {
      // Until the engine has rendered, there is nothing to drive — keep every
      // control hidden so a phone doesn't show menu buttons over the loading
      // veil before the player can do anything.
      if (!engineReady) {
        if (isTouchDevice) {
          movementPad.hide();
          menuControls.hide();
          menuButton.hide();
        }
        prompt.hide();
        return;
      }
      // The touch controls ride the same poll. In a live level the movement pad
      // shows; on the title/menu screens the menu controls show instead; while a
      // terminal overlay is open, neither does. pad.hide() also releases any
      // held arrow keys.
      if (isTouchDevice) {
        const playerActive = !!getEngine()?._DoomPerf_PlayerActive?.();
        // Safety nets that keep the in-game menu overlay in step with the
        // engine: it can only be open inside a running level, and choosing a
        // data source (by any path, even an external keyboard) changes the sim
        // mode. Either condition means we are no longer in that menu.
        const simMode = getEngine()?._DoomPerf_GetSimMode?.() ?? 0;
        if (!playerActive || (menuScreen !== "closed" && simMode !== lastSimMode)) {
          menuScreen = "closed";
        }
        lastSimMode = simMode;
        if (terminal.isOpen()) {
          movementPad.hide();
          menuControls.hide();
          menuButton.hide();
        } else if (playerActive && menuScreen === "closed") {
          // Ordinary gameplay: movement pad plus the top-right menu icon, which
          // opens the in-game menu.
          menuControls.hide();
          movementPad.show();
          menuButton.show();
        } else {
          // Title/menu screen, or our in-game menu overlay: either way the player
          // navigates with the ▲▼/SELECT/BACK buttons, so the icon steps aside.
          movementPad.hide();
          menuButton.hide();
          menuControls.show();
        }
      }
      if (terminal.isOpen() || menuScreen !== "closed") {
        prompt.hide();
        return;
      }
      const target = currentTarget();
      if (!target) {
        prompt.hide();
        return;
      }
      if (target.kind === "door" && doorIsOpen(target.probeX, target.probeY)) {
        prompt.hide();
        return;
      }
      prompt.show(target.kind);
    };

    // The top-right menu icon is the phone's Esc key: it opens the Doom
    // data-source menu so the player can back out of the running sim and pick a
    // different one, and closes it again. While it is open updatePrompt swaps the
    // movement pad for the ▲▼/SELECT/BACK buttons (see menuScreen above).
    const toggleInGameMenu = () => {
      if (!engineReady || terminal.isOpen()) return;
      const playerActive = !!getEngine()?._DoomPerf_PlayerActive?.();
      // Only act inside a running level. On the title/menu screens the menu
      // buttons are already shown and the engine owns Esc, so leave them be.
      if (!playerActive && menuScreen === "closed") return;
      synthesizeEscapePress();
      menuScreen = menuScreen === "closed" ? "main" : "closed";
      navigator.vibrate?.(20); // a tick of haptic feedback that the tap registered
      updatePrompt(); // swap the controls now rather than waiting for the poll
    };
    onOpenMenu = toggleInGameMenu;

    const promptRefresh = window.setInterval(updatePrompt, 120);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "Escape") {
        terminal.close();
        return;
      }
      if (event.code !== "Space") return;
      interact(false);
    };
    window.addEventListener("keydown", onKeyDown);

    window.addEventListener(
      "beforeunload",
      () => {
        telemetryClient.close();
        window.clearInterval(terminalRefresh);
        window.clearInterval(promptRefresh);
        window.removeEventListener("keydown", onKeyDown);
      },
      { once: true }
    );

    await bootstrapEngine({
      wadUrl,
      canvas,
      audio,
      engineScriptUrl,
      // The versioned WASM is built and stamped alongside doom.js, so it is
      // always present when the engine is; pass it directly (no HEAD probe) to
      // preserve the cache-busted URL.
      wasmUrl: engineWasmUrl,
      extraWads: [doomPerfMapWad],
      args: ["doom", "-file", doomPerfMapWad.name],
      onStatus: (message) => console.log(message),
    });

    // bootstrapEngine returns once callMain has handed control back (the
    // Asyncify game loop is scheduled); the first frame lands a tick later.
    // Hold the veil until that frame paints, then reveal the game.
    await waitForFirstFrame();
    finishLoading();

    // Bring the main menu up automatically so neither desktop nor mobile needs
    // an initial click to dismiss the title screen. We synthesize one ESC — the
    // key Doom's title screen uses to open the menu — shortly after the engine
    // starts, but skip it if the player already pressed or tapped something (a
    // second ESC would just toggle the menu back off). On touch the menu BACK
    // button (also ESC) is a fallback if this is ever missed.
    let userActed = false;
    const noteUserAction = () => { userActed = true; };
    window.addEventListener("keydown", noteUserAction, { once: true, capture: true });
    window.addEventListener("pointerdown", noteUserAction, { once: true, capture: true });
    window.setTimeout(() => {
      window.removeEventListener("keydown", noteUserAction, true);
      window.removeEventListener("pointerdown", noteUserAction, true);
      if (userActed) return;
      synthesizeEscapePress();
    }, 800);
    return;
  }
  console.warn("Engine bundle not found, falling back to stub renderer.");
  await D_DoomMain(wadUrl, canvas);
  finishLoading();
};

void start().catch((error) => {
  console.error(error);
  // Surface the failure in the veil rather than leaving the spinner up forever.
  if (loadingOverlay) {
    loadingOverlay.classList.remove("is-hidden");
    loadingOverlay.querySelector(".loading__spinner")?.remove();
    const text = loadingOverlay.querySelector(".loading__text");
    if (text) text.textContent = "Failed to load — reload to retry";
  }
});
