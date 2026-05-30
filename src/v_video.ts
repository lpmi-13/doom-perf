import { SCREENHEIGHT, SCREENWIDTH } from "./doomdef";

const NUM_SCREENS = 5;
const PALETTE_SIZE = 256 * 3;

const screens = Array.from(
  { length: NUM_SCREENS },
  () => new Uint8Array(SCREENWIDTH * SCREENHEIGHT),
);

let context: CanvasRenderingContext2D | null = null;
let imageData: ImageData | null = null;
let palette = new Uint8Array(PALETTE_SIZE);
let colormap: Uint8Array | null = null;

export const V_Init = (canvas: HTMLCanvasElement) => {
  canvas.width = SCREENWIDTH;
  canvas.height = SCREENHEIGHT;
  const nextContext = canvas.getContext("2d");
  if (!nextContext) {
    throw new Error("Canvas 2D context unavailable.");
  }
  context = nextContext;
  imageData = nextContext.createImageData(SCREENWIDTH, SCREENHEIGHT);
};

export const V_GetScreen = (index = 0): Uint8Array => {
  return screens[index];
};

export const V_ClearScreen = (index = 0, color = 0) => {
  screens[index].fill(color);
};

export const V_SetPalette = (nextPalette: Uint8Array) => {
  if (nextPalette.length < PALETTE_SIZE) {
    throw new Error("Palette data is too small.");
  }
  palette = nextPalette.subarray(0, PALETTE_SIZE);
};

export const V_SetColormap = (nextColormap: Uint8Array | null) => {
  colormap = nextColormap;
};

export const V_DrawText = (
  text: string,
  x: number,
  y: number,
  color = "white",
  font = "8px monospace",
) => {
  if (!context) {
    return;
  }
  context.save();
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = "top";
  context.fillText(text, x, y);
  context.restore();
};

export const V_DrawColumn = (
  x: number,
  yStart: number,
  yEnd: number,
  color: number,
  screen = 0,
) => {
  if (x < 0 || x >= SCREENWIDTH) {
    return;
  }
  const buffer = screens[screen];
  const start = Math.max(0, Math.min(SCREENHEIGHT - 1, yStart));
  const end = Math.max(0, Math.min(SCREENHEIGHT - 1, yEnd));
  if (end < start) {
    return;
  }
  for (let y = start; y <= end; y += 1) {
    buffer[y * SCREENWIDTH + x] = color;
  }
};

export const V_DrawHorizontal = (
  y: number,
  xStart: number,
  xEnd: number,
  color: number,
  screen = 0,
) => {
  if (y < 0 || y >= SCREENHEIGHT) {
    return;
  }
  const buffer = screens[screen];
  const start = Math.max(0, Math.min(SCREENWIDTH - 1, xStart));
  const end = Math.max(0, Math.min(SCREENWIDTH - 1, xEnd));
  if (end < start) {
    return;
  }
  const rowOffset = y * SCREENWIDTH;
  for (let x = start; x <= end; x += 1) {
    buffer[rowOffset + x] = color;
  }
};

export const V_DrawLine = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color = 176,
  screen = 0,
) => {
  const buffer = screens[screen];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    if (x0 >= 0 && x0 < SCREENWIDTH && y0 >= 0 && y0 < SCREENHEIGHT) {
      buffer[y0 * SCREENWIDTH + x0] = color;
    }
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
};

export const V_DrawScreen = (source = 0) => {
  if (!context || !imageData) {
    return;
  }
  const src = screens[source];
  const data = imageData.data;
  const activeColormap = colormap;
  for (let i = 0; i < src.length; i += 1) {
    const mapped = activeColormap ? activeColormap[src[i]] : src[i];
    const paletteOffset = mapped * 3;
    const destOffset = i * 4;
    data[destOffset] = palette[paletteOffset];
    data[destOffset + 1] = palette[paletteOffset + 1];
    data[destOffset + 2] = palette[paletteOffset + 2];
    data[destOffset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
};
