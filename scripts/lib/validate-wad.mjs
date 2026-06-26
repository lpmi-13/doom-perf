// Standalone validator for a built map WAD (run: node scripts/lib/validate-wad.mjs
// [path]). Parses the E1M1 map lumps and asserts the BSP is well-formed and, for a
// point taken just inside every seg, that point-location through the node tree
// returns a subsector belonging to that seg's front sector. This is the same
// invariant the fixture test checks, but run against the REAL generated geometry
// (no external sector polygons needed -- the check is self-contained in the WAD).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wadPath = process.argv[2]
  ? process.argv[2]
  : fileURLToPath(new URL("../../public/maps/doomperf-lab.wad", import.meta.url));

const wad = readFileSync(wadPath);
const numLumps = wad.readInt32LE(4);
const dirOffset = wad.readInt32LE(8);
const dir = [];
for (let i = 0; i < numLumps; i += 1) {
  const o = dirOffset + i * 16;
  dir.push({
    offset: wad.readInt32LE(o),
    size: wad.readInt32LE(o + 4),
    name: wad.subarray(o + 8, o + 16).toString("ascii").replace(/\0.*$/, ""),
  });
}
const mapStart = dir.findIndex((l) => l.name === "E1M1");
if (mapStart === -1) throw new Error("no E1M1 in WAD");
const lumpBuf = (name) => {
  const entry = dir.slice(mapStart + 1, mapStart + 11).find((l) => l.name === name);
  if (!entry) throw new Error(`missing ${name}`);
  return wad.subarray(entry.offset, entry.offset + entry.size);
};

const arr = (buf, size, parse) => {
  const out = [];
  for (let off = 0; off + size <= buf.length; off += size) out.push(parse(buf, off));
  return out;
};
const vertices = arr(lumpBuf("VERTEXES"), 4, (b, o) => [b.readInt16LE(o), b.readInt16LE(o + 2)]);
const linedefs = arr(lumpBuf("LINEDEFS"), 14, (b, o) => ({
  v1: b.readUInt16LE(o), v2: b.readUInt16LE(o + 2), flags: b.readUInt16LE(o + 4),
  frontSide: b.readInt16LE(o + 10), backSide: b.readInt16LE(o + 12),
}));
const sidedefs = arr(lumpBuf("SIDEDEFS"), 30, (b, o) => ({ sector: b.readInt16LE(o + 28) }));
const segs = arr(lumpBuf("SEGS"), 12, (b, o) => ({
  v1: b.readUInt16LE(o), v2: b.readUInt16LE(o + 2), linedef: b.readUInt16LE(o + 6), side: b.readUInt16LE(o + 8),
}));
const subsectors = arr(lumpBuf("SSECTORS"), 4, (b, o) => ({ numSegs: b.readUInt16LE(o), firstSeg: b.readUInt16LE(o + 2) }));
const nodes = arr(lumpBuf("NODES"), 28, (b, o) => ({
  x: b.readInt16LE(o), y: b.readInt16LE(o + 2), dx: b.readInt16LE(o + 4), dy: b.readInt16LE(o + 6),
  child0: b.readUInt16LE(o + 24), child1: b.readUInt16LE(o + 26),
}));
const sectors = arr(lumpBuf("SECTORS"), 26, () => ({}));

const SUBSECTOR_BIT = 0x8000;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const subsectorSector = (ssIndex) => {
  const ss = subsectors[ssIndex];
  const seg = segs[ss.firstSeg];
  const ld = linedefs[seg.linedef];
  const sideIndex = seg.side === 0 ? ld.frontSide : ld.backSide;
  return sidedefs[sideIndex].sector;
};

const locate = (x, y) => {
  let ref = nodes.length - 1;
  let guard = 0;
  while (!(ref & SUBSECTOR_BIT)) {
    const node = nodes[ref];
    const cross = node.dx * (y - node.y) - node.dy * (x - node.x);
    ref = cross < 0 ? node.child0 : node.child1;
    if (guard++ > 100000) throw new Error("node traversal did not terminate");
  }
  return ref & ~SUBSECTOR_BIT;
};

// Structural checks.
for (const node of nodes) {
  for (const ref of [node.child0, node.child1]) {
    const index = ref & ~SUBSECTOR_BIT;
    if (ref & SUBSECTOR_BIT) check(index < subsectors.length, `subsector ref ${index} out of range`);
    else check(index < nodes.length, `node ref ${index} out of range`);
  }
}
for (let i = 0; i < subsectors.length; i += 1) {
  const ss = subsectors[i];
  check(ss.numSegs >= 1, `subsector ${i} has no segs`);
  check(ss.firstSeg + ss.numSegs <= segs.length, `subsector ${i} segs out of range`);
  const sector = subsectorSector(i);
  for (let s = ss.firstSeg; s < ss.firstSeg + ss.numSegs; s += 1) {
    const seg = segs[s];
    const ld = linedefs[seg.linedef];
    const sec = sidedefs[seg.side === 0 ? ld.frontSide : ld.backSide].sector;
    check(sec === sector, `subsector ${i} mixes sectors (${sector} vs ${sec})`);
  }
}
for (const seg of segs) {
  check(seg.v1 < vertices.length && seg.v2 < vertices.length, "seg vertex out of range");
  const [ax, ay] = vertices[seg.v1];
  const [bx, by] = vertices[seg.v2];
  check(ax !== bx || ay !== by, "degenerate (zero-length) seg");
}
for (const ld of linedefs) {
  const twoSided = (ld.flags & 4) !== 0;
  if (twoSided) check(ld.backSide >= 0, "two-sided line missing back side");
  else check(ld.backSide === -1, "one-sided line has a back side");
}

// Point-location: a point a few units inside each seg must locate to a subsector
// of that seg's front sector.
let located = 0;
for (let i = 0; i < segs.length; i += 1) {
  const seg = segs[i];
  const [ax, ay] = vertices[seg.v1];
  const [bx, by] = vertices[seg.v2];
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // interior is to the right of a->b: inward normal = (dy, -dx)/len. Probe only a
  // fraction of a unit inward (fractional coords are fine for point-location) so
  // the probe stays inside even very thin (4u) solid panel sectors.
  const px = mx + (dy / len) * 0.5;
  const py = my + (-dx / len) * 0.5;
  const ld = linedefs[seg.linedef];
  const expected = sidedefs[seg.side === 0 ? ld.frontSide : ld.backSide].sector;
  const ss = locate(px, py);
  located += 1;
  check(subsectorSector(ss) === expected, `seg ${i} interior point (${px},${py}) located to sector ${subsectorSector(ss)}, expected ${expected}`);
}

const counts = `sectors=${sectors.length} linedefs=${linedefs.length} sidedefs=${sidedefs.length} vertices=${vertices.length} segs=${segs.length} subsectors=${subsectors.length} nodes=${nodes.length}`;
if (problems.length) {
  console.error(`FAIL ${wadPath}\n  ${counts}`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}
console.log(`OK ${wadPath}\n  ${counts}\n  point-location checks: ${located}`);
