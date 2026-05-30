import type { WadFile } from "./w_wad";
import { R_GetColormap, R_InitColormaps, R_LoadPalette } from "./r_data";
import { V_Init, V_SetColormap, V_SetPalette } from "./v_video";

export const R_Init = (wad: WadFile, canvas: HTMLCanvasElement) => {
  V_Init(canvas);
  const palette = R_LoadPalette(wad);
  V_SetPalette(palette);
  R_InitColormaps(wad);
  V_SetColormap(R_GetColormap(0));
};
