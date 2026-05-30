export type TelemetryStatus = "disabled" | "connecting" | "live" | "stale" | "error";

export interface ResourceTelemetry {
  utilization: number;
  saturation: number;
  errors: number;
}

export interface CpuCoreTelemetry {
  id: number;
  utilization: number;
}

export interface CpuTelemetry extends ResourceTelemetry {
  logicalCpus: number;
  runQueuePressure: number;
  loadPressure: number;
  load1: number;
  load5: number;
  load15: number;
  cores: CpuCoreTelemetry[];
}

export interface HudTelemetry {
  status: TelemetryStatus;
  source: string;
  updatedAt: number;
  host: string;
  health: number;
  cpu: CpuTelemetry;
  memory: ResourceTelemetry;
  storage: ResourceTelemetry;
  network: ResourceTelemetry;
}

export interface TelemetryClient {
  close: () => void;
}

const emptyResource: ResourceTelemetry = {
  utilization: 0,
  saturation: 0,
  errors: 0,
};

const emptyCpu: CpuTelemetry = {
  ...emptyResource,
  logicalCpus: 0,
  runQueuePressure: 0,
  loadPressure: 0,
  load1: 0,
  load5: 0,
  load15: 0,
  cores: [],
};

const resourceAliases = {
  cpu: ["cpu"],
  memory: ["memory", "mem"],
  storage: ["storage", "disk", "dsk"],
  network: ["network", "net"],
} as const;

type ResourceName = keyof typeof resourceAliases;

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const ratio = (value: unknown, fallback = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value > 1) {
    return clamp(value / 100);
  }
  return clamp(value);
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const findResourceSource = (payload: Record<string, unknown>, resource: ResourceName): unknown => {
  for (const alias of resourceAliases[resource]) {
    if (payload[alias] !== undefined) {
      return payload[alias];
    }
  }

  const containers = [payload.resources, payload.metrics, payload.use];
  for (const container of containers) {
    const obj = objectValue(container);
    if (!obj) {
      continue;
    }
    for (const alias of resourceAliases[resource]) {
      if (obj[alias] !== undefined) {
        return obj[alias];
      }
    }
  }

  return undefined;
};

const readResource = (payload: Record<string, unknown>, resource: ResourceName): ResourceTelemetry => {
  const source = findResourceSource(payload, resource);
  const numeric = numberValue(source);
  if (numeric !== undefined) {
    return {
      utilization: ratio(numeric),
      saturation: 0,
      errors: 0,
    };
  }

  const obj = objectValue(source);
  if (!obj) {
    return emptyResource;
  }

  return {
    utilization: ratio(obj.utilization ?? obj.util ?? obj.used_pct ?? obj.usedPct ?? obj.value),
    saturation: ratio(obj.saturation ?? obj.sat ?? obj.queue ?? obj.queue_pct ?? obj.queuePct),
    errors: ratio(obj.errors ?? obj.error ?? obj.err ?? obj.error_pct ?? obj.errorPct),
  };
};

const readCpu = (payload: Record<string, unknown>): CpuTelemetry => {
  const resource = readResource(payload, "cpu");
  const source = objectValue(findResourceSource(payload, "cpu"));
  const cores = Array.isArray(source?.cores)
    ? source.cores.flatMap((value, index) => {
        const core = objectValue(value);
        const utilization = core ? numberValue(core.utilization ?? core.util ?? core.value) : numberValue(value);
        const id = core ? numberValue(core.id ?? core.cpu ?? core.core) : index;
        if (utilization === undefined || id === undefined || id < 0) {
          return [];
        }
        return [{ id: Math.trunc(id), utilization: ratio(utilization) }];
      })
    : [];
  const logicalCpus = source ? numberValue(source.logicalCpus ?? source.logicalCPUs) : undefined;
  const loadAverage = (value: unknown): number => Math.max(0, numberValue(value) ?? 0);

  return {
    ...resource,
    logicalCpus: logicalCpus === undefined ? cores.length : Math.max(0, Math.trunc(logicalCpus)),
    runQueuePressure: ratio(source?.runQueuePressure ?? resource.saturation),
    loadPressure: ratio(source?.loadPressure ?? resource.saturation),
    load1: loadAverage(source?.load1),
    load5: loadAverage(source?.load5),
    load15: loadAverage(source?.load15),
    cores,
  };
};

const unwrapPayload = (payload: unknown): Record<string, unknown> | undefined => {
  const obj = objectValue(payload);
  if (!obj) {
    return undefined;
  }
  const telemetry = objectValue(obj.telemetry);
  if (telemetry) {
    return telemetry;
  }
  const data = objectValue(obj.data);
  if (data) {
    return data;
  }
  return obj;
};

const normalizeTelemetry = (
  payload: unknown,
  source: string,
  status: TelemetryStatus = "live"
): HudTelemetry | undefined => {
  const obj = unwrapPayload(payload);
  if (!obj) {
    return undefined;
  }

  const cpu = readCpu(obj);
  const memory = readResource(obj, "memory");
  const storage = readResource(obj, "storage");
  const network = readResource(obj, "network");
  const worst = Math.max(
    cpu.utilization,
    cpu.saturation,
    cpu.errors,
    memory.utilization,
    memory.saturation,
    memory.errors,
    storage.utilization,
    storage.saturation,
    storage.errors,
    network.utilization,
    network.saturation,
    network.errors
  );

  const timestamp = numberValue(obj.timestamp) ?? Date.now();
  const hostValue = obj.host;
  return {
    status,
    source,
    updatedAt: timestamp,
    host: typeof hostValue === "string" && hostValue ? hostValue : window.location.hostname,
    health: ratio(obj.health, clamp(1 - worst)),
    cpu,
    memory,
    storage,
    network,
  };
};

const emptyTelemetry = (source: string, status: TelemetryStatus): HudTelemetry => ({
  status,
  source,
  updatedAt: Date.now(),
  host: window.location.hostname,
  health: 0,
  cpu: emptyCpu,
  memory: emptyResource,
  storage: emptyResource,
  network: emptyResource,
});

const parseMessage = (data: string): unknown | undefined => {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
};

export const resolveTelemetrySource = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("telemetry") ?? params.get("telemetryUrl");
  if (!raw) {
    return "http://127.0.0.1:9999/telemetry";
  }
  const value = raw.trim();
  if (!value || /^(0|false|off|none|disabled)$/i.test(value)) {
    return null;
  }
  return value;
};

export const createTelemetryClient = (
  source: string | null,
  onTelemetry: (telemetry: HudTelemetry) => void
): TelemetryClient => {
  if (!source) {
    onTelemetry(emptyTelemetry("disabled", "disabled"));
    return { close: () => undefined };
  }

  let lastTelemetry: HudTelemetry | undefined;

  const publish = (telemetry: HudTelemetry) => {
    lastTelemetry = telemetry;
    onTelemetry(telemetry);
  };

  const publishStatus = (status: TelemetryStatus) => {
    publish({
      ...(lastTelemetry ?? emptyTelemetry(source, status)),
      status,
      source,
      updatedAt: Date.now(),
    });
  };

  publishStatus("connecting");
  const events = new EventSource(source);
  events.addEventListener("open", () => publishStatus("live"));
  const handleMessage = (event: Event) => {
    const message = event as MessageEvent;
    const telemetry = normalizeTelemetry(parseMessage(String(message.data)), source, "live");
    if (telemetry) {
      publish(telemetry);
    }
  };
  events.addEventListener("telemetry", handleMessage);
  events.addEventListener("message", handleMessage);
  events.addEventListener("error", () => publishStatus("error"));

  return {
    close: () => {
      events.close();
    },
  };
};

// ---------------------------------------------------------------------------
// Interactive instrument terminal: an on-demand overlay that renders live
// telemetry as if it were the output of a Linux diagnostic command. Opened by
// pressing USE/space near an instrument sign (see src/index.ts).
// ---------------------------------------------------------------------------

export type TerminalSign = "cores" | "runqueue" | "load";

const pctText = (value: number) => `${Math.round(clamp(value) * 100)}`;
const padStart = (text: string, width: number) => text.padStart(width, " ");
const bar = (value: number, width = 20) => {
  const filled = Math.round(clamp(value) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
};

const formatCores = (cpu: CpuTelemetry): string => {
  const count = cpu.logicalCpus || cpu.cores.length;
  const lines: string[] = [];
  lines.push("$ mpstat -P ALL 1 1");
  lines.push(`Linux doomperf-lab   (${count} CPU)`);
  lines.push("");
  lines.push("CPU     %busy    %idle");
  const allBusy = Math.round(clamp(cpu.utilization) * 100);
  lines.push(`all  ${padStart(String(allBusy), 7)}  ${padStart(String(100 - allBusy), 7)}`);
  const cores = cpu.cores.length ? cpu.cores : Array.from({ length: count }, (_, id) => ({ id, utilization: 0 }));
  cores.slice(0, 16).forEach(({ id, utilization }) => {
    const busy = Math.round(clamp(utilization) * 100);
    lines.push(`${padStart(String(id), 3)}  ${padStart(String(busy), 7)}  ${padStart(String(100 - busy), 7)}`);
  });
  return lines.join("\n");
};

const formatRunQueue = (cpu: CpuTelemetry): string => {
  const count = cpu.logicalCpus || cpu.cores.length || 1;
  const runnable = Math.max(count, Math.round(count * (1 + cpu.runQueuePressure)));
  const lines: string[] = [];
  lines.push("$ vmstat 1 2");
  lines.push("procs -----------cpu-----------");
  lines.push(" r   logical   saturation");
  lines.push(`${padStart(String(runnable), 2)}   ${padStart(String(count), 7)}   ${padStart(pctText(cpu.saturation) + "%", 9)}`);
  lines.push("");
  lines.push(`run queue pressure  ${bar(cpu.runQueuePressure)} ${pctText(cpu.runQueuePressure)}%`);
  lines.push(`load overcommit     ${bar(cpu.loadPressure)} ${pctText(cpu.loadPressure)}%`);
  return lines.join("\n");
};

const formatUptime = (cpu: CpuTelemetry): string => {
  const count = cpu.logicalCpus || cpu.cores.length || 1;
  const lines: string[] = [];
  lines.push("$ uptime");
  lines.push(
    `load average: ${cpu.load1.toFixed(2)}, ${cpu.load5.toFixed(2)}, ${cpu.load15.toFixed(2)}`
  );
  lines.push("");
  lines.push(`logical CPUs: ${count}   (full bar = ${count * 2})`);
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

const renderTerminal = (sign: TerminalSign, telemetry: HudTelemetry): string => {
  if (sign === "cores") return formatCores(telemetry.cpu);
  if (sign === "runqueue") return formatRunQueue(telemetry.cpu);
  return formatUptime(telemetry.cpu);
};

export const createTerminalOverlay = () => {
  const panel = document.createElement("aside");
  panel.className = "doomTerminal";
  panel.style.display = "none";
  panel.innerHTML = `<header class="doomTerminal__bar"></header><pre class="doomTerminal__body"></pre><footer class="doomTerminal__hint">[space] or [esc] to close</footer>`;

  const style = document.createElement("style");
  style.textContent = `
    .doomTerminal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 10;
      width: 560px;
      max-width: 90vw;
      border: 2px solid #2f7a2f;
      background: rgba(2, 10, 2, 0.94);
      color: #51e07a;
      font: 14px/1.45 "DejaVu Sans Mono", "Courier New", monospace;
      box-shadow: 0 0 0 2px #000, 0 0 24px rgba(40, 255, 120, 0.25);
      image-rendering: pixelated;
    }
    .doomTerminal__bar {
      background: #103a10;
      color: #b6ffcb;
      padding: 5px 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      font-size: 12px;
      border-bottom: 1px solid #2f7a2f;
    }
    .doomTerminal__body {
      margin: 0;
      padding: 12px 14px;
      white-space: pre;
      overflow-x: auto;
    }
    .doomTerminal__hint {
      padding: 5px 10px;
      font-size: 11px;
      color: #2f9a4f;
      border-top: 1px solid #1d4d1d;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  const bar = panel.querySelector(".doomTerminal__bar") as HTMLElement;
  const body = panel.querySelector(".doomTerminal__body") as HTMLElement;
  let current: TerminalSign | null = null;

  return {
    isOpen: () => current !== null,
    open(sign: TerminalSign, telemetry: HudTelemetry) {
      current = sign;
      bar.textContent = terminalTitle[sign];
      body.textContent = renderTerminal(sign, telemetry);
      panel.style.display = "block";
    },
    update(telemetry: HudTelemetry) {
      if (current) {
        body.textContent = renderTerminal(current, telemetry);
      }
    },
    close() {
      current = null;
      panel.style.display = "none";
    },
  };
};
