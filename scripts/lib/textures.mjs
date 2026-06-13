// Glyph + texture-patch rasterization for the map builder: a small bitmap font,
// drawing helpers, and the patch generators for labels, signs, the blurry
// terminal screens, the CPU streak columns, and the terminal control panel.
// Pure pixels -> patch bytes (buildPatch from wad-bytes). The texture dimensions
// and the sign text colour live here too, since they define those patches.
import { buildPatch, lump } from "./wad-bytes.mjs";

export const labelTextureSize = {
  width: 256,
  height: 192,
};
export const terminalTextureSize = {
  width: 256,
  height: 128,
};
export const signTextureSize = {
  width: 256,
  height: 40,
};
export const controlPanelTextureSize = { width: 256, height: 32 };
export const serverRackTextureSize = { width: 96, height: 64 };
// 128 wide so the panel maps 1:1 onto a 128-unit wall face: Doom masks wall
// texture columns to the largest power of two <= width (r_data.c), so a 160-wide
// texture would only address 128 columns and wrap the rest back across the face
// (the "repeated partial dashboard" regression). The engine dashboard hook
// (patch 0027) draws its live graphs into this same coordinate space, so the
// chart geometry below is the shared contract between the static fallback art
// and R_DoomPerfDiskDashboardPixel.
export const storageDisplayTextureSize = { width: 128, height: 128 };
export const signTextColor = 112;

const glyphs = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "%": ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
};

const drawRect = (pixels, width, height, x1, y1, x2, y2, color) => {
  for (let y = Math.max(0, y1); y < Math.min(height, y2); y += 1) {
    for (let x = Math.max(0, x1); x < Math.min(width, x2); x += 1) {
      pixels[y * width + x] = color;
    }
  }
};


const textWidthFor = (text, scale) => text.length * 5 * scale + Math.max(0, text.length - 1) * scale;

// Per-"on"-pixel stamps for drawCenteredText. The default (stampSolid) draws a
// drop shadow then the solid block -- the original behaviour, so every existing
// caller stays byte-identical. The door-plate label styles below swap in their
// own stamps (flat fill / dilated halo / offset emboss) and call drawCenteredText
// in layered passes to build outlined, glowing, or stamped letterforms.
const stampSolid = (pixels, width, height, x, y, scale, color) => {
  drawRect(pixels, width, height, x + 1, y + 1, x + scale + 1, y + scale + 1, 8);
  drawRect(pixels, width, height, x, y, x + scale, y + scale, color);
};
const stampFlat = (pixels, width, height, x, y, scale, color) =>
  drawRect(pixels, width, height, x, y, x + scale, y + scale, color);
// Dilate each pixel block by `grow` on every side -> a halo/outline ring when the
// pass is drawn under the flat fill.
const stampGrow = (grow) => (pixels, width, height, x, y, scale, color) =>
  drawRect(pixels, width, height, x - grow, y - grow, x + scale + grow, y + scale + grow, color);
// Bold block (one px wider/taller) shifted by (dx,dy) -> thick letters and offset
// emboss shadows.
const stampBoldOffset = (dx, dy) => (pixels, width, height, x, y, scale, color) =>
  drawRect(pixels, width, height, x + dx, y + dy, x + scale + 1 + dx, y + scale + 1 + dy, color);

export const drawCenteredText = (pixels, width, height, text, y, maxScale, color, left = 0, right = width, stamp = stampSolid) => {
  let scale = maxScale;
  while (scale > 1 && textWidthFor(text, scale) > right - left - 8) {
    scale -= 1;
  }
  const startX = Math.floor(left + (right - left - textWidthFor(text, scale)) / 2);
  [...text].forEach((character, characterIndex) => {
    const glyph = glyphs[character];
    if (!glyph) {
      throw new Error(`Missing label glyph for ${character}`);
    }
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, pixelIndex) => {
        if (pixel === "1") {
          const x = startX + characterIndex * 6 * scale + pixelIndex * scale;
          const pixelY = y + rowIndex * scale;
          stamp(pixels, width, height, x, pixelY, scale, color);
        }
      });
    });
  });
};

// Hollow rectangular border of the given thickness, drawn inward from (x0,y0)-(x1,y1).
const drawBorder = (pixels, width, height, x0, y0, x1, y1, thick, color) => {
  drawRect(pixels, width, height, x0, y0, x1, y0 + thick, color);
  drawRect(pixels, width, height, x0, y1 - thick, x1, y1, color);
  drawRect(pixels, width, height, x0, y0, x0 + thick, y1, color);
  drawRect(pixels, width, height, x1 - thick, y0, x1, y1, color);
};

// Per-wing door name-plate styles. Each door's hub-facing face is one of these
// plates (the `top` texture on the hub side of the wing door), so the four read
// as distinct fixtures from the moment you spawn in the atrium -- not just the
// same plate recoloured. Each style owns BOTH its material (frame/panel/backing)
// and its letterform, built by layering drawCenteredText passes with the stamps
// above. `color` is the wing's signature colour (CPU red / MEMORY green / DISK
// yellow / NETWORK blue); ctx carries the shared panel geometry.
const labelStyles = {
  // Fallback: the original plain dark-panel plate (kept for any unstyled label).
  plain: ({ pixels, width, height, panelLeft, panelRight, text, color, scale, startY }) => {
    pixels.fill(5);
    drawRect(pixels, width, height, panelLeft + 4, 0, panelRight - 4, height, 0);
    drawRect(pixels, width, height, panelLeft + 4, 0, panelLeft + 8, height, 96);
    drawRect(pixels, width, height, panelRight - 8, 0, panelRight - 4, height, 96);
    drawCenteredText(pixels, width, height, text, startY, scale, color);
  },
  // CPU -- engraved steel: a bevelled brushed-steel plate with corner rivets and
  // hard-edged red letters cut in with a dark outline.
  cpu: ({ pixels, width, height, panelLeft: pl, panelRight: pr, text, color, scale, startY }) => {
    pixels.fill(5);
    drawRect(pixels, width, height, pl + 2, 0, pr - 2, height, 96); // steel field
    drawRect(pixels, width, height, pl + 10, 10, pr - 10, height - 10, 100); // recessed inset
    drawBorder(pixels, width, height, pl + 2, 0, pr - 2, height, 3, 88); // bright bevel
    drawRect(pixels, width, height, pr - 5, 0, pr - 2, height, 104); // right shadow
    drawRect(pixels, width, height, pl + 2, height - 3, pr - 2, height, 104); // bottom shadow
    [[pl + 12, 12], [pr - 16, 12], [pl + 12, height - 16], [pr - 16, height - 16]].forEach(([x, y]) => {
      drawRect(pixels, width, height, x, y, x + 5, y + 5, 104);
      drawRect(pixels, width, height, x + 1, y + 1, x + 3, y + 3, 88);
    });
    drawCenteredText(pixels, width, height, text, startY, scale, 8, pl, pr, stampGrow(1)); // dark cut outline
    drawCenteredText(pixels, width, height, text, startY, scale, color, pl, pr, stampFlat); // red face
  },
  // MEMORY -- phosphor CRT: a black screen with scanlines, a thin green bezel and
  // letters that bloom from a soft dim-green halo to a bright core.
  memory: ({ pixels, width, height, panelLeft: pl, panelRight: pr, text, color, scale, startY }) => {
    pixels.fill(5);
    drawRect(pixels, width, height, pl + 2, 0, pr - 2, height, 127); // dark green casing
    drawRect(pixels, width, height, pl + 6, 6, pr - 6, height - 6, 0); // black screen
    for (let y = 8; y < height - 8; y += 4) drawRect(pixels, width, height, pl + 8, y, pr - 8, y + 1, 124); // scanlines
    drawBorder(pixels, width, height, pl + 2, 0, pr - 2, height, 2, 116); // green bezel
    drawCenteredText(pixels, width, height, text, startY, scale, 120, pl, pr, stampGrow(2)); // wide soft glow
    drawCenteredText(pixels, width, height, text, startY, scale, 116, pl, pr, stampGrow(1)); // inner glow
    drawCenteredText(pixels, width, height, text, startY, scale, color, pl, pr, stampFlat); // bright core
  },
  // DISK -- stamped iron: a heavy bevelled iron plate with big corner rivets and
  // bold yellow letters punched in over a dark-amber emboss shadow.
  storage: ({ pixels, width, height, panelLeft: pl, panelRight: pr, text, color, scale, startY }) => {
    pixels.fill(5);
    drawRect(pixels, width, height, pl + 2, 0, pr - 2, height, 104); // iron field
    drawRect(pixels, width, height, pl + 12, 12, pr - 12, height - 12, 108); // dark inset
    drawBorder(pixels, width, height, pl + 2, 0, pr - 2, height, 6, 96); // heavy frame
    drawBorder(pixels, width, height, pl + 2, 0, pr - 2, height, 2, 88); // bright edge
    [[pl + 14, 14], [pr - 24, 14], [pl + 14, height - 24], [pr - 24, height - 24]].forEach(([x, y]) => {
      drawRect(pixels, width, height, x, y, x + 10, y + 10, 96);
      drawRect(pixels, width, height, x + 2, y + 2, x + 8, y + 8, 108);
      drawRect(pixels, width, height, x + 3, y + 3, x + 6, y + 6, 88);
    });
    drawCenteredText(pixels, width, height, text, startY, scale, 167, pl, pr, stampBoldOffset(2, 2)); // amber emboss
    drawCenteredText(pixels, width, height, text, startY, scale, color, pl, pr, stampBoldOffset(0, 0)); // bold yellow
  },
  // NETWORK -- LED routing gear: a black panel ringed by indicator LEDs and trace
  // lines, with thin unshadowed blue letters.
  network: ({ pixels, width, height, panelLeft: pl, panelRight: pr, text, color, scale, startY }) => {
    pixels.fill(5);
    drawRect(pixels, width, height, pl + 2, 0, pr - 2, height, 0); // black panel
    drawBorder(pixels, width, height, pl + 2, 0, pr - 2, height, 2, 200); // blue bezel
    drawRect(pixels, width, height, pl + 6, 20, pl + 8, height - 20, 204); // left trace
    drawRect(pixels, width, height, pr - 8, 20, pr - 6, height - 20, 204); // right trace
    const ledRow = (y) => {
      for (let x = pl + 14; x < pr - 14; x += 10) {
        drawRect(pixels, width, height, x, y, x + 5, y + 3, ((x >> 3) & 1) === 0 ? 200 : 206);
      }
    };
    ledRow(10);
    ledRow(height - 13);
    drawCenteredText(pixels, width, height, text, startY, scale, color, pl, pr, stampFlat); // thin blue letters
  },
};

export const buildLabelPatch = (text, color, panelWidth, style = "plain") => {
  const { width, height } = labelTextureSize;
  const panelLeft = Math.floor((width - panelWidth) / 2);
  const panelRight = panelLeft + panelWidth;
  const pixels = new Uint8Array(width * height);
  const scale = text.length > 6 ? 2 : 3;
  const startY = Math.floor((height - 7 * scale) / 2);
  const render = labelStyles[style] ?? labelStyles.plain;
  render({ pixels, width, height, panelLeft, panelRight, text, color, scale, startY });
  return buildPatch(pixels, width, height);
};

// A short, wide plate for the free-standing floor placards at each CPU sub-area
// entrance: a metal frame around a dark panel with the green area name. Drawn on
// the placard block's low riser, so it must be short (matches signTextureSize).
export const buildSignPatch = (text) => {
  const { width, height } = signTextureSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(96);
  drawRect(pixels, width, height, 5, 5, width - 5, height - 5, 0);
  const scale = text.length > 6 ? 4 : 5;
  const startY = Math.floor((height - 7 * scale) / 2);
  drawCenteredText(pixels, width, height, text, startY, scale, signTextColor, 10, width - 10);
  return buildPatch(pixels, width, height);
};

// A wall-mounted sign for the RUN QUEUE track recesses (QUEUE / RUNNING), read
// across the tracks from the overlook. Width matches labelTextureSize.width so
// the engine's label-centering offset (overrideTextureOffsetFor) maps it once,
// centred, on the (narrower) recess back wall -- no tiling. Text is centred well
// inside the wall's visible middle; green text on a dark, framed panel.
export const wallSignSize = { width: 256, height: 128 };
export const buildWallSignPatch = (text) => {
  const { width, height } = wallSignSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(96);
  drawRect(pixels, width, height, 40, 10, width - 40, height - 10, 0);
  const scale = text.length > 6 ? 4 : 5;
  const startY = Math.floor((height - 7 * scale) / 2);
  drawCenteredText(pixels, width, height, text, startY, scale, signTextColor, 48, width - 48);
  return buildPatch(pixels, width, height);
};

export const buildTerminalPatch = ({ lines }) => {
  const { width, height } = terminalTextureSize;
  const screenTop = 8;
  const screenBottom = height - 8;
  const pixels = new Uint8Array(width * height);
  pixels.fill(5);
  // Bezel + dark screen.
  drawRect(pixels, width, height, 6, screenTop - 2, width - 6, screenBottom + 2, 96);
  drawRect(pixels, width, height, 10, screenTop + 2, width - 10, screenBottom - 2, 8);
  drawRect(pixels, width, height, 14, screenTop + 6, width - 14, screenBottom - 6, 0);
  // Simulated console output, then blurred so the individual glyphs can't be
  // read -- it reads as out-of-focus streaming logs. We rasterise gibberish
  // monospace text (left-aligned, ragged right) into an intensity buffer,
  // box-blur it (more horizontally, so log lines stay separate), and map the
  // intensity onto Doom's green ramp (112 bright -> ~124 dim), leaving the
  // screen black where there is no text. Seeded from the screen name
  // (mulberry32) for stable, per-terminal output.
  let a = 0;
  for (const ch of lines.join("|")) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // A fixed letterform pool for the streaming gibberish (kept stable so terminal
  // screens stay byte-identical); it deliberately omits B/F/H/J/X regardless of
  // which glyphs the font defines.
  const pool = "ACDEGIKLMNOPQRSTUVWYZ0123456789:/.-%=_".split("");
  const left = 16;
  const charW = 6;
  const lineH = 9;
  const maxCols = Math.floor((width - 16 - left) / charW);
  const ink = new Float32Array(width * height);
  const mark = (x, y) => {
    if (x >= 0 && x < width && y >= 0 && y < height) ink[y * width + x] = 1;
  };
  const stampGlyph = (ch, gx, gy) => {
    glyphs[ch].forEach((row, ri) => {
      for (let ci = 0; ci < 5; ci += 1) if (row[ci] === "1") mark(gx + ci, gy + ri);
    });
  };
  let cursorX = null;
  let cursorY = 0;
  for (let y = screenTop + 8; y + 7 <= screenBottom - 6; y += lineH) {
    if (rand() < 0.12) continue; // occasional blank line for rhythm
    const cols = 2 + Math.floor(rand() * (maxCols - 2)); // ragged right: variable length
    let c = 0;
    while (c < cols) {
      const wordLen = Math.min(2 + Math.floor(rand() * 8), cols - c);
      for (let i = 0; i < wordLen; i += 1) {
        stampGlyph(pool[Math.floor(rand() * pool.length)], left + c * charW, y);
        c += 1;
      }
      c += 1; // space between words
    }
    cursorX = left + Math.min(c, maxCols) * charW;
    cursorY = y;
  }
  if (cursorX !== null)
    for (let yy = 0; yy < 7; yy += 1) for (let xx = 0; xx < 4; xx += 1) mark(cursorX + xx, cursorY + yy);
  // Separable box blur (horizontal radius rx, vertical radius ry).
  const blur = (rx, ry) => {
    if (rx > 0) {
      const t = new Float32Array(ink.length);
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          let s = 0;
          let n = 0;
          for (let k = -rx; k <= rx; k += 1) {
            const xx = x + k;
            if (xx >= 0 && xx < width) { s += ink[y * width + xx]; n += 1; }
          }
          t[y * width + x] = s / n;
        }
      ink.set(t);
    }
    if (ry > 0) {
      const t = new Float32Array(ink.length);
      for (let x = 0; x < width; x += 1)
        for (let y = 0; y < height; y += 1) {
          let s = 0;
          let n = 0;
          for (let k = -ry; k <= ry; k += 1) {
            const yy = y + k;
            if (yy >= 0 && yy < height) { s += ink[yy * width + x]; n += 1; }
          }
          t[y * width + x] = s / n;
        }
      ink.set(t);
    }
  };
  blur(2, 1);
  blur(2, 1);
  let peak = 0;
  for (let i = 0; i < ink.length; i += 1) if (ink[i] > peak) peak = ink[i];
  if (peak > 0) {
    const sx0 = 15;
    const sy0 = screenTop + 7;
    const sx1 = width - 15;
    const sy1 = screenBottom - 7;
    for (let y = sy0; y < sy1; y += 1)
      for (let x = sx0; x < sx1; x += 1) {
        const v = ink[y * width + x] / peak;
        if (v < 0.15) continue;
        pixels[y * width + x] = Math.min(124, 112 + Math.round((1 - v) * 13));
      }
  }
  return buildPatch(pixels, width, height);
};

export const buildCpuColumnPatch = () => {
  const { width, height } = labelTextureSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(96);
  drawRect(pixels, width, height, 0, 0, width, 8, 96);
  drawRect(pixels, width, height, 0, height - 8, width, height, 96);
  for (let x = 0; x < width; x += 32) {
    drawRect(pixels, width, height, x, 0, x + 4, height, 0);
    drawRect(pixels, width, height, x + 28, 0, x + 32, height, 0);
    drawRect(pixels, width, height, x + 4, 12, x + 28, height - 12, 8);
    drawRect(pixels, width, height, x + 7, 12, x + 25, height - 12, 112);
    drawRect(pixels, width, height, x + 9, 16, x + 23, height - 16, 5);
    [200, 112, 231, 176].forEach((color, thread) => {
      const threadX = x + 11 + thread * 3;
      for (let y = 18 + thread * 5; y < height - 18; y += 28) {
        drawRect(pixels, width, height, threadX + 1, y + 2, threadX + 3, y + 18, 8);
        drawRect(pixels, width, height, threadX, y, threadX + 2, y + 16, color);
      }
    });
  }
  for (let y = 24; y < height - 24; y += 48) {
    drawRect(pixels, width, height, 0, y, width, y + 4, 0);
    drawRect(pixels, width, height, 0, y + 4, width, y + 6, 96);
  }
  return buildPatch(pixels, width, height);
};

// Doom Perf: a small round "task orb" sprite. Replaces an unused IWAD item
// sprite by name in the project PWAD (e.g. PINSA0), so the run-queue mobjs render
// as orbs rather than the stock item. Procedural filled disc shaded from a bright
// core (ramp[0]) to a dark rim (ramp[last]); pixels outside the disc are
// transparent so it reads round on any background.
export const orbSpriteSize = { width: 22, height: 22 };
export const buildOrbPatch = (ramp) => {
  const { width, height } = orbSpriteSize;
  const TRANSPARENT = 247;
  const pixels = new Uint8Array(width * height).fill(TRANSPARENT);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = width / 2 - 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const k = Math.min(ramp.length - 1, Math.floor((dist / radius) * ramp.length));
      pixels[y * width + x] = ramp[k];
    }
  }
  return buildPatch(pixels, width, height, {
    leftOffset: Math.round(width / 2),
    topOffset: height,
    transparent: TRANSPARENT,
  });
};

// Rack-mounted server panel for the wall below the terminal screens. Gray metal
// split by horizontal rack seams into stacked units, each carrying an irregular,
// non-repeating mix of equipment -- black mini-screens with green data, amber/
// green/red LED clusters, vent slots, label plates and bare metal -- placed by a
// seeded RNG so it reads as real gear rather than a uniform decorative pattern.
// 256 wide -> spans the whole riser once (via flowOffsetFor), so nothing repeats.
export const buildControlPanelPatch = () => {
  const { width: W, height: H } = controlPanelTextureSize; // 256 x 32
  const px = new Uint8Array(W * H);
  px.fill(96); // gray rack metal
  const R = (x, y, w, h, c) => drawRect(px, W, H, x, y, x + w, y + h, c);
  let a = 0x1a2b3c4d | 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const screen = (x, w, y0, y1) => {                 // black mini-screen, green data
    R(x, y0, w, y1 - y0, 8); R(x + 1, y0 + 1, w - 2, y1 - y0 - 2, 0);
    for (let gx = x + 2; gx < x + w - 2;) {
      const bw = 1 + Math.floor(rnd() * 3);
      if (rnd() > 0.25) { const bh = 1 + Math.floor(rnd() * (y1 - y0 - 4)); R(gx, y1 - 2 - bh, bw, bh, rnd() > 0.4 ? 112 : 118); }
      gx += bw + 1;
    }
  };
  const leds = (x, w, y0, y1) => {                   // recessed bar of small lamps
    const my = y0 + Math.max(0, Math.floor((y1 - y0 - 4) / 2));
    R(x, my, w, 4, 8);
    for (let lx = x + 2; lx < x + w - 2; lx += 4) if (rnd() > 0.3) R(lx, my + 1, 2, 2, pick([231, 231, 112, 176]));
  };
  const vent = (x, w, y0, y1) => { for (let yy = y0 + 1; yy < y1 - 1; yy += 2) R(x, yy, w, 1, 0); };
  const label = (x, w, y0, y1) => { R(x, y0, w, y1 - y0, 8); R(x, y0, w, 1, 96); R(x + 2, y0 + 3, w - 5, 1, 5); R(x + 2, y0 + 5, Math.floor((w - 4) / 2), 1, 5); };
  const fillRow = (y0, y1) => {
    let x = 2 + Math.floor(rnd() * 8);
    while (x < W - 10) {
      const type = pick(["screen", "screen", "leds", "leds", "vent", "label", "blank", "screen"]);
      const w = Math.min(12 + Math.floor(rnd() * 38), W - 4 - x);
      if (w < 8) break;
      if (type === "screen") screen(x, w, y0, y1);
      else if (type === "leds") leds(x, w, y0, y1);
      else if (type === "vent") vent(x, w, y0, y1);
      else if (type === "label") label(x, w, y0, y1);
      else { R(x + 1, y0, 1, 1, 8); R(x + w - 2, y1 - 1, 1, 1, 8); } // bare metal + screws
      x += w + 3 + Math.floor(rnd() * 10);
    }
  };
  fillRow(2, 13);
  fillRow(16, 27);
  // Rack seams: top edge, the unit divider, and a ventilation grille along the base.
  R(0, 0, W, 1, 0); R(0, 1, W, 1, 8);
  R(0, 13, W, 1, 8); R(0, 14, W, 1, 0); R(0, 15, W, 1, 8);
  R(0, 27, W, 1, 8);
  for (let yy = 28; yy < H; yy += 2) { R(0, yy, W, 1, 0); R(0, yy + 1, W, 1, 8); }
  return buildPatch(px, W, H);
};

export const buildServerRackPatch = () => {
  const { width: W, height: H } = serverRackTextureSize;
  const px = new Uint8Array(W * H);
  px.fill(96);
  const R = (x, y, w, h, c) => drawRect(px, W, H, x, y, x + w, y + h, c);

  // Outer rack rails and warm beige chassis, matching the drive array reference.
  R(0, 0, W, H, 96);
  R(4, 0, W - 8, H, 104);
  R(6, 2, W - 12, H - 4, 108);
  R(0, 0, 4, H, 88);
  R(W - 4, 0, 4, H, 88);
  R(1, 10, 2, 2, 231);
  R(W - 3, 28, 2, 2, 112);
  R(W - 3, 48, 2, 2, 112);

  // Perforated top controller shelf with blue status lamps.
  R(8, 4, W - 16, 14, 100);
  for (let y = 7; y < 16; y += 4) {
    for (let x = 12; x < W - 12; x += 5) {
      R(x, y, 2, 2, 0);
    }
  }
  [16, 40, 66].forEach((x) => {
    R(x, 5, 4, 4, 200);
    R(x + 1, 4, 2, 2, 206);
  });

  // Stacked disk sleds: bright faceplates, dark handle cutouts, and LEDs.
  const firstBayY = 22;
  const bayH = 7;
  const gap = 2;
  for (let row = 0; row < 4; row += 1) {
    const y = firstBayY + row * (bayH + gap);
    const shade = row % 2 === 0 ? 108 : 104;
    for (let col = 0; col < 3; col += 1) {
      const x = 8 + col * 27;
      R(x, y, 23, bayH, shade);
      R(x + 1, y + 1, 21, 1, 112);
      R(x + 1, y + bayH - 1, 21, 1, 88);
      R(x + 14, y + 2, 7, bayH - 4, 0);
      R(x + 16, y + 1, 6, bayH - 2, 0);
      R(x + 4, y + 3, 5, 2, 96);
      if ((row + col) % 2 === 0) {
        R(x - 2, y + 3, 2, 2, 112);
      }
    }
  }

  // Rack seams and bottom shadow so the block reads as hardware, not a flat wall.
  for (let y = firstBayY - 3; y < H - 6; y += bayH + gap) {
    R(6, y, W - 12, 1, 88);
  }
  R(5, H - 8, W - 10, 4, 0);
  R(10, H - 5, W - 20, 2, 88);
  return buildPatch(px, W, H);
};

export const buildStorageDisplayPatch = () => {
  const { width: W, height: H } = storageDisplayTextureSize;
  const px = new Uint8Array(W * H);
  px.fill(4);
  const R = (x, y, w, h, c) => drawRect(px, W, H, x, y, x + w, y + h, c);

  // Shared chart geometry. These exact constants are mirrored by the engine's
  // R_DoomPerfDiskDashboardPixel (patch 0027), which repaints the plot rectangle
  // with live, scrolling samples; everything outside the plot rectangle (titles,
  // section frames, the panel border) is left to this static art and shows
  // through unchanged. Keep the two in lockstep. 15 samples, 4px pitch, 3px bars.
  const SECTION_H = 38;
  const CHART_X = 50;
  const CHART_W = 72;
  const CHART_H = 22;
  const SAMPLE_COUNT = 15;
  const SAMPLE_PITCH = 4;
  const BAR_W = 3;

  const drawGraph = (chartY, values) => {
    R(CHART_X, chartY, CHART_W, CHART_H, 4);
    for (let y = chartY + 6; y < chartY + CHART_H; y += 6) R(CHART_X, y, CHART_W, 1, 96);
    for (let x = CHART_X + 12; x < CHART_X + CHART_W; x += 12) R(x, chartY, 1, CHART_H, 96);
    R(CHART_X, chartY, 1, CHART_H, 0);
    R(CHART_X, chartY + CHART_H - 1, CHART_W, 1, 0);

    const bottom = chartY + CHART_H - 2;
    values.slice(0, SAMPLE_COUNT).forEach((value, index) => {
      const x = CHART_X + 4 + index * SAMPLE_PITCH;
      const fill = Math.max(2, Math.round(value * (CHART_H - 5)));
      const top = bottom - fill;
      R(x, top, BAR_W, fill, index % 2 === 0 ? 200 : 204);
      R(x, top, BAR_W, 1, 206);
    });
  };

  // One static white dashboard face. The engine repaints the live graph plots
  // through the dashboard wall-column hook; this WAD texture is complete and
  // readable on its own (titles, frames, baseline bars) so a missing/disabled
  // hook degrades to a static dashboard rather than a black block.
  R(0, 0, W, H, 0);
  R(2, 2, W - 4, H - 4, 4);

  const drawSection = (top, title, values) => {
    R(5, top, W - 10, SECTION_H, 4);
    R(5, top + SECTION_H, W - 10, 1, 0);
    drawCenteredText(px, W, H, title, top + 4, 1, 0, 5, 49, stampFlat);
    drawGraph(top + 12, values);
  };

  drawSection(5, "LATENCY", [0.18, 0.2, 0.16, 0.22, 0.19, 0.23, 0.17, 0.2, 0.21, 0.18, 0.24, 0.2, 0.19, 0.22, 0.2]);
  drawSection(45, "IOPS", [0.2, 0.23, 0.19, 0.25, 0.21, 0.27, 0.22, 0.24, 0.2, 0.26, 0.22, 0.29, 0.24, 0.26, 0.23]);
  drawSection(85, "READ/S", [0.17, 0.19, 0.18, 0.22, 0.2, 0.24, 0.21, 0.23, 0.19, 0.25, 0.22, 0.24, 0.2, 0.23, 0.21]);
  return buildPatch(px, W, H);
};

// Vertical service-latency gauge for the storage media pit. Drawn at the shared
// label width (256) so the central label-centering offset maps it once, centred,
// on a narrow niche back wall; the gauge itself is a slim column in the middle
// (the only slice a ~40px-wide niche reveals): a dark track with a gold fill
// rising from the base, a red danger band capping the scale, and recessed tick
// marks. Static here (a representative mid reading); a later engine hook can
// drive the fill height from await/service time via the niche's reserved line
// tag, the same way the CPU load gauges fill.
export const diskGaugeSize = { width: 256, height: 128 };
export const buildDiskGaugePatch = () => {
  const { width, height } = diskGaugeSize;
  const pixels = new Uint8Array(width * height);
  pixels.fill(8); // dark backing (clipped away on the narrow niche wall)
  const x0 = 110;
  const x1 = 146;            // slim column, centred on the visible window (~128)
  const top = 8;
  const bottom = height - 8;
  // Amber frame around a dark track.
  drawRect(pixels, width, height, x0 - 3, top - 3, x1 + 3, bottom + 3, 160);
  drawRect(pixels, width, height, x0, top, x1, bottom, 0);
  // Red danger band caps the top of the scale (latency/error territory).
  const danger = top + Math.round((bottom - top) * 0.18);
  drawRect(pixels, width, height, x0, top, x1, danger, 231);
  // Gold fill rising from the base (~55% of scale = a representative service load).
  const fillTop = bottom - Math.round((bottom - top) * 0.55);
  for (let y = fillTop; y < bottom; y += 1) {
    const k = (y - fillTop) / (bottom - fillTop);
    drawRect(pixels, width, height, x0, y, x1, y + 1, k < 0.5 ? 167 : 164);
  }
  // Recessed tick marks at each eighth of the scale.
  for (let t = 1; t < 8; t += 1) {
    const y = top + Math.round((bottom - top) * (t / 8));
    drawRect(pixels, width, height, x0, y, x1, y + 1, 96);
  }
  return buildPatch(pixels, width, height);
};

// ===== Floor name inscriptions (custom 64x64 flats) =====
// A wing names a stretch of floor by inscribing text flush into it: the green
// name on a dark high-contrast panel. The map script appends these generated
// flats to the map's own F_START..F_END (Doom can only add floor flats by
// re-bundling all stock flats there); this helper just produces the named flat
// lumps. Doom samples floor flats at flat[((-worldY)&63)*64 + (worldX&63)] (note
// the negated Y), so we map each flat pixel back to a world position and then to
// the text image, oriented for the cardinal direction the reading player faces.
// Cells run along the player's left->right axis (worldX for a north/south view,
// worldY for east/west).
export const FLAT_DIM = 64;
const inscriptionFontScale = 2;
const renderInscriptionText = (text, readLen, color = signTextColor) => {
  const img = new Uint8Array(readLen * FLAT_DIM); // 0 = black background
  const startY = Math.floor((FLAT_DIM - 7 * inscriptionFontScale) / 2);
  drawCenteredText(img, readLen, FLAT_DIM, text, startY, inscriptionFontScale, color, 4, readLen - 4);
  return img; // T[letterRow][readPos] = img[letterRow * readLen + readPos]
};
export const makeInscription = (prefix, text, facing, cells, color = signTextColor) => {
  const readLen = cells * FLAT_DIM;
  const T = renderInscriptionText(text, readLen, color);
  const sample = (letterRow, readPos) =>
    readPos < 0 || readPos >= readLen || letterRow < 0 || letterRow >= FLAT_DIM
      ? 0
      : T[letterRow * readLen + readPos];
  const horiz = facing === "north" || facing === "south";
  const rectW = horiz ? readLen : FLAT_DIM;
  const rectH = horiz ? FLAT_DIM : readLen;
  // World-local (wx,wy) -> text pixel, oriented so the name reads upright with
  // its top away from the approaching player.
  const at = (wx, wy) => {
    if (facing === "north") return sample(rectH - 1 - wy, wx);
    if (facing === "south") return sample(wy, rectW - 1 - wx);
    if (facing === "west") return sample(wx, wy);
    return sample(FLAT_DIM - 1 - wx, rectH - 1 - wy); // east
  };
  const flats = [];
  const names = [];
  for (let k = 0; k < cells; k += 1) {
    const cellXoff = horiz ? k * FLAT_DIM : 0;
    const cellYoff = horiz ? 0 : k * FLAT_DIM;
    const flat = new Uint8Array(FLAT_DIM * FLAT_DIM);
    for (let r = 0; r < FLAT_DIM; r += 1)
      for (let c = 0; c < FLAT_DIM; c += 1)
        flat[r * FLAT_DIM + c] = at(cellXoff + c, cellYoff + ((FLAT_DIM - r) % FLAT_DIM));
    const name = `${prefix}${k}`;
    flats.push(lump(name, Buffer.from(flat)));
    names.push(name);
  }
  return { flats, names };
};
