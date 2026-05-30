import { createDoomAudioBridge } from "./doom_audio_bridge";

export interface EngineBootstrapOptions {
  wadUrl: string;
  canvas: HTMLCanvasElement;
  audio: HTMLAudioElement;
  engineScriptUrl?: string;
  wasmUrl?: string;
  extraWads?: EngineWadFile[];
  args?: string[];
  onStatus?: (message: string) => void;
}

export interface EngineWadFile {
  url: string;
  name: string;
}

type EngineModule = {
  FS_createDataFile?: (path: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void;
  FS?: {
    createDataFile?: (path: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void;
    analyzePath?: (path: string) => { exists: boolean };
  };
  callMain?: (args: string[]) => void;
  arguments?: string[];
  setCanvasSize?: (width: number, height: number) => void;
  setStatus?: (status: string) => void;
};

const defaultEngineScriptUrl = "/engine/doom.js";
const defaultWasmUrl = "/engine/doom.wasm";

export async function bootstrapEngine({
  wadUrl,
  canvas,
  audio,
  engineScriptUrl = defaultEngineScriptUrl,
  wasmUrl = defaultWasmUrl,
  extraWads = [],
  args = [],
  onStatus,
}: EngineBootstrapOptions): Promise<void> {
  const engineModule = (await import(engineScriptUrl)) as Record<string, unknown>;
  const createModule =
    (engineModule.default as (options: Record<string, unknown>) => Promise<EngineModule>) ??
    (engineModule.createDoomModule as (options: Record<string, unknown>) => Promise<EngineModule>) ??
    (engineModule.createModule as (options: Record<string, unknown>) => Promise<EngineModule>) ??
    (engineModule as unknown as (options: Record<string, unknown>) => Promise<EngineModule>);

  if (typeof createModule !== "function") {
    throw new Error("Engine module factory not found.");
  }

  const wadName = wadUrl.split("/").pop() ?? "doom.wad";
  const wadNameLower = wadName.toLowerCase();
  const response = await fetch(wadUrl);
  if (!response.ok) {
    throw new Error(`Failed to load WAD: ${response.status} ${response.statusText}`);
  }
  const wadBytes = new Uint8Array(await response.arrayBuffer());
  const extraWadBytes = await Promise.all(
    extraWads.map(async ({ name, url }) => {
      const extraResponse = await fetch(url);
      if (!extraResponse.ok) {
        throw new Error(`Failed to load WAD ${name}: ${extraResponse.status} ${extraResponse.statusText}`);
      }
      return { name, bytes: new Uint8Array(await extraResponse.arrayBuffer()) };
    })
  );

  const audioBridge = createDoomAudioBridge();

  const moduleInstance = await createModule({
    canvas,
    noInitialRun: true,
    locateFile: (path: string) => (path.endsWith(".wasm") && wasmUrl ? wasmUrl : path),
    audioElement: audio,
    audio,
    _doomAudio: audioBridge,
    setStatus: (status: string) => onStatus?.(status),
    print: (message: string) => console.log(message),
    printErr: (message: string) => console.error(message),
  });

  // Expose the running engine so the telemetry client can push live metrics
  // into the WASM module (e.g. DoomPerf_SetCpuCore for CPU room instruments).
  (globalThis as { DoomEngine?: unknown }).DoomEngine = moduleInstance;

  if (moduleInstance.FS?.chdir) {
    moduleInstance.FS.chdir("/");
  } else if (typeof (moduleInstance as { FS_chdir?: (path: string) => void }).FS_chdir === "function") {
    (moduleInstance as { FS_chdir: (path: string) => void }).FS_chdir("/");
  }

  const names = new Set<string>();
  names.add(wadNameLower);
  if (wadNameLower.includes("doom2")) {
    names.add("doom2.wad");
  } else if (wadNameLower.includes("doom1")) {
    names.add("doom1.wad");
  } else if (wadNameLower.includes("doomu")) {
    names.add("doomu.wad");
  } else if (wadNameLower.includes("doom")) {
    names.add("doom.wad");
  } else {
    names.add("doom1.wad");
  }

  for (const name of names) {
    if (typeof moduleInstance.FS_createDataFile === "function") {
      moduleInstance.FS_createDataFile("/", name, wadBytes, true, true);
    } else if (moduleInstance.FS?.createDataFile) {
      moduleInstance.FS.createDataFile("/", name, wadBytes, true, true);
    }
    const exists = moduleInstance.FS?.analyzePath?.(`/${name}`)?.exists;
    console.log(`WAD ${name} exists: ${exists ? "yes" : "no"}`);
  }

  for (const { name, bytes } of extraWadBytes) {
    if (typeof moduleInstance.FS_createDataFile === "function") {
      moduleInstance.FS_createDataFile("/", name, bytes, true, true);
    } else if (moduleInstance.FS?.createDataFile) {
      moduleInstance.FS.createDataFile("/", name, bytes, true, true);
    }
    const exists = moduleInstance.FS?.analyzePath?.(`/${name}`)?.exists;
    console.log(`WAD ${name} exists: ${exists ? "yes" : "no"}`);
  }

  const argv = args.length ? [...args] : ["doom"];
  moduleInstance.arguments = argv;
  const callMain =
    typeof moduleInstance.callMain === "function"
      ? moduleInstance.callMain.bind(moduleInstance)
      : (moduleInstance as { _main?: (argc: number, argv: number) => void })._main
        ? () => (moduleInstance as { _main: () => void })._main()
        : undefined;
  console.log(`Engine callMain: ${callMain ? "yes" : "no"}`);
  if (!callMain) {
    throw new Error("Engine entry point not found.");
  }

  // Initialize audio before callMain (which never returns due to Asyncify game loop).
  // The _doomAudio bridge on the module handles all C-to-JS sound calls.
  // We just need to ensure the AudioContext is unlocked on first user gesture.
  const unlockAudio = () => {
    audioBridge.initSound();
    audioBridge.initMusic();
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  };
  window.addEventListener("pointerdown", unlockAudio, { once: true });
  window.addEventListener("keydown", unlockAudio, { once: true });

  callMain(argv);
  onStatus?.("Engine running.");
}
