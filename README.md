# 🎮 DOOM in TypeScript — Browser-Native Port

> **An experiment**: converting the open-source C engine of DOOM into a TypeScript version that runs natively in the browser — no plugins, no emulation layers, just WebGL + Web Audio + WASM.

![DOOM running in the browser](doom-with-music.png)

## About

This project takes the [original DOOM source code](https://github.com/id-Software/DOOM) released by id Software and compiles it to WebAssembly (WASM) via Emscripten, with a TypeScript frontend that handles rendering (WebGL), input, and audio (Web Audio API + Tone.js for MIDI music).

> **Note**: The original C source code is not included in this repository. See the [id-Software/DOOM](https://github.com/id-Software/DOOM) repository for the original code.

The game runs entirely client-side in modern browsers using the **Shareware DOOM1.WAD** file.

## How It Was Built

The entire migration was done conversationally via **GitHub Copilot CLI**, going full "yolo" style:

- **Primary model**: `gpt-5.2-codex` handled the majority of the C-to-WASM compilation, TypeScript scaffolding, and engine bootstrapping. Used `/plan` and `/fleet` to distribute tasks to agents in parallel.
- **Rendering**: The initial migration produced a blank screen — the model couldn't figure out the rendering pipeline. I pointed out it needed **WebGL** to bridge the DOOM framebuffer (320×200 indexed color) to the browser canvas. That unlocked the visuals.
- **Screen scaling**: Getting the canvas to fill the browser window correctly was surprisingly tricky. Used the **Playwright MCP server** with `claude-opus-4.6` to auto-debug CSS scaling issues — `gpt-5.2-codex` kept going in circles on this one. The fix ended up being `width: 100%; height: 100%; object-fit: contain` with `image-rendering: pixelated`.
- **Sound effects**: The compiled WASM had stub audio functions (all no-ops). Fixed by writing a new `i_sound_ems.c` with Emscripten `EM_JS` macros that bridge C sound calls to JavaScript, then recompiling the WASM. The TypeScript side decodes DMX sound lumps into WAV and plays them via the Web Audio API.
- **Music**: DOOM's MUS format music is converted to MIDI on-the-fly and played through **Tone.js** synthesizers (FM synths for guitars, square wave for bass, noise for drums).

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│                                                  │
│  ┌──────────┐    ┌──────────────┐               │
│  │ DOOM C   │───▶│ i_sound_ems.c│──┐            │
│  │ Engine   │    │ (EM_JS)      │  │            │
│  │ (WASM)   │    └──────────────┘  │            │
│  └────┬─────┘                      ▼            │
│       │ framebuffer         ┌─────────────┐     │
│       ▼                     │ DoomAudio   │     │
│  ┌──────────┐               │ Bridge (TS) │     │
│  │ WebGL    │               └──┬──────┬───┘     │
│  │ Renderer │                  │      │         │
│  │ (TS)     │                  ▼      ▼         │
│  └────┬─────┘            Web Audio  Tone.js     │
│       │                  (SFX)      (Music)     │
│       ▼                                         │
│  ┌──────────┐                                   │
│  │ <canvas> │  ← fullscreen, pixelated scaling  │
│  └──────────┘                                   │
└─────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** ≥ 18
- **Emscripten SDK** (only if you want to recompile the WASM engine)
- A **DOOM1.WAD** file (the shareware version is freely available)

## Rebuilding The WASM Engine

The browser platform adapters used to compile the original DOOM C engine live
in `wasm/`. The expected source is a **clean** id Software `linuxdoom-1.10`
tree, cloned separately and treated as read-only build input.

Doom Perf's engine modifications are **not** edited into that checkout. They
live here as ordered patches under `patches/doom/linuxdoom-1.10/` and are
applied to a disposable staged copy of the source during the build:

| Patch | Purpose |
| --- | --- |
| `0001-hide-player-psprites.patch` | Skip `R_DrawPlayerSprites()` so the first-person weapon and muzzle flash never draw. |
| `0002-hide-status-bar-hud.patch` | Force the full 320x200 view and suppress the status bar (health, armor, ammo, face, keys, arms). |
| `0003-disable-player-damage.patch` | Make the observer immune to all damage so exploration is never interrupted. |
| `0004-suppress-monsters.patch` | Never spawn monsters or lost souls — a pure exploratory space. |
| `0005-strip-map-items.patch` | Strip gameplay items, monsters, gore, and teleport landings while allowing the generated map's hand-picked shareware-safe stock props. |
| `0006-unlock-all-doors.patch` | Remove the key requirement from every locked door so any door opens with the use key. |
| `0007-cpu-core-floor-display.patch` | Draw separate CPU-room instruments for logical-core utilization, runnable-queue pressure, and load pressure. |
| `0008-allow-project-pwads.patch` | Allow the browser engine to load the project map PWAD with a local shareware IWAD without a modified-game input prompt. |
| `0009-allow-pwad-sprite-overrides.patch` | Cache metadata for project PWAD sprite replacements such as freestanding CPU display signs. |
| `0010-disable-combat-controls.patch` | Keep Doom Perf observational by ignoring fire commands and weapon-selection keys. |
| `0011-title-page-only.patch` | Hold the opening title page instead of cycling into Doom demos, credits, and shareware order info. |
| `0012-simplify-title-menus.patch` | Reduce the title UI to New Game and Options, start the map directly, and hide irrelevant message controls. |

CPU values reach the engine over the existing telemetry SSE stream. The backend
samples `/proc/stat` per-core counters on the same one-second cadence as
`mpstat -P ALL 1 3`, and it keeps runnable-queue pressure and load-average
overcommit as separate CPU saturation values from `/proc/loadavg`. Load
overcommit is the portion of the one-minute load average above the logical CPU
count, normalized by that CPU count. The browser calls the exported
`DoomPerf_SetCpuCoreCount()`, `DoomPerf_SetCpuCore()`,
`DoomPerf_SetCpuRunQueuePressure()`, and `DoomPerf_SetCpuLoadPressure()`
functions. The CPU instrument renderer reads their per-mille globals from
`wasm/doom_emscripten_compat.h`. The CPU room labels those displays with
freestanding sign sprites authored into the generated map PWAD, and the load
overcommit room uses neutral decoration so the animated pressure-vessel floor
remains the only red/yellow semantic warning in that chamber.

Point the build script at the `linuxdoom-1.10` directory:

```bash
DOOM_SRC_DIR=/path/to/DOOM/linuxdoom-1.10 npm run build:engine
```

The script stages the source into `.build/doom/linuxdoom-1.10` (gitignored,
disposable), applies the patches in order, and compiles the staged copy with
the `wasm/` adapters. A patch that does not apply cleanly stops the build and
names the failing patch and staged directory — it never falls back to an
already-modified checkout. `DOOM_PATCH_DIR` overrides the patch directory and
`DOOM_PLATFORM_DIR` overrides the adapter directory.

To add a new engine modification, edit the clean source, capture a per-change
diff with `linuxdoom-1.10`-relative paths, save it as the next numbered patch,
then restore the checkout:

```bash
cd /path/to/DOOM/linuxdoom-1.10
git diff --relative -- some_file.c \
  > /path/to/doom-typescript/patches/doom/linuxdoom-1.10/000N-short-name.patch
git checkout -- .
```

If an Emscripten install exposes a read-only frozen cache, rebuild with a
writable cache location:

```bash
EM_FROZEN_CACHE= EM_CACHE=/tmp/doom-typescript-em-cache \
  DOOM_SRC_DIR=/path/to/DOOM/linuxdoom-1.10 npm run build:engine
```

The generated `public/engine/doom.js` and `public/engine/doom.wasm` are
committed with their patch changes so the fork runs without a local rebuild.
Base IWAD files under `public/wads/` are local runtime inputs and are not
committed.

## Doom Perf Map

The first Doom Perf level lives in the project PWAD at
`public/maps/doomperf-lab.wad`. It replaces `E1M1` when the browser starts the
patched WASM engine.

Regenerate that PWAD from its readable source before committing a map edit:

```bash
npm run build:map
```

The generated layout keeps the initial navigation simple while giving each
resource its own Doom-style wing:

| Direction | Space |
| --- | --- |
| Center | Enclosed spawn atrium with four labeled manual doors |
| North | CPU area with a core-utilization chamber and separate saturation instruments |
| East | Memory area |
| South | Storage area |
| West | Network area |

Each resource area starts behind its atrium door and expands into multiple
rooms with interior labels, window openings onto exterior sky sectors, stairs,
and raised floor sections. The CPU room currently makes the intended USE split
explicit: core utilization has its own chamber while runnable-queue pressure
and load pressure occupy separate labeled saturation stations. The map
generator tags each resource area's linedefs so later engine visuals can
identify CPU, memory, storage, and network surfaces without depending on
coordinates or on the local IWAD.

## Installation & Running

```bash
# 1. Clone the repo
git clone https://github.com/pascalvanderheiden/doom-typescript.git
cd doom-typescript

# 2. Install dependencies
npm install

# 3. Place your WAD file
#    Copy Doom1.WAD (shareware) into public/wads/
cp /path/to/DOOM1.WAD public/wads/Doom1.WAD

# 4. Regenerate the Doom Perf map and build the TypeScript bundle
npm run build:map
npm run build

# 5. Start the web host and Linux telemetry SSE service
npm run dev:telemetry
```

Then open **http://localhost:8000** in your browser and start exploring.

## Controls

| Key | Action |
|-----|--------|
| Arrow keys | Move / turn |
| Ctrl | Fire |
| Space | Open doors / use |
| Shift | Run |
| 1-7 | Select weapon |
| Esc | Menu |
| Tab | Automap |

## Telemetry Overlay

The browser host accepts CPU, memory, storage, and network USE telemetry via
Server-Sent Events. `npm run dev:telemetry` starts the Linux telemetry service
at `http://127.0.0.1:9999/telemetry` and the browser host at
`http://127.0.0.1:8000`.

Examples:

```bash
# Default local SSE endpoint
http://localhost:8000/

# Alternate SSE endpoint with a "telemetry" event or JSON message events
http://localhost:8000/?telemetry=http://127.0.0.1:9999/telemetry

# Disable telemetry
http://localhost:8000/?telemetry=off
```

The WebGL renderer (`?renderer=webgl`) maps telemetry directly into the Doom
status bar: CPU, system health, memory, and the CPU/MEM/DSK/NET resource list.
The default WASM renderer keeps the original framebuffer and shows a small
diagnostic panel over the game.

## Tech Stack

- **Emscripten** — compiles DOOM's C code to WebAssembly
- **TypeScript** — frontend bootstrap, audio bridge, WebGL renderer
- **esbuild** — fast TypeScript bundling
- **Tone.js** — MIDI music synthesis
- **Web Audio API** — sound effect playback
- **WebGL** — framebuffer rendering
- **Playwright** — automated browser testing during development

## Playwright Screenshots

During development, the **Playwright MCP server** was used to capture automated screenshots for debugging rendering and scaling issues. All screenshots are stored in the `playwright-screenprints/` directory:

| Screenshot | Description |
|------------|-------------|
| `doom-1920-objectfit.png` | Testing CSS object-fit scaling at 1920px |
| `doom-1920x1080-fixed.png` | Fixed fullscreen rendering at 1920x1080 |
| `doom-1920x1080.png` | Initial 1920x1080 test |
| `doom-640x400-scaled.png` | Scaled 640x400 resolution test |
| `doom-after-title.png` | Title screen after initial load |
| `doom-broken-scale.png` | Debugging broken canvas scaling |
| `doom-canvas-list.png` | Canvas element inspection |
| `doom-fullscreen-final.png` | Final fullscreen implementation |
| `doom-fullscreen.png` | Fullscreen mode testing |
| `doom-gameplay-after.png` - `doom-gameplay-after4.png` | Gameplay progression screenshots |
| `doom-gameplay-check.png` | Gameplay verification |
| `doom-gameplay.png` | In-game screenshot |
| `doom-screen.png` | General screen capture |
| `doom-with-setcanvassize.png` | Testing setCanvasSize implementation |
| `doom1-3d-screenshot.png` | 3D rendering test |
| `doom1-automap-*.png` | Automap rendering tests (player position, crosshair) |
| `doom1-hud-labels.png` | HUD label positioning |
| `doom1-polish.png` | Final polish pass |
| `doom1-render-simple.png` | Simple renderer test |
| `doom1-screenshot-pw.png` | Playwright automated screenshot |
| `doom1-splash*.png` | Splash screen iterations |
| `doom1-webgl-*.png` | WebGL renderer tests (gameplay, HUD) |
| `doom2-*.png` | DOOM II testing screenshots |
| `playwright-doom.png` | Playwright test runner capture |

These screenshots document the iterative process of debugging the WebGL renderer, CSS scaling, and fullscreen behavior using automated browser testing.

## License

The original DOOM source code is released under the [GNU General Public License v2](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/DOOMLIC.TXT). This project's TypeScript code follows the same license. The DOOM1.WAD shareware data file is copyrighted by id Software and is not included in this repository.

## Acknowledgments

- **id Software** for open-sourcing the DOOM engine
- **GitHub Copilot CLI** for doing most of the heavy lifting
- **Playwright MCP** for saving my sanity on CSS scaling
