import type { SfxInfo } from "./i_sound";
import { S_RegisterSfx } from "./s_sound";
import type { WadFile } from "./w_wad";

export type SoundEntry = SfxInfo & {
  lumpName: string;
  sampleRate: number;
  sampleCount: number;
};

export type SoundRegistry = {
  byId: Map<number, SoundEntry>;
  byName: Map<string, SoundEntry>;
};

const soundRegistry: SoundRegistry = {
  byId: new Map(),
  byName: new Map(),
};

const normalizeName = (name: string) => name.trim().toUpperCase();

export const S_GetSoundRegistry = (): SoundRegistry => soundRegistry;

type WadSoundSource =
  | WadFile
  | {
      lumpInfo: Array<{ name: string; data: ArrayBuffer }>;
    };

const getSoundLumps = (wad: WadSoundSource): Array<{ name: string; data: Uint8Array }> => {
  if ("lumpInfo" in wad) {
    return wad.lumpInfo.map((lump) => ({
      name: lump.name,
      data: new Uint8Array(lump.data),
    }));
  }
  return wad.lumps.map((lump) => ({
    name: lump.name,
    data: new Uint8Array(wad.buffer, lump.offset, lump.size),
  }));
};

export const S_LoadSoundRegistry = (wad: WadSoundSource): SoundRegistry => {
  soundRegistry.byId.clear();
  soundRegistry.byName.clear();

  let nextId = 0;
  for (const lump of getSoundLumps(wad)) {
    const lumpName = normalizeName(lump.name);
    if (!lumpName.startsWith("DS")) {
      continue;
    }

    const decoded = decodeDmxSound(lump.data);
    if (!decoded) {
      continue;
    }

    const name = lumpName.slice(2);
    const entry: SoundEntry = {
      id: nextId++,
      name,
      data: decoded.wavData,
      lumpName,
      sampleRate: decoded.sampleRate,
      sampleCount: decoded.samples.length,
    };
    soundRegistry.byId.set(entry.id, entry);
    soundRegistry.byName.set(name, entry);
    S_RegisterSfx(entry);
  }

  return soundRegistry;
};

const decodeDmxSound = (data: Uint8Array) => {
  if (data.byteLength < 8) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sampleRate = view.getUint16(2, true) || 11025;
  const sampleCount = view.getUint32(4, true);
  const dataOffset = 8;
  const available = data.byteLength - dataOffset;
  if (available <= 0) {
    return null;
  }
  const length = Math.min(sampleCount || available, available);
  const samples = data.subarray(dataOffset, dataOffset + length);
  const wavData = encodeWav(samples, sampleRate);

  return { sampleRate, samples, wavData };
};

const encodeWav = (samples: Uint8Array, sampleRate: number): ArrayBuffer => {
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + samples.length);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length, true);

  new Uint8Array(buffer, headerSize).set(samples);
  return buffer;
};

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};
