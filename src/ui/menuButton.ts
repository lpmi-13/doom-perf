// A small, always-visible "menu" icon for touch devices, pinned to the top-right
// of the screen. Tapping it opens the in-game Doom menu (data-source / options) —
// a far more discoverable affordance than the prior hold-to-open long-press,
// which left no hint that the menu existed at all. Shown only during active
// gameplay (the same times as the movement pad); the menu's own BACK button
// closes it again. Like the other touch controls it is created unconditionally
// but only ever shown on touch devices (updatePrompt gates show/hide).

export const createMenuButton = (onActivate: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "doomMenuBtn";
  button.setAttribute("aria-label", "Open menu");
  // Three bars (the universal "menu" glyph) drawn from the element + its two
  // pseudo-elements so the icon needs no font or image asset.
  button.innerHTML = `<span class="doomMenuBtn__bars" aria-hidden="true"></span>`;
  button.style.display = "none";

  const style = document.createElement("style");
  style.textContent = `
    .doomMenuBtn {
      position: fixed;
      top: max(12px, env(safe-area-inset-top, 0px));
      right: max(12px, env(safe-area-inset-right, 0px));
      z-index: 9;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      padding: 0;
      border: 2px solid #2f7a2f;
      border-radius: 6px;
      background: rgba(2, 10, 2, 0.9);
      box-shadow: 0 0 0 2px #000, 0 0 18px rgba(40, 255, 120, 0.25);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
      cursor: pointer;
    }
    .doomMenuBtn:active { background: rgba(40, 255, 120, 0.18); }
    .doomMenuBtn__bars,
    .doomMenuBtn__bars::before,
    .doomMenuBtn__bars::after {
      display: block;
      width: 24px;
      height: 3px;
      border-radius: 2px;
      background: #b6ffcb;
      box-shadow: 0 0 6px rgba(40, 255, 120, 0.5);
    }
    .doomMenuBtn__bars { position: relative; }
    .doomMenuBtn__bars::before,
    .doomMenuBtn__bars::after {
      content: "";
      position: absolute;
      left: 0;
    }
    .doomMenuBtn__bars::before { top: -8px; }
    .doomMenuBtn__bars::after { top: 8px; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(button);

  // pointerup so a tap fires reliably on touch; stop it reaching the canvas so it
  // is not also read as a look-swipe by the engine's SDL layer.
  button.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  });

  let visible = false;
  return {
    show() {
      if (visible) return;
      visible = true;
      button.style.display = "flex";
    },
    hide() {
      if (!visible) return;
      visible = false;
      button.style.display = "none";
    },
  };
};
