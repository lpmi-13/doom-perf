import { bootstrapEngine } from "./engine_bootstrap";
import { D_DoomMain } from "./d_main";
import { bootstrapWebgl } from "./webgl_bootstrap";
import { createTelemetryClient, createTerminalOverlay, resolveTelemetrySource } from "./telemetry";
import type { TelemetrySnapshot, TerminalSign } from "./telemetry";
import { createInteractPrompt } from "./interact";

// The engine's USE trace reaches USERANGE (linuxdoom p_local.h = 64 map units)
// in front of the player, so pressing space — or tapping the on-screen prompt,
// which synthesizes a space press — only opens a door or activates a terminal
// once the player is within that distance. The interact prompt is gated on the
// same value so it never advertises an interaction the player is still too far
// away to perform.
const useRange = 64;

// World positions (CPU/north wing) of the wall terminal screens, matching
// build-doomperf-map.mjs. Pressing USE/space within range opens that terminal.
const terminalSigns: { sign: TerminalSign; x: number; y: number }[] = [
  { sign: "cores", x: 0, y: 1436 },
  { sign: "runqueue", x: -576, y: 1436 },
  { sign: "load", x: 576, y: 1436 },
];
const terminalRange = useRange;

// World positions of the four hub doors, one per cardinal exit. These derive
// from build-doomperf-map.mjs: each door sits at hubRadius (384) along its
// direction (north/east/south/west -> +y/+x/-y/-x). Each point lies exactly on
// the door's trigger line, so the radial distance below equals the perpendicular
// distance the engine's USE trace measures on a head-on approach. Used only to
// decide when to surface the interact prompt; the engine itself handles the
// door once it receives the USE/space press.
// `probe` is a point at the centre of the door sector just beyond the trigger
// line (the 64-deep door sector spans hubRadius..448, so its centre is at 416).
// The engine reports that sector's live ceiling opening there, letting us tell
// a shut door from one the player has already opened.
const doorSigns: { x: number; y: number; probeX: number; probeY: number }[] = [
  { x: 0, y: 384, probeX: 0, probeY: 416 },
  { x: 384, y: 0, probeX: 416, probeY: 0 },
  { x: 0, y: -384, probeX: 0, probeY: -416 },
  { x: -384, y: 0, probeX: -416, probeY: 0 },
];
const doorRange = useRange;
// A shut DR door reports a ceiling opening of 0; once it has lifted past this
// many map units it is opening/open, so the "Open Door" prompt is suppressed.
const doorOpenThreshold = 16;

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

const engineAssetVersion = "door-state-20260531";
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
  engine?._DoomPerf_SetCpuLoadPressure?.(Math.round(telemetry.cpu.loadPressure * 1000));
  engine?._DoomPerf_SetLoad?.(0, Math.round(telemetry.cpu.load1 * 1000));
  engine?._DoomPerf_SetLoad?.(1, Math.round(telemetry.cpu.load5 * 1000));
  engine?._DoomPerf_SetLoad?.(2, Math.round(telemetry.cpu.load15 * 1000));
};

const scenarioTelemetry = (
  engine: DoomPerfEngine | undefined,
  liveTelemetry: TelemetrySnapshot | undefined
): TelemetrySnapshot | undefined => {
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
      onStatus: (message) => console.log(message),
    });
    return;
  }
  const engineResponse = await fetch(engineScriptUrl, { method: "HEAD" });
  if (engineResponse.ok) {
    attachAudioUnlock();
    const terminal = createTerminalOverlay();
    let lastLiveTelemetry: TelemetrySnapshot | undefined;
    let lastEffectiveTelemetry: TelemetrySnapshot | undefined;

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

    // The interactable (terminal or door) the player is currently standing
    // close enough to use, or null. Doors are checked only when no terminal is
    // in range; the two never overlap in the map, but terminals win to be safe.
    const currentTarget = ():
      | { kind: "terminal"; sign: TerminalSign }
      | { kind: "door"; probeX: number; probeY: number }
      | null => {
      const engine = getEngine();
      if (!engine?._DoomPerf_PlayerActive?.()) return null;
      const px = engine._DoomPerf_PlayerX?.() ?? 0;
      const py = engine._DoomPerf_PlayerY?.() ?? 0;
      const nearTerminal = terminalSigns.find(
        ({ x, y }) => Math.hypot(px - x, py - y) <= terminalRange
      );
      if (nearTerminal) return { kind: "terminal", sign: nearTerminal.sign };
      const door = doorSigns.find(
        ({ x, y }) => Math.hypot(px - x, py - y) <= doorRange
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
      refreshEffectiveTelemetry();
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
    return;
  }
  console.warn("Engine bundle not found, falling back to stub renderer.");
  await D_DoomMain(wadUrl, canvas);
};

void start();
