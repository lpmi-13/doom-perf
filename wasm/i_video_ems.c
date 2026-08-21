#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <SDL2/SDL.h>
#include <emscripten.h>
#include <emscripten/html5.h>

#include "d_main.h"
#include "doomdef.h"
#include "doomstat.h"
#include "i_system.h"
#include "i_video.h"
#include "v_video.h"
#include "m_fixed.h"
#include "m_random.h"
#include "p_mobj.h"
#include "r_main.h"

// Doom Perf: CPU room telemetry in per-mille (0..1000), pushed from the
// browser telemetry SSE stream. Declared extern in doom_emscripten_compat.h
// (force-included into every Doom translation unit).
int doomperf_cpu_core_count = 0;
int doomperf_cpu_cores[DOOMPERF_MAX_CPU_CORES];
int doomperf_cpu_run_queue_pressure = 0;
int doomperf_cpu_run_queue_count = 0;
int doomperf_cpu_blocked_count = 0;
int doomperf_cpu_load_pressure = 0;
int doomperf_load[3] = {0, 0, 0};
int doomperf_storage_await = 0;
int doomperf_storage_read_await = 0;   // r_await target (permille of 250ms); slewed in p_tick.c
int doomperf_storage_write_await = 0;  // w_await target (permille of 250ms); slewed in p_tick.c
int doomperf_causeway_redness = 0;     // permille await severity -> red-vignette reach + colour (set in p_tick.c)
int doomperf_causeway_pulse = 0;       // permille piston pump triangle -> red-vignette strobe (set in p_tick.c)
int doomperf_storage_util = 0;
int doomperf_storage_queue = 0;
int doomperf_storage_iops_spike = 0;
int doomperf_storage_usage = 0;                              // df / used fraction (permille)
int doomperf_storage_iops = 0;                               // aggregate ops/s (permille of full scale)
int doomperf_storage_dev_count = 0;                          // active devices in the per-device rain-gauge row
int doomperf_storage_dev_iops[DOOMPERF_STORAGE_DEV_SLOTS];   // per-device ops/s (permille): rain FALL SPEED
int doomperf_storage_dev_util[DOOMPERF_STORAGE_DEV_SLOTS];   // per-device %util (permille): rain DENSITY + brightness
char doomperf_storage_dev_name[DOOMPERF_STORAGE_DEV_SLOTS][DOOMPERF_DEV_NAME_MAX + 1]; // per-device name for the floating labels
int doomperf_storage_device_queue = 0;                       // face-7 device rack fill: in-flight tags (permille)
int doomperf_storage_sched_backlog = 0;                      // face-7 scheduler magazine fill: backlog (permille)
int doomperf_memory_util = 0;
int doomperf_memory_saturation = 0;
int doomperf_memory_errors = 0;
int doomperf_memory_cache = 0;
int doomperf_memory_proc_count = 0;
int doomperf_memory_proc_oom[DOOMPERF_MEMORY_PROC_SLOTS];
int doomperf_memory_minflt = 0;
int doomperf_memory_majflt = 0;
int doomperf_memory_swap_present = 0;  // 1 when a swap device is configured on the host
int doomperf_memory_swap_activity = 0; // swap si+so rate as permille of full scale
int doomperf_oom_event = 0;
int doomperf_oom_victim = 0;
int doomperf_net_rx = 0;
int doomperf_net_tx = 0;
// Three-lock canal (NETWORK_CANAL_PLAN.md). Per lock (0/1/2 = socket/kernel/ring)
// and lane (0/1 = rx/tx): the pool fill (queue occupancy, permille) and its overspill
// drop rate. Plus the global softnet squeeze, the socket accept-backlog + SYN-RECV
// counts, and whether the NIC ring depth is known per lane (gates the ring brim).
int doomperf_net_lock_fill[3][2];
int doomperf_net_lock_drops[3][2];
int doomperf_net_softnet_squeeze = 0;
// Kernel-RX softnet backlog DROP rate (permille): the per-CPU input queue
// (netdev_max_backlog) overflowed. Fed separately from the blended kernel-RX
// drop so the softnet decomposition coils read the pure backlog-overflow cause.
int doomperf_net_softnet_drops = 0;
int doomperf_net_backlogged = 0;
int doomperf_net_synrecv = 0;
int doomperf_net_ring_known[2] = {0, 0};
// Kernel-TX QDISC floor instrument (NETWORK_QDISC_DISC_PLAN.md). fill = the real qdisc
// backlog occupancy (permille, 0 when unknown); known = whether tc's netlink backlog is
// readable (drives the disc's known/unknown mode + the DPNQDG<->DPNQDX placard swap). Both
// are browser-pushed. flow + sat are NOT browser-set: p_tick.c publishes them each tick and
// the r_draw floor shaders read them -- flow = TX throughput (drain-pulse cadence),
// sat = max(TX drop, qdisc fill) (trips the inflow line solid red at enqueue loss).
int doomperf_net_qdisc_fill = 0;
int doomperf_net_qdisc_known = 0;
int doomperf_net_qdisc_flow = 0;
int doomperf_net_qdisc_sat = 0;
int doomperf_sim_mode = 0;

// Doom Perf: title wordmark "oo" live-load pulse (see doom_emscripten_compat.h).
// The oo is drawn with reserved palette indices DOOMPERF_OO_TAG[]; while
// doomperf_title_remap is set (V_DrawPatch, around the TITLEPIC/M_DOOM draws) those
// indices are remapped through doomperf_title_lut to a bright amber darkened via
// the engine's COLORMAP — dim at rest, brighter with CPU load plus a gentle pulse.
extern lighttable_t* colormaps;
int doomperf_title_remap = 0;
unsigned char doomperf_title_lut[256];
static int doomperf_title_load = 0;                  // 0..1000 per-mille CPU load
static const unsigned char DOOMPERF_OO_TAG[4] = {16, 17, 18, 19}; // HI,MID,LO,RIM
#define DOOMPERF_AMBER_BASE 248                       // bright amber; colormap darkens it

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetTitleLoad(int permille)
{
    if (permille < 0) permille = 0;
    if (permille > 1000) permille = 1000;
    doomperf_title_load = permille;
}

void DoomPerf_UpdateTitleLut(void)
{
    int i;
    for (i = 0; i < 256; i++)
        doomperf_title_lut[i] = (unsigned char)i;     // identity for everything else
    if (!colormaps)
        return;
    // Triangle pulse off the game tic (~35 Hz), period ~48 tics (~1.4s).
    int period = 48;
    int phase = (int)(gametic % period);
    int tri = phase < period / 2 ? phase : period - phase;   // 0..24
    int pulse = (24 - tri) / 6;                              // 0..4, peaks mid-cycle
    int boost = (doomperf_title_load * 8) / 1000;            // 0..8 from CPU load
    int top = 11 - boost - pulse;                            // colormap level for the highlight (lower = brighter)
    for (i = 0; i < 4; i++)
    {
        int lvl = top + i * 3;                               // per-shade HI<MID<LO<RIM (darker)
        if (lvl < 0) lvl = 0;
        if (lvl > 31) lvl = 31;
        doomperf_title_lut[DOOMPERF_OO_TAG[i]] = colormaps[lvl * 256 + DOOMPERF_AMBER_BASE];
    }
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetCpuCoreCount(int count)
{
    if (count < 0)
        count = 0;
    if (count > DOOMPERF_MAX_CPU_CORES)
        count = DOOMPERF_MAX_CPU_CORES;
    doomperf_cpu_core_count = count;
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetCpuCore(int index, int permille)
{
    if (index < 0 || index >= DOOMPERF_MAX_CPU_CORES)
        return;
    if (permille < 0)
        permille = 0;
    if (permille > 1000)
        permille = 1000;
    doomperf_cpu_cores[index] = permille;
}

static int DoomPerf_ClampPermille(int permille)
{
    if (permille < 0)
        return 0;
    if (permille > 1000)
        return 1000;
    return permille;
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetCpuRunQueuePressure(int permille)
{
    doomperf_cpu_run_queue_pressure = DoomPerf_ClampPermille(permille);
}

// Raw runnable-task count (vmstat 'r'): runnable processes, including those
// already on a CPU. Drives the run-queue reservoir's fill level and overflow
// token count in p_tick.c.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetCpuRunQueueCount(int count)
{
    doomperf_cpu_run_queue_count = (count < 0) ? 0 : count;
}

// Uninterruptible-sleep (D-state, vmstat 'b') count: threads blocked on I/O, not
// the CPU run queue. Drives the I/O-wait orbs that gather off the main flow.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetCpuBlockedCount(int count)
{
    doomperf_cpu_blocked_count = (count < 0) ? 0 : count;
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetCpuLoadPressure(int permille)
{
    doomperf_cpu_load_pressure = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetLoad(int index, int milliLoad)
{
    if (index < 0 || index > 2)
        return;
    if (milliLoad < 0)
        milliLoad = 0;
    doomperf_load[index] = milliLoad;
}

// Disk service time (iostat await) as permille of a 250ms full scale. Drives the
// media-pit latency gauges in the storage wing; ignored there in a disk sim,
// which synthesizes its own await (see r_draw.c R_DoomPerfDiskAwaitPermille).
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageAwait(int permille)
{
    doomperf_storage_await = DoomPerf_ClampPermille(permille);
}

// r_await / w_await (worst-await device) on the same 250ms full scale, driving the
// latency causeway's read/write lanes. These set only the TARGET; p_tick.c's
// DoomPerf_UpdateCauseway slews smoothed copies toward them so a worst-device
// switch eases the player's speed in rather than snapping it.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageReadAwait(int permille)
{
    doomperf_storage_read_await = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageWriteAwait(int permille)
{
    doomperf_storage_write_await = DoomPerf_ClampPermille(permille);
}

// Disk busy fraction (iostat %util) in permille. Drives the media-pit platter's
// pulsing rings in the storage wing; ignored there in a disk sim, which
// synthesizes its own utilization (see p_tick.c DoomPerf_UpdatePlatter).
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageUtil(int permille)
{
    doomperf_storage_util = DoomPerf_ClampPermille(permille);
}

// Disk request-queue depth (iostat aqu-sz) as permille of a 24-request full
// channel. Drives the media-pit queue channel's flowing request blocks; ignored
// there in a disk sim, which synthesizes its own depth (see r_draw.c
// R_DoomPerfDiskQueuePermille).
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageQueue(int permille)
{
    doomperf_storage_queue = DoomPerf_ClampPermille(permille);
}

// Pulse the media-pit metrics dashboard's IOPS graph. The browser calls this
// once per audible yell in the easter-egg sting (so a single trigger makes one
// spike); the value is a tic countdown that p_tick.c decays, scrolling a visible
// spike across the IOPS section.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_TriggerStorageIopsSpike(void)
{
    doomperf_storage_iops_spike = DOOMPERF_DASH_SPIKE_TICS;
}

// Root-filesystem usage (`df /`) as a permille of capacity. Drives the disk-usage
// CUBE plinth in the storage wing -- an isometric voxel gauge that fills bottom-up
// (r_draw.c R_DoomPerfDiskCubePixel, line tag 665); ignored in a disk sim, which
// synthesizes its own fill.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageUsage(int permille)
{
    doomperf_storage_usage = DoomPerf_ClampPermille(permille);
}

// Aggregate completed-operations rate (reads+writes/s) as a permille of a full
// scale (see IOPS_FULLSCALE in index.ts). Feeds the metrics-dashboard IOPS graph
// (p_tick.c DoomPerf_UpdateDiskDashboard) with a real signal instead of the old
// queue-derived proxy; sims keep their synthetic value.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageIops(int permille)
{
    doomperf_storage_iops = DoomPerf_ClampPermille(permille);
}

// How many of the per-device IOPS counter-bank columns carry a live device this
// frame (the browser pushes the busiest N from diskstats, N<=DOOMPERF_STORAGE_DEV_SLOTS).
// Columns past the count rest flat/dark.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageDeviceCount(int count)
{
    if (count < 0)
        count = 0;
    if (count > DOOMPERF_STORAGE_DEV_SLOTS)
        count = DOOMPERF_STORAGE_DEV_SLOTS;
    doomperf_storage_dev_count = count;
}

// Completed-operations rate (permille of a per-device full scale) for rain-gauge
// slot `index`, slot 0 being the busiest device. Read by DoomPerf_UpdateDiskRain,
// which drives that gauge's rain FALL SPEED from its I/O rate.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageDeviceIops(int index, int permille)
{
    if (index < 0 || index >= DOOMPERF_STORAGE_DEV_SLOTS)
        return;
    doomperf_storage_dev_iops[index] = DoomPerf_ClampPermille(permille);
}

// Utilization (permille) for rain-gauge slot `index`. Read by DoomPerf_UpdateDiskRain,
// which drives that gauge's rain DENSITY (how many drops fall) and beam brightness
// from how saturated the device is.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageDeviceUtil(int index, int permille)
{
    if (index < 0 || index >= DOOMPERF_STORAGE_DEV_SLOTS)
        return;
    doomperf_storage_dev_util[index] = DoomPerf_ClampPermille(permille);
}

// One character of rain-gauge slot `slot`'s device name (charAt `pos`, ASCII `code`;
// the browser uppercases + truncates and writes a 0 terminator). Read by
// DoomPerf_DrawDeviceLabels, which floats the name over that gauge.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageDeviceName(int slot, int pos, int code)
{
    if (slot < 0 || slot >= DOOMPERF_STORAGE_DEV_SLOTS)
        return;
    if (pos < 0 || pos > DOOMPERF_DEV_NAME_MAX)
        return;
    doomperf_storage_dev_name[slot][pos] = (char)code;
}

// The two-tier DISK IO QUEUE fills for the face-7 rack, each a permille the browser
// computes with the cap-adaptive scaling (shallow deviceQueue/cap vs deep
// deviceQueue/high-water). Read by p_tick.c DoomPerf_UpdateDiskQueueRack, which
// raises the device rack (tag 650) and the taller scheduler magazine (tag 651).
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageDeviceQueue(int permille)
{
    doomperf_storage_device_queue = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetStorageSchedBacklog(int permille)
{
    doomperf_storage_sched_backlog = DoomPerf_ClampPermille(permille);
}

// Memory utilization is 1 - MemAvailable/MemTotal. It drives the memory wing's
// page bank fill; memory saturation and errors drive the swap/PSI/OOM stations.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryUtil(int permille)
{
    doomperf_memory_util = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemorySaturation(int permille)
{
    doomperf_memory_saturation = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryErrors(int permille)
{
    doomperf_memory_errors = DoomPerf_ClampPermille(permille);
}

// Reclaimable page cache (Buffers+Cached) as a permille of MemTotal. Read by the
// library wing's shelf in p_tick.c to color books working-set (green) vs page
// cache (cyan); see doomperf_memory_cache in doom_emscripten_compat.h.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryCacheFraction(int permille)
{
    doomperf_memory_cache = DoomPerf_ClampPermille(permille);
}

// How many of the RSS-reliquary barrel slots carry a live process this frame
// (the browser pushes the top-N from `ps --sort=-rss`, N<=DOOMPERF_MEMORY_PROC_SLOTS).
// Slots past the count are dimmed to their resting glow.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryProcessCount(int count)
{
    if (count < 0)
        count = 0;
    if (count > DOOMPERF_MEMORY_PROC_SLOTS)
        count = DOOMPERF_MEMORY_PROC_SLOTS;
    doomperf_memory_proc_count = count;
}

// OOM badness (/proc/<pid>/oom_score in permille) for barrel slot `index`, slot
// 0 being the largest resident set. Read by DoomPerf_UpdateMemoryWing, which
// maps it to the barrel's pedestal light so a near-OOM process glows hot.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryProcessOom(int index, int permille)
{
    if (index < 0 || index >= DOOMPERF_MEMORY_PROC_SLOTS)
        return;
    doomperf_memory_proc_oom[index] = DoomPerf_ClampPermille(permille);
}

// Page-fault rates in permille of a reference (minor mostly workload; major =
// disk/swap refaults, a saturation signal). Drive the paging bay's fault meters.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryMinorFaults(int permille)
{
    doomperf_memory_minflt = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemoryMajorFaults(int permille)
{
    doomperf_memory_majflt = DoomPerf_ClampPermille(permille);
}

// Whether the host has a swap device configured (swapTotalBytes > 0). Drives the
// reclaim sluice's swap RELIEF VENT: when 0 the duct is capped (welded pipe, red
// "NO SWAP / RELIEF / OOM KILL" placard, alarm light as the pool nears the brim) so a
// swapless host reads unmistakably; when 1 it hisses steam as swap pages.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemorySwapPresent(int present)
{
    doomperf_memory_swap_present = present ? 1 : 0;
}

// Swap in+out paging rate (vmstat si+so) as a permille of full scale. Drives the
// glow/ripple of the swap tributary when swap is present.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetMemorySwapActivity(int permille)
{
    doomperf_memory_swap_activity = DoomPerf_ClampPermille(permille);
}

// Fire the Baron OOM-kill event: latch a pending kill naming the victim barrel
// slot (0 = largest resident set). DoomPerf_UpdateOomBaron consumes the latch,
// sends the penned baron to that barrel, and detonates it. The browser calls this
// when the live oom_kill counter increments; a new kill arriving mid-event is
// dropped (approximate timing is acceptable).
EMSCRIPTEN_KEEPALIVE
void DoomPerf_TriggerMemoryOomKill(int slot)
{
    if (slot < 0 || slot >= DOOMPERF_MEMORY_PROC_SLOTS)
        slot = 0;
    doomperf_oom_victim = slot;
    doomperf_oom_event = 1;
}

// Network receive/transmit throughput, each as a permille of a full-scale link
// (the browser scales bytes/sec to a 1 Gbit reference; see src/index.ts). Drives
// the density of the packet-orb streams in the network wing's grove.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetworkRx(int permille)
{
    doomperf_net_rx = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetworkTx(int permille)
{
    doomperf_net_tx = DoomPerf_ClampPermille(permille);
}

// Three-lock canal setters. The lock fills/drops are pushed for BOTH live and sim
// (src/index.ts feeds them from the effective snapshot), so p_tick.c reads them
// directly — no engine-side sim synthesis, unlike the orb density below.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetLockFill(int level, int lane, int permille)
{
    if (level < 0 || level >= 3 || lane < 0 || lane >= 2)
        return;
    doomperf_net_lock_fill[level][lane] = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetLockDrops(int level, int lane, int permille)
{
    if (level < 0 || level >= 3 || lane < 0 || lane >= 2)
        return;
    doomperf_net_lock_drops[level][lane] = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetSoftnetSqueeze(int permille)
{
    doomperf_net_softnet_squeeze = DoomPerf_ClampPermille(permille);
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetSoftnetDrops(int permille)
{
    doomperf_net_softnet_drops = DoomPerf_ClampPermille(permille);
}

// Kernel-TX qdisc backlog occupancy (permille). 0 when unknown -- the disc then draws its
// indeterminate "scanning" state, driven by doomperf_net_qdisc_known below.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetQdiscFill(int permille)
{
    doomperf_net_qdisc_fill = DoomPerf_ClampPermille(permille);
}

// 1 when tc's qdisc backlog is readable (netlink), 0 when it is not (?qdisc=off or a
// restricted container). Selects the disc's known-fill vs unknown-sweep mode and the
// DPNQDG (DEPTH) <-> DPNQDX (UNKNOWN) placard the engine shows.
EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetQdiscKnown(int known)
{
    doomperf_net_qdisc_known = known ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetBacklogged(int count)
{
    doomperf_net_backlogged = (count < 0) ? 0 : count;
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetSynRecv(int count)
{
    doomperf_net_synrecv = (count < 0) ? 0 : count;
}

EMSCRIPTEN_KEEPALIVE
void DoomPerf_SetNetRingDepthKnown(int lane, int known)
{
    if (lane < 0 || lane >= 2)
        return;
    doomperf_net_ring_known[lane] = known ? 1 : 0;
}

static int DoomPerf_EffectiveCoreCountValue(void)
{
    if (doomperf_sim_mode != 0)
        return 8;
    return doomperf_cpu_core_count;
}

static int DoomPerf_EffectiveCpuCoreValue(int index)
{
    switch (doomperf_sim_mode)
    {
    case 1:
        return 880 + ((leveltime * 2 + index * 97) % 120);
    case 2:
        return 700 + ((leveltime + index * 53) % 200);
    default:
        return (index >= 0 && index < doomperf_cpu_core_count)
            ? doomperf_cpu_cores[index] : 0;
    }
}

static int DoomPerf_EffectiveRunQueuePressureValue(void)
{
    switch (doomperf_sim_mode)
    {
    case 1:
        return 150;
    case 2:
        return 840 + ((leveltime * 3) % 160);
    default:
        return doomperf_cpu_run_queue_pressure;
    }
}

static int DoomPerf_EffectiveLoadValue(int index)
{
    if (index < 0 || index > 2)
        return 0;

    switch (doomperf_sim_mode)
    {
    case 1:
        if (index == 0)
            return 7600 + ((leveltime * 5) % 400);
        if (index == 1)
            return 7000 + ((leveltime * 3) % 350);
        return 6200 + ((leveltime * 2) % 300);
    case 2:
        if (index == 0)
            return 14800 + ((leveltime * 5) % 800);
        if (index == 1)
            return 13800 + ((leveltime * 3) % 700);
        return 12600 + ((leveltime * 2) % 600);
    default:
        return doomperf_load[index];
    }
}

static int DoomPerf_EffectiveLoadPressureValue(void)
{
    int cores = DoomPerf_EffectiveCoreCountValue();
    int load = DoomPerf_EffectiveLoadValue(0);
    int overcommit;

    if (doomperf_sim_mode == 1)
        return 0;

    if (cores < 1)
        cores = 1;

    overcommit = load - cores * 1000;
    if (overcommit <= 0)
        return 0;
    return DoomPerf_ClampPermille((overcommit * 1000) / (cores * 1000));
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetSimMode(void)
{
    return doomperf_sim_mode;
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetEffectiveCpuCoreCount(void)
{
    return DoomPerf_EffectiveCoreCountValue();
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetEffectiveCpuCore(int index)
{
    return DoomPerf_ClampPermille(DoomPerf_EffectiveCpuCoreValue(index));
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetEffectiveCpuRunQueuePressure(void)
{
    return DoomPerf_ClampPermille(DoomPerf_EffectiveRunQueuePressureValue());
}

// Sim-aware runnable count for the reservoir tick (p_tick.c). In live mode this
// is the raw vmstat 'r' pushed from the browser; in a simulation there is no
// real count, so derive one from the synthetic run-queue pressure
// (pressure = (r - cores) / cores, so r = cores * (1 + pressure/1000)).
int DoomPerf_EffectiveRunQueueCount(void)
{
    int cores = DoomPerf_EffectiveCoreCountValue();
    int pressure;
    if (cores < 1)
        cores = 1;
    // Live telemetry with a raw count (vmstat 'r') is authoritative; otherwise
    // (simulations, or live without the collector's count) derive from pressure.
    if (doomperf_sim_mode == 0 && doomperf_cpu_run_queue_count > 0)
        return doomperf_cpu_run_queue_count;
    pressure = DoomPerf_EffectiveRunQueuePressureValue();
    return cores + (pressure * cores + 500) / 1000;
}

// Sim-aware D-state (vmstat 'b') count for the I/O-wait stack. Live uses the
// pushed count. The high-saturation sim (mode 2) synthesizes a value that wanders
// in [10,18] with bursty, dramatic rises (a "rising" second adds ~4 orbs/sec) and
// a gradual 1/sec cool-down, like a load average; the high-util sim shows a small
// constant. The synthetic value advances once per tic (gated on leveltime) so
// repeat calls within a tic never double-step it.
int DoomPerf_EffectiveBlockedCount(void)
{
    static int blocked = 14;
    static int rising = 0;
    static int last_tic = -1;

    if (doomperf_sim_mode == 2)
    {
        if (leveltime != last_tic)
        {
            last_tic = leveltime;
            if (leveltime == 0)
            {
                blocked = 14;
                rising = 0;
            }
            else
            {
                // ~1/sec: re-roll the rising/cooling phase and cool one orb.
                if ((leveltime % 35) == 0)
                {
                    rising = (P_Random() < 64);  // ~25% of seconds are rising
                    if (blocked > 10)
                        blocked--;
                }
                // ~4/sec: while rising, add one orb (a dramatic spike).
                if (rising && (leveltime % 9) == 0 && blocked < 18)
                    blocked++;
            }
        }
        return blocked;
    }
    if (doomperf_sim_mode != 0)
        return 4;
    return doomperf_cpu_blocked_count;
}

// Exposed to the browser so the vmstat `b` column shows the same D-state count
// that drives the green I/O-wait orb stack (single source of truth in sim mode).
EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetEffectiveCpuBlockedCount(void)
{
    return DoomPerf_EffectiveBlockedCount();
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetEffectiveCpuLoadPressure(void)
{
    return DoomPerf_EffectiveLoadPressureValue();
}

// Bursty synthetic throughput for the network sims: each channel random-walks with
// occasional surges and lulls (a "real traffic" feel) rather than a smooth ramp,
// so the grove fills and empties in waves. Advanced once per tic (gated on
// leveltime) so the two reads per tic (rx, tx) and any repeats are stable. `bias`
// lifts the saturation sim above the utilization sim. Channel 0 = rx, 1 = tx.
static int DoomPerf_NetSimThroughput(int channel, int bias)
{
    static int  level[2] = {520, 470};
    static int  last_tic = -1;

    if (leveltime != last_tic)
    {
        last_tic = leveltime;
        if (leveltime == 0)
        {
            level[0] = 520;
            level[1] = 470;
        }
        else if ((leveltime % 6) == 0) // ~6/sec: re-roll the wander
        {
            int c;
            for (c = 0; c < 2; c++)
            {
                int r = P_Random();
                if (r < 22)             // ~9%: a surge
                    level[c] += 260;
                else if (r < 58)        // ~14%: a lull
                    level[c] -= 230;
                else                    // small drift
                    level[c] += (r & 31) - 15;
                if (level[c] < 90)
                    level[c] = 90;
                if (level[c] > 900)
                    level[c] = 900;
            }
        }
    }
    return level[channel] + bias;
}

// Sim-aware network throughput (permille) for the packet-grove tick (p_tick.c).
// Live mode returns the value pushed from the browser (the grove's own bursty
// spawn cadence keeps even steady live traffic from reading as a uniform train);
// the network sims (7/8) drive a bursty high synthetic throughput; the other
// wings' sims keep a gentle ambient flow so the grove is never dead.
static int DoomPerf_EffectiveNetworkValue(int live, int channel)
{
    switch (doomperf_sim_mode)
    {
    case 0: // live telemetry
        return live;
    case 9: // SIM: HIGH NETWORK UTILIZATION (bursty mid-high)
        return DoomPerf_NetSimThroughput(channel, 0);
    case 10: // SIM: HIGH NETWORK SATURATION (bursty, biased higher)
        return DoomPerf_NetSimThroughput(channel, 200);
    default: // other wings' sims: a calm ambient stream
        return 110 + ((leveltime + channel * 90) % 40);
    }
}

int DoomPerf_EffectiveNetworkRx(void)
{
    return DoomPerf_ClampPermille(DoomPerf_EffectiveNetworkValue(doomperf_net_rx, 0));
}

int DoomPerf_EffectiveNetworkTx(void)
{
    return DoomPerf_ClampPermille(DoomPerf_EffectiveNetworkValue(doomperf_net_tx, 1));
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_GetEffectiveLoad(int index)
{
    return DoomPerf_EffectiveLoadValue(index);
}

// Doom Perf: expose the player's world position so the browser can detect
// proximity to the instrument signs and pop a terminal overlay on USE.
EMSCRIPTEN_KEEPALIVE
int DoomPerf_PlayerActive(void)
{
    return (gamestate == GS_LEVEL && players[0].mo) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_PlayerX(void)
{
    return players[0].mo ? (players[0].mo->x >> FRACBITS) : 0;
}

EMSCRIPTEN_KEEPALIVE
int DoomPerf_PlayerY(void)
{
    return players[0].mo ? (players[0].mo->y >> FRACBITS) : 0;
}

// Doom Perf: report the player's facing as degrees in [0,360), with 0 = east
// (+x) and 90 = north (+y), matching the world axes DoomPerf_PlayerX/Y use. The
// mobj angle is a full-circle BAM (angle_t spans 0..2^32), so we scale by
// 360/2^32. The browser uses this to suppress the interact prompt when the
// player is turned away from the door/terminal they are standing near.
EMSCRIPTEN_KEEPALIVE
int DoomPerf_PlayerAngle(void)
{
    return players[0].mo
        ? (int)(((uint64_t)(uint32_t)players[0].mo->angle * 360u) >> 32)
        : 0;
}

// Doom Perf: report the vertical opening (ceiling minus floor, in map units)
// of the sector at a world point so the browser can tell whether a hub door is
// currently shut. A closed DR door (linedef special 1) has its ceiling dropped
// to the floor, so the opening is 0; an open or opening door has headroom. The
// interact prompt uses this to stop advertising "Open Door" once the door the
// player is standing at has already opened (it auto-closes again afterward).
EMSCRIPTEN_KEEPALIVE
int DoomPerf_SectorOpenRange(int x, int y)
{
    subsector_t* subsector;
    fixed_t opening;

    if (gamestate != GS_LEVEL)
        return 0;

    subsector = R_PointInSubsector(x << FRACBITS, y << FRACBITS);
    if (!subsector || !subsector->sector)
        return 0;

    opening = subsector->sector->ceilingheight - subsector->sector->floorheight;
    if (opening < 0)
        opening = 0;
    return opening >> FRACBITS;
}

static SDL_Window* window;
static SDL_Renderer* renderer;
static SDL_Texture* texture;
static uint32_t rgba_framebuffer[SCREENWIDTH * SCREENHEIGHT];
static uint32_t palette_rgba[256];
static boolean graphics_initialized = false;

static int TranslateKey(SDL_Keycode key)
{
    switch (key)
    {
    case SDLK_LEFT:
        return KEY_LEFTARROW;
    case SDLK_RIGHT:
        return KEY_RIGHTARROW;
    case SDLK_UP:
        return KEY_UPARROW;
    case SDLK_DOWN:
        return KEY_DOWNARROW;
    case SDLK_ESCAPE:
        return KEY_ESCAPE;
    case SDLK_RETURN:
    case SDLK_KP_ENTER:
        return KEY_ENTER;
    case SDLK_TAB:
        return KEY_TAB;
    case SDLK_F1:
        return KEY_F1;
    case SDLK_F2:
        return KEY_F2;
    case SDLK_F3:
        return KEY_F3;
    case SDLK_F4:
        return KEY_F4;
    case SDLK_F5:
        return KEY_F5;
    case SDLK_F6:
        return KEY_F6;
    case SDLK_F7:
        return KEY_F7;
    case SDLK_F8:
        return KEY_F8;
    case SDLK_F9:
        return KEY_F9;
    case SDLK_F10:
        return KEY_F10;
    case SDLK_F11:
        return KEY_F11;
    case SDLK_F12:
        return KEY_F12;
    case SDLK_BACKSPACE:
    case SDLK_DELETE:
        return KEY_BACKSPACE;
    case SDLK_PAUSE:
        return KEY_PAUSE;
    case SDLK_EQUALS:
    case SDLK_KP_EQUALS:
        return KEY_EQUALS;
    case SDLK_MINUS:
    case SDLK_KP_MINUS:
        return KEY_MINUS;
    case SDLK_LSHIFT:
    case SDLK_RSHIFT:
        return KEY_RSHIFT;
    case SDLK_LCTRL:
    case SDLK_RCTRL:
        return KEY_RCTRL;
    case SDLK_LALT:
    case SDLK_RALT:
        return KEY_RALT;
    default:
        break;
    }

    if (key >= SDLK_SPACE && key <= SDLK_z)
    {
        return key;
    }

    return 0;
}

static int MouseButtons(Uint32 state)
{
    int buttons = 0;

    if (state & SDL_BUTTON_LMASK)
    {
        buttons |= 1;
    }
    if (state & SDL_BUTTON_MMASK)
    {
        buttons |= 2;
    }
    if (state & SDL_BUTTON_RMASK)
    {
        buttons |= 4;
    }

    return buttons;
}

static void PostKeyEvent(evtype_t type, SDL_Keycode key)
{
    event_t event;
    int doom_key = TranslateKey(key);

    if (!doom_key)
    {
        return;
    }

    event.type = type;
    event.data1 = doom_key;
    event.data2 = 0;
    event.data3 = 0;
    D_PostEvent(&event);
}

static void PostMouseEvent(int buttons, int xrel, int yrel)
{
    event_t event;

    event.type = ev_mouse;
    event.data1 = buttons;
    event.data2 = xrel << 2;
    event.data3 = -yrel << 2;
    D_PostEvent(&event);
}

static void PollEvents(void)
{
    SDL_Event sdl_event;

    while (SDL_PollEvent(&sdl_event))
    {
        switch (sdl_event.type)
        {
        case SDL_KEYDOWN:
            if (!sdl_event.key.repeat)
            {
                PostKeyEvent(ev_keydown, sdl_event.key.keysym.sym);
            }
            break;
        case SDL_KEYUP:
            PostKeyEvent(ev_keyup, sdl_event.key.keysym.sym);
            break;
        case SDL_MOUSEBUTTONDOWN:
        case SDL_MOUSEBUTTONUP:
            PostMouseEvent(MouseButtons(SDL_GetMouseState(0, 0)), 0, 0);
            break;
        case SDL_MOUSEMOTION:
            PostMouseEvent(
                MouseButtons(sdl_event.motion.state),
                sdl_event.motion.xrel,
                sdl_event.motion.yrel
            );
            break;
        case SDL_QUIT:
            I_Quit();
            break;
        default:
            break;
        }
    }
}

// Doom Perf: size the SDL backing store (the canvas drawing buffer) to the
// display's physical pixels and let SDL_RenderSetLogicalSize do the 320x200 ->
// device upscale with nearest-neighbour. Without this the backing store stays a
// tiny 320x200 buffer and the browser/compositor bilinear-stretches it to the
// screen — very visible as soft far walls and smeared sprites under fractional
// desktop scaling and on high-DPI phones (devicePixelRatio 2-4). Internal Doom
// rendering stays 320x200, so only the final (cheap) GPU blit grows.
static void DoomPerf_ResizeBackingStore(void)
{
    double css_w = 0.0, css_h = 0.0;
    double dpr = emscripten_get_device_pixel_ratio();

    if (dpr <= 0.0)
    {
        dpr = 1.0;
    }
    if (emscripten_get_element_css_size("#canvas", &css_w, &css_h) != EMSCRIPTEN_RESULT_SUCCESS
        || css_w <= 0.0 || css_h <= 0.0)
    {
        css_w = SCREENWIDTH;
        css_h = SCREENHEIGHT;
    }

    // The canvas element fills the viewport; `object-fit: contain` letterboxes
    // the 320x200 (8:5) image inside it. Match the backing store to the
    // *displayed* image's device pixels so it presents ~1:1 rather than upscaled.
    const double aspect = (double)SCREENWIDTH / (double)SCREENHEIGHT;
    double img_w = css_w;
    double img_h = css_h;

    if (css_w / css_h > aspect)
    {
        img_w = css_h * aspect;
    }
    else
    {
        img_h = css_w / aspect;
    }

    int dev_w = (int)(img_w * dpr + 0.5);

    if (dev_w < SCREENWIDTH)
    {
        dev_w = SCREENWIDTH;
    }
    // Ceiling so an enormous display can't make the blit buffer absurd.
    if (dev_w > 4096)
    {
        dev_w = 4096;
    }
    // Keep the 8:5 aspect exactly so SDL's logical-size scaler adds no bars.
    int dev_h = (int)((double)dev_w / aspect + 0.5);

    int cur_w = 0, cur_h = 0;
    SDL_GetWindowSize(window, &cur_w, &cur_h);
    if (cur_w != dev_w || cur_h != dev_h)
    {
        SDL_SetWindowSize(window, dev_w, dev_h);
    }
    SDL_RenderSetLogicalSize(renderer, SCREENWIDTH, SCREENHEIGHT);

    // SDL/emscripten rewrites the canvas CSS size to the new pixel dimensions;
    // re-assert the responsive layout so the element keeps filling the viewport
    // (then `object-fit: contain` letterboxes the now high-res buffer).
    EM_ASM({
        var c = document.getElementById('canvas');
        if (c) { c.style.width = '100%'; c.style.height = '100%'; }
    });
}

static EM_BOOL DoomPerf_OnResize(int eventType, const EmscriptenUiEvent* uiEvent, void* userData)
{
    (void)eventType;
    (void)uiEvent;
    (void)userData;

    if (graphics_initialized)
    {
        DoomPerf_ResizeBackingStore();
    }
    return EM_FALSE;
}

void I_InitGraphics(void)
{
    int i;

    if (graphics_initialized)
    {
        return;
    }

    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS) != 0)
    {
        I_Error("SDL_Init failed: %s", SDL_GetError());
    }

    SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "0");
    window = SDL_CreateWindow(
        "DOOM",
        SDL_WINDOWPOS_UNDEFINED,
        SDL_WINDOWPOS_UNDEFINED,
        SCREENWIDTH,
        SCREENHEIGHT,
        SDL_WINDOW_SHOWN
    );
    if (!window)
    {
        I_Error("SDL_CreateWindow failed: %s", SDL_GetError());
    }

    renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
    if (!renderer)
    {
        renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
    }
    if (!renderer)
    {
        I_Error("SDL_CreateRenderer failed: %s", SDL_GetError());
    }

    SDL_RenderSetLogicalSize(renderer, SCREENWIDTH, SCREENHEIGHT);
    texture = SDL_CreateTexture(
        renderer,
        SDL_PIXELFORMAT_ARGB8888,
        SDL_TEXTUREACCESS_STREAMING,
        SCREENWIDTH,
        SCREENHEIGHT
    );
    if (!texture)
    {
        I_Error("SDL_CreateTexture failed: %s", SDL_GetError());
    }

    for (i = 0; i < 256; i++)
    {
        palette_rgba[i] = 0xff000000;
    }

    SDL_StartTextInput();
    graphics_initialized = true;

    // Grow the backing store to device pixels now, and keep it matched as the
    // viewport changes (desktop resize, phone rotation / browser-chrome show).
    DoomPerf_ResizeBackingStore();
    emscripten_set_resize_callback(
        EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, EM_FALSE, DoomPerf_OnResize);
}

void I_ShutdownGraphics(void)
{
    if (texture)
    {
        SDL_DestroyTexture(texture);
        texture = 0;
    }

    if (renderer)
    {
        SDL_DestroyRenderer(renderer);
        renderer = 0;
    }

    if (window)
    {
        SDL_DestroyWindow(window);
        window = 0;
    }

    if (graphics_initialized)
    {
        SDL_QuitSubSystem(SDL_INIT_VIDEO | SDL_INIT_EVENTS);
        graphics_initialized = false;
    }
}

void I_StartFrame(void)
{
}

void I_StartTic(void)
{
    PollEvents();
}

void I_UpdateNoBlit(void)
{
}

// Doom Perf: millisecond wall clock for sub-tic render interpolation. I_GetTime
// only resolves to 35 Hz tics; D_DoomLoop needs finer timing to compute how far
// into the current tic each interpolated frame falls (dp_interpfrac).
int I_GetTimeMS(void)
{
    return (int) SDL_GetTicks();
}

void I_FinishUpdate(void)
{
    int i;

    if (!graphics_initialized || !screens[0])
    {
        return;
    }

    for (i = 0; i < SCREENWIDTH * SCREENHEIGHT; i++)
    {
        rgba_framebuffer[i] = palette_rgba[screens[0][i]];
    }

    // Doom Perf: red damage-flash vignette while the latency causeway drags the player.
    // Two signals from p_tick.c: SEVERITY (doomperf_causeway_redness = the player-lane
    // await) sets how far the red reaches in and how dark it is; PULSE
    // (doomperf_causeway_pulse = the piston's pump triangle) STROBES it in step with the
    // piston. So a slow high-latency lane = a slow, deep, DARK strobe reaching toward the
    // centre; a moderately-elevated lane = a faster, thin, LIGHTER strobe hugging the
    // edges. Severity is eased so entering/leaving a lane fades. Nothing below the
    // saturated threshold. The blend runs only on the edge band (quick reject per pixel).
    {
        static int      vsev = 0;               // eased await severity (0..1000)
        int             tgt = doomperf_causeway_redness;
        const int       thresh = 350;           // await permille below which no red shows
        int             sev;

        if (tgt > vsev)
            vsev += (tgt - vsev + 3) / 4;
        else if (tgt < vsev)
            vsev -= (vsev - tgt + 3) / 4;

        sev = vsev > thresh ? ((vsev - thresh) * 1000) / (1000 - thresh) : 0;
        if (sev > 1000)
            sev = 1000;

        if (sev > 0)
        {
            int     sq = (sev * sev) / 1000;                        // quadratic: reach stays thin until high
            int     margin = 8 + (82 * sq) / 1000;                 // 8 (thin edge) .. 90 (deep toward centre)
            int     throb = 150 + (850 * doomperf_causeway_pulse) / 1000; // strobe 15%..100% at the piston tempo
            int     peak = ((400 + (600 * sev) / 1000) * throb) / 1000;   // fainter/lighter when moderate, strong when high
            int     rT = 255 - (115 * sev) / 1000;                 // 255 light red .. 140 dark red
            int     gbT = 100 - (100 * sev) / 1000;                // 100 pinkish .. 0 pure (dark)
            int     x;
            int     y;

            for (y = 0; y < SCREENHEIGHT; y++)
            {
                int     ry = SCREENHEIGHT - 1 - y;
                int     dy = y < ry ? y : ry;

                for (x = 0; x < SCREENWIDTH; x++)
                {
                    int         rx = SCREENWIDTH - 1 - x;
                    int         dx = x < rx ? x : rx;
                    int         d = dx < dy ? dx : dy;
                    int         a;
                    uint32_t    px;
                    int         r;
                    int         g;
                    int         b;

                    if (d >= margin)
                        continue;
                    a = ((margin - d) * peak) / margin;   // edge falloff x peak (0..1000)
                    a = (a * 230) / 1000;                  // to 0..~230 blend units (never fully flat)
                    if (a <= 0)
                        continue;
                    if (a > 256)
                        a = 256;
                    px = rgba_framebuffer[y * SCREENWIDTH + x];
                    r = (px >> 16) & 0xff;
                    g = (px >> 8) & 0xff;
                    b = px & 0xff;
                    r = r + ((rT - r) * a) / 256;         // blend toward the target red
                    g = g + ((gbT - g) * a) / 256;
                    b = b + ((gbT - b) * a) / 256;
                    rgba_framebuffer[y * SCREENWIDTH + x] =
                        0xff000000u | ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b;
                }
            }
        }
    }

    SDL_UpdateTexture(texture, 0, rgba_framebuffer, SCREENWIDTH * sizeof(uint32_t));
    SDL_RenderClear(renderer);
    SDL_RenderCopy(renderer, texture, 0, 0);
    SDL_RenderPresent(renderer);

    // Yield to the browser and cap the *render* rate. Game logic is still paced
    // to 35 Hz by TryRunTics (real-time I_GetTime); D_DoomLoop renders multiple
    // interpolated frames per tic, so this caps that to ~60 fps rather than the
    // old one-frame-per-tic 35 fps. (Was 1000/TICRATE.)
    emscripten_sleep(1000 / 60);
}

void I_ReadScreen(byte* scr)
{
    memcpy(scr, screens[0], SCREENWIDTH * SCREENHEIGHT);
}

void I_SetPalette(byte* palette)
{
    int i;

    for (i = 0; i < 256; i++)
    {
        int red = gammatable[usegamma][*palette++];
        int green = gammatable[usegamma][*palette++];
        int blue = gammatable[usegamma][*palette++];

        palette_rgba[i] =
            0xff000000 | ((uint32_t)red << 16) | ((uint32_t)green << 8) | blue;
    }
}
