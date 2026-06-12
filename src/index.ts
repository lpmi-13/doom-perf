import { bootstrapEngine } from "./engine_bootstrap";
import { D_DoomMain } from "./d_main";
import { createTelemetryClient, createTerminalOverlay, resolveTelemetrySource } from "./telemetry";
import type { TelemetrySnapshot, TerminalSign } from "./telemetry";
import { createInteractPrompt } from "./interact";
import { createMovementPad } from "./ui/movementPad";
import { createMenuControls } from "./ui/menuControls";
import { mapManifest } from "./doomperf-map-manifest";

// Cache-bust versions injected at build time by scripts/build-web.mjs (content
// hashes of the WAD / engine). Under `--watch` they arrive as the "dev" sentinel,
// which we expand to a runtime timestamp so dev never serves a stale copy.
declare const __WAD_VERSION__: string;
declare const __ENGINE_VERSION__: string;
const assetVersion = (version: string): string => (version === "dev" ? String(Date.now()) : version);

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
const copySegments = (segments: readonly TriggerSegment[]): TriggerSegment[] =>
  segments.map(({ ax, ay, bx, by }) => ({ ax, ay, bx, by }));
const terminalSigns: { sign: TerminalSign; segments: TriggerSegment[] }[] =
  mapManifest.terminals.map((terminal) => ({
    sign: terminal.sign,
    segments: copySegments(terminal.segments),
  }));
const terminalRange = useRange;

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

if (!canvas) {
  throw new Error("Missing #canvas canvas element.");
}

if (!audio) {
  throw new Error("Missing #audio element.");
}

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
  doom1: "/wads/freedoom1.wad",
  freedoom1: "/wads/freedoom1.wad",
  doom2: "/wads/Doom2.wad",
};
const wadUrl = wadParam && wadMap[wadParam] ? wadMap[wadParam] : "/wads/freedoom1.wad";
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

type DoomPerfEngine = {
  _DoomPerf_SetCpuCoreCount?: (count: number) => void;
  _DoomPerf_SetCpuCore?: (id: number, permille: number) => void;
  _DoomPerf_SetCpuRunQueuePressure?: (permille: number) => void;
  _DoomPerf_SetCpuRunQueueCount?: (count: number) => void;
  _DoomPerf_SetCpuBlockedCount?: (count: number) => void;
  _DoomPerf_SetCpuLoadPressure?: (permille: number) => void;
  _DoomPerf_SetLoad?: (index: number, milliLoad: number) => void;
  // Storage service time (await) as permille of a 250ms full scale, driving the
  // media-pit latency gauges in the disk wing; and disk busy fraction (%util) in
  // permille, driving the platter's pulsing rings.
  _DoomPerf_SetStorageAwait?: (permille: number) => void;
  _DoomPerf_SetStorageUtil?: (permille: number) => void;
  // Disk request-queue depth (iostat aqu-sz) as permille of a 24-request full
  // channel, driving the media-pit queue channel's flowing request blocks.
  _DoomPerf_SetStorageQueue?: (permille: number) => void;
  _DoomPerf_SetMemoryUtil?: (permille: number) => void;
  _DoomPerf_SetMemorySaturation?: (permille: number) => void;
  _DoomPerf_SetMemoryErrors?: (permille: number) => void;
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

const pushTelemetryToEngine = (engine: DoomPerfEngine | undefined, telemetry: TelemetrySnapshot) => {
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
  engine?._DoomPerf_SetLoad?.(0, Math.round(telemetry.cpu.load1 * 1000));
  engine?._DoomPerf_SetLoad?.(1, Math.round(telemetry.cpu.load5 * 1000));
  engine?._DoomPerf_SetLoad?.(2, Math.round(telemetry.cpu.load15 * 1000));
  // Disk service time (iostat await) for the media-pit latency gauges, scaled to
  // a 250ms full bar — the same scale the iostat terminal's await bar uses. In a
  // disk sim the engine synthesizes its own await, so this live value is ignored.
  engine?._DoomPerf_SetStorageAwait?.(Math.round(clampRatio((telemetry.storage.awaitMillis ?? 0) / 250) * 1000));
  engine?._DoomPerf_SetStorageUtil?.(Math.round(clampRatio(telemetry.storage.utilization) * 1000));
  engine?._DoomPerf_SetStorageQueue?.(Math.round(clampRatio((telemetry.storage.queueDepth ?? 0) / 24) * 1000));
  engine?._DoomPerf_SetMemoryUtil?.(Math.round(clampRatio(telemetry.memory.utilization) * 1000));
  engine?._DoomPerf_SetMemorySaturation?.(Math.round(clampRatio(telemetry.memory.saturation) * 1000));
  engine?._DoomPerf_SetMemoryErrors?.(Math.round(clampRatio(telemetry.memory.errors) * 1000));
};

const scenarioTelemetry = (
  engine: DoomPerfEngine | undefined,
  liveTelemetry: TelemetrySnapshot | undefined
): TelemetrySnapshot | undefined => {
  const mode = engine?._DoomPerf_GetSimMode?.() ?? 0;
  if (mode < 1 || mode > 6) {
    return undefined;
  }

  const diskMode = mode === 3 || mode === 4;
  const diskSaturated = mode === 4;
  const memoryMode = mode === 5 || mode === 6;
  const memorySaturated = mode === 6;
  const count = Math.max(1, Math.min(doomPerfCpuCoreCapacity, engine?._DoomPerf_GetEffectiveCpuCoreCount?.() ?? 8));
  const now = Date.now();
  const cores = Array.from({ length: count }, (_, id) => ({
    id,
    utilization: memoryMode
      ? clampRatio(0.09 + 0.035 * Math.abs(Math.sin(now / 1800 + id)))
      : clampRatio((engine?._DoomPerf_GetEffectiveCpuCore?.(id) ?? 0) / 1000),
  }));
  const utilization = cores.reduce((sum, { utilization: core }) => sum + core, 0) / cores.length;
  const runQueuePressure = memoryMode ? 0 : clampRatio((engine?._DoomPerf_GetEffectiveCpuRunQueuePressure?.() ?? 0) / 1000);
  const loadPressure = memoryMode ? 0 : clampRatio((engine?._DoomPerf_GetEffectiveCpuLoadPressure?.() ?? 0) / 1000);
  const cpuPressure = mode === 2 ? Math.max(runQueuePressure, loadPressure) : runQueuePressure;
  const quietResource = { utilization: 0.08, saturation: 0, errors: 0 };
  const source =
    mode === 1 ? "sim: high CPU utilization"
    : mode === 2 ? "sim: high CPU saturation"
    : mode === 3 ? "sim: high disk utilization"
    : mode === 4 ? "sim: high disk saturation"
    : mode === 5 ? "sim: high memory utilization"
    : "sim: high memory saturation";
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
  const simMemory = memoryMode
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
        topRss: memorySaturated
          ? [
              { pid: 4210, rssBytes: 11264 * 1024 ** 2, command: "mem-pressure-worker" },
              { pid: 4217, rssBytes: 1870 * 1024 ** 2, command: "allocator-churn" },
              { pid: 2891, rssBytes: 780 * 1024 ** 2, command: "doomperf" },
              { pid: 1773, rssBytes: 460 * 1024 ** 2, command: "browser" },
            ]
          : [
              { pid: 4210, rssBytes: 9728 * 1024 ** 2, command: "mem-resident-worker" },
              { pid: 2891, rssBytes: 820 * 1024 ** 2, command: "doomperf" },
              { pid: 1773, rssBytes: 440 * 1024 ** 2, command: "browser" },
              { pid: 914, rssBytes: 180 * 1024 ** 2, command: "journald" },
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
          { pid: 2891, rssBytes: 520 * 1024 ** 2, command: "doomperf" },
          { pid: 1773, rssBytes: 310 * 1024 ** 2, command: "browser" },
          { pid: 914, rssBytes: 140 * 1024 ** 2, command: "journald" },
        ],
      };
  const ioBeat = 1 + Math.abs(Math.sin(now / 1300));
  // Storage: a light I/O background under the CPU sims; the disk sims drive the
  // media to high utilization (mode 3 — pinned busy, but the queue and service
  // time stay low) or full saturation (mode 4 — the request queue and await
  // blow out while throughput plateaus under contention). The fields map
  // straight onto the iostat terminal's columns (rkB/s, wkB/s, await, aqu-sz,
  // %util) and its queue/await/util/saturation bars.
  const mib = 1024 * 1024;
  const wobble = 0.85 + 0.3 * Math.abs(Math.sin(now / 900));
  const simStorage = diskMode
    ? {
        utilization: diskSaturated
          ? clampRatio(0.985 + 0.012 * Math.sin(now / 2000))
          : clampRatio(0.93 + 0.045 * Math.sin(now / 2000)),
        // Saturation (not raw utilization) is the health signal: ~100% busy is
        // fine until the queue and await pile up, which only mode 4 does.
        saturation: diskSaturated
          ? clampRatio(0.6 + 0.4 * Math.abs(Math.sin(now / 2300)))
          : clampRatio(0.05 + 0.04 * Math.abs(Math.sin(now / 1900))),
        errors: 0,
        // aqu-sz: mode 4 backs up well past the iostat bar's 8.0 full-scale.
        queueDepth: diskSaturated ? 13 + 6 * Math.abs(Math.sin(now / 1700)) : 1.3 + 0.6 * Math.abs(Math.sin(now / 1500)),
        // await (ms): mode 4 climbs toward a quarter-second; mode 3 stays single digit.
        awaitMillis: diskSaturated ? 165 + 55 * Math.abs(Math.sin(now / 1300)) : 6.5 + 3 * Math.abs(Math.sin(now / 1100)),
        // Contention makes the saturated media serve a little slower per request,
        // so its throughput is lower than the merely-busy case.
        readBytesPerSecond: (diskSaturated ? 96 : 168) * mib * wobble,
        writeBytesPerSecond: (diskSaturated ? 64 : 120) * mib * wobble,
      }
    : {
        utilization: clampRatio(0.04 + utilization * 0.12),
        saturation: 0,
        errors: 0,
        readBytesPerSecond: (18 + utilization * 180) * ioBeat * 1024,
        writeBytesPerSecond: (26 + utilization * 260) * ioBeat * 1024,
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
      memoryMode ? Math.max(simMemory.utilization, simMemory.saturation) : 0
    )),
    uptimeSeconds: 3 * 86400 + performance.now() / 1000,
    cpu: {
      utilization,
      saturation: cpuPressure,
      errors: 0,
      logicalCpus: count,
      runQueuePressure,
      loadPressure,
      load1: memoryMode ? count * 0.18 : Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(0) ?? 0) / 1000),
      load5: memoryMode ? count * 0.16 : Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(1) ?? 0) / 1000),
      load15: memoryMode ? count * 0.14 : Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(2) ?? 0) / 1000),
      cores,
      // vmstat detail derived from the simulated CPU state (no live source).
      runQueue: memoryMode ? 1 : Math.max(count, Math.round(count * (1 + runQueuePressure))),
      // Read the engine's effective D-state count (the same value that drives the
      // green I/O-wait orb stack) so the vmstat `b` column tracks the orbs exactly.
      blocked: memorySaturated ? 2 : (memoryMode ? 0 : Math.max(0, engine?._DoomPerf_GetEffectiveCpuBlockedCount?.() ?? 0)),
      user: clampRatio(utilization * 0.7),
      system: clampRatio(utilization * 0.3),
      idle: clampRatio(1 - utilization),
      iowait: 0,
      steal: 0,
      contextSwitchesPerSecond: Math.round(1200 + cpuPressure * 28000 + utilization * 6000 + (memorySaturated ? 4200 : 0)),
      interruptsPerSecond: Math.round(800 + utilization * 7000 + (memorySaturated ? 1800 : 0)),
    },
    // A scenario is a self-contained simulation, so its memory/io are the
    // simulated background (not the host's real stats) -- keeping the whole
    // picture coherent with the simulated CPU.
    memory: simMemory,
    storage: simStorage,
    network: liveTelemetry?.network ?? quietResource,
  };
};

const start = async () => {
  const engineResponse = await fetch(engineScriptUrl, { method: "HEAD" });
  if (engineResponse.ok) {
    attachAudioUnlock();
    const terminal = createTerminalOverlay();
    const movementPad = createMovementPad();
    const menuControls = createMenuControls();

    // On touch, the engine's SDL layer turns canvas drags into mouse-look. Stop
    // canvas-targeted touch/pointer/mouse events in the capture phase (which runs
    // before SDL's own canvas listeners) so the movement pad is the only steering
    // input. The pad and interact button have their own element as the event
    // target, so their taps pass through untouched.
    if (isTouchDevice) {
      const swallowCanvasInput = (event: Event) => {
        if (event.target === canvas) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
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
      if (lastLiveTelemetry) {
        pushTelemetryToEngine(engine, lastLiveTelemetry);
      }
      const mode = engine?._DoomPerf_GetSimMode?.() ?? 0;
      const inScenario = mode >= 1 && mode <= 6;
      const now = Date.now();
      if (!inScenario) {
        lastScenario = undefined;
      } else if (forceScenarioSample || !lastScenario || now - lastScenarioAt >= scenarioSampleMs) {
        lastScenario = scenarioTelemetry(engine, lastLiveTelemetry);
        lastScenarioAt = now;
      }
      lastEffectiveTelemetry = lastScenario ?? lastLiveTelemetry;
      if (lastEffectiveTelemetry) {
        terminal.update(lastEffectiveTelemetry);
      }
    };

    const telemetryClient = createTelemetryClient(telemetrySource, (telemetry) => {
      lastLiveTelemetry = telemetry;
      refreshEffectiveTelemetry();
    });

    const terminalRefresh = window.setInterval(refreshEffectiveTelemetry, 250);

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
      const engine = getEngine();
      if (!engine?._DoomPerf_PlayerActive?.()) return null;
      const px = engine._DoomPerf_PlayerX?.() ?? 0;
      const py = engine._DoomPerf_PlayerY?.() ?? 0;
      const angle = ((engine._DoomPerf_PlayerAngle?.() ?? 0) * Math.PI) / 180;
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

    // True when the door at the given probe point has already lifted open. Used
    // to suppress the "Open Door" prompt while the door is open (it auto-closes
    // a few seconds later, at which point the prompt returns).
    const doorIsOpen = (probeX: number, probeY: number) =>
      (getEngine()?._DoomPerf_SectorOpenRange?.(probeX, probeY) ?? 0) > doorOpenThreshold;

    const openTerminal = (sign: TerminalSign) => {
      movementPad.hide();
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
      if (!target) return;
      if (target.kind === "terminal") {
        openTerminal(target.sign);
      } else if (fromButton) {
        synthesizeUsePress();
      }
    };

    const prompt = createInteractPrompt(() => interact(true));
    const updatePrompt = () => {
      // The touch controls ride the same poll. In a live level the movement pad
      // shows; on the title/menu screens the menu controls show instead; while a
      // terminal overlay is open, neither does. pad.hide() also releases any
      // held arrow keys.
      if (isTouchDevice) {
        const playerActive = !!getEngine()?._DoomPerf_PlayerActive?.();
        if (terminal.isOpen()) {
          movementPad.hide();
          menuControls.hide();
        } else if (playerActive) {
          menuControls.hide();
          movementPad.show();
        } else {
          movementPad.hide();
          menuControls.show();
        }
      }
      if (terminal.isOpen()) {
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

    const wasmResponse = await fetch(engineWasmUrl, { method: "HEAD" });
    await bootstrapEngine({
      wadUrl,
      canvas,
      audio,
      engineScriptUrl,
      wasmUrl: wasmResponse.ok ? engineWasmUrl : undefined,
      extraWads: [doomPerfMapWad],
      args: ["doom", "-file", doomPerfMapWad.name],
      onStatus: (message) => console.log(message),
    });

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
      const escape = (type: "keydown" | "keyup") => {
        const event = new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
        Object.defineProperty(event, "keyCode", { get: () => 27 });
        Object.defineProperty(event, "which", { get: () => 27 });
        document.dispatchEvent(event);
      };
      escape("keydown");
      window.setTimeout(() => escape("keyup"), 90);
    }, 800);
    return;
  }
  console.warn("Engine bundle not found, falling back to stub renderer.");
  await D_DoomMain(wadUrl, canvas);
};

void start();
