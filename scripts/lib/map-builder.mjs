// The map geometry builder: owns the mutable layout state (sectors + things)
// and turns it into the binary WAD map lumps.
//
// Sectors are stored as convex POLYGONS: an ordered, CLOCKWISE loop of [x,y]
// vertices, with the sector interior on the RIGHT of each directed edge (this is
// the winding the DOOM seg/sidedef convention expects -- the front sidedef sits
// on the sector side). A cached axis-aligned bbox rides along for blockmap /
// quick overlap rejection. `addRect` builds an axis-aligned 4-point polygon (so
// existing wings are unchanged); `addPoly` / `areaPoly` take an arbitrary convex
// loop, so a wing can emit angled (e.g. hexagonal) geometry.
//
// `compile` runs the full pipeline, asking a caller-supplied `decorate` for the
// map-specific per-line texturing/flags/tags:
//   1. expand every sector polygon into directed boundary edges,
//   2. MESH coincident edges -- split each at every shared interior vertex so
//      two-sided boundaries become identical segments and T-junctions vanish,
//   3. resolve front/back and emit linedefs + sidedefs,
//   4. build a GENERAL BSP (arbitrary-angle partition lines, with seg splitting)
//      whose convex leaves are the subsectors,
//   5. encode the binary lumps.
// The construction API knows nothing about CPU rooms or textures; the aesthetic
// decisions stay in the map script via `decorate`.

import { i16, u16, ascii8, record } from "./wad-bytes.mjs";

export const createMapBuilder = () => {
  const sectors = [];
  const things = [{ x: 0, y: 0, angle: 90, type: 1, options: 7 }];

  const pointKey = ([x, y]) => `${x},${y}`;

  const boundsFor = (points) => ({
    x1: Math.min(...points.map(([x]) => x)),
    y1: Math.min(...points.map(([, y]) => y)),
    x2: Math.max(...points.map(([x]) => x)),
    y2: Math.max(...points.map(([, y]) => y)),
  });

  const rotatePoint = ([u, v], direction) => {
    switch (direction) {
      case "north":
        return [u, v];
      case "east":
        return [v, -u];
      case "south":
        return [-u, -v];
      case "west":
        return [-v, u];
      default:
        throw new Error(`Unknown map direction: ${direction}`);
    }
  };

  const rotateBounds = ({ u1, v1, u2, v2 }, direction) =>
    boundsFor([
      rotatePoint([u1, v1], direction),
      rotatePoint([u2, v1], direction),
      rotatePoint([u2, v2], direction),
      rotatePoint([u1, v2], direction),
    ]);

  // Shoelace signed area; NEGATIVE for our clockwise (interior-on-right) winding.
  const signedArea = (poly) => {
    let sum = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
  };

  // Convex iff every consecutive turn has a consistent sign (no reflex vertex).
  const isConvex = (poly) => {
    let sign = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const [cx, cy] = poly[(i + 2) % poly.length];
      const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      if (cross !== 0) {
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
      }
    }
    return true;
  };

  // Legacy side name for an axis-aligned edge a->b in a clockwise loop, else
  // undefined (an angled edge has no top/right/bottom/left). This keeps the
  // decorate layer's per-side logic working for rectangles and for the
  // axis-aligned faces of polygons; angled faces simply carry no side tag.
  const axisSideName = (a, b) => {
    if (a[1] === b[1]) return b[0] > a[0] ? "top" : "bottom";
    if (a[0] === b[0]) return b[1] < a[1] ? "right" : "left";
    return undefined;
  };

  // Convex-polygon overlap via the separating-axis test. Touching edges/vertices
  // are NOT an overlap: the overlap must be strictly positive on every axis.
  const polysOverlap = (p, q) => {
    for (const poly of [p, q]) {
      for (let i = 0; i < poly.length; i += 1) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        const nx = -(by - ay);
        const ny = bx - ax;
        let pMin = Infinity, pMax = -Infinity, qMin = Infinity, qMax = -Infinity;
        for (const [x, y] of p) {
          const d = x * nx + y * ny;
          if (d < pMin) pMin = d;
          if (d > pMax) pMax = d;
        }
        for (const [x, y] of q) {
          const d = x * nx + y * ny;
          if (d < qMin) qMin = d;
          if (d > qMax) qMax = d;
        }
        if (pMax <= qMin || qMax <= pMin) return false;
      }
    }
    return true;
  };

  const addThing = ({ x, y, angle = 0, type, options = 7 }) => {
    things.push({ x, y, angle, type, options });
  };

  const addAreaThing = (direction, type, u, v, angle = 0) => {
    const [x, y] = rotatePoint([u, v], direction);
    const directionAngle = {
      north: 0,
      east: 270,
      south: 180,
      west: 90,
    }[direction];
    addThing({ x, y, angle: (angle + directionAngle) % 360, type });
  };

  const sectorDefaults = {
    floor: 0,
    ceiling: 192,
    floorFlat: "FLOOR4_8",
    ceilingFlat: "CEIL3_5",
    light: 208,
    wall: "STARTAN3",
    kind: "room",
    resource: undefined,
    labelSide: undefined,
    labelTexture: undefined,
  };

  // Add a convex sector from an ordered clockwise loop of [x,y] points. Options
  // carry the per-sector style/kind/tags; `labelEdge` (a poly-edge index) or
  // `labelSide` (an axis-aligned side name) places the override label texture.
  const addPoly = (id, points, options = {}) => {
    const poly = points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    if (poly.length < 3) {
      throw new Error(`Sector ${id} needs at least 3 vertices.`);
    }
    const area = signedArea(poly);
    if (area >= 0) {
      throw new Error(`Sector ${id} must be wound clockwise (interior on the right); signed area is ${area}.`);
    }
    if (!isConvex(poly)) {
      throw new Error(`Sector ${id} is not convex.`);
    }
    const sector = { id, ...sectorDefaults, ...boundsFor(poly), poly, ...options };
    for (const other of sectors) {
      const bboxApart =
        sector.x2 <= other.x1 || other.x2 <= sector.x1 || sector.y2 <= other.y1 || other.y2 <= sector.y1;
      if (!bboxApart && polysOverlap(poly, other.poly)) {
        throw new Error(`Sectors overlap: ${id} and ${other.id}`);
      }
    }
    sectors.push(sector);
    return sector;
  };

  // Axis-aligned rectangle as a clockwise 4-point polygon: top-left, top-right,
  // bottom-right, bottom-left, so its edges name out as top/right/bottom/left
  // exactly as the legacy builder did.
  const addRect = (id, bounds, options = {}) => {
    const { x1, y1, x2, y2 } = bounds;
    if (x1 >= x2 || y1 >= y2) {
      throw new Error(`Sector ${id} has invalid bounds.`);
    }
    return addPoly(id, [[x1, y2], [x2, y2], [x2, y1], [x1, y1]], options);
  };

  const areaRect = (direction, id, localBounds, options) =>
    addRect(`${direction}-${id}`, rotateBounds(localBounds, direction), options);

  // Rotate each local (u,v) point into world space and add it as a polygon. The
  // cardinal rotations are all proper rotations, so clockwise local winding stays
  // clockwise in world space.
  const areaPoly = (direction, id, localPoints, options) =>
    addPoly(`${direction}-${id}`, localPoints.map((point) => rotatePoint(point, direction)), options);

  // Derive every WAD map lump from the accumulated sectors/things. `decorate`
  // supplies the map-specific per-edge decisions (same contract as before):
  //   chooseFrontEdge(group)                          -> the edge whose sector is the front
  //   sideTextures(sector, other, override, edge)     -> { top, bottom, mid }
  //   textureOffsetFor(edge, sector, other, override) -> x offset
  //   lineFlagsFor(front, back)                       -> { flags, special }
  //   lineTagFor(front, back, overrideTexture)        -> line tag
  const compile = (decorate) => {
    const vertexIds = new Map();
    const vertices = [];
    const vertexId = (point) => {
      const key = pointKey(point);
      const existing = vertexIds.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const index = vertices.length;
      vertexIds.set(key, index);
      vertices.push(point);
      return index;
    };

    const segmentKey = (a, b) => {
      const first = pointKey(a);
      const second = pointKey(b);
      return first < second ? `${first}:${second}` : `${second}:${first}`;
    };

    // ----- 1. boundary edges (clockwise; sector on the right) -----
    const rawEdges = [];
    for (const sector of sectors) {
      const poly = sector.poly;
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const side = axisSideName(a, b);
        const labelled =
          (sector.labelSide !== undefined && side === sector.labelSide) ||
          (sector.labelEdge !== undefined && sector.labelEdge === i);
        rawEdges.push({
          a,
          b,
          sector,
          side,
          overrideTexture: labelled ? sector.labelTexture : undefined,
        });
      }
    }

    // ----- 2. shared-edge meshing (T-junction elimination) -----
    // Group edges by their supporting line, then split each edge at every other
    // collinear endpoint that falls strictly inside it. Coincident boundaries
    // thus become identical sub-segments (keyed by segmentKey), and a vertex of
    // one sector landing mid-edge of another splits that edge -- no T-junctions.
    const gcd = (a, b) => {
      a = Math.abs(a);
      b = Math.abs(b);
      while (b) {
        const t = a % b;
        a = b;
        b = t;
      }
      return a;
    };
    const lineGroups = new Map();
    for (const edge of rawEdges) {
      const [ax, ay] = edge.a;
      const [bx, by] = edge.b;
      let A = by - ay; // dy
      let B = ax - bx; // -dx
      let C = A * ax + B * ay;
      const g = gcd(gcd(A, B), C) || 1;
      A /= g;
      B /= g;
      C /= g;
      if (A < 0 || (A === 0 && B < 0)) {
        A = -A;
        B = -B;
        C = -C;
      }
      const key = `${A},${B},${C}`;
      let group = lineGroups.get(key);
      if (!group) {
        group = { dir: [-B, A], edges: [] };
        lineGroups.set(key, group);
      }
      group.edges.push(edge);
    }

    const meshedEdges = [];
    for (const { dir, edges } of lineGroups.values()) {
      const [dx, dy] = dir;
      const param = ([x, y]) => x * dx + y * dy;
      const points = new Map();
      for (const edge of edges) {
        for (const point of [edge.a, edge.b]) {
          points.set(pointKey(point), { point, t: param(point) });
        }
      }
      const ordered = [...points.values()].sort((m, n) => m.t - n.t);
      for (const edge of edges) {
        const ta = param(edge.a);
        const tb = param(edge.b);
        const lo = Math.min(ta, tb);
        const hi = Math.max(ta, tb);
        const interior = ordered.filter(({ t }) => t > lo && t < hi).map(({ point }) => point);
        if (ta > tb) interior.reverse();
        const chain = [edge.a, ...interior, edge.b];
        for (let i = 0; i < chain.length - 1; i += 1) {
          meshedEdges.push({ ...edge, a: chain[i], b: chain[i + 1] });
        }
      }
    }

    // ----- 3. linedefs / sidedefs / seg seeds -----
    const edgeGroups = new Map();
    for (const edge of meshedEdges) {
      vertexId(edge.a);
      vertexId(edge.b);
      const key = segmentKey(edge.a, edge.b);
      const group = edgeGroups.get(key) ?? [];
      group.push(edge);
      edgeGroups.set(key, group);
    }

    const angleFor = ([x1, y1], [x2, y2]) => {
      const radians = Math.atan2(y2 - y1, x2 - x1);
      const turns = radians < 0 ? radians / (Math.PI * 2) + 1 : radians / (Math.PI * 2);
      return Math.round(turns * 65536) & 0xffff;
    };

    const sidedefs = [];
    const linedefs = [];
    const sidedef = (sectorIndex, topTexture, bottomTexture, midTexture, textureOffset = 0) => {
      const index = sidedefs.length;
      sidedefs.push({ sectorIndex, textureOffset, topTexture, bottomTexture, midTexture });
      return index;
    };

    const sectorIndexOf = new Map(sectors.map((sector, index) => [sector, index]));

    // Every real wall side becomes a seg seed; the BSP partitions/splits these.
    const segSeeds = [];
    for (const group of edgeGroups.values()) {
      if (group.length > 2) {
        throw new Error(`More than two sectors share edge ${segmentKey(group[0].a, group[0].b)}`);
      }
      const frontEdge = decorate.chooseFrontEdge(group);
      const backEdge = group.find((edge) => edge !== frontEdge);
      const front = frontEdge.sector;
      const back = backEdge?.sector;
      const frontTextures = decorate.sideTextures(front, back, frontEdge.overrideTexture, frontEdge);
      const frontSide = sidedef(
        sectorIndexOf.get(front),
        frontTextures.top,
        frontTextures.bottom,
        frontTextures.mid,
        decorate.textureOffsetFor(frontEdge, front, back, frontEdge.overrideTexture)
      );
      const backTextures = back ? decorate.sideTextures(back, front, backEdge.overrideTexture, backEdge) : undefined;
      const backSide = back && backTextures
        ? sidedef(
          sectorIndexOf.get(back),
          backTextures.top,
          backTextures.bottom,
          backTextures.mid,
          decorate.textureOffsetFor(backEdge, back, front, backEdge.overrideTexture)
        )
        : -1;
      const { flags, special } = decorate.lineFlagsFor(front, back);

      const linedefIndex = linedefs.length;
      linedefs.push({
        v1: vertexId(frontEdge.a),
        v2: vertexId(frontEdge.b),
        flags,
        special,
        tag: decorate.lineTagFor(front, back, frontEdge.overrideTexture ?? backEdge?.overrideTexture),
        frontSide,
        backSide,
      });

      // Front side runs along the linedef (side 0); the back side runs against it
      // (side 1). The back edge is the same boundary in the neighbour's winding,
      // so its a/b are already the front edge reversed.
      segSeeds.push({ a: frontEdge.a, b: frontEdge.b, sector: front, linedef: linedefIndex, side: 0 });
      if (back) {
        segSeeds.push({ a: backEdge.a, b: backEdge.b, sector: back, linedef: linedefIndex, side: 1 });
      }
    }

    // ----- 4. general BSP node builder -----
    // Partition-line convention matches R_PointOnSide: a point P relative to a
    // partition through (px,py) with direction (dx,dy) has cross < 0 on the FRONT
    // (right) side -> child0, cross > 0 on the BACK (left) side -> child1.
    const crossOf = (px, py, dx, dy, x, y) => dx * (y - py) - dy * (x - px);

    const classify = (segs, partition) => {
      const [px, py] = partition.a;
      const dx = partition.b[0] - partition.a[0];
      const dy = partition.b[1] - partition.a[1];
      let front = 0, back = 0, splits = 0;
      for (const seg of segs) {
        const ca = crossOf(px, py, dx, dy, seg.a[0], seg.a[1]);
        const cb = crossOf(px, py, dx, dy, seg.b[0], seg.b[1]);
        if ((ca < 0 && cb > 0) || (ca > 0 && cb < 0)) {
          splits += 1;
          front += 1;
          back += 1;
        } else if (ca === 0 && cb === 0) {
          const dot = (seg.b[0] - seg.a[0]) * dx + (seg.b[1] - seg.a[1]) * dy;
          if (dot >= 0) front += 1;
          else back += 1;
        } else if (ca <= 0 && cb <= 0) {
          front += 1;
        } else {
          back += 1;
        }
      }
      return { front, back, splits };
    };

    // A seg list is a convex subsector when no partition separates it into two
    // non-empty halves; otherwise pick the lowest-cost separating partition
    // (fewest splits, then most balanced).
    const choosePartition = (segs) => {
      let best = null;
      for (const candidate of segs) {
        const { front, back, splits } = classify(segs, candidate);
        if (front === 0 || back === 0) continue;
        const cost = splits * 1000 + Math.abs(front - back);
        if (!best || cost < best.cost) best = { candidate, cost };
      }
      return best?.candidate ?? null;
    };

    const partition = (segs, P) => {
      const [px, py] = P.a;
      const dx = P.b[0] - P.a[0];
      const dy = P.b[1] - P.a[1];
      const front = [];
      const back = [];
      for (const seg of segs) {
        const ca = crossOf(px, py, dx, dy, seg.a[0], seg.a[1]);
        const cb = crossOf(px, py, dx, dy, seg.b[0], seg.b[1]);
        if ((ca < 0 && cb > 0) || (ca > 0 && cb < 0)) {
          const t = ca / (ca - cb);
          const mid = [
            Math.round(seg.a[0] + t * (seg.b[0] - seg.a[0])),
            Math.round(seg.a[1] + t * (seg.b[1] - seg.a[1])),
          ];
          // Rounding the split point onto an endpoint would yield a zero-length
          // seg; treat that as a non-split and send the whole seg to the side its
          // far end lies on (the <1u overhang past the partition is sub-pixel).
          if (mid[0] === seg.a[0] && mid[1] === seg.a[1]) {
            (cb < 0 ? front : back).push(seg);
          } else if (mid[0] === seg.b[0] && mid[1] === seg.b[1]) {
            (ca < 0 ? front : back).push(seg);
          } else {
            (ca < 0 ? front : back).push({ ...seg, a: seg.a, b: mid });
            (cb < 0 ? front : back).push({ ...seg, a: mid, b: seg.b });
          }
        } else if (ca === 0 && cb === 0) {
          const dot = (seg.b[0] - seg.a[0]) * dx + (seg.b[1] - seg.a[1]) * dy;
          (dot >= 0 ? front : back).push(seg);
        } else if (ca <= 0 && cb <= 0) {
          front.push(seg);
        } else {
          back.push(seg);
        }
      }
      return { front, back };
    };

    const segBBox = (segs) => {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const seg of segs) {
        for (const [x, y] of [seg.a, seg.b]) {
          if (x < x1) x1 = x;
          if (y < y1) y1 = y;
          if (x > x2) x2 = x;
          if (y > y2) y2 = y;
        }
      }
      return { x1, y1, x2, y2 };
    };

    const nodes = [];
    const subsectors = [];
    const segs = [];

    const emitSubsector = (segList) => {
      const sector = segList[0].sector;
      for (const seg of segList) {
        if (seg.sector !== sector) {
          throw new Error(`Subsector mixes sectors ${sector.id} and ${seg.sector.id}`);
        }
      }
      const firstSeg = segs.length;
      for (const seg of segList) segs.push(seg);
      const index = subsectors.length;
      subsectors.push({ numSegs: segList.length, firstSeg });
      return { ref: 0x8000 | index, bbox: segBBox(segList) };
    };

    const buildNode = (segList, depth) => {
      if (depth > 256) {
        throw new Error("BSP recursion exceeded depth 256 -- non-terminating partition.");
      }
      const P = choosePartition(segList);
      if (!P) {
        return emitSubsector(segList);
      }
      const { front, back } = partition(segList, P);
      if (!front.length || !back.length) {
        return emitSubsector(segList);
      }
      const child0 = buildNode(front, depth + 1); // right / front
      const child1 = buildNode(back, depth + 1); // left / back
      const index = nodes.length;
      nodes.push({
        x: P.a[0],
        y: P.a[1],
        dx: P.b[0] - P.a[0],
        dy: P.b[1] - P.a[1],
        child0,
        child1,
      });
      return {
        ref: index,
        bbox: {
          x1: Math.min(child0.bbox.x1, child1.bbox.x1),
          y1: Math.min(child0.bbox.y1, child1.bbox.y1),
          x2: Math.max(child0.bbox.x2, child1.bbox.x2),
          y2: Math.max(child0.bbox.y2, child1.bbox.y2),
        },
      };
    };

    if (segSeeds.length) {
      buildNode(segSeeds, 0);
    }

    // Register every seg endpoint (BSP splitting introduces new mid-vertices) so
    // the VERTEXES lump covers them before it is built.
    for (const seg of segs) {
      vertexId(seg.a);
      vertexId(seg.b);
    }

    const buildThings = () =>
      Buffer.concat(things.map(({ x, y, angle, type, options }) => record(i16(x), i16(y), i16(angle), i16(type), i16(options))));

    const buildVertexes = () => Buffer.concat(vertices.map(([x, y]) => record(i16(x), i16(y))));

    const buildSideDefs = () =>
      Buffer.concat(
        sidedefs.map(({ sectorIndex, textureOffset, topTexture, bottomTexture, midTexture }) =>
          record(i16(textureOffset), i16(0), ascii8(topTexture), ascii8(bottomTexture), ascii8(midTexture), i16(sectorIndex))
        )
      );

    const buildLineDefs = () =>
      Buffer.concat(
        linedefs.map(({ v1, v2, flags, special, tag, frontSide, backSide }) =>
          record(u16(v1), u16(v2), u16(flags), u16(special), u16(tag), i16(frontSide), i16(backSide))
        )
      );

    // Seg offset = distance from the linedef's starting vertex (v1 for the front
    // side, v2 for the back side) to the seg's start, so a wall split by the BSP
    // keeps its texture aligned across the split.
    const buildSegs = () =>
      Buffer.concat(
        segs.map((seg) => {
          const linedef = linedefs[seg.linedef];
          const start = vertices[seg.side === 0 ? linedef.v1 : linedef.v2];
          const offset = Math.round(Math.hypot(seg.a[0] - start[0], seg.a[1] - start[1]));
          return record(
            u16(vertexId(seg.a)),
            u16(vertexId(seg.b)),
            u16(angleFor(seg.a, seg.b)),
            u16(seg.linedef),
            u16(seg.side),
            u16(offset)
          );
        })
      );

    const buildSubsectors = () =>
      Buffer.concat(subsectors.map(({ numSegs, firstSeg }) => record(u16(numSegs), u16(firstSeg))));

    const buildSectors = () =>
      Buffer.concat(
        sectors.map(({ floor, ceiling, floorFlat, ceilingFlat, light, special, tag }) =>
          record(i16(floor), i16(ceiling), ascii8(floorFlat), ascii8(ceilingFlat), i16(light), i16(special ?? 0), i16(tag ?? 0))
        )
      );

    const bboxRecord = ({ x1, y1, x2, y2 }) => record(i16(y2), i16(y1), i16(x1), i16(x2));

    const buildNodes = () =>
      Buffer.concat(
        nodes.map(({ x, y, dx, dy, child0, child1 }) =>
          record(i16(x), i16(y), i16(dx), i16(dy), bboxRecord(child0.bbox), bboxRecord(child1.bbox), u16(child0.ref), u16(child1.ref))
        )
      );

    const buildReject = () => Buffer.alloc(Math.ceil((sectors.length * sectors.length) / 8));

    const buildBlockMap = () => {
      const minX = Math.min(...vertices.map(([x]) => x));
      const minY = Math.min(...vertices.map(([, y]) => y));
      const maxX = Math.max(...vertices.map(([x]) => x));
      const maxY = Math.max(...vertices.map(([, y]) => y));
      const originX = minX - 8;
      const originY = minY - 8;
      const width = Math.ceil((maxX - originX + 1) / 128);
      const height = Math.ceil((maxY - originY + 1) / 128);
      const blockCount = width * height;
      const sharedListOffset = 4 + blockCount;
      const offsets = Buffer.concat(Array.from({ length: blockCount }, () => u16(sharedListOffset)));
      const allLines = Buffer.concat([...linedefs.map((_, index) => u16(index)), i16(-1)]);
      return record(i16(originX), i16(originY), i16(width), i16(height), offsets, allLines);
    };

    return {
      things: buildThings(),
      linedefs: buildLineDefs(),
      sidedefs: buildSideDefs(),
      vertexes: buildVertexes(),
      segs: buildSegs(),
      subsectors: buildSubsectors(),
      nodes: buildNodes(),
      sectors: buildSectors(),
      reject: buildReject(),
      blockmap: buildBlockMap(),
    };
  };

  return { addThing, addRect, areaRect, addPoly, areaPoly, addAreaThing, compile };
};
