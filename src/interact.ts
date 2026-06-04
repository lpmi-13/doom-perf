// A contextual "interact" affordance shown when the player is standing close
// enough to a wall terminal or a hub door. It doubles as the mobile control
// surface (there is no keyboard to press [space] on a phone) and as a desktop
// discoverability hint so players learn that doors and terminals are usable.
export type InteractKind = "terminal" | "door";

const promptLabel: Record<InteractKind, string> = {
  terminal: "Read Terminal",
  door: "Open Door",
};

export const createInteractPrompt = (onActivate: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "doomInteract";
  button.style.display = "none";
  button.innerHTML = `<span class="doomInteract__label"></span><span class="doomInteract__key">SPACE</span>`;

  const style = document.createElement("style");
  style.textContent = `
    .doomInteract {
      position: fixed;
      left: 50%;
      bottom: max(4vh, env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      z-index: 9;
      display: flex;
      align-items: center;
      gap: 0.6em;
      padding: 0.55em 0.9em;
      border: 3px solid #2f7a2f;
      border-radius: 6px;
      background: rgba(2, 10, 2, 0.9);
      color: #b6ffcb;
      font: 18px/1 "DejaVu Sans Mono", "Courier New", monospace;
      letter-spacing: 1px;
      text-transform: uppercase;
      box-shadow: 0 0 0 3px #000, 0 0 24px rgba(40, 255, 120, 0.35);
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .doomInteract:active {
      background: rgba(40, 255, 120, 0.18);
    }
    .doomInteract__key {
      padding: 0.25em 0.5em;
      border: 1px solid #2f7a2f;
      border-radius: 4px;
      background: #103a10;
      color: #51e07a;
      font-size: 0.78em;
    }
    @media (pointer: coarse) {
      /* Two-thumb layout: the movement pad sits bottom-left, so the interact
         button moves to the bottom-right. A smaller font gives it some breathing
         room from the pad, and it is vertically centred on the pad's mid-line
         (pad geometry comes from the CSS vars movementPad.ts publishes) so the
         two controls share a y-axis. translateY(50%) drops the button's own
         centre onto that line regardless of its height. */
      .doomInteract {
        font-size: 18px;
        padding: 0.7em 1.1em;
        left: auto;
        right: max(4vw, env(safe-area-inset-right, 0px));
        bottom: calc(
          var(--doom-pad-bottom, max(4vh, env(safe-area-inset-bottom, 0px))) +
          var(--doom-pad-size, min(38vw, 168px)) / 2
        );
        transform: translateY(50%);
      }
      /* Touch devices have no SPACE key; the button itself is the control. */
      .doomInteract__key { display: none; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(button);

  const label = button.querySelector(".doomInteract__label") as HTMLElement;

  // Use pointerup so a tap fires reliably on touch, and stop the event from
  // reaching the canvas/engine so it is not also interpreted as a look-swipe.
  const activate = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  };
  button.addEventListener("pointerup", activate);

  let shownKind: InteractKind | null = null;

  return {
    show(kind: InteractKind) {
      if (shownKind !== kind) {
        shownKind = kind;
        label.textContent = promptLabel[kind];
      }
      if (button.style.display !== "flex") {
        button.style.display = "flex";
      }
    },
    hide() {
      if (shownKind !== null) {
        shownKind = null;
        button.style.display = "none";
      }
    },
  };
};
