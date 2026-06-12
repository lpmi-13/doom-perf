#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <SDL2/SDL.h>
#include <emscripten.h>

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
int doomperf_storage_util = 0;
int doomperf_storage_queue = 0;
int doomperf_memory_util = 0;
int doomperf_memory_saturation = 0;
int doomperf_memory_errors = 0;
int doomperf_sim_mode = 0;

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

    SDL_UpdateTexture(texture, 0, rgba_framebuffer, SCREENWIDTH * sizeof(uint32_t));
    SDL_RenderClear(renderer);
    SDL_RenderCopy(renderer, texture, 0, 0);
    SDL_RenderPresent(renderer);

    emscripten_sleep(1000 / TICRATE);
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
