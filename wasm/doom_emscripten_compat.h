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

// Doom Perf data-source mode, chosen on the level-select menu:
//   0 = live browser telemetry; 1/2 = simulated high CPU utilization/saturation
//   (CPU room renderer); 3/4 = simulated high disk utilization/saturation
//   (iostat terminal + media-pit latency gauges); 5/6 = simulated high memory
//   utilization/saturation (free/vmstat/PSI terminal scenarios).
extern int doomperf_sim_mode;

#endif
