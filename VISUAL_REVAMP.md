# Doom Perf Visual Revamp

## Goal

Bring the CPU wing back toward the original Doom diagnostics lab concept:
fewer visual ideas, clearer USE semantics, and a stronger separation between
metric-bearing instruments and decorative Doom atmosphere.

The room should read immediately:

- CPU utilization: how busy each logical CPU is.
- CPU saturation: whether runnable work is waiting for CPU time.
- Secondary diagnostics: raw counters and terminal-style details for deeper
  inspection.

Decorative elements should stay visually subordinate. Doom textures, windows,
stairs, lamps, skulls, metal, stone, and sector lighting are useful atmosphere,
but they should not use the same red/yellow/green language as active metrics
unless they are part of a specific instrument.

## Current Problem

The CPU wing currently has several competing visual layers:

- colored CPU floor instruments
- colored freestanding signs
- bright computer-wall textures
- lamps and props
- the global telemetry HUD

That makes it hard to tell which elements are semantically important. In
particular, the load-overcommit section started to look like a wall of charts,
which conflicts with the goal that diagnostic indicators should be
immediately interpretable.

## Proposed CPU Wing Layout

Use three major instruments instead of several equally loud displays.

### 1. Central Core Reactor

Primary purpose: CPU utilization.

Shape:

- central raised platform or reactor pit
- one geometric cell per logical CPU core
- cells arranged in a clean grid or radial ring
- each core is a hard-edged Doom-style geometric shape, not a generic light

Visual behavior:

- idle or low utilization: blue
- normal busy: green
- high utilization: yellow
- sustained high utilization: red-hot pulse

Terminal correlation:

```text
mpstat -P ALL 1 3
```

Useful fields:

- `CPU`: logical CPU id
- `%usr`, `%nice`, `%sys`, `%irq`, `%soft`, `%steal`, `%guest`: non-idle work
- `%idle`: idle time

Visualization value:

```text
core utilization = 100 - %idle
```

Alternative source:

```text
/proc/stat
```

Each `cpuN` line can be sampled over time and converted into per-core
utilization. This is what the current telemetry backend already does.

### 2. Run Queue Conveyor

Primary purpose: immediate CPU saturation.

Shape:

- a conveyor belt, queue rail, or lane system leading toward the core reactor
- moving packets represent runnable tasks waiting for CPU time
- more waiting work means more packets, faster motion, or thicker lanes

Visual behavior:

- no pressure: mostly empty lanes, slow or idle movement
- moderate pressure: visible packets moving toward the reactor
- problem state: crowded lanes, yellow/red packets, urgent motion

Terminal correlation:

```text
vmstat 1 3
```

Useful field:

- `r`: number of runnable processes, including processes running or waiting
  for CPU

Interpretation:

```text
run queue pressure = max(r - logicalCpuCount, 0) / logicalCpuCount
```

Notes:

- `r` is an immediate, easy-to-explain CPU saturation signal.
- It is a better fit for the CPU wing than one-minute load average because it
  maps directly to “work waiting right now.”

Alternative source:

```text
/proc/loadavg
```

The fourth field looks like `running/total`, for example `3/912`. The
`running` side is another source for current runnable count, though `vmstat r`
is easier for users to recognize.

### 3. Counter / Interrupt Desk

Primary purpose: secondary CPU diagnostics.

Shape:

- Doom-style console, ticker machine, or CRT desk
- scrolling counters, but visually quieter than the core reactor
- useful for investigation, not the first thing the player notices

Potential visual behavior:

- normal: slow ticker/counter movement
- abnormal: selected counters flash or scroll faster
- severe: warning lamp on the desk, not the whole room

Terminal correlations:

```text
vmstat 1 3
```

Useful fields:

- `in`: interrupts per second
- `cs`: context switches per second
- `us`: user CPU percentage
- `sy`: system CPU percentage
- `id`: idle percentage
- `wa`: IO wait percentage
- `st`: stolen time percentage

Additional source:

```text
cat /proc/interrupts
```

Useful fields:

- per-IRQ interrupt counters
- device or interrupt source names

Visualization value:

- show high-rate interrupts as a ticker, spark line, or counter drum
- highlight sudden changes rather than raw cumulative totals

## What To Do With Load Average

Load average is useful, but it is not ideal as a dominant CPU-room visual.
It is system-wide and includes tasks in runnable state plus uninterruptible
sleep. That makes it less immediately interpretable than the `vmstat r` run
queue.

Recommendation:

- remove the large `LOAD AVG / OVERCOMMIT` station from the CPU wing, or
  demote it to a small secondary console near the run queue display
- reserve a larger load-average display for a future Software/System
  Observatory

Terminal correlation:

```text
uptime
cat /proc/loadavg
```

Useful fields:

- `load average: 1m, 5m, 15m` from `uptime`
- first three fields in `/proc/loadavg`: 1, 5, and 15 minute load averages

If retained as a small CPU-wing indicator:

```text
load overcommit = max(load1 - logicalCpuCount, 0) / logicalCpuCount
```

Visual shape:

- small pressure gauge, not a whole room
- labels should say `LOAD AVG` and `OVERCOMMIT`
- only turns yellow/red when the load average exceeds CPU capacity

## Decoration Rules

Metric-bearing elements:

- may use blue/green/yellow/red semantic color
- may animate based on telemetry
- should have a nearby sign or terminal label

Decorative elements:

- should use neutral Doom materials: metal, stone, brown tech, gray tech,
  windows, stairs, exterior sky sectors
- should avoid looking like charts, bars, gauges, warning lights, or terminals
- should not use red/yellow/green in ways that could be mistaken for system
  state

This keeps the room readable: red means problem only when it appears on a
diagnostic instrument.

## Terminal Output Interaction Plan

Idea: when the player is close to a display and presses `Space`, open a
realistic terminal-style screen showing actual Linux command output related to
that display.

Examples:

- Core Reactor: `mpstat -P ALL 1 3`
- Run Queue Conveyor: `vmstat 1 3`
- Counter Desk: `vmstat 1 3` plus `/proc/interrupts`
- Future Memory Station: `free -m`, `vmstat 1 3`, `/proc/meminfo`
- Future Storage Station: `iostat -x 1 3`, `/proc/diskstats`
- Future Network Station: `ip -s link`, `ss -tuln`, `/proc/net/dev`

### Scope Assessment

This is feasible, but it is not a small map-only change.

It likely requires:

- proximity detection in the Doom engine or browser host
- a way to identify which display the player is facing or standing near
- a key interaction path that does not conflict with door opening
- backend command execution or realistic command-output generation
- an overlay UI that can show terminal text above the Doom canvas
- escape/close handling and focus management

Recommended implementation path:

1. Browser overlay first
   - Keep Doom engine changes minimal.
   - Add an HTML/CSS terminal overlay above the canvas.
   - It can be opened by a browser-side hotkey first, before proximity is
     integrated.

2. Static realistic output
   - Start with formatted telemetry-derived output that looks like
     `vmstat`/`mpstat`, rather than shelling out to real commands.
   - This avoids security, portability, and parsing issues.

3. Proximity integration
   - Add engine exports for player position and angle, or expose the current
     display zone from Doom to TypeScript.
   - Browser decides which terminal content to show.

4. Optional real command execution
   - If needed later, the local telemetry service can run whitelisted commands
     and stream output.
   - Keep this strictly allowlisted: no arbitrary shell input from the browser.

Recommendation:

- Plan for this feature, but do not build it before the CPU-room visual
  language is settled.
- Treat it as a second phase after the three CPU instruments are simplified.
- First milestone should be a non-interactive terminal overlay that can show
  realistic `vmstat`/`mpstat` output from current telemetry.

## Proposed Next Implementation Pass

1. Remove or demote the large load-overcommit station from the CPU wing.
2. Make the central CPU core reactor the dominant room feature.
3. Make run queue saturation a physically distinct conveyor/queue feature.
4. Convert the third major display into a counter/interrupt desk.
5. Neutralize wall decorations so they do not look like metric charts.
6. Keep freestanding signs small and close to the related display.
7. Defer interactive terminal screens until the visual language is stable.

