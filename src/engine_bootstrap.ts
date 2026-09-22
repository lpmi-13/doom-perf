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
  preparedAssets?: EngineBootstrapAssets;
  onEngineReady?: (engine: Record<string, unknown>) => void;
}

export interface EngineWadFile {
  url: string;
  name: string;
}

type LoadedExtraWad = { name: string; bytes: Uint8Array };

export interface EngineBootstrapAssets {
  engineModule: Promise<Record<string, unknown>>;
  wadBytes: Promise<Uint8Array>;
  extraWadBytes: Promise<LoadedExtraWad[]>;
}

type EngineModule = {
  FS_createDataFile?: (path: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void;
  FS?: {
    createDataFile?: (path: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void;
    analyzePath?: (path: string) => { exists: boolean };
    chdir?: (path: string) => void;
    symlink?: (oldpath: string, newpath: string) => void;
  };
  callMain?: (args: string[]) => void;
  arguments?: string[];
  setCanvasSize?: (width: number, height: number) => void;
  setStatus?: (status: string) => void;
};

const defaultEngineScriptUrl = "/engine/doom.js";
const defaultWasmUrl = "/engine/doom.wasm";

const fetchWad = async (url: string, name?: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) {
    const label = name ? ` ${name}` : "";
    throw new Error(`Failed to load WAD${label}: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

// Start the engine module and every WAD request together. Callers may await the
// engine promise to decide whether a development fallback is needed without
// serializing the large IWAD request behind that probe.
export const prepareEngineAssets = ({
  wadUrl,
  engineScriptUrl = defaultEngineScriptUrl,
  extraWads = [],
}: Pick<EngineBootstrapOptions, "wadUrl" | "engineScriptUrl" | "extraWads">): EngineBootstrapAssets => {
  const assets: EngineBootstrapAssets = {
    engineModule: import(engineScriptUrl) as Promise<Record<string, unknown>>,
    wadBytes: fetchWad(wadUrl),
    extraWadBytes: Promise.all(
      extraWads.map(async ({ name, url }) => ({ name, bytes: await fetchWad(url, name) }))
    ),
  };
  // The engine import can settle first. Keep early WAD failures handled until
  // bootstrapEngine awaits and propagates the original error.
  assets.wadBytes.catch(() => {});
  assets.extraWadBytes.catch(() => {});
  return assets;
};

export async function bootstrapEngine({
  wadUrl,
  canvas,
  audio,
  engineScriptUrl = defaultEngineScriptUrl,
  wasmUrl = defaultWasmUrl,
  extraWads = [],
  args = [],
  onStatus,
  preparedAssets,
  onEngineReady,
}: EngineBootstrapOptions): Promise<void> {
  // Derive the in-FS filename from the URL, dropping any "?v=" cache-bust query
  // so it stays a clean ".wad" name (IdentifyVersion keys on doom1.wad etc.).
  const wadName = (wadUrl.split("/").pop() ?? "doom.wad").split("?")[0];
  const wadNameLower = wadName.toLowerCase();

  // Kick every download off at once instead of one-after-another: the engine
  // script and the WADs all start transferring up front, and the 1.2 MB WASM
  // begins as soon as createModule runs (below) — so it streams down alongside
  // the WADs rather than dead last. The WASM is deliberately left to the
  // engine's own fetch so WebAssembly.instantiateStreaming keeps compiling it
  // as it arrives; pre-fetching it here would disable streaming compilation.
  const assets = preparedAssets ?? prepareEngineAssets({ wadUrl, engineScriptUrl, extraWads });

  const engineModule = await assets.engineModule;
  const createModule =
    (engineModule.default as (options: Record<string, unknown>) => Promise<EngineModule>) ??
    (engineModule.createDoomModule as (options: Record<string, unknown>) => Promise<EngineModule>) ??
    (engineModule.createModule as (options: Record<string, unknown>) => Promise<EngineModule>) ??
    (engineModule as unknown as (options: Record<string, unknown>) => Promise<EngineModule>);

  if (typeof createModule !== "function") {
    throw new Error("Engine module factory not found.");
  }

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
  onEngineReady?.(moduleInstance as Record<string, unknown>);

  if (moduleInstance.FS?.chdir) {
    moduleInstance.FS.chdir("/");
  } else if (typeof (moduleInstance as { FS_chdir?: (path: string) => void }).FS_chdir === "function") {
    (moduleInstance as { FS_chdir: (path: string) => void }).FS_chdir("/");
  }

  // The WAD bytes have been downloading in parallel since the top of this
  // function (and alongside the streaming WASM); collect them now.
  const wadBytes = await assets.wadBytes;
  const extraWadBytes = await assets.extraWadBytes;

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

  // MEMFS keeps each file's bytes in a JS-side buffer, so writing the multi-MB
  // IWAD under *both* its own name and the canonical IdentifyVersion alias
  // (e.g. freedoom1.wad + doom1.wad) duplicates the whole WAD on the JS heap
  // (PERF_TUNE_PLAN Part 4.2). Write the bytes once and point every extra name
  // at them with a symlink — the engine opens whichever alias it scans for and
  // MEMFS follows the link transparently, so there is only ever one copy.
  const writeWadFile = (name: string, bytes: Uint8Array) => {
    if (typeof moduleInstance.FS_createDataFile === "function") {
      moduleInstance.FS_createDataFile("/", name, bytes, true, true);
    } else if (moduleInstance.FS?.createDataFile) {
      moduleInstance.FS.createDataFile("/", name, bytes, true, true);
    }
  };
  const nameList = [...names];
  const primaryName = nameList[0];
  writeWadFile(primaryName, wadBytes);
  for (const name of nameList.slice(1)) {
    if (moduleInstance.FS?.symlink) {
      moduleInstance.FS.symlink(`/${primaryName}`, `/${name}`);
    } else {
      // No symlink support: fall back to a full second write so the alias exists.
      writeWadFile(name, wadBytes);
    }
  }
  for (const name of nameList) {
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
