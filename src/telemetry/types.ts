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
  minorFaultsPerSecond?: number;
  majorFaultsPerSecond?: number;
  // False on kernels without /proc/pressure/memory (no PSI), so the faults
  // terminal can say "unavailable" instead of showing zeroed stall figures.
  pressureAvailable?: boolean;
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
  // Aggregate completed-operations rate (reads+writes/s) and the per-device
  // breakdown (busiest first) that feed the IOPS counter bank + `iostat -x` term.
  iops?: number;
  devices?: StorageDeviceTelemetry[];
  // Root-filesystem capacity (`df /`) driving the disk-usage cistern. usedRatio
  // is df's capacity fraction (0..1).
  usedBytes?: number;
  totalBytes?: number;
  availBytes?: number;
  usedRatio?: number;
}

export interface StorageDeviceTelemetry {
  name: string;
  iops: number;
  utilization: number;
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

// --- Simulation completeness guards -----------------------------------------
// A sim scenario (src/index.ts `scenarioTelemetry`) hand-builds a snapshot that
// the instrument terminals (src/ui/terminalOverlay.ts) render. If a terminal
// reads a field the sim forgot to set, it reads 0/blank in EVERY sim mode — the
// way the disk df/capacity + IOPS terminals silently regressed when those
// instruments were added. Each alias below pins every field its wing's terminals
// read as REQUIRED, so a synthesized sim branch that omits one fails to compile.
// When a `format*` renderer starts reading a new field, add it to that wing's
// alias here and TS will flag every synth branch that must now set it. (The
// "background" branches for storage/network instead carry the WHOLE live resource
// object, so they're complete by construction and keep the plain interface.)

// Read by formatCores, formatRunQueue, formatUptime.
export type SimCpuTelemetry = CpuTelemetry &
  Required<Pick<CpuTelemetry,
    | "runQueue" | "blocked" | "user" | "system" | "idle" | "iowait" | "steal"
    | "contextSwitchesPerSecond" | "interruptsPerSecond">>;

// Read by formatMemory, formatMemoryRss, formatMemorySwap, formatMemoryFaults,
// formatMemoryOom.
export type SimMemoryTelemetry = MemoryTelemetry &
  Required<Pick<MemoryTelemetry,
    | "totalBytes" | "availableBytes" | "freeBytes" | "buffersBytes" | "cachedBytes"
    | "swapTotalBytes" | "swapFreeBytes" | "swapUsedBytes"
    | "swapInPagesPerSecond" | "swapOutPagesPerSecond" | "swapPagesPerSecond"
    | "minorFaultsPerSecond" | "majorFaultsPerSecond" | "pressureAvailable"
    | "pressureSomeAvg10" | "pressureSomeAvg60" | "pressureSomeAvg300"
    | "pressureFullAvg10" | "pressureFullAvg60" | "pressureFullAvg300"
    | "oomKills" | "oomKillsPerSecond" | "topRss">>;

// Read by formatStorage, formatStorageUsage, formatStorageIops. Applies to the
// disk-sim branch only; the background branch carries live storage.
export type SimStorageTelemetry = StorageTelemetry &
  Required<Pick<StorageTelemetry,
    | "queueDepth" | "awaitMillis" | "readBytesPerSecond" | "writeBytesPerSecond"
    | "iops" | "devices"
    | "usedBytes" | "totalBytes" | "availBytes" | "usedRatio">>;

// Read by formatNetwork, formatNetworkSockets, formatNetworkQueues. Applies to
// the network-sim branch only; the background branch carries live network.
export type SimNetworkTelemetry = NetworkTelemetry &
  Required<Pick<NetworkTelemetry,
    | "rxBytesPerSecond" | "txBytesPerSecond"
    | "primaryInterface" | "interfaces" | "tcp"
    | "recvQueueBytes" | "sendQueueBytes" | "backloggedSockets" | "topSockets">>;

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
  | "memory-faults"
  | "memory-oom"
  | "storage"
  | "storage-usage"
  | "storage-iops"
  | "network"
  | "network-sockets"
  | "network-queues";
