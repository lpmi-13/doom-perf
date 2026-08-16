#ifndef DOOM_EMSCRIPTEN_COMPAT_H
#define DOOM_EMSCRIPTEN_COMPAT_H

#include <alloca.h>

// Emscripten's compat string header declares strupr with a different signature
// than the local helper in Linux Doom's w_wad.c.
#define strupr emscripten_compat_strupr
#include <string.h>
#undef strupr

// Doom Perf: CPU telemetry in per-mille (0..1000), set from the browser
// telemetry stream and read by the CPU room instrument renderer.
#define DOOMPERF_MAX_CPU_CORES 64
extern int doomperf_cpu_core_count;
extern int doomperf_cpu_cores[DOOMPERF_MAX_CPU_CORES];
extern int doomperf_cpu_run_queue_pressure;
extern int doomperf_cpu_run_queue_count;
extern int doomperf_cpu_blocked_count;
extern int doomperf_cpu_load_pressure;

// Sim-aware runnable count, D-state count, and logical-core count (defined in
// i_video_ems.c); read by the run-queue particle tick in p_tick.c.
int DoomPerf_EffectiveRunQueueCount(void);
int DoomPerf_EffectiveBlockedCount(void);
int DoomPerf_GetEffectiveCpuCoreCount(void);
int DoomPerf_GetEffectiveCpuLoadPressure(void);

// Load averages (1m/5m/15m) in milli-load (load * 1000), set from the browser
// telemetry stream and read by the LOAD room gauge renderer.
extern int doomperf_load[3];

// Disk service time (iostat await) as permille of a 250ms full scale, set from
// the browser telemetry stream and read by the media-pit latency gauges in the
// storage (disk) wing.
extern int doomperf_storage_await;

// r_await / w_await (worst-await device) as permille of the same 250ms full scale,
// set from the browser telemetry stream. These are the TARGET values; p_tick.c's
// DoomPerf_UpdateCauseway slews smoothed copies toward them each tic (so a worst-
// device switch eases in) and derives the read/write latency causeway's player-drag
// and piston tempo. DoomPerf_CausewayMoveScale returns a fixed-point (0..FRACUNIT)
// forward-thrust scale for a lane sector tag (FRACUNIT for any non-causeway tag),
// read by P_MovePlayer (p_user.c) to drag the player at that lane's await.
extern int doomperf_storage_read_await;
extern int doomperf_storage_write_await;
int DoomPerf_CausewayMoveScale(int sectortag);
// Red damage-flash vignette signals while the causeway drags the player, set by
// DoomPerf_UpdateCauseway (p_tick.c), read by I_FinishUpdate (i_video_ems.c):
// redness = player-lane await severity (0..1000) -> vignette reach + colour;
// pulse   = the piston pump triangle (0..1000) -> strobes the vignette at the piston tempo.
extern int doomperf_causeway_redness;
extern int doomperf_causeway_pulse;
// Per-lane vertical scroll offset (texels) for the piston cylinders' ridge lines;
// advanced at the stroke tempo in DoomPerf_UpdateCauseway (p_tick.c), read by the
// piston wall shader R_DoomPerfPistonPixel (r_draw.c). [0]=read lane, [1]=write.
extern int doomperf_causeway_scroll[2];

// Disk busy fraction (iostat %util) in permille, set from the browser telemetry
// stream and read by the media-pit platter's pulsing rings.
extern int doomperf_storage_util;

// Disk request-queue depth (iostat aqu-sz) as permille of a 24-request full
// channel, set from the browser telemetry stream and read by the media-pit
// queue channel's flowing request blocks.
extern int doomperf_storage_queue;

// Media-pit metrics dashboard easter-egg spike, in tics remaining. The browser
// pulses it (DoomPerf_TriggerStorageIopsSpike) when the player USEs the hidden
// disk server rack; p_tick.c decays it each tic and lifts the dashboard's IOPS
// graph while it is non-zero.
extern int doomperf_storage_iops_spike;

// Root-filesystem usage (`df /`) as a permille of capacity, set from the browser
// telemetry stream and read by the disk-usage CUBE plinth's voxel gauge
// (r_draw.c R_DoomPerfDiskCubePixel, line tag 665).
extern int doomperf_storage_usage;

// Aggregate completed-operations rate (reads+writes/s) as a permille of a full
// scale, set from the browser stream and read by the metrics-dashboard IOPS graph
// (p_tick.c DoomPerf_UpdateDiskDashboard) — the real signal replacing the old
// queue-derived proxy.
extern int doomperf_storage_iops;

// Doom Perf: the per-device "rain gauges" — the busiest block devices from
// diskstats stand as a row of light-tube gauges, each with a column of rain whose
// FALL SPEED tracks that device's completed-operations rate (dev_iops) and whose
// DENSITY + beam brightness track its utilization (dev_util); both are permille of
// a per-device full scale, column 0 being the busiest. doomperf_storage_dev_count is
// how many gauges carry a live device. Set from the browser telemetry stream; read
// by DoomPerf_UpdateDiskRain.
#define DOOMPERF_STORAGE_DEV_SLOTS 5
extern int doomperf_storage_dev_count;
extern int doomperf_storage_dev_iops[DOOMPERF_STORAGE_DEV_SLOTS];
extern int doomperf_storage_dev_util[DOOMPERF_STORAGE_DEV_SLOTS];
// Per-device NAME (busiest-first, uppercased + truncated by the browser) for the
// in-world floating labels over each gauge. Written char-by-char (index, charcode)
// via DoomPerf_SetStorageDeviceName; read by DoomPerf_DrawDeviceLabels (r_main.c).
#define DOOMPERF_DEV_NAME_MAX 15
extern char doomperf_storage_dev_name[DOOMPERF_STORAGE_DEV_SLOTS][DOOMPERF_DEV_NAME_MAX + 1];
// Rain-gauge world geometry shared by p_tick.c (drop streaming, tube show/hide) and
// r_main.c (label projection), so the two stay in sync. The per-slot world X of each
// gauge is defined (non-static) in p_tick.c; Y and the pedestal floor are constants.
#define DOOMPERF_RAIN_Y_U     (-1327)
#define DOOMPERF_RAIN_FLOOR_U 200
extern const int doomperf_rain_x_u[DOOMPERF_STORAGE_DEV_SLOTS];

// Two-tier DISK IO QUEUE fills (permille) for the face-7 rack: the device tier
// (in-flight, tag 650) and the scheduler backlog (tag 651). Set from the browser
// (DoomPerf_SetStorageDeviceQueue / DoomPerf_SetStorageSchedBacklog); read by
// DoomPerf_UpdateDiskQueueRack in p_tick.c.
extern int doomperf_storage_device_queue;
extern int doomperf_storage_sched_backlog;

// Width (samples) of the metrics-dashboard graph ring. Shared so p_tick.c (which
// owns/advances the ring) and r_draw.c (which plots it) agree on the row stride.
#define DOOMPERF_DASH_SAMPLES 15

// Duration (tics) of one IOPS easter-egg spike. Shared so the browser's setter
// (i_video_ems.c) and the decay in p_tick.c agree. ~2s at 35 tics/s: long enough
// to slam a couple of the (now slow) graph samples to the top, short enough that
// the two yells in the 7s sting read as two separate spikes.
#define DOOMPERF_DASH_SPIKE_TICS 70

// Memory USE signals in permille. Utilization is page-bank fill; saturation is
// reclaim/swap pressure; errors is the OOM/fault channel.
extern int doomperf_memory_util;
extern int doomperf_memory_saturation;
extern int doomperf_memory_errors;

// Reclaimable page cache (Buffers+Cached) as a permille of MemTotal. Splits the
// library wing's shelf books into working-set (green) vs page-cache (cyan); the
// cache band shrinks toward the working set as memory tightens. Sourced from
// `free -m` / /proc/meminfo, so it is a true Utilization-composition signal.
extern int doomperf_memory_cache;

// Doom Perf: the memory wing's RSS "reliquary" — the top processes from
// `ps -eo pid,rss,comm --sort=-rss` stand as barrels in front of the RSS
// terminal, slot 0 being the largest resident set. Each barrel glows with its
// kernel OOM badness (/proc/<pid>/oom_score, here in permille 0..1000): the
// closer a process is to being the OOM killer's next victim, the brighter it
// burns. doomperf_memory_proc_count is how many of the slots carry a live
// process. Set from the browser telemetry stream; read by the barrel-glow pass
// in p_tick.c (DoomPerf_UpdateMemoryWing).
#define DOOMPERF_MEMORY_PROC_SLOTS 5
extern int doomperf_memory_proc_count;
extern int doomperf_memory_proc_oom[DOOMPERF_MEMORY_PROC_SLOTS];

// Doom Perf: page-fault rates in permille of a reference rate. Minor faults are
// served from RAM (mostly workload); major faults had to read the page back from
// disk/swap (the refault/thrash saturation signal). Drive the paging bay's two
// fault meters in DoomPerf_UpdateMemoryWing; sims 5/6 synthesize their own.
extern int doomperf_memory_minflt;
extern int doomperf_memory_majflt;

// Doom Perf: swap state for the reclaim sluice's swap RELIEF VENT (memory wing).
// _present is 1 when the host has a swap device configured (swapTotalBytes > 0), so a
// swapless host reads unmistakably (the duct renders capped, with an OOM-KILL placard);
// _activity is the swap si+so paging rate as permille of full scale, driving the vent's
// glow and steam when present. The capped rendering is a LIVE-telemetry affordance: the
// memory sims (modes 5/6) always assert a swap-backed host.
extern int doomperf_memory_swap_present;
extern int doomperf_memory_swap_activity;

// Doom Perf: OOM-kill event for the memory wing's Baron of Hell. The browser
// sets a pending flag (DoomPerf_TriggerMemoryOomKill) naming the victim barrel
// slot when the live oom_kill counter rises; DoomPerf_UpdateOomBaron (p_tick.c)
// consumes it, walks the penned baron to that barrel, and detonates it. The
// memory saturation sim (mode 6) self-fires the event, so this stays 0 there.
extern int doomperf_oom_event;  // 1 = an OOM kill is pending (browser edge-trigger)
extern int doomperf_oom_victim; // reliquary barrel slot to detonate (0..DOOMPERF_MEMORY_PROC_SLOTS-1)

// Network RX/TX throughput, each as a permille of a full-scale link (the browser
// scales bytes/sec; see src/index.ts). Sets the packet-orb density in the network
// wing's grove. DoomPerf_EffectiveNetworkRx/Tx are the sim-aware values read by
// the packet tick in p_tick.c (live = the pushed value; the network sims drive a
// high synthetic throughput).
extern int doomperf_net_rx;
extern int doomperf_net_tx;
int DoomPerf_EffectiveNetworkRx(void);
int DoomPerf_EffectiveNetworkTx(void);

// Three-lock canal (NETWORK_CANAL_PLAN.md), read by DoomPerf_UpdateNetworkPackets in
// p_tick.c. Per lock (0/1/2 = socket/kernel/ring) and lane (0/1 = rx/tx): the pool
// fill (queue occupancy, permille -> pool floor height) and the overspill drop rate
// (permille -> drain glow + overspill orbs). Plus the global softnet squeeze, the
// socket accept-backlog + SYN-RECV counts, and whether the NIC ring depth is known
// per lane (0 -> the ring pool draws the "unknown rim" state). All defined + set in
// i_video_ems.c; pushed for both live and sim from src/index.ts.
extern int doomperf_net_lock_fill[3][2];
extern int doomperf_net_lock_drops[3][2];
extern int doomperf_net_softnet_squeeze;
// Kernel-RX softnet backlog DROP rate (permille), split out from the blended
// kernel-RX drop signal so the softnet decomposition coils can read the pure
// per-CPU input-queue overflow (netdev_max_backlog exhaustion) on its own.
extern int doomperf_net_softnet_drops;
extern int doomperf_net_backlogged;
extern int doomperf_net_synrecv;
extern int doomperf_net_ring_known[2];

// Doom Perf data-source mode, chosen on the level-select menu (mode_e in m_menu.c):
//   0 = live browser telemetry; 1/2 = high CPU utilization/saturation (CPU room);
//   3/4/5 = high disk utilization / saturation-shallow-queue / saturation-deep-queue
//   (iostat terminal + disk wing); 6/7/8 = high memory utilization / saturation-swap /
//   saturation-no-swap (free/vmstat/PSI terminal + memory wing); 9/10 = high network
//   utilization/saturation (three-lock canal fills + orb density + net dev terminal).
extern int doomperf_sim_mode;

// Doom Perf: human-readable scenario title for the active doomperf_sim_mode,
// used as the automap heads-up title in place of the Doom level name. Defined
// in m_menu.c next to the data-source labels it is derived from.
char* M_DoomPerfModeTitle(int mode);

// Doom Perf: the title wordmark's "oo" pulses with live CPU load. The oo is drawn
// with reserved palette indices (free in TITLEPIC); V_DrawPatch remaps them through
// doomperf_title_lut while doomperf_title_remap is set (around the TITLEPIC and
// M_DOOM draws). DoomPerf_UpdateTitleLut rebuilds the LUT each frame (load + pulse),
// DoomPerf_SetTitleLoad feeds the per-mille load. All defined in i_video_ems.c.
extern int doomperf_title_remap;
extern unsigned char doomperf_title_lut[256];
void DoomPerf_UpdateTitleLut(void);

#endif
