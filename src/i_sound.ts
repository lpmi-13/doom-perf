const MAX_VOLUME = 15;
const DEFAULT_SEP = 128;
const DEFAULT_PITCH = 128;

export interface SfxInfo {
  id: number;
  name: string;
  data?: ArrayBuffer;
  buffer?: AudioBuffer;
  priority?: number;
}

type ActiveSound = {
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  panner?: StereoPannerNode;
};

let audioContext: AudioContext | null = null;
let sfxMaster: GainNode | null = null;
let sfxVolume = 1;
let nextSoundHandle = 1;
let audioUnlockAttached = false;

const sfxRegistry = new Map<number, SfxInfo>();
const activeSounds = new Map<number, ActiveSound>();

let musicElement: HTMLAudioElement | null = null;
let nextSongHandle = 1;
const songRegistry = new Map<number, { url: string }>();
let musicUnlockAttached = false;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const attachAudioUnlock = () => {
  if (audioUnlockAttached) {
    return;
  }
  audioUnlockAttached = true;
  const resume = () => {
    audioUnlockAttached = false;
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    void audioContext?.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });
};

const attachMusicUnlock = (element: HTMLAudioElement) => {
  if (musicUnlockAttached) {
    return;
  }
  musicUnlockAttached = true;
  const retry = () => {
    musicUnlockAttached = false;
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("keydown", retry);
    void element.play().catch(() => undefined);
  };
  window.addEventListener("pointerdown", retry, { once: true });
  window.addEventListener("keydown", retry, { once: true });
};

const ensureAudioContext = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    sfxMaster = audioContext.createGain();
    sfxMaster.gain.value = sfxVolume;
    sfxMaster.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") {
    attachAudioUnlock();
  }
  void audioContext.resume().catch(() => attachAudioUnlock());
};

const getMusicElement = () => {
  if (!musicElement) {
    musicElement = document.getElementById("audio") as HTMLAudioElement | null;
    if (!musicElement) {
      musicElement = new Audio();
      musicElement.preload = "auto";
    }
  }
  return musicElement;
};

export const I_RegisterSfx = (sfx: SfxInfo) => {
  sfxRegistry.set(sfx.id, sfx);
};

export const I_InitSound = () => {
  ensureAudioContext();
};

export const I_UpdateSound = () => {
  // Web Audio handles mixing internally.
};

export const I_SubmitSound = () => {
  // No explicit submit step required for Web Audio.
};

export const I_ShutdownSound = () => {
  for (const handle of activeSounds.keys()) {
    I_StopSound(handle);
  }
  activeSounds.clear();
};

export const I_SetChannels = () => {
  // Channel count is managed by Web Audio.
};

export const I_GetSfxLumpNum = (sfxinfo: SfxInfo) => sfxinfo.id;

export const I_StartSound = (
  id: number,
  vol: number,
  sep: number,
  pitch: number,
  _priority: number,
) => {
  const sfx = sfxRegistry.get(id);
  if (!sfx) {
    return -1;
  }

  ensureAudioContext();
  if (!audioContext || !sfxMaster) {
    return -1;
  }

  const handle = nextSoundHandle++;
  activeSounds.set(handle, {});

  const playBuffer = (buffer: AudioBuffer) => {
    if (!audioContext || !sfxMaster) {
      return;
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch > 0 ? pitch / DEFAULT_PITCH : 1;

    const panner = audioContext.createStereoPanner();
    panner.pan.value = clamp((sep - DEFAULT_SEP) / DEFAULT_SEP, -1, 1);

    const gain = audioContext.createGain();
    const volume = clamp(vol / 127, 0, 1) * sfxVolume;
    gain.gain.value = volume;

    source.connect(panner).connect(gain).connect(sfxMaster);
    source.onended = () => {
      activeSounds.delete(handle);
    };

    activeSounds.set(handle, { source, gain, panner });
    source.start();
  };

  if (sfx.buffer) {
    playBuffer(sfx.buffer);
  } else if (sfx.data) {
    const pendingHandle = handle;
    audioContext.decodeAudioData(sfx.data.slice(0)).then((buffer) => {
      sfx.buffer = buffer;
      if (activeSounds.has(pendingHandle)) {
        playBuffer(buffer);
      }
    });
  }

  return handle;
};

export const I_StopSound = (handle: number) => {
  const active = activeSounds.get(handle);
  if (active?.source) {
    active.source.stop();
  }
  activeSounds.delete(handle);
};

export const I_SoundIsPlaying = (handle: number) => activeSounds.has(handle);

export const I_UpdateSoundParams = (
  handle: number,
  vol: number,
  sep: number,
  pitch: number,
) => {
  const active = activeSounds.get(handle);
  if (!active) {
    return;
  }
  if (active.gain) {
    active.gain.gain.value = clamp(vol / 127, 0, 1) * sfxVolume;
  }
  if (active.panner) {
    active.panner.pan.value = clamp((sep - DEFAULT_SEP) / DEFAULT_SEP, -1, 1);
  }
  if (active.source) {
    active.source.playbackRate.value = pitch > 0 ? pitch / DEFAULT_PITCH : 1;
  }
};

export const I_InitMusic = () => {
  getMusicElement();
};

export const I_ShutdownMusic = () => {
  const element = getMusicElement();
  element.pause();
  element.removeAttribute("src");
  element.load();
};

export const I_SetMusicVolume = (volume: number) => {
  const element = getMusicElement();
  element.volume = clamp(volume / MAX_VOLUME, 0, 1);
};

export const I_SetSfxVolume = (volume: number) => {
  sfxVolume = clamp(volume / MAX_VOLUME, 0, 1);
  if (sfxMaster) {
    sfxMaster.gain.value = sfxVolume;
  }
};

export const I_PauseSong = (_handle: number) => {
  getMusicElement().pause();
};

export const I_ResumeSong = (_handle: number) => {
  void getMusicElement()
    .play()
    .catch(() => undefined);
};

export const I_RegisterSong = (data: ArrayBuffer | string) => {
  const url =
    typeof data === "string"
      ? data
      : URL.createObjectURL(new Blob([data], { type: "audio/mpeg" }));
  const handle = nextSongHandle++;
  songRegistry.set(handle, { url });
  return handle;
};

export const I_PlaySong = (handle: number, looping: number) => {
  const song = songRegistry.get(handle);
  if (!song) {
    return;
  }
  const element = getMusicElement();
  element.loop = Boolean(looping);
  element.src = song.url;
  void element.play().catch(() => attachMusicUnlock(element));
};

export const I_StopSong = (_handle: number) => {
  const element = getMusicElement();
  element.pause();
  element.currentTime = 0;
};

export const I_UnRegisterSong = (handle: number) => {
  const song = songRegistry.get(handle);
  if (song) {
    if (song.url.startsWith("blob:")) {
      URL.revokeObjectURL(song.url);
    }
    songRegistry.delete(handle);
  }
};
