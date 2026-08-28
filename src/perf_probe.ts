// In-page profiling probe for the perf harness (PERF_TUNE_PLAN.md Part 0.4).
//
// Attaches `window.__perfProbe` ONLY when the page is loaded with `?perf-bench=1`
// (the harness always adds that flag). It is a passive observer: a requestAnimationFrame
// timing ring buffer, a longtask PerformanceObserver, and a heap/DOM sampler. It never
// drives the engine — it only reads what is already happening — so leaving the flag off
// costs nothing.
//
// The harness calls `snapshot()` to pull the JSON at the end of a run, `reset()` to zero
// the accumulators after the warmup window, and `marker(label)` to drop a labelled point
// into a manual/attach time series so a spike can be correlated with what the operator was
// doing. The engine render-frame counter (DoomPerf_GetRenderFrameCount, added to
// wasm/i_video_ems.c) is read opportunistically: when the export is present the snapshot
// reports the *rendered* engine frame rate alongside the *presented* rAF rate; when it is
// absent (e.g. an un-rebuilt engine) those fields degrade to `available: false` rather
// than failing.

const LONG_FRAME_MS = 50; // a rAF gap this long counts as a "long frame" (jank)
const SAMPLE_INTERVAL_MS = 500; // heap / DOM-node polling cadence
const MAX_FRAME_SAMPLES = 200000; // ring-buffer cap (~55 min at 60fps) — keeps memory bounded

type EngineModule = {
  _DoomPerf_GetRenderFrameCount?: () => number;
  _DoomPerf_GetSimMode?: () => number;
  wasmMemory?: { buffer?: ArrayBufferLike };
  HEAP8?: { buffer?: ArrayBufferLike; byteLength?: number };
};

type PerfMemory = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };

export interface PerfProbe {
  reset: () => void;
  marker: (label: string) => void;
  snapshot: () => PerfSnapshot;
}

export interface PerfSnapshot {
  schema: "doomperf-perf-probe/1";
  wallClock: number;
  now: number;
  window: { startedAt: number; startedWallClock: number; elapsedMs: number };
  raf: {
    frames: number;
    fps: number;
    frameMs: { mean: number; p50: number; p95: number; p99: number; min: number; max: number } | null;
    longFrames: number;
    longFrameThresholdMs: number;
  };
  longtasks: { supported: boolean; count: number; totalMs: number; maxMs: number };
  render: { available: boolean; frames: number | null; fps: number | null; total: number | null };
  simMode: number | null;
  jsHeap: { available: boolean; usedBytes: number | null; peakBytes: number | null; limitBytes: number | null };
  wasmHeap: { available: boolean; bytes: number | null; peakBytes: number | null };
  dom: { nodes: number | null; peakNodes: number | null };
  samples: number;
  markers: { t: number; label: string }[];
}

const getEngine = (): EngineModule | undefined =>
  (globalThis as { DoomEngine?: EngineModule }).DoomEngine;

const readWasmHeapBytes = (): number | null => {
  const engine = getEngine();
  if (!engine) return null;
  const fromMemory = engine.wasmMemory?.buffer?.byteLength;
  if (typeof fromMemory === "number") return fromMemory;
  const fromHeapBuffer = engine.HEAP8?.buffer?.byteLength;
  if (typeof fromHeapBuffer === "number") return fromHeapBuffer;
  const fromHeapLen = engine.HEAP8?.byteLength;
  if (typeof fromHeapLen === "number") return fromHeapLen;
  return null;
};

const readRenderFrames = (): number | null => {
  const engine = getEngine();
  const value = engine?._DoomPerf_GetRenderFrameCount?.();
  return typeof value === "number" ? value >>> 0 : null;
};

const readSimMode = (): number | null => {
  const engine = getEngine();
  const value = engine?._DoomPerf_GetSimMode?.();
  return typeof value === "number" ? value : null;
};

const readJsHeap = (): PerfMemory | null => {
  const mem = (performance as Performance & { memory?: PerfMemory }).memory;
  return mem && typeof mem.usedJSHeapSize === "number" ? mem : null;
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

// Install the probe. Safe to call once; a second call returns the existing instance.
export function installPerfProbe(): PerfProbe {
  const existing = (globalThis as { __perfProbe?: PerfProbe }).__perfProbe;
  if (existing) return existing;

  // --- rAF cadence -----------------------------------------------------------
  let frameTimes: number[] = []; // gaps between consecutive rAF callbacks, ms
  let longFrames = 0;
  let lastRafTs: number | null = null;

  // --- longtasks -------------------------------------------------------------
  let longtaskCount = 0;
  let longtaskTotalMs = 0;
  let longtaskMaxMs = 0;
  let longtaskSupported = false;

  // --- engine render counter (delta over the window) -------------------------
  let renderBaseline: number | null = null;

  // --- heap / DOM peaks ------------------------------------------------------
  let jsHeapPeak: number | null = null;
  let wasmHeapPeak: number | null = null;
  let domPeak: number | null = null;
  let sampleCount = 0;

  // --- window bookkeeping ----------------------------------------------------
  let windowStart = performance.now();
  let windowStartWall = Date.now();
  const markers: { t: number; label: string }[] = [];

  const rafLoop = (ts: number) => {
    if (lastRafTs !== null) {
      const gap = ts - lastRafTs;
      if (frameTimes.length < MAX_FRAME_SAMPLES) frameTimes.push(gap);
      if (gap > LONG_FRAME_MS) longFrames++;
    }
    lastRafTs = ts;
    requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longtaskCount++;
        longtaskTotalMs += entry.duration;
        if (entry.duration > longtaskMaxMs) longtaskMaxMs = entry.duration;
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    longtaskSupported = true;
  } catch {
    longtaskSupported = false; // Safari/Firefox: no longtask entry type
  }

  const sample = () => {
    sampleCount++;
    const js = readJsHeap();
    if (js) jsHeapPeak = Math.max(jsHeapPeak ?? 0, js.usedJSHeapSize);
    const wasm = readWasmHeapBytes();
    if (wasm !== null) wasmHeapPeak = Math.max(wasmHeapPeak ?? 0, wasm);
    const nodes = document.getElementsByTagName("*").length;
    domPeak = Math.max(domPeak ?? 0, nodes);
    // Lazily baseline the render counter once the engine is up (it boots after the probe).
    if (renderBaseline === null) {
      const rf = readRenderFrames();
      if (rf !== null) renderBaseline = rf;
    }
  };
  const sampleTimer = setInterval(sample, SAMPLE_INTERVAL_MS);
  sample(); // one immediate sample so a very short run still has data
  // Never let the sampler pin the process alive in node-driven contexts.
  (sampleTimer as unknown as { unref?: () => void }).unref?.();

  const reset = () => {
    frameTimes = [];
    longFrames = 0;
    lastRafTs = null;
    longtaskCount = 0;
    longtaskTotalMs = 0;
    longtaskMaxMs = 0;
    renderBaseline = readRenderFrames();
    jsHeapPeak = null;
    wasmHeapPeak = null;
    domPeak = null;
    sampleCount = 0;
    windowStart = performance.now();
    windowStartWall = Date.now();
    markers.length = 0;
    sample();
  };

  const marker = (label: string) => {
    markers.push({ t: Date.now(), label: String(label) });
  };

  const snapshot = (): PerfSnapshot => {
    const now = performance.now();
    const elapsedMs = now - windowStart;
    const elapsedSec = elapsedMs / 1000;

    const sorted = [...frameTimes].sort((a, b) => a - b);
    const frameMs = sorted.length
      ? {
          mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          min: sorted[0],
          max: sorted[sorted.length - 1],
        }
      : null;

    // rAF frames observed = number of measured gaps (one fewer than callbacks, but the
    // difference is negligible over a run and consistent across runs).
    const rafFrames = frameTimes.length;

    const renderTotal = readRenderFrames();
    const renderAvailable = renderTotal !== null && renderBaseline !== null;
    const renderFrames = renderAvailable ? renderTotal! - renderBaseline! : null;
    const renderFps = renderFrames !== null && elapsedSec > 0 ? renderFrames / elapsedSec : null;

    const js = readJsHeap();
    const wasmBytes = readWasmHeapBytes();
    const domNodes = document.getElementsByTagName("*").length;

    return {
      schema: "doomperf-perf-probe/1",
      wallClock: Date.now(),
      now,
      window: { startedAt: windowStart, startedWallClock: windowStartWall, elapsedMs },
      raf: {
        frames: rafFrames,
        fps: elapsedSec > 0 ? rafFrames / elapsedSec : 0,
        frameMs,
        longFrames,
        longFrameThresholdMs: LONG_FRAME_MS,
      },
      longtasks: {
        supported: longtaskSupported,
        count: longtaskCount,
        totalMs: longtaskTotalMs,
        maxMs: longtaskMaxMs,
      },
      render: {
        available: renderAvailable,
        frames: renderFrames,
        fps: renderFps,
        total: renderTotal,
      },
      simMode: readSimMode(),
      jsHeap: {
        available: js !== null,
        usedBytes: js ? js.usedJSHeapSize : null,
        peakBytes: jsHeapPeak,
        limitBytes: js ? js.jsHeapSizeLimit : null,
      },
      wasmHeap: { available: wasmBytes !== null, bytes: wasmBytes, peakBytes: wasmHeapPeak },
      dom: { nodes: domNodes, peakNodes: domPeak },
      samples: sampleCount,
      markers: [...markers],
    };
  };

  const probe: PerfProbe = { reset, marker, snapshot };
  (globalThis as { __perfProbe?: PerfProbe }).__perfProbe = probe;
  return probe;
}
