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
  url: "/maps/doomperf-lab.wad",
  name: "doomperf-lab.wad",
};
const doomPerfCpuCoreCapacity = 64;
console.log(`Loading WAD from ${wadUrl}.`);

const engineScriptUrl = "/engine/doom.js";
const engineWasmUrl = "/engine/doom.wasm";

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
    if (telemetrySource) {
      const getEngine = () =>
        (
          globalThis as {
            DoomEngine?: {
              _DoomPerf_SetCpuCoreCount?: (count: number) => void;
              _DoomPerf_SetCpuCore?: (id: number, permille: number) => void;
              _DoomPerf_SetCpuRunQueuePressure?: (permille: number) => void;
              _DoomPerf_SetCpuLoadPressure?: (permille: number) => void;
              _DoomPerf_SetLoad?: (index: number, milliLoad: number) => void;
              _DoomPerf_PlayerActive?: () => number;
              _DoomPerf_PlayerX?: () => number;
              _DoomPerf_PlayerY?: () => number;
            };
          }
        ).DoomEngine;

      const terminal = createTerminalOverlay();
      let lastTelemetry: HudTelemetry | undefined;

      const telemetryClient = createTelemetryClient(telemetrySource, (telemetry) => {
        lastTelemetry = telemetry;
        const engine = getEngine();
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
        terminal.update(telemetry);
      });

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
        if (!lastTelemetry || !engine?._DoomPerf_PlayerActive?.()) return;
        const px = engine._DoomPerf_PlayerX?.() ?? 0;
        const py = engine._DoomPerf_PlayerY?.() ?? 0;
        const near = terminalSigns.find(
          ({ x, y }) => Math.hypot(px - x, py - y) <= terminalRange
        );
        if (near) {
          terminal.open(near.sign, lastTelemetry);
        }
      };
      window.addEventListener("keydown", onKeyDown);

      window.addEventListener(
        "beforeunload",
        () => {
          telemetryClient.close();
          window.removeEventListener("keydown", onKeyDown);
        },
        { once: true }
      );
    }
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
