#!/usr/bin/env node
// Perf harness for the Doom Perf tab (PERF_TUNE_PLAN.md Part 0).
//
// Drives the running app in a real browser, samples CPU/render/memory metrics via
// an in-page probe (window.__perfProbe, installed by ?perf-bench=1) plus Chrome
// DevTools Protocol, and writes a JSON snapshot to perf-results/. Run it before and
// after a change and `--compare` the two files to measure impact — no commit needed.
//
//   Serve the app first:   npm run dev:telemetry   (or npm run dev) -> 127.0.0.1:8000
//
//   Automated before/after (scripted motion, headless):
//     node scripts/perf-harness.mjs --mode tour --label before --scenario cpu-load --duration 30
//     …make a change, rebuild…
//     node scripts/perf-harness.mjs --mode tour --label after  --scenario cpu-load --duration 30
//     node scripts/perf-harness.mjs --compare perf-results/before-*.json perf-results/after-*.json
//
//   Manual (opens a real window; click around; Ctrl-C to stop + flush):
//     node scripts/perf-harness.mjs --mode manual --label hand-tuning --scenario cpu-load
//
//   Attach to your own Chrome (launched with --remote-debugging-port=9222 --user-data-dir=…):
//     node scripts/perf-harness.mjs --mode attach --label real-chrome --endpoint http://localhost:9222
//
// The probe, CDP session, and output schema are identical across all three drivers,
// so --compare treats them uniformly. Headless (the tour default) composites with
// software GL and has no real vsync, so absolute fps is only indicative — relative
// before/after deltas are the source of truth. Use --headed / --mode manual for a
// real GPU-composited spot check.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

const HEADLESS_NOTE =
  "headless composites with software GL (no real vsync): absolute fps is indicative; " +
  "relative before/after deltas are the source of truth. Use --headed/--mode manual for real fps.";

// Scenario name -> engine sim mode, mirrored from src/index.ts SCENARIO_MODES.
// Only used here to name the ?scenario= query param; the app does the real mapping.
const KNOWN_SCENARIOS = new Set([
  "live",
  "cpu", "cpu-load", "cpu-util", "cpu-sat",
  "disk", "disk-util", "disk-sat", "disk-sat-shallow", "disk-sat-deep",
  "mem", "memory", "mem-util", "mem-sat", "mem-sat-swap", "mem-noswap",
  "net", "network", "net-util", "net-rx", "net-tx", "net-recvq", "net-sendq",
]);
// --wing shorthand -> a representative scenario name.
const WING_SCENARIO = { cpu: "cpu", mem: "mem", disk: "disk", net: "net", all: "live" };

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const parseArgs = (argv) => {
  const args = {
    mode: "tour",
    label: "run",
    scenario: undefined,
    wing: undefined,
    profile: undefined,
    duration: 30,
    warmup: 2,
    motion: "tour",
    interval: 1000,
    url: "http://127.0.0.1:8000",
    endpoint: "http://localhost:9222",
    headed: false,
    hidden: false,
    throttle: undefined,
    repeat: 1,
    out: "perf-results",
    compare: undefined,
    help: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = () => rest[++i];
    switch (a) {
      case "--mode": args.mode = next(); break;
      case "--label": args.label = next(); break;
      case "--scenario": args.scenario = next(); break;
      case "--wing": args.wing = next(); break;
      case "--profile": args.profile = next(); break;
      case "--duration": args.duration = Number(next()); break;
      case "--warmup": args.warmup = Number(next()); break;
      case "--motion": args.motion = next(); break;
      case "--interval": args.interval = Number(next()); break;
      case "--url": args.url = next(); break;
      case "--endpoint": args.endpoint = next(); break;
      case "--headed": args.headed = true; break;
      case "--hidden": args.hidden = true; break;
      case "--throttle": args.throttle = Number(next()); break;
      case "--repeat": args.repeat = Math.max(1, Number(next())); break;
      case "--out": args.out = next(); break;
      case "--compare": args.compare = [next(), next()]; break;
      case "-h": case "--help": args.help = true; break;
      default:
        console.error(`Unknown flag: ${a}`);
        args.help = true;
    }
  }
  return args;
};

const HELP = `perf-harness.mjs — profile the Doom Perf tab (PERF_TUNE_PLAN.md Part 0)

Usage:
  node scripts/perf-harness.mjs [--mode tour|manual|attach] [options]
  node scripts/perf-harness.mjs --compare A.json B.json

Modes:
  tour     (default) launch chromium (headless), run a fixed motion script for
           --duration, snapshot, exit. The before/after regression path.
  manual   open a real visible window; sample in the background while you click;
           Ctrl-C stops and flushes a timestamped time series.
  attach   connect to your own Chrome (--endpoint, launched with
           --remote-debugging-port=9222 --user-data-dir=…) and sample like manual.

Options:
  --label NAME        output label (default: run)
  --scenario NAME     fixed data source for a reproducible load. Names:
                      live, cpu[-sat], disk[-sat|-sat-deep], mem[-sat|-noswap],
                      net[-rx|-tx|-recvq|-sendq]. Default: live (tour) so it
                      enters a level; omit in manual/attach to pick one by hand.
  --wing cpu|mem|disk|net|all   shorthand that picks a representative --scenario.
  --duration SEC      tour measure window after warmup (default: 30)
  --warmup SEC        discarded warmup before measuring (default: 2)
  --motion tour|idle|spin|forward|wings   tour motion (default: tour = idle+spin+forward)
                      wings = worst-case drive through every wing (opens doors,
                      pushes deep, spins for cross-hub sightlines); use >=90s
                      duration and pair with a --wing/--scenario to light up that
                      wing's instrument sprites. Best for the Part 4.3 peak counters.
  --interval MS       manual/attach sample cadence (default: 1000)
  --headed            tour: show a real GPU-composited window
  --hidden            tour: run the measure window with the tab marked hidden, to
                      book the 1.1 visibility-gate win (the engine coasts to ~2 fps).
                      Best paired with --motion idle. A/B it against a normal run.
  --throttle N        CDP CPU throttling rate (e.g. 4 = 4x slower) for tier tests
  --profile NAME      pass ?perf=NAME (potato|balanced|cinematic) through to the app
  --repeat N          tour: run N times, report the median-fps run (fights noise)
  --url URL           app URL (default: http://127.0.0.1:8000)
  --endpoint URL      attach: CDP endpoint (default: http://localhost:9222)
  --out DIR           output dir (default: perf-results)
  --compare A B       diff two result files and print a delta table
`;

// ---------------------------------------------------------------------------
// Shared probe + CDP collection (identical across all drivers)
// ---------------------------------------------------------------------------

const metricsToObject = (metrics) => {
  const out = {};
  for (const m of metrics ?? []) out[m.name] = m.value;
  return out;
};

// Pull the in-page probe snapshot + the current CDP Performance metrics.
const collect = async (page, cdp) => {
  const probe = await page.evaluate(() => globalThis.__perfProbe?.snapshot?.() ?? null).catch(() => null);
  let metrics = null;
  if (cdp) {
    try {
      metrics = metricsToObject((await cdp.send("Performance.getMetrics")).metrics);
    } catch {
      metrics = null;
    }
  }
  return { t: Date.now(), probe, metrics };
};

const resetProbe = (page) =>
  page.evaluate(() => globalThis.__perfProbe?.reset?.()).catch(() => {});

const dropMarker = (page, label) =>
  page.evaluate((l) => globalThis.__perfProbe?.marker?.(l), label).catch(() => {});

// Wait until the app logs that the requested scenario is active (it prints
// "[perf] scenario mode N active"); resolves early on that, else after timeout.
const waitForScenarioActive = (consoleLog, timeoutMs) =>
  new Promise((res) => {
    if (consoleLog.seenActive) return res(true);
    const timer = setTimeout(() => res(false), timeoutMs);
    consoleLog.onActive = () => {
      clearTimeout(timer);
      res(true);
    };
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Motion scripts (Playwright synthesizes real key events the SDL layer reads)
// ---------------------------------------------------------------------------

const holdKey = async (page, key, ms) => {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
};

// Hold a movement key for `ms` while tapping USE (Space) every ~250ms, so the
// manual DR hub doors (special 1, USE within 64 units) open on approach — and
// reopen from the far side on the way back. Closed doors block the hall view, so
// the worst-case drive can't reach the wings without this.
const holdKeyWithUse = async (page, key, ms) => {
  if (ms <= 0) return;
  await page.keyboard.down(key);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.keyboard.press("Space");
    await sleep(Math.max(0, Math.min(250, end - Date.now())));
  }
  await page.keyboard.up(key);
};

// Run a motion pattern for roughly `durationMs`, dropping phase markers so a
// reader can see idle vs. motion boundaries inside the measured window.
const runMotion = async (page, motion, durationMs) => {
  const end = Date.now() + durationMs;
  if (motion === "idle") {
    await dropMarker(page, "idle");
    await sleep(durationMs); // stand still: pure idle render cost
    return;
  }
  if (motion === "spin") {
    await dropMarker(page, "spin");
    while (Date.now() < end) await holdKey(page, "ArrowRight", Math.min(2000, end - Date.now()));
    return;
  }
  if (motion === "forward") {
    await dropMarker(page, "forward");
    while (Date.now() < end) await holdKey(page, "ArrowUp", Math.min(2000, end - Date.now()));
    return;
  }
  // "wings": a worst-case drive for the Part 4.3 render-array peak counters. The
  // player spawns at the hub centre (0,0) facing NORTH; the four wings are
  // N=CPU, E=memory, S=storage, W=network. This opens each hub door and pushes
  // deep into its wing, then spins at the far end so the long look-back-down-the-
  // wing and cross-hub sightlines (which balloon visplanes/drawsegs) plus each
  // wing's instrument sprites all land in-frame at some point. Navigation is
  // open-loop and imperfect, but the counters are maxima over the window, so
  // approximate aim still captures the worst frames; a longer --duration just
  // adds coverage and repeats (one N,E,S,W cycle is ~45s — recommend >= 90).
  if (motion === "wings") {
    const clamp = (ms) => Math.max(0, Math.min(ms, end - Date.now()));
    const SPIN = 2900; // ~one full turn (65536 BAM / ~640 per tic / 35 tics)
    const TURN90 = 760; // ~quarter turn to the next cardinal (turning right = N->E->S->W)
    const PUSH = 3600; // drive through the opened door and deep into the wing
    const BACK = 3600; // retreat toward the hub (USE reopens the door if it closed)
    const cardinals = ["cpu-N", "memory-E", "storage-S", "network-W"];
    // Hub-centre spin first: frames all four doorways from the middle.
    await dropMarker(page, "hub-spin");
    await holdKey(page, "ArrowRight", clamp(SPIN));
    let i = 0;
    while (Date.now() < end) {
      const name = cardinals[i % 4];
      await dropMarker(page, `wing:${name}`);
      if (i > 0) await holdKey(page, "ArrowRight", clamp(TURN90)); // precess to the next cardinal
      await holdKeyWithUse(page, "ArrowUp", clamp(PUSH)); // open door + drive deep in
      if (Date.now() >= end) break;
      await dropMarker(page, `wing:${name}:spin`);
      await holdKey(page, "ArrowRight", clamp(SPIN)); // deep-wing + look-back-across-hub sightlines
      await holdKeyWithUse(page, "ArrowDown", clamp(BACK)); // retreat toward the hub
      i++;
    }
    return;
  }
  // "tour": a fixed, reproducible idle -> spin -> forward -> spin cycle so the same
  // path runs every time; stand-still and spin-in-place segments isolate idle vs motion.
  const phases = [
    ["idle", 0.2, null],
    ["spin", 0.3, "ArrowRight"],
    ["forward", 0.3, "ArrowUp"],
    ["spin-back", 0.2, "ArrowLeft"],
  ];
  for (const [label, frac, key] of phases) {
    const phaseEnd = Math.min(end, Date.now() + durationMs * frac);
    await dropMarker(page, label);
    if (!key) {
      await sleep(Math.max(0, phaseEnd - Date.now()));
    } else {
      while (Date.now() < phaseEnd) await holdKey(page, key, Math.min(1500, phaseEnd - Date.now()));
    }
  }
};

// ---------------------------------------------------------------------------
// URL building + console wiring
// ---------------------------------------------------------------------------

const buildUrl = (base, { scenario, profile }) => {
  const u = new URL(base);
  u.searchParams.set("perf-bench", "1");
  if (scenario) u.searchParams.set("scenario", scenario);
  if (profile) u.searchParams.set("perf", profile);
  return u.toString();
};

// Mirror app console lines to our stdout (prefixed) and detect scenario-active.
const wireConsole = (page) => {
  const state = { seenActive: false, onActive: null };
  page.on("console", (msg) => {
    const text = msg.text();
    if (/\[perf\] scenario mode \d+ active/.test(text)) {
      state.seenActive = true;
      state.onActive?.();
    }
    if (/\[perf\]/.test(text) || msg.type() === "error") {
      console.log(`  [page:${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (err) => console.log(`  [page:exception] ${err.message}`));
  return state;
};

const applyThrottle = async (cdp, rate) => {
  if (!cdp || !rate || rate <= 1) return;
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    console.log(`  CPU throttle: ${rate}x`);
  } catch (e) {
    console.log(`  (CPU throttle unavailable: ${e.message})`);
  }
};

// Simulate a backgrounded tab for the 1.1 visibility gate (PERF_TUNE_PLAN.md Part 1).
// There is no stable CDP command to set document.visibilityState, and truly
// backgrounding a lone headless page is not possible, so drive the app's own path
// directly: shadow document.hidden / visibilityState and fire the `visibilitychange`
// event the app listens for. Its handler calls _DoomPerf_SetHidden, and the engine
// coasts its present rate to ~2 fps — exactly the win we want to measure. The probe's
// render-frame counter captures the drop even though the (foreground) headless
// compositor keeps painting rAF at ~60, so read renderFps / CDP task, not rAF fps.
const setPageHidden = async (page, hidden) => {
  await page.evaluate((h) => {
    if (!window.__perfVisInstalled) {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => !!window.__perfHidden,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (window.__perfHidden ? "hidden" : "visible"),
      });
      window.__perfVisInstalled = true;
    }
    window.__perfHidden = !!h;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
};

// ---------------------------------------------------------------------------
// Result shaping + output
// ---------------------------------------------------------------------------

const commonMeta = (args, resolvedScenario, extra) => ({
  schema: "doomperf-perf-harness/1",
  label: args.label,
  mode: args.mode,
  scenario: resolvedScenario ?? null,
  profile: args.profile ?? null,
  headless: args.mode === "tour" ? !args.headed : false,
  note: (args.mode === "tour" && !args.headed) ? HEADLESS_NOTE : undefined,
  hidden: !!args.hidden,
  url: args.url,
  throttle: args.throttle ?? null,
  createdAt: new Date().toISOString(),
  ...extra,
});

const cdpDelta = (baseline, final) => {
  if (!baseline || !final) return null;
  const keys = new Set([...Object.keys(baseline), ...Object.keys(final)]);
  const delta = {};
  for (const k of keys) delta[k] = (final[k] ?? 0) - (baseline[k] ?? 0);
  return delta;
};

const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, "-");

const writeResult = (outDir, label, obj) => {
  mkdirSync(outDir, { recursive: true });
  const path = resolve(outDir, `${label}-${timestampSlug()}.json`);
  writeFileSync(path, JSON.stringify(obj, null, 2));
  return path;
};

// Normalize any result (tour aggregate or manual/attach series) into the same
// comparable numbers, so --compare treats every driver uniformly.
const summarize = (result) => {
  const agg = result.aggregate ?? {};
  const probe = agg.probe ?? null;
  const cdp = agg.cdp?.delta ?? null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    label: result.label,
    mode: result.mode,
    scenario: result.scenario,
    hidden: result.hidden ?? false,
    durationMs: num(agg.durationMs),
    rafFps: num(probe?.raf?.fps),
    renderFps: num(probe?.render?.fps),
    frameP95: num(probe?.raf?.frameMs?.p95),
    frameP99: num(probe?.raf?.frameMs?.p99),
    longFrames: num(probe?.raf?.longFrames),
    longtaskMs: num(probe?.longtasks?.totalMs),
    jsHeapPeak: num(probe?.jsHeap?.peakBytes),
    wasmHeapPeak: num(probe?.wasmHeap?.peakBytes),
    domPeak: num(probe?.dom?.peakNodes),
    // Engine peak counters (PERF_TUNE_PLAN.md Part 4.3): peak render-array
    // occupancy vs capacity and peak zone-heap usage vs total, for right-sizing
    // the crash-headroom limits from measured peaks.
    visplanesPeak: num(probe?.enginePeaks?.visplanes?.peak),
    visplanesCap: num(probe?.enginePeaks?.visplanes?.cap),
    drawsegsPeak: num(probe?.enginePeaks?.drawsegs?.peak),
    drawsegsCap: num(probe?.enginePeaks?.drawsegs?.cap),
    visspritesPeak: num(probe?.enginePeaks?.vissprites?.peak),
    visspritesCap: num(probe?.enginePeaks?.vissprites?.cap),
    zonePeakBytes: num(probe?.enginePeaks?.zone?.peakBytes),
    zoneSizeBytes: num(probe?.enginePeaks?.zone?.sizeBytes),
    zoneStaticPeakBytes: num(probe?.enginePeaks?.zone?.staticPeakBytes),
    cdpTaskDurationS: num(cdp?.TaskDuration),
    cdpScriptDurationS: num(cdp?.ScriptDuration),
    cdpLayoutDurationS: num(cdp?.LayoutDuration),
    cdpRecalcStyleS: num(cdp?.RecalcStyleDuration),
    cdpJSHeapUsed: num(cdp?.JSHeapUsedSize),
  };
};

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

// One tour measurement: warmup (discarded) -> reset probe -> run motion for
// --duration while sampling nothing (probe accumulates) -> final snapshot.
const runTourOnce = async (args, resolvedScenario) => {
  const launchArgs = ["--autoplay-policy=no-user-gesture-required"];
  const browser = await chromium.launch({ headless: !args.headed, args: launchArgs });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const consoleLog = wireConsole(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable").catch(() => {});
    await applyThrottle(cdp, args.throttle);

    const url = buildUrl(args.url, { scenario: resolvedScenario, profile: args.profile });
    console.log(`  goto ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for the level to come up under the requested scenario (or timeout).
    const active = await waitForScenarioActive(consoleLog, 20000);
    console.log(active ? "  scenario active" : "  scenario not confirmed (continuing)");

    console.log(`  warmup ${args.warmup}s…`);
    await sleep(args.warmup * 1000);
    await resetProbe(page);
    const cdpBaseline = (await collect(page, cdp)).metrics;

    console.log(`  measuring ${args.duration}s (motion: ${args.motion})…`);
    if (args.hidden) {
      await setPageHidden(page, true);
      console.log("  visibility: hidden (1.1 gate active — expect renderFps to drop to ~2)");
    }
    const t0 = Date.now();
    await runMotion(page, args.motion, args.duration * 1000);
    const durationMs = Date.now() - t0;
    if (args.hidden) await setPageHidden(page, false);

    const final = await collect(page, cdp);
    const aggregate = {
      durationMs,
      probe: final.probe,
      cdp: { baseline: cdpBaseline, final: final.metrics, delta: cdpDelta(cdpBaseline, final.metrics) },
    };
    return commonMeta(args, resolvedScenario, { aggregate });
  } finally {
    await browser.close();
  }
};

const runTour = async (args, resolvedScenario) => {
  if (args.repeat <= 1) {
    const result = await runTourOnce(args, resolvedScenario);
    const path = writeResult(args.out, args.label, result);
    reportSingle(result);
    console.log(`\nwrote ${path}`);
    return;
  }
  // --repeat N: run N times, report the median-fps run to fight per-run noise.
  const runs = [];
  for (let i = 0; i < args.repeat; i++) {
    console.log(`\n== repeat ${i + 1}/${args.repeat} ==`);
    runs.push(await runTourOnce(args, resolvedScenario));
  }
  const withFps = runs
    .map((r) => ({ r, fps: summarize(r).rafFps ?? 0 }))
    .sort((a, b) => a.fps - b.fps);
  const median = withFps[Math.floor(withFps.length / 2)].r;
  median.repeats = runs.map(summarize);
  const path = writeResult(args.out, args.label, median);
  console.log(`\nmedian-fps run of ${args.repeat}:`);
  reportSingle(median);
  console.log(`\nwrote ${path}`);
};

// manual / attach: poll on an interval, building a timestamped series; Ctrl-C
// stops and flushes. Both share this loop; only how we get (page, cdp) differs.
const runSampling = async (args, resolvedScenario, { page, cdp, consoleLog, cleanup }) => {
  await cdp?.send("Performance.enable").catch(() => {});
  await applyThrottle(cdp, args.throttle);

  if (consoleLog) {
    const active = await waitForScenarioActive(consoleLog, 8000);
    if (active) console.log("  scenario active");
  }
  await resetProbe(page);
  const series = [];
  let running = true;

  const finish = async (reason) => {
    if (!running) return;
    running = false;
    console.log(`\n${reason}: flushing ${series.length} samples…`);
    const first = series[0];
    const last = series[series.length - 1];
    const aggregate = {
      durationMs: first && last ? last.t - first.t : 0,
      probe: last?.probe ?? null, // probe is cumulative-since-reset -> last covers the session
      cdp: {
        baseline: first?.metrics ?? null,
        final: last?.metrics ?? null,
        delta: cdpDelta(first?.metrics, last?.metrics),
      },
    };
    const result = commonMeta(args, resolvedScenario, { aggregate, series });
    const path = writeResult(args.out, args.label, result);
    reportSingle(result);
    console.log(`\nwrote ${path}`);
    await cleanup?.();
    process.exit(0);
  };

  process.on("SIGINT", () => void finish("SIGINT (Ctrl-C)"));
  console.log(`\nSampling every ${args.interval}ms. Drive the app by hand; press Ctrl-C to stop + flush.\n`);

  // Recursive timeout (not setInterval) so overlapping async samples can't stack up.
  while (running) {
    const sample = await collect(page, cdp);
    series.push(sample);
    const p = sample.probe;
    if (p) {
      process.stdout.write(
        `\r  t+${(((sample.t - (series[0]?.t ?? sample.t)) / 1000) | 0)}s  ` +
          `rAF ${p.raf?.fps?.toFixed(1) ?? "?"}fps  render ${p.render?.fps?.toFixed?.(1) ?? "n/a"}fps  ` +
          `wasm ${fmtBytes(p.wasmHeap?.bytes)}  dom ${p.dom?.nodes ?? "?"}   `
      );
    }
    await sleep(args.interval);
  }
};

const runManual = async (args, resolvedScenario) => {
  const userDataDir = resolve(args.out, ".manual-profile");
  mkdirSync(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const consoleLog = wireConsole(page);
  const cdp = await context.newCDPSession(page);
  const url = buildUrl(args.url, { scenario: resolvedScenario, profile: args.profile });
  console.log(`  goto ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await runSampling(args, resolvedScenario, { page, cdp, consoleLog, cleanup: () => context.close() });
};

const runAttach = async (args, resolvedScenario) => {
  console.log(`  connecting to ${args.endpoint} …`);
  const browser = await chromium.connectOverCDP(args.endpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  const consoleLog = wireConsole(page);
  const cdp = await context.newCDPSession(page);
  const url = buildUrl(args.url, { scenario: resolvedScenario, profile: args.profile });
  console.log(`  navigating attached tab to ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch((e) => console.log(`  (goto: ${e.message})`));
  await runSampling(args, resolvedScenario, { page, cdp, consoleLog, cleanup: () => browser.close() });
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const fmtBytes = (n) =>
  typeof n === "number" && Number.isFinite(n) ? `${(n / (1024 * 1024)).toFixed(1)}MB` : "n/a";
const fmtNum = (n, digits = 1) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "n/a";

const reportSingle = (result) => {
  const s = summarize(result);
  console.log(`\n  ── ${s.label} (${s.mode}${s.scenario ? `, ${s.scenario}` : ""}) ──`);
  console.log(`  window          ${fmtNum((s.durationMs ?? 0) / 1000)}s`);
  if (result.hidden) console.log(`  visibility      hidden (1.1 gate)`);
  console.log(`  rAF fps         ${fmtNum(s.rafFps)}`);
  console.log(`  render fps      ${fmtNum(s.renderFps)}  (engine-presented frames)`);
  console.log(`  frame p95/p99   ${fmtNum(s.frameP95)} / ${fmtNum(s.frameP99)} ms`);
  console.log(`  long frames     ${s.longFrames ?? "n/a"}  (>50ms)`);
  console.log(`  longtask total  ${fmtNum(s.longtaskMs)} ms`);
  console.log(`  JS heap peak    ${fmtBytes(s.jsHeapPeak)}`);
  console.log(`  WASM heap peak  ${fmtBytes(s.wasmHeapPeak)}`);
  console.log(`  DOM nodes peak  ${s.domPeak ?? "n/a"}`);
  // Engine peak counters (Part 4.3): "peak / cap" shows how far each crash-headroom
  // limit could be trimmed; the zone line shows peak used against the 16 MB heap.
  const pkCap = (p, c) => (p === null ? "n/a" : c !== null ? `${p} / ${c}` : `${p}`);
  if (s.visplanesPeak !== null || s.zonePeakBytes !== null) {
    console.log(`  visplanes peak  ${pkCap(s.visplanesPeak, s.visplanesCap)}`);
    console.log(`  drawsegs peak   ${pkCap(s.drawsegsPeak, s.drawsegsCap)}`);
    console.log(`  vissprites peak ${pkCap(s.visspritesPeak, s.visspritesCap)}`);
    console.log(`  zone peak used  ${fmtBytes(s.zonePeakBytes)} / ${fmtBytes(s.zoneSizeBytes)}  (cache-greedy)`);
    console.log(`  zone non-purge  ${fmtBytes(s.zoneStaticPeakBytes)}  (PU_STATIC+LEVEL peak — the real floor)`);
  }
  if (s.cdpTaskDurationS !== null)
    console.log(`  CDP task/script ${fmtNum(s.cdpTaskDurationS, 2)} / ${fmtNum(s.cdpScriptDurationS, 2)} s`);
};

// --compare: lower-is-better for everything except fps (higher is better).
const COMPARE_ROWS = [
  { key: "rafFps", label: "rAF fps", better: "up", fmt: (v) => fmtNum(v) },
  { key: "renderFps", label: "render fps", better: "up", fmt: (v) => fmtNum(v) },
  { key: "frameP95", label: "frame p95 (ms)", better: "down", fmt: (v) => fmtNum(v) },
  { key: "longFrames", label: "long frames", better: "down", fmt: (v) => fmtNum(v, 0) },
  { key: "longtaskMs", label: "longtask (ms)", better: "down", fmt: (v) => fmtNum(v, 0) },
  { key: "jsHeapPeak", label: "JS heap peak", better: "down", fmt: fmtBytes },
  { key: "wasmHeapPeak", label: "WASM heap peak", better: "down", fmt: fmtBytes },
  { key: "domPeak", label: "DOM nodes peak", better: "down", fmt: (v) => fmtNum(v, 0) },
  { key: "visplanesPeak", label: "visplanes peak", better: "down", fmt: (v) => fmtNum(v, 0) },
  { key: "drawsegsPeak", label: "drawsegs peak", better: "down", fmt: (v) => fmtNum(v, 0) },
  { key: "visspritesPeak", label: "vissprites peak", better: "down", fmt: (v) => fmtNum(v, 0) },
  { key: "zonePeakBytes", label: "zone peak used", better: "down", fmt: fmtBytes },
  { key: "zoneStaticPeakBytes", label: "zone non-purge peak", better: "down", fmt: fmtBytes },
  { key: "cdpTaskDurationS", label: "CDP task (s)", better: "down", fmt: (v) => fmtNum(v, 2) },
  { key: "cdpScriptDurationS", label: "CDP script (s)", better: "down", fmt: (v) => fmtNum(v, 2) },
];
const REGRESSION_PCT = 5; // flag a change worse than this by more than 5%

const pctChange = (a, b) => (a === null || b === null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100);

const readJson = (p) => JSON.parse(readFileSync(isAbsolute(p) ? p : resolve(p), "utf8"));

const runCompare = ([aPath, bPath]) => {
  const a = summarize(readJson(aPath));
  const b = summarize(readJson(bPath));
  console.log(`\nA = ${a.label}  (${aPath})`);
  console.log(`B = ${b.label}  (${bPath})\n`);
  if (a.hidden !== b.hidden) {
    const hiddenSide = b.hidden ? "B" : "A";
    console.log(
      `note: visibility A/B (${hiddenSide} = hidden tab). A lower render fps / CDP task on the\n` +
        `      hidden side is the 1.1 gate WORKING, not a regression — the "better: up" verdict\n` +
        `      on render fps is inverted for this comparison. rAF fps stays ~60 (headless keeps\n` +
        `      compositing); read render fps + CDP task as the win.\n`
    );
  }
  const pad = (s, n) => String(s).padEnd(n);
  const padS = (s, n) => String(s).padStart(n);
  console.log(`${pad("metric", 18)}${padS("A", 12)}${padS("B", 12)}${padS("Δ%", 10)}  verdict`);
  console.log("─".repeat(64));
  let regressions = 0;
  const commitBits = [];
  // In a visibility A/B (one side hidden) the frame-rate metrics are *meant* to fall
  // on the hidden side — that is the 1.1 gate working — so don't let their expected
  // drop flip the exit code to FAIL. They still print with an honest Δ%.
  const hiddenAB = a.hidden !== b.hidden;
  const expectedDrop = new Set(hiddenAB ? ["renderFps", "rafFps"] : []);
  for (const row of COMPARE_ROWS) {
    const av = a[row.key];
    const bv = b[row.key];
    if (av === null && bv === null) continue;
    const pct = pctChange(av, bv);
    let verdict = "";
    if (pct !== null) {
      const improved = row.better === "up" ? pct > 0 : pct < 0;
      const worsened = row.better === "up" ? pct < 0 : pct > 0;
      if (expectedDrop.has(row.key) && Math.abs(pct) > REGRESSION_PCT) {
        verdict = "· expected (gate)";
      } else if (worsened && Math.abs(pct) > REGRESSION_PCT) {
        verdict = "⚠ regressed";
        regressions++;
      } else if (improved && Math.abs(pct) > REGRESSION_PCT) {
        verdict = "✓ improved";
      } else {
        verdict = "· ~same";
      }
    }
    const pctStr = pct === null ? "n/a" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    console.log(`${pad(row.label, 18)}${padS(row.fmt(av), 12)}${padS(row.fmt(bv), 12)}${padS(pctStr, 10)}  ${verdict}`);
    if (pct !== null && Math.abs(pct) > REGRESSION_PCT) commitBits.push(`${row.label} ${pctStr}`);
  }
  console.log("─".repeat(64));
  console.log(regressions === 0 ? "PASS: no metric regressed beyond 5%." : `FAIL: ${regressions} metric(s) regressed beyond 5%.`);
  console.log(`\ncommit summary: perf: ${commitBits.length ? commitBits.join(", ") : "no significant change"} (${a.label}→${b.label})`);
  process.exitCode = regressions === 0 ? 0 : 1;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.compare) {
    runCompare(args.compare);
    return;
  }

  // Resolve scenario: explicit --scenario wins, else --wing shorthand, else default.
  let scenario = args.scenario;
  if (!scenario && args.wing) scenario = WING_SCENARIO[args.wing] ?? undefined;
  if (!scenario && args.mode === "tour") scenario = "live"; // tour must enter a level to move
  if (scenario && !KNOWN_SCENARIOS.has(scenario) && !/^\d+$/.test(scenario)) {
    console.error(`Unknown --scenario "${scenario}". Known: ${[...KNOWN_SCENARIOS].join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`perf-harness: mode=${args.mode} label=${args.label} scenario=${scenario ?? "(pick by hand)"}`);
  if (args.mode === "tour") await runTour(args, scenario);
  else if (args.mode === "manual") await runManual(args, scenario);
  else if (args.mode === "attach") await runAttach(args, scenario);
  else {
    console.error(`Unknown --mode "${args.mode}"`);
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
