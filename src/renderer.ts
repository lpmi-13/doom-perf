import { clamp, heat, mixColor, palette } from "./palette";
import type { LocationInfo, MovementInput, ResourceId, RoomKind, Telemetry } from "./types";

const W = 640;
const H = 400;
const FOV = Math.PI / 3;
const WORLD_W = 58;
const WORLD_H = 44;
const rng = (n: number) => Math.abs(Math.sin(n * 127.1) * 43758.5453) % 1;

interface LabRoom extends LocationInfo {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Fixture {
  x: number;
  y: number;
  kind: RoomKind | "door-sign" | "load-core";
  label: string;
  resource: ResourceId;
}

interface RayHit {
  dist: number;
  side: 0 | 1;
  hitX: number;
  hitY: number;
}

interface RenderState {
  automap: boolean;
}

const ROOMS: LabRoom[] = [
  {
    id: "atrium",
    title: "Kernel Atrium",
    wing: "Central Hub",
    resource: "atrium",
    kind: "atrium",
    subtitle: "The four resource wings meet here. Walk through a doorway to inspect a resource.",
    x1: 23,
    y1: 18,
    x2: 35,
    y2: 27
  },
  {
    id: "cpu-cores",
    title: "Core Chamber",
    wing: "CPU Wing",
    resource: "cpu",
    kind: "cpu-cores",
    subtitle: "Per-core utilization appears as dense columns of moving light.",
    x1: 14,
    y1: 3,
    x2: 27,
    y2: 12
  },
  {
    id: "cpu-scheduler",
    title: "Scheduler Gallery",
    wing: "CPU Wing",
    resource: "cpu",
    kind: "cpu-scheduler",
    subtitle: "Run queue pressure is shown as rising mist and a load pillar.",
    x1: 30,
    y1: 3,
    x2: 43,
    y2: 12
  },
  {
    id: "cpu-cache",
    title: "Topology Hall",
    wing: "CPU Wing",
    resource: "cpu",
    kind: "cpu-cache",
    subtitle: "Core topology and cache pressure are rendered as pulsing wall traces.",
    x1: 16,
    y1: 12,
    x2: 41,
    y2: 18
  },
  {
    id: "memory-reservoir",
    title: "Reservoir",
    wing: "Memory Wing",
    resource: "memory",
    kind: "memory-reservoir",
    subtitle: "Used memory raises the pool; page composition changes its color and particles.",
    x1: 3,
    y1: 12,
    x2: 14,
    y2: 21
  },
  {
    id: "memory-swap",
    title: "Swap Drain",
    wing: "Memory Wing",
    resource: "memory",
    kind: "memory-swap",
    subtitle: "Swap activity opens the drain and pulls page light into the floor.",
    x1: 3,
    y1: 24,
    x2: 14,
    y2: 33
  },
  {
    id: "memory-allocator",
    title: "Allocator Rings",
    wing: "Memory Wing",
    resource: "memory",
    kind: "memory-allocator",
    subtitle: "The allocator view separates cached, anonymous, dirty, and pinned memory.",
    x1: 14,
    y1: 13,
    x2: 22,
    y2: 32
  },
  {
    id: "storage-rotor",
    title: "Rotor Room",
    wing: "Storage Wing",
    resource: "storage",
    kind: "storage-rotor",
    subtitle: "Device utilization fills the rotor while read and write bands chase around it.",
    x1: 44,
    y1: 12,
    x2: 55,
    y2: 21
  },
  {
    id: "storage-latency",
    title: "Latency Floor",
    wing: "Storage Wing",
    resource: "storage",
    kind: "storage-latency",
    subtitle: "I/O latency expands as floor ripples and slow waves.",
    x1: 44,
    y1: 24,
    x2: 55,
    y2: 33
  },
  {
    id: "storage-device",
    title: "Queue Nest",
    wing: "Storage Wing",
    resource: "storage",
    kind: "storage-device",
    subtitle: "Outstanding requests orbit the device as queue rings.",
    x1: 35,
    y1: 13,
    x2: 44,
    y2: 32
  },
  {
    id: "network-conduits",
    title: "Conduits",
    wing: "Network Wing",
    resource: "network",
    kind: "network-conduits",
    subtitle: "Inbound and outbound packets flow through transparent pipes.",
    x1: 15,
    y1: 32,
    x2: 27,
    y2: 42
  },
  {
    id: "network-backlog",
    title: "Backlog Chamber",
    wing: "Network Wing",
    resource: "network",
    kind: "network-backlog",
    subtitle: "Queue saturation fills the vertical backlog pipe toward overflow.",
    x1: 30,
    y1: 32,
    x2: 42,
    y2: 42
  },
  {
    id: "network-connections",
    title: "Connection Weave",
    wing: "Network Wing",
    resource: "network",
    kind: "network-connections",
    subtitle: "Active sockets appear as vibrating connection threads.",
    x1: 16,
    y1: 27,
    x2: 41,
    y2: 32
  }
];

const CORRIDOR_LOCATIONS: LocationInfo[] = [
  {
    id: "cpu-passage",
    title: "CPU Passage",
    wing: "CPU Wing",
    resource: "cpu",
    kind: "corridor",
    subtitle: "This passage branches into core, scheduler, and topology rooms."
  },
  {
    id: "memory-passage",
    title: "Memory Passage",
    wing: "Memory Wing",
    resource: "memory",
    kind: "corridor",
    subtitle: "This passage branches into reservoir, swap, and allocator rooms."
  },
  {
    id: "storage-passage",
    title: "Storage Passage",
    wing: "Storage Wing",
    resource: "storage",
    kind: "corridor",
    subtitle: "This passage branches into rotor, queue, and latency rooms."
  },
  {
    id: "network-passage",
    title: "Network Passage",
    wing: "Network Wing",
    resource: "network",
    kind: "corridor",
    subtitle: "This passage branches into conduits, backlog, and connection rooms."
  }
];

const FIXTURES: Fixture[] = [
  { x: 28.5, y: 17.55, kind: "door-sign", label: "CPU", resource: "cpu" },
  { x: 22.45, y: 22.5, kind: "door-sign", label: "MEM", resource: "memory" },
  { x: 35.55, y: 22.5, kind: "door-sign", label: "DSK", resource: "storage" },
  { x: 28.5, y: 27.45, kind: "door-sign", label: "NET", resource: "network" },
  { x: 28.5, y: 22.4, kind: "load-core", label: "LOAD", resource: "atrium" },
  { x: 20.5, y: 7.2, kind: "cpu-cores", label: "CORES", resource: "cpu" },
  { x: 36.5, y: 7.2, kind: "cpu-scheduler", label: "RUNQ", resource: "cpu" },
  { x: 28.5, y: 15.2, kind: "cpu-cache", label: "CACHE", resource: "cpu" },
  { x: 8.4, y: 16.4, kind: "memory-reservoir", label: "POOL", resource: "memory" },
  { x: 8.4, y: 28.4, kind: "memory-swap", label: "SWAP", resource: "memory" },
  { x: 18.0, y: 22.5, kind: "memory-allocator", label: "ALLOC", resource: "memory" },
  { x: 49.5, y: 16.5, kind: "storage-rotor", label: "ROTOR", resource: "storage" },
  { x: 39.2, y: 22.5, kind: "storage-device", label: "QUEUE", resource: "storage" },
  { x: 49.5, y: 28.5, kind: "storage-latency", label: "LAT", resource: "storage" },
  { x: 21.0, y: 37.0, kind: "network-conduits", label: "PIPES", resource: "network" },
  { x: 36.0, y: 37.0, kind: "network-backlog", label: "BACKLOG", resource: "network" },
  { x: 28.5, y: 29.4, kind: "network-connections", label: "SOCKETS", resource: "network" }
];

function buildWorld() {
  const grid = Array.from({ length: WORLD_H }, () => Array.from({ length: WORLD_W }, () => "#"));
  const carveRect = (x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y < y2; y += 1) {
      for (let x = x1; x < x2; x += 1) grid[y][x] = ".";
    }
  };

  for (const room of ROOMS) carveRect(room.x1, room.y1, room.x2, room.y2);
  carveRect(27, 11, 31, 19);
  carveRect(13, 20, 24, 24);
  carveRect(34, 20, 45, 24);
  carveRect(27, 26, 31, 33);
  carveRect(22, 21, 36, 25);

  for (let x = 0; x < WORLD_W; x += 1) {
    grid[0][x] = "#";
    grid[WORLD_H - 1][x] = "#";
  }
  for (let y = 0; y < WORLD_H; y += 1) {
    grid[y][0] = "#";
    grid[y][WORLD_W - 1] = "#";
  }
  return grid.map((row) => row.join(""));
}

const WORLD = buildWorld();

function normalizeAngle(angle: number) {
  while (angle < -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function resourceTint(resource: ResourceId) {
  if (resource === "cpu") return "#245c86";
  if (resource === "memory") return "#176b74";
  if (resource === "storage") return "#7a4720";
  if (resource === "network") return "#226f54";
  return "#55364f";
}

function resourceAccent(resource: ResourceId) {
  if (resource === "cpu") return palette.cyan;
  if (resource === "memory") return palette.blue;
  if (resource === "storage") return palette.orange;
  if (resource === "network") return palette.green;
  return palette.hot;
}

export class DoomRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private telemetry: Telemetry | null = null;
  private startedAt = performance.now();
  private player = { x: 28.5, y: 22.5, angle: -Math.PI / 2 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.canvas.width = W;
    this.canvas.height = H;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
  }

  setTelemetry(telemetry: Telemetry) {
    this.telemetry = telemetry;
  }

  reset(facing: ResourceId = "cpu") {
    this.player.x = 28.5;
    this.player.y = 22.5;
    this.player.angle = facing === "memory" ? Math.PI : facing === "storage" ? 0 : facing === "network" ? Math.PI / 2 : -Math.PI / 2;
  }

  teleportTo(resource: ResourceId) {
    const starts: Record<ResourceId, { x: number; y: number; angle: number }> = {
      atrium: { x: 28.5, y: 22.5, angle: -Math.PI / 2 },
      cpu: { x: 28.5, y: 17.0, angle: -Math.PI / 2 },
      memory: { x: 21.0, y: 22.0, angle: Math.PI },
      storage: { x: 36.8, y: 22.0, angle: 0 },
      network: { x: 28.5, y: 28.2, angle: Math.PI / 2 }
    };
    this.player = { ...starts[resource] };
  }

  update(input: MovementInput, dt: number) {
    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
    const speed = input.run ? 5.2 : 3.0;
    const move = ((input.forward ? 1 : 0) - (input.backward ? 1 : 0)) * speed * dt;
    const strafe = ((input.strafeRight ? 1 : 0) - (input.strafeLeft ? 1 : 0)) * speed * dt;
    this.player.angle = normalizeAngle(this.player.angle + turn * 2.4 * dt);

    const dx = Math.cos(this.player.angle) * move + Math.cos(this.player.angle + Math.PI / 2) * strafe;
    const dy = Math.sin(this.player.angle) * move + Math.sin(this.player.angle + Math.PI / 2) * strafe;
    this.tryMove(dx, dy);
  }

  getLocation(): LocationInfo {
    const room = ROOMS.find((candidate) => this.player.x >= candidate.x1 && this.player.x < candidate.x2 && this.player.y >= candidate.y1 && this.player.y < candidate.y2);
    if (room) return room;
    if (this.player.y < 18 && this.player.x >= 27 && this.player.x <= 31) return CORRIDOR_LOCATIONS[0];
    if (this.player.x < 23 && this.player.y >= 18 && this.player.y <= 25) return CORRIDOR_LOCATIONS[1];
    if (this.player.x > 34 && this.player.y >= 18 && this.player.y <= 25) return CORRIDOR_LOCATIONS[2];
    if (this.player.y > 26 && this.player.x >= 27 && this.player.x <= 31) return CORRIDOR_LOCATIONS[3];
    return ROOMS[0];
  }

  render(view: RenderState) {
    const ctx = this.ctx;
    const t = (performance.now() - this.startedAt) / 1000;
    const location = this.getLocation();
    ctx.clearRect(0, 0, W, H);
    this.drawSkyAndFloor(location);
    this.drawWalls(location);
    this.drawFixtures(t);
    this.drawRoomBadge(location);
    this.vignette();
    if (view.automap) this.automap(location);
    if (!this.telemetry) this.centerText("waiting for telemetry", 94, palette.dim);
  }

  private tryMove(dx: number, dy: number) {
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (this.canOccupy(nx, this.player.y)) this.player.x = nx;
    if (this.canOccupy(this.player.x, ny)) this.player.y = ny;
  }

  private canOccupy(x: number, y: number) {
    const r = 0.18;
    return this.isOpen(x - r, y - r) && this.isOpen(x + r, y - r) && this.isOpen(x - r, y + r) && this.isOpen(x + r, y + r);
  }

  private isOpen(x: number, y: number) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return ty >= 0 && ty < WORLD_H && tx >= 0 && tx < WORLD_W && WORLD[ty][tx] !== "#";
  }

  private drawSkyAndFloor(location: LocationInfo) {
    const ctx = this.ctx;
    const tint = resourceTint(location.resource);
    const ceiling = mixColor("#15121d", tint, 0.64);
    const floor = mixColor("#231815", tint, 0.66);
    ctx.fillStyle = ceiling;
    ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = floor;
    ctx.fillRect(0, H / 2, W, H / 2);
    ctx.fillStyle = "rgba(255, 232, 170, 0.055)";
    for (let y = H / 2 + 10; y < H; y += 18) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = "rgba(255, 232, 170, 0.045)";
    for (let y = 12; y < H / 2; y += 18) ctx.fillRect(0, y, W, 1);
  }

  private drawWalls(location: LocationInfo) {
    const ctx = this.ctx;
    const base = resourceTint(location.resource);
    for (let x = 0; x < W; x += 1) {
      const rayAngle = this.player.angle - FOV / 2 + (x / W) * FOV;
      const hit = this.castRay(rayAngle);
      const corrected = Math.max(0.001, hit.dist * Math.cos(rayAngle - this.player.angle));
      const wallH = Math.min(H * 1.32, H / corrected * 0.64);
      const y1 = H * 0.54 - wallH * 0.56;
      const shade = clamp(1.1 - corrected / 22, 0.22, 1);
      const litWall = mixColor(base, palette.hot, hit.side === 1 ? 0.16 : 0.25);
      const wallColor = mixColor(mixColor(base, "#2a2230", 0.25), litWall, shade);
      ctx.fillStyle = wallColor;
      ctx.fillRect(x, y1, 1, wallH);
      if ((Math.floor((hit.hitX + hit.hitY) * 2) + x) % 7 === 0) {
        ctx.fillStyle = "rgba(255, 238, 191, 0.18)";
        ctx.fillRect(x, y1, 1, wallH);
      }
    }
  }

  private castRay(angle: number): RayHit {
    const rayX = Math.cos(angle);
    const rayY = Math.sin(angle);
    let mapX = Math.floor(this.player.x);
    let mapY = Math.floor(this.player.y);
    const deltaX = Math.abs(1 / (Math.abs(rayX) < 0.0001 ? 0.0001 : rayX));
    const deltaY = Math.abs(1 / (Math.abs(rayY) < 0.0001 ? 0.0001 : rayY));
    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideDistX = rayX < 0 ? (this.player.x - mapX) * deltaX : (mapX + 1 - this.player.x) * deltaX;
    let sideDistY = rayY < 0 ? (this.player.y - mapY) * deltaY : (mapY + 1 - this.player.y) * deltaY;
    let side: 0 | 1 = 0;

    for (let i = 0; i < 90; i += 1) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= WORLD_W || mapY >= WORLD_H || WORLD[mapY][mapX] === "#") break;
    }

    const dist = side === 0 ? (mapX - this.player.x + (1 - stepX) / 2) / rayX : (mapY - this.player.y + (1 - stepY) / 2) / rayY;
    return {
      dist: Math.max(0.02, dist),
      side,
      hitX: this.player.x + rayX * dist,
      hitY: this.player.y + rayY * dist
    };
  }

  private drawFixtures(t: number) {
    const visible = FIXTURES.map((fixture) => {
      const dx = fixture.x - this.player.x;
      const dy = fixture.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      const angle = normalizeAngle(Math.atan2(dy, dx) - this.player.angle);
      return { fixture, dist, angle };
    })
      .filter((item) => item.dist > 0.35 && item.dist < 18 && Math.abs(item.angle) < FOV * 0.62 && this.hasLineOfSight(item.fixture.x, item.fixture.y))
      .sort((a, b) => b.dist - a.dist);

    for (const item of visible) {
      const screenX = W / 2 + (item.angle / (FOV / 2)) * (W / 2);
      const size = clamp((H * 0.46) / item.dist, H * 0.06, H * 0.43);
      const baseY = H / 2 + size * 0.56;
      this.drawFixture(item.fixture, screenX, baseY, size, t, item.dist);
    }
  }

  private hasLineOfSight(x: number, y: number) {
    const dx = x - this.player.x;
    const dy = y - this.player.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(dist / 0.16));
    for (let i = 1; i < steps; i += 1) {
      const px = this.player.x + (dx * i) / steps;
      const py = this.player.y + (dy * i) / steps;
      if (!this.isOpen(px, py)) return false;
    }
    return true;
  }

  private drawFixture(fixture: Fixture, x: number, y: number, size: number, t: number, dist: number) {
    if (fixture.kind === "door-sign") return this.drawDoorSign(fixture, x, y, size);
    if (fixture.kind === "load-core") return this.drawLoadCore(x, y, size);
    if (fixture.kind === "cpu-cores") return this.drawCoreColumns(x, y, size, t);
    if (fixture.kind === "cpu-scheduler") return this.drawScheduler(x, y, size, t);
    if (fixture.kind === "cpu-cache") return this.drawCache(x, y, size, t);
    if (fixture.kind === "memory-reservoir") return this.drawReservoir(x, y, size, t);
    if (fixture.kind === "memory-swap") return this.drawSwapDrain(x, y, size, t);
    if (fixture.kind === "memory-allocator") return this.drawAllocator(x, y, size, t);
    if (fixture.kind === "storage-rotor") return this.drawRotor(x, y, size, t);
    if (fixture.kind === "storage-latency") return this.drawLatencyRipples(x, y, size, t);
    if (fixture.kind === "storage-device") return this.drawQueueNest(x, y, size, t);
    if (fixture.kind === "network-conduits") return this.drawConduits(x, y, size, t);
    if (fixture.kind === "network-backlog") return this.drawBacklogPipe(x, y, size);
    if (fixture.kind === "network-connections") return this.drawConnectionWeave(x, y, size, t);
    this.pixelText(fixture.label, x - size / 2, y, palette.ink, clamp(1 - dist / 18));
  }

  private drawDoorSign(fixture: Fixture, x: number, y: number, size: number) {
    const ctx = this.ctx;
    const m = this.telemetry;
    const value = fixture.resource === "cpu" ? m?.cpu.utilization ?? 0 : fixture.resource === "memory" ? m?.memory.utilization ?? 0 : fixture.resource === "storage" ? m?.storage.utilization ?? 0 : m?.network.utilization ?? 0;
    const w = size * 1.35;
    const h = size * 0.52;
    ctx.fillStyle = "rgba(5, 5, 7, 0.76)";
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.strokeStyle = heat(value);
    ctx.strokeRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = heat(value);
    ctx.fillRect(x - w / 2 + 3, y - h + 4, Math.max(2, (w - 6) * value), 3);
    this.pixelText(fixture.label, x - fixture.label.length * 3, y - h + 17, palette.ink);
  }

  private drawLoadCore(x: number, y: number, size: number) {
    const load = clamp((this.telemetry?.cpu.load1 ?? 0) / Math.max(1, (this.telemetry?.cpu.cores ?? 1) * 1.5));
    this.obelisk(x, y, size * 0.28, size, load, heat(load));
  }

  private drawCoreColumns(x: number, y: number, size: number, t: number) {
    const cores = this.telemetry?.cpu.coreMetrics.slice(0, 10) ?? [];
    const spacing = size / Math.max(5, cores.length);
    cores.forEach((core, i) => {
      const cx = x - size * 0.45 + i * spacing + spacing / 2;
      const h = size * (0.62 + core.utilization * 0.42);
      const threads = 3 + Math.floor(core.utilization * 8);
      for (let j = 0; j < threads; j += 1) {
        const dx = (rng(i * 11 + j) - 0.5) * spacing * (0.4 + core.saturation);
        const phase = (t * (22 + core.frequency * 18) + j * 8) % h;
        this.line(cx + dx, y - phase, cx + dx * 0.8, y - h + phase * 0.1, heat(core.utilization), 0.22 + core.utilization * 0.65);
      }
      this.glowEllipse(cx, y + 2, spacing * (0.28 + core.saturation * 0.45), size * 0.05, heat(core.utilization), 0.22 + core.saturation * 0.4);
    });
    this.label(x, y + size * 0.18, "CORE LIGHT");
  }

  private drawScheduler(x: number, y: number, size: number, t: number) {
    const cpu = this.telemetry?.cpu;
    const sat = clamp(cpu?.saturation ?? 0);
    this.pool(x - size * 0.5, y - size * (0.2 + sat * 0.35), size, size * (0.2 + sat * 0.35), mixColor(palette.blue, palette.orange, sat), 0.25 + sat * 0.35);
    this.obelisk(x, y + size * 0.05, size * 0.28, size * 0.85, clamp((cpu?.load1 ?? 0) / Math.max(1, (cpu?.cores ?? 1) * 1.8)), heat(sat));
    for (let i = 0; i < Math.floor(3 + sat * 18); i += 1) {
      this.rect(x - size * 0.45 + rng(i) * size, y - size * 0.12 - ((t * 8 + i * 5) % (size * 0.55)), 2, 2, palette.hot, 0.28 + sat * 0.4);
    }
    this.label(x, y + size * 0.18, "RUN QUEUE");
  }

  private drawCache(x: number, y: number, size: number, t: number) {
    const sat = clamp(this.telemetry?.cpu.saturation ?? 0);
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(242, 231, 204, 0.18)";
    ctx.strokeRect(x - size * 0.5, y - size * 0.7, size, size * 0.58);
    for (let i = 0; i < 10; i += 1) {
      const y1 = y - size * 0.62 + (i / 10) * size * 0.44;
      this.line(x - size * 0.42, y1, x + size * 0.42, y1 + Math.sin(t * 3 + i) * size * 0.04, i % 3 === 0 ? heat(sat) : palette.cyan, 0.2 + sat * 0.32);
    }
    this.label(x, y + size * 0.03, "TOPOLOGY");
  }

  private drawReservoir(x: number, y: number, size: number, t: number) {
    const memory = this.telemetry?.memory;
    const util = clamp(memory?.utilization ?? 0);
    const color = mixColor(palette.blue, palette.orange, memory?.composition.anonymous ?? 0.2);
    const top = y - size * (0.18 + util * 0.58);
    this.pool(x - size * 0.5, top, size, y - top, color, 0.42);
    for (let i = 0; i < 44; i += 1) {
      const px = x - size * 0.45 + rng(i) * size * 0.9;
      const py = top + ((rng(i + 5) * size + t * (2 + util * 10)) % Math.max(8, y - top));
      const kind = rng(i + 19);
      const particle = kind < (memory?.composition.dirty ?? 0) ? palette.orange : kind < (memory?.composition.pinned ?? 0) + 0.08 ? palette.red : palette.cyan;
      this.rect(px, py, 2, 2, particle, 0.52);
    }
    this.label(x, y + size * 0.15, "RESERVOIR");
  }

  private drawSwapDrain(x: number, y: number, size: number, t: number) {
    const active = clamp((this.telemetry?.memory.swapRate ?? 0) / 70);
    this.strokeEllipse(x, y - size * 0.25, size * (0.23 + active * 0.16), size * (0.08 + active * 0.06), mixColor(palette.blue, palette.red, active), 0.38 + active * 0.5);
    for (let i = 0; i < 18; i += 1) {
      const a = t * (1 + active * 5) + i * 0.7;
      const r = (i / 18) * size * (0.34 + active * 0.22);
      this.rect(x + Math.cos(a) * r, y - size * 0.25 + Math.sin(a) * r * 0.35, 2, 2, palette.hot, 0.2 + active * 0.55);
    }
    this.label(x, y + size * 0.08, "SWAP DRAIN");
  }

  private drawAllocator(x: number, y: number, size: number, t: number) {
    const comp = this.telemetry?.memory.composition;
    const values = [comp?.cached ?? 0, comp?.anonymous ?? 0, comp?.dirty ?? 0, comp?.pinned ?? 0];
    const colors = [palette.blue, palette.orange, palette.yellow, palette.red];
    values.forEach((value, i) => {
      this.strokeEllipse(x, y - size * 0.45 + i * size * 0.13, size * (0.15 + value * 0.38), size * 0.045, colors[i], 0.35 + value * 0.5);
    });
    for (let i = 0; i < 10; i += 1) {
      this.line(x - size * 0.42, y - size * 0.58 + i * 4, x + size * 0.42, y - size * 0.55 + Math.sin(t + i) * 5 + i * 4, palette.cyan, 0.12);
    }
    this.label(x, y + size * 0.08, "ALLOCATOR");
  }

  private drawRotor(x: number, y: number, size: number, t: number) {
    const storage = this.telemetry?.storage;
    const util = clamp(storage?.utilization ?? 0);
    const mix = clamp((storage?.writeMbps ?? 0) / Math.max(1, (storage?.readMbps ?? 0) + (storage?.writeMbps ?? 0)));
    const color = mixColor(palette.blue, palette.orange, mix);
    const rx = size * 0.5;
    const ry = size * 0.19;
    this.strokeEllipse(x, y - size * 0.34, rx, ry, palette.wallDark, 0.9);
    for (let i = 0; i < 10; i += 1) {
      const f = (i + 1) / 10;
      this.strokeEllipse(x, y - size * 0.34, rx * f, ry * f, f <= util ? color : "#111014", f <= util ? 0.24 + util * 0.3 : 0.5);
    }
    for (let i = 0; i < 9; i += 1) {
      const a = t * (1 + util * 5) + (i / 9) * Math.PI * 2;
      this.line(x, y - size * 0.34, x + Math.cos(a) * rx * util, y - size * 0.34 + Math.sin(a) * ry * util, color, 0.22 + util * 0.42);
    }
    this.label(x, y + size * 0.02, "UTIL ROTOR");
  }

  private drawLatencyRipples(x: number, y: number, size: number, t: number) {
    const awaitMs = this.telemetry?.storage.awaitMs ?? 0;
    const severity = clamp(awaitMs / 220);
    for (let i = 0; i < 8; i += 1) {
      const phase = ((t * (12 - severity * 7) + i * 16) % 70) / 70;
      this.strokeEllipse(x, y - size * 0.28, size * phase * 0.65, size * phase * 0.18, heat(severity), 0.12 + severity * 0.25);
    }
    this.label(x, y + size * 0.08, `${Math.round(awaitMs)}MS WAVES`);
  }

  private drawQueueNest(x: number, y: number, size: number, t: number) {
    const storage = this.telemetry?.storage;
    const queue = Math.min(18, Math.ceil(storage?.queueDepth ?? 0));
    const severity = clamp((storage?.saturation ?? 0) + (storage?.awaitMs ?? 0) / 260);
    for (let i = 0; i < Math.max(2, queue); i += 1) {
      const rx = size * (0.16 + i * 0.025 + severity * 0.12);
      const ry = rx * 0.38;
      this.strokeEllipse(x, y - size * 0.34 + Math.sin(t * 2 + i) * 2, rx, ry, heat(severity), 0.12 + severity * 0.08);
    }
    this.label(x, y + size * 0.04, `${queue} QUEUE RINGS`);
  }

  private drawConduits(x: number, y: number, size: number, t: number) {
    const util = clamp(this.telemetry?.network.utilization ?? 0);
    this.pipe(x - size * 0.48, y - size * 0.55, size * 0.96, size * 0.13, palette.blue, util, t, 1);
    this.pipe(x - size * 0.48, y - size * 0.32, size * 0.96, size * 0.13, palette.orange, util * 0.82, t, -1);
    this.label(x, y + size * 0.02, "PACKET PIPES");
  }

  private drawBacklogPipe(x: number, y: number, size: number) {
    const sat = clamp(this.telemetry?.network.saturation ?? 0);
    const ctx = this.ctx;
    const w = size * 0.22;
    const h = size * 0.78;
    ctx.strokeStyle = "rgba(242, 231, 204, 0.34)";
    ctx.strokeRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = heat(sat);
    ctx.globalAlpha = 0.35 + sat * 0.5;
    ctx.fillRect(x - w / 2 + 3, y - h * sat, w - 6, h * sat);
    ctx.globalAlpha = 1;
    this.label(x, y + size * 0.08, "BACKLOG");
  }

  private drawConnectionWeave(x: number, y: number, size: number, t: number) {
    const net = this.telemetry?.network;
    const util = clamp(net?.utilization ?? 0);
    const drops = clamp((net?.dropsRate ?? 0) / 100);
    const threads = 8 + Math.floor(util * 22);
    for (let i = 0; i < threads; i += 1) {
      const y1 = y - size * 0.68 + rng(i) * size * 0.52;
      const color = rng(i + 4) < drops ? palette.red : rng(i + 8) < (net?.retransRate ?? 0) / 60 ? palette.yellow : palette.green;
      this.line(x - size * 0.48, y1, x + size * 0.48, y1 + Math.sin(t * 4 + i) * size * 0.04, color, 0.2 + util * 0.36);
    }
    this.label(x, y + size * 0.03, "SOCKET WEAVE");
  }

  private pipe(x: number, y: number, w: number, h: number, color: string, density: number, t: number, direction: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(210, 226, 205, 0.08)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(242, 231, 204, 0.22)";
    ctx.strokeRect(x, y, w, h);
    const count = 6 + Math.floor(density * 34);
    for (let i = 0; i < count; i += 1) {
      const px = x + ((rng(i) * w + t * direction * (14 + density * 70) + w * 2) % w);
      this.rect(px, y + 3 + rng(i + 4) * Math.max(1, h - 6), Math.max(2, w * 0.025), 2, color, 0.35 + density * 0.45);
    }
  }

  private drawRoomBadge(location: LocationInfo) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(5, 5, 7, 0.62)";
    ctx.fillRect(8, H - 28, 160, 20);
    ctx.strokeStyle = "rgba(242, 231, 204, 0.16)";
    ctx.strokeRect(8, H - 28, 160, 20);
    this.pixelText(location.wing.toUpperCase(), 14, H - 18, resourceAccent(location.resource));
    this.pixelText(location.title, 82, H - 18, palette.ink);
  }

  private automap(location: LocationInfo) {
    const ctx = this.ctx;
    const scale = 4;
    const ox = 16;
    const oy = 16;
    ctx.fillStyle = "rgba(5, 5, 7, 0.84)";
    ctx.fillRect(ox - 4, oy - 4, WORLD_W * scale + 8, WORLD_H * scale + 8);
    for (let y = 0; y < WORLD_H; y += 1) {
      for (let x = 0; x < WORLD_W; x += 1) {
        if (WORLD[y][x] === "#") {
          ctx.fillStyle = "#31252a";
          ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
        }
      }
    }
    for (const room of ROOMS) {
      ctx.fillStyle = room.id === location.id ? resourceAccent(room.resource) : mixColor(resourceTint(room.resource), resourceAccent(room.resource), 0.32);
      ctx.globalAlpha = room.id === location.id ? 0.95 : 0.42;
      ctx.fillRect(ox + room.x1 * scale, oy + room.y1 * scale, (room.x2 - room.x1) * scale, (room.y2 - room.y1) * scale);
    }
    ctx.globalAlpha = 1;
    const px = ox + this.player.x * scale;
    const py = oy + this.player.y * scale;
    ctx.fillStyle = palette.hot;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(this.player.angle) * 5, py + Math.sin(this.player.angle) * 5);
    ctx.lineTo(px + Math.cos(this.player.angle + 2.45) * 4, py + Math.sin(this.player.angle + 2.45) * 4);
    ctx.lineTo(px + Math.cos(this.player.angle - 2.45) * 4, py + Math.sin(this.player.angle - 2.45) * 4);
    ctx.closePath();
    ctx.fill();
    this.pixelText("TAB MAP", ox + 6, oy + WORLD_H * scale - 5, palette.dim);
  }

  private obelisk(x: number, y: number, w: number, h: number, fill: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = palette.wallDark;
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.28 + fill * 0.6;
    ctx.fillRect(x - w / 2 + 3, y - h * fill, Math.max(1, w - 6), h * fill);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.wallLight;
    ctx.strokeRect(x - w / 2, y - h, w, h);
  }

  private pool(x: number, y: number, w: number, h: number, color: string, alpha: number) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(242, 231, 204, 0.18)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + w * 0.25, y - 4, x + w * 0.6, y + 4, x + w, y);
    ctx.stroke();
  }

  private label(x: number, y: number, text: string) {
    this.pixelText(text, x - text.length * 3, y, palette.ink);
  }

  private vignette() {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.72);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }

  private centerText(text: string, y: number, color: string) {
    this.pixelText(text, W / 2 - text.length * 3, y, color);
  }

  private pixelText(text: string, x: number, y: number, color: string, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.font = "7px monospace";
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillText(text, Math.round(x) + 1, Math.round(y) + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(x), Math.round(y));
    ctx.globalAlpha = 1;
  }

  private line(x1: number, y1: number, x2: number, y2: number, color: string, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private rect(x: number, y: number, w: number, h: number, color: string, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    ctx.globalAlpha = 1;
  }

  private glowEllipse(x: number, y: number, rx: number, ry: number, color: string, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private strokeEllipse(x: number, y: number, rx: number, ry: number, color: string, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
