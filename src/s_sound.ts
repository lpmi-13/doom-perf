import {
  I_InitMusic,
  I_InitSound,
  I_PlaySong,
  I_PauseSong,
  I_RegisterSong,
  I_RegisterSfx,
  I_ResumeSong,
  I_SetMusicVolume,
  I_SetSfxVolume,
  I_SoundIsPlaying,
  I_StartSound,
  I_StopSound,
  I_StopSong,
  I_SubmitSound,
  I_UnRegisterSong,
  I_UpdateSound,
} from "./i_sound";
import type { SfxInfo } from "./i_sound";

const MAX_VOLUME = 15;
const DEFAULT_SEP = 128;
const DEFAULT_PITCH = 128;
const DEFAULT_PRIORITY = 64;

let sfxVolume = MAX_VOLUME;
let musicVolume = MAX_VOLUME;
let musicHandle = 0;

const channelMap = new Map<unknown, number>();
const musicRegistry = new Map<number, number>();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const S_RegisterSfx = (sfx: SfxInfo) => {
  I_RegisterSfx(sfx);
};

export const S_RegisterMusic = (musicId: number, data: ArrayBuffer | string) => {
  const handle = I_RegisterSong(data);
  musicRegistry.set(musicId, handle);
};

export const S_Init = (initialSfxVolume: number, initialMusicVolume: number) => {
  I_InitSound();
  I_InitMusic();
  S_SetSfxVolume(initialSfxVolume);
  S_SetMusicVolume(initialMusicVolume);
};

export const S_Start = () => {
  for (const handle of channelMap.values()) {
    I_StopSound(handle);
  }
  channelMap.clear();
};

export const S_StartSound = (origin: unknown, soundId: number) => {
  S_StartSoundAtVolume(origin, soundId, sfxVolume);
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

export const S_StopSound = (origin: unknown) => {
  if (!origin) {
    return;
  }
  const handle = channelMap.get(origin);
  if (handle !== undefined) {
    I_StopSound(handle);
    channelMap.delete(origin);
  }
};

export const S_StartMusic = (musicId: number) => {
  S_ChangeMusic(musicId, 1);
};

export const S_ChangeMusic = (musicId: number, looping: number) => {
  if (musicHandle) {
    I_StopSong(musicHandle);
  }
  const handle = musicRegistry.get(musicId);
  if (!handle) {
    return;
  }
  musicHandle = handle;
  I_PlaySong(musicHandle, looping);
};

export const S_StopMusic = () => {
  if (!musicHandle) {
    return;
  }
  I_StopSong(musicHandle);
};

export const S_PauseSound = () => {
  if (musicHandle) {
    I_PauseSong(musicHandle);
  }
};

export const S_ResumeSound = () => {
  if (musicHandle) {
    I_ResumeSong(musicHandle);
  }
};

export const S_UpdateSounds = (_listener: unknown) => {
  for (const [origin, handle] of channelMap.entries()) {
    if (!I_SoundIsPlaying(handle)) {
      channelMap.delete(origin);
    }
  }
  I_UpdateSound();
  I_SubmitSound();
};

export const S_SetMusicVolume = (volume: number) => {
  musicVolume = clamp(volume, 0, MAX_VOLUME);
  I_SetMusicVolume(musicVolume);
};

export const S_SetSfxVolume = (volume: number) => {
  sfxVolume = clamp(volume, 0, MAX_VOLUME);
  I_SetSfxVolume(sfxVolume);
};

export const S_Shutdown = () => {
  if (musicHandle) {
    I_StopSong(musicHandle);
    I_UnRegisterSong(musicHandle);
    musicHandle = 0;
  }
  channelMap.clear();
};
