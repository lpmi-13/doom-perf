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

const terminalTitle: Record<TerminalSign, string> = {
  cores: "CPU CORES — per-core utilization",
  runqueue: "RUN QUEUE — scheduler saturation",
  load: "LOAD AVERAGE — 1m / 5m / 15m",
};

const renderTerminal = (sign: TerminalSign, telemetry: TelemetrySnapshot): string => {
  if (sign === "cores") return formatCores(telemetry);
  if (sign === "runqueue") return formatRunQueue(telemetry);
  return formatUptime(telemetry);
};

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
      bar.textContent = terminalTitle[sign];
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
