import "./styles.css";
import { DoomRenderer } from "./renderer";
import { clamp } from "./palette";
import type { LocationInfo, MovementInput, ResourceId, Scenario, ScenarioId, Telemetry } from "./types";

const scenarioFacing: Record<ScenarioId, ResourceId> = {
  cpu: "cpu",
  memory: "memory",
  storage: "storage",
  network: "network",
  local: "atrium"
};
const resourceJumps: Record<string, ResourceId> = {
  "0": "atrium",
  "1": "cpu",
  "2": "memory",
  "3": "storage",
  "4": "network"
};

let scenarios: Scenario[] = [];
let eventSource: EventSource | null = null;
let telemetry: Telemetry | null = null;
let currentScenario: ScenarioId | null = null;
let pendingScenario: ScenarioId | null = null;
let currentLocation: LocationInfo;
let automap = false;
let lastPanelSignature = "";
let lastFrameAt = performance.now();
const keys = new Set<string>();

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = `
  <main class="shell">
    <section class="splash" data-role="splash">
      <div class="splash__copy">
        <p class="eyebrow">USE Methodology Explorer</p>
        <h1>Doom Perf</h1>
        <p class="lede">Walk a Doom-style diagnostics lab where resource utilization, saturation, and errors become architecture.</p>
      </div>
      <div class="scenarioGrid" data-role="scenario-grid"></div>
      <div class="sseNote">
        <strong>SSE fit:</strong> telemetry is server-to-browser only, so EventSource keeps the app simpler than custom WebSockets. Vite still uses its own WebSocket for hot module reloads.
      </div>
    </section>

    <section class="guide is-hidden" data-role="guide">
      <div class="guide__copy">
        <p class="eyebrow">Navigation</p>
        <h1>Controls</h1>
        <p class="lede" data-role="guide-scenario">Choose a scenario, then use these keys to move through the diagnostics lab.</p>
      </div>
      <div class="keyGrid">
        <div class="keyCard">
          <kbd>W</kbd><kbd>S</kbd>
          <strong>Walk</strong>
          <span>Move forward and backward through corridors and doorways.</span>
        </div>
        <div class="keyCard">
          <kbd>A</kbd><kbd>D</kbd>
          <strong>Turn</strong>
          <span>Rotate left and right like a classic first-person lab walk.</span>
        </div>
        <div class="keyCard">
          <kbd>Q</kbd><kbd>E</kbd>
          <strong>Strafe</strong>
          <span>Step sideways while keeping your view direction.</span>
        </div>
        <div class="keyCard">
          <kbd>Shift</kbd>
          <strong>Move Faster</strong>
          <span>Hold while walking to cross long wings more quickly.</span>
        </div>
        <div class="keyCard">
          <kbd>Tab</kbd>
          <strong>Automap</strong>
          <span>Toggle the top-down map showing every room, doorway, and your avatar.</span>
        </div>
        <div class="keyCard">
          <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd>
          <strong>Jump To Wings</strong>
          <span>Optional shortcuts to CPU, memory, storage, and network entrances.</span>
        </div>
      </div>
      <div class="guideActions">
        <button class="primaryButton" data-action="start-guide" type="button">Start Exploring</button>
        <button class="secondaryButton" data-action="guide-back" type="button">Back to Scenarios</button>
      </div>
    </section>

    <section class="experience is-hidden" data-role="experience">
      <canvas class="viewport" data-role="viewport" aria-label="Doom-style diagnostics viewport"></canvas>
      <aside class="panel">
        <div class="panel__top">
          <div>
            <p class="eyebrow" data-role="scenario-label">No scenario</p>
            <h2 data-role="room-title">Atrium</h2>
            <p class="roomHint" data-role="room-hint"></p>
          </div>
          <button class="iconButton" data-action="splash" title="Change scenario" aria-label="Change scenario">ESC</button>
        </div>
        <div class="bars" data-role="bars"></div>
        <div class="readout" data-role="readout"></div>
        <div class="processes">
          <h3>Processes</h3>
          <div data-role="process-list"></div>
        </div>
        <div class="controls">
          <span>W/S walk</span>
          <span>A/D turn</span>
          <span>Q/E strafe</span>
          <span>Tab automap</span>
        </div>
      </aside>
      <footer class="statusBar" data-role="status"></footer>
    </section>
  </main>
`;

const splash = app.querySelector<HTMLElement>('[data-role="splash"]')!;
const guide = app.querySelector<HTMLElement>('[data-role="guide"]')!;
const experience = app.querySelector<HTMLElement>('[data-role="experience"]')!;
const canvas = app.querySelector<HTMLCanvasElement>('[data-role="viewport"]')!;
const scenarioGrid = app.querySelector<HTMLElement>('[data-role="scenario-grid"]')!;
const guideScenario = app.querySelector<HTMLElement>('[data-role="guide-scenario"]')!;
const bars = app.querySelector<HTMLElement>('[data-role="bars"]')!;
const readout = app.querySelector<HTMLElement>('[data-role="readout"]')!;
const processList = app.querySelector<HTMLElement>('[data-role="process-list"]')!;
const status = app.querySelector<HTMLElement>('[data-role="status"]')!;
const scenarioLabel = app.querySelector<HTMLElement>('[data-role="scenario-label"]')!;
const roomTitle = app.querySelector<HTMLElement>('[data-role="room-title"]')!;
const roomHint = app.querySelector<HTMLElement>('[data-role="room-hint"]')!;
const renderer = new DoomRenderer(canvas);
currentLocation = renderer.getLocation();

function pct(value: number) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function fmt(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(digits);
}

async function loadScenarios() {
  const response = await fetch("/api/scenarios");
  scenarios = await response.json();
  scenarioGrid.innerHTML = scenarios
    .map(
      (scenario) => `
        <button class="scenarioCard" data-scenario="${scenario.id}">
          <span>${scenario.resource}</span>
          <strong>${scenario.title}</strong>
          <small>${scenario.subtitle}</small>
        </button>
      `
    )
    .join("");
}

function startScenario(id: ScenarioId) {
  eventSource?.close();
  pendingScenario = null;
  currentScenario = id;
  renderer.reset(scenarioFacing[id]);
  currentLocation = renderer.getLocation();
  lastPanelSignature = "";
  keys.clear();
  telemetry = null;
  splash.classList.add("is-hidden");
  guide.classList.add("is-hidden");
  experience.classList.remove("is-hidden");
  scenarioLabel.textContent = scenarios.find((scenario) => scenario.id === id)?.title ?? id;
  eventSource = new EventSource(`/api/telemetry?scenario=${encodeURIComponent(id)}`);
  eventSource.addEventListener("telemetry", (event) => {
    const nextTelemetry = JSON.parse((event as MessageEvent).data) as Telemetry;
    telemetry = nextTelemetry;
    renderer.setTelemetry(nextTelemetry);
    renderSidePanel();
  });
  eventSource.onerror = () => {
    scenarioLabel.textContent = "Telemetry reconnecting";
  };
}

function showGuide(id: ScenarioId) {
  pendingScenario = id;
  const scenario = scenarios.find((item) => item.id === id);
  guideScenario.textContent = scenario
    ? `Selected scenario: ${scenario.title}. Use these keys to move through the diagnostics lab.`
    : "Use these keys to move through the diagnostics lab.";
  splash.classList.add("is-hidden");
  experience.classList.add("is-hidden");
  guide.classList.remove("is-hidden");
}

function returnToSplash() {
  eventSource?.close();
  eventSource = null;
  currentScenario = null;
  pendingScenario = null;
  keys.clear();
  splash.classList.remove("is-hidden");
  guide.classList.add("is-hidden");
  experience.classList.add("is-hidden");
}

function metricRows(t: Telemetry) {
  return [
    ["CPU", t.cpu.utilization, t.cpu.saturation, t.cpu.errors],
    ["MEM", t.memory.utilization, t.memory.saturation, t.memory.errors],
    ["DSK", t.storage.utilization, t.storage.saturation, t.storage.errors],
    ["NET", t.network.utilization, t.network.saturation, t.network.errors]
  ] as const;
}

function renderSidePanel() {
  if (!telemetry) return;
  const signature = `${telemetry.timestamp}:${currentLocation.id}`;
  if (signature === lastPanelSignature) return;
  lastPanelSignature = signature;
  roomTitle.textContent = currentLocation.title;
  roomHint.textContent = currentLocation.subtitle;
  bars.innerHTML = metricRows(telemetry)
    .map(
      ([name, utilization, saturation, errors]) => `
        <div class="metric">
          <div class="metric__head"><span>${name}</span><b>${pct(Math.max(utilization, saturation, errors))}</b></div>
          <div class="meter"><span style="width:${pct(utilization)}"></span></div>
          <div class="meter meter--sat"><span style="width:${pct(saturation)}"></span></div>
        </div>
      `
    )
    .join("");

  readout.innerHTML = roomReadout(currentLocation, telemetry);
  processList.innerHTML = telemetry.processes
    .slice(0, 7)
    .map((proc) => {
      const activity = Math.max(proc.cpu, proc.memory, proc.io, proc.network, proc.fd);
      return `
        <div class="process">
          <span>${proc.name}</span>
          <b>${proc.pid}</b>
          <i style="width:${pct(activity)}"></i>
        </div>
      `;
    })
    .join("");
  status.innerHTML = `
    <div class="face ${telemetry.health < 0.35 ? "face--danger" : telemetry.health < 0.58 ? "face--warn" : ""}">SYS</div>
    <div><span>HEALTH</span><b>${pct(telemetry.health)}</b></div>
    <div><span>CPU</span><b>${pct(telemetry.cpu.utilization)}</b></div>
    <div><span>MEM</span><b>${pct(telemetry.memory.utilization)}</b></div>
    <div><span>DISK Q</span><b>${fmt(telemetry.storage.queueDepth)}</b></div>
    <div><span>NET</span><b>${Math.round(telemetry.network.rxMbps + telemetry.network.txMbps)}M</b></div>
  `;
}

function roomReadout(location: LocationInfo, t: Telemetry) {
  if (location.kind === "cpu-cores") {
    return `
      <dl>
        <div><dt>Cores</dt><dd>${t.cpu.cores}</dd></div>
        <div><dt>Hottest core</dt><dd>${pct(Math.max(...t.cpu.coreMetrics.map((core) => core.utilization), t.cpu.utilization))}</dd></div>
        <div><dt>Load 1m</dt><dd>${fmt(t.cpu.load1, 2)}</dd></div>
      </dl>
    `;
  }
  if (location.kind === "cpu-scheduler" || location.kind === "cpu-cache" || location.resource === "cpu") {
    return `
      <dl>
        <div><dt>Load 1m</dt><dd>${fmt(t.cpu.load1, 2)}</dd></div>
        <div><dt>Saturation</dt><dd>${pct(t.cpu.saturation)}</dd></div>
        <div><dt>Context switches</dt><dd>${Math.round(t.cpu.contextSwitchRate)}/s</dd></div>
      </dl>
    `;
  }
  if (location.kind === "memory-reservoir") {
    return `
      <dl>
        <div><dt>Used</dt><dd>${fmt(t.memory.usedGb)} GB</dd></div>
        <div><dt>Available</dt><dd>${fmt(t.memory.availableGb)} GB</dd></div>
        <div><dt>Anonymous</dt><dd>${pct(t.memory.composition.anonymous)}</dd></div>
      </dl>
    `;
  }
  if (location.kind === "memory-swap" || location.kind === "memory-allocator" || location.resource === "memory") {
    return `
      <dl>
        <div><dt>Swap flow</dt><dd>${fmt(t.memory.swapRate, 0)} pages/s</dd></div>
        <div><dt>Dirty pages</dt><dd>${pct(t.memory.composition.dirty)}</dd></div>
        <div><dt>Pinned pages</dt><dd>${pct(t.memory.composition.pinned)}</dd></div>
      </dl>
    `;
  }
  if (location.kind === "storage-rotor") {
    return `
      <dl>
        <div><dt>Device</dt><dd>${t.storage.devices[0]?.name ?? "none"}</dd></div>
        <div><dt>Utilization</dt><dd>${pct(t.storage.utilization)}</dd></div>
        <div><dt>Throughput</dt><dd>${fmt(t.storage.readMbps + t.storage.writeMbps)} MB/s</dd></div>
      </dl>
    `;
  }
  if (location.kind === "storage-latency" || location.kind === "storage-device" || location.resource === "storage") {
    return `
      <dl>
        <div><dt>Queue depth</dt><dd>${fmt(t.storage.queueDepth)}</dd></div>
        <div><dt>Await</dt><dd>${fmt(t.storage.awaitMs)} ms</dd></div>
        <div><dt>Saturation</dt><dd>${pct(t.storage.saturation)}</dd></div>
      </dl>
    `;
  }
  if (location.kind === "network-conduits") {
    return `
      <dl>
        <div><dt>RX</dt><dd>${fmt(t.network.rxMbps)} Mbps</dd></div>
        <div><dt>TX</dt><dd>${fmt(t.network.txMbps)} Mbps</dd></div>
        <div><dt>Utilization</dt><dd>${pct(t.network.utilization)}</dd></div>
      </dl>
    `;
  }
  if (location.kind === "network-backlog" || location.kind === "network-connections" || location.resource === "network") {
    return `
      <dl>
        <div><dt>Drops</dt><dd>${fmt(t.network.dropsRate)} /s</dd></div>
        <div><dt>Retransmits</dt><dd>${fmt(t.network.retransRate)} /s</dd></div>
        <div><dt>Saturation</dt><dd>${pct(t.network.saturation)}</dd></div>
      </dl>
    `;
  }
  return `
    <dl>
      <div><dt>Mode</dt><dd>${t.mode}</dd></div>
      <div><dt>Host</dt><dd>${t.host}</dd></div>
      <div><dt>Worst resource</dt><dd>${worstResource(t)}</dd></div>
    </dl>
  `;
}

function worstResource(t: Telemetry) {
  return metricRows(t)
    .map(([name, utilization, saturation, errors]) => [name, Math.max(utilization, saturation, errors)] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  if (currentScenario) {
    renderer.update(readMovementInput(), dt);
    const nextLocation = renderer.getLocation();
    if (nextLocation.id !== currentLocation.id) {
      currentLocation = nextLocation;
      lastPanelSignature = "";
      renderSidePanel();
    } else {
      currentLocation = nextLocation;
    }
  }
  renderer.render({ automap });
  requestAnimationFrame(frame);
}

function readMovementInput(): MovementInput {
  return {
    forward: keys.has("w") || keys.has("arrowup"),
    backward: keys.has("s") || keys.has("arrowdown"),
    turnLeft: keys.has("a") || keys.has("arrowleft"),
    turnRight: keys.has("d") || keys.has("arrowright"),
    strafeLeft: keys.has("q"),
    strafeRight: keys.has("e"),
    run: keys.has("shift")
  };
}

scenarioGrid.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-scenario]");
  if (!button) return;
  showGuide(button.dataset.scenario as ScenarioId);
});

app.querySelector('[data-action="splash"]')?.addEventListener("click", returnToSplash);
app.querySelector('[data-action="guide-back"]')?.addEventListener("click", returnToSplash);
app.querySelector('[data-action="start-guide"]')?.addEventListener("click", () => {
  if (pendingScenario) startScenario(pendingScenario);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    returnToSplash();
    return;
  }
  const activeElement = document.activeElement;
  if (pendingScenario && !currentScenario && event.key === "Enter" && !(activeElement instanceof HTMLButtonElement)) {
    startScenario(pendingScenario);
    return;
  }
  if (!currentScenario) return;
  if (event.key === "Tab") {
    event.preventDefault();
    automap = !automap;
    return;
  }
  const key = event.key.toLowerCase();
  if (resourceJumps[key]) {
    renderer.teleportTo(resourceJumps[key]);
    currentLocation = renderer.getLocation();
    lastPanelSignature = "";
    renderSidePanel();
    return;
  }
  if (["w", "a", "s", "d", "q", "e", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
    keys.add(key);
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

loadScenarios().catch((error) => {
  scenarioGrid.innerHTML = `<p class="error">${error instanceof Error ? error.message : String(error)}</p>`;
});
requestAnimationFrame(frame);
