import {
  KEY_DOWNARROW,
  KEY_LEFTARROW,
  KEY_RIGHTARROW,
  KEY_UPARROW,
} from "./doomdef";

// Browser keyboard events are not an authoritative physical-state source: an
// OS shortcut can consume a matching keyup without blurring or hiding the page.
// Bound every physical movement-key epoch so that this ambiguity can interrupt
// a legitimate unusually long hold, but can never leave Doom moving forever.
const INPUT_LEASE_SILENCE_MS = 4_000;
const INPUT_LEASE_MAX_HOLD_MS = 60_000;

const movementKeys: Record<string, number> = {
  ArrowLeft: KEY_LEFTARROW,
  ArrowRight: KEY_RIGHTARROW,
  ArrowUp: KEY_UPARROW,
  ArrowDown: KEY_DOWNARROW,
};

type Lease = {
  doomKey: number;
  pressedAt: number;
  lastEvidenceAt: number;
  expired: boolean;
  releaseDelivered: boolean;
};

export type InputLeaseController = {
  connect: (setKeyState: (doomKey: number, pressed: boolean) => void) => void;
  close: () => void;
};

export const installInputLease = (): InputLeaseController => {
  const leases = new Map<string, Lease>();
  let setKeyState: ((doomKey: number, pressed: boolean) => void) | undefined;
  let closed = false;

  const deliverRelease = (lease: Lease) => {
    if (lease.releaseDelivered || !setKeyState) return;
    lease.releaseDelivered = true;
    setKeyState(lease.doomKey, false);
  };

  const expire = (lease: Lease) => {
    if (lease.expired) return;
    lease.expired = true;
    deliverRelease(lease);
  };

  const check = () => {
    const now = performance.now();
    for (const lease of leases.values()) {
      if (lease.expired) continue;
      if (
        now - lease.pressedAt >= INPUT_LEASE_MAX_HOLD_MS ||
        now - lease.lastEvidenceAt >= INPUT_LEASE_SILENCE_MS
      ) {
        expire(lease);
      }
    }
  };

  const suppress = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.isTrusted) return;
    const doomKey = movementKeys[event.code];
    if (doomKey === undefined) return;

    const now = performance.now();
    const current = leases.get(event.code);
    if (!current) {
      // A repeat without an observed initial down belongs to an input epoch
      // invalidated by startup/lifecycle cleanup. It must not relatch Doom.
      if (event.repeat) {
        suppress(event);
        return;
      }
      leases.set(event.code, {
        doomKey,
        pressedAt: now,
        lastEvidenceAt: now,
        expired: false,
        releaseDelivered: false,
      });
      return;
    }

    if (current.expired) {
      // Repeats from an expired epoch are quarantined. A non-repeat keydown is
      // a new physical press and starts a fresh bounded epoch even when the old
      // keyup was the event that went missing.
      if (event.repeat) {
        suppress(event);
        return;
      }
      leases.set(event.code, {
        doomKey,
        pressedAt: now,
        lastEvidenceAt: now,
        expired: false,
        releaseDelivered: false,
      });
      // SDL can continue to label this as a repeat because its browser-side
      // keyboard state never saw the old keyup. Start the fresh epoch through
      // the idempotent engine API and keep the stale SDL state out of the path.
      if (setKeyState) {
        setKeyState(doomKey, true);
        suppress(event);
      }
      return;
    }

    // Both a flagged repeat and a duplicate down provide recent evidence for
    // the current epoch. The absolute cap remains anchored to pressedAt.
    current.lastEvidenceAt = now;
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!event.isTrusted || movementKeys[event.code] === undefined) return;
    leases.delete(event.code);
  };

  const expireForLifecycle = () => {
    for (const lease of leases.values()) expire(lease);
  };
  const expireWhenHidden = () => {
    if (document.hidden) expireForLifecycle();
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp, { capture: true });
  window.addEventListener("blur", expireForLifecycle);
  window.addEventListener("pagehide", expireForLifecycle);
  document.addEventListener("visibilitychange", expireWhenHidden);

  const checkEveryMs = Math.max(
    16,
    Math.min(100, INPUT_LEASE_SILENCE_MS / 4, INPUT_LEASE_MAX_HOLD_MS / 4),
  );
  const interval = window.setInterval(check, checkEveryMs);

  return {
    connect(nextSetKeyState) {
      setKeyState = nextSetKeyState;
      for (const lease of leases.values()) {
        if (lease.expired) deliverRelease(lease);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      window.clearInterval(interval);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", expireForLifecycle);
      window.removeEventListener("pagehide", expireForLifecycle);
      document.removeEventListener("visibilitychange", expireWhenHidden);
      leases.clear();
      setKeyState = undefined;
    },
  };
};
