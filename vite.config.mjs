import { defineConfig } from "vite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SCENARIO_NAMES = new Set(["cpu", "memory", "storage", "network", "local"]);
const HZ = 100;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function wave(t, phase = 0, speed = 1) {
  return (Math.sin(t * speed + phase) + 1) / 2;
}

function processName(seed) {
  const names = [
    "compiler-worker",
    "postgres",
    "node",
    "renderer",
    "backup",
    "nginx",
    "indexer",
    "streamer"
  ];
  return names[seed % names.length];
}

function simulatedProcesses(resource, t) {
  return Array.from({ length: 7 }, (_, i) => {
    const focus = i === 0 ? 0.86 + wave(t, i, 2) * 0.12 : 0.08 + wave(t, i, 1.1) * 0.25;
    const base = {
      pid: 3200 + i * 41,
      name: i === 0 ? `${resource}-pressure` : processName(i),
      cpu: resource === "cpu" ? focus : 0.04 + wave(t, i, 0.7) * 0.18,
      memory: resource === "memory" ? focus : 0.03 + wave(t, i + 1, 0.6) * 0.16,
      io: resource === "storage" ? focus : 0.02 + wave(t, i + 2, 0.9) * 0.14,
      network: resource === "network" ? focus : 0.02 + wave(t, i + 3, 0.8) * 0.12,
      fd: 0.1 + wave(t, i + 4, 0.5) * 0.5,
      resource
    };
    return base;
  }).sort((a, b) => {
    const key = resource === "cpu" ? "cpu" : resource === "memory" ? "memory" : resource === "storage" ? "io" : "network";
    return b[key] - a[key];
  });
}

function makeScenarioTelemetry(scenario, count) {
  const t = Date.now() / 1000;
  const cores = 8;
  const cpuHot = scenario === "cpu";
  const memoryHot = scenario === "memory";
  const storageHot = scenario === "storage";
  const networkHot = scenario === "network";
  const cpuUtil = cpuHot ? 0.82 + wave(t, 0, 1.7) * 0.16 : 0.24 + wave(t, 0, 0.5) * 0.18;
  const memoryUtil = memoryHot ? 0.84 + wave(t, 1, 1.2) * 0.12 : 0.42 + wave(t, 1, 0.3) * 0.15;
  const storageUtil = storageHot ? 0.88 + wave(t, 2, 1.4) * 0.1 : 0.18 + wave(t, 2, 0.4) * 0.24;
  const networkUtil = networkHot ? 0.8 + wave(t, 3, 1.6) * 0.16 : 0.08 + wave(t, 3, 0.5) * 0.24;
  const coreMetrics = Array.from({ length: cores }, (_, id) => {
    const localHot = cpuHot && (id === count % cores || id === (count + 1) % cores);
    const util = clamp((localHot ? 0.86 : cpuUtil * (0.65 + wave(t, id, 0.8) * 0.45)));
    return {
      id,
      utilization: util,
      saturation: clamp(cpuHot ? 0.18 + wave(t, id, 1.3) * 0.58 : Math.max(0, util - 0.82) * 1.8),
      frequency: cpuHot ? 0.8 + wave(t, id, 1.9) * 0.2 : 0.35 + util * 0.55
    };
  });
  const metrics = {
    scenario,
    mode: "simulation",
    timestamp: Date.now(),
    host: os.hostname(),
    health: clamp(1 - Math.max(cpuUtil, memoryUtil, storageUtil, networkUtil) * 0.78),
    cpu: {
      utilization: cpuUtil,
      saturation: cpuHot ? 0.76 + wave(t, 4, 2) * 0.2 : 0.08 + wave(t, 4, 0.5) * 0.12,
      errors: 0,
      cores,
      load1: cpuHot ? cores * (1.4 + wave(t, 5, 1.5) * 0.6) : cores * cpuUtil * 0.75,
      contextSwitchRate: cpuHot ? 18000 + wave(t, 2, 2) * 9000 : 1500 + wave(t, 2, 1) * 2400,
      coreMetrics
    },
    memory: {
      utilization: memoryUtil,
      saturation: memoryHot ? 0.72 + wave(t, 6, 1.2) * 0.24 : 0.04 + wave(t, 6, 0.6) * 0.16,
      errors: memoryHot ? 0.08 * wave(t, 5, 0.8) : 0,
      totalGb: 32,
      usedGb: 32 * memoryUtil,
      availableGb: 32 * (1 - memoryUtil),
      swapRate: memoryHot ? 24 + wave(t, 8, 1.8) * 52 : 0,
      composition: {
        cached: memoryHot ? 0.14 : 0.42,
        anonymous: memoryHot ? 0.72 : 0.38,
        dirty: memoryHot ? 0.09 : 0.03,
        pinned: memoryHot ? 0.05 : 0.02
      }
    },
    storage: {
      utilization: storageUtil,
      saturation: storageHot ? 0.78 + wave(t, 9, 1.3) * 0.2 : 0.08 + wave(t, 9, 0.6) * 0.12,
      errors: storageHot ? 0.05 * wave(t, 2, 0.7) : 0,
      queueDepth: storageHot ? 16 + wave(t, 10, 1.4) * 18 : wave(t, 10, 0.5) * 2,
      awaitMs: storageHot ? 82 + wave(t, 11, 1.7) * 160 : 2 + wave(t, 11, 0.7) * 8,
      readMbps: storageHot ? 220 + wave(t, 13, 1.3) * 180 : 18 + wave(t, 12, 0.6) * 52,
      writeMbps: storageHot ? 340 + wave(t, 14, 1.2) * 280 : 12 + wave(t, 13, 0.5) * 40,
      devices: [
        {
          name: storageHot ? "sdb" : "nvme0n1",
          utilization: storageUtil,
          queueDepth: storageHot ? 22 : 1.3,
          awaitMs: storageHot ? 155 : 4.2,
          errors: storageHot ? 2 : 0
        }
      ]
    },
    network: {
      utilization: networkUtil,
      saturation: networkHot ? 0.7 + wave(t, 15, 1.4) * 0.24 : 0.05 + wave(t, 15, 0.5) * 0.14,
      errors: networkHot ? 0.14 + wave(t, 16, 1.8) * 0.1 : 0,
      rxMbps: networkHot ? 650 + wave(t, 17, 1.1) * 250 : 6 + wave(t, 17, 0.7) * 38,
      txMbps: networkHot ? 420 + wave(t, 18, 1.3) * 320 : 4 + wave(t, 18, 0.6) * 28,
      dropsRate: networkHot ? 20 + wave(t, 19, 2) * 90 : 0,
      retransRate: networkHot ? 8 + wave(t, 20, 1.6) * 25 : 0,
      interfaces: [
        {
          name: "eth0",
          utilization: networkUtil,
          rxMbps: networkHot ? 760 : 18,
          txMbps: networkHot ? 540 : 11,
          dropsRate: networkHot ? 52 : 0
        }
      ]
    },
    processes: simulatedProcesses(scenario, t)
  };
  return metrics;
}

function parseKeyValueFile(text) {
  const values = new Map();
  for (const line of text.split("\n")) {
    const match = /^([^:]+):\s+(\d+)/.exec(line);
    if (match) values.set(match[1], Number(match[2]));
  }
  return values;
}

function parseProcStat(text) {
  const cpus = [];
  let ctxt = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("cpu")) {
      const fields = line.trim().split(/\s+/);
      if (!/^cpu\d*$/.test(fields[0])) continue;
      const nums = fields.slice(1).map(Number);
      const idle = (nums[3] || 0) + (nums[4] || 0);
      const total = nums.reduce((sum, n) => sum + n, 0);
      cpus.push({ name: fields[0], total, idle });
    } else if (line.startsWith("ctxt ")) {
      ctxt = Number(line.split(/\s+/)[1]) || 0;
    }
  }
  return { cpus, ctxt };
}

async function readText(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function deltaRate(current, previous, seconds) {
  if (previous === undefined || seconds <= 0) return 0;
  return Math.max(0, (current - previous) / seconds);
}

function cpuUsage(current, previous) {
  if (!previous) return 0.2;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  return total > 0 ? clamp(1 - idle / total) : 0;
}

function parseDiskstats(text) {
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 14)
    .map((fields) => ({
      name: fields[2],
      reads: Number(fields[3]),
      readSectors: Number(fields[5]),
      readMs: Number(fields[6]),
      writes: Number(fields[7]),
      writeSectors: Number(fields[9]),
      writeMs: Number(fields[10]),
      inProgress: Number(fields[11]),
      ioMs: Number(fields[12]),
      weightedIoMs: Number(fields[13])
    }))
    .filter((d) => !/^(loop|ram|fd|sr|dm-|md|zram)/.test(d.name));
}

function parseNetdev(text) {
  return text
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [namePart, rest] = line.split(":");
      const fields = rest.trim().split(/\s+/).map(Number);
      return {
        name: namePart.trim(),
        rxBytes: fields[0] || 0,
        rxDrops: fields[3] || 0,
        rxErrors: fields[2] || 0,
        txBytes: fields[8] || 0,
        txErrors: fields[10] || 0,
        txDrops: fields[11] || 0
      };
    })
    .filter((iface) => iface.name !== "lo");
}

async function processSnapshot(previousProcessTicks, totalCpuTicks) {
  let entries = [];
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return [];
  }
  const pids = entries.filter((entry) => /^\d+$/.test(entry)).slice(0, 420);
  const results = [];
  await Promise.all(
    pids.map(async (pidText) => {
      const pid = Number(pidText);
      try {
        const [stat, status, comm] = await Promise.all([
          readText(`/proc/${pidText}/stat`),
          readText(`/proc/${pidText}/status`),
          readText(`/proc/${pidText}/comm`)
        ]);
        const close = stat.lastIndexOf(")");
        const fields = stat.slice(close + 2).split(/\s+/);
        const ticks = Number(fields[11] || 0) + Number(fields[12] || 0);
        const old = previousProcessTicks.get(pid);
        previousProcessTicks.set(pid, { ticks, total: totalCpuTicks });
        const cpuDelta = old ? ticks - old.ticks : 0;
        const totalDelta = old ? totalCpuTicks - old.total : 0;
        const cpu = totalDelta > 0 ? clamp((cpuDelta / totalDelta) * os.cpus().length, 0, 1) : 0;
        const memMatch = /^VmRSS:\s+(\d+)/m.exec(status);
        const fdCount = await countFds(pidText);
        const memory = clamp(((Number(memMatch?.[1]) || 0) * 1024) / os.totalmem());
        results.push({
          pid,
          name: comm.trim() || `pid-${pid}`,
          cpu,
          memory,
          io: 0,
          network: 0,
          fd: fdCount === null ? 0 : clamp(fdCount / 1024),
          resource: cpu > memory ? "cpu" : "memory"
        });
      } catch {
        // The process may have exited while being sampled.
      }
    })
  );
  return results
    .sort((a, b) => Math.max(b.cpu, b.memory, b.fd) - Math.max(a.cpu, a.memory, a.fd))
    .slice(0, 8);
}

async function countFds(pidText) {
  try {
    const fds = await fs.readdir(`/proc/${pidText}/fd`);
    return fds.length;
  } catch {
    return null;
  }
}

async function makeLocalTelemetry(state) {
  const now = Date.now();
  const seconds = state.lastAt ? Math.max(0.1, (now - state.lastAt) / 1000) : 1;
  const [statText, loadText, meminfoText, vmstatText, diskText, netText] = await Promise.all([
    readText("/proc/stat"),
    readText("/proc/loadavg"),
    readText("/proc/meminfo"),
    readText("/proc/vmstat"),
    readText("/proc/diskstats"),
    readText("/proc/net/dev")
  ]);

  const stat = parseProcStat(statText);
  const prevCpu = state.cpu;
  const allCpu = stat.cpus.find((cpu) => cpu.name === "cpu");
  const cpuUtil = cpuUsage(allCpu, prevCpu?.all);
  const coreMetrics = stat.cpus
    .filter((cpu) => cpu.name !== "cpu")
    .slice(0, 24)
    .map((cpu, id) => {
      const util = cpuUsage(cpu, prevCpu?.cores?.[id]);
      return {
        id,
        utilization: util,
        saturation: clamp(Math.max(0, util - 0.82) * 2),
        frequency: 0.35 + util * 0.62
      };
    });
  const load1 = Number(loadText.split(/\s+/)[0]) || 0;
  const cores = Math.max(1, coreMetrics.length || os.cpus().length || 1);
  const contextSwitchRate = deltaRate(stat.ctxt, state.ctxt, seconds);
  state.cpu = { all: allCpu, cores: stat.cpus.filter((cpu) => cpu.name !== "cpu") };
  state.ctxt = stat.ctxt;

  const meminfo = parseKeyValueFile(meminfoText);
  const vmstat = parseKeyValueFile(vmstatText);
  const totalKb = meminfo.get("MemTotal") || os.totalmem() / 1024;
  const availableKb = meminfo.get("MemAvailable") || meminfo.get("MemFree") || totalKb;
  const cachedKb = (meminfo.get("Cached") || 0) + (meminfo.get("SReclaimable") || 0);
  const dirtyKb = meminfo.get("Dirty") || 0;
  const swapIn = vmstat.get("pswpin") || 0;
  const swapOut = vmstat.get("pswpout") || 0;
  const swapRate = deltaRate(swapIn + swapOut, state.swapPages, seconds);
  state.swapPages = swapIn + swapOut;
  const memoryUtil = clamp(1 - availableKb / totalKb);
  const anonKb = Math.max(0, totalKb - availableKb - cachedKb);

  const disks = parseDiskstats(diskText);
  const diskDevices = [];
  let storageUtil = 0;
  let queueDepth = 0;
  let awaitMs = 0;
  let readMbps = 0;
  let writeMbps = 0;
  for (const disk of disks) {
    const previous = state.disks.get(disk.name);
    state.disks.set(disk.name, disk);
    if (!previous) continue;
    const ioMsDelta = disk.ioMs - previous.ioMs;
    const reads = disk.reads - previous.reads;
    const writes = disk.writes - previous.writes;
    const ios = reads + writes;
    const readBytes = (disk.readSectors - previous.readSectors) * 512;
    const writeBytes = (disk.writeSectors - previous.writeSectors) * 512;
    const util = clamp(ioMsDelta / (seconds * 1000));
    const weighted = Math.max(0, disk.weightedIoMs - previous.weightedIoMs);
    const qd = Math.max(0, weighted / (seconds * 1000));
    const awaitDevice = ios > 0 ? Math.max(0, (disk.readMs - previous.readMs + disk.writeMs - previous.writeMs) / ios) : 0;
    storageUtil = Math.max(storageUtil, util);
    queueDepth = Math.max(queueDepth, qd);
    awaitMs = Math.max(awaitMs, awaitDevice);
    readMbps += readBytes / seconds / 1024 / 1024;
    writeMbps += writeBytes / seconds / 1024 / 1024;
    diskDevices.push({
      name: disk.name,
      utilization: util,
      queueDepth: qd,
      awaitMs: awaitDevice,
      errors: 0
    });
  }

  const ifaces = parseNetdev(netText);
  const networkIfaces = [];
  let rxMbps = 0;
  let txMbps = 0;
  let dropsRate = 0;
  let errorRate = 0;
  for (const iface of ifaces) {
    const previous = state.net.get(iface.name);
    state.net.set(iface.name, iface);
    if (!previous) continue;
    const rx = deltaRate(iface.rxBytes, previous.rxBytes, seconds) * 8 / 1000 / 1000;
    const tx = deltaRate(iface.txBytes, previous.txBytes, seconds) * 8 / 1000 / 1000;
    const drops = deltaRate(iface.rxDrops + iface.txDrops, previous.rxDrops + previous.txDrops, seconds);
    const errors = deltaRate(iface.rxErrors + iface.txErrors, previous.rxErrors + previous.txErrors, seconds);
    rxMbps += rx;
    txMbps += tx;
    dropsRate += drops;
    errorRate += errors;
    networkIfaces.push({
      name: iface.name,
      utilization: clamp((rx + tx) / 1000),
      rxMbps: rx,
      txMbps: tx,
      dropsRate: drops
    });
  }
  const networkUtil = clamp((rxMbps + txMbps) / 1000);
  const totalCpuTicks = allCpu?.total || 0;
  const processes = await processSnapshot(state.processTicks, totalCpuTicks);
  state.lastAt = now;

  return {
    scenario: "local",
    mode: "local",
    timestamp: now,
    host: os.hostname(),
    health: clamp(1 - Math.max(cpuUtil, memoryUtil, storageUtil, networkUtil) * 0.72),
    cpu: {
      utilization: cpuUtil,
      saturation: clamp(Math.max(0, load1 - cores) / cores),
      errors: 0,
      cores,
      load1,
      contextSwitchRate,
      coreMetrics
    },
    memory: {
      utilization: memoryUtil,
      saturation: clamp(swapRate / 2500 + Math.max(0, memoryUtil - 0.86) * 2),
      errors: 0,
      totalGb: totalKb / 1024 / 1024,
      usedGb: (totalKb - availableKb) / 1024 / 1024,
      availableGb: availableKb / 1024 / 1024,
      swapRate,
      composition: {
        cached: clamp(cachedKb / totalKb),
        anonymous: clamp(anonKb / totalKb),
        dirty: clamp(dirtyKb / totalKb),
        pinned: clamp((meminfo.get("Unevictable") || 0) / totalKb)
      }
    },
    storage: {
      utilization: storageUtil,
      saturation: clamp(queueDepth / 8 + awaitMs / 250),
      errors: 0,
      queueDepth,
      awaitMs,
      readMbps,
      writeMbps,
      devices: diskDevices.sort((a, b) => b.utilization - a.utilization).slice(0, 4)
    },
    network: {
      utilization: networkUtil,
      saturation: clamp(dropsRate / 100),
      errors: clamp(errorRate / 50),
      rxMbps,
      txMbps,
      dropsRate,
      retransRate: 0,
      interfaces: networkIfaces.sort((a, b) => b.utilization - a.utilization).slice(0, 4)
    },
    processes
  };
}

function createState() {
  return {
    cpu: null,
    ctxt: undefined,
    swapPages: undefined,
    disks: new Map(),
    net: new Map(),
    processTicks: new Map(),
    lastAt: 0
  };
}

function telemetryPlugin() {
  return {
    name: "doom-perf-telemetry",
    configureServer(server) {
      server.middlewares.use("/api/telemetry", async (req, res) => {
        const url = new URL(req.url || "", "http://localhost");
        const requested = url.searchParams.get("scenario") || "cpu";
        const scenario = SCENARIO_NAMES.has(requested) ? requested : "cpu";
        let closed = false;
        let count = 0;
        const state = createState();

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        res.write(": connected\n\n");

        req.on("close", () => {
          closed = true;
        });

        const send = async () => {
          if (closed) return;
          try {
            const telemetry = scenario === "local" ? await makeLocalTelemetry(state) : makeScenarioTelemetry(scenario, count);
            res.write(`event: telemetry\n`);
            res.write(`data: ${JSON.stringify(telemetry)}\n\n`);
            count += 1;
          } catch (error) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`);
          }
          if (!closed) setTimeout(send, 1000);
        };
        await send();
      });

      server.middlewares.use("/api/scenarios", (_req, res) => {
        const file = path.join(process.cwd(), "src", "scenarios.json");
        fs.readFile(file, "utf8")
          .then((content) => {
            res.setHeader("Content-Type", "application/json");
            res.end(content);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end("[]");
          });
      });
    }
  };
}

export default defineConfig({
  plugins: [telemetryPlugin()],
  server: {
    port: 5173,
    strictPort: false
  }
});
