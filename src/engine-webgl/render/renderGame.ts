import { createContext, createRenderer, canvasToTexture, ShaderProgram, createProgram } from 'apl-easy-gl';
import { mat4, vec3 } from 'gl-matrix';

import { animatedFlatFps, animatedWallFps, animatedSpriteFps } from '../constants/WadInfo';
import { ThingType, thingTypesById, ThingKind } from '../constants/ThingTypes';
import { playerHeight } from '../constants/GameInfo';

import { Triangle } from '../interfaces/Triangle';
import { Thing } from '../interfaces/Thing';
import { Sector } from '../interfaces/Sector';
import { AabbPointType } from '../interfaces/TriangleCache';
import { Wad } from '../interfaces/Wad';
import { WadMap } from '../interfaces/WadMap';
import { SpriteTexture } from '../interfaces/SpriteTexture';

import { angle } from '../utils/math';
import { insertAabbCacheItem } from '../utils/insertAabbCache';
import { findTrianglesAtPosition } from '../utils/findTrianglesAtPosition';
import { pointInTriangle } from '../utils/pointInTriangle';
import { createMapBuffers, MapBuffers } from '../geometry/createBuffers';
import { drawWadAssets, WadAssets } from './drawWadAssets';
import { S_StartSound } from '../../s_sound';
import { S_GetSoundRegistry } from '../../s_sound_registry';

import wallsVert  from '../shaders/walls.vert';
import wallsFrag  from '../shaders/walls.frag';
import flatVert  from '../shaders/flat.vert';
import flatFrag  from '../shaders/flat.frag';
import skyVert  from  '../shaders/sky.vert';
import skyFrag  from '../shaders/sky.frag';
import thingsVert  from  '../shaders/things.vert';
import thingsFrag  from '../shaders/things.frag';

interface TriangleHashObject {
  triangle: Triangle;
  sector: Sector;
}

interface ThingSprite {
  sprite: SpriteTexture;
  mirror?: boolean;
}

interface ThingState {
  health: number;
  lastHitTime: number;
  deadTime?: number;
}

type FramesByThingNameMap = Record<string, Record<number, Record<number, ThingSprite>>>;
interface TriangleHash {
  x: Array<{ val: number; type: AabbPointType; obj: TriangleHashObject }>;
  y: Array<{ val: number; type: AabbPointType; obj: TriangleHashObject }>;
}

const enemyMoveSpeed = 0.03;
const enemyStopDistance = 32;
const shotCooldownMs = 250;
const hitFlashDurationMs = 150;
const damagePerShot = 20;
const maxShotRange = 2000;
const targetableKinds = new Set([ThingKind.monster]);
const playerRadius = 16;
const baseMoveSpeed = 7.5;
const lookSpeed = 1.6;
const jumpVelocity = 6.5;
const gravity = 18;
const maxPitch = Math.PI / 3;
const pickupRadius = 24;
const barrelThingIds = new Set([2035, 70]);
const barrelExplosionRadius = 96;
const barrelExplosionDamage = 50;
const weaponSwitchKeys = new Map([
  ['Digit1', 1],
  ['Digit2', 2],
  ['Digit3', 3],
  ['Digit4', 4],
  ['Digit5', 5],
  ['Digit6', 6],
  ['Digit7', 7],
]);

type AmmoType = 'bullets' | 'shells' | 'rockets' | 'cells';
type WeaponSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const weaponAmmo: Record<WeaponSlot, AmmoType | null> = {
  1: 'bullets',
  2: 'shells',
  3: 'bullets',
  4: 'rockets',
  5: 'cells',
  6: 'cells',
  7: null,
};

const weaponSpritesBySlot: Record<WeaponSlot, string> = {
  1: 'PISGA0',
  2: 'SHTGA0',
  3: 'CHGGA0',
  4: 'LAUNA0',
  5: 'PLSGA0',
  6: 'BFGGA0',
  7: 'SAWGA0',
};

export const renderGame = (canvas: HTMLCanvasElement, options: { onHudUpdate?: (state: {
  ammo: number;
  health: number;
  armor: number;
  keys: Array<string>;
  facePatchName?: string;
  weaponSpriteName?: string;
  ammoCounts?: {
    bullets: number;
    shells: number;
    rockets: number;
    cells: number;
  };
}) => void } = {}) => {
  const gl = createContext(canvas, {}, [
    'EXT_frag_depth'
  ]);
  
  const projectionMatrix = mat4.create();
  const modelMatrix = mat4.create();
  const viewMatrix = mat4.create();
  const modelViewMatrix = mat4.create();
  const modelViewProjMatrix = mat4.create();
  
  const camera = {
    pos: vec3.fromValues(800.0, 900.0, -100.0),
    lookAt: vec3.fromValues(800.0, 800.0, -200.0),
    up: vec3.fromValues(0.0, 1.0, 0.0),
    near: 0.1,
    far: 64000.0,
    fov: 45
  };

  const shaders = {
    walls: createProgram(gl, wallsVert, wallsFrag),
    flats: createProgram(gl, flatVert, flatFrag),
    sky: createProgram(gl, skyVert, skyFrag),
    things: createProgram(gl, thingsVert, thingsFrag)
  };

  let wad: Wad;
  let map: WadMap;
  let unbindControls: () => void;
  let buffers: MapBuffers;
  let animateFlatIndex: number;
  let animateWallIndex: number;
  let animateSpriteIndex: number;
  let sortedFramesByThingName: FramesByThingNameMap;
  let textures: {
    flats: Record<string, WebGLTexture>,
    walls: Record<string, WebGLTexture>,
    things: Record<string, WebGLTexture>
  };
  let sectorsByThing: Map<Thing, Sector>;
  let time = 0;
  let wadAssets: WadAssets;
  let mapTriangleHash: TriangleHash;
  let enemies: Array<Thing> = [];
  let thingStates = new Map<Thing, ThingState>();
  let lastShotTime = 0;
  let weaponSoundId: number | undefined;
  let enemyHitSoundId: number | undefined;
  let enemyDeathSoundId: number | undefined;
  let environmentSoundId: number | undefined;
  let pickupSoundId: number | undefined;
  let weaponSwitchSoundId: number | undefined;
  let jumpSoundId: number | undefined;
  const playerSoundOrigin = { type: 'player' };
  const environmentSoundOrigin = { type: 'environment' };
  let yaw = 0;
  let pitch = 0;
  let verticalVelocity = 0;
  let verticalOffset = 0;
  let isGrounded = false;
  let playerMapPos = { x: 0, y: 0 };
  let playerFloor = 0;
  const pressedKeys = new Set<string>();
  const collectedThings = new Set<Thing>();
  const destroyedThings = new Set<Thing>();
  let lastMoveTime = -Infinity;
  let lastPlayerHitTime = -Infinity;
  let lastEnemyAttackTime = 0;
  const playerState = {
    health: 100,
    armor: 0,
    ammo: {
      bullets: 50,
      shells: 0,
      rockets: 0,
      cells: 0,
    } as Record<AmmoType, number>,
    ammoMax: {
      bullets: 200,
      shells: 50,
      rockets: 50,
      cells: 300,
    } as Record<AmmoType, number>,
    weapons: new Set<WeaponSlot>([1]),
    activeWeapon: 1 as WeaponSlot,
    keys: new Set<string>(),
  };

  const resolveSoundId = (names: string[]) => {
    const registry = S_GetSoundRegistry();
    for (const name of names) {
      const entry = registry.byName.get(name.toUpperCase());
      if (entry) {
        return entry.id;
      }
    }
    const fallback = registry.byId.values().next().value;
    return fallback ? fallback.id : undefined;
  };

  const playSound = (soundId: number | undefined, origin: unknown) => {
    if (soundId === undefined) {
      return;
    }
    S_StartSound(origin, soundId);
  };

  const shouldRenderThing = (thingObj: Thing, thingType?: ThingType) => {
    if (!thingType || !thingType.sprite || thingType.kind == undefined) {
      return false;
    }

    if (thingObj.flags.hideInSingleplayer) {
      return false;
    }

    if (collectedThings.has(thingObj)) {
      return false;
    }

    if (destroyedThings.has(thingObj)) {
      return false;
    }

    return true;
  };

  const isTargetable = (thingType?: ThingType) =>
    Boolean(thingType && (targetableKinds.has(thingType.kind as ThingKind) || barrelThingIds.has(thingType.id)));

  const getMonsterHealth = (thingType?: ThingType) => {
    if (!thingType || thingType.kind !== ThingKind.monster) {
      return 0;
    }
    switch (thingType.id) {
      case 7:
        return 3000;
      case 16:
        return 4000;
      case 3003:
        return 1000;
      case 69:
        return 800;
      case 67:
        return 600;
      case 68:
        return 500;
      case 3005:
        return 400;
      case 3002:
      case 58:
        return 150;
      case 3001:
        return 80;
      case 3004:
      case 9:
        return 60;
      default:
        return 100;
    }
  };

  const isBlockingLine = (line: LineDef) =>
    !line.flags.twoSided || line.flags.impassible || Boolean(line.flags.blockAll);

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
    const sdx = x2 - x1;
    const sdy = y2 - y1;
    const rxs = dx * sdy - dy * sdx;
    if (Math.abs(rxs) < 1e-6) {
      return null;
    }
    const t = ((x1 - px) * sdy - (y1 - py) * sdx) / rxs;
    const u = ((x1 - px) * dy - (y1 - py) * dx) / rxs;
    if (t > 0 && u >= 0 && u <= 1) {
      return t;
    }
    return null;
  };

  const canMoveTo = (x: number, y: number, radius: number) => {
    if (!map) {
      return true;
    }
    for (const line of map.LINEDEFS) {
      if (!isBlockingLine(line)) {
        continue;
      }
      const v1 = map.VERTEXES[line.v1];
      const v2 = map.VERTEXES[line.v2];
      if (!v1 || !v2) {
        continue;
      }
      if (distanceToSegment(x, y, v1.x, v1.y, v2.x, v2.y) < radius) {
        return false;
      }
    }
    return true;
  };

  const getNearestWallDistance = (x: number, y: number, dx: number, dy: number) => {
    if (!map) {
      return Infinity;
    }
    let nearest = Infinity;
    for (const line of map.LINEDEFS) {
      if (!isBlockingLine(line)) {
        continue;
      }
      const v1 = map.VERTEXES[line.v1];
      const v2 = map.VERTEXES[line.v2];
      if (!v1 || !v2) {
        continue;
      }
      const hit = intersectRaySegment(x, y, dx, dy, v1.x, v1.y, v2.x, v2.y);
      if (hit !== null && hit < nearest) {
        nearest = hit;
      }
    }
    return nearest;
  };

  const getSectorAtPosition = (position: { x: number; y: number }) => {
    if (!mapTriangleHash) {
      return undefined;
    }

    const thingTriangles = findTrianglesAtPosition<TriangleHashObject>(mapTriangleHash, position);
    let thingSector: Sector | undefined;

    thingTriangles.items.some((item) => {
      if (pointInTriangle(position, item.triangle)) {
        thingSector = item.sector;
        return true;
      }
    });

    return thingSector;
  };

  const updateViewMatrix = () => {
    mat4.identity(viewMatrix);
    mat4.rotateY(viewMatrix, viewMatrix, yaw);
    mat4.rotateX(viewMatrix, viewMatrix, pitch);
    mat4.translate(viewMatrix, viewMatrix, [-camera.pos[0], -camera.pos[1], -camera.pos[2]]);
  };

  const updatePlayerMovement = (dt: number) => {
    const dtSeconds = dt / 1000;
    const moveAmount = baseMoveSpeed * dtSeconds;
    const forwardX = Math.sin(yaw);
    const forwardY = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightY = -Math.sin(yaw);
    let moveX = 0;
    let moveY = 0;

    if (pressedKeys.has('KeyW')) {
      moveX += forwardX * moveAmount;
      moveY += forwardY * moveAmount;
    }
    if (pressedKeys.has('KeyS')) {
      moveX -= forwardX * moveAmount;
      moveY -= forwardY * moveAmount;
    }
    if (pressedKeys.has('KeyA')) {
      moveX -= rightX * moveAmount;
      moveY -= rightY * moveAmount;
    }
    if (pressedKeys.has('KeyD')) {
      moveX += rightX * moveAmount;
      moveY += rightY * moveAmount;
    }

    if (moveX !== 0 || moveY !== 0) {
      lastMoveTime = performance.now();
    }

    const nextX = playerMapPos.x + moveX;
    const nextY = playerMapPos.y + moveY;

    if (canMoveTo(nextX, playerMapPos.y, playerRadius)) {
      playerMapPos.x = nextX;
    }
    if (canMoveTo(playerMapPos.x, nextY, playerRadius)) {
      playerMapPos.y = nextY;
    }

    const sector = getSectorAtPosition(playerMapPos);
    if (sector) {
      playerFloor = sector.floorheight;
    }

    verticalVelocity -= gravity * dtSeconds;
    verticalOffset += verticalVelocity * dtSeconds;
    if (verticalOffset <= 0) {
      verticalOffset = 0;
      verticalVelocity = 0;
      isGrounded = true;
    } else {
      isGrounded = false;
    }

    const playerYPos = playerFloor + playerHeight + verticalOffset;
    vec3.set(camera.pos, playerMapPos.x, playerYPos, -playerMapPos.y);

    updateViewMatrix();
  };

  const updateLookFromKeys = (dt: number) => {
    const dtSeconds = dt / 1000;
    let yawDelta = 0;
    let pitchDelta = 0;
    if (pressedKeys.has('ArrowLeft')) {
      yawDelta += lookSpeed * dtSeconds;
    }
    if (pressedKeys.has('ArrowRight')) {
      yawDelta -= lookSpeed * dtSeconds;
    }
    if (pressedKeys.has('ArrowUp')) {
      pitchDelta += lookSpeed * dtSeconds;
    }
    if (pressedKeys.has('ArrowDown')) {
      pitchDelta -= lookSpeed * dtSeconds;
    }
    yaw += yawDelta;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch + pitchDelta));
  };

  const setupControls = () => {
    const handleKeyDown = (event: KeyboardEvent) => {
      pressedKeys.add(event.code);
      if (event.code === 'Space' && isGrounded) {
        verticalVelocity = jumpVelocity;
        isGrounded = false;
        playSound(jumpSoundId, playerSoundOrigin);
      }
      if (event.code === 'Enter') {
        fireShot();
      }
      const slot = weaponSwitchKeys.get(event.code);
      if (slot) {
        selectWeaponSlot(slot as WeaponSlot);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  };

  const selectWeaponSlot = (slot: WeaponSlot) => {
    if (!playerState.weapons.has(slot)) {
      return;
    }
    if (playerState.activeWeapon !== slot) {
      playerState.activeWeapon = slot;
      playSound(weaponSwitchSoundId, playerSoundOrigin);
    }
  };

  const updateEnemies = (dt: number) => {
    if (!enemies.length) {
      return;
    }

    const now = performance.now();
    const playerPos = { x: camera.pos[0], y: -camera.pos[2] };

    enemies.forEach((enemy) => {
      const state = thingStates.get(enemy);
      if (state && state.health <= 0) {
        return;
      }
      const toPlayerX = playerPos.x - enemy.x;
      const toPlayerY = playerPos.y - enemy.y;
      const distance = Math.hypot(toPlayerX, toPlayerY);

      if (!distance || distance <= enemyStopDistance) {
        if (state && state.health > 0 && now - lastEnemyAttackTime > 800) {
          playerState.health = Math.max(0, playerState.health - 5);
          lastPlayerHitTime = now;
          lastEnemyAttackTime = now;
        }
        return;
      }

      const step = Math.min(distance - enemyStopDistance, enemyMoveSpeed * dt);
      const dirX = toPlayerX / distance;
      const dirY = toPlayerY / distance;
      const nextX = enemy.x + dirX * step;
      const nextY = enemy.y + dirY * step;
      const radius = thingTypesById[enemy.type]?.radius ?? playerRadius;

      if (canMoveTo(nextX, nextY, radius)) {
        enemy.x = nextX;
        enemy.y = nextY;
        enemy.angle = ((Math.atan2(dirY, dirX) * 180) / Math.PI + 360) % 360;

        const enemySector = getSectorAtPosition(enemy);
        if (enemySector) {
          sectorsByThing.set(enemy, enemySector);
        }
      }
    });
  };

  const applyPickup = (thingObj: Thing, thingType: ThingType) => {
    switch (thingType.id) {
      case 5:
        playerState.keys.add('STKEYS0');
        break;
      case 6:
        playerState.keys.add('STKEYS1');
        break;
      case 13:
        playerState.keys.add('STKEYS2');
        break;
      case 40:
        playerState.keys.add('STKEYS3');
        break;
      case 39:
        playerState.keys.add('STKEYS4');
        break;
      case 38:
        playerState.keys.add('STKEYS5');
        break;
      case 8:
        playerState.ammoMax.bullets = 400;
        playerState.ammoMax.shells = 100;
        playerState.ammoMax.rockets = 100;
        playerState.ammoMax.cells = 600;
        break;
      case 2011:
        playerState.health = Math.min(100, playerState.health + 10);
        break;
      case 2012:
        playerState.health = Math.min(100, playerState.health + 25);
        break;
      case 2013:
        playerState.health = Math.min(200, playerState.health + 100);
        break;
      case 2014:
        playerState.health = Math.min(200, playerState.health + 1);
        break;
      case 2015:
        playerState.armor = Math.min(200, playerState.armor + 1);
        break;
      case 2018:
        playerState.armor = Math.max(playerState.armor, 100);
        break;
      case 2019:
        playerState.armor = Math.max(playerState.armor, 200);
        break;
      case 2007:
        playerState.ammo.bullets = Math.min(playerState.ammoMax.bullets, playerState.ammo.bullets + 10);
        break;
      case 2048:
        playerState.ammo.bullets = Math.min(playerState.ammoMax.bullets, playerState.ammo.bullets + 50);
        break;
      case 2008:
        playerState.ammo.shells = Math.min(playerState.ammoMax.shells, playerState.ammo.shells + 4);
        break;
      case 2049:
        playerState.ammo.shells = Math.min(playerState.ammoMax.shells, playerState.ammo.shells + 20);
        break;
      case 2010:
        playerState.ammo.rockets = Math.min(playerState.ammoMax.rockets, playerState.ammo.rockets + 1);
        break;
      case 2046:
        playerState.ammo.rockets = Math.min(playerState.ammoMax.rockets, playerState.ammo.rockets + 5);
        break;
      case 2047:
        playerState.ammo.cells = Math.min(playerState.ammoMax.cells, playerState.ammo.cells + 20);
        break;
      case 17:
        playerState.ammo.cells = Math.min(playerState.ammoMax.cells, playerState.ammo.cells + 100);
        break;
      case 82:
        playerState.weapons.add(2);
        playerState.ammo.shells = Math.min(playerState.ammoMax.shells, playerState.ammo.shells + 8);
        selectWeaponSlot(2);
        break;
      case 2001:
        playerState.weapons.add(2);
        playerState.ammo.shells = Math.min(playerState.ammoMax.shells, playerState.ammo.shells + 8);
        selectWeaponSlot(2);
        break;
      case 2002:
        playerState.weapons.add(3);
        playerState.ammo.bullets = Math.min(playerState.ammoMax.bullets, playerState.ammo.bullets + 20);
        selectWeaponSlot(3);
        break;
      case 2003:
        playerState.weapons.add(4);
        playerState.ammo.rockets = Math.min(playerState.ammoMax.rockets, playerState.ammo.rockets + 1);
        selectWeaponSlot(4);
        break;
      case 2004:
        playerState.weapons.add(5);
        playerState.ammo.cells = Math.min(playerState.ammoMax.cells, playerState.ammo.cells + 20);
        selectWeaponSlot(5);
        break;
      case 2005:
        playerState.weapons.add(7);
        selectWeaponSlot(7);
        break;
      case 2006:
        playerState.weapons.add(6);
        playerState.ammo.cells = Math.min(playerState.ammoMax.cells, playerState.ammo.cells + 40);
        selectWeaponSlot(6);
        break;
      default:
        break;
    }
  };

  const updatePickups = () => {
    if (!map) {
      return;
    }
    map.THINGS.forEach((thingObj: Thing) => {
      if (collectedThings.has(thingObj)) {
        return;
      }
      const thingType = thingTypesById[thingObj.type];
      if (!thingType || (thingType.kind !== ThingKind.pickup && thingType.kind !== ThingKind.weapon && thingType.kind !== ThingKind.artifact)) {
        return;
      }
      const distance = Math.hypot(thingObj.x - playerMapPos.x, thingObj.y - playerMapPos.y);
      if (distance > pickupRadius) {
        return;
      }
      applyPickup(thingObj, thingType);
      collectedThings.add(thingObj);
      playSound(pickupSoundId, playerSoundOrigin);
    });
  };

  const updateHud = () => {
    const ammoType = weaponAmmo[playerState.activeWeapon];
    const ammo = ammoType ? playerState.ammo[ammoType] : 0;
    const now = performance.now();
    let facePatchName = "STFST00";
    if (now - lastPlayerHitTime < 500) {
      facePatchName = "STFST02";
    } else if (now - lastMoveTime < 300) {
      facePatchName = "STFST01";
    }
    options.onHudUpdate?.({
      ammo,
      health: playerState.health,
      armor: playerState.armor,
      keys: Array.from(playerState.keys),
      facePatchName,
      weaponSpriteName: weaponSpritesBySlot[playerState.activeWeapon],
      ammoCounts: {
        bullets: playerState.ammo.bullets,
        shells: playerState.ammo.shells,
        rockets: playerState.ammo.rockets,
        cells: playerState.ammo.cells,
      },
    });
  };

  const fireShot = () => {
    if (!map) {
      return;
    }
    const now = performance.now();
    if (now - lastShotTime < shotCooldownMs) {
      return;
    }

    const weaponSlot = playerState.activeWeapon;
    const ammoType = weaponAmmo[weaponSlot];
    if (ammoType) {
      const ammo = playerState.ammo[ammoType];
      if (ammo <= 0) {
        return;
      }
      playerState.ammo[ammoType] = Math.max(0, ammo - 1);
    }
    lastShotTime = now;
    playSound(weaponSoundId, playerSoundOrigin);

    const originX = camera.pos[0];
    const originY = -camera.pos[2];
    const ndx = Math.sin(yaw);
    const ndy = Math.cos(yaw);

    let bestThing: Thing | null = null;
    let bestThingType: ThingType | undefined;
    let bestDistance = maxShotRange;
    const wallDistance = getNearestWallDistance(originX, originY, ndx, ndy);

    map.THINGS.forEach((thingObj: Thing) => {
      const thingType = thingTypesById[thingObj.type];
      if (!isTargetable(thingType)) {
        return;
      }
      const state = thingStates.get(thingObj);
      if (state && state.health <= 0) {
        return;
      }
      const dx = thingObj.x - originX;
      const dy = thingObj.y - originY;
      const forwardDistance = dx * ndx + dy * ndy;
      if (forwardDistance <= 0 || forwardDistance > bestDistance || forwardDistance > wallDistance) {
        return;
      }
      const perpendicular = Math.abs(dx * ndy - dy * ndx);
      const radius = thingType?.radius ?? 16;
      if (perpendicular <= radius) {
        bestThing = thingObj;
        bestThingType = thingType;
        bestDistance = forwardDistance;
      }
    });

    if (bestThing) {
      if (bestThingType && barrelThingIds.has(bestThingType.id)) {
        destroyedThings.add(bestThing);
        playSound(environmentSoundId, bestThing);
        map.THINGS.forEach((thingObj: Thing) => {
          const thingType = thingTypesById[thingObj.type];
          if (!isTargetable(thingType)) {
            return;
          }
          const state = thingStates.get(thingObj);
          if (!state || state.health <= 0) {
            return;
          }
          const distance = Math.hypot(thingObj.x - bestThing.x, thingObj.y - bestThing.y);
          if (distance > barrelExplosionRadius) {
            return;
          }
          state.health -= barrelExplosionDamage;
          state.lastHitTime = now;
          if (state.health <= 0) {
            state.deadTime = now;
            playSound(enemyDeathSoundId, thingObj);
          }
        });
        return;
      }
      const state = thingStates.get(bestThing);
      if (state) {
        const wasAlive = state.health > 0;
        state.health -= damagePerShot;
        state.lastHitTime = now;
        if (wasAlive && state.health <= 0) {
          state.deadTime = now;
          playSound(enemyDeathSoundId, bestThing);
        } else if (wasAlive) {
          playSound(enemyHitSoundId, bestThing);
        }
      }
    } else {
      playSound(environmentSoundId, environmentSoundOrigin);
    }
  };

  const loadWad = (newWad: Wad, newMap: WadMap) => {
    wad = newWad;
    wadAssets = drawWadAssets(wad);
    weaponSoundId = resolveSoundId(['PISTOL', 'SHOTGN', 'PLASMA', 'BFG', 'SAWUP']);
    enemyHitSoundId = resolveSoundId(['POPAIN', 'PAIN', 'SGTPAIN', 'SLOP']);
    enemyDeathSoundId = resolveSoundId(['PODTH1', 'BOSDTH', 'SLODTH', 'BGDTH1', 'SKLDTH']);
    environmentSoundId = resolveSoundId(['BULHIT', 'RICO', 'DOROPN', 'DORCLS', 'STNMOV']);
    pickupSoundId = resolveSoundId(['ITEMUP', 'WPNUP', 'AMMOUP']);
    weaponSwitchSoundId = resolveSoundId(['WPNUP', 'PISTOL']);
    jumpSoundId = resolveSoundId(['OOF', 'PLPAIN']);
    
    //update the things and set their directions and frames using the sprite assets
    const framesByThingName: FramesByThingNameMap = {};

    Object.keys(wad.sprites).forEach((spriteName) => {
      const thingName = spriteName.slice(0, 4);
      const sprite = wadAssets.spritesByName[spriteName];
      const frameChar = spriteName[4].charCodeAt(0);
      const direction = parseInt(spriteName[5], 10);
      const frames = framesByThingName[thingName] || {};

      framesByThingName[thingName] = frames;

      frames[direction] = frames[direction] || {};
      frames[direction][frameChar] = { sprite };

      //re-used for another
      if (spriteName.length > 6) {
        const frameChar2 = spriteName[6].charCodeAt(0);
        const direction2 = parseInt(spriteName[7], 10);
        
        frames[direction2] = frames[direction2] || {};
        frames[direction2][frameChar2] = { sprite, mirror: true };
      }
    });

    sortedFramesByThingName = Object.keys(framesByThingName).reduce<FramesByThingNameMap>((acc, thingName) => {
      const frames = framesByThingName[thingName];

      acc[thingName] = Object.keys(frames).map(parseFloat).reduce<Record<number, Array<ThingSprite>>>((acc2, directionNum) => {
        const directionFrames = frames[directionNum];

        acc2[directionNum] = Object.keys(directionFrames).map(parseFloat).sort().reduce<Array<ThingSprite>>((acc3, frameKey) => {
          acc3.push(directionFrames[frameKey]);
          return acc3;
        }, []);
        return acc2;
      }, {});
      return acc;
    }, {});

    textures = {
      flats: wadAssets.flats.reduce<Record<string, WebGLTexture>>((acc, flat) => {
        acc[flat.name] = canvasToTexture(gl, flat.graphics.canvas, {
          minFilter: gl.LINEAR,
          magFilter: gl.NEAREST,
          wrapS: gl.REPEAT,
          wrapT: gl.REPEAT
        });

        return acc;
      }, {}),
      walls: wadAssets.textures.reduce<Record<string, WebGLTexture>>((acc, texture) => {
        acc[texture.name] = canvasToTexture(gl, texture.graphics.canvas, {
          minFilter: texture.transparent ? gl.NEAREST : gl.LINEAR,
          magFilter: gl.NEAREST,
          wrapS: gl.REPEAT,
          wrapT: gl.REPEAT
        });

        return acc;
      }, {}),
      things: wadAssets.sprites.reduce<Record<string, WebGLTexture>>((acc, sprite) => {
        acc[sprite.name] = canvasToTexture(gl, sprite.graphics.canvas, {
          minFilter: gl.NEAREST,
          magFilter: gl.NEAREST,
          wrapS: gl.CLAMP_TO_EDGE,
          wrapT: gl.CLAMP_TO_EDGE
        });

        return acc;
      }, {})
    };

    loadMap(newMap);
  };

  const loadMap = (newMap: WadMap) => {
    map = newMap;

    //unload the previous map
    unbindControls?.();

    //load the new map
    buffers = createMapBuffers(gl, map, wadAssets.texturesByName);

    const playerStart = map.THINGS.filter((thing) => thing.type == 1)[0];
    const rotAngle = playerStart.angle / 180 * Math.PI;
    const startMapPos = { x: playerStart.x, y: playerStart.y };

    mapTriangleHash = { x: [], y: [] };

    //add each triangle in the sector to the 2d map hash
    map.SECTORS.forEach((_, sectorIndex) => {
      buffers.sectorTriangles[sectorIndex].forEach((triangle) => {
        const obj: TriangleHashObject = {
          triangle: triangle, 
          sector: map.SECTORS[sectorIndex]
        };

        insertAabbCacheItem<TriangleHashObject>(mapTriangleHash.x, { val: Math.min(triangle[0].x, triangle[1].x, triangle[2].x), type: AabbPointType.min, obj });
        insertAabbCacheItem<TriangleHashObject>(mapTriangleHash.x, { val: Math.max(triangle[0].x, triangle[1].x, triangle[2].x), type: AabbPointType.max, obj });
        insertAabbCacheItem<TriangleHashObject>(mapTriangleHash.y, { val: Math.min(triangle[0].y, triangle[1].y, triangle[2].y), type: AabbPointType.min, obj });
        insertAabbCacheItem<TriangleHashObject>(mapTriangleHash.y, { val: Math.max(triangle[0].y, triangle[1].y, triangle[2].y), type: AabbPointType.max, obj });
      });
    });

    sectorsByThing = new Map<Thing, Sector>();

    map.THINGS.forEach((thingObj: Thing) => {
      const thingSector = getSectorAtPosition({ x: thingObj.x, y: thingObj.y });

      if (!thingSector) {
        //oh no, no sector for this thing :P - must be an error in the map design
        console.error(thingObj);
        throw new Error('Could not find sector for thing');
      }

      sectorsByThing.set(thingObj, thingSector);
    });

    enemies = map.THINGS.filter((thingObj) => {
      const thingType = thingTypesById[thingObj.type];
      return shouldRenderThing(thingObj, thingType) && thingType?.kind === ThingKind.monster;
    });

    thingStates = new Map();
    map.THINGS.forEach((thingObj: Thing) => {
      const thingType = thingTypesById[thingObj.type];
      if (isTargetable(thingType)) {
        thingStates.set(thingObj, { health: getMonsterHealth(thingType), lastHitTime: -Infinity });
      }
    });

    const sectorTriangles = findTrianglesAtPosition<TriangleHashObject>(mapTriangleHash, startMapPos);

    let playerSector: Sector;

    sectorTriangles.items.some((item) => {
      if (pointInTriangle(startMapPos, item.triangle)) {
        playerSector = item.sector;
        return true;
      }
    });

    playerFloor = playerSector!.floorheight;
    const playerYPos = playerFloor + playerHeight;

    playerMapPos = { x: playerStart.x, y: playerStart.y };
    vec3.set(camera.pos, playerMapPos.x, playerYPos, -playerMapPos.y);
    yaw = Math.PI / 2 - rotAngle;
    pitch = 0;
    verticalOffset = 0;
    verticalVelocity = 0;
    isGrounded = true;
    updateViewMatrix();

    playerState.health = 100;
    playerState.armor = 0;
    playerState.ammo = { bullets: 50, shells: 0, rockets: 0, cells: 0 };
    playerState.weapons = new Set<WeaponSlot>([1]);
    playerState.activeWeapon = 1;
    playerState.keys.clear();
    collectedThings.clear();
    destroyedThings.clear();
    lastMoveTime = -Infinity;
    lastPlayerHitTime = -Infinity;
    lastEnemyAttackTime = 0;

    unbindControls = setupControls();
  };

  const resizeScene = () => {
    const { width, height } = canvas.getBoundingClientRect();
    const deviceScale = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(width * deviceScale));
    const nextHeight = Math.max(1, Math.round(height * deviceScale));
    if (gl.canvas.width !== nextWidth || gl.canvas.height !== nextHeight) {
      gl.canvas.width = nextWidth;
      gl.canvas.height = nextHeight;
    }
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    mat4.perspective(projectionMatrix, camera.fov / 180 * Math.PI, gl.canvas.width / gl.canvas.height, camera.near, camera.far);
  };

  const drawScene = () => {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const now = performance.now();

    //TODO: draw only what is visible in the scene to the player
    let shader: ShaderProgram;

    //things
    shader = shaders.things;

    gl.useProgram(shader.program);

    shader.setAttributes({
      aPosition: buffers.thing.position,
      aUv: buffers.thing.uv
    });

    map.THINGS.forEach((thingObj: Thing, thingIndex: number) => {
      const thingType = thingTypesById[thingObj.type];

      if (!shouldRenderThing(thingObj, thingType)) {
        return;
      }

      const spriteObj = sortedFramesByThingName[thingType.sprite];

      const thingAngle = angle({ x: thingObj.x - camera.pos[0], y: -thingObj.y - camera.pos[2] });

      const thingSector = sectorsByThing.get(thingObj);

      if (!spriteObj || !thingSector) {
        return;
      }

      const directionKeys = Object.keys(spriteObj).map(Number);
      let directionIndex = directionKeys[0];
      if (directionKeys.length > 1 && !directionKeys.includes(0)) {
        const facingAngle = ((thingObj.angle || 0) * Math.PI) / 180;
        const viewAngle = angle({ x: camera.pos[0] - thingObj.x, y: -camera.pos[2] - thingObj.y });
        const relative = (viewAngle - facingAngle + Math.PI * 2) % (Math.PI * 2);
        const targetDir = (Math.round(relative / (Math.PI / 4)) % 8) + 1;
        directionIndex = directionKeys.includes(targetDir)
          ? targetDir
          : directionKeys.reduce((prev, curr) =>
              Math.abs(curr - targetDir) < Math.abs(prev - targetDir) ? curr : prev,
            directionKeys[0]
          );
      }

      const spriteFrames = spriteObj[directionIndex] || spriteObj[0];
      if (!spriteFrames || spriteFrames.length === 0) {
        return;
      }

      const state = thingStates.get(thingObj);
      let frameIndex = (animateSpriteIndex + thingIndex) % spriteFrames.length;
      if (state && state.health > 0 && thingType?.kind === ThingKind.monster) {
        const aliveFrameCount = Math.min(4, spriteFrames.length);
        frameIndex = (animateSpriteIndex + thingIndex) % aliveFrameCount;
      } else if (state && state.health <= 0) {
        frameIndex = spriteFrames.length - 1;
      }
      const thingSprite = spriteFrames[frameIndex];
      if (state && state.health <= 0 && state.deadTime && now - state.deadTime > 1500) {
        return;
      }
      const hitFlash = state ? Math.max(0, 1 - (now - state.lastHitTime) / hitFlashDurationMs) : 0;
      const thingYPos = thingType.isFloater ? (thingSector.ceilingheight - thingSprite.sprite.height / 2) : (thingSector.floorheight + thingSprite.sprite.height / 2);

      mat4.identity(modelMatrix);
      mat4.translate(modelMatrix, modelMatrix, [thingObj.x, thingYPos, -thingObj.y]);
      mat4.rotateY(modelMatrix, modelMatrix, -thingAngle);
      mat4.scale(modelMatrix, modelMatrix, [1.0, thingSprite.sprite.height, thingSprite.sprite.width]);

      mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);
      mat4.multiply(modelViewProjMatrix, projectionMatrix, modelViewMatrix);

      shader.setUniforms({
        shouldMirror: thingSprite.mirror,
        modelViewProj: modelViewProjMatrix,
        tex: textures.things[thingSprite.sprite.name],
        lightIntensity: thingSector.lightIntensity,
        hitFlash
      });

      buffers.thing.indices.draw();
    });

    //scene transforms
    mat4.identity(modelMatrix);
    mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);
    mat4.multiply(modelViewProjMatrix, projectionMatrix, modelViewMatrix);

    //floor
    shader = shaders.flats;

    gl.useProgram(shader.program);

    shader.setUniforms({
      modelViewProj: modelViewProjMatrix
    });

    buffers.flats.forEach((flat) => {
      let flatName = flat.flatName;

      const animatedFlat = wad.animatedFlats[flatName];

      if (animatedFlat) {
        flatName = animatedFlat[animateFlatIndex % animatedFlat.length];
      }

      shader.setUniforms({
        tex: textures.flats[flatName],
        lightIntensity: flat.sector.lightIntensity
      });

      shader.setAttributes({
        aPosition: flat.position
      });

      flat.indices.draw();
    });

    //walls
    shader = shaders.walls;
    gl.useProgram(shader.program);

    shader.setUniforms({
      modelViewProj: modelViewProjMatrix
    });

    buffers.walls.forEach((wall) => {
      let textureName = wall.texName;

      const animatedTexture = wad.animatedTextures[textureName];

      if (animatedTexture) {
        textureName = animatedTexture[animateWallIndex % animatedTexture.length];
      }

      shader.setUniforms({
        tex: textures.walls[textureName],
        lightIntensity: wall.sector.lightIntensity,
        shouldClip: wadAssets.texturesByName[textureName].transparent
      });

      shader.setAttributes({
        aPosition: wall.position,
        aUv: wall.uv
      });

      wall.indices.draw();
    });

    //skys
    shader = shaders.sky,
      gl.useProgram(shader.program);

    shader.setUniforms({
      modelViewProj: modelViewProjMatrix
    });

    buffers.skys.forEach((sky) => {
      shader.setAttributes({
        aPosition: sky.position
      });

      sky.indices.draw();
    });
  };

  const renderer = createRenderer(() => {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    //gl.cullFace(gl.BACK);

    //camera transform
    updateViewMatrix();
  
    resizeScene();
  
    window.addEventListener('resize', () => {
      resizeScene();
    });

  }, (dt: number) => {
    time += dt;
  
    animateFlatIndex = Math.floor(time / (1000 / animatedFlatFps));
    animateWallIndex = Math.floor(time / (1000 / animatedWallFps));
    animateSpriteIndex = Math.floor(time / (1000 / animatedSpriteFps));
  
    updateLookFromKeys(dt);
    updatePlayerMovement(dt);
    updatePickups();
    updateEnemies(dt);
    updateHud();
  
    if (wad && map) {
      drawScene();
    }
  });
  
  renderer.start(window);

  return {
    loadWad,
    loadMap
  }
};
