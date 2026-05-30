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
#include "p_mobj.h"

// Doom Perf: CPU room telemetry in per-mille (0..1000), pushed from the
// browser telemetry SSE stream. Declared extern in doom_emscripten_compat.h
// (force-included into every Doom translation unit).
int doomperf_cpu_core_count = 0;
int doomperf_cpu_cores[DOOMPERF_MAX_CPU_CORES];
int doomperf_cpu_run_queue_pressure = 0;
int doomperf_cpu_load_pressure = 0;
int doomperf_load[3] = {0, 0, 0};
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
