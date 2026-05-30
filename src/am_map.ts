import { KEY_DOWNARROW, KEY_LEFTARROW, KEY_RIGHTARROW, KEY_UPARROW, SCREENHEIGHT, SCREENWIDTH } from "./doomdef";
import { V_DrawLine } from "./v_video";
import type { WadFile } from "./w_wad";

type Vertex = { x: number; y: number };
type Line = { v1: number; v2: number };

type MapTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

let vertices: Vertex[] = [];
let lines: Line[] = [];
let transform: MapTransform | null = null;
let player: Vertex | null = null;

const normalizeName = (name: string) => name.trim().toUpperCase();

const isMapMarker = (name: string) => {
  const normalized = normalizeName(name);
  return /^E\dM\d$/.test(normalized) || /^MAP\d\d$/.test(normalized);
};

const findMapIndex = (wad: WadFile, mapName: string): number => {
  const target = normalizeName(mapName);
  return wad.lumps.findIndex((lump) => normalizeName(lump.name) === target);
};

const findLumpIndexAfter = (
  wad: WadFile,
  name: string,
  startIndex: number,
): number => {
  const target = normalizeName(name);
  for (let i = startIndex + 1; i < wad.lumps.length; i += 1) {
    const lumpName = wad.lumps[i].name;
    if (normalizeName(lumpName) === target) {
      return i;
    }
    if (isMapMarker(lumpName)) {
      break;
    }
  }
  return -1;
};

const getLumpView = (wad: WadFile, index: number): DataView => {
  const lump = wad.lumps[index];
  return new DataView(wad.buffer, lump.offset, lump.size);
};

const buildTransform = (verts: Vertex[]): MapTransform => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vert of verts) {
    minX = Math.min(minX, vert.x);
    maxX = Math.max(maxX, vert.x);
    minY = Math.min(minY, vert.y);
    maxY = Math.max(maxY, vert.y);
  }
  const padding = 8;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(
    (SCREENWIDTH - padding * 2) / width,
    (SCREENHEIGHT - padding * 2) / height,
  );
  const offsetX = padding;
  const offsetY = padding;
  return { scale, offsetX, offsetY, minX, maxX, minY, maxY };
};

export const AM_Init = (wad: WadFile, mapName: string) => {
  const mapIndex = findMapIndex(wad, mapName);
  if (mapIndex === -1) {
    throw new Error(`Map ${mapName} not found in WAD.`);
  }
  const vertexIndex = findLumpIndexAfter(wad, "VERTEXES", mapIndex);
  const linedefIndex = findLumpIndexAfter(wad, "LINEDEFS", mapIndex);
  if (vertexIndex === -1 || linedefIndex === -1) {
    throw new Error(`Missing map geometry lumps for ${mapName}.`);
  }

  const vertexView = getLumpView(wad, vertexIndex);
  const linedefView = getLumpView(wad, linedefIndex);
  const nextVertices: Vertex[] = [];
  for (let offset = 0; offset + 4 <= vertexView.byteLength; offset += 4) {
    const x = vertexView.getInt16(offset, true);
    const y = vertexView.getInt16(offset + 2, true);
    nextVertices.push({ x, y });
  }
  const nextLines: Line[] = [];
  for (let offset = 0; offset + 14 <= linedefView.byteLength; offset += 14) {
    const v1 = linedefView.getUint16(offset, true);
    const v2 = linedefView.getUint16(offset + 2, true);
    nextLines.push({ v1, v2 });
  }

  vertices = nextVertices;
  lines = nextLines;
  transform = buildTransform(nextVertices);
  player = {
    x: Math.round((transform.minX + transform.maxX) / 2),
    y: Math.round((transform.minY + transform.maxY) / 2),
  };
};

export const AM_Ticker = (keyState: Set<number>) => {
  if (!transform || !player) {
    return;
  }
  const speed = 8;
  if (keyState.has(KEY_LEFTARROW)) {
    player.x -= speed;
  }
  if (keyState.has(KEY_RIGHTARROW)) {
    player.x += speed;
  }
  if (keyState.has(KEY_UPARROW)) {
    player.y += speed;
  }
  if (keyState.has(KEY_DOWNARROW)) {
    player.y -= speed;
  }
  player.x = Math.min(transform.maxX, Math.max(transform.minX, player.x));
  player.y = Math.min(transform.maxY, Math.max(transform.minY, player.y));
};

export const AM_Drawer = (active: boolean) => {
  if (!active || !transform) {
    return;
  }
  const { scale, offsetX, offsetY, minX, maxY } = transform;
  for (const line of lines) {
    const start = vertices[line.v1];
    const end = vertices[line.v2];
    if (!start || !end) {
      continue;
    }
    const x0 = Math.round((start.x - minX) * scale + offsetX);
    const y0 = Math.round((maxY - start.y) * scale + offsetY);
    const x1 = Math.round((end.x - minX) * scale + offsetX);
    const y1 = Math.round((maxY - end.y) * scale + offsetY);
    V_DrawLine(x0, y0, x1, y1);
  }
  if (player) {
    const px = Math.round((player.x - minX) * scale + offsetX);
    const py = Math.round((maxY - player.y) * scale + offsetY);
    const color = 255;
    V_DrawLine(px - 2, py, px + 2, py, color);
    V_DrawLine(px, py - 2, px, py + 2, color);
  }
};
