// ---------------------------------------------------------------------------
// Interactive instrument terminal: an on-demand overlay that renders live
// telemetry as if it were the output of a Linux diagnostic command. Opened by
// pressing USE/space near an instrument sign (see src/index.ts).
// ---------------------------------------------------------------------------
import type { TelemetrySnapshot, TerminalSign } from "../telemetry/types";
import { clamp } from "../telemetry/normalize";

const pctText = (value: number) => `${Math.round(clamp(value) * 100)}`;
const padStart = (text: string, width: number) => text.padStart(width, " ");
const bar = (value: number, width = 20) => {
  const filled = Math.round(clamp(value) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
};

// Percentage cell (2 dp) for the mpstat-style breakdown; falls back to a value
// derived from total utilization when a finer per-core breakdown isn't supplied.
const pctCell = (value: number | undefined, fallback: number) => (clamp(value ?? fallback) * 100).toFixed(2);

const formatCores = (telemetry: TelemetrySnapshot): string => {
  const cpu = telemetry.cpu;
  const count = cpu.logicalCpus || cpu.cores.length || 1;
  // mpstat's full set is %usr %nice %sys %iowait %irq %soft %steal %guest %gnice
  // %idle. We keep the states that actually move a CPU diagnosis: %nice/%guest/
  // %gnice are dropped (≈0, not meaningful) and %irq/%soft are folded into %sys.
  const columns: [string, number][] = [
    ["CPU", 4], ["%usr", 8], ["%sys", 8], ["%iowait", 9], ["%steal", 8], ["%idle", 8],
  ];
  const renderRow = (
    label: string,
    b: { utilization: number; user?: number; system?: number; idle?: number; iowait?: number; steal?: number }
  ) => {
    const u = b.utilization;
    const cells = [
      label,
      pctCell(b.user, u * 0.7),
      pctCell(b.system, u * 0.3),
      pctCell(b.iowait, 0),
      pctCell(b.steal, 0),
      pctCell(b.idle, 1 - u),
    ];
    return columns.map(([, width], i) => padStart(cells[i], width)).join("");
  };
  const lines: string[] = [];
  lines.push("$ mpstat -P ALL 1 1");
  lines.push(`Linux 6.8.0 (${telemetry.host})   _x86_64_   (${count} CPU)`);
  lines.push("");
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(renderRow("all", cpu));
  const cores = cpu.cores.length ? cpu.cores : Array.from({ length: count }, (_, id) => ({ id, utilization: 0 }));
  cores.slice(0, 16).forEach((core) => lines.push(renderRow(String(core.id), core)));
  return lines.join("\n");
};

// vmstat columns as [label, field width]; widths keep a separating space for
// typical magnitudes and sum to ~87 chars, which fits the auto-sized panel.
const runQueueColumns: [string, number][] = [
  ["r", 2], ["b", 3], ["swpd", 8], ["free", 8], ["buff", 8], ["cache", 8],
  ["si", 5], ["so", 5], ["bi", 6], ["bo", 6], ["in", 6], ["cs", 7],
  ["us", 3], ["sy", 3], ["id", 3], ["wa", 3], ["st", 3],
];
const runQueueGroups: [string, number][] = [
  ["procs", 5], ["memory", 32], ["swap", 10], ["io", 12], ["system", 13], ["cpu", 15],
];
const dashSpan = (label: string, width: number): string => {
  const pad = Math.max(0, width - label.length);
  const left = Math.floor(pad / 2);
  return "-".repeat(left) + label + "-".repeat(pad - left);
};
// Keep the two most recent samples so `vmstat 1 2` shows two rows a sample
// apart. The overlay only re-renders when a new snapshot arrives (~1s cadence),
// so each call advances the pair: the previous row becomes row 1, the new one
// row 2.
let runQueuePrevRow: number[] | null = null;
let runQueueLastRow: number[] | null = null;
let runQueueLastTs = -1;
const formatRunQueue = (telemetry: TelemetrySnapshot): string => {
  const { cpu, memory, storage } = telemetry;
  const count = cpu.logicalCpus || cpu.cores.length || 1;
  const kb = (bytes?: number) => Math.round(Math.max(0, bytes ?? 0) / 1024);
  const rate = (value?: number) => Math.round(Math.max(0, value ?? 0));
  const pct = (value: number | undefined, fallback: number) => Math.round(clamp(value ?? fallback) * 100);
  const row = [
    cpu.runQueue ?? Math.max(0, Math.round(count * (1 + cpu.runQueuePressure))),
    cpu.blocked ?? 0,
    kb(memory.swapUsedBytes),
    kb(memory.freeBytes ?? memory.availableBytes),
    kb(memory.buffersBytes),
    kb(memory.cachedBytes),
    rate((memory.swapInPagesPerSecond ?? 0) * 4),
    rate((memory.swapOutPagesPerSecond ?? 0) * 4),
    rate((storage.readBytesPerSecond ?? 0) / 1024),
    rate((storage.writeBytesPerSecond ?? 0) / 1024),
    rate(cpu.interruptsPerSecond),
    rate(cpu.contextSwitchesPerSecond),
    pct(cpu.user, cpu.utilization * 0.7),
    pct(cpu.system, cpu.utilization * 0.3),
    pct(cpu.idle, 1 - cpu.utilization),
    pct(cpu.iowait, 0),
    pct(cpu.steal, 0),
  ];
  if (runQueueLastTs === -1) {
    runQueuePrevRow = row;
  } else if (telemetry.updatedAt !== runQueueLastTs) {
    runQueuePrevRow = runQueueLastRow;
  }
  runQueueLastRow = row;
  runQueueLastTs = telemetry.updatedAt;
  const renderRow = (values: number[]) =>
    runQueueColumns.map(([, width], index) => padStart(String(values[index]), width)).join("");
  const lines: string[] = [];
  lines.push("$ vmstat 1 2");
  lines.push(runQueueGroups.map(([label, width]) => dashSpan(label, width)).join(""));
  lines.push(runQueueColumns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(renderRow(runQueuePrevRow ?? row));
  lines.push(renderRow(row));
  lines.push("");
  lines.push(`run queue pressure  ${bar(cpu.runQueuePressure)} ${pctText(cpu.runQueuePressure)}%`);
  lines.push(`load overcommit     ${bar(cpu.loadPressure)} ${pctText(cpu.loadPressure)}%`);
  return lines.join("\n");
};

const formatUptimeDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}, ${hours}:${String(mins).padStart(2, "0")}`;
  if (hours > 0) return `${hours}:${String(mins).padStart(2, "0")}`;
  return `${mins} min`;
};

const formatUptime = (telemetry: TelemetrySnapshot): string => {
  const cpu = telemetry.cpu;
  const count = cpu.logicalCpus || cpu.cores.length || 1;
  const lines: string[] = [];
  lines.push("$ uptime");
  // Real uptime line: clock, up-duration, load average. (The users count is
  // dropped — it isn't a load/saturation signal.)
  const clock = new Date(telemetry.updatedAt || Date.now()).toTimeString().slice(0, 8);
  const up = telemetry.uptimeSeconds ? `up ${formatUptimeDuration(telemetry.uptimeSeconds)},  ` : "";
  lines.push(` ${clock}  ${up}load average: ${cpu.load1.toFixed(2)}, ${cpu.load5.toFixed(2)}, ${cpu.load15.toFixed(2)}`);
  lines.push("");
  // USE saturation read: load relative to logical CPUs (load >= CPU count means
  // every CPU is busy with work queued; sustained load > count is saturation).
  lines.push(`logical CPUs: ${count}   (saturated when load > ${count})`);
  lines.push("");
  const rows: [string, number][] = [
    ["1m", cpu.load1],
    ["5m", cpu.load5],
    ["15m", cpu.load15],
  ];
  rows.forEach(([label, load]) => {
    const fill = clamp(load / (count * 2));
    const state = load > count ? "OVER" : "ok";
    lines.push(`${padStart(label, 3)}  ${bar(fill)} ${padStart(load.toFixed(2), 6)}  ${state}`);
  });
  return lines.join("\n");
};

const mib = (bytes?: number) => Math.round(Math.max(0, bytes ?? 0) / (1024 * 1024));
const kib = (bytes?: number) => Math.round(Math.max(0, bytes ?? 0) / 1024);
const rate = (value?: number) => Math.max(0, value ?? 0);

const freeColumns: [string, number][] = [
  ["", 6], ["total", 12], ["used", 12], ["free", 12], ["buff/cache", 12], ["available", 12],
];
const freeRow = (label: string, values: number[]) =>
  freeColumns.map(([, width], i) => padStart(i === 0 ? label : String(values[i - 1]), width)).join("");

// MEMORY PAGE BANK: USE utilization from free(1) and /proc/meminfo. This is
// intentionally distinct from saturation: low available memory is utilization;
// swap movement and PSI prove stall/queueing.
const formatMemory = (telemetry: TelemetrySnapshot): string => {
  const m = telemetry.memory;
  const total = mib(m.totalBytes);
  const free = mib(m.freeBytes);
  const buffCache = mib(m.buffersBytes) + mib(m.cachedBytes);
  const available = mib(m.availableBytes);
  const used = Math.max(0, total - free - buffCache); // free(1): total - free - buff/cache
  const lines: string[] = [];
  lines.push("$ free -m");
  lines.push(freeColumns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(freeRow("Mem:", [total, used, free, buffCache, available]));
  if (m.swapTotalBytes !== undefined || m.swapUsedBytes !== undefined) {
    const swapTotal = mib(m.swapTotalBytes);
    const swapUsed = mib(m.swapUsedBytes);
    const swapFree = m.swapFreeBytes !== undefined ? mib(m.swapFreeBytes) : Math.max(0, swapTotal - swapUsed);
    lines.push(freeRow("Swap:", [swapTotal, swapUsed, swapFree, 0, 0]));
  }
  lines.push("");
  lines.push("$ grep -E 'MemTotal|MemAvailable|Buffers|^Cached:' /proc/meminfo");
  lines.push(`MemTotal:      ${padStart(String(kib(m.totalBytes)), 10)} kB`);
  lines.push(`MemAvailable:  ${padStart(String(kib(m.availableBytes)), 10)} kB`);
  lines.push(`Buffers:       ${padStart(String(kib(m.buffersBytes)), 10)} kB`);
  lines.push(`Cached:        ${padStart(String(kib(m.cachedBytes)), 10)} kB`);
  lines.push("");
  lines.push(`available     ${bar(total > 0 ? available / total : 0)} ${total > 0 ? Math.round((available / total) * 100) : 0}%`);
  lines.push(`utilization   ${bar(m.utilization)} ${pctText(m.utilization)}%   (1 - available/total)`);
  lines.push(`cache+buffers ${padStart(String(buffCache), 6)} MiB   reclaimable context`);
  return lines.join("\n");
};

const formatMemoryRss = (telemetry: TelemetrySnapshot): string => {
  const rows = telemetry.memory.topRss ?? [];
  const columns: [string, number][] = [["PID", 8], ["RSS KiB", 12], ["COMMAND", 48]];
  const lines: string[] = [];
  lines.push("$ ps -eo pid,rss,comm --sort=-rss | head");
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  if (rows.length === 0) {
    lines.push(padStart("-", 8) + padStart("0", 12) + padStart("no process RSS sample", 48));
  } else {
    rows.forEach(({ pid, rssBytes, command }) => {
      const cells = [
        String(pid),
        String(kib(rssBytes)),
        command.length > 47 ? `${command.slice(0, 44)}...` : command,
      ];
      lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
    });
  }
  lines.push("");
  lines.push("RSS is resident RAM. Shared pages can be counted in more than one process.");
  lines.push("For proportional memory, use smem or /proc/<pid>/smaps_rollup.");
  if (rows.length > 0) {
    // OOM "badness" per process, the value the in-world barrels glow with: a
    // brighter barrel is a process closer to being the OOM killer's next pick.
    // oom_score isn't a `ps -eo` field, so it is read straight from /proc.
    lines.push("");
    lines.push("$ for p in <pids>; do cat /proc/$p/oom_score; done   # OOM killer badness");
    lines.push(padStart("PID", 8) + padStart("OOM", 8) + "   0 .. 1000 (higher = killed sooner)");
    rows.forEach(({ pid, oomScore }) => {
      const score = Math.max(0, Math.round(oomScore ?? 0));
      lines.push(padStart(String(pid), 8) + padStart(String(score), 8) + `   ${bar(score / 1000)}`);
    });
  }
  return lines.join("\n");
};

const formatMemorySwap = (telemetry: TelemetrySnapshot): string => {
  const m = telemetry.memory;
  const columns: [string, number][] = [
    ["swpd", 8], ["free", 8], ["buff", 8], ["cache", 8], ["si", 6], ["so", 6],
  ];
  const cells = [
    String(mib(m.swapUsedBytes)),
    String(mib(m.freeBytes ?? m.availableBytes)),
    String(mib(m.buffersBytes)),
    String(mib(m.cachedBytes)),
    String(Math.round(rate(m.swapInPagesPerSecond))),
    String(Math.round(rate(m.swapOutPagesPerSecond))),
  ];
  const lines: string[] = [];
  lines.push("$ vmstat 1 2     # memory + swap columns");
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
  lines.push("");
  lines.push("$ sar -W 1 2      # equivalent swap-page rates");
  lines.push(padStart("pswpin/s", 12) + padStart("pswpout/s", 12));
  lines.push(padStart(rate(m.swapInPagesPerSecond).toFixed(2), 12) + padStart(rate(m.swapOutPagesPerSecond).toFixed(2), 12));
  lines.push("");
  lines.push(`swap churn    ${bar(clamp(rate(m.swapPagesPerSecond) / 2500))} ${Math.round(rate(m.swapPagesPerSecond))} pages/s`);
  lines.push(`saturation    ${bar(m.saturation)} ${pctText(m.saturation)}%`);
  return lines.join("\n");
};

// MEMORY PAGING/FAULTS wing terminal — USE saturation from page faults. A MINOR
// fault is served from RAM (page already resident / zero-fill) — mostly workload;
// a MAJOR fault had to read the page back from disk or swap — the refault/thrash
// signal, so majflt/s is what drives saturation. Rates come from `sar -B`
// (fault/s, majflt/s) or the /proc/vmstat pgfault/pgmajfault counters. The PSI
// reclaim-stall census folds in here, but only when the kernel exposes
// /proc/pressure/memory (older kernels / no CONFIG_PSI report nothing).
const formatMemoryFaults = (telemetry: TelemetrySnapshot): string => {
  const m = telemetry.memory;
  const minor = Math.max(0, rate(m.minorFaultsPerSecond));
  const major = Math.max(0, rate(m.majorFaultsPerSecond));
  const lines: string[] = [];
  lines.push("$ sar -B 1 1     # paging activity");
  lines.push(padStart("fault/s", 14) + padStart("majflt/s", 14));
  lines.push(padStart((minor + major).toFixed(2), 14) + padStart(major.toFixed(2), 14));
  lines.push("");
  lines.push("$ awk '/^pgfault|^pgmajfault/{print}' /proc/vmstat   # (shown as rates)");
  lines.push(`pgfault      ${padStart(String(Math.round(minor + major)), 12)} /s   minor + major`);
  lines.push(`pgmajfault   ${padStart(String(Math.round(major)), 12)} /s   disk/swap refaults`);
  lines.push("");
  // Minor = workload context (scaled against a busy 50k/s reference); major =
  // saturation (matches the collector's majFaultRate/200 severity contribution).
  lines.push(`minor faults ${bar(clamp(minor / 50000))} ${Math.round(minor)} /s   served from RAM`);
  lines.push(`major faults ${bar(clamp(major / 200))} ${Math.round(major)} /s   refault from disk/swap`);
  lines.push(`saturation   ${bar(m.saturation)} ${pctText(m.saturation)}%`);
  lines.push("");
  // PSI reclaim stalls fold in here, gated on the kernel actually exposing them.
  if (m.pressureAvailable) {
    const some = rate(m.pressureSomeAvg10);
    const full = rate(m.pressureFullAvg10);
    lines.push("$ cat /proc/pressure/memory");
    lines.push(`some avg10=${some.toFixed(2)} avg60=${rate(m.pressureSomeAvg60).toFixed(2)} avg300=${rate(m.pressureSomeAvg300).toFixed(2)}`);
    lines.push(`full avg10=${full.toFixed(2)} avg60=${rate(m.pressureFullAvg60).toFixed(2)} avg300=${rate(m.pressureFullAvg300).toFixed(2)}`);
    lines.push(`some stalls   ${bar(clamp(some / 20))} ${some.toFixed(2)}% of last 10s   (>10% = sustained)`);
    lines.push(`full stalls   ${bar(clamp(full / 5))} ${full.toFixed(2)}% of last 10s   (>0 = severe)`);
  } else {
    lines.push("$ cat /proc/pressure/memory");
    lines.push("cat: /proc/pressure/memory: No such file or directory");
    lines.push("PSI reclaim stalls unavailable on this kernel (needs CONFIG_PSI).");
  }
  return lines.join("\n");
};

const formatMemoryOom = (telemetry: TelemetrySnapshot): string => {
  const m = telemetry.memory;
  const lines: string[] = [];
  lines.push("$ grep oom_kill /proc/vmstat");
  lines.push(`oom_kill ${Math.round(rate(m.oomKills))}`);
  lines.push("");
  lines.push("$ dmesg -T | grep -iE 'killed process|out of memory|oom-killer' | tail");
  if (rate(m.oomKillsPerSecond) > 0) {
    lines.push(`[now] oom_kill counter increasing at ${rate(m.oomKillsPerSecond).toFixed(2)} /s`);
  } else {
    lines.push("no live OOM-kill rate detected from /proc/vmstat");
  }
  lines.push("");
  lines.push(`errors        ${bar(m.errors)} ${pctText(m.errors)}%`);
  lines.push("Kernel log lines identify the victim PID, RSS, and cgroup when available.");
  return lines.join("\n");
};

// STORAGE wing — `iostat -x` aggregate: service-time / queue-depth latency plus
// throughput, the inputs to the wing's latency and queue instruments.
const formatStorage = (telemetry: TelemetrySnapshot): string => {
  const s = telemetry.storage;
  const columns: [string, number][] = [
    ["Device", 10], ["rkB/s", 10], ["wkB/s", 10], ["await", 9], ["aqu-sz", 9], ["%util", 8],
  ];
  const cells = [
    "aggregate",
    String(kib(s.readBytesPerSecond)),
    String(kib(s.writeBytesPerSecond)),
    rate(s.awaitMillis).toFixed(2),
    rate(s.queueDepth).toFixed(2),
    (clamp(s.utilization) * 100).toFixed(1),
  ];
  const lines: string[] = [];
  lines.push("$ iostat -x 1 2");
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
  lines.push("");
  lines.push(`queue depth  ${bar(clamp(rate(s.queueDepth) / 8))} ${rate(s.queueDepth).toFixed(2)}`);
  lines.push(`await (ms)   ${bar(clamp(rate(s.awaitMillis) / 250))} ${rate(s.awaitMillis).toFixed(2)} ms`);
  lines.push(`utilization  ${bar(s.utilization)} ${pctText(s.utilization)}%`);
  lines.push(`saturation   ${bar(s.saturation)} ${pctText(s.saturation)}%   (queue + await)`);
  // Cross-reference the two dedicated instruments off this hall so the aggregate
  // iostat readout points to where the per-device IOPS bank and capacity cistern live.
  const usedRatio = clamp(s.usedRatio ?? 0);
  lines.push(`IOPS         ${Math.round(rate(s.iops))} ops/s   (reads + writes; per-device on the IOPS bank)`);
  lines.push(`disk usage   ${bar(usedRatio)} ${pctText(usedRatio)}%   (df / — the capacity cistern)`);
  return lines.join("\n");
};

// Human-readable byte size in `df -h` style: powers of 1024 with one unit suffix.
const humanBytes = (bytes: number): string => {
  const units = ["B", "K", "M", "G", "T", "P"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${units[unit]}`;
};

// STORAGE wing — root-filesystem capacity (`df -h /`), the input to the disk-usage
// cistern. USE read is how full `/` is; a brimming cistern = a near-full disk.
const formatStorageUsage = (telemetry: TelemetrySnapshot): string => {
  const s = telemetry.storage;
  const total = Math.max(0, s.totalBytes ?? 0);
  const used = Math.max(0, s.usedBytes ?? 0);
  const avail = Math.max(0, s.availBytes ?? 0);
  const usedRatio = clamp(s.usedRatio ?? (total > 0 ? used / total : 0));
  const columns: [string, number][] = [
    ["Filesystem", 12], ["Size", 8], ["Used", 8], ["Avail", 8], ["Use%", 7], ["Mounted", 9],
  ];
  const cells = ["/dev/root", humanBytes(total), humanBytes(used), humanBytes(avail), `${pctText(usedRatio)}%`, "/"];
  const lines: string[] = [];
  lines.push("$ df -h /");
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
  lines.push("");
  lines.push(`disk usage   ${bar(usedRatio)} ${pctText(usedRatio)}%`);
  lines.push(`used ${humanBytes(used)} of ${humanBytes(total)}   (${humanBytes(avail)} available)`);
  return lines.join("\n");
};

// STORAGE wing — per-device operations rate (`iostat -x`), the input to the IOPS
// counter bank. USE read is completed operations/s (reads+writes) per block device,
// busiest first, plus the aggregate that feeds the dashboard's IOPS graph.
const formatStorageIops = (telemetry: TelemetrySnapshot): string => {
  const s = telemetry.storage;
  const devices = s.devices ?? [];
  const lines: string[] = [];
  lines.push("$ iostat -x 1 2   (per device)");
  lines.push(`${padStart("Device", 10)}  ${padStart("", 22)} ${padStart("iops", 7)}  util`);
  const scale = Math.max(1, ...devices.map((d) => rate(d.iops)));
  const rows = devices.slice(0, 4);
  rows.forEach((d) => {
    lines.push(
      `${padStart(d.name, 10)}  ${bar(rate(d.iops) / scale)} ${padStart(String(Math.round(rate(d.iops))), 7)}  ${(clamp(d.utilization) * 100).toFixed(0)}%`
    );
  });
  // Pin the block height so the summary below doesn't jump as devices come and go.
  for (let i = rows.length; i < 4; i += 1) lines.push("");
  lines.push("");
  lines.push(`aggregate IOPS  ${Math.round(rate(s.iops))} ops/s   (reads + writes, all devices)`);
  return lines.join("\n");
};

// NETWORK wing — per-interface throughput (`sar -n DEV`) with the noisiest NIC
// marked as primary, the input to the wing's packet-grove lanes. USE utilization
// is throughput vs link speed; saturation is drops.
//
// The interface list is rendered at a FIXED row count (netInterfaceRows), padding
// with blank lines, so the "primary interface" line and the bars below never
// reflow as interfaces enter or leave the (collector-filtered) list. Columns:
// a 2-wide primary marker, the interface name LEFT-aligned in a fixed field, then
// rxkB/s and txkB/s RIGHT-aligned — so names of any length stay aligned and the
// numbers line up under their headers.
const netInterfaceRows = 6; // most interfaces ever listed; also the pinned height
const netRow = (marker: string, name: string, rx: string, tx: string): string =>
  `${marker.padStart(2)}${name.slice(0, 15).padEnd(16)}${rx.padStart(9)}${tx.padStart(9)}`;
const formatNetwork = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const interfaces = n.interfaces ?? [];
  const rows = interfaces.length > 0
    ? interfaces.slice(0, netInterfaceRows).map((iface) =>
        netRow(
          iface.name === n.primaryInterface ? "*" : "",
          iface.name,
          String(kib(iface.rxBytesPerSecond)),
          String(kib(iface.txBytesPerSecond))
        )
      )
    : [netRow("", "aggregate", String(kib(n.rxBytesPerSecond)), String(kib(n.txBytesPerSecond)))];
  // Pin the block height: pad up to netInterfaceRows so nothing below shifts.
  while (rows.length < netInterfaceRows) rows.push("");
  const lines: string[] = [];
  lines.push("$ sar -n DEV 1 1   (per interface, per second)");
  lines.push(netRow("", "IFACE", "rxkB/s", "txkB/s"));
  lines.push(...rows);
  lines.push("");
  lines.push(`primary interface: ${n.primaryInterface ?? "-"}   (* = noisiest; grove shows all)`);
  lines.push("");
  lines.push(`utilization  ${bar(n.utilization)} ${pctText(n.utilization)}%   (throughput vs link speed)`);
  lines.push(`saturation   ${bar(n.saturation)} ${pctText(n.saturation)}%   (drops)`);
  lines.push(`errors       ${bar(n.errors)} ${pctText(n.errors)}%`);
  return lines.join("\n");
};

// NETWORK wing — TCP socket census by state (`ss -s` / `ss -tan`), the input to
// the socket-state patch-panel wall. USE read is connection load: many
// ESTABLISHED is healthy work; a pile of TIME-WAIT / CLOSE-WAIT / SYN-RECV is
// churn, a leak, or a backlog.
const formatNetworkSockets = (telemetry: TelemetrySnapshot): string => {
  const tcp = telemetry.network.tcp;
  const lines: string[] = [];
  lines.push("$ ss -s");
  if (!tcp) {
    lines.push("no TCP socket census from this source");
    return lines.join("\n");
  }
  const val = (v?: number) => Math.max(0, Math.round(rate(v)));
  const total = val(tcp.total);
  const estab = val(tcp.established);
  lines.push(`Total: ${total}`);
  lines.push(`TCP:   estab ${estab}, timewait ${val(tcp.timeWait)}, listen ${val(tcp.listen)}, closewait ${val(tcp.closeWait)}`);
  lines.push("");
  lines.push("$ ss -tan | awk 'NR>1{print $1}' | sort | uniq -c");
  // Canonical order; show ESTABLISHED and LISTEN always, other states only when
  // present, so the panel stays focused on what's actually live.
  const rows: [string, number, boolean][] = [
    ["ESTABLISHED", estab, true],
    ["SYN-SENT", val(tcp.synSent), false],
    ["SYN-RECV", val(tcp.synRecv), false],
    ["FIN-WAIT1", val(tcp.finWait1), false],
    ["FIN-WAIT2", val(tcp.finWait2), false],
    ["TIME-WAIT", val(tcp.timeWait), false],
    ["CLOSE-WAIT", val(tcp.closeWait), false],
    ["LAST-ACK", val(tcp.lastAck), false],
    ["LISTEN", val(tcp.listen), true],
    ["CLOSING", val(tcp.closing), false],
  ];
  const scale = Math.max(1, total, ...rows.map(([, count]) => count));
  rows.forEach(([label, count, always]) => {
    if (count > 0 || always) {
      lines.push(`${padStart(label, 12)}  ${bar(count / scale)} ${padStart(String(count), 6)}`);
    }
  });
  lines.push("");
  lines.push("established = active connection load; time-wait/close-wait piles = churn or leak.");
  return lines.join("\n");
};

// NETWORK wing — TCP send/recv-queue backlog (`ss -tmn`), the input to the twin
// SendQ / RecvQ standpipe gauges. USE read is saturation/backpressure: Recv-Q
// bytes = the app isn't reading fast enough; Send-Q bytes = the peer/network
// isn't draining. Queue bars are scaled against a 1 MiB socket-buffer full scale.
const formatNetworkQueues = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const lines: string[] = [];
  const fullScale = 1024 * 1024; // 1 MiB per-queue full scale for the bars
  const recvBytes = Math.max(0, rate(n.recvQueueBytes));
  const sendBytes = Math.max(0, rate(n.sendQueueBytes));
  lines.push("$ ss -tmn   (send-q / recv-q backlog)");
  lines.push(`aggregate Recv-Q  ${kib(recvBytes)} KiB`);
  lines.push(`aggregate Send-Q  ${kib(sendBytes)} KiB`);
  lines.push(`backlogged sockets  ${Math.max(0, Math.round(rate(n.backloggedSockets)))}`);
  lines.push("");
  lines.push(`Recv-Q  ${bar(clamp(recvBytes / fullScale))} ${padStart(String(kib(recvBytes)), 7)} KiB   inbound (app read lag)`);
  lines.push(`Send-Q  ${bar(clamp(sendBytes / fullScale))} ${padStart(String(kib(sendBytes)), 7)} KiB   outbound (drain lag)`);
  const top = n.topSockets ?? [];
  if (top.length > 0) {
    lines.push("");
    const columns: [string, number][] = [["Recv-Q", 9], ["Send-Q", 9], ["State", 11], ["Peer", 24]];
    lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
    top.slice(0, 6).forEach((socket) => {
      const peer = socket.remote.length > 23 ? `${socket.remote.slice(0, 20)}...` : socket.remote;
      const cells = [String(kib(socket.recvQueueBytes)), String(kib(socket.sendQueueBytes)), socket.state, peer];
      lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
    });
  }
  return lines.join("\n");
};

// Sign -> instrument terminal. Each wing's screens register one entry here; the
// CPU wing's three sub-area screens plus one primary screen per resource wing.
// `Record<TerminalSign, ...>` keeps this exhaustive: adding a sign to the union
// (src/telemetry/types.ts) without an entry here is a compile error, and vice
// versa, so the manifest sign vocabulary and the renderers can't drift.
const terminals: Record<TerminalSign, { title: string; render: (telemetry: TelemetrySnapshot) => string }> = {
  cores: { title: "CPU CORES — per-core utilization", render: formatCores },
  runqueue: { title: "RUN QUEUE — scheduler saturation", render: formatRunQueue },
  load: { title: "LOAD AVERAGE — 1m / 5m / 15m", render: formatUptime },
  memory: { title: "MEMORY — utilization baseline", render: formatMemory },
  "memory-rss": { title: "MEMORY — top resident sets", render: formatMemoryRss },
  "memory-swap": { title: "MEMORY — swap churn", render: formatMemorySwap },
  "memory-faults": { title: "MEMORY — page faults", render: formatMemoryFaults },
  "memory-oom": { title: "MEMORY — OOM errors", render: formatMemoryOom },
  storage: { title: "STORAGE — iostat service & queue", render: formatStorage },
  "storage-usage": { title: "STORAGE — df / capacity", render: formatStorageUsage },
  "storage-iops": { title: "STORAGE — per-device IOPS", render: formatStorageIops },
  network: { title: "NETWORK — per-interface throughput", render: formatNetwork },
  "network-sockets": { title: "NETWORK — TCP socket state census", render: formatNetworkSockets },
  "network-queues": { title: "NETWORK — SendQ / RecvQ backlog", render: formatNetworkQueues },
};

const renderTerminal = (sign: TerminalSign, telemetry: TelemetrySnapshot): string =>
  terminals[sign].render(telemetry);

export const createTerminalOverlay = () => {
  const panel = document.createElement("aside");
  panel.className = "doomTerminal";
  panel.style.display = "none";
  panel.innerHTML = `<header class="doomTerminal__bar"></header><pre class="doomTerminal__body"></pre><footer class="doomTerminal__hint">tap, [space] or [esc] to close</footer>`;

  const style = document.createElement("style");
  style.textContent = `
    .doomTerminal {
      position: fixed;
      inset: 5vh 5vw;
      z-index: 10;
      box-sizing: border-box;
      flex-direction: column;
      border: 3px solid #2f7a2f;
      background: rgba(2, 10, 2, 0.94);
      color: #51e07a;
      font: var(--doom-terminal-font-size, 22px)/1.35 "DejaVu Sans Mono", "Courier New", monospace;
      box-shadow: 0 0 0 3px #000, 0 0 36px rgba(40, 255, 120, 0.35);
      image-rendering: pixelated;
    }
    .doomTerminal__bar {
      flex: 0 0 auto;
      background: #103a10;
      color: #b6ffcb;
      padding: 0.7em 0.9em;
      letter-spacing: 1px;
      text-transform: uppercase;
      font-size: 0.72em;
      border-bottom: 1px solid #2f7a2f;
    }
    .doomTerminal__body {
      flex: 1 1 auto;
      margin: 0;
      padding: 1em 1.1em;
      white-space: pre;
      overflow: auto;
    }
    .doomTerminal__hint {
      flex: 0 0 auto;
      padding: 0.65em 0.9em;
      font-size: 0.66em;
      color: #2f9a4f;
      border-top: 1px solid #1d4d1d;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  const bar = panel.querySelector(".doomTerminal__bar") as HTMLElement;
  const body = panel.querySelector(".doomTerminal__body") as HTMLElement;
  let current: TerminalSign | null = null;
  // updatedAt of the snapshot currently on screen; used to skip re-rendering
  // when the periodic refresh hands us the same sample (avoids needless DOM
  // writes and the scroll reset they cause).
  let renderedAt: number | null = null;
  const resizeTerminalText = () => {
    const { width, height } = panel.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const nextSize = Math.max(18, Math.min(30, Math.floor(Math.min(width / 58, height / 34))));
    panel.style.setProperty("--doom-terminal-font-size", `${nextSize}px`);
  };
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resizeTerminalText).observe(panel);
  }
  window.addEventListener("resize", resizeTerminalText);

  // Tapping the panel closes it — the only dismiss affordance on touch devices,
  // which have no [space]/[esc] keys.
  panel.style.cursor = "pointer";
  panel.addEventListener("pointerup", () => {
    current = null;
    panel.style.display = "none";
  });

  return {
    isOpen: () => current !== null,
    open(sign: TerminalSign, telemetry: TelemetrySnapshot) {
      current = sign;
      bar.textContent = terminals[sign].title;
      body.textContent = renderTerminal(sign, telemetry);
      renderedAt = telemetry.updatedAt;
      panel.style.display = "flex";
      requestAnimationFrame(resizeTerminalText);
    },
    update(telemetry: TelemetrySnapshot) {
      if (current && telemetry.updatedAt !== renderedAt) {
        body.textContent = renderTerminal(current, telemetry);
        renderedAt = telemetry.updatedAt;
      }
    },
    close() {
      current = null;
      panel.style.display = "none";
    },
  };
};
