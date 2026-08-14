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
  // terminal can omit the stall census instead of showing zeroed figures.
  pressureAvailable?: boolean;
  pressureSomeAvg10?: number;
  pressureSomeAvg60?: number;
  pressureSomeAvg300?: number;
  pressureSomeTotal?: number;
  pressureFullAvg10?: number;
  pressureFullAvg60?: number;
  pressureFullAvg300?: number;
  pressureFullTotal?: number;
  // /proc/vmstat rates for the events the kernel charges PSI memory-stall time to
  // (thrashing refaults, direct reclaim, its scan work, direct compaction). They
  // stand in for the stall census on kernels where pressureAvailable is false.
  refaultPagesPerSecond?: number;
  directReclaimsPerSecond?: number;
  directScanPagesPerSecond?: number;
  compactStallsPerSecond?: number;
  // Page-frame reclaim throughput — the sar -B pgscank/pgscand/pgsteal columns.
  // scanPagesPerSecond is ALL scanning (kswapd + direct), so directScanPagesPerSecond
  // above is a subset of it. %vmeff = steal/scan is derived at render time, not
  // carried here: with no scanning the ratio is UNDEFINED, not zero, and rendering a
  // bare 0% would read as "reclaim is totally ineffective" when it means "reclaim did
  // not need to run" — the opposite conclusion. See reclaimEfficiency() in
  // terminalOverlay.ts, which returns undefined for that case.
  scanPagesPerSecond?: number;
  stealPagesPerSecond?: number;
  // Modelled 0..1 stand-in for PSI some/avg10 — (majflt/s + swapin/s) x disk await,
  // an upper bound on the real stall share. An estimate: never present it as a
  // kernel-reported PSI figure.
  stallEstimate?: number;
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
  // aqu-sz: the average TOTAL queue length (waiting + in-service). Still drives
  // the tower circuit; the two-tier split below feeds the Disk IO queue alcove.
  queueDepth?: number;
  // deviceQueue    = in-flight requests at the hardware (diskstats field 9),
  //                  hard-capped by deviceQueueCap.
  // deviceQueueCap = device hardware queue depth (/sys/block/<dev>/device/queue_depth);
  //                  0 when the device does not expose it (NVMe/virtio/cloud).
  // schedBacklog   = requests still waiting in the block-layer scheduler queue
  //                  (aqu-sz - in-flight, clamped >= 0); effectively unbounded.
  deviceQueue?: number;
  deviceQueueCap?: number;
  schedBacklog?: number;
  awaitMillis?: number;
  // r_await / w_await (avg ms per read / per write) for the worst-await device —
  // the same device awaitMillis is taken from, so the pair is coherent. These
  // drive the storage wing's two-lane latency causeway (read lane / write lane).
  readAwaitMillis?: number;
  writeAwaitMillis?: number;
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
  // dropsPerSecond is the aggregate (rx+tx) drop rate driving the USE Saturation
  // bar; rx/txDropsPerSecond split it by direction so receive-side (backlog / rx-ring
  // exhaustion) vs transmit-side (qdisc / txqueue) saturation reads distinctly. The
  // network terminal names both; the RX-drop / TX-drop demo modes fire only one.
  dropsPerSecond?: number;
  rxDropsPerSecond?: number;
  txDropsPerSecond?: number;
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
  // Three-lock canal signals (NETWORK_CANAL_PLAN.md). Ring-lock overruns (per-second
  // /proc/net/dev fifo rates) and kernel-lock RX backlog (per-second softnet drops +
  // time_squeeze) are always present. Ring depth (ethtool) and qdisc backlog (tc) are
  // gated enrichments: `undefined` = unknown, which draws the honest fallback (ring
  // brim omitted; kernel-TX uses a tx-drop proxy). ?ring=off / ?qdisc=off force it.
  rxFifoPerSecond?: number;
  txFifoPerSecond?: number;
  softnetDropsPerSecond?: number;
  softnetSqueezePerSecond?: number;
  // Aggregate link capacity (bits/s); lets the lanes scale to % of the real link rate.
  linkCapacityBps?: number;
  ringDepthRx?: number;
  ringDepthTx?: number;
  qdiscBacklogBytes?: number;
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

// Read by formatMemory, formatMemoryRss, formatMemoryReclaim, formatMemoryFaults,
// formatMemoryOom.
export type SimMemoryTelemetry = MemoryTelemetry &
  Required<Pick<MemoryTelemetry,
    | "totalBytes" | "availableBytes" | "freeBytes" | "buffersBytes" | "cachedBytes"
    | "swapTotalBytes" | "swapFreeBytes" | "swapUsedBytes"
    | "swapInPagesPerSecond" | "swapOutPagesPerSecond" | "swapPagesPerSecond"
    | "minorFaultsPerSecond" | "majorFaultsPerSecond" | "pressureAvailable"
    | "pressureSomeAvg10" | "pressureSomeAvg60" | "pressureSomeAvg300"
    | "pressureFullAvg10" | "pressureFullAvg60" | "pressureFullAvg300"
    | "refaultPagesPerSecond" | "directReclaimsPerSecond" | "directScanPagesPerSecond"
    | "compactStallsPerSecond" | "stallEstimate"
    | "scanPagesPerSecond" | "stealPagesPerSecond"
    | "oomKills" | "oomKillsPerSecond" | "topRss">>;

// Read by formatStorage, formatStorageUsage, formatStorageIops. Applies to the
// disk-sim branch only; the background branch carries live storage.
export type SimStorageTelemetry = StorageTelemetry &
  Required<Pick<StorageTelemetry,
    | "queueDepth" | "deviceQueue" | "deviceQueueCap" | "schedBacklog"
    | "awaitMillis" | "readAwaitMillis" | "writeAwaitMillis"
    | "readBytesPerSecond" | "writeBytesPerSecond"
    | "iops" | "devices"
    | "usedBytes" | "totalBytes" | "availBytes" | "usedRatio">>;

// Read by formatNetwork, formatNetworkSockets, formatNetworkQueues. Applies to
// the network-sim branch only; the background branch carries live network.
export type SimNetworkTelemetry = NetworkTelemetry &
  Required<Pick<NetworkTelemetry,
    | "rxBytesPerSecond" | "txBytesPerSecond"
    // Directional drop rates the network terminal names line-by-line: required so
    // both sim branches synthesize them (the RX-drop / TX-drop demo modes fire one).
    | "rxDropsPerSecond" | "txDropsPerSecond"
    | "primaryInterface" | "interfaces" | "tcp"
    | "recvQueueBytes" | "sendQueueBytes" | "backloggedSockets" | "topSockets"
    // Canal lock inputs the engine feeds from the effective snapshot: requiring them
    // here forces BOTH network sim branches to synthesize the full set, so the locks
    // animate in demo (the way the disk IOPS/df terminals regressed when unpinned).
    | "rxFifoPerSecond" | "txFifoPerSecond"
    | "softnetDropsPerSecond" | "softnetSqueezePerSecond">>;

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
  | "memory-reclaim"
  | "memory-faults"
  | "memory-oom"
  | "storage"
  | "storage-usage"
  | "storage-iops"
  | "storage-queue"
  | "storage-await"
  | "network"
  | "network-sockets"
  | "network-queues";
