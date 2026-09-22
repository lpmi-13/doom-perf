/**
 * Bridge between the DOOM WASM engine's C sound calls (via EM_JS)
 * and the TypeScript Web Audio sound system (i_sound.ts).
 *
 * The C code calls Module._doomAudio.* methods which this module provides.
 */

import {
  I_InitSound,
  I_RegisterSfx,
  I_StartSound,
  I_StopSound,
  I_SoundIsPlaying,
  I_UpdateSoundParams,
  I_SetSfxVolume,
  I_ShutdownSound,
} from "./i_sound";
import type { SfxInfo } from "./i_sound";

// Cache decoded sound buffers by lump name
const sfxCache = new Map<string, SfxInfo>();
let nextSfxId = 0;

/** Convert DMX sound lump data (Uint8Array) to WAV ArrayBuffer */
function decodeDmxToWav(data: Uint8Array): ArrayBuffer | null {
  if (data.byteLength < 8) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const format = view.getUint16(0, true);
  if (format !== 3) return null; // DMX format marker

  const sampleRate = view.getUint16(2, true) || 11025;
  const sampleCount = view.getUint32(4, true);
  const dataOffset = 8;
  const available = data.byteLength - dataOffset;
  if (available <= 0) return null;

  const length = Math.min(sampleCount || available, available);
  const samples = data.subarray(dataOffset, dataOffset + length);

  // Encode as WAV
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + samples.length);
  const wav = new DataView(buffer);

  // RIFF header
  writeStr(wav, 0, "RIFF");
  wav.setUint32(4, 36 + samples.length, true);
  writeStr(wav, 8, "WAVE");
  writeStr(wav, 12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);       // PCM
  wav.setUint16(22, 1, true);       // mono
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate, true);
  wav.setUint16(32, 1, true);       // block align
  wav.setUint16(34, 8, true);       // bits per sample
  writeStr(wav, 36, "data");
  wav.setUint32(40, samples.length, true);
  new Uint8Array(buffer, headerSize).set(samples);

  return buffer;
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export interface DoomAudioBridge {
  initSound(): void;
  shutdownSound(): void;
  startSound(sfxId: number, name: string, data: Uint8Array | null, dataLen: number, vol: number, sep: number, pitch: number, priority: number): number;
  stopSound(handle: number): void;
  soundIsPlaying(handle: number): boolean;
  updateSoundParams(handle: number, vol: number, sep: number, pitch: number): void;
  initMusic(): void;
  shutdownMusic(): void;
  setMusicVolume(volume: number): void;
  setSfxVolume(volume: number): void;
  pauseSong(handle: number): void;
  resumeSong(handle: number): void;
  registerSong(data: Uint8Array): number;
  playSong(handle: number, looping: number): void;
  stopSong(handle: number): void;
  unregisterSong(handle: number): void;
}

export function createDoomAudioBridge(): DoomAudioBridge {
  return {
    initSound() {
      I_InitSound();
      console.log("[DoomAudio] Sound initialized");
    },

    shutdownSound() {
      I_ShutdownSound();
    },

    startSound(sfxId: number, name: string, data: Uint8Array | null, dataLen: number, vol: number, sep: number, pitch: number, priority: number): number {
      const key = name.toUpperCase();

      // Register this SFX if not cached
      if (!sfxCache.has(key) && data && dataLen > 8) {
        const wavData = decodeDmxToWav(data);
        if (wavData) {
          const info: SfxInfo = { id: nextSfxId++, name: key, data: wavData };
          sfxCache.set(key, info);
          // Register with the low-level sound system
          I_RegisterSfx(info);
        }
      }

      const cached = sfxCache.get(key);
      if (!cached) return -1;

      return I_StartSound(cached.id, vol, sep, pitch, priority);
    },

    stopSound(handle: number) {
      I_StopSound(handle);
    },

    soundIsPlaying(handle: number): boolean {
      return I_SoundIsPlaying(handle);
    },

    updateSoundParams(handle: number, vol: number, sep: number, pitch: number) {
      I_UpdateSoundParams(handle, vol, sep, pitch);
    },

    initMusic() {
      // Music is intentionally unsupported. Keep the bridge method because the
      // C engine calls it unconditionally during audio initialization.
    },

    shutdownMusic() {
    },

    setMusicVolume(_volume: number) {
    },

    setSfxVolume(volume: number) {
      I_SetSfxVolume(volume);
    },

    pauseSong(_handle: number) {
    },

    resumeSong(_handle: number) {
    },

    registerSong(_data: Uint8Array): number {
      return 0;
    },

    playSong(_handle: number, _looping: number) {
    },

    stopSong(_handle: number) {
    },

    unregisterSong(_handle: number) {
    },
  };
}
