import type { SfxInfo } from "./i_sound";
import { S_RegisterSfx, S_StartSoundAtVolume } from "./s_sound";

const ASSET_SOUND_BASE_ID = 10000;
const MAX_VOLUME = 15;

export type AssetSound = {
  name: string;
  url: string;
  volume?: number;
};

const registeredSounds = new Map<string, SfxInfo>();
const pendingLoads = new Map<string, Promise<SfxInfo>>();
const warnedFailures = new Set<string>();

const normalizeName = (name: string) => name.trim().toUpperCase();
const clampVolume = (volume: number | undefined) =>
  Math.max(0, Math.min(MAX_VOLUME, volume ?? MAX_VOLUME));

const warnLoadFailure = (sound: AssetSound, error: unknown) => {
  const key = normalizeName(sound.name);
  if (warnedFailures.has(key)) {
    return;
  }
  warnedFailures.add(key);
  console.warn(`[AssetSound] Failed to load ${sound.url}`, error);
};

export const loadAssetSound = (sound: AssetSound): Promise<SfxInfo> => {
  const key = normalizeName(sound.name);
  const registered = registeredSounds.get(key);
  if (registered) {
    return Promise.resolve(registered);
  }

  const pending = pendingLoads.get(key);
  if (pending) {
    return pending;
  }

  const load = fetch(sound.url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.arrayBuffer();
    })
    .then((data) => {
      const info: SfxInfo = {
        id: ASSET_SOUND_BASE_ID + registeredSounds.size,
        name: key,
        data,
      };
      registeredSounds.set(key, info);
      S_RegisterSfx(info);
      return info;
    })
    .finally(() => {
      pendingLoads.delete(key);
    });

  pendingLoads.set(key, load);
  return load;
};

export const preloadAssetSound = (sound: AssetSound) => {
  void loadAssetSound(sound).catch((error) => warnLoadFailure(sound, error));
};

export const playAssetSound = (sound: AssetSound) => {
  const key = normalizeName(sound.name);
  const registered = registeredSounds.get(key);
  if (registered) {
    S_StartSoundAtVolume(undefined, registered.id, clampVolume(sound.volume));
    return;
  }

  void loadAssetSound(sound)
    .then((loaded) => {
      S_StartSoundAtVolume(undefined, loaded.id, clampVolume(sound.volume));
    })
    .catch((error) => warnLoadFailure(sound, error));
};
