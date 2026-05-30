import { AM_Ticker } from "./am_map";
import { D_ProcessEvents, D_SetResponder, EvType, type Event } from "./d_event";
import { isEngineActive } from "./engine";
import { HU_Ticker } from "./hu_stuff";
import { RS_Ticker } from "./r_simple";
import { ST_Ticker } from "./st_stuff";

let gametic = 0;
const keyState = new Set<number>();
let mouseDeltaX = 0;
let mouseDeltaY = 0;
let mouseButtons = 0;

export const G_Responder = (event: Event) => {
  if (event.type === EvType.ev_keydown) {
    keyState.add(event.data1);
    return true;
  }
  if (event.type === EvType.ev_keyup) {
    keyState.delete(event.data1);
    return true;
  }
  if (event.type === EvType.ev_mouse) {
    mouseButtons = event.data1;
    mouseDeltaX += event.data2 ?? 0;
    mouseDeltaY += event.data3 ?? 0;
    return true;
  }
  return false;
};

export const G_Init = () => {
  D_SetResponder(G_Responder);
};

export const G_Ticker = () => {
  gametic += 1;
  AM_Ticker(keyState);
  if (!isEngineActive()) {
    RS_Ticker(keyState, {
      dx: mouseDeltaX,
      dy: mouseDeltaY,
      buttons: mouseButtons,
    });
  }
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  HU_Ticker(keyState);
  ST_Ticker();
};

export const G_GetTic = () => gametic;

export const G_IsKeyDown = (key: number) => keyState.has(key);

export const G_AdvanceTics = (count: number) => {
  for (let i = 0; i < count; i += 1) {
    D_ProcessEvents();
    G_Ticker();
  }
};
