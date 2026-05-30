import { renderGame } from "./engine-webgl/render/renderGame";
import { renderHudOverlay } from "./engine-webgl/render/renderHudOverlay";
import { loadWadFromUrl } from "./engine-webgl/wad/loadWadFromBlob";
import type { Wad } from "./engine-webgl/interfaces/Wad";
import { S_Init } from "./s_sound";
import { S_LoadSoundRegistry } from "./s_sound_registry";
import { createTelemetryClient, resolveTelemetrySource } from "./telemetry";

export interface WebglBootstrapOptions {
  wadUrl: string;
  canvas: HTMLCanvasElement;
  mapName?: string;
  telemetrySource?: string | null;
  onStatus?: (message: string) => void;
}

const pickMapName = (wad: Wad, mapName?: string): string => {
  if (mapName && wad.maps[mapName]) {
    return mapName;
  }
  const maps = Object.keys(wad.maps);
  if (maps.length === 0) {
    throw new Error("No maps found in WAD.");
  }
  return maps[0];
};

const splashImages = [
  "/assets/splash-1.webp",
  "/assets/splash-2.webp",
  "/assets/splash-3.jpg",
  "/assets/splash-4.jpg",
];

const createSplashOverlay = () => {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "black";
  overlay.style.backgroundSize = "cover";
  overlay.style.backgroundPosition = "center";
  overlay.style.backgroundRepeat = "no-repeat";
  overlay.style.color = "white";
  overlay.style.fontFamily = "sans-serif";
  overlay.style.fontSize = "24px";
  overlay.style.zIndex = "10";
  overlay.textContent = "Press any key to continue";
  document.body.appendChild(overlay);
  return overlay;
};

const createMenuOverlay = () => {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.backgroundImage = "url('/assets/menu-bg.jpg')";
  overlay.style.backgroundSize = "cover";
  overlay.style.backgroundPosition = "center";
  overlay.style.backgroundRepeat = "no-repeat";
  overlay.style.zIndex = "9";

  const button = document.createElement("button");
  button.textContent = "Start Game";
  button.style.fontSize = "28px";
  button.style.padding = "12px 24px";
  button.style.border = "2px solid #fff";
  button.style.color = "#fff";
  button.style.background = "rgba(0, 0, 0, 0.6)";
  button.style.cursor = "pointer";

  overlay.appendChild(button);
  document.body.appendChild(overlay);
  return { overlay, button };
};

export const bootstrapWebgl = async ({
  wadUrl,
  canvas,
  mapName,
  telemetrySource = resolveTelemetrySource(),
  onStatus,
}: WebglBootstrapOptions): Promise<void> => {
  onStatus?.("Loading WAD...");
  const wad = await loadWadFromUrl(wadUrl);
  const activeMapName = pickMapName(wad, mapName);
  const map = wad.maps[activeMapName];
  if (!map) {
    throw new Error(`Map ${activeMapName} not found in WAD.`);
  }
  S_LoadSoundRegistry(wad);
  onStatus?.("Press any key to continue.");
  const splash = createSplashOverlay();
  let splashIndex = 0;
  splash.style.backgroundImage = `url('${splashImages[splashIndex]}')`;
  const splashInterval = window.setInterval(() => {
    splashIndex = (splashIndex + 1) % splashImages.length;
    splash.style.backgroundImage = `url('${splashImages[splashIndex]}')`;
  }, 1800);

  await new Promise<void>((resolve) => {
    const start = () => {
      window.clearInterval(splashInterval);
      splash.remove();
      resolve();
    };
    window.addEventListener("keydown", start, { once: true });
    splash.addEventListener("pointerdown", start, { once: true });
  });

  onStatus?.("Press Enter to start.");
  const { overlay: menu, button } = createMenuOverlay();
  await new Promise<void>((resolve) => {
    const start = () => {
      menu.remove();
      S_Init(15, 15);
      resolve();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === "Enter") {
        start();
      }
    };
    window.addEventListener("keydown", handleKey, { once: true });
    button.addEventListener("click", start, { once: true });
  });

  onStatus?.(`Rendering ${activeMapName}...`);
  const hudOverlay = renderHudOverlay(wad, canvas);
  if (telemetrySource) {
    const telemetryClient = createTelemetryClient(telemetrySource, (telemetry) => {
      hudOverlay?.update({ telemetry });
    });
    window.addEventListener("beforeunload", () => telemetryClient.close(), { once: true });
  }
  const engine = renderGame(canvas, {
    onHudUpdate: (state) => hudOverlay?.update(state),
  });
  engine.loadWad(wad, map);
  onStatus?.("WebGL renderer started.");
};
