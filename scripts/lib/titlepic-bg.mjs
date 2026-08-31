// Renders the DooMPERF title-screen BACKGROUND: a Brendan-Gregg flame graph rising
// out of a dark ember gradient, in place of Freedoom's demon/gore scene. Pure Node
// (no ImageMagick) — it emits a 320x200 buffer of PLAYPAL indices that
// scripts/lib/titlepic.mjs stamps the chrome wordmark on top of.
//
// The flame is a synthetic-but-plausible profile of the engine's own frame loop
// (main -> D_DoomLoop -> D_Display -> R_RenderPlayerView -> ...), coloured with the
// EXACT palette flamegraph.pl uses for its default "hot" scheme:
//   r = 205 + 50*rand,  g = 0 + 230*rand,  b = 0 + 55*rand
// seeded per frame so it is deterministic across builds. Bottom = root, up = leaf,
// width proportional to on-CPU time — read it like any flame graph.
//
// Reserved palette indices (the live load-pulse "oo", see [[title-oo-load-pulse]])
// are excluded from quantisation so no stray ember pixel ever pulses with them.

// Synthetic call tree. `w` = fraction of the total sample width; a node's children
// are laid out left-to-right inside it and must sum to <= its own width (the slack
// is the frame's own exclusive time, shown as bare frame-top). Depth grows upward.
const TREE = {
  name: "main", w: 1.0, children: [
    { name: "D_DoomLoop", w: 0.97, children: [
      { name: "TryRunTics", w: 0.30, children: [
        { name: "G_Ticker", w: 0.29, children: [
          { name: "P_Ticker", w: 0.22, children: [
            { name: "P_RunThinkers", w: 0.20, children: [
              { name: "P_MobjThinker", w: 0.11, children: [
                { name: "P_ZMovement", w: 0.04 },
                { name: "P_XYMovement", w: 0.05, children: [
                  { name: "P_CheckPosition", w: 0.03 },
                ] },
              ] },
              { name: "T_MoveFloor", w: 0.05 },
            ] },
          ] },
          { name: "AM_Ticker", w: 0.03 },
        ] },
      ] },
      { name: "D_Display", w: 0.66, children: [
        { name: "R_RenderPlayerView", w: 0.60, children: [
          { name: "R_RenderBSPNode", w: 0.34, children: [
            { name: "R_Subsector", w: 0.30, children: [
              { name: "R_AddLine", w: 0.16, children: [
                { name: "R_StoreWallRange", w: 0.12, children: [
                  { name: "R_DrawColumn", w: 0.09 },
                ] },
              ] },
              { name: "R_AddSprite", w: 0.08 },
            ] },
          ] },
          { name: "R_DrawPlanes", w: 0.14, children: [
            { name: "R_MakeSpans", w: 0.08, children: [
              { name: "R_DrawSpan", w: 0.05 },
            ] },
          ] },
          { name: "R_DrawMasked", w: 0.10, children: [
            { name: "R_DrawVisSprite", w: 0.06 },
          ] },
        ] },
        { name: "I_FinishUpdate", w: 0.05, children: [
          { name: "blit_canvas", w: 0.03 },
        ] },
      ] },
    ] },
    { name: "Z_Malloc", w: 0.03 },
  ],
};

// Vertical geometry. Rows stack UP from the baseline; the deepest frame's top must
// clear the wordmark band (titlepic.mjs BAND.y1 = 57) with a margin.
const BASE_Y = 193; // bottom edge of the root frame
const ROW = 14; // px per stack level

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// flamegraph.pl default "hot" palette, seeded per frame (name + draw order).
const frameColor = (name, ord) => {
  const rnd = mulberry32(hash(name) ^ Math.imul(ord + 1, 0x9e3779b1));
  const r = 205 + Math.floor(50 * rnd());
  const g = Math.floor(230 * rnd());
  const b = Math.floor(55 * rnd());
  return [r, g, b];
};

// Flatten the tree into positioned frames (x0,x1 in px; depth from root).
const layoutFrames = (width) => {
  const frames = [];
  const walk = (node, x0, depth) => {
    const wpx = node.w * width;
    frames.push({ x0, x1: x0 + wpx, depth, name: node.name });
    let cx = x0;
    for (const c of node.children || []) { walk(c, cx, depth + 1); cx += c.w * width; }
  };
  walk(TREE, 0, 0);
  return frames;
};

const grain = (x, y) => ((x * 73 + y * 151) % 7) - 3; // deterministic +/-3 dither

// Nearest palette entry, skipping reserved indices so the ember field never lands
// on a load-pulse "oo" colour.
const nearestExcept = (pal, r, g, b, skip) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 256; i += 1) {
    if (skip.has(i)) continue;
    const [pr, pg, pb] = pal[i];
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
};

const lerp = (a, b, t) => a + (b - a) * t;

// pal: array of [r,g,b]; returns Uint8Array(width*height) of palette indices.
export const renderFlameBackground = ({ pal, width, height, reserved = new Set() }) => {
  const rgb = new Float32Array(width * height * 3); // work in RGB, quantise once at the end

  // 1) Dark ember gradient over the whole canvas: near-black warm at top (so the
  //    chrome wordmark reads), warming toward the flame baseline like a coal bed.
  const TOP = [12, 6, 12];   // deep maroon-black behind the wordmark
  const HORIZON = [46, 14, 10]; // warmer just above the flame base
  for (let y = 0; y < height; y += 1) {
    const t = Math.min(1, y / BASE_Y);
    const cr = lerp(TOP[0], HORIZON[0], t), cg = lerp(TOP[1], HORIZON[1], t), cb = lerp(TOP[2], HORIZON[2], t);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3, gg = grain(x, y);
      rgb[o] = cr + gg; rgb[o + 1] = cg + gg * 0.5; rgb[o + 2] = cb + gg * 0.7;
    }
  }

  // 2) Ember bloom: a soft warm glow seated at the flame base, falling off upward,
  //    so the graph looks lit from its own heat rather than pasted on.
  for (let y = 0; y < height; y += 1) {
    const above = BASE_Y - y;
    const glow = above >= -8 ? Math.exp(-Math.max(0, above) / 34) : 0; // strongest at the base
    if (glow <= 0.01) continue;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      rgb[o] += 70 * glow; rgb[o + 1] += 20 * glow; rgb[o + 2] += 6 * glow;
    }
  }

  // 3) The flame graph. 1px dark gaps at each frame's top and left edge read as
  //    stacked, separated plates against the dark ground.
  const frames = layoutFrames(width);
  frames.forEach((f, ord) => {
    const [fr, fg, fb] = frameColor(f.name, ord);
    const xs = Math.max(0, Math.round(f.x0)), xe = Math.min(width, Math.round(f.x1));
    const yTop = BASE_Y - (f.depth + 1) * ROW, yBot = BASE_Y - f.depth * ROW;
    for (let y = Math.max(0, yTop); y < Math.min(height, yBot); y += 1) {
      const edgeTop = y === yTop; // 1px separator from the child above
      for (let x = xs; x < xe; x += 1) {
        if (edgeTop || x === xs) continue; // leave top/left dark for plate edges
        const o = (y * width + x) * 3, gg = grain(x, y) * 0.6;
        // subtle vertical shade inside each frame for a lit, rounded look
        const sh = 1 - 0.18 * ((y - yTop) / ROW);
        rgb[o] = fr * sh + gg; rgb[o + 1] = fg * sh + gg; rgb[o + 2] = fb * sh + gg;
      }
    }
  });

  // 4) Quantise to PLAYPAL (reserved indices excluded).
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 3;
    out[i] = nearestExcept(pal, rgb[o], rgb[o + 1], rgb[o + 2], reserved);
  }
  return out;
};
