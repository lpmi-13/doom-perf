import { KEY_DOWNARROW, KEY_LEFTARROW, KEY_RIGHTARROW, KEY_UPARROW, SCREENHEIGHT, SCREENWIDTH } from "./doomdef";
import { V_DrawColumn, V_DrawHorizontal } from "./v_video";
import type { WadFile } from "./w_wad";

type Vertex = { x: number; y: number };
type Line = { v1: number; v2: number };
type Player = { x: number; y: number; angle: number };
type MouseState = { dx: number; dy: number; buttons: number };

let vertices: Vertex[] = [];
let lines: Line[] = [];
let player: Player | null = null;
const PLAYER_RADIUS = 16;

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

export const RS_Init = (wad: WadFile, mapName: string) => {
  const mapIndex = findMapIndex(wad, mapName);
  if (mapIndex === -1) {
    throw new Error(`Map ${mapName} not found in WAD.`);
  }
  const vertexIndex = findLumpIndexAfter(wad, "VERTEXES", mapIndex);
  const linedefIndex = findLumpIndexAfter(wad, "LINEDEFS", mapIndex);
  const thingIndex = findLumpIndexAfter(wad, "THINGS", mapIndex);
  if (vertexIndex === -1 || linedefIndex === -1 || thingIndex === -1) {
    throw new Error(`Missing map geometry lumps for ${mapName}.`);
  }

  const vertexView = getLumpView(wad, vertexIndex);
  const linedefView = getLumpView(wad, linedefIndex);
  const thingView = getLumpView(wad, thingIndex);

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

  let start = { x: 0, y: 0, angle: 0 };
  for (let offset = 0; offset + 10 <= thingView.byteLength; offset += 10) {
    const x = thingView.getInt16(offset, true);
    const y = thingView.getInt16(offset + 2, true);
    const angle = thingView.getInt16(offset + 4, true);
    const type = thingView.getInt16(offset + 6, true);
    if (type === 1) {
      start = { x, y, angle: (angle * Math.PI) / 180 };
      break;
    }
  }

  vertices = nextVertices;
  lines = nextLines;
  player = start;
};

const distanceToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const closestX = x1 + clamped * dx;
  const closestY = y1 + clamped * dy;
  return Math.hypot(px - closestX, py - closestY);
};

export const RS_Ticker = (keyState: Set<number>, mouse?: MouseState) => {
  if (!player) {
    return;
  }
  const moveSpeed = 8;
  const turnSpeed = Math.PI / 90;
  const keyLeft = keyState.has(KEY_LEFTARROW) || keyState.has(65) || keyState.has(97);
  const keyRight = keyState.has(KEY_RIGHTARROW) || keyState.has(68) || keyState.has(100);
  const keyForward = keyState.has(KEY_UPARROW) || keyState.has(87) || keyState.has(119);
  const keyBack = keyState.has(KEY_DOWNARROW) || keyState.has(83) || keyState.has(115);
  if (keyLeft) {
    player.angle -= turnSpeed;
  }
  if (keyRight) {
    player.angle += turnSpeed;
  }
  if (mouse) {
    player.angle += mouse.dx * 0.003;
  }
  const dx = Math.cos(player.angle);
  const dy = Math.sin(player.angle);
  let moveX = 0;
  let moveY = 0;
  if (keyForward) {
    moveX += dx * moveSpeed;
    moveY += dy * moveSpeed;
  }
  if (keyBack) {
    moveX -= dx * moveSpeed;
    moveY -= dy * moveSpeed;
  }
  if (keyState.has(81) || keyState.has(113)) {
    moveX += Math.cos(player.angle - Math.PI / 2) * moveSpeed;
    moveY += Math.sin(player.angle - Math.PI / 2) * moveSpeed;
  }
  if (keyState.has(69) || keyState.has(101)) {
    moveX += Math.cos(player.angle + Math.PI / 2) * moveSpeed;
    moveY += Math.sin(player.angle + Math.PI / 2) * moveSpeed;
  }
  if (mouse && mouse.dy !== 0) {
    const mouseMove = -mouse.dy * 0.05;
    moveX += dx * mouseMove;
    moveY += dy * mouseMove;
  }
  if (moveX !== 0 || moveY !== 0) {
    const tryMove = (nextX: number, nextY: number) => {
      for (const line of lines) {
        const v1 = vertices[line.v1];
        const v2 = vertices[line.v2];
        if (!v1 || !v2) {
          continue;
        }
        const distance = distanceToSegment(nextX, nextY, v1.x, v1.y, v2.x, v2.y);
        if (distance < PLAYER_RADIUS) {
          return false;
        }
      }
      return true;
    };
    const nextX = player.x + moveX;
    if (tryMove(nextX, player.y)) {
      player.x = nextX;
    }
    const nextY = player.y + moveY;
    if (tryMove(player.x, nextY)) {
      player.y = nextY;
    }
  }
};

const intersectRaySegment = (
  px: number,
  py: number,
  dx: number,
  dy: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number | null => {
  const rdx = dx;
  const rdy = dy;
  const sdx = x2 - x1;
  const sdy = y2 - y1;
  const rxs = rdx * sdy - rdy * sdx;
  if (Math.abs(rxs) < 1e-6) {
    return null;
  }
  const t = ((x1 - px) * sdy - (y1 - py) * sdx) / rxs;
  const u = ((x1 - px) * rdy - (y1 - py) * rdx) / rxs;
  if (t > 0 && u >= 0 && u <= 1) {
    return t;
  }
  return null;
};

export const RS_Drawer = () => {
  if (!player) {
    return;
  }
  const fov = Math.PI / 3;
  const halfHeight = Math.floor(SCREENHEIGHT / 2);
  const ceilingColor = 32;
  const floorColor = 64;
  const wallColor = 200;
  for (let x = 0; x < SCREENWIDTH; x += 1) {
    const rayAngle = player.angle - fov / 2 + (fov * x) / SCREENWIDTH;
    const dx = Math.cos(rayAngle);
    const dy = Math.sin(rayAngle);
    let nearest = Infinity;
    for (const line of lines) {
      const v1 = vertices[line.v1];
      const v2 = vertices[line.v2];
      if (!v1 || !v2) {
        continue;
      }
      const distance = intersectRaySegment(player.x, player.y, dx, dy, v1.x, v1.y, v2.x, v2.y);
      if (distance !== null && distance < nearest) {
        nearest = distance;
      }
    }
    const corrected = nearest === Infinity ? 1e6 : nearest * Math.cos(rayAngle - player.angle);
    const wallHeight = Math.min(SCREENHEIGHT, Math.floor((SCREENHEIGHT * 64) / Math.max(1, corrected)));
    const wallTop = Math.max(0, halfHeight - Math.floor(wallHeight / 2));
    const wallBottom = Math.min(SCREENHEIGHT - 1, halfHeight + Math.floor(wallHeight / 2));
    V_DrawColumn(x, 0, wallTop - 1, ceilingColor);
    V_DrawColumn(x, wallTop, wallBottom, wallColor);
    V_DrawColumn(x, wallBottom + 1, SCREENHEIGHT - 1, floorColor);
  }
  V_DrawHorizontal(halfHeight, 0, SCREENWIDTH - 1, 96);
};
