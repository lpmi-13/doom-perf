import {
  I_InitMusic,
  I_InitSound,
  I_RegisterSfx,
  I_SetMusicVolume,
  I_SetSfxVolume,
  I_StartSound,
} from "./i_sound";
import type { SfxInfo } from "./i_sound";

const MAX_VOLUME = 15;
const DEFAULT_SEP = 128;
const DEFAULT_PITCH = 128;
const DEFAULT_PRIORITY = 64;

let sfxVolume = MAX_VOLUME;
let musicVolume = MAX_VOLUME;

const channelMap = new Map<unknown, number>();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const S_RegisterSfx = (sfx: SfxInfo) => {
  I_RegisterSfx(sfx);
};

export const S_Init = (initialSfxVolume: number, initialMusicVolume: number) => {
  I_InitSound();
  I_InitMusic();
  S_SetSfxVolume(initialSfxVolume);
  S_SetMusicVolume(initialMusicVolume);
};

export const S_StartSoundAtVolume = (
  origin: unknown,
  soundId: number,
  volume: number,
) => {
  const scaledVolume = clamp(Math.round((volume / MAX_VOLUME) * 127), 0, 127);
  const handle = I_StartSound(
    soundId,
    scaledVolume,
    DEFAULT_SEP,
    DEFAULT_PITCH,
    DEFAULT_PRIORITY,
  );
  if (handle >= 0 && origin) {
    channelMap.set(origin, handle);
  }
};

export const S_SetMusicVolume = (volume: number) => {
  musicVolume = clamp(volume, 0, MAX_VOLUME);
  I_SetMusicVolume(musicVolume);
};

export const S_SetSfxVolume = (volume: number) => {
  sfxVolume = clamp(volume, 0, MAX_VOLUME);
  I_SetSfxVolume(sfxVolume);
};
