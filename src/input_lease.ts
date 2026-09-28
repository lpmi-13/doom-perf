import {
  KEY_DOWNARROW,
  KEY_LEFTARROW,
  KEY_RIGHTARROW,
  KEY_UPARROW,
} from "./doomdef";

// Browser keyboard events are not an authoritative physical-state source: an
// OS shortcut can consume a matching keyup without blurring or hiding the page.
// The OS auto-repeats only the most recently pressed key, so that key's repeats
// are evidence it is still held; silence from it means its keyup went missing.
// A key shadowed by a later movement press legitimately stops repeating (hold
// forward, tap a turn key) and is never expired for silence.
const INPUT_LEASE_SILENCE_MS = 4_000;

const movementKeys: Record<string, number> = {
  ArrowLeft: KEY_LEFTARROW,
  ArrowRight: KEY_RIGHTARROW,
  ArrowUp: KEY_UPARROW,
  ArrowDown: KEY_DOWNARROW,
};

type Lease = {
  doomKey: number;
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
  // The movement key the OS is expected to be auto-repeating, if any.
  let repeatingCode: string | undefined;
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
    if (repeatingCode === undefined) return;
    const lease = leases.get(repeatingCode);
    if (!lease || lease.expired) return;
    if (performance.now() - lease.lastEvidenceAt >= INPUT_LEASE_SILENCE_MS) {
      expire(lease);
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
        lastEvidenceAt: now,
        expired: false,
        releaseDelivered: false,
      });
      repeatingCode = event.code;
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
        lastEvidenceAt: now,
        expired: false,
        releaseDelivered: false,
      });
      repeatingCode = event.code;
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
    // the current epoch, and mark this key as the one the OS is repeating.
    current.lastEvidenceAt = now;
    repeatingCode = event.code;
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!event.isTrusted || movementKeys[event.code] === undefined) return;
    leases.delete(event.code);
    // Releasing the repeating key does not resume repeats for any key still
    // held underneath it, so nothing is left to time out.
    if (repeatingCode === event.code) repeatingCode = undefined;
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

  const interval = window.setInterval(check, 100);

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
      repeatingCode = undefined;
      setKeyState = undefined;
    },
  };
};
