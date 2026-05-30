import type { WadFile } from "./w_wad";

export const NUMCOLORMAPS = 32;
const PALETTE_SIZE = 256 * 3;

let colormaps: Uint8Array | null = null;

const getLumpData = (wad: WadFile, name: string): Uint8Array => {
  const index = wad.getLumpIndex(name);
  if (index === -1) {
    throw new Error(`Missing lump ${name}.`);
  }
  const lump = wad.lumps[index];
  return new Uint8Array(wad.buffer, lump.offset, lump.size);
};

export const R_InitColormaps = (wad: WadFile): Uint8Array => {
  colormaps = getLumpData(wad, "COLORMAP");
  return colormaps;
};

export const R_GetColormap = (index = 0): Uint8Array => {
  if (!colormaps) {
    throw new Error("Colormaps not initialized.");
  }
  const offset = index * 256;
  return colormaps.subarray(offset, offset + 256);
};

export const R_LoadPalette = (wad: WadFile, paletteIndex = 0): Uint8Array => {
  const data = getLumpData(wad, "PLAYPAL");
  const offset = paletteIndex * PALETTE_SIZE;
  if (offset + PALETTE_SIZE > data.length) {
    throw new Error("Palette index out of range.");
  }
  return data.subarray(offset, offset + PALETTE_SIZE);
};
