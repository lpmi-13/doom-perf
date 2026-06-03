export type TelemetryStatus = "disabled" | "connecting" | "live" | "stale" | "error";

export interface ResourceTelemetry {
  utilization: number;
  saturation: number;
  errors: number;
}

export interface CpuCoreTelemetry {
  id: number;
  utilization: number;
  user?: number;
  system?: number;
  idle?: number;
  iowait?: number;
  steal?: number;
}

export interface CpuTelemetry extends ResourceTelemetry {
  logicalCpus: number;
  runQueuePressure: number;
  loadPressure: number;
  load1: number;
  load5: number;
  load15: number;
  cores: CpuCoreTelemetry[];
  // vmstat-style detail (present when served by the Go collector).
  runQueue?: number;
  blocked?: number;
  user?: number;
  system?: number;
  idle?: number;
  iowait?: number;
  steal?: number;
  contextSwitchesPerSecond?: number;
  interruptsPerSecond?: number;
}

export interface MemoryTelemetry extends ResourceTelemetry {
  totalBytes?: number;
  availableBytes?: number;
  freeBytes?: number;
  buffersBytes?: number;
  cachedBytes?: number;
  swapUsedBytes?: number;
  swapInPagesPerSecond?: number;
  swapOutPagesPerSecond?: number;
}

export interface StorageTelemetry extends ResourceTelemetry {
  readBytesPerSecond?: number;
  writeBytesPerSecond?: number;
}

export interface TelemetrySnapshot {
  status: TelemetryStatus;
  source: string;
  updatedAt: number;
  host: string;
  health: number;
  uptimeSeconds?: number;
  cpu: CpuTelemetry;
  memory: MemoryTelemetry;
  storage: StorageTelemetry;
  network: ResourceTelemetry;
}

export interface TelemetryClient {
  close: () => void;
}

// Which instrument terminal a sign opens (see src/ui/terminalOverlay.ts).
export type TerminalSign = "cores" | "runqueue" | "load";
