import type { Wad } from "../interfaces/Wad";
import type { HudTelemetry, ResourceTelemetry } from "../../telemetry";

import { drawPatch } from "./drawPatch";

const BASE_WIDTH = 320;
const BASE_HEIGHT = 200;

const HUD_POSITIONS = {
  ammo: { x: 44, y: 171 },
  health: { x: 90, y: 171 },
  armor: { x: 221, y: 171 },
  face: { x: 143, y: 168 },
  keys: { x: 239, y: 171, spacingY: 10 },
  labels: {
    ammo: { x: 12, y: 186 },
    health: { x: 88, y: 186 },
    armor: { x: 215, y: 186 },
    frag: { x: 123, y: 186 },
  },
  ammoList: {
    labelX: 265,
    valueX: 315,
    startY: 170,
    spacingY: 10,
  },
};

const numberPrefix = "STTNUM";
const greenNumberPrefix = "STGNUM";
const minusPatchName = "STTMINUS";

export interface HudState {
  ammo: number;
  health: number;
  armor: number;
  keys: Array<string>;
  facePatchName?: string;
  weaponSpriteName?: string;
  telemetry?: HudTelemetry | null;
  ammoCounts?: {
    bullets: number;
    shells: number;
    rockets: number;
    cells: number;
  };
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const percentValue = (value: number) => Math.round(clamp(value) * 100);

const resourceLevel = (resource: ResourceTelemetry) =>
  Math.max(resource.utilization, resource.saturation, resource.errors);

const telemetryFacePatch = (telemetry: HudTelemetry) => {
  const worst = Math.max(
    resourceLevel(telemetry.cpu),
    resourceLevel(telemetry.memory),
    resourceLevel(telemetry.storage),
    resourceLevel(telemetry.network)
  );
  if (telemetry.status === "error" || telemetry.status === "stale" || worst >= 0.86 || telemetry.health <= 0.25) {
    return "STFST02";
  }
  if (worst >= 0.66 || telemetry.health <= 0.45) {
    return "STFST01";
  }
  return "STFST00";
};

const drawCrosshair = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const size = Math.max(6, Math.round(Math.min(width, height) * 0.012));
  const thickness = Math.max(1, Math.round(size / 4));
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(centerX - thickness, centerY - size, thickness * 2, size * 2 + thickness);
  ctx.fillRect(centerX - size, centerY - thickness, size * 2 + thickness, thickness * 2);
};

const getPatch = (
  wad: Wad,
  cache: Record<string, CanvasRenderingContext2D | null>,
  name: string
): CanvasRenderingContext2D | null => {
  if (name in cache) {
    return cache[name];
  }
  const lump = wad.lumpHash[name] ?? wad.sprites[name];
  if (!lump) {
    cache[name] = null;
    return null;
  }
  const patch = drawPatch(lump, wad.playpal);
  cache[name] = patch;
  return patch;
};

const drawPatchAt = (
  context: CanvasRenderingContext2D,
  patch: CanvasRenderingContext2D | null,
  x: number,
  y: number
) => {
  if (!patch) {
    return;
  }
  context.drawImage(patch.canvas, x, y);
};

const drawNumber = (
  context: CanvasRenderingContext2D,
  wad: Wad,
  cache: Record<string, CanvasRenderingContext2D | null>,
  value: number,
  rightX: number,
  y: number,
  prefix = numberPrefix
) => {
  const digitPatch = getPatch(wad, cache, `${prefix}0`);
  if (!digitPatch) {
    return;
  }
  const digitWidth = digitPatch.canvas.width;
  let x = rightX;
  const isNegative = value < 0;
  let num = Math.abs(Math.floor(value));

  if (num === 0) {
    drawPatchAt(context, digitPatch, x - digitWidth, y);
    return;
  }

  while (num > 0) {
    const digit = num % 10;
    const patch = getPatch(wad, cache, `${prefix}${digit}`);
    if (patch) {
      x -= patch.canvas.width;
      drawPatchAt(context, patch, x, y);
    } else {
      x -= digitWidth;
    }
    num = Math.floor(num / 10);
  }

  if (isNegative) {
    const minusPatch = getPatch(wad, cache, minusPatchName);
    if (minusPatch) {
      drawPatchAt(context, minusPatch, x - minusPatch.canvas.width, y);
    }
  }
};

const getRecoloredPatch = (
  cache: Record<string, CanvasRenderingContext2D | null>,
  patch: CanvasRenderingContext2D,
  cacheKey: string,
  color: [number, number, number]
) => {
  if (cacheKey in cache) {
    return cache[cacheKey];
  }
  const canvas = document.createElement("canvas");
  canvas.width = patch.canvas.width;
  canvas.height = patch.canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cache[cacheKey] = null;
    return null;
  }
  ctx.drawImage(patch.canvas, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
  }
  ctx.putImageData(image, 0, 0);
  cache[cacheKey] = ctx;
  return ctx;
};

const drawText = (
  context: CanvasRenderingContext2D,
  wad: Wad,
  cache: Record<string, CanvasRenderingContext2D | null>,
  text: string,
  x: number,
  y: number
) => {
  let cursorX = x;
  for (const char of text) {
    if (char === " ") {
      cursorX += 4;
      continue;
    }
    const code = char.charCodeAt(0);
    const patchName = `STCFN${String(code).padStart(3, "0")}`;
    const patch = getPatch(wad, cache, patchName);
    if (patch) {
      const recolored = getRecoloredPatch(
        cache,
        patch,
        `WHITE_${patchName}`,
        [220, 220, 220]
      );
      drawPatchAt(context, recolored, cursorX, y);
      cursorX += recolored?.canvas.width ?? patch.canvas.width;
    }
  }
};

const drawTopTelemetryStatus = (
  context: CanvasRenderingContext2D,
  wad: Wad,
  cache: Record<string, CanvasRenderingContext2D | null>,
  telemetry: HudTelemetry,
  width: number,
  height: number
) => {
  const scale = Math.max(2, Math.floor(Math.min(width / BASE_WIDTH, height / BASE_HEIGHT)));
  const statusText = telemetry.status === "live" ? "TEL LIVE" : `TEL ${telemetry.status.toUpperCase()}`;
  const hostText = telemetry.host ? telemetry.host.toUpperCase().slice(0, 18) : "";

  context.save();
  context.scale(scale, scale);
  drawText(context, wad, cache, statusText, 4, 5);
  if (hostText) {
    drawText(context, wad, cache, hostText, 4, 15);
  }
  context.restore();
};

export const renderHudOverlay = (wad: Wad, canvas: HTMLCanvasElement) => {
  const statusPatch = wad.lumpHash["STBAR"] ? drawPatch(wad.lumpHash["STBAR"], wad.playpal) : null;
  if (!statusPatch) {
    return null;
  }

  const hudCanvas = document.createElement("canvas");
  hudCanvas.style.position = "absolute";
  hudCanvas.style.left = "0";
  hudCanvas.style.top = "0";
  hudCanvas.style.pointerEvents = "none";
  hudCanvas.style.zIndex = "2";
  hudCanvas.dataset.hudOverlay = "true";

  const parent = canvas.parentElement ?? document.body;
  if (window.getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }
  const existingHud = parent.querySelector<HTMLCanvasElement>("canvas[data-hud-overlay='true']");
  if (existingHud) {
    existingHud.remove();
  }
  parent.appendChild(hudCanvas);

  const hudContext = hudCanvas.getContext("2d");
  if (!hudContext) {
    return;
  }

  const patchCache: Record<string, CanvasRenderingContext2D | null> = {};
  const keyPatchLookup: Record<string, CanvasRenderingContext2D | null> = {
    STKEYS0: getPatch(wad, patchCache, "STKEYS0"),
    STKEYS1: getPatch(wad, patchCache, "STKEYS1"),
    STKEYS2: getPatch(wad, patchCache, "STKEYS2"),
    STKEYS3: getPatch(wad, patchCache, "STKEYS3"),
    STKEYS4: getPatch(wad, patchCache, "STKEYS4"),
    STKEYS5: getPatch(wad, patchCache, "STKEYS5"),
  };

  let state: HudState = {
    ammo: 0,
    health: 100,
    armor: 0,
    keys: [],
    ammoCounts: {
      bullets: 0,
      shells: 0,
      rockets: 0,
      cells: 0,
    },
  };

  const render = () => {
    const { width, height } = canvas.getBoundingClientRect();
    const deviceScale = window.devicePixelRatio || 1;
    hudCanvas.style.width = `${width}px`;
    hudCanvas.style.height = `${height}px`;
    hudCanvas.width = Math.max(1, Math.round(width * deviceScale));
    hudCanvas.height = Math.max(1, Math.round(height * deviceScale));
    hudContext.imageSmoothingEnabled = false;
    hudContext.setTransform(1, 0, 0, 1, 0, 0);
    hudContext.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    drawCrosshair(hudContext, hudCanvas.width, hudCanvas.height);

    const telemetry = state.telemetry ?? null;
    if (telemetry) {
      drawTopTelemetryStatus(hudContext, wad, patchCache, telemetry, hudCanvas.width, hudCanvas.height);
    }

    const scale = hudCanvas.width / BASE_WIDTH;
    const offsetY = hudCanvas.height - BASE_HEIGHT * scale;

    hudContext.save();
    hudContext.translate(0, offsetY);
    hudContext.scale(scale, scale);

    drawPatchAt(hudContext, statusPatch, 0, BASE_HEIGHT - statusPatch.canvas.height);

    const ammoValue = telemetry ? percentValue(telemetry.cpu.utilization) : state.ammo;
    const healthValue = telemetry ? percentValue(telemetry.health) : state.health;
    const armorValue = telemetry ? percentValue(telemetry.memory.utilization) : state.armor;

    drawNumber(hudContext, wad, patchCache, ammoValue, HUD_POSITIONS.ammo.x, HUD_POSITIONS.ammo.y);
    drawNumber(hudContext, wad, patchCache, healthValue, HUD_POSITIONS.health.x, HUD_POSITIONS.health.y);
    drawNumber(hudContext, wad, patchCache, armorValue, HUD_POSITIONS.armor.x, HUD_POSITIONS.armor.y);

    if (telemetry) {
      drawText(hudContext, wad, patchCache, "CPU", HUD_POSITIONS.labels.ammo.x, HUD_POSITIONS.labels.ammo.y);
      drawText(hudContext, wad, patchCache, "SYS", HUD_POSITIONS.labels.health.x, HUD_POSITIONS.labels.health.y);
      drawText(hudContext, wad, patchCache, "MEM", HUD_POSITIONS.labels.armor.x, HUD_POSITIONS.labels.armor.y);
    }

    const facePatchName = telemetry ? telemetryFacePatch(telemetry) : state.facePatchName ?? "STFST00";
    const facePatch = getPatch(wad, patchCache, facePatchName) ?? getPatch(wad, patchCache, "STFST00");
    drawPatchAt(hudContext, facePatch, HUD_POSITIONS.face.x, HUD_POSITIONS.face.y);

    state.keys.forEach((keyName, index) => {
      const patch = keyPatchLookup[keyName];
      drawPatchAt(hudContext, patch, HUD_POSITIONS.keys.x, HUD_POSITIONS.keys.y + HUD_POSITIONS.keys.spacingY * index);
    });

    if (state.weaponSpriteName) {
      const weaponPatch = getPatch(wad, patchCache, state.weaponSpriteName);
      if (weaponPatch) {
        const weaponX = (BASE_WIDTH - weaponPatch.canvas.width) / 2;
        const weaponY = BASE_HEIGHT - statusPatch.canvas.height - weaponPatch.canvas.height + 4;
        drawPatchAt(hudContext, weaponPatch, weaponX, weaponY);
      }
    }

    const ammoCounts = state.ammoCounts;
    if (telemetry || ammoCounts) {
      const ammoLabels = telemetry ? ["CPU", "MEM", "DSK", "NET"] : ["BULL", "SHEL", "RCKT", "CELL"];
      const ammoValues = telemetry
        ? [
            percentValue(resourceLevel(telemetry.cpu)),
            percentValue(resourceLevel(telemetry.memory)),
            percentValue(resourceLevel(telemetry.storage)),
            percentValue(resourceLevel(telemetry.network)),
          ]
        : [ammoCounts!.bullets, ammoCounts!.shells, ammoCounts!.rockets, ammoCounts!.cells];
      ammoLabels.forEach((label, index) => {
        const y = HUD_POSITIONS.ammoList.startY + index * HUD_POSITIONS.ammoList.spacingY;
        drawText(hudContext, wad, patchCache, label, HUD_POSITIONS.ammoList.labelX, y);
        drawNumber(hudContext, wad, patchCache, ammoValues[index], HUD_POSITIONS.ammoList.valueX, y, greenNumberPrefix);
      });
    }

    hudContext.restore();
  };

  render();
  const handleResize = () => render();
  window.addEventListener("resize", handleResize);

  return {
    update(nextState: Partial<HudState>) {
      state = { ...state, ...nextState };
      render();
    },
    destroy() {
      window.removeEventListener("resize", handleResize);
      hudCanvas.remove();
    },
  };
};
