import { bootstrapEngine } from "./engine_bootstrap";
import { D_DoomMain } from "./d_main";
import { bootstrapWebgl } from "./webgl_bootstrap";
import { createTelemetryClient, createTerminalOverlay, resolveTelemetrySource } from "./telemetry";
import type { HudTelemetry, TerminalSign } from "./telemetry";

// World positions (CPU/north wing) of the wall terminal screens, matching
// build-doomperf-map.mjs. Pressing USE/space within range opens that terminal.
const terminalSigns: { sign: TerminalSign; x: number; y: number }[] = [
  { sign: "cores", x: 0, y: 1436 },
  { sign: "runqueue", x: -576, y: 1436 },
  { sign: "load", x: 576, y: 1436 },
];
const terminalRange = 128;

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
const rendererParam = new URLSearchParams(window.location.search).get("renderer")?.toLowerCase();
const wadMap: Record<string, string> = {
  doom1: "/wads/Doom1.WAD",
  doom2: "/wads/Doom2.wad",
};
const wadUrl = wadParam && wadMap[wadParam] ? wadMap[wadParam] : "/wads/Doom1.WAD";
const telemetrySource = resolveTelemetrySource();
const doomPerfMapWad = {
  url: "/maps/doomperf-lab.wad?v=terminal-panel-20260530",
  name: "doomperf-lab.wad",
};
const doomPerfCpuCoreCapacity = 64;
console.log(`Loading WAD from ${wadUrl}.`);

const engineAssetVersion = "sim-terminal-20260530";
const engineScriptUrl = `/engine/doom.js?v=${engineAssetVersion}`;
const engineWasmUrl = `/engine/doom.wasm?v=${engineAssetVersion}`;

type DoomPerfEngine = {
  _DoomPerf_SetCpuCoreCount?: (count: number) => void;
  _DoomPerf_SetCpuCore?: (id: number, permille: number) => void;
  _DoomPerf_SetCpuRunQueuePressure?: (permille: number) => void;
  _DoomPerf_SetCpuLoadPressure?: (permille: number) => void;
  _DoomPerf_SetLoad?: (index: number, milliLoad: number) => void;
  _DoomPerf_GetSimMode?: () => number;
  _DoomPerf_GetEffectiveCpuCoreCount?: () => number;
  _DoomPerf_GetEffectiveCpuCore?: (id: number) => number;
  _DoomPerf_GetEffectiveCpuRunQueuePressure?: () => number;
  _DoomPerf_GetEffectiveCpuLoadPressure?: () => number;
  _DoomPerf_GetEffectiveLoad?: (index: number) => number;
  _DoomPerf_PlayerActive?: () => number;
  _DoomPerf_PlayerX?: () => number;
  _DoomPerf_PlayerY?: () => number;
};

const getEngine = () =>
  (
    globalThis as {
      DoomEngine?: DoomPerfEngine;
    }
  ).DoomEngine;

const clampRatio = (value: number) => Math.max(0, Math.min(1, value));

const pushTelemetryToEngine = (engine: DoomPerfEngine | undefined, telemetry: HudTelemetry) => {
  const displayCores = telemetry.cpu.cores.filter(({ id }) => id < doomPerfCpuCoreCapacity);
  const lastDisplayCore = displayCores.reduce((largest, { id }) => Math.max(largest, id), -1);
  engine?._DoomPerf_SetCpuCoreCount?.(lastDisplayCore + 1);
  displayCores.forEach(({ id, utilization }) => {
    engine?._DoomPerf_SetCpuCore?.(id, Math.round(utilization * 1000));
  });
  engine?._DoomPerf_SetCpuRunQueuePressure?.(Math.round(telemetry.cpu.runQueuePressure * 1000));
  engine?._DoomPerf_SetCpuLoadPressure?.(Math.round(telemetry.cpu.loadPressure * 1000));
  engine?._DoomPerf_SetLoad?.(0, Math.round(telemetry.cpu.load1 * 1000));
  engine?._DoomPerf_SetLoad?.(1, Math.round(telemetry.cpu.load5 * 1000));
  engine?._DoomPerf_SetLoad?.(2, Math.round(telemetry.cpu.load15 * 1000));
};

const scenarioTelemetry = (
  engine: DoomPerfEngine | undefined,
  liveTelemetry: HudTelemetry | undefined
): HudTelemetry | undefined => {
  const mode = engine?._DoomPerf_GetSimMode?.() ?? 0;
  if (mode !== 1 && mode !== 2) {
    return undefined;
  }

  const count = Math.max(1, Math.min(doomPerfCpuCoreCapacity, engine?._DoomPerf_GetEffectiveCpuCoreCount?.() ?? 8));
  const cores = Array.from({ length: count }, (_, id) => ({
    id,
    utilization: clampRatio((engine?._DoomPerf_GetEffectiveCpuCore?.(id) ?? 0) / 1000),
  }));
  const utilization = cores.reduce((sum, { utilization: core }) => sum + core, 0) / cores.length;
  const runQueuePressure = clampRatio((engine?._DoomPerf_GetEffectiveCpuRunQueuePressure?.() ?? 0) / 1000);
  const loadPressure = clampRatio((engine?._DoomPerf_GetEffectiveCpuLoadPressure?.() ?? 0) / 1000);
  const cpuPressure = mode === 2 ? Math.max(runQueuePressure, loadPressure) : runQueuePressure;
  const quietResource = { utilization: 0.08, saturation: 0, errors: 0 };
  const source = mode === 1 ? "sim: high CPU utilization" : "sim: high CPU saturation";

  return {
    status: "live",
    source,
    updatedAt: Date.now(),
    host: "doomperf-simulation",
    health: clampRatio(1 - Math.max(utilization, cpuPressure)),
    cpu: {
      utilization,
      saturation: cpuPressure,
      errors: 0,
      logicalCpus: count,
      runQueuePressure,
      loadPressure,
      load1: Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(0) ?? 0) / 1000),
      load5: Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(1) ?? 0) / 1000),
      load15: Math.max(0, (engine?._DoomPerf_GetEffectiveLoad?.(2) ?? 0) / 1000),
      cores,
    },
    memory: liveTelemetry?.memory ?? quietResource,
    storage: liveTelemetry?.storage ?? quietResource,
    network: liveTelemetry?.network ?? quietResource,
  };
};

const start = async () => {
  if (rendererParam === "webgl") {
    attachAudioUnlock();
    await bootstrapWebgl({
      wadUrl,
      canvas,
      telemetrySource,
      onStatus: (message) => console.log(message),
    });
    return;
  }
  const engineResponse = await fetch(engineScriptUrl, { method: "HEAD" });
  if (engineResponse.ok) {
    attachAudioUnlock();
    const terminal = createTerminalOverlay();
    let lastLiveTelemetry: HudTelemetry | undefined;
    let lastEffectiveTelemetry: HudTelemetry | undefined;

    const refreshEffectiveTelemetry = () => {
      const engine = getEngine();
      if (lastLiveTelemetry) {
        pushTelemetryToEngine(engine, lastLiveTelemetry);
      }
      const scenario = scenarioTelemetry(engine, lastLiveTelemetry);
      lastEffectiveTelemetry = scenario ?? lastLiveTelemetry;
      if (lastEffectiveTelemetry) {
        terminal.update(lastEffectiveTelemetry);
      }
    };

    const telemetryClient = createTelemetryClient(telemetrySource, (telemetry) => {
      lastLiveTelemetry = telemetry;
      refreshEffectiveTelemetry();
    });

    const terminalRefresh = window.setInterval(refreshEffectiveTelemetry, 250);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "Escape") {
        terminal.close();
        return;
      }
      if (event.code !== "Space") return;
      if (terminal.isOpen()) {
        terminal.close();
        return;
      }
      const engine = getEngine();
      refreshEffectiveTelemetry();
      const telemetry = lastEffectiveTelemetry ?? lastLiveTelemetry;
      if (!telemetry || !engine?._DoomPerf_PlayerActive?.()) return;
      const px = engine._DoomPerf_PlayerX?.() ?? 0;
      const py = engine._DoomPerf_PlayerY?.() ?? 0;
      const near = terminalSigns.find(
        ({ x, y }) => Math.hypot(px - x, py - y) <= terminalRange
      );
      if (near) {
        terminal.open(near.sign, telemetry);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    window.addEventListener(
      "beforeunload",
      () => {
        telemetryClient.close();
        window.clearInterval(terminalRefresh);
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
    return;
  }
  console.warn("Engine bundle not found, falling back to stub renderer.");
  await D_DoomMain(wadUrl, canvas);
};

void start();
