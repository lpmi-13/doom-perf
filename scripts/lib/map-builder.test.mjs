// Phase-4 guardrail for the general polygon + BSP builder. Builds small fixtures
// (rectangles, a hexagon framed in a box, a T-junction, adjacent rooms), compiles
// them to the real binary lumps, parses those lumps back, and asserts the BSP is
// valid AND that point-location through the node tree lands every sampled interior
// point in a subsector belonging to the sector that actually contains it. That
// point-location check is the invariant that prevents HOM / inverted rendering;
// byte-identity to the old builder is intentionally NOT checked (the full switch
// re-orders nodes/segs).
import test from "node:test";
import assert from "node:assert/strict";
import { createMapBuilder } from "./map-builder.mjs";

const decorate = {
  chooseFrontEdge: (group) => group.find((edge) => edge.sector.kind !== "door") ?? group[0],
  sideTextures: () => ({ top: "-", bottom: "-", mid: "STARTAN3" }),
  textureOffsetFor: () => 0,
  lineFlagsFor: (front, back) => ({ flags: back ? 4 : 1, special: 0 }),
  lineTagFor: () => 0,
};

const parseMap = (lumps) => {
  const arr = (buf, size, parse) => {
    const out = [];
    for (let off = 0; off + size <= buf.length; off += size) out.push(parse(buf, off));
    return out;
  };
  const vertices = arr(lumps.vertexes, 4, (b, o) => [b.readInt16LE(o), b.readInt16LE(o + 2)]);
  const linedefs = arr(lumps.linedefs, 14, (b, o) => ({
    v1: b.readUInt16LE(o), v2: b.readUInt16LE(o + 2), flags: b.readUInt16LE(o + 4),
    frontSide: b.readInt16LE(o + 10), backSide: b.readInt16LE(o + 12),
  }));
  const sidedefs = arr(lumps.sidedefs, 30, (b, o) => ({ sector: b.readInt16LE(o + 28) }));
  const segs = arr(lumps.segs, 12, (b, o) => ({
    v1: b.readUInt16LE(o), v2: b.readUInt16LE(o + 2), linedef: b.readUInt16LE(o + 6), side: b.readUInt16LE(o + 8),
  }));
  const subsectors = arr(lumps.subsectors, 4, (b, o) => ({ numSegs: b.readUInt16LE(o), firstSeg: b.readUInt16LE(o + 2) }));
  const nodes = arr(lumps.nodes, 28, (b, o) => ({
    x: b.readInt16LE(o), y: b.readInt16LE(o + 2), dx: b.readInt16LE(o + 4), dy: b.readInt16LE(o + 6),
    child0: b.readUInt16LE(o + 24), child1: b.readUInt16LE(o + 26),
  }));
  return { vertices, linedefs, sidedefs, segs, subsectors, nodes };
};

const SUBSECTOR_BIT = 0x8000;

const subsectorSector = (map, ssIndex) => {
  const ss = map.subsectors[ssIndex];
  const seg = map.segs[ss.firstSeg];
  const linedef = map.linedefs[seg.linedef];
  const sideIndex = seg.side === 0 ? linedef.frontSide : linedef.backSide;
  return map.sidedefs[sideIndex].sector;
};

const locate = (map, x, y) => {
  let ref = map.nodes.length - 1;
  let guard = 0;
  while (!(ref & SUBSECTOR_BIT)) {
    const node = map.nodes[ref];
    const cross = node.dx * (y - node.y) - node.dy * (x - node.x);
    ref = cross < 0 ? node.child0 : node.child1;
    if (guard++ > 1000) throw new Error("node traversal did not terminate");
  }
  return ref & ~SUBSECTOR_BIT;
};

const pointInPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const centroid = (poly) => {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) {
    cx += x;
    cy += y;
  }
  return [cx / poly.length, cy / poly.length];
};

const assertValid = (map, polys) => {
  // Structural validity.
  assert.ok(map.subsectors.length > 0, "at least one subsector");
  for (const node of map.nodes) {
    for (const ref of [node.child0, node.child1]) {
      const index = ref & ~SUBSECTOR_BIT;
      if (ref & SUBSECTOR_BIT) assert.ok(index < map.subsectors.length, "subsector ref in range");
      else assert.ok(index < map.nodes.length, "node ref in range");
    }
  }
  for (const ss of map.subsectors) {
    assert.ok(ss.numSegs >= 1, "subsector has segs");
    assert.ok(ss.firstSeg + ss.numSegs <= map.segs.length, "subsector segs in range");
  }
  for (const seg of map.segs) {
    assert.ok(seg.v1 < map.vertices.length && seg.v2 < map.vertices.length, "seg vertices in range");
    assert.notDeepEqual(map.vertices[seg.v1], map.vertices[seg.v2], "seg is non-degenerate");
    assert.ok(seg.linedef < map.linedefs.length, "seg linedef in range");
  }
  for (const linedef of map.linedefs) {
    const twoSided = (linedef.flags & 4) !== 0;
    if (twoSided) assert.ok(linedef.backSide >= 0, "two-sided line has a back side");
    else assert.equal(linedef.backSide, -1, "one-sided line has no back side");
  }
  // Point-location: each subsector resolves to a single sector, and every sampled
  // interior point reaches a subsector of the sector that contains it.
  for (let i = 0; i < map.subsectors.length; i += 1) {
    const ss = map.subsectors[i];
    const sector = subsectorSector(map, i);
    for (let s = ss.firstSeg; s < ss.firstSeg + ss.numSegs; s += 1) {
      assert.equal(subsectorSector(map, i), sector, "subsector segs share one sector");
    }
  }
  for (let sectorIndex = 0; sectorIndex < polys.length; sectorIndex += 1) {
    const poly = polys[sectorIndex];
    const [cx, cy] = centroid(poly);
    const samples = [[cx, cy]];
    for (const [vx, vy] of poly) samples.push([Math.round((cx + vx) / 2), Math.round((cy + vy) / 2)]);
    for (const [x, y] of samples) {
      if (!pointInPoly(poly, x, y)) continue;
      const ssIndex = locate(map, x, y);
      assert.equal(subsectorSector(map, ssIndex), sectorIndex, `point (${x},${y}) locates to sector ${sectorIndex}`);
    }
  }
};

test("two adjacent rectangles", () => {
  const builder = createMapBuilder();
  builder.addRect("a", { x1: -200, y1: -100, x2: 0, y2: 100 });
  builder.addRect("b", { x1: 0, y1: -100, x2: 200, y2: 100 });
  assertValid(parseMap(builder.compile(decorate)), [
    [[-200, 100], [0, 100], [0, -100], [-200, -100]],
    [[0, 100], [200, 100], [200, -100], [0, -100]],
  ]);
});

test("T-junction: a narrow room against a wide wall", () => {
  const builder = createMapBuilder();
  builder.addRect("wide", { x1: -300, y1: 0, x2: 300, y2: 200 });
  builder.addRect("narrow", { x1: -64, y1: -200, x2: 64, y2: 0 }); // touches the wide wall mid-span
  assertValid(parseMap(builder.compile(decorate)), [
    [[-300, 200], [300, 200], [300, 0], [-300, 0]],
    [[-64, 0], [64, 0], [64, -200], [-64, -200]],
  ]);
});

test("hexagonal drum ringed by six trapezoids (the platter-frame shape)", () => {
  const builder = createMapBuilder();
  // Flat-top hexagons, clockwise (interior on the right). Inner = solid drum,
  // outer ring split into one convex trapezoid per drum face -- the same
  // decomposition the real platter frame will use.
  const inner = [[-100, 173], [100, 173], [200, 0], [100, -173], [-100, -173], [-200, 0]];
  const outer = [[-200, 346], [200, 346], [400, 0], [200, -346], [-200, -346], [-400, 0]];
  builder.addPoly("drum", inner, { floor: 0, ceiling: 256 });
  const polys = [inner];
  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const trapezoid = [outer[i], outer[j], inner[j], inner[i]];
    builder.addPoly(`ring-${i}`, trapezoid, { floor: 0, ceiling: 192 });
    polys.push(trapezoid);
  }
  assertValid(parseMap(builder.compile(decorate)), polys);
});

test("a four-by-four grid of rooms", () => {
  const builder = createMapBuilder();
  const polys = [];
  for (let gx = 0; gx < 4; gx += 1) {
    for (let gy = 0; gy < 4; gy += 1) {
      const x1 = gx * 128 - 256;
      const y1 = gy * 128 - 256;
      const x2 = x1 + 128;
      const y2 = y1 + 128;
      builder.addRect(`r-${gx}-${gy}`, { x1, y1, x2, y2 });
      polys.push([[x1, y2], [x2, y2], [x2, y1], [x1, y1]]);
    }
  }
  assertValid(parseMap(builder.compile(decorate)), polys);
});
