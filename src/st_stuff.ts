import { SCREENHEIGHT } from "./doomdef";
import { HU_IsAutomapActive } from "./hu_stuff";
import { V_DrawText } from "./v_video";

let statusActive = false;

export const ST_Init = () => {};

export const ST_Start = () => {
  statusActive = true;
};

export const ST_Ticker = () => {};

export const ST_Drawer = () => {
  if (!statusActive) {
    return;
  }
  const stateLabel = HU_IsAutomapActive() ? "AUTO" : "READY";
  V_DrawText(`STATUS ${stateLabel}`, 4, SCREENHEIGHT - 10, "white");
};
