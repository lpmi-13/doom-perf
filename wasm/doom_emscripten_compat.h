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
extern int doomperf_cpu_load_pressure;

// Load averages (1m/5m/15m) in milli-load (load * 1000), set from the browser
// telemetry stream and read by the LOAD room gauge renderer.
extern int doomperf_load[3];

// Doom Perf data-source mode, chosen on the level-select menu:
//   0 = live browser telemetry, 1 = simulated high utilization,
//   2 = simulated high saturation. Read by the CPU room renderer.
extern int doomperf_sim_mode;

#endif
