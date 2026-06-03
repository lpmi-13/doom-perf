// Payload normalization: turn whatever shape a telemetry source emits into a
// stable TelemetrySnapshot. Tolerant of missing/aliased fields and percentages
// given as either 0..1 or 0..100.
import type {
  CpuTelemetry,
  MemoryTelemetry,
  ResourceTelemetry,
  StorageTelemetry,
  TelemetrySnapshot,
  TelemetryStatus,
} from "./types";

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

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

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
  const cores = source && Array.isArray(source.cores)
    ? source.cores.flatMap((value, index) => {
        const core = objectValue(value);
        const utilization = core ? numberValue(core.utilization ?? core.util ?? core.value) : numberValue(value);
        const id = core ? numberValue(core.id ?? core.cpu ?? core.core) : index;
        if (utilization === undefined || id === undefined || id < 0) {
          return [];
        }
        return [{
          id: Math.trunc(id),
          utilization: ratio(utilization),
          user: core ? numberValue(core.user) : undefined,
          system: core ? numberValue(core.system) : undefined,
          idle: core ? numberValue(core.idle) : undefined,
          iowait: core ? numberValue(core.iowait) : undefined,
          steal: core ? numberValue(core.steal) : undefined,
        }];
      })
    : [];
  const logicalCpus = source ? numberValue(source.logicalCpus ?? source.logicalCPUs) : undefined;
  const loadAverage = (value: unknown): number => Math.max(0, numberValue(value) ?? 0);

  const num = (value: unknown): number | undefined => (source ? numberValue(value) : undefined);
  return {
    ...resource,
    logicalCpus: logicalCpus === undefined ? cores.length : Math.max(0, Math.trunc(logicalCpus)),
    runQueuePressure: ratio(source?.runQueuePressure ?? resource.saturation),
    loadPressure: ratio(source?.loadPressure ?? resource.saturation),
    load1: loadAverage(source?.load1),
    load5: loadAverage(source?.load5),
    load15: loadAverage(source?.load15),
    cores,
    runQueue: num(source?.runQueue),
    blocked: num(source?.blocked),
    user: num(source?.user),
    system: num(source?.system),
    idle: num(source?.idle),
    iowait: num(source?.iowait),
    steal: num(source?.steal),
    contextSwitchesPerSecond: num(source?.contextSwitchesPerSecond),
    interruptsPerSecond: num(source?.interruptsPerSecond),
  };
};

const readMemory = (payload: Record<string, unknown>): MemoryTelemetry => {
  const base = readResource(payload, "memory");
  const source = objectValue(findResourceSource(payload, "memory"));
  if (!source) {
    return base;
  }
  return {
    ...base,
    totalBytes: numberValue(source.totalBytes),
    availableBytes: numberValue(source.availableBytes),
    freeBytes: numberValue(source.freeBytes),
    buffersBytes: numberValue(source.buffersBytes),
    cachedBytes: numberValue(source.cachedBytes),
    swapUsedBytes: numberValue(source.swapUsedBytes),
    swapInPagesPerSecond: numberValue(source.swapInPagesPerSecond),
    swapOutPagesPerSecond: numberValue(source.swapOutPagesPerSecond),
  };
};

const readStorage = (payload: Record<string, unknown>): StorageTelemetry => {
  const base = readResource(payload, "storage");
  const source = objectValue(findResourceSource(payload, "storage"));
  if (!source) {
    return base;
  }
  return {
    ...base,
    readBytesPerSecond: numberValue(source.readBytesPerSecond),
    writeBytesPerSecond: numberValue(source.writeBytesPerSecond),
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

export const normalizeTelemetry = (
  payload: unknown,
  source: string,
  status: TelemetryStatus = "live"
): TelemetrySnapshot | undefined => {
  const obj = unwrapPayload(payload);
  if (!obj) {
    return undefined;
  }

  const cpu = readCpu(obj);
  const memory = readMemory(obj);
  const storage = readStorage(obj);
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
    uptimeSeconds: numberValue(obj.uptimeSeconds),
    cpu,
    memory,
    storage,
    network,
  };
};

export const emptyTelemetry = (source: string, status: TelemetryStatus): TelemetrySnapshot => ({
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

export const parseMessage = (data: string): unknown | undefined => {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
};
