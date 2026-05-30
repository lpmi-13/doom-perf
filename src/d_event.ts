export enum EvType {
  ev_keydown,
  ev_keyup,
  ev_mouse,
  ev_joystick,
}

export type Event = {
  type: EvType;
  data1: number;
  data2?: number;
  data3?: number;
};

const MAXEVENTS = 64;
const eventQueue: Event[] = [];
let responder: ((event: Event) => boolean) | null = null;

export const D_SetResponder = (next: ((event: Event) => boolean) | null) => {
  responder = next;
};

export const D_PostEvent = (event: Event) => {
  if (eventQueue.length >= MAXEVENTS) {
    eventQueue.shift();
  }
  eventQueue.push(event);
};

export const D_ClearEvents = () => {
  eventQueue.length = 0;
};

export const D_ProcessEvents = () => {
  while (eventQueue.length > 0) {
    const event = eventQueue.shift();
    if (!event) {
      continue;
    }
    responder?.(event);
  }
};
