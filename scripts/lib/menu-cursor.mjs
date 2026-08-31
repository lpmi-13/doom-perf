// Builds the menu SELECTOR lumps that replace Freedoom's flickering red-eyed skull
// (M_SKULL1 / M_SKULL2) with a cool-white command-prompt caret: a steady ">"
// chevron that points at the highlighted data-source row, plus a "_" cursor that
// blinks. The engine (m_menu.c, M_Drawer) swaps M_SKULL1<->M_SKULL2 every ~8 tics
// unconditionally -- that swap IS the animation -- so we keep the chevron identical
// across both frames and draw the underscore only in frame 1, giving a real
// terminal-cursor blink (fully on -> off) with no engine patch: M_SKULL1/2 are
// ordinary graphic lumps, so a last-loaded-wins PWAD override wins outright (unlike
// sprites -- see [[pwad-sprite-override-constraint]]). Same 20x19 footprint and
// (0,-1) offsets as the skull, so it lands exactly where the cursor used to.
//
// Cool-white to match the recoloured "SELECT DATA SOURCE" menu font
// ([[menu-font-contrast-recolor]]); a 1px near-black halo keeps it crisp whether it
// sits over the dark header or the orange heat-bars lower in the list.
//
// buildMenuCursors is pure w.r.t. its lump inputs and returns the two replacement
// lump bodies via the shared encoder (buildPatch injected, as titlepic.mjs does).
import { decodePatch, readPalette, nearest } from "./titlepic.mjs";

const WHITE_RGB = [226, 231, 240]; // cool near-white, matches the menu font
const HALO_RGB = [12, 12, 16];     // near-black outline for contrast over any row

// The cursor canvas is deliberately SHORTER than the 19-tall skull it replaces so
// it reads as part of the row it targets, not floating between rows. M_Drawer draws
// it at screen-y `ModeDef.y - 5 + itemOn*16` (the row's text top T is at
// `ModeDef.y + itemOn*16`, so the draw-y is T-5); the menu font is 7px, so the row
// spans [T, T+6] and the row above ends at T-10. With topOffset 0 a 12px canvas
// lands rows [T-5 .. T+6]: the glyph BOTTOM sits on the text bottom (T+6) and its
// TOP clears the row above by 5px. Both are height-relative below, so nudging
// CANVAS_H (grow = taller/less top margin, shrink = smaller) keeps the baseline pinned.
const CANVAS_H = 12;
const TOP_OFFSET = 0;

// Stamp a filled (2*half+1) square centred on (cx,cy) into the boolean mask.
const stampDot = (on, w, h, cx, cy, half) => {
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x >= 0 && x < w && y >= 0 && y < h) on[y * w + x] = true;
    }
  }
};

// Thick line via a dense DDA walk, stamping a square at each step (bold, no gaps).
const stampLine = (on, w, h, x0, y0, x1, y1, half) => {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    stampDot(on, w, h, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), half);
  }
};

// The ">" chevron: two thick arms meeting at an apex on the right, pointing at the
// menu row. Full canvas height, bottom-aligned to the baseline; shared by both
// frames (steady prompt, only the cursor blinks).
const drawChevron = (on, w, h) => {
  const apexX = 10, apexY = Math.floor((h - 1) / 2);
  stampLine(on, w, h, 2, 0, apexX, apexY, 1);     // upper arm (from the top)
  stampLine(on, w, h, 2, h - 1, apexX, apexY, 1); // lower arm (down to the baseline)
};

// The blinking "_" cursor: a short bar on the baseline (bottom two rows), just
// right of the chevron.
const drawCursor = (on, w, h) => {
  for (let y = h - 2; y <= h - 1; y += 1) {
    for (let x = 12; x <= 18; x += 1) on[y * w + x] = true;
  }
};

// Convert a boolean glyph mask into palette-index pixels: white where on, a 1px
// dark halo on transparent cells 8-adjacent to an on-cell, transparent elsewhere.
const rasterize = (on, w, h, whiteIdx, haloIdx, transparent) => {
  const px = new Array(w * h).fill(transparent);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (on[y * w + x]) { px[y * w + x] = whiteIdx; continue; }
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && on[ny * w + nx]) { touches = true; break; }
        }
      }
      if (touches) px[y * w + x] = haloIdx;
    }
  }
  return px;
};

export const buildMenuCursors = ({ skullLump, playpalLump, buildPatch }) => {
  const pal = readPalette(playpalLump);
  const { width, leftOffset } = decodePatch(skullLump); // keep the skull's 20-wide, leftOffset 0
  const height = CANVAS_H; // but shorter + our own topOffset, to bottom-align to the row
  const whiteIdx = nearest(pal, ...WHITE_RGB);
  const haloIdx = nearest(pal, ...HALO_RGB);
  const TRANSPARENT = -1;

  const frame = (withCursor) => {
    const on = new Array(width * height).fill(false);
    drawChevron(on, width, height);
    if (withCursor) drawCursor(on, width, height);
    const px = rasterize(on, width, height, whiteIdx, haloIdx, TRANSPARENT);
    return buildPatch(px, width, height, { leftOffset, topOffset: TOP_OFFSET, transparent: TRANSPARENT });
  };

  return { skull1: frame(true), skull2: frame(false) };
};
