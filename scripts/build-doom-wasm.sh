#!/usr/bin/env bash
set -euo pipefail

# Build the Doom Perf browser engine from a CLEAN external Doom source tree.
#
# The external Doom checkout (DOOM_SRC_DIR) is treated as read-only build
# input. Doom Perf C changes live as one patch per modified engine file in this
# repo under patches/doom/linuxdoom-1.10/ and are applied to a disposable
# staged copy of the source. Because each patch touches a distinct file the set
# is order-independent. This keeps /home/adam/projects/doom clean and makes the
# engine modifications reproducible from doom-typescript alone.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${DOOM_SRC_DIR:-$ROOT_DIR/../doom/linuxdoom-1.10}"
PLATFORM_DIR="${DOOM_PLATFORM_DIR:-$ROOT_DIR/wasm}"
export EM_CACHE="${EM_CACHE:-$HOME/.emscripten_cache}"
PATCH_DIR="${DOOM_PATCH_DIR:-$ROOT_DIR/patches/doom/linuxdoom-1.10}"
BUILD_DIR="$ROOT_DIR/.build/doom"
STAGE_SRC="$BUILD_DIR/linuxdoom-1.10"
OUT_DIR="$ROOT_DIR/public/engine"

# --- Validate inputs --------------------------------------------------------

if [[ ! -d "$SRC_DIR" ]]; then
  printf 'Doom source directory not found: %s\n' "$SRC_DIR" >&2
  printf 'Set DOOM_SRC_DIR to the linuxdoom-1.10 source directory.\n' >&2
  exit 1
fi

# Validate that DOOM_SRC_DIR really points at a linuxdoom-1.10 tree by
# checking for source files that the build depends on. This avoids staging an
# unrelated directory and emitting a confusing compiler error later.
for sentinel in doomdef.h r_main.c r_things.c st_stuff.c p_inter.c p_mobj.c; do
  if [[ ! -f "$SRC_DIR/$sentinel" ]]; then
    printf 'Doom source at %s does not look like linuxdoom-1.10 (missing %s).\n' \
      "$SRC_DIR" "$sentinel" >&2
    printf 'Set DOOM_SRC_DIR to a clean linuxdoom-1.10 source directory.\n' >&2
    exit 1
  fi
done

for platform_file in i_video_ems.c i_sound_ems.c i_net_ems.c; do
  if [[ ! -f "$PLATFORM_DIR/$platform_file" ]]; then
    printf 'Doom browser platform file not found: %s\n' "$PLATFORM_DIR/$platform_file" >&2
    printf 'Set DOOM_PLATFORM_DIR to the adapter source directory.\n' >&2
    exit 1
  fi
done

# --- Stage a disposable copy of the source ----------------------------------

rm -rf "$BUILD_DIR"
mkdir -p "$STAGE_SRC"
# Copy the source contents (not the directory itself) into the staged tree.
cp -R "$SRC_DIR/." "$STAGE_SRC/"

# --- Apply Doom Perf patches ------------------------------------------------

if [[ -d "$PATCH_DIR" ]]; then
  shopt -s nullglob
  patches=("$PATCH_DIR"/*.patch)
  shopt -u nullglob
  # One patch per file, so order does not matter; sort only for a
  # deterministic, reproducible build log.
  IFS=$'\n' patches=($(printf '%s\n' "${patches[@]}" | sort))
  unset IFS
  for patch in "${patches[@]}"; do
    printf 'Applying patch: %s\n' "$(basename "$patch")"
    if ! patch -p1 --batch --forward -d "$STAGE_SRC" -i "$patch" >/dev/null; then
      printf '\nFailed to apply patch: %s\n' "$patch" >&2
      printf 'Staged source directory: %s\n' "$STAGE_SRC" >&2
      printf 'The patch did not apply cleanly to the clean Doom source.\n' >&2
      printf 'Each patch must apply to an unmodified linuxdoom-1.10 tree.\n' >&2
      exit 1
    fi
  done
else
  printf 'No patch directory found at %s; building unmodified source.\n' "$PATCH_DIR" >&2
fi

# --- Compile the staged source ----------------------------------------------

mkdir -p "$OUT_DIR"

# Fail before compiling if a renderer safety patch went missing. The sentinel
# must be 16 bits: 0xff is a valid row on a 400/600-line framebuffer.
grep -Eq '^  unsigned short[[:space:]]+top\[SCREENWIDTH\];' "$STAGE_SRC/r_defs.h"
grep -Eq '^  unsigned short[[:space:]]+bottom\[SCREENWIDTH\];' "$STAGE_SRC/r_defs.h"
[[ $(grep -c '0xffff' "$STAGE_SRC/r_plane.c") -eq 3 ]]
grep -Fq '#define MAXSEGS' "$STAGE_SRC/r_bsp.c"
grep -Fq '(SCREENWIDTH/2 + 96)' "$STAGE_SRC/r_bsp.c"

# Memory sizing (PERF_TUNE_PLAN Part 4.1). The 16 MB zone heap (m_misc.c mb_used)
# means boot alone needs ~20 MB, and the measured working-set peak from the perf
# harness is a stable ~27.3 MB when the full map is toured. INITIAL_MEMORY=32 MB
# boots with the whole working set so ALLOW_MEMORY_GROWTH never has to
# grow-realloc (and copy the linear memory) during a normal wing tour, which is
# the jank/fragmentation this avoids. MAXIMUM_MEMORY=64 MB caps the ratchet at
# ~2.3x the peak so a runaway fails predictably instead of growing unbounded.

SRC_FILES=()
while IFS= read -r file; do
  SRC_FILES+=("$file")
done < <(find "$STAGE_SRC" -maxdepth 1 -name '*.c' \
  ! -name 'i_video.c' ! -name 'i_sound.c' ! -name 'i_net.c')

SRC_FILES+=("$PLATFORM_DIR/i_video_ems.c" "$PLATFORM_DIR/i_sound_ems.c" "$PLATFORM_DIR/i_net_ems.c" "$PLATFORM_DIR/menu_font.c")

build_variant() {
  local width="$1" height="$2" target="$3"
  local resolution_line="#define SCREENWIDTH  $width"
  local height_line="#define SCREENHEIGHT $height"
  sed -i -E "s/^#define SCREENWIDTH  [0-9]+$/$resolution_line/; s/^#define SCREENHEIGHT [0-9]+$/$height_line/" "$STAGE_SRC/doomdef.h"
  grep -Fxq "$resolution_line" "$STAGE_SRC/doomdef.h" || { echo "WIDTH edit failed: $width" >&2; exit 1; }
  grep -Fxq "$height_line" "$STAGE_SRC/doomdef.h" || { echo "HEIGHT edit failed: $height" >&2; exit 1; }
  mkdir -p "$target"
  printf 'Building %sx%s engine in %s\n' "$width" "$height" "$target"
  emcc "${SRC_FILES[@]}" \
  -I"$STAGE_SRC" \
  -include "$PLATFORM_DIR/doom_emscripten_compat.h" \
  -O2 \
  -DNORMALUNIX \
  -s USE_SDL=2 \
  -s ASYNCIFY=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=67108864 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web \
  -s EXIT_RUNTIME=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s "EXPORTED_RUNTIME_METHODS=['FS','FS_createDataFile','FS_analyzePath','FS_createPath','FS_chdir','callMain']" \
  -s FILESYSTEM=1 \
  -o "$target/doom.js"
  test -s "$target/doom.js" && test -s "$target/doom.wasm"
}

build_variant 320 200 "$OUT_DIR"
build_variant 640 400 "$OUT_DIR/640x400"
build_variant 960 600 "$OUT_DIR/960x600"
printf 'All three engine resolutions built.\n'
