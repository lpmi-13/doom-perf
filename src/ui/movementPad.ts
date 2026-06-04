// On-screen 8-way movement pad for touch devices. A phone has no keyboard, and
// we disable the engine's drag-to-look on touch (see src/index.ts), so this pad
// is the sole way to move. A single round touch surface reads the thumb's
// position relative to centre and holds the matching Doom arrow keys
// (up/down = forward/back, left/right = turn) down. It drives the engine the
// same way the USE/space button does: the prebuilt WASM engine reads keys from
// a document-level listener, so synthetic KeyboardEvents dispatched on
// `document` reach it (mirrors dispatchSpace() in src/index.ts).

type ArrowCode = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

// KeyboardEvent's constructor ignores keyCode/which, but SDL's emscripten keymap
// reads them alongside `code`, so we force the legacy arrow codes too.
const ARROW_KEYCODE: Record<ArrowCode, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

const dispatchArrow = (type: "keydown" | "keyup", code: ArrowCode) => {
  const event = new KeyboardEvent(type, { key: code, code, bubbles: true, cancelable: true });
  const keyCode = ARROW_KEYCODE[code];
  Object.defineProperty(event, "keyCode", { get: () => keyCode });
  Object.defineProperty(event, "which", { get: () => keyCode });
  document.dispatchEvent(event);
};

// Below this fraction of the pad radius the thumb is "centred" -> no movement.
const DEAD_ZONE = 0.28;

// Map a thumb offset (dx right, dy down) to the set of arrow keys for its 45°
// sector. Returns an empty set inside the dead zone. Sector 0 = up, increasing
// clockwise; diagonals (odd sectors) hold two keys so you can move while turning.
const keysForOffset = (dx: number, dy: number, radius: number): Set<ArrowCode> => {
  const keys = new Set<ArrowCode>();
  if (Math.hypot(dx, dy) <= radius * DEAD_ZONE) {
    return keys;
  }
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up, +90 = right
  const sector = ((Math.round(angle / 45) % 8) + 8) % 8;
  if (sector === 7 || sector === 0 || sector === 1) keys.add("ArrowUp");
  if (sector === 1 || sector === 2 || sector === 3) keys.add("ArrowRight");
  if (sector === 3 || sector === 4 || sector === 5) keys.add("ArrowDown");
  if (sector === 5 || sector === 6 || sector === 7) keys.add("ArrowLeft");
  return keys;
};

export const createMovementPad = () => {
  const pad = document.createElement("div");
  pad.className = "doomPad";
  pad.style.display = "none";
  pad.innerHTML =
    `<span class="doomPad__dir doomPad__dir--up">▲</span>` +
    `<span class="doomPad__dir doomPad__dir--right">▶</span>` +
    `<span class="doomPad__dir doomPad__dir--down">▼</span>` +
    `<span class="doomPad__dir doomPad__dir--left">◀</span>` +
    `<div class="doomPad__ring"></div><div class="doomPad__nub"></div>`;

  const style = document.createElement("style");
  style.textContent = `
    :root {
      /* Published so interact.ts can vertically centre its button on the pad. */
      --doom-pad-bottom: max(4vh, env(safe-area-inset-bottom, 0px));
      --doom-pad-size: min(38vw, 168px);
    }
    .doomPad {
      position: fixed;
      box-sizing: border-box;
      left: max(4vw, env(safe-area-inset-left, 0px));
      bottom: var(--doom-pad-bottom);
      z-index: 9;
      width: var(--doom-pad-size);
      height: var(--doom-pad-size);
      border-radius: 50%;
      border: 3px solid #2f7a2f;
      background: radial-gradient(circle at center, rgba(40, 255, 120, 0.08), rgba(2, 10, 2, 0.82));
      box-shadow: 0 0 0 3px #000, 0 0 24px rgba(40, 255, 120, 0.3);
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
    }
    .doomPad__ring {
      position: absolute;
      inset: 16%;
      border-radius: 50%;
      border: 1px dashed rgba(81, 224, 122, 0.35);
      pointer-events: none;
    }
    .doomPad__nub {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 34%;
      height: 34%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: rgba(40, 255, 120, 0.22);
      border: 2px solid #51e07a;
      box-shadow: 0 0 12px rgba(40, 255, 120, 0.45);
      pointer-events: none;
    }
    .doomPad__dir {
      position: absolute;
      color: rgba(81, 224, 122, 0.55);
      font: 13px/1 "DejaVu Sans Mono", monospace;
      pointer-events: none;
    }
    .doomPad__dir--up { top: 6%; left: 50%; transform: translateX(-50%); }
    .doomPad__dir--down { bottom: 6%; left: 50%; transform: translateX(-50%); }
    .doomPad__dir--left { left: 7%; top: 50%; transform: translateY(-50%); }
    .doomPad__dir--right { right: 7%; top: 50%; transform: translateY(-50%); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(pad);

  const nub = pad.querySelector(".doomPad__nub") as HTMLElement;
  const held = new Set<ArrowCode>();
  let activePointer: number | null = null;

  const releaseAll = () => {
    held.forEach((code) => dispatchArrow("keyup", code));
    held.clear();
    nub.style.transform = "translate(-50%, -50%)";
  };

  // Diff the held keys against `next`, dispatching only the changes so a key is
  // not re-pressed every pointermove.
  const applyKeys = (next: Set<ArrowCode>) => {
    held.forEach((code) => {
      if (!next.has(code)) dispatchArrow("keyup", code);
    });
    next.forEach((code) => {
      if (!held.has(code)) dispatchArrow("keydown", code);
    });
    held.clear();
    next.forEach((code) => held.add(code));
  };

  const update = (clientX: number, clientY: number) => {
    const rect = pad.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = clientX - (rect.left + radius);
    const dy = clientY - (rect.top + radius);
    applyKeys(keysForOffset(dx, dy, radius));
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, radius);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;
    nub.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  };

  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activePointer = event.pointerId;
    pad.setPointerCapture(event.pointerId);
    update(event.clientX, event.clientY);
  });
  pad.addEventListener("pointermove", (event) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    update(event.clientX, event.clientY);
  });
  const endPointer = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    releaseAll();
  };
  pad.addEventListener("pointerup", endPointer);
  pad.addEventListener("pointercancel", endPointer);
  pad.addEventListener("lostpointercapture", () => {
    activePointer = null;
    releaseAll();
  });

  // Belt-and-braces against stuck keys when focus or the tab is lost mid-press.
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });

  let visible = false;
  return {
    show() {
      if (visible) return;
      visible = true;
      pad.style.display = "block";
    },
    hide() {
      if (!visible) return;
      visible = false;
      releaseAll();
      pad.style.display = "none";
    },
  };
};
