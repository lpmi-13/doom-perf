import { AM_Drawer, AM_Init } from "./am_map";
import { G_AdvanceTics, G_Init } from "./g_game";
import { isEngineActive } from "./engine";
import { HU_Drawer, HU_GetMapName, HU_Init, HU_IsAutomapActive, HU_Start } from "./hu_stuff";
import { I_GetTime, I_Init, I_StartTic } from "./i_system";
import { RS_Drawer, RS_Init } from "./r_simple";
import { loadWad, validateCoreLumps } from "./w_wad";
import { R_Init } from "./r_main";
import { ST_Drawer, ST_Init, ST_Start } from "./st_stuff";
import { V_ClearScreen, V_DrawScreen } from "./v_video";
import { S_Init } from "./s_sound";
import { S_LoadSoundRegistry } from "./s_sound_registry";

let oldTime = 0;

const D_DoomLoop = () => {
  oldTime = I_GetTime();
  const loop = () => {
    I_StartTic();
    const nowTime = I_GetTime();
    const ticCount = nowTime - oldTime;
    if (ticCount > 0) {
      G_AdvanceTics(ticCount);
      oldTime = nowTime;
    }
    V_ClearScreen();
    if (HU_IsAutomapActive()) {
      AM_Drawer(true);
    } else if (!isEngineActive()) {
      RS_Drawer();
    }
    V_DrawScreen();
    HU_Drawer();
    ST_Drawer();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

export const D_DoomMain = async (
  wadUrl = "/wads/Doom1.WAD",
  canvas?: HTMLCanvasElement,
) => {
  const wad = await loadWad(wadUrl);
  const missing = validateCoreLumps(wad);

  if (missing.length > 0) {
    throw new Error(`WAD missing core lumps: ${missing.join(", ")}`);
  }

  console.log(`Loaded ${wad.header.identification} with ${wad.header.numLumps} lumps.`);

  if (!canvas) {
    throw new Error("Missing renderer canvas.");
  }
  canvas.addEventListener("click", () => {
    canvas.requestPointerLock?.();
  });
  R_Init(wad, canvas);
  I_Init();
  S_Init(15, 15);
  S_LoadSoundRegistry(wad);
  HU_Init(wad);
  AM_Init(wad, HU_GetMapName());
  if (!isEngineActive()) {
    RS_Init(wad, HU_GetMapName());
  }
  ST_Init();
  G_Init();
  HU_Start();
  ST_Start();
  console.log(`Starting map ${HU_GetMapName()}.`);
  D_DoomLoop();
};
