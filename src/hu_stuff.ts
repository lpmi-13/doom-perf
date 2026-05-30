import { KEY_TAB } from "./doomdef";
import type { WadFile } from "./w_wad";
import { V_DrawText } from "./v_video";

let headsUpActive = false;
let automapActive = false;
let wasTabDown = false;
let mapName = "UNKNOWN";

const findStartMap = (wad: WadFile): string => {
  const names = wad.lumps.map((lump) => lump.name.trim().toUpperCase());
  if (names.includes("E1M1")) {
    return "E1M1";
  }
  if (names.includes("MAP01")) {
    return "MAP01";
  }
  const episodeMap = names.find((name) => /^E\dM\d$/.test(name));
  if (episodeMap) {
    return episodeMap;
  }
  const doom2Map = names.find((name) => /^MAP\d\d$/.test(name));
  return doom2Map ?? "UNKNOWN";
};

export const HU_Init = (wad: WadFile) => {
  mapName = findStartMap(wad);
};

export const HU_Start = () => {
  headsUpActive = true;
  automapActive = false;
};

export const HU_Ticker = (keyState: Set<number>) => {
  const tabDown = keyState.has(KEY_TAB);
  if (tabDown && !wasTabDown) {
    automapActive = !automapActive;
  }
  wasTabDown = tabDown;
};

export const HU_Drawer = () => {
  if (!headsUpActive) {
    return;
  }
  V_DrawText(`MAP ${mapName}`, 4, 4, "white");
  if (automapActive) {
    V_DrawText("AUTOMAP", 4, 14, "yellow");
  }
};

export const HU_IsAutomapActive = () => automapActive;

export const HU_GetMapName = () => mapName;
