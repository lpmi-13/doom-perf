/**
 * Bridge between the DOOM WASM engine's C sound calls (via EM_JS)
 * and the TypeScript Web Audio sound system (i_sound.ts).
 *
 * The C code calls Module._doomAudio.* methods which this module provides.
 */

import {
  I_InitSound,
  I_InitMusic,
  I_RegisterSfx,
  I_StartSound,
  I_StopSound,
  I_SoundIsPlaying,
  I_UpdateSoundParams,
  I_SetMusicVolume,
  I_SetSfxVolume,
  I_PauseSong,
  I_ResumeSong,
  I_StopSong,
  I_ShutdownSound,
  I_ShutdownMusic,
} from "./i_sound";
import type { SfxInfo } from "./i_sound";
import { getMidiPlayer } from "./mus_player";

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

// MUS header magic: "MUS\x1a"
const MUS_MAGIC = 0x1a53554d;

function musToMidi(musData: Uint8Array): ArrayBuffer | null {
  if (musData.length < 16) return null;
  const dv = new DataView(musData.buffer, musData.byteOffset, musData.byteLength);
  if (dv.getUint32(0, true) !== MUS_MAGIC) return null;

  const scoreStart = dv.getUint16(6, true);

  const MUS_TO_MIDI_CTRL: Record<number, number> = {
    1: 0, 2: 1, 3: 7, 4: 10, 5: 11, 6: 91, 7: 93, 8: 64, 9: 67,
  };

  function musCh(ch: number): number {
    if (ch === 15) return 9;
    if (ch >= 9) return ch + 1;
    return ch;
  }

  const events: Array<{ delta: number; bytes: number[] }> = [];
  let pos = scoreStart;
  const lastVol = new Uint8Array(16).fill(127);
  let delta = 0;

  while (pos < musData.length) {
    const eb = musData[pos++];
    const ch = eb & 0x0f;
    const et = (eb >> 4) & 0x07;
    const hasDelay = (eb & 0x80) !== 0;
    const mc = musCh(ch);

    if (et === 0) { // release
      const note = musData[pos++] & 0x7f;
      events.push({ delta, bytes: [0x80 | mc, note, 0] });
      delta = 0;
    } else if (et === 1) { // press
      const nd = musData[pos++];
      const note = nd & 0x7f;
      let vol: number;
      if (nd & 0x80) { vol = musData[pos++] & 0x7f; lastVol[ch] = vol; }
      else { vol = lastVol[ch]; }
      events.push({ delta, bytes: [0x90 | mc, note, vol] });
      delta = 0;
    } else if (et === 2) { // pitch
      const pb = musData[pos++];
      const p14 = Math.round((pb / 255) * 16383);
      events.push({ delta, bytes: [0xe0 | mc, p14 & 0x7f, (p14 >> 7) & 0x7f] });
      delta = 0;
    } else if (et === 3) { // system
      const ctrl = musData[pos++] & 0x7f;
      if (ctrl === 10) events.push({ delta, bytes: [0xb0 | mc, 120, 0] });
      else if (ctrl === 11) events.push({ delta, bytes: [0xb0 | mc, 123, 0] });
      else if (ctrl === 14) events.push({ delta, bytes: [0xb0 | mc, 121, 0] });
      delta = 0;
    } else if (et === 4) { // controller
      const ctrl = musData[pos++] & 0x7f;
      const val = musData[pos++] & 0x7f;
      if (ctrl === 0) events.push({ delta, bytes: [0xc0 | mc, val] });
      else if (ctrl in MUS_TO_MIDI_CTRL) events.push({ delta, bytes: [0xb0 | mc, MUS_TO_MIDI_CTRL[ctrl], val] });
      delta = 0;
    } else if (et === 6) { // end
      break;
    }

    if (hasDelay) {
      let d = 0;
      let b: number;
      do { b = musData[pos++]; d = d * 128 + (b & 0x7f); } while (b & 0x80);
      delta += d;
    }
  }

  events.push({ delta, bytes: [0xff, 0x2f, 0x00] });

  // Build MIDI bytes
  const trackData: number[] = [];
  // Tempo: 500000 us/beat (120 BPM), 70 ticks/beat = 140 ticks/sec
  trackData.push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);

  for (const ev of events) {
    // Variable-length quantity for delta
    let d = ev.delta;
    const vlq: number[] = [];
    if (d === 0) { vlq.push(0); }
    else {
      const tmp: number[] = [];
      while (d > 0) { tmp.push(d & 0x7f); d >>= 7; }
      tmp.reverse();
      for (let i = 0; i < tmp.length; i++) {
        vlq.push(i < tmp.length - 1 ? tmp[i] | 0x80 : tmp[i]);
      }
    }
    trackData.push(...vlq, ...ev.bytes);
  }

  const midi = new ArrayBuffer(14 + 8 + trackData.length);
  const mv = new DataView(midi);
  writeStr(mv, 0, "MThd");
  mv.setUint32(4, 6, false);
  mv.setUint16(8, 0, false);  // format 0
  mv.setUint16(10, 1, false); // 1 track
  mv.setUint16(12, 70, false); // 70 ticks/beat
  writeStr(mv, 14, "MTrk");
  mv.setUint32(18, trackData.length, false);
  new Uint8Array(midi, 22).set(new Uint8Array(trackData));

  return midi;
}

// Song registry for music
const songRegistry = new Map<number, { midiData: ArrayBuffer }>();
let nextSongHandle = 1;

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
      I_InitMusic();
      console.log("[DoomAudio] Music initialized");
    },

    shutdownMusic() {
      I_ShutdownMusic();
      getMidiPlayer().stop();
    },

    setMusicVolume(volume: number) {
      I_SetMusicVolume(volume);
      // Also adjust Tone.js player volume (0-15 DOOM range to dB)
      const db = volume <= 0 ? -60 : -20 + (volume / 15) * 14;
      getMidiPlayer().setVolume(db);
    },

    setSfxVolume(volume: number) {
      I_SetSfxVolume(volume);
    },

    pauseSong(handle: number) {
      I_PauseSong(handle);
      getMidiPlayer().stop();
    },

    resumeSong(handle: number) {
      I_ResumeSong(handle);
      // Re-play current song
    },

    registerSong(data: Uint8Array): number {
      const handle = nextSongHandle++;
      // Convert MUS to MIDI
      const midiData = musToMidi(data);
      if (midiData) {
        songRegistry.set(handle, { midiData });
        console.log(`[DoomAudio] Registered song handle=${handle}, MIDI size=${midiData.byteLength}`);
      }
      return handle;
    },

    playSong(handle: number, looping: number) {
      const song = songRegistry.get(handle);
      if (!song) return;

      const player = getMidiPlayer();
      // Save MIDI as file and load it
      const blob = new Blob([song.midiData], { type: "audio/midi" });
      const url = URL.createObjectURL(blob);

      void (async () => {
        const loaded = await player.loadUrl(url);
        URL.revokeObjectURL(url);
        if (loaded) {
          await player.play(Boolean(looping));
          console.log(`[DoomAudio] Playing song handle=${handle}, looping=${looping}`);
        }
      })();
    },

    stopSong(handle: number) {
      I_StopSong(handle);
      getMidiPlayer().stop();
    },

    unregisterSong(handle: number) {
      songRegistry.delete(handle);
    },
  };
}
