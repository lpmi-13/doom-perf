// ---------------------------------------------------------------------------
// Interactive instrument terminal: an on-demand overlay that renders live
// telemetry as if it were the output of a Linux diagnostic command. Opened by
// pressing USE/space near an instrument sign (see src/index.ts).
// ---------------------------------------------------------------------------
import type { MemoryTelemetry, TelemetrySnapshot, TerminalSign } from "../telemetry/types";
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
    lines.push(padStart("PID", 8) + padStart("COMMAND", 16) + padStart("OOM", 8) + "   0 .. 1000 (higher = killed sooner)");
    rows.forEach(({ pid, command, oomScore }) => {
      const score = Math.max(0, Math.round(oomScore ?? 0));
      const name = command.length > 15 ? `${command.slice(0, 12)}...` : command;
      lines.push(padStart(String(pid), 8) + padStart(name, 16) + padStart(String(score), 8) + `   ${bar(score / 1000)}`);
    });
  }
  return lines.join("\n");
};

// sar -B's %vmeff: of the pages page-frame reclaim EXAMINED, what share did it
// actually manage to free. Returns undefined — never 0 — when nothing was scanned,
// because the ratio is genuinely undefined there and 0% would invert the meaning
// ("reclaim achieved nothing" vs "reclaim never had to run"). Every caller must
// handle the undefined case explicitly rather than defaulting it to a number.
const reclaimEfficiency = (m: MemoryTelemetry): number | undefined => {
  const scan = rate(m.scanPagesPerSecond);
  const steal = rate(m.stealPagesPerSecond);
  if (!(scan > 0)) {
    return undefined;
  }
  return clamp(steal / scan) * 100;
};

// Plain-language reading for a %vmeff figure. The thresholds are rules of thumb, not
// kernel constants: healthy reclaim frees most of what it looks at, and efficiency
// falling away means it is scanning pages it cannot evict.
const vmeffNote = (vmeff: number): string =>
  vmeff >= 80 ? "reclaim finding evictable pages easily"
  : vmeff >= 40 ? "working harder per page freed"
  : "scanning hard, freeing little — most pages unevictable";

// MEMORY RECLAIM-SLUICE wing terminal — USE saturation as a backlog level. The
// sluice's pool level IS memory saturation; this terminal shows that scalar plus
// the signals that drive it: PSI stall time where the kernel exposes it, else a
// labelled estimate rebuilt from the vmstat reclaim counters (which stay alive on
// swapless + PSI-less hosts via direct reclaim).
//
// The pod is named for RECLAIM, not swap, because everything above stays live with
// no swap device: only the relief VENT depends on one. So the terminal closes with
// an explicit RELIEF PATH block naming how pressure actually gets released on THIS
// host — paging out to swap, or, with no swap fitted, the OOM killer. That is the
// same statement the vent's capped placard makes in the room; a reader who never
// walks to the Baron pen should still learn where the pressure goes.
const formatMemoryReclaim = (telemetry: TelemetrySnapshot): string => {
  const m = telemetry.memory;
  const swapConfigured = (m.swapTotalBytes ?? 0) > 0;
  const si = rate(m.swapInPagesPerSecond);
  const so = rate(m.swapOutPagesPerSecond);
  const scan = rate(m.scanPagesPerSecond);
  const steal = rate(m.stealPagesPerSecond);
  const vmeff = reclaimEfficiency(m);
  const lines: string[] = [];
  lines.push("# reclaim sluice — memory saturation (USE)");
  lines.push(`pool / backlog ${bar(m.saturation)} ${pctText(m.saturation)}%`);
  lines.push("");
  if (m.pressureAvailable) {
    lines.push("$ cat /proc/pressure/memory");
    lines.push(`some avg10=${rate(m.pressureSomeAvg10).toFixed(2)}  full avg10=${rate(m.pressureFullAvg10).toFixed(2)}`);
    lines.push(`stall (PSI)    ${bar(clamp(rate(m.pressureSomeAvg10) / 20))} ${rate(m.pressureSomeAvg10).toFixed(2)}% some/10s`);
  } else {
    // No PSI: the backlog is driven by the collector's labelled estimate, rebuilt
    // from the vmstat reclaim events — direct reclaim keeps it alive without swap.
    // pgscan_direct is printed as well as grepped: the command line used to advertise
    // a counter the output then dropped.
    lines.push("$ grep -E 'allocstall|workingset_refault|pgscan_direct' /proc/vmstat");
    lines.push(`direct reclaim ${padStart(String(Math.round(rate(m.directReclaimsPerSecond))), 7)} /s`);
    lines.push(`refault        ${padStart(String(Math.round(rate(m.refaultPagesPerSecond))), 7)} /s`);
    lines.push(`pgscan_direct  ${padStart(String(Math.round(rate(m.directScanPagesPerSecond))), 7)} /s`);
    lines.push(`stall (est.)   ${bar(clamp(rate(m.stallEstimate)))} ${pctText(clamp(rate(m.stallEstimate)))}% (no PSI)`);
  }
  lines.push("");
  // RECLAIM WORK vs RESULT. The pool level says how far behind we are; this says how
  // hard the kernel is working to catch up and whether that work is achieving
  // anything. %vmeff is the ratio: pages freed per page examined. It collapses when
  // reclaim keeps walking the LRU over pages it is not allowed to evict — which is
  // exactly what a swapless host under pressure does, since anonymous pages can only
  // be freed to swap. So this block is where the two saturation cases diverge
  // numerically, not just visually.
  lines.push("$ sar -B 1 1     # reclaim work vs result");
  lines.push(
    `scanned   ${padStart(String(Math.round(scan)), 8)} pages/s   (kswapd + direct)`
  );
  lines.push(`reclaimed ${padStart(String(Math.round(steal)), 8)} pages/s`);
  if (vmeff === undefined) {
    // Undefined, NOT zero — see reclaimEfficiency(). Nothing was scanned, so there is
    // no ratio to report; printing 0% here would read as total failure.
    lines.push("%vmeff         n/a            no scanning this interval");
  } else {
    lines.push(
      `%vmeff    ${bar(clamp(vmeff / 100))} ${padStart(vmeff.toFixed(1), 6)}%   ${vmeffNote(vmeff)}`
    );
  }
  lines.push("");
  lines.push("$ swapon --show; vmstat 1 1     # relief path");
  if (swapConfigured) {
    lines.push(padStart("si", 8) + padStart("so", 8));
    lines.push(padStart(String(Math.round(si)), 8) + padStart(String(Math.round(so)), 8));
    lines.push(`swap: ${mib(m.swapUsedBytes)}/${mib(m.swapTotalBytes)} MiB used   churn ${Math.round(rate(m.swapPagesPerSecond))} pages/s`);
    lines.push("");
    lines.push("RELIEF PATH: page out to swap. The vent hisses while si/so is non-zero;");
    lines.push("             the backlog only reaches OOM if swap cannot keep up.");
  } else {
    // No si/so table here at all: two zeroes under a vmstat header invite the reading
    // "swap is quiet", when the truth is there is no swap to be quiet. Say so, then
    // say what takes its place — the whole reason this pod stops short of the brim.
    lines.push("(no swap devices)");
    lines.push("");
    lines.push("RELIEF PATH: OOM kill. With no swap fitted there is no way to page");
    lines.push("             anonymous memory out, so reclaim can only evict page cache.");
    lines.push("             Once that is exhausted the kernel's only remaining move is");
    lines.push("             to kill a process — see MEMORY — OOM errors.");
    lines.push(`             oom_kill so far ${Math.round(rate(m.oomKills))}   errors ${bar(m.errors)} ${pctText(m.errors)}%`);
  }
  return lines.join("\n");
};

// MEMORY PAGING/FAULTS wing terminal — USE saturation from page faults. A MINOR
// fault is served from RAM (page already resident / zero-fill) — mostly workload;
// a MAJOR fault had to read the page back from disk or swap — the refault/thrash
// signal, so majflt/s is what drives saturation. Rates come from `sar -B`
// (fault/s, majflt/s) or the /proc/vmstat pgfault/pgmajfault counters. The PSI
// reclaim-stall census folds in here when the kernel exposes
// /proc/pressure/memory; where it doesn't (older kernels / no CONFIG_PSI), the
// same phenomena are rebuilt from the vmstat reclaim counters instead — measured
// event rates plus one clearly-labelled modelled stall estimate.
const formatMemoryFaults = (telemetry: TelemetrySnapshot): string => {
  const m = telemetry.memory;
  const minor = Math.max(0, rate(m.minorFaultsPerSecond));
  const major = Math.max(0, rate(m.majorFaultsPerSecond));
  const lines: string[] = [];
  // A labelled gauge row: 13-wide label, bar, then a right-aligned value+unit column
  // so the trailing notes line up regardless of how many digits the value has.
  const gauge = (label: string, barStr: string, value: string, note = ""): string =>
    `${label.padEnd(13)}${barStr} ${padStart(value, 8)}${note ? `   ${note}` : ""}`;
  // The real `sar -B` table, not just its two fault columns: the reclaim side
  // (pgscank/pgscand/pgsteal/%vmeff) belongs beside the faults because they are two
  // halves of one loop — reclaim frees pages, faults bring them back. Direct scanning
  // (pgscand) is the costly kind: it happens in the allocating process's own context,
  // so it is stall time a workload actually feels, whereas kswapd scans in the
  // background. %vmeff is undefined rather than 0 when nothing scanned; see
  // reclaimEfficiency().
  const scanTotal = rate(m.scanPagesPerSecond);
  const scanDirect = Math.min(rate(m.directScanPagesPerSecond), scanTotal);
  const scanKswapd = Math.max(0, scanTotal - scanDirect);
  const steal = rate(m.stealPagesPerSecond);
  const vmeff = reclaimEfficiency(m);
  lines.push("$ sar -B 1 1     # paging activity");
  lines.push(
    padStart("fault/s", 11) + padStart("majflt/s", 11) +
    padStart("pgscank/s", 11) + padStart("pgscand/s", 11) +
    padStart("pgsteal/s", 11) + padStart("%vmeff", 9)
  );
  lines.push(
    padStart((minor + major).toFixed(2), 11) + padStart(major.toFixed(2), 11) +
    padStart(scanKswapd.toFixed(2), 11) + padStart(scanDirect.toFixed(2), 11) +
    padStart(steal.toFixed(2), 11) + padStart(vmeff === undefined ? "n/a" : vmeff.toFixed(2), 9)
  );
  lines.push("");
  lines.push("$ awk '/^pgfault|^pgmajfault/{print}' /proc/vmstat   # (shown as rates)");
  lines.push(`pgfault      ${padStart(String(Math.round(minor + major)), 12)} /s   minor + major`);
  lines.push(`pgmajfault   ${padStart(String(Math.round(major)), 12)} /s   disk/swap refaults`);
  lines.push("");
  // Minor = workload context (scaled against a busy 50k/s reference); major =
  // saturation (matches the collector's majFaultRate/200 severity contribution).
  lines.push(gauge("minor faults", bar(clamp(minor / 50000)), `${Math.round(minor)} /s`, "served from RAM"));
  lines.push(gauge("major faults", bar(clamp(major / 200)), `${Math.round(major)} /s`, "refault from disk/swap"));
  lines.push(gauge("saturation", bar(m.saturation), `${pctText(m.saturation)}%`));
  lines.push("");
  if (m.pressureAvailable) {
    const some = rate(m.pressureSomeAvg10);
    const full = rate(m.pressureFullAvg10);
    lines.push("$ cat /proc/pressure/memory");
    lines.push(`some avg10=${some.toFixed(2)} avg60=${rate(m.pressureSomeAvg60).toFixed(2)} avg300=${rate(m.pressureSomeAvg300).toFixed(2)}`);
    lines.push(`full avg10=${full.toFixed(2)} avg60=${rate(m.pressureFullAvg60).toFixed(2)} avg300=${rate(m.pressureFullAvg300).toFixed(2)}`);
    lines.push(gauge("some stalls", bar(clamp(some / 20)), `${some.toFixed(2)}%`, "of last 10s   (>10% = sustained)"));
    lines.push(gauge("full stalls", bar(clamp(full / 5)), `${full.toFixed(2)}%`, "of last 10s   (>0 = severe)"));
  } else {
    // No PSI here, so the stall census is rebuilt from the /proc/vmstat events the
    // kernel would have charged that stall time to. The counters are measured; the
    // stall bar is the collector's model — (majflt/s + swapin/s) x disk await, an
    // upper bound on PSI "some" — so it is labelled "est." and never dressed up as
    // kernel output. PSI "full" has no counter-based equivalent at all.
    const refault = rate(m.refaultPagesPerSecond);
    const stall = clamp(rate(m.stallEstimate));
    const counters: [string, number, string][] = [
      ["workingset_refault", refault, "evicted page faulted back (thrash)"],
      ["allocstall", rate(m.directReclaimsPerSecond), "allocator forced into direct reclaim"],
      ["pgscan_direct", rate(m.directScanPagesPerSecond), "pages scanned in direct reclaim"],
      ["pswpin", rate(m.swapInPagesPerSecond), "swap-in reads"],
      ["compact_stall", rate(m.compactStallsPerSecond), "direct-compaction stalls"],
    ];
    lines.push("$ grep -E 'workingset_refault|allocstall|pgscan_direct|pswpin|compact_stall' /proc/vmstat");
    counters.forEach(([name, value, note]) => {
      lines.push(`${name.padEnd(19)}${padStart(String(Math.round(value)), 9)} /s   ${note}`);
    });
    lines.push("");
    lines.push(gauge("reclaim stall", bar(stall), `${pctText(stall)}% est.`, "(majflt+swpin) x await"));
    lines.push(gauge("thrash", bar(clamp(refault / 3000)), `${Math.round(refault)} /s`, "refaults vs 3000/s reference"));
    lines.push("no /proc/pressure/memory on this kernel — PSI stall shares unavailable");
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
  // The two tiers of that aqu-sz total (the Disk IO queue alcove's split): the
  // device queue fills toward its hardware cap and pegs; the scheduler backlog is
  // unbounded and towers over the device tier once the device saturates.
  const devCap = rate(s.deviceQueueCap);
  const devQ = rate(s.deviceQueue);
  const devFill = devCap > 0 ? clamp(devQ / devCap) : clamp(devQ / 32);
  lines.push(`  device q   ${bar(devFill)} ${devQ.toFixed(2)} / ${devCap > 0 ? devCap.toFixed(0) : "?"}  in-flight (capped)`);
  lines.push(`  scheduler  ${bar(clamp(rate(s.schedBacklog) / 8))} ${rate(s.schedBacklog).toFixed(2)}  waiting (unbounded)`);
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
  const rows = devices.slice(0, 5); // top-5, matching the five rain gauges
  rows.forEach((d) => {
    lines.push(
      `${padStart(d.name, 10)}  ${bar(rate(d.iops) / scale)} ${padStart(String(Math.round(rate(d.iops))), 7)}  ${(clamp(d.utilization) * 100).toFixed(0)}%`
    );
  });
  // Pin the block height so the summary below doesn't jump as devices come and go.
  for (let i = rows.length; i < 5; i += 1) lines.push("");
  lines.push("");
  lines.push(`aggregate IOPS  ${Math.round(rate(s.iops))} ops/s   (reads + writes, all devices)`);
  return lines.join("\n");
};

// STORAGE wing — the two-tier IO queue behind the face-7 rack: the DEVICE tier
// (in-flight, hard-capped by the hardware queue depth) vs the SCHEDULER backlog
// (block-layer, effectively unbounded), and which tier the disk is actually bound
// by. A shallow cap (SATA-class) saturates on tag exhaustion — the device rack pegs
// and the scheduler towers; a deep cap (NVMe) rarely exhausts tags, so it saturates
// on %util/await and the scheduler stays near-empty.
const formatStorageQueue = (telemetry: TelemetrySnapshot): string => {
  const s = telemetry.storage;
  const cap = rate(s.deviceQueueCap);
  const dev = rate(s.deviceQueue);
  const sched = rate(s.schedBacklog);
  const total = rate(s.queueDepth);
  const util = clamp(s.utilization);
  const shallow = cap > 0 && cap <= 64;
  const devBar = shallow ? clamp(dev / cap) : clamp(dev / Math.max(total, 1));
  const lines: string[] = [];
  lines.push("$ iostat -x 1   ·   queue detail");
  lines.push("");
  lines.push(`aqu-sz total  ${bar(clamp(total / 8))} ${total.toFixed(2)} reqs`);
  lines.push(`  device q    ${bar(devBar)} ${dev.toFixed(2)} / ${cap > 0 ? cap.toFixed(0) : "?"} reqs  in-flight`);
  lines.push(`  scheduler   ${bar(clamp(sched / Math.max(total, 1)))} ${sched.toFixed(2)} reqs  waiting (unbounded)`);
  lines.push(`%util         ${bar(util)} ${pctText(util)}%   (device busy time)`);
  lines.push("");
  const satBy = shallow
    ? `tag exhaustion — shallow queue (cap ${cap.toFixed(0)}); scheduler backs up`
    : cap > 0
      ? `%util + await — deep queue (cap ${cap.toFixed(0)}); tags rarely exhaust`
      : "%util + await — cap unexposed; occupancy tracks its recent peak";
  lines.push(`saturates by  ${satBy}`);
  return lines.join("\n");
};

// STORAGE wing — the latency causeway read-point: `iostat -x` narrowed to the await
// columns for the worst-await device, split read vs write (the two lanes you walk).
// await = queue wait + service time, the felt latency the causeway drags you at; the
// pair is coherent (both from the one worst device — see the collector). 250 ms full
// scale matches the causeway's stroke period.
const formatStorageAwait = (telemetry: TelemetrySnapshot): string => {
  const s = telemetry.storage;
  const rAwait = rate(s.readAwaitMillis);
  const wAwait = rate(s.writeAwaitMillis);
  const total = rate(s.awaitMillis);
  const columns: [string, number][] = [
    ["Device", 10], ["r_await", 10], ["w_await", 10], ["await", 9], ["%util", 8],
  ];
  const cells = [
    "worst",
    rAwait.toFixed(2),
    wAwait.toFixed(2),
    total.toFixed(2),
    (clamp(s.utilization) * 100).toFixed(1),
  ];
  const lines: string[] = [];
  lines.push("$ iostat -x 1   ·   await (worst device)");
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
  lines.push("");
  lines.push(`read await   ${bar(clamp(rAwait / 250))} ${rAwait.toFixed(2)} ms   (READ lane)`);
  lines.push(`write await  ${bar(clamp(wAwait / 250))} ${wAwait.toFixed(2)} ms   (WRITE lane)`);
  lines.push("");
  lines.push("await = queue wait + service time — the latency each I/O waits.");
  lines.push("The lane you walk drags at its await; the piston beats one");
  lines.push("stroke per completion (faster piston = lower latency).");
  return lines.join("\n");
};

// NETWORK wing — per-interface throughput (`sar -n DEV`), the input to the wing's
// packet-grove lanes. USE utilization is throughput vs link speed; saturation is drops.
//
// The interface list is a STICKY RANKING (updateNetIfaceRank). The collector adds and
// drops interfaces each sample as they cross an activity threshold, which made the raw
// list flicker (interfaces popping in and out and re-sorting by instantaneous rate).
// Instead we REMEMBER every interface once observed and rank by TOTAL bytes seen
// (descending): the order is stable, an interface that goes quiet just shows 0 B/s
// rather than vanishing, and one is only bumped off the shown rows when another accrues
// more overall traffic. Rendered at a FIXED row count so the bars below never reflow.
// Columns: a 2-wide primary marker, the name LEFT-aligned in a fixed field, then
// rxkB/s and txkB/s RIGHT-aligned.
const netInterfaceRows = 6; // rows shown; the ranking tracks up to NET_RANK_TRACK_MAX
const netRow = (marker: string, name: string, rx: string, tx: string): string =>
  `${marker.padStart(2)}${name.slice(0, 15).padEnd(16)}${rx.padStart(9)}${tx.padStart(9)}`;

// Persistent per-interface ranking state for the sar terminal. Keyed to the telemetry
// source, so switching live<->demo (or between sim scenarios) starts a fresh ranking.
// Folded once per snapshot (open + the periodic refresh both call render()); `total`
// accumulates observed traffic (rx+tx per sample, ~bytes at the ~1s cadence) and is the
// sole ranking key. Accumulation advances while the terminal is being viewed and the
// pool persists across opens, so a previously-busiest interface stays on top.
type NetIfaceRank = { name: string; total: number; rx: number; tx: number };
const netIfaceRank = new Map<string, NetIfaceRank>();
let netRankTs = -1;
let netRankSource = "";
const NET_RANK_TRACK_MAX = 32; // bound the remembered pool (well above the rows shown)
const updateNetIfaceRank = (telemetry: TelemetrySnapshot): NetIfaceRank[] => {
  if (telemetry.source !== netRankSource) {
    netIfaceRank.clear();
    netRankSource = telemetry.source;
    netRankTs = -1;
  }
  if (telemetry.updatedAt !== netRankTs) {
    netRankTs = telemetry.updatedAt;
    netIfaceRank.forEach((s) => { s.rx = 0; s.tx = 0; }); // absent from this sample => idle
    (telemetry.network.interfaces ?? []).forEach((iface) => {
      const rx = Math.max(0, rate(iface.rxBytesPerSecond));
      const tx = Math.max(0, rate(iface.txBytesPerSecond));
      const s = netIfaceRank.get(iface.name) ?? { name: iface.name, total: 0, rx: 0, tx: 0 };
      s.rx = rx;
      s.tx = tx;
      s.total += rx + tx;
      netIfaceRank.set(iface.name, s);
    });
    if (netIfaceRank.size > NET_RANK_TRACK_MAX) {
      const keep = [...netIfaceRank.values()].sort((a, b) => b.total - a.total).slice(0, NET_RANK_TRACK_MAX);
      netIfaceRank.clear();
      keep.forEach((s) => netIfaceRank.set(s.name, s));
    }
  }
  return [...netIfaceRank.values()].sort((a, b) => b.total - a.total);
};
const formatNetwork = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const ranked = updateNetIfaceRank(telemetry);
  const rows = ranked.length > 0
    ? ranked.slice(0, netInterfaceRows).map((s) =>
        netRow(
          s.name === n.primaryInterface ? "*" : "",
          s.name,
          String(kib(s.rx)),
          String(kib(s.tx))
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
  lines.push(`primary interface: ${n.primaryInterface ?? "-"}   (* = busiest now; ranked by total seen)`);
  lines.push("");
  lines.push(`utilization  ${bar(n.utilization)} ${pctText(n.utilization)}%   (throughput vs link speed)`);
  lines.push(`saturation   ${bar(n.saturation)} ${pctText(n.saturation)}%   (queue backup + drops)`);
  lines.push(`errors       ${bar(n.errors)} ${pctText(n.errors)}%`);
  // Break the saturation bar into named counters so it isn't a black box, and so
  // PRESSURE and LOSS read distinctly: rx/tx-drops are LOSS (a queue overflowed on the
  // receive vs transmit side), rx/tx-queue are PRESSURE (a queue backing up short of
  // loss — it climbs before drops start). The receive/transmit saturation demos light
  // one direction at a time. (rx-queue = softnet backlog rate; tx-queue = qdisc backlog
  // bytes — both kept generic here, named at their real sources in the collector.
  // tx-queue reads n/a when the qdisc netlink probe returns nothing.)
  const txQueue = n.qdiscBacklogBytes === undefined ? "n/a" : `${kib(n.qdiscBacklogBytes)}K`;
  lines.push("");
  lines.push(`  rx-drops    ${String(Math.round(rate(n.rxDropsPerSecond))).padStart(7)}/s   (receive-side loss)`);
  lines.push(`  tx-drops    ${String(Math.round(rate(n.txDropsPerSecond))).padStart(7)}/s   (transmit-side loss)`);
  lines.push(`  rx-queue    ${String(Math.round(rate(n.softnetSqueezePerSecond))).padStart(7)}/s   (receive backlog — pre-loss)`);
  lines.push(`  tx-queue    ${txQueue.padStart(9)}   (transmit backlog — pre-loss)`);
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

// NETWORK wing — the six directional stage terminals. Each stage of the descending
// hall (socket -> kernel -> NIC) has an RX (left) and TX (right) walk-up terminal,
// and each opens a DIFFERENT real Linux command scoped to that stage+lane's
// saturation. All read the collector snapshot, whose network sources are every one
// world-readable /proc or a no-root netlink dump — so each renders honest output
// with no root and inside container quirks (idle => 0/s, gated => an explicit
// "unavailable/unknown" line, never a blank). See the plan (mighty-petting-unicorn)
// and [[terminal-design-principles]].

const SOCK_FULL = 1024 * 1024; // 1 MiB per-queue full scale for the socket bars

// socket-RX — `ss -tm state established`: the Recv-Q column (bytes received but not
// yet read by the app) plus the socket receive-buffer view `-m` selects. Recv-Q
// backlog = app read lag, the receive-side transport saturation.
const formatNetworkSocketRx = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const recvBytes = Math.max(0, rate(n.recvQueueBytes));
  const top = n.topSockets ?? [];
  // The collector only records sockets with a non-zero queue, so an empty `top` on a
  // healthy host means "nothing backlogged", not "no sockets" — say so from the live
  // TCP census (established count) rather than implying a restricted /proc.
  const estab = Math.max(0, Math.round(rate(n.tcp?.established)));
  const lines: string[] = [];
  lines.push("$ ss -tm state established");
  const columns: [string, number][] = [["Recv-Q", 8], ["Send-Q", 8], ["Local Address:Port", 22], ["Peer Address:Port", 22]];
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  if (top.length === 0) {
    lines.push(estab > 0
      ? `  ${estab} established, none with Recv-Q backlog (all read promptly)`
      : "  no established sockets");
  } else {
    top.slice(0, 6).forEach((socket) => {
      const local = socket.local.length > 21 ? `${socket.local.slice(0, 18)}...` : socket.local;
      const peer = socket.remote.length > 21 ? `${socket.remote.slice(0, 18)}...` : socket.remote;
      const cells = [String(Math.round(socket.recvQueueBytes)), String(Math.round(socket.sendQueueBytes)), local, peer];
      lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
    });
  }
  lines.push("");
  lines.push(`aggregate Recv-Q  ${bar(clamp(recvBytes / SOCK_FULL))} ${padStart(String(kib(recvBytes)), 7)} KiB   inbound (app read lag)`);
  return lines.join("\n");
};

// socket-TX — `ss -to state established`: the Send-Q column (bytes queued in the
// kernel socket buffer awaiting ACK/drain) plus the retransmit `timer:` field `-o`
// selects. Send-Q backlog = drain lag (peer/network not ACKing), the transmit-side
// transport saturation. Retransmit/cwnd counts aren't sampled, so the timer field
// is shown as present/absent rather than fabricated.
const formatNetworkSocketTx = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const sendBytes = Math.max(0, rate(n.sendQueueBytes));
  const backlogged = Math.max(0, Math.round(rate(n.backloggedSockets)));
  const top = n.topSockets ?? [];
  // Empty `top` = nothing backlogged (the collector only samples non-zero queues), not
  // "no sockets": report the live established count instead of implying restricted /proc.
  const estab = Math.max(0, Math.round(rate(n.tcp?.established)));
  const lines: string[] = [];
  lines.push("$ ss -to state established");
  const columns: [string, number][] = [["Recv-Q", 8], ["Send-Q", 8], ["Peer Address:Port", 22], ["Timer", 16]];
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  if (top.length === 0) {
    lines.push(estab > 0
      ? `  ${estab} established, none with Send-Q backlog (all draining)`
      : "  no established sockets");
  } else {
    top.slice(0, 6).forEach((socket) => {
      const peer = socket.remote.length > 21 ? `${socket.remote.slice(0, 18)}...` : socket.remote;
      const timer = socket.sendQueueBytes > 0 ? "timer:(on,-,-)" : "-";
      const cells = [String(Math.round(socket.recvQueueBytes)), String(Math.round(socket.sendQueueBytes)), peer, timer];
      lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
    });
  }
  lines.push("");
  lines.push(`aggregate Send-Q  ${bar(clamp(sendBytes / SOCK_FULL))} ${padStart(String(kib(sendBytes)), 7)} KiB   outbound (drain lag)`);
  lines.push(`backlogged sockets  ${backlogged}   (retransmit/cwnd detail not sampled)`);
  return lines.join("\n");
};

// kernel-TX — `tc -s qdisc show dev <if>`: the root qdisc's backlog (bytes the link
// can't drain yet) via the same netlink source tc uses. qdiscBacklogBytes is a gated
// enrichment: undefined when netlink is unavailable (restricted container), so it
// falls back to the /proc/net/dev tx-drops proxy rather than a fake empty queue.
const QDISC_FULL = 512 * 1024; // netQdiscSatFull (collector)
const formatNetworkKernelTx = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const iface = n.primaryInterface ?? "eth0";
  const txDrops = Math.max(0, Math.round(rate(n.txDropsPerSecond)));
  const lines: string[] = [];
  lines.push(`$ tc -s qdisc show dev ${iface}`);
  if (n.qdiscBacklogBytes === undefined) {
    lines.push("qdisc stats unavailable (netlink) — using /proc/net/dev tx-drops as the proxy.");
    lines.push("");
    lines.push(`tx drops     ${bar(clamp(txDrops / 100))} ${padStart(String(txDrops), 6)} /s   (transmit-side loss)`);
    return lines.join("\n");
  }
  const backlog = Math.max(0, Math.round(n.qdiscBacklogBytes)); // whole bytes, like real tc
  lines.push("qdisc fq_codel 0: root refcnt 2 limit 10240p");
  lines.push(` backlog ${backlog}b (dropped ${txDrops}/s, requeues 0)`);
  lines.push("");
  lines.push(`qdisc backlog  ${bar(clamp(backlog / QDISC_FULL))} ${padStart(String(kib(backlog)), 6)} KiB / 512 KiB`);
  lines.push(`tx drops       ${padStart(String(txDrops), 6)} /s`);
  return lines.join("\n");
};

// NIC-RX — `ip -s link show <if>`: the receive-side error columns (dropped, overrun).
// overrun = the NIC's RX ring overflowed (the hardware couldn't hand packets to the
// kernel fast enough), the receive-side device saturation. Ring depth is a gated
// ethtool enrichment (not probed yet); shown as unknown until it lands. Values are
// the collector's per-second rates (real ip prints cumulative counters).
const formatNetworkNicRx = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const iface = n.primaryInterface ?? "eth0";
  const rxFifo = Math.max(0, Math.round(rate(n.rxFifoPerSecond)));
  const rxDrops = Math.max(0, Math.round(rate(n.rxDropsPerSecond)));
  const ring = n.ringDepthRx === undefined ? "unknown (needs ethtool -g / CAP_NET_ADMIN)" : `${n.ringDepthRx} slots`;
  const lines: string[] = [];
  lines.push(`$ ip -s link show ${iface}`);
  lines.push(`2: ${iface}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500`);
  // Aligned RX block: the prefix ("    RX:" / seven spaces) is the same width on both
  // rows so the value row lines up under the header labels (rates /s).
  lines.push("    RX:" + padStart("errors", 10) + padStart("dropped", 10) + padStart("overrun", 10) + "   (rates /s)");
  lines.push("       " + padStart("0", 10) + padStart(String(rxDrops), 10) + padStart(String(rxFifo), 10));
  lines.push("");
  lines.push(`rx overruns  ${bar(clamp(rxFifo / 100))} ${padStart(String(rxFifo), 6)} /s   ring overflow (receive)`);
  lines.push(`rx drops     ${padStart(String(rxDrops), 6)} /s`);
  lines.push(`rx ring depth: ${ring}`);
  return lines.join("\n");
};

// NIC-TX — `cat /proc/net/dev`: the transmit error columns (drop, fifo). tx fifo =
// the NIC's TX ring overflowed on the way out, the transmit-side device saturation.
// /proc/net/dev is world-readable and present in every container netns, so this one
// is always populated (idle => 0/s). Values shown as per-second rates.
const formatNetworkNicTx = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const iface = n.primaryInterface ?? "eth0";
  const txFifo = Math.max(0, Math.round(rate(n.txFifoPerSecond)));
  const txDrops = Math.max(0, Math.round(rate(n.txDropsPerSecond)));
  const lines: string[] = [];
  lines.push("$ cat /proc/net/dev   (transmit columns, rates /s)");
  // A clean aligned table: header labels and the value row share one column spec so
  // each number sits under its header. errs/colls/carrier aren't sampled per-direction
  // (0 on a healthy link); drop and fifo are the live saturation signals.
  const columns: [string, number][] = [["Iface", 10], ["errs", 8], ["drop", 8], ["fifo", 8], ["colls", 8], ["carrier", 9]];
  const cells = [iface, "0", String(txDrops), String(txFifo), "0", "0"];
  lines.push(columns.map(([label, width]) => padStart(label, width)).join(""));
  lines.push(columns.map(([, width], i) => padStart(cells[i], width)).join(""));
  lines.push("");
  lines.push(`tx fifo overruns  ${bar(clamp(txFifo / 100))} ${padStart(String(txFifo), 6)} /s   ring overflow (transmit)`);
  lines.push(`tx drops          ${padStart(String(txDrops), 6)} /s`);
  if (n.ringDepthTx !== undefined) lines.push(`tx ring depth: ${n.ringDepthTx} slots`);
  return lines.join("\n");
};

// NETWORK wing — softnet decomposition (the Tesla-coil bay). Kernel-RX saturation
// splits into two /proc/net/softnet_stat causes: time_squeeze (NAPI ran out of budget
// with packets pending — the receive path is CPU/softirq-bound) vs backlog drops (the
// per-CPU input queue overflowed). The two electrodes crackle at these rates; this
// screen is how you'd confirm and tell them apart in a shell.
const formatNetworkSoftnet = (telemetry: TelemetrySnapshot): string => {
  const n = telemetry.network;
  const squeeze = Math.max(0, Math.round(rate(n.softnetSqueezePerSecond)));
  const drops = Math.max(0, Math.round(rate(n.softnetDropsPerSecond)));
  const lines: string[] = [];
  lines.push("$ cat /proc/net/softnet_stat   (per-CPU, hex; col2=drops col3=squeeze)");
  lines.push("$ awk '{d+=strtonum(\"0x\"$2);s+=strtonum(\"0x\"$3)}END{print d,s}' \\");
  lines.push("        /proc/net/softnet_stat     (watched as a per-second delta)");
  lines.push("");
  const scale = Math.max(1, squeeze, drops, 50);
  lines.push(`  squeeze  ${bar(clamp(squeeze / scale))} ${padStart(String(squeeze), 6)}/s   NAPI out of budget (RX softirq-bound)`);
  lines.push(`  backlog  ${bar(clamp(drops / scale))} ${padStart(String(drops), 6)}/s   netdev_max_backlog overflow (loss)`);
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
  "memory-reclaim": { title: "MEMORY — reclaim & relief", render: formatMemoryReclaim },
  "memory-faults": { title: "MEMORY — page faults", render: formatMemoryFaults },
  "memory-oom": { title: "MEMORY — OOM errors", render: formatMemoryOom },
  storage: { title: "STORAGE — iostat service & queue", render: formatStorage },
  "storage-usage": { title: "STORAGE — df / capacity", render: formatStorageUsage },
  "storage-iops": { title: "STORAGE — per-device IOPS", render: formatStorageIops },
  "storage-queue": { title: "STORAGE — IO queue (device vs scheduler)", render: formatStorageQueue },
  "storage-await": { title: "STORAGE — latency causeway (r/w await)", render: formatStorageAwait },
  network: { title: "NETWORK — per-interface throughput", render: formatNetwork },
  "network-sockets": { title: "NETWORK — TCP socket state census", render: formatNetworkSockets },
  "network-socket-rx": { title: "NETWORK — socket Recv-Q (RX backpressure)", render: formatNetworkSocketRx },
  "network-socket-tx": { title: "NETWORK — socket Send-Q (TX drain lag)", render: formatNetworkSocketTx },
  "network-softnet": { title: "NETWORK — softnet backlog (kernel RX)", render: formatNetworkSoftnet },
  "network-kernel-tx": { title: "NETWORK — qdisc backlog (kernel TX)", render: formatNetworkKernelTx },
  "network-nic-rx": { title: "NETWORK — NIC RX ring / overrun", render: formatNetworkNicRx },
  "network-nic-tx": { title: "NETWORK — NIC TX fifo / drops", render: formatNetworkNicTx },
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
