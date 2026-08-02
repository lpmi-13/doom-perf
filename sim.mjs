// Mirror DoomPerf_DiskOrbPos + the wing's sector heights, and check every sampled
// point on the circuit lies in open space for its radius.
const X=[0,-168,-291,-336,-291,-168,0,168,291,336,291,168,0,-130,-165,-130,-65,65,130,65,-65];
const Y=[-861,-906,-1029,-1197,-1365,-1488,-1533,-1488,-1365,-1197,-1029,-906,-861,-972,-1102,-1197,-1310,-1310,-1197,-1084,-1084];
const Z=[0,20,40,60,80,100,120,140,160,180,200,220,240,264,288,312,324,336,348,360,372];
const NODES=21, SEGS=NODES-1, SPAN=1000, UP=SEGS*SPAN, END=2*UP;
const Z_UP=56, Z_DOWN=24;
const CV=1197, R_DRUM=100, R_PLATTER=200, R_DECK=312, R_GUTTER=360, R_STEP=518;
const RISE=24, PLATTER_FLOOR=240, C_TOWER=400, C_SKY=480, N=10;
const pos = (p) => {
  const deck = p < UP ? Z_UP : Z_DOWN;
  let q = p <= UP ? p : END - p;
  q = Math.max(0, Math.min(UP, q));
  let seg = Math.min(SEGS - 1, Math.floor(q / SPAN));
  const t = q - seg * SPAN, a = seg, b = seg + 1;
  return [X[a]+((X[b]-X[a])*t)/SPAN, Y[a]+((Y[b]-Y[a])*t)/SPAN, Z[a]+((Z[b]-Z[a])*t)/SPAN + deck];
};
// which sector is world (x,y) in, and what are its floor/ceiling?
const sectorAt = (x, y) => {
  const u = -x, v = -y, dx = u, dy = v - CV;
  const r = Math.hypot(dx, dy);
  if (r < R_DRUM) return { name: "DRUM(solid)", floor: 368, ceil: 368 };
  if (r < R_PLATTER) return { name: "platter", floor: PLATTER_FLOOR, ceil: C_SKY };
  // deck/gutter/step: which face? angle -> face index
  let th = Math.atan2(dy, dx) * 180 / Math.PI;      // -180..180
  let face = Math.floor(((((th + 72) % 360) + 360) % 360) / (360 / N));
  const k = (face + 1) % N;
  if (r < R_DECK) return { name: "deck", floor: PLATTER_FLOOR, ceil: C_SKY };
  if (r < R_GUTTER) return { name: `gutter-${face}`, floor: k * RISE - 24, ceil: C_TOWER, brim: k * RISE - 2 };
  if (r < R_STEP) return { name: `step-${face}`, floor: k * RISE, ceil: C_TOWER };
  return { name: "OUTSIDE", floor: null, ceil: null };
};
let bad = [], minClear = 1e9, minAt = null;
for (let p = 0; p < END; p += 25) {
  const [x, y, z] = pos(p);
  const s = sectorAt(x, y);
  const r = Math.hypot(-x, -y - CV);
  if (s.floor === null) { bad.push(`p=${p} OUTSIDE the tower r=${r.toFixed(0)}`); continue; }
  if (s.name.startsWith("DRUM")) { bad.push(`p=${p} INSIDE SOLID DRUM r=${r.toFixed(0)}`); continue; }
  if (z < s.floor) bad.push(`p=${p} z=${z.toFixed(0)} BELOW ${s.name} floor ${s.floor} (r=${r.toFixed(0)})`);
  if (z > s.ceil - 16) bad.push(`p=${p} z=${z.toFixed(0)} into ${s.name} ceiling ${s.ceil}`);
  const clear = z - (s.brim ?? s.floor);
  if (clear < minClear) { minClear = clear; minAt = `p=${p} ${s.name} z=${z.toFixed(0)} vs ${(s.brim!=null?"brim":"floor")} ${s.brim ?? s.floor}`; }
}
console.log(`sampled ${Math.ceil(END/25)} points | violations: ${bad.length}`);
bad.slice(0, 15).forEach(b => console.log("  " + b));
console.log(`tightest vertical clearance: ${minClear.toFixed(0)}  (${minAt})`);
// radial extremes
let rmin = 1e9, rmax = 0;
for (let p = 0; p < END; p += 5) { const [x,y] = pos(p); const r = Math.hypot(-x, -y-CV); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
console.log(`radius range ${rmin.toFixed(1)} .. ${rmax.toFixed(1)}  (drum ${R_DRUM}, deck ${R_DECK}, gutter ${R_GUTTER})`);
