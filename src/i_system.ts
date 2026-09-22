import {
  KEY_BACKSPACE,
  KEY_DOWNARROW,
  KEY_ENTER,
  KEY_EQUALS,
  KEY_ESCAPE,
  KEY_F1,
  KEY_F10,
  KEY_F11,
  KEY_F12,
  KEY_F2,
  KEY_F3,
  KEY_F4,
  KEY_F5,
  KEY_F6,
  KEY_F7,
  KEY_F8,
  KEY_F9,
  KEY_LEFTARROW,
  KEY_MINUS,
  KEY_PAUSE,
  KEY_RIGHTARROW,
  KEY_RALT,
  KEY_RCTRL,
  KEY_RSHIFT,
  KEY_TAB,
  KEY_UPARROW,
  TICRATE,
} from "./doomdef";
import { D_PostEvent, EvType, type Event } from "./d_event";

const pendingEvents: Event[] = [];
const heldKeys = new Set<number>();
let startTime = 0;
let isInitialized = false;

const functionKeyMap: Record<string, number> = {
  F1: KEY_F1,
  F2: KEY_F2,
  F3: KEY_F3,
  F4: KEY_F4,
  F5: KEY_F5,
  F6: KEY_F6,
  F7: KEY_F7,
  F8: KEY_F8,
  F9: KEY_F9,
  F10: KEY_F10,
  F11: KEY_F11,
  F12: KEY_F12,
};

const specialKeyMap: Record<string, number> = {
  ArrowLeft: KEY_LEFTARROW,
  ArrowRight: KEY_RIGHTARROW,
  ArrowUp: KEY_UPARROW,
  ArrowDown: KEY_DOWNARROW,
  Escape: KEY_ESCAPE,
  Enter: KEY_ENTER,
  Tab: KEY_TAB,
  Backspace: KEY_BACKSPACE,
  Pause: KEY_PAUSE,
  "-": KEY_MINUS,
  "=": KEY_EQUALS,
  Alt: KEY_RALT,
  Control: KEY_RCTRL,
  Shift: KEY_RSHIFT,
};

const toDoomKey = (event: KeyboardEvent): number | null => {
  if (event.key in functionKeyMap) {
    return functionKeyMap[event.key];
  }
  if (event.key in specialKeyMap) {
    return specialKeyMap[event.key];
  }
  if (event.key.length === 1) {
    return event.key.charCodeAt(0);
  }
  return null;
};

const handleKeyEvent = (type: EvType) => (event: KeyboardEvent) => {
  const modifiers: [string, number][] = [
    ["Alt", KEY_RALT],
    ["Control", KEY_RCTRL],
    ["Shift", KEY_RSHIFT],
  ];
  for (const [name, key] of modifiers) {
    if (heldKeys.has(key) && !event.getModifierState(name)) releaseInputKey(key);
  }
  const key = toDoomKey(event);
  if (key === null) {
    return;
  }
  event.preventDefault();
  if (type === EvType.ev_keydown) {
    heldKeys.add(key);
  } else {
    heldKeys.delete(key);
  }
  pendingEvents.push({ type, data1: key });
};

const releaseInputKey = (key: number) => {
  pendingEvents.push({ type: EvType.ev_keyup, data1: key });
  heldKeys.delete(key);
};

const releaseAllInput = () => {
  heldKeys.forEach((key) => pendingEvents.push({ type: EvType.ev_keyup, data1: key }));
  heldKeys.clear();
  pendingEvents.push({ type: EvType.ev_mouse, data1: 0, data2: 0, data3: 0 });
};

const handleMouseEvent = (event: MouseEvent) => {
  const dx = event.movementX ?? 0;
  const dy = event.movementY ?? 0;
  if (dx === 0 && dy === 0 && event.type === "mousemove") {
    return;
  }
  pendingEvents.push({
    type: EvType.ev_mouse,
    data1: event.buttons ?? 0,
    data2: dx,
    data3: dy,
  });
};

export const I_Init = () => {
  if (isInitialized) {
    return;
  }
  isInitialized = true;
  startTime = performance.now();
  window.addEventListener("keydown", handleKeyEvent(EvType.ev_keydown));
  window.addEventListener("keyup", handleKeyEvent(EvType.ev_keyup));
  window.addEventListener("mousemove", handleMouseEvent);
  window.addEventListener("mousedown", handleMouseEvent);
  window.addEventListener("mouseup", handleMouseEvent);
  window.addEventListener("blur", releaseAllInput);
  window.addEventListener("focus", releaseAllInput);
  window.addEventListener("pagehide", releaseAllInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAllInput();
  });
};

export const I_GetTime = () => {
  const elapsed = performance.now() - startTime;
  return Math.floor((elapsed * TICRATE) / 1000);
};

export const I_StartTic = () => {
  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();
    if (event) {
      D_PostEvent(event);
    }
  }
};

// Apply a movement-key lease transition directly. Down is idempotent; up is
// always posted so the fallback's authoritative state is repaired even if its
// browser-facing tracker has drifted.
export const I_SetInputKeyState = (key: number, pressed: boolean) => {
  if (pressed) {
    if (heldKeys.has(key)) return;
    heldKeys.add(key);
    pendingEvents.push({ type: EvType.ev_keydown, data1: key });
    return;
  }
  releaseInputKey(key);
};
