// On-screen menu controls for touch devices. A phone has no keyboard, so the
// title/menu screens (data-source select, options) need a way to navigate:
// ▲/▼ move the selection, SELECT confirms (Enter), BACK steps out / toggles the
// menu (Escape — also a fallback to open it if the auto-open is ever missed).
// Shown only while no level is active; the movement pad takes over in-game.
// Like the pad, it drives the WASM engine with synthetic KeyboardEvents on
// `document` (the engine reads keys from a document-level listener).

type MenuAction = "up" | "down" | "select" | "back";

const KEYS: Record<MenuAction, { code: string; keyCode: number }> = {
  up: { code: "ArrowUp", keyCode: 38 },
  down: { code: "ArrowDown", keyCode: 40 },
  select: { code: "Enter", keyCode: 13 },
  back: { code: "Escape", keyCode: 27 },
};

const dispatchKey = (type: "keydown" | "keyup", action: MenuAction) => {
  const { code, keyCode } = KEYS[action];
  const event = new KeyboardEvent(type, { key: code, code, bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { get: () => keyCode });
  Object.defineProperty(event, "which", { get: () => keyCode });
  document.dispatchEvent(event);
};

// Doom menus act on keydown; release shortly after so the key isn't left stuck.
const tapKey = (action: MenuAction) => {
  dispatchKey("keydown", action);
  window.setTimeout(() => dispatchKey("keyup", action), 90);
};

const BUTTONS: { action: MenuAction; label: string; primary?: boolean }[] = [
  { action: "up", label: "▲" },
  { action: "down", label: "▼" },
  { action: "select", label: "SELECT", primary: true },
  { action: "back", label: "BACK" },
];

export const createMenuControls = () => {
  const bar = document.createElement("div");
  bar.className = "doomMenu";
  bar.style.display = "none";

  const style = document.createElement("style");
  style.textContent = `
    .doomMenu {
      position: fixed;
      left: 50%;
      bottom: max(4vh, env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      z-index: 9;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .doomMenu__btn {
      min-width: 56px;
      min-height: 52px;
      padding: 0 14px;
      border: 2px solid #2f7a2f;
      border-radius: 6px;
      background: rgba(2, 10, 2, 0.9);
      color: #b6ffcb;
      font: 20px/1 "DejaVu Sans Mono", "Courier New", monospace;
      letter-spacing: 1px;
      text-transform: uppercase;
      box-shadow: 0 0 0 2px #000, 0 0 18px rgba(40, 255, 120, 0.25);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
    }
    .doomMenu__btn:active { background: rgba(40, 255, 120, 0.18); }
    .doomMenu__btn--select {
      background: #103a10;
      color: #51e07a;
      border-color: #51e07a;
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);

  for (const { action, label, primary } of BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "doomMenu__btn doomMenu__btn--select" : "doomMenu__btn";
    button.textContent = label;
    // pointerdown for a snappy press; stop it reaching the canvas/engine so it is
    // not also read as a look-swipe.
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      tapKey(action);
    });
    bar.appendChild(button);
  }
  document.body.appendChild(bar);

  let visible = false;
  return {
    show() {
      if (visible) return;
      visible = true;
      bar.style.display = "flex";
    },
    hide() {
      if (!visible) return;
      visible = false;
      bar.style.display = "none";
    },
  };
};
