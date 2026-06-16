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

### Memory saturation: reclaim pumps, swap channels, and friction zones

Memory saturation should feel like the machine is spending time reclaiming pages
or losing useful work to memory scarcity. The baseline design should use
`/proc/meminfo` and `/proc/vmstat`, because those counters are broadly available
in small VMs, containers, and Firecracker-style environments. Two complementary
instruments are recommended.

#### Option A: reclaim/swapping machine

**Visual:** side channels that pump pages into and out of swap/reclaim lanes.

- `pswpin` / `pswpout` animate left/right swap channels.
- `pgscan` / `pgsteal` animate reclaim claws or page sweepers.
- High scan with poor steal looks like a frantic sweeper that finds little to
  reclaim.
- Direct reclaim and allocation-stall counters, when present, can drive stronger
  vibration because they represent foreground work getting caught in reclaim.

Useful source:

```bash
vmstat 1 3
cat /proc/vmstat
```

Teaching values:

```text
swap activity = delta(pswpin + pswpout)
reclaim activity = delta(pgscan_* + pgsteal_*)
direct reclaim = delta(pgscan_direct + allocstall_*) when exposed
```

#### Option B: availability gates and major-fault sparks

**Visual:** a set of gates between the page-bank greenhouse and the reclaim
machine.

- Low `MemAvailable / MemTotal` closes the gates and darkens the reserve pool.
- Major faults create brief sparks at the gates.
- The room should not panic on low `MemFree` alone; the dangerous state is low
  available memory combined with reclaim, swap, major faults, or direct reclaim.

Useful source:

```bash
cat /proc/meminfo
cat /proc/vmstat
```

Teaching values:

```text
available ratio = MemAvailable / MemTotal
major fault activity = delta(pgmajfault)
scarcity warning = low available ratio + sustained reclaim/swap/fault activity
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
player personally feels slowdown from reclaim or swapping. Recommended memory
mapping:

- **Resource:** memory
- **Signal:** saturation
- **Metric:** a memory saturation score from `MemAvailable`, reclaim deltas,
  swap deltas, major faults, and direct reclaim counters when exposed.
- **Behavior:** when the score remains high for several samples, a "reclaim tar
  pit" slows the player to 25% speed inside the marked zone. Use hysteresis so it
  clears only after the score has stayed low for a short window.

Why this works:

- The score uses counters that are available in the target VM environments.
- A slow movement zone makes reclaim/swap overhead bodily obvious.
- It avoids confusing high memory utilization with badness; a full page cache is
  often healthy, but reclaim churn, swap activity, and major faults are not.

Suggested score inputs:

```text
memory saturation score =
  low MemAvailable ratio
  + sustained delta(pswpin + pswpout)
  + sustained delta(pgscan_* + pgsteal_*)
  + sustained delta(pgmajfault)
  + direct reclaim / allocstall deltas when exposed
```

Normalize deltas per second and smooth over a short rolling window so one noisy
sample causes a flash or spark, not a full movement penalty.

### Portable source policy

Do not make optional kernel pressure telemetry part of the required collector
contract. Some Firecracker or minimal VM images omit it, disable it at boot, or
do not expose it where the telemetry collector runs. The baseline plan should
run on the counters below and should keep the memory pressure lesson available
without special kernel support.

Impact on the visuals:

- The **page-bank utilization** display is unaffected because it is driven by
  `/proc/meminfo` values such as `MemAvailable`, `Cached`, and `SReclaimable`.
- The **OOM monster** display is unaffected because it is driven by
  `/proc/vmstat` `oom_kill` deltas and process RSS snapshots.
- The **pressure pads** should be reclaim/swap pads, not kernel pressure pads.
  Their labels should point at `VMSTAT RECLAIM`, `VMSTAT SWAP`, and
  `MEMAVAILABLE`.
- The **25% friction zone** remains valid as a saturation lesson, but its
  trigger is the portable saturation score above.

Recommended memory saturation source priority:

1. **Primary:** `/proc/vmstat` reclaim and swap deltas, especially
   `pswpin`, `pswpout`, `pgscan_*`, and `pgsteal_*`. Use this to animate reclaim
   pumps and swap channels, and enable the friction zone only for sustained high
   activity.
2. **Primary assist:** `/proc/meminfo` availability thresholds, especially low
   `MemAvailable / MemTotal`, combined with major fault, swap, reclaim, or direct
   reclaim activity if exposed.
3. **Optional enrichments:** `vmstat 1`, process RSS snapshots, and cgroup memory
   counters when the lab already has a cgroup-specific view.
4. **Simulation mode:** keep the teaching interaction available even when the
   live VM cannot expose a safe saturation signal.

The UI should make the source explicit. A terminal line like
`SAT SOURCE: VMSTAT RECLAIM`, `SAT SOURCE: MEMINFO+VMSTAT`, or
`SAT SOURCE: SIM` prevents learners from assuming all environments expose the
same Linux counters.

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
zone is best used for memory reclaim/swap pressure or I/O wait/latency.

### 3. Make errors event-driven

Errors should not look like a steady meter unless the underlying signal is a
counter rate. OOM kills, packet drops, and disk errors are easiest to understand
as sudden events: spawn, crash, drain, break, leave evidence.

### 4. Preserve terminal proof

Every instrument should have a nearby terminal or wall label that ties the Doom
metaphor back to Linux:

- CPU: `mpstat`, `vmstat`, `/proc/stat`, `/proc/loadavg`
- Memory: `free -m`, `/proc/meminfo`, `/proc/vmstat`
- Storage: `iostat -xz`, `/proc/diskstats`
- Network: `/proc/net/dev`, `ip -s link`, `tc -s qdisc`

### 5. Teach good interpretations, not common myths

- Memory: low `MemFree` is not necessarily bad; low `MemAvailable` combined with
  reclaim, swap, major faults, or direct reclaim is more meaningful.
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
3. **Add the memory friction/pressure lesson.** Drive a 25% speed zone from the
   portable memory saturation score, with simulation fallback if live counters
   are missing.
4. **Animate storage queue and latency.** Make request crates and latency gauges
   the dominant storage saturation lesson.
5. **Animate network packet flow and drops.** Flow density teaches utilization;
   side spill/drain teaches drops/errors.
6. **Unify terminal overlays.** Ensure every instrument has a terminal proof path
   and a short text explanation in the same vocabulary as the room labels.
