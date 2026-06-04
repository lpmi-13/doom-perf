import { bootstrapEngine } from "./engine_bootstrap";
import { D_DoomMain } from "./d_main";
import { createTelemetryClient, createTerminalOverlay, resolveTelemetrySource } from "./telemetry";
import type { TelemetrySnapshot, TerminalSign } from "./telemetry";
import { createInteractPrompt } from "./interact";
import { createMovementPad } from "./ui/movementPad";
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

// World positions (CPU/north wing) of the wall terminal screens. Pressing
// USE/space within range opens that terminal.
const terminalSigns: { sign: TerminalSign; x: number; y: number }[] = mapManifest.terminals.map(
  (terminal) => ({ sign: terminal.sign, x: terminal.x, y: terminal.y })
);
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
const doorSigns: { x: number; y: number; probeX: number; probeY: number }[] = mapManifest.doors.map(
  (door) => ({ x: door.x, y: door.y, probeX: door.probeX, probeY: door.probeY })
);
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
  const now = Date.now();
  // Background system stats so the vmstat memory/swap/io columns aren't blank.
  // They sit at a low baseline and rise gently with CPU activity (a busier box
  // touches more memory and does more I/O); a future memory-pressure scenario
  // would push memUtil up and free/cache/swap would follow automatically.
  const totalBytes = 8 * 1024 ** 3;
  const memUtil = clampRatio(0.22 + utilization * 0.12 + cpuPressure * 0.05 + 0.02 * Math.sin(now / 5000));
  const cacheFrac = clampRatio(0.4 - memUtil * 0.35);
  const freeFrac = clampRatio(1 - 0.03 - cacheFrac - memUtil);
  const swapUsedBytes = memUtil > 0.85 ? totalBytes * (memUtil - 0.85) * 1.2 : 0;
  const simMemory = {
    utilization: memUtil,
    saturation: clampRatio((memUtil - 0.9) * 6),
    errors: 0,
    totalBytes,
    freeBytes: totalBytes * freeFrac,
    buffersBytes: totalBytes * 0.03,
    cachedBytes: totalBytes * cacheFrac,
    availableBytes: totalBytes * (freeFrac + cacheFrac * 0.85),
    swapUsedBytes,
    swapInPagesPerSecond: 0,
    swapOutPagesPerSecond: swapUsedBytes > 0 ? 60 + utilization * 200 : 0,
  };
  const ioBeat = 1 + Math.abs(Math.sin(now / 1300));
  const simStorage = {
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
    health: clampRatio(1 - Math.max(utilization, cpuPressure)),
    uptimeSeconds: 3 * 86400 + performance.now() / 1000,
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
      // vmstat detail derived from the simulated CPU state (no live source).
      runQueue: Math.max(count, Math.round(count * (1 + runQueuePressure))),
      blocked: 0,
      user: clampRatio(utilization * 0.7),
      system: clampRatio(utilization * 0.3),
      idle: clampRatio(1 - utilization),
      iowait: 0,
      steal: 0,
      contextSwitchesPerSecond: Math.round(1200 + cpuPressure * 28000 + utilization * 6000),
      interruptsPerSecond: Math.round(800 + utilization * 7000),
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
      const inScenario = mode === 1 || mode === 2;
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
      // The movement pad rides the same poll: visible only on touch while a
      // level is live and no terminal is open (so you can't walk while reading a
      // terminal or sitting in a menu). hide() also releases any held arrow keys.
      if (isTouchDevice) {
        const inLevel = !terminal.isOpen() && !!getEngine()?._DoomPerf_PlayerActive?.();
        if (inLevel) movementPad.show();
        else movementPad.hide();
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
    return;
  }
  console.warn("Engine bundle not found, falling back to stub renderer.");
  await D_DoomMain(wadUrl, canvas);
};

void start();
