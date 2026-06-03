// The map geometry builder: owns the mutable layout state (sectors + things)
// and turns it into the binary WAD map lumps. The construction API (addRect /
// areaRect / addThing / addAreaThing) is generic -- it knows nothing about CPU
// rooms or textures -- and `compile` runs the full vertex/edge/BSP/blockmap
// pipeline, asking a caller-supplied `decorate` for the map-specific per-line
// texturing, flags, and tags. That keeps the engine here and the map's
// aesthetic decisions in the map script.

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

  const addRect = (id, bounds, options) => {
    const sector = {
      id,
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
      ...bounds,
      ...options,
    };

    if (sector.x1 >= sector.x2 || sector.y1 >= sector.y2) {
      throw new Error(`Sector ${id} has invalid bounds.`);
    }
    for (const other of sectors) {
      const overlapX = Math.min(sector.x2, other.x2) - Math.max(sector.x1, other.x1);
      const overlapY = Math.min(sector.y2, other.y2) - Math.max(sector.y1, other.y1);
      if (overlapX > 0 && overlapY > 0) {
        throw new Error(`Sectors overlap: ${id} and ${other.id}`);
      }
    }
    sectors.push(sector);
    return sector;
  };

  const areaRect = (direction, id, localBounds, options) =>
    addRect(`${direction}-${id}`, rotateBounds(localBounds, direction), options);

  // Derive every WAD map lump from the accumulated sectors/things. `decorate`
  // supplies the map-specific per-edge decisions:
  //   chooseFrontEdge(group)                       -> the edge whose sector is the front
  //   sideTextures(sector, other, override, edge)  -> { top, bottom, mid }
  //   textureOffsetFor(edge, sector, other, override) -> x offset
  //   lineFlagsFor(front, back)                    -> { flags, special }
  //   lineTagFor(front, back, overrideTexture)     -> sector tag
  const compile = (decorate) => {
    const xCuts = [...new Set(sectors.flatMap(({ x1, x2 }) => [x1, x2]))].sort((a, b) => a - b);
    const yCuts = [...new Set(sectors.flatMap(({ y1, y2 }) => [y1, y2]))].sort((a, b) => a - b);
    const cutsBetween = (cuts, start, end) => cuts.filter((cut) => cut > start && cut < end);

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

    const splitEdge = (sector, side) => {
      const points = [];
      switch (side) {
        case "top":
          points.push([sector.x1, sector.y2]);
          cutsBetween(xCuts, sector.x1, sector.x2).forEach((x) => points.push([x, sector.y2]));
          points.push([sector.x2, sector.y2]);
          break;
        case "right":
          points.push([sector.x2, sector.y2]);
          cutsBetween(yCuts, sector.y1, sector.y2).reverse().forEach((y) => points.push([sector.x2, y]));
          points.push([sector.x2, sector.y1]);
          break;
        case "bottom":
          points.push([sector.x2, sector.y1]);
          cutsBetween(xCuts, sector.x1, sector.x2).reverse().forEach((x) => points.push([x, sector.y1]));
          points.push([sector.x1, sector.y1]);
          break;
        case "left":
          points.push([sector.x1, sector.y1]);
          cutsBetween(yCuts, sector.y1, sector.y2).forEach((y) => points.push([sector.x1, y]));
          points.push([sector.x1, sector.y2]);
          break;
        default:
          throw new Error(`Unknown sector side: ${side}`);
      }
      return points.slice(0, -1).map((point, index) => ({
        a: point,
        b: points[index + 1],
        sector,
        side,
        overrideTexture: sector.labelSide === side ? sector.labelTexture : undefined,
      }));
    };

    const segmentKey = (a, b) => {
      const first = pointKey(a);
      const second = pointKey(b);
      return first < second ? `${first}:${second}` : `${second}:${first}`;
    };

    const edgeGroups = new Map();
    for (const sector of sectors) {
      sector.edges = ["top", "right", "bottom", "left"].flatMap((side) => splitEdge(sector, side));
      for (const edge of sector.edges) {
        vertexId(edge.a);
        vertexId(edge.b);
        const key = segmentKey(edge.a, edge.b);
        const group = edgeGroups.get(key) ?? [];
        group.push(edge);
        edgeGroups.set(key, group);
      }
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
      sidedefs.push({
        sectorIndex,
        textureOffset,
        topTexture,
        bottomTexture,
        midTexture,
      });
      return index;
    };

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
        sectors.indexOf(front),
        frontTextures.top,
        frontTextures.bottom,
        frontTextures.mid,
        decorate.textureOffsetFor(frontEdge, front, back, frontEdge.overrideTexture)
      );
      const backTextures = back ? decorate.sideTextures(back, front, backEdge.overrideTexture, backEdge) : undefined;
      const backSide = back && backTextures
        ? sidedef(
          sectors.indexOf(back),
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
      frontEdge.linedef = linedefIndex;
      frontEdge.linedefSide = 0;
      if (backEdge) {
        backEdge.linedef = linedefIndex;
        backEdge.linedefSide = 1;
      }
    }

    const segs = [];
    const subsectors = [];
    for (const sector of sectors) {
      const firstSeg = segs.length;
      for (const edge of sector.edges) {
        segs.push({
          v1: vertexId(edge.a),
          v2: vertexId(edge.b),
          angle: angleFor(edge.a, edge.b),
          linedef: edge.linedef,
          side: edge.linedefSide,
        });
      }
      subsectors.push({
        numSegs: segs.length - firstSeg,
        firstSeg,
      });
    }

    const bboxFor = (indices) => ({
      x1: Math.min(...indices.map((index) => sectors[index].x1)),
      y1: Math.min(...indices.map((index) => sectors[index].y1)),
      x2: Math.max(...indices.map((index) => sectors[index].x2)),
      y2: Math.max(...indices.map((index) => sectors[index].y2)),
    });

    const splitCandidatesFor = (indices) => {
      const candidates = [];
      for (const coordinate of xCuts) {
        const west = [];
        const east = [];
        let straddled = false;
        for (const index of indices) {
          const sector = sectors[index];
          if (sector.x2 <= coordinate) {
            west.push(index);
          } else if (sector.x1 >= coordinate) {
            east.push(index);
          } else {
            straddled = true;
            break;
          }
        }
        if (!straddled && west.length && east.length) {
          candidates.push({ axis: "x", coordinate, child0: east, child1: west });
        }
      }
      for (const coordinate of yCuts) {
        const south = [];
        const north = [];
        let straddled = false;
        for (const index of indices) {
          const sector = sectors[index];
          if (sector.y2 <= coordinate) {
            south.push(index);
          } else if (sector.y1 >= coordinate) {
            north.push(index);
          } else {
            straddled = true;
            break;
          }
        }
        if (!straddled && south.length && north.length) {
          candidates.push({ axis: "y", coordinate, child0: south, child1: north });
        }
      }
      return candidates.sort((first, second) => {
        const firstBalance = Math.abs(first.child0.length - first.child1.length);
        const secondBalance = Math.abs(second.child0.length - second.child1.length);
        return firstBalance - secondBalance;
      });
    };

    const nodes = [];
    const bspFor = (indices) => {
      const bbox = bboxFor(indices);
      if (indices.length === 1) {
        return {
          ref: 0x8000 | indices[0],
          bbox,
        };
      }
      const split = splitCandidatesFor(indices)[0];
      if (!split) {
        throw new Error(`Cannot split BSP group: ${indices.map((index) => sectors[index].id).join(", ")}`);
      }
      const child0 = bspFor(split.child0);
      const child1 = bspFor(split.child1);
      const index = nodes.length;
      const lineBox = bboxFor(indices);
      nodes.push({
        axis: split.axis,
        coordinate: split.coordinate,
        bounds: lineBox,
        child0,
        child1,
      });
      return {
        ref: index,
        bbox,
      };
    };

    bspFor(sectors.map((_, index) => index));

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

    const buildSegs = () =>
      Buffer.concat(
        segs.map(({ v1, v2, angle, linedef, side }) =>
          record(u16(v1), u16(v2), u16(angle), u16(linedef), u16(side), u16(0))
        )
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
        nodes.map(({ axis, coordinate, bounds, child0, child1 }) => {
          const partition = axis === "x"
            ? record(i16(coordinate), i16(bounds.y1), i16(0), i16(bounds.y2 - bounds.y1))
            : record(i16(bounds.x1), i16(coordinate), i16(bounds.x2 - bounds.x1), i16(0));
          return record(partition, bboxRecord(child0.bbox), bboxRecord(child1.bbox), u16(child0.ref), u16(child1.ref));
        })
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

  return { addThing, addRect, areaRect, addAreaThing, compile };
};
