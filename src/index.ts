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
  _DoomPerf_SetStorageUtil?: (permille: number) => void;
  // Disk request-queue depth (iostat aqu-sz) as permille of a 24-request full
  // channel, driving the media-pit queue channel's flowing request blocks.
  _DoomPerf_SetStorageQueue?: (permille: number) => void;
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
  // Per-device IOPS counter bank: how many columns carry a live device, and each
  // busiest-first device's ops/s as permille of a per-device full scale.
  _DoomPerf_SetStorageDeviceCount?: (count: number) => void;
  _DoomPerf_SetStorageDeviceIops?: (index: number, permille: number) => void;
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
  // Fire the Baron-of-Hell OOM-kill event: the baron walks to reliquary barrel
  // `slot` (0 = largest resident set) and detonates it. Called when the live
  // oom_kill counter increments; the memory saturation sim self-fires it engine-side.
  _DoomPerf_TriggerMemoryOomKill?: (slot: number) => void;
  // Network RX/TX throughput as permille of a 1 Gbit reference link, driving the
  // density of the two packet-orb streams in the network wing's grove.
  _DoomPerf_SetNetworkRx?: (permille: number) => void;
  _DoomPerf_SetNetworkTx?: (permille: number) => void;
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
  engine?._DoomPerf_SetStorageUtil?.(Math.round(clampRatio(telemetry.storage.utilization) * 1000));
  engine?._DoomPerf_SetStorageQueue?.(Math.round(clampRatio((telemetry.storage.queueDepth ?? 0) / 24) * 1000));
  // Root-filesystem usage (`df /`) fills the disk-usage cistern.
  engine?._DoomPerf_SetStorageUsage?.(Math.round(clampRatio(telemetry.storage.usedRatio ?? 0) * 1000));
  // Aggregate IOPS drives the dashboard's (now real) IOPS graph; the per-device
  // breakdown (busiest first) drives the IOPS counter bank's columns. Sims 3/4
  // synthesize their own values engine-side, so these live values are ignored then.
  engine?._DoomPerf_SetStorageIops?.(
    Math.round(clampRatio((telemetry.storage.iops ?? 0) / STORAGE_IOPS_FULLSCALE) * 1000)
  );
  const diskDevices = telemetry.storage.devices ?? [];
  const diskDeviceSlots = 4;
  engine?._DoomPerf_SetStorageDeviceCount?.(Math.min(diskDevices.length, diskDeviceSlots));
  for (let slot = 0; slot < diskDeviceSlots; slot += 1) {
    const device = diskDevices[slot];
    engine?._DoomPerf_SetStorageDeviceIops?.(
      slot,
      device ? Math.round(clampRatio(device.iops / STORAGE_DEVICE_IOPS_FULLSCALE) * 1000) : 0
    );
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
  // the OOM killer's next victim. Live values only — the memory sims (modes 5/6)
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
  // Network RX/TX throughput as a fraction of a 1 Gbit reference link, pushed as
  // permille. The engine maps it through a sqrt gradient to the packet-orb density
  // in the grove's two lanes — a representative abstraction, not one orb per
  // packet. The grove shows AGGREGATE throughput across all interfaces (the same
  // rx/tx totals that feed utilization), not any single NIC. The network sims
  // (modes 7/8) synthesize their own throughput.
  const networkFullScaleBytes = 125_000_000; // 1 Gbit/s
  engine?._DoomPerf_SetNetworkRx?.(
    Math.round(clampRatio((telemetry.network.rxBytesPerSecond ?? 0) / networkFullScaleBytes) * 1000)
  );
  engine?._DoomPerf_SetNetworkTx?.(
    Math.round(clampRatio((telemetry.network.txBytesPerSecond ?? 0) / networkFullScaleBytes) * 1000)
  );
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
  if (mode < 1 || mode > 8) {
    return undefined;
  }

  const cpuMode = mode === 1 || mode === 2;
  const diskMode = mode === 3 || mode === 4;
  const diskSaturated = mode === 4;
  const memoryMode = mode === 5 || mode === 6;
  const memorySaturated = mode === 6;
  const networkMode = mode === 7 || mode === 8;
  const networkSaturated = mode === 8;
  const count = Math.max(1, Math.min(doomPerfCpuCoreCapacity, engine?._DoomPerf_GetEffectiveCpuCoreCount?.() ?? 8));
  const now = Date.now();
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
    : mode === 4 ? "sim: high disk saturation"
    : mode === 5 ? "sim: high memory utilization"
    : mode === 6 ? "sim: high memory saturation"
    : mode === 7 ? "sim: high network utilization"
    : "sim: high network saturation";
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
  const memorySwapTotalBytes = 4 * gib;
  const memorySwapUsedBytes = memorySaturated
    ? (2450 + 500 * memoryWave) * 1024 ** 2
    : (96 + 48 * memoryWave) * 1024 ** 2;
  const memorySwapIn = memorySaturated ? 260 + 220 * memoryWave : 0;
  const memorySwapOut = memorySaturated ? 520 + 360 * Math.abs(Math.sin(now / 1900)) : 0;
  const simMemory: SimMemoryTelemetry = memoryMode
    ? {
        utilization: clampRatio(1 - memoryAvailableBytes / memoryTotalBytes),
        saturation: memorySaturated ? clampRatio(0.76 + 0.18 * memoryWave) : 0.04,
        errors: 0,
        totalBytes: memoryTotalBytes,
        freeBytes: memorySaturated ? 190 * 1024 ** 2 : 640 * 1024 ** 2,
        buffersBytes: memorySaturated ? 96 * 1024 ** 2 : 260 * 1024 ** 2,
        cachedBytes: memorySaturated ? 520 * 1024 ** 2 : 1500 * 1024 ** 2,
        availableBytes: memoryAvailableBytes,
        swapTotalBytes: memorySwapTotalBytes,
        swapFreeBytes: Math.max(0, memorySwapTotalBytes - memorySwapUsedBytes),
        swapUsedBytes: memorySwapUsedBytes,
        swapInPagesPerSecond: memorySwapIn,
        swapOutPagesPerSecond: memorySwapOut,
        swapPagesPerSecond: memorySwapIn + memorySwapOut,
        // Paging: mode 6 (saturation) thrashes — heavy major faults refaulting
        // from disk/swap; mode 5 (utilization) has only light minor-fault churn.
        minorFaultsPerSecond: memorySaturated ? 9000 + 5000 * memoryWave : 1200 + 400 * memoryWave,
        majorFaultsPerSecond: memorySaturated ? 150 + 90 * memoryWave : 2 + 3 * memoryWave,
        pressureAvailable: true,
        pressureSomeAvg10: memorySaturated ? 18 + 10 * memoryWave : 0.35,
        pressureSomeAvg60: memorySaturated ? 15 + 6 * memoryWave : 0.2,
        pressureSomeAvg300: memorySaturated ? 7 + 3 * memoryWave : 0.05,
        pressureSomeTotal: memorySaturated ? 1280000 + Math.round(12000 * memoryWave) : 42000,
        pressureFullAvg10: memorySaturated ? 1.4 + 1.8 * memoryWave : 0,
        pressureFullAvg60: memorySaturated ? 0.8 + 0.8 * memoryWave : 0,
        pressureFullAvg300: memorySaturated ? 0.15 + 0.25 * memoryWave : 0,
        pressureFullTotal: memorySaturated ? 144000 + Math.round(2600 * memoryWave) : 0,
        oomKills: 0,
        oomKillsPerSecond: 0,
        // oomScore mirrors the engine's barrel-glow synthesis for modes 5/6
        // (DoomPerf_EffectiveMemoryProcOom), so the terminal's OOM readout and
        // the in-world barrels tell the same story in the demo.
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
  // instruments: root-filesystem capacity (`df /`, the disk-usage CISTERN, sector
  // tag 616) and per-device IOPS (the IOPS BANK, tags 630-633). In the disk sims
  // the engine synthesizes ALL of these instruments itself (DoomPerf_UpdateDisk*),
  // so the terminal mirrors those synthesized values to tell the same story:
  // mode 3 is ~61% full with a busy-but-healthy bank, mode 4 ~93% full with a
  // saturated one. Every OTHER scenario shows `storageBase` — a quiet, healthy
  // simulated disk (same across all non-disk scenarios), never the host's real
  // stats. Fields map onto the iostat terminal's columns (rkB/s, wkB/s, await,
  // aqu-sz, %util) plus the df / per-device-IOPS terminals.
  const mib = 1024 * 1024;
  const wobble = 0.85 + 0.3 * Math.abs(Math.sin(now / 900));
  const diskSimTotalBytes = 512 * gib;
  const diskSimUsedRatio = diskSaturated
    ? clampRatio(0.93 + 0.008 * Math.abs(Math.sin(now / 2100)))
    : clampRatio(0.61 + 0.012 * Math.abs(Math.sin(now / 2100)));
  // Four block devices, busiest first, in the same ops/s range the engine's bank
  // columns rise to (mode 4 runs hotter than mode 3); the terminal's aggregate is
  // their sum so its rows and its total stay self-consistent.
  const diskSimDevices = ["nvme0n1", "sda", "sdb", "dm-0"].map((name, slot) => ({
    name,
    iops: Math.max(
      0,
      (diskSaturated ? 3950 - slot * 450 : 2900 - slot * 600) +
        (diskSaturated ? 120 : 80) * Math.abs(Math.sin(now / 1400 + slot))
    ),
    utilization: diskSaturated ? clampRatio(0.9 - slot * 0.05) : clampRatio(0.7 - slot * 0.08),
  }));
  // The disk-sim branch is guarded by SimStorageTelemetry, so omitting any field a
  // storage terminal reads is a compile error (see src/telemetry/types.ts).
  const storageSim: SimStorageTelemetry = {
    utilization: diskSaturated
      ? clampRatio(0.985 + 0.012 * Math.sin(now / 2000))
      : clampRatio(0.93 + 0.045 * Math.sin(now / 2000)),
    // Saturation (not raw utilization) is the health signal: ~100% busy is fine
    // until the queue and await pile up, which only mode 4 does.
    saturation: diskSaturated
      ? clampRatio(0.6 + 0.4 * Math.abs(Math.sin(now / 2300)))
      : clampRatio(0.05 + 0.04 * Math.abs(Math.sin(now / 1900))),
    errors: 0,
    // aqu-sz: mode 4 backs up well past the iostat bar's 8.0 full-scale.
    queueDepth: diskSaturated ? 13 + 6 * Math.abs(Math.sin(now / 1700)) : 1.3 + 0.6 * Math.abs(Math.sin(now / 1500)),
    // await (ms): mode 4 climbs toward a quarter-second; mode 3 stays single digit.
    awaitMillis: diskSaturated ? 165 + 55 * Math.abs(Math.sin(now / 1300)) : 6.5 + 3 * Math.abs(Math.sin(now / 1100)),
    // Contention makes the saturated media serve a little slower per request, so
    // its throughput is lower than the merely-busy case.
    readBytesPerSecond: (diskSaturated ? 96 : 168) * mib * wobble,
    writeBytesPerSecond: (diskSaturated ? 64 : 120) * mib * wobble,
    iops: diskSimDevices.reduce((sum, d) => sum + d.iops, 0),
    devices: diskSimDevices,
    totalBytes: diskSimTotalBytes,
    usedBytes: diskSimTotalBytes * diskSimUsedRatio,
    availBytes: diskSimTotalBytes * (1 - diskSimUsedRatio),
    usedRatio: diskSimUsedRatio,
  };
  // Quiet baseline disk for every non-disk scenario: ~45% full, light I/O, low
  // await, a calm 4-device bank. Also SimStorageTelemetry-guarded, so it can never
  // silently drop a field a storage terminal reads.
  const baseDiskUsedRatio = 0.45;
  const baseDiskDevices = ["nvme0n1", "sda", "sdb", "dm-0"].map((name, slot) => ({
    name,
    iops: Math.max(0, 240 - slot * 55 + 40 * Math.abs(Math.sin(now / 1600 + slot))),
    utilization: clampRatio(0.06 - slot * 0.012 + 0.02 * Math.abs(Math.sin(now / 1500 + slot))),
  }));
  const storageBase: SimStorageTelemetry = {
    utilization: clampRatio(0.05 + 0.03 * Math.abs(Math.sin(now / 1700))),
    saturation: 0,
    errors: 0,
    queueDepth: 0.2 + 0.2 * Math.abs(Math.sin(now / 1500)),
    awaitMillis: 1.6 + 1.2 * Math.abs(Math.sin(now / 1300)),
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

  // Network: the network scenario drives the link to high utilization (mode 7 —
  // throughput pinned near line rate, but drops stay near zero) or full saturation
  // (mode 8 — the link is maxed and packets start dropping while throughput
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
  const netSynRecv = networkSaturated ? 160 + Math.round(60 * netWave) : 6;
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
  // Send/Recv-Q backlog: near-zero under high-utilization (throughput pinned but
  // draining fine), blows out under saturation — inbound app-read lag + outbound
  // peer-drain lag. Drives the twin RecvQ/SendQ standpipe gauges.
  const netRecvQ = networkSaturated ? (2.4 + 0.6 * netWave) * mib : 12 * 1024;
  const netSendQ = networkSaturated ? (3.4 + 0.8 * netWave) * mib : 48 * 1024;
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
        // drops/s blow out only under saturation; NIC errors are a separate
        // signal kept at zero here.
        dropsPerSecond: networkSaturated ? 900 + 600 * Math.abs(Math.sin(now / 1500)) : 0,
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
        backloggedSockets: networkSaturated ? 130 + Math.round(30 * netWave) : 2,
        topSockets: networkSaturated
          ? [
              { local: "10.0.0.5:443", remote: "203.0.113.9:52344", state: "ESTAB", recvQueueBytes: 0.2 * mib, sendQueueBytes: (1.4 + 0.3 * netWave) * mib },
              { local: "10.0.0.5:443", remote: "198.51.100.7:41022", state: "ESTAB", recvQueueBytes: (0.9 + 0.2 * netWave) * mib, sendQueueBytes: 0.1 * mib },
              { local: "10.0.0.5:8080", remote: "192.0.2.44:33900", state: "CLOSE-WAIT", recvQueueBytes: (0.5 + 0.1 * netWave) * mib, sendQueueBytes: 0 },
            ]
          : [
              { local: "10.0.0.5:443", remote: "203.0.113.9:52344", state: "ESTAB", recvQueueBytes: 0, sendQueueBytes: 24 * 1024 },
            ],
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
      const inScenario = mode >= 1 && mode <= 8;
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
        pushTelemetryToEngine(engine, lastEffectiveTelemetry, lastScenario === undefined);
        terminal.update(lastEffectiveTelemetry);
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
