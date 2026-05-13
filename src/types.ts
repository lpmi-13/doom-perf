export type ScenarioId = "cpu" | "memory" | "storage" | "network" | "local";
export type ResourceId = "atrium" | "cpu" | "memory" | "storage" | "network";

export interface Scenario {
  id: ScenarioId;
  title: string;
  subtitle: string;
  resource: string;
}

export interface CoreMetric {
  id: number;
  utilization: number;
  saturation: number;
  frequency: number;
}

export interface Telemetry {
  scenario: ScenarioId;
  mode: "simulation" | "local";
  timestamp: number;
  host: string;
  health: number;
  cpu: {
    utilization: number;
    saturation: number;
    errors: number;
    cores: number;
    load1: number;
    contextSwitchRate: number;
    coreMetrics: CoreMetric[];
  };
  memory: {
    utilization: number;
    saturation: number;
    errors: number;
    totalGb: number;
    usedGb: number;
    availableGb: number;
    swapRate: number;
    composition: {
      cached: number;
      anonymous: number;
      dirty: number;
      pinned: number;
    };
  };
  storage: {
    utilization: number;
    saturation: number;
    errors: number;
    queueDepth: number;
    awaitMs: number;
    readMbps: number;
    writeMbps: number;
    devices: Array<{
      name: string;
      utilization: number;
      queueDepth: number;
      awaitMs: number;
      errors: number;
    }>;
  };
  network: {
    utilization: number;
    saturation: number;
    errors: number;
    rxMbps: number;
    txMbps: number;
    dropsRate: number;
    retransRate: number;
    interfaces: Array<{
      name: string;
      utilization: number;
      rxMbps: number;
      txMbps: number;
      dropsRate: number;
    }>;
  };
  processes: Array<{
    pid: number;
    name: string;
    cpu: number;
    memory: number;
    io: number;
    network: number;
    fd: number;
    resource: string;
  }>;
}

export type RoomKind =
  | "atrium"
  | "corridor"
  | "cpu-cores"
  | "cpu-scheduler"
  | "cpu-cache"
  | "memory-reservoir"
  | "memory-swap"
  | "memory-allocator"
  | "storage-rotor"
  | "storage-latency"
  | "storage-device"
  | "network-conduits"
  | "network-backlog"
  | "network-connections";

export interface LocationInfo {
  id: string;
  title: string;
  wing: string;
  resource: ResourceId;
  kind: RoomKind;
  subtitle: string;
}

export interface MovementInput {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  run: boolean;
}
