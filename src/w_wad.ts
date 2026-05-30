export type WadHeader = {
  identification: string;
  numLumps: number;
  infoTableOffset: number;
};

export type WadLump = {
  name: string;
  offset: number;
  size: number;
};

export class WadFile {
  readonly header: WadHeader;
  readonly lumps: WadLump[];
  readonly buffer: ArrayBuffer;
  private readonly nameToIndex: Map<string, number>;

  constructor(header: WadHeader, lumps: WadLump[], buffer: ArrayBuffer) {
    this.header = header;
    this.lumps = lumps;
    this.buffer = buffer;
    this.nameToIndex = new Map();

    for (let i = 0; i < lumps.length; i += 1) {
      this.nameToIndex.set(normalizeName(lumps[i].name), i);
    }
  }

  getLumpIndex(name: string): number {
    const key = normalizeName(name);
    return this.nameToIndex.get(key) ?? -1;
  }
}

const DEFAULT_CORE_LUMPS = [
  "PLAYPAL",
  "COLORMAP",
  "PNAMES",
  "TEXTURE1",
  "F_START",
  "F_END",
  "S_START",
  "S_END",
];

export function validateCoreLumps(
  wad: WadFile,
  required: string[] = DEFAULT_CORE_LUMPS,
): string[] {
  return required.filter((name) => wad.getLumpIndex(name) === -1);
}

export async function loadWad(url: string): Promise<WadFile> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load WAD: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const identification = readString(view, 0, 4);

  if (identification !== "IWAD" && identification !== "PWAD") {
    throw new Error(`Unsupported WAD type: ${identification}`);
  }

  const numLumps = view.getInt32(4, true);
  const infoTableOffset = view.getInt32(8, true);

  if (numLumps < 0) {
    throw new Error("Invalid WAD lump count.");
  }

  const directorySize = numLumps * 16;
  if (infoTableOffset + directorySize > buffer.byteLength) {
    throw new Error("WAD directory exceeds file length.");
  }

  const lumps: WadLump[] = [];
  for (let i = 0; i < numLumps; i += 1) {
    const entryOffset = infoTableOffset + i * 16;
    const offset = view.getInt32(entryOffset, true);
    const size = view.getInt32(entryOffset + 4, true);
    const name = readString(view, entryOffset + 8, 8);

    if (offset < 0 || size < 0 || offset + size > buffer.byteLength) {
      throw new Error(`Invalid lump bounds for ${name}.`);
    }

    lumps.push({ name, offset, size });
  }

  const header: WadHeader = {
    identification,
    numLumps,
    infoTableOffset,
  };

  return new WadFile(header, lumps, buffer);
}

function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

function readString(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const value = view.getUint8(offset + i);
    if (value === 0) {
      break;
    }
    result += String.fromCharCode(value);
  }
  return result.trim();
}
