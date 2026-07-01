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
  // Kernel OOM "badness" (/proc/<pid>/oom_score, ~0..1000): how likely this
  // process is to be the OOM killer's next victim. Drives the memory wing's
  // barrel glow (brighter = closer to being OOM-killed).
  oomScore?: number;
}

export interface StorageTelemetry extends ResourceTelemetry {
  queueDepth?: number;
  awaitMillis?: number;
  readBytesPerSecond?: number;
  writeBytesPerSecond?: number;
}

export interface NetworkInterfaceTelemetry {
  name: string;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
}

// TCP socket census by state (from /proc/net/tcp{,6}). Drives the socket-state
// patch-panel wall and the `ss -s`-style sockets terminal.
export interface TcpStateTelemetry {
  established?: number;
  synSent?: number;
  synRecv?: number;
  finWait1?: number;
  finWait2?: number;
  timeWait?: number;
  close?: number;
  closeWait?: number;
  lastAck?: number;
  listen?: number;
  closing?: number;
  total?: number;
}

// One backlogged socket for the SendQ/RecvQ terminal's top list.
export interface SocketTelemetry {
  local: string;
  remote: string;
  state: string;
  sendQueueBytes: number;
  recvQueueBytes: number;
}

export interface NetworkTelemetry extends ResourceTelemetry {
  rxBytesPerSecond?: number;
  txBytesPerSecond?: number;
  dropsPerSecond?: number;
  errorsPerSecond?: number;
  // Noisiest real NIC this sample + the per-interface breakdown (busiest first);
  // the packet grove binds to the primary interface rather than the aggregate.
  primaryInterface?: string;
  interfaces?: NetworkInterfaceTelemetry[];
  // TCP socket state census + send/recv-queue backlog from /proc/net/tcp{,6}.
  tcp?: TcpStateTelemetry;
  sendQueueBytes?: number;
  recvQueueBytes?: number;
  backloggedSockets?: number;
  topSockets?: SocketTelemetry[];
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
  | "network"
  | "network-sockets"
  | "network-queues";
