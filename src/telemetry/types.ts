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
  swapTotalBytes?: number;
  swapFreeBytes?: number;
  swapUsedBytes?: number;
  swapInPagesPerSecond?: number;
  swapOutPagesPerSecond?: number;
  swapPagesPerSecond?: number;
  pressureSomeAvg10?: number;
  pressureSomeAvg60?: number;
  pressureSomeAvg300?: number;
  pressureSomeTotal?: number;
  pressureFullAvg10?: number;
  pressureFullAvg60?: number;
  pressureFullAvg300?: number;
  pressureFullTotal?: number;
  oomKills?: number;
  oomKillsPerSecond?: number;
  topRss?: MemoryProcessTelemetry[];
}

export interface MemoryProcessTelemetry {
  pid: number;
  rssBytes: number;
  command: string;
}

export interface StorageTelemetry extends ResourceTelemetry {
  queueDepth?: number;
  awaitMillis?: number;
  readBytesPerSecond?: number;
  writeBytesPerSecond?: number;
}

export interface NetworkTelemetry extends ResourceTelemetry {
  rxBytesPerSecond?: number;
  txBytesPerSecond?: number;
  dropsPerSecond?: number;
  errorsPerSecond?: number;
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
  network: NetworkTelemetry;
}

export interface TelemetryClient {
  close: () => void;
}

// Which instrument terminal a sign opens (see src/ui/terminalOverlay.ts). The
// CPU wing's three sub-area screens (cores/runqueue/load) plus one primary screen
// reserved per resource wing. A wing turns its sign on by emitting a matching
// manifest terminal entry from its builder (scripts/lib/wings/<wing>-wing.mjs);
// the overlay already renders each one. Add a sign here + a registry entry in
// terminalOverlay.ts when a wing grows another readable panel.
export type TerminalSign =
  | "cores"
  | "runqueue"
  | "load"
  | "memory"
  | "memory-rss"
  | "memory-swap"
  | "memory-pressure"
  | "memory-oom"
  | "storage"
  | "network";
