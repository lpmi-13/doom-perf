type EngineGlobals = typeof globalThis & {
  DoomEngine?: unknown;
  __doom_engine_active__?: boolean;
};

export const isEngineActive = (): boolean => {
  const globals = globalThis as EngineGlobals;
  return Boolean(globals.__doom_engine_active__ || globals.DoomEngine);
};
