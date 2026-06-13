# Doom Perf Wing Visualization Plan

## Purpose

Doom Perf should teach Linux resource state through rooms that are fun to look at
but mechanically obvious. The player should be able to walk into a wing and infer
three things without reading a manual:

1. **What resource am I looking at?** CPU, memory, storage, or network.
2. **Which USE signal is changing?** Utilization, saturation, or errors.
3. **What Linux state or command would confirm it?** `/proc`, `vmstat`, `iostat`,
   `free`, `sar`, or the wing terminal overlay.

The visual grammar should stay consistent across wings:

- **Utilization** is the main body of the resource becoming busy: reactors glow,
  page banks fill, platters spin, packets flow.
- **Saturation** is waiting, queuing, pressure, throttling, or the player being
  slowed by a bottleneck.
- **Errors** are exceptional destructive or leaking events: OOM monsters, dropped
  packets, NIC error drains, disk fault alarms.

Metric-bearing elements may use strong semantic color. Decorative Doom atmosphere
should stay neutral so red/yellow/green only means something when attached to an
instrument.

## Whole-Lab Visual Language

| Signal | Player intuition | Preferred shapes | Color / motion |
| --- | --- | --- | --- |
| Utilization | “How full or busy is the resource?” | Fill levels, glowing cells, spinning parts, stream density | Blue/green at normal levels; yellow/red only near sustained high use |
| Saturation | “Is work waiting or is the system pressured?” | Queues, narrow throats, pressure pads, gates, friction zones, backlog stacks | Pulsing amber/red, crowding, slowed movement, vibration |
| Errors | “Did work fail or get killed?” | Monsters, explosions, drains, broken objects, red alarms | Sudden red flashes, one-shot events, debris, alarms |

A good learning pattern is: **first glance = metaphor**, **nearby sign = signal**,
**terminal = Linux proof**.

## CPU Wing: Documented Current Design

The CPU wing is the reference wing and is mostly built. Its current structure is
already close to the desired teaching model:

### CPU utilization: central core reactor

- The central core chamber uses an eight-pillar ring/grid as the primary CPU
  utilization instrument.
- Each pillar maps to a logical CPU slot, with renderer hooks able to light the
  columns from per-core utilization.
- The intended Linux explanation is:

```text
core utilization = 100 - %idle
```

Useful terminal correlations:

```bash
mpstat -P ALL 1 3
cat /proc/stat
```

### CPU saturation: run queue subway / conveyor

- The left CPU side room is the run-queue area.
- The current concept is a queue rail or subway where runnable task orbs stream
  toward CPU service.
- The visual should emphasize “work waiting right now,” not historical load.

Useful terminal correlation:

```bash
vmstat 1 3
```

Teaching formula:

```text
run queue pressure = max(r - logicalCpuCount, 0) / logicalCpuCount
```

### CPU saturation, secondary: load average pressure

- The right CPU room currently carries load-average gauges.
- This should remain visually secondary to the immediate run queue because load
  average is a rolling average and includes uninterruptible sleep.

Useful terminal correlations:

```bash
uptime
cat /proc/loadavg
```

Teaching formula if retained:

```text
load overcommit = max(load1 - logicalCpuCount, 0) / logicalCpuCount
```

### CPU errors: intentionally absent

CPU errors are intentionally not a core live instrument because real CPU errors
are hardware/firmware events such as MCEs, EDAC errors, cache parity faults, or
thermal throttling. They are not reliably creatable inside the unprivileged lab.
The absence itself is teachable: not every USE “error” signal is equally easy or
safe to generate in a container.

## Memory Wing: Page Ecology, Pressure, and OOM Predators

Memory has the best opportunity for a memorable Doom metaphor because memory
pressure can be represented as ecology: pages grow, cache water recedes, swap
channels churn, and OOM predators destroy process objects.

### Memory utilization: page-bank greenhouse

**Primary visual:** a greenhouse/data-bank grid of square page cells.

- Used anonymous/file memory: solid green cells that rise or brighten.
- Page cache: softer cyan/green cells or a liquid reserve pool.
- Free memory: dark/empty cells.
- Reclaimable cache: visible as “water” in a reservoir that drains when pressure
  increases and refills when the system relaxes.

Useful sources:

```bash
free -m
cat /proc/meminfo
```

Teaching values:

```text
used-ish memory = MemTotal - MemAvailable
available memory = MemAvailable
cache/reserve = Cached + SReclaimable - Shmem
```

Visual intuition:

- Healthy memory use should not look scary merely because `free` is low; Linux
  uses memory for cache.
- `MemAvailable` should drive the danger state, not raw `MemFree`.

### Memory saturation: pressure pads, reclaim pumps, and friction zones

Memory saturation should feel like the machine is spending time reclaiming pages
or stalled on memory availability. Two complementary instruments are recommended.

#### Option A: PSI pressure pads

**Visual:** two pressure strips labeled `PSI SOME` and `PSI FULL`.

- `some` pressure raises an amber pad and pulses the room lights.
- `full` pressure raises a red pad, causes stronger shaking, and can unlock the
  friction lesson area.

Useful source:

```bash
cat /proc/pressure/memory
```

Teaching values:

```text
some avg10 = time at least one task was stalled on memory
full avg10 = time all non-idle tasks were stalled on memory
```

#### Option B: reclaim/swapping machine

**Visual:** side channels that pump pages into and out of swap/reclaim lanes.

- `pswpin` / `pswpout` can animate left/right swap channels.
- `pgscan` / `pgsteal` can animate reclaim claws or page sweepers.
- High scan with poor steal can look like a frantic sweeper that finds little to
  reclaim.

Useful source:

```bash
vmstat 1 3
cat /proc/vmstat
```

Teaching values:

```text
swap activity = delta(pswpin + pswpout)
reclaim activity = delta(pgscan_* + pgsteal_*)
```

### Memory errors: OOM-kill monster encounter

**Primary visual:** small process objects live in the OOM bay. Each process object
is a memory “creature,” “totem,” or “pod.”

- Object size represents RSS or proportional memory use.
- Object color represents relative risk:
  - small/cool: modest RSS
  - yellow: large process
  - red: largest process or fast-growing process
- When the kernel OOM killer count increases, a large monster spawns from the OOM
  alcove, crosses to the selected process object, destroys it, and leaves debris
  or a tombstone labeled `OOM KILL`.

Useful sources:

```bash
cat /proc/vmstat        # oom_kill
ps -eo pid,comm,rss --sort=-rss | head
```

Teaching value:

```text
OOM kill event = delta(oom_kill) > 0
```

Design note: the monster should be a one-shot error event, not a constant enemy.
The player should learn that OOM kills are discrete kernel decisions caused by
memory exhaustion, not normal high utilization.

### Best use of a 25% movement-speed friction area

A friction zone is most intuitive when it represents **saturation**, because the
player personally feels waiting/stall time. Recommended memory mapping:

- **Resource:** memory
- **Signal:** saturation
- **Metric:** memory PSI `full avg10` or `some avg10`
- **Behavior:** when pressure is high, a “reclaim tar pit” slows the player to
  25% speed inside the marked zone.

Why this works:

- PSI literally measures time tasks are stalled due to resource pressure.
- A slow movement zone makes “stall time” bodily obvious.
- It avoids confusing high memory utilization with badness; a full page cache is
  often healthy, but memory stalls are not.

Alternative mappings if memory PSI is unavailable:

1. **Storage saturation:** slow “I/O mud” driven by disk `await` or queue depth.
   This is also intuitive because blocked I/O often makes applications feel slow.
2. **CPU saturation:** a crowded scheduler hallway driven by run queue pressure.
   This is less ideal because CPU saturation is already represented by queued
   task orbs in the CPU wing.
3. **Network saturation:** a choke tunnel driven by interface backlog/drops. This
   is visually good, but player movement slowdown can be confused with network
   throughput rather than wait time.

### PSI availability and fallback impact

`/proc/pressure/{cpu,io,memory}` should be treated as an optional high-fidelity
saturation source, not a hard requirement. Some Firecracker or minimal VM images
may run kernels that omit PSI, disable it at boot, or do not expose the files in
the environment where the telemetry collector runs. If PSI is missing, the plan
should degrade gracefully rather than removing the memory pressure lesson.

Impact on the visuals:

- The **page-bank utilization** display is unaffected because it is driven by
  `/proc/meminfo` values such as `MemAvailable`, `Cached`, and `SReclaimable`.
- The **OOM monster** display is unaffected because it is driven by
  `/proc/vmstat` `oom_kill` deltas and process RSS snapshots.
- The **PSI pads** become either disabled/gray with a terminal note saying
  `PSI unavailable`, or they switch to an approximate fallback mode.
- The **25% friction zone** remains valid as a saturation lesson, but its
  trigger becomes a source-prioritized policy instead of a PSI-only rule.

Recommended memory saturation source priority:

1. **Best:** `/proc/pressure/memory` `some` / `full` `avg10`, when present.
2. **Fallback A:** `/proc/vmstat` reclaim and swap deltas, especially
   `pswpin`, `pswpout`, `pgscan_*`, and `pgsteal_*`. Use this to animate reclaim
   pumps and swap channels, and enable the friction zone only for sustained high
   activity.
3. **Fallback B:** `/proc/meminfo` availability thresholds, especially low
   `MemAvailable / MemTotal`, combined with major fault or swap activity if
   exposed. This is less precise because low available memory alone is not the
   same as stall pressure.
4. **Fallback C:** simulation mode. Keep the teaching interaction available even
   when the live VM cannot expose a safe pressure signal.

The UI should make the source explicit. A terminal line like
`SAT SOURCE: PSI`, `SAT SOURCE: VMSTAT RECLAIM`, or `SAT SOURCE: SIM` prevents
learners from assuming all environments expose the same Linux counters.

## Storage Wing: Foundry, Queue, Latency, and Fault Alarms

Storage should feel mechanical, heavy, and temporal. The most important teaching
idea is that storage can be busy, but the user experience usually degrades when
requests queue and latency rises.

### Storage utilization: spinning platter / forge

**Primary visual:** a central disk platter or foundry wheel.

- Idle: slow spin, cool amber.
- Busy: faster spin, brighter forge glow.
- Near 100% utilization: hot, vibrating, sparks.

Useful source:

```bash
iostat -xz 1 3
cat /proc/diskstats
```

Teaching values:

```text
utilization ~= fraction of sample time with I/O in progress
throughput = read_bytes_per_sec + write_bytes_per_sec
```

### Storage saturation: queue channel and latency gauges

**Primary visual:** a recessed queue trough between request balcony and disk
platter.

- Each queued I/O request is a crate, shell, or glowing block.
- Queue depth stacks crates in the trough.
- Await/service latency raises vertical gauges around the platter.

Useful terminal correlation:

```bash
iostat -xz 1 3
```

Teaching fields:

```text
avgqu-sz / aqu-sz = queue depth
await = average request wait + service time
r_await, w_await = read/write latency split
```

### Storage errors: cracked sectors and alarm sirens

Storage errors are less reliably available in simple containers, but they should
still have a reserved visual grammar:

- A cracked sector tile flashes red when read/write error counters are exposed.
- A controller console sparks for I/O errors.
- A “bad block imp” can briefly emerge from a damaged platter sector.

Possible sources depending on environment:

```bash
cat /sys/block/*/stat
journalctl -k | grep -i 'I/O error'
smartctl -a /dev/DEVICE
```

Because these often need privileges or host device access, storage error visuals
may start as simulation-only.

## Network Wing: Packet Rivers, Chokes, Drops, and Error Drains

Network should read as fluid flow. The wing already has a strong static layout:
RX/TX conduit lanes, NIC bays, a choke section, a drop basin, an error drain, and
a `/proc/net/dev` terminal.

### Network utilization: RX/TX packet rivers

**Primary visual:** two directional blue/green conduit lanes.

- RX packets flow inward toward the lab.
- TX packets flow outward away from the lab.
- Packet density and speed reflect bytes/sec or packets/sec.
- NIC branch bays light per interface.

Useful source:

```bash
cat /proc/net/dev
sar -n DEV 1 3
```

Teaching values:

```text
rx throughput = delta(rx_bytes)
tx throughput = delta(tx_bytes)
packet rate = delta(rx_packets + tx_packets)
```

### Network saturation: choke tunnel

**Primary visual:** a narrow choke in the conduit lanes.

- Normal throughput streams through cleanly.
- Congestion makes packets bunch up before the pinch.
- If queue/backlog data is available, actual queued packets stack at the choke.
- If only `/proc/net/dev` is available, use sustained high throughput plus drops
  as a practical teaching proxy, and label it explicitly as `CONGEST`.

Possible sources:

```bash
cat /proc/net/dev
ss -tin
ip -s link
tc -s qdisc show
```

Teaching values:

```text
interface saturation proxy = high utilization + increasing drops
qdisc backlog = queued bytes/packets when available
```

### Network errors: drop basin and error drain

**Primary visual:** failed packets fall out of the main stream.

- Drops spill into a side basin as dead packet skulls.
- RX/TX errors bleed into a darker drain with red sparks.
- Collisions, frame, carrier, FIFO, and compressed counters can get separate
  tiny glyphs only if the terminal needs detail; the room-level visual should
  stay simple.

Useful source:

```bash
cat /proc/net/dev
ip -s link
```

Teaching values:

```text
drops = delta(rx_drop + tx_drop)
errors = delta(rx_errs + tx_errs)
```

## Cross-Wing Recommendations

### 1. Keep one dominant instrument per signal

Each wing should have one obvious utilization instrument, one obvious saturation
instrument, and one obvious error instrument or reserved error area. Avoid
multiple loud charts for the same concept.

### 2. Make saturation physically uncomfortable

Saturation is the hardest USE signal for learners. It should be felt as queues,
pressure, bottlenecks, vibration, or movement slowdown. The proposed 25% movement
zone is best used for PSI memory pressure or I/O wait/latency.

### 3. Make errors event-driven

Errors should not look like a steady meter unless the underlying signal is a
counter rate. OOM kills, packet drops, and disk errors are easiest to understand
as sudden events: spawn, crash, drain, break, leave evidence.

### 4. Preserve terminal proof

Every instrument should have a nearby terminal or wall label that ties the Doom
metaphor back to Linux:

- CPU: `mpstat`, `vmstat`, `/proc/stat`, `/proc/loadavg`
- Memory: `free -m`, `/proc/meminfo`, `/proc/pressure/memory`, `/proc/vmstat`
- Storage: `iostat -xz`, `/proc/diskstats`
- Network: `/proc/net/dev`, `ip -s link`, `tc -s qdisc`

### 5. Teach good interpretations, not common myths

- Memory: low `MemFree` is not necessarily bad; low `MemAvailable` and PSI stalls
  are more meaningful.
- CPU: load average is useful but less immediate than run queue pressure.
- Storage: high throughput is not inherently bad; high latency/queueing is what
  users feel.
- Network: throughput alone is not an error; drops and error counters are the
  failure signals.

## Suggested Implementation Order

1. **Document and stabilize CPU as the reference.** Keep the current core ring,
   run queue, and load terminal grammar; demote any visuals that compete with the
   primary instruments.
2. **Build the memory OOM scene.** Add process objects, RSS size/color grammar,
   and the OOM monster one-shot event from `oom_kill` deltas.
3. **Add the memory friction/pressure lesson.** Drive a 25% speed zone from memory
   PSI saturation, with fallback simulation if PSI is missing.
4. **Animate storage queue and latency.** Make request crates and latency gauges
   the dominant storage saturation lesson.
5. **Animate network packet flow and drops.** Flow density teaches utilization;
   side spill/drain teaches drops/errors.
6. **Unify terminal overlays.** Ensure every instrument has a terminal proof path
   and a short text explanation in the same vocabulary as the room labels.
