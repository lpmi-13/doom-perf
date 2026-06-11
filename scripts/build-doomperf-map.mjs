import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lump, i16, i32, ascii8, record, buildWad } from "./lib/wad-bytes.mjs";
import {
  labelTextureSize,
  terminalTextureSize,
  buildLabelPatch,
  FLAT_DIM,
} from "./lib/textures.mjs";
import { createMapBuilder } from "./lib/map-builder.mjs";
import { controlPanelTexture } from "./lib/wings/registry.mjs";
import { cpuWing } from "./lib/wings/cpu-wing.mjs";
import { memoryWing } from "./lib/wings/memory-wing.mjs";
import { storageWing } from "./lib/wings/storage-wing.mjs";
import { networkWing } from "./lib/wings/network-wing.mjs";

const outputPath = fileURLToPath(new URL("../public/maps/doomperf-lab.wad", import.meta.url));
const baseIwadPath = fileURLToPath(new URL("../public/wads/freedoom1.wad", import.meta.url));

const lineFlags = {
  blocking: 1,
  twoSided: 4,
  lowerUnpegged: 16,
};

const hubRadius = 384;
const terminalPanelDepth = 16;
const terminalPanelFloor = 32;
const doorWidth = 192;

// Per-resource base tags and the door/label palette below are shared by all
// wings. Each wing's own room bounds, instrument tags, terminal/sign/sprite
// definitions, and reserved IDs now live in its module under scripts/lib/wings/;
// reserved tag ranges, light sentinels, and WAD name prefixes are partitioned in
// scripts/lib/wings/registry.mjs so parallel wing work cannot silently collide.
//
// Linedef tags reserve stable room markers for engine-side telemetry visuals.
const resourceConfigs = {
  cpu: {
    label: "CPU",
    tag: 100,
    labelTexture: "DPCPU",
    labelPatch: "DPLCPU",
    labelColor: 176,
    wall: "COMPTILE",
    accent: "METAL1",
    floor: "FLOOR4_8",
    ceiling: "CEIL3_5",
  },
  memory: {
    label: "MEMORY",
    tag: 200,
    labelTexture: "DPMEM",
    labelPatch: "DPLMEM",
    labelColor: 112,
    wall: "TEKWALL4",
    accent: "BROWNGRN",
    floor: "FLOOR5_1",
    ceiling: "CEIL5_1",
  },
  storage: {
    label: "DISK",
    tag: 300,
    labelTexture: "DPDISK",
    labelPatch: "DPLDSK",
    labelColor: 231,
    wall: "STONE2",
    accent: "BROWNHUG",
    floor: "FLOOR0_3",
    ceiling: "CEIL3_2",
  },
  network: {
    label: "NETWORK",
    tag: 400,
    labelTexture: "DPNET",
    labelPatch: "DPLNET",
    labelColor: 200,
    wall: "TEKWALL1",
    accent: "COMPSPAN",
    floor: "FLOOR1_1",
    ceiling: "CEIL4_3",
  },
};

const directions = ["north", "east", "south", "west"];
const directionResource = {
  north: "cpu",
  east: "memory",
  south: "storage",
  west: "network",
};
const outwardSide = {
  north: "top",
  east: "right",
  south: "bottom",
  west: "left",
};

// The geometry builder owns the sectors/things state and the WAD compile
// pipeline; we destructure its construction API so the layout code below reads
// the same as before (areaRect/addAreaThing/addThing), then call compile() near
// the end (with the map-specific texturing) to emit the binary map lumps.
const { addThing, addRect, areaRect, addAreaThing, compile } = createMapBuilder();

addRect("atrium", { x1: -hubRadius, y1: -hubRadius, x2: hubRadius, y2: hubRadius }, {
  kind: "hub",
  floorFlat: "FLOOR4_8",
  ceilingFlat: "CEIL3_5",
  wall: "STARTAN3",
  light: 224,
});


// The four self-registering wing descriptors. `wings` order fixes the order in
// which their textures/flats/sprites/terminals are collected into the WAD and
// manifest below; geometry is laid out per direction (north=cpu .. west=network)
// by addResourceArea. Each wing owns its own module under scripts/lib/wings/.
const wings = [cpuWing, memoryWing, storageWing, networkWing];
const wingByResource = Object.fromEntries(wings.map((wing) => [wing.resource, wing]));

// Per-direction dispatch into the wing builder modules. We compute the base/
// accent palette and hand the wing a context with only the SHARED builder API
// and shared layout constants; everything wing-specific lives in the wing module.
// This is the parallel-work seam from PARALLEL_WINGS_PLAN.md.
const addResourceArea = (direction) => {
  const resource = directionResource[direction];
  const config = resourceConfigs[resource];
  const base = {
    resource,
    wall: config.wall,
    floorFlat: config.floor,
    ceilingFlat: config.ceiling,
  };
  const accent = { ...base, wall: config.accent };
  wingByResource[resource].build({
    direction,
    resource,
    config,
    base,
    accent,
    areaRect,
    addAreaThing,
    hubRadius,
    doorWidth,
    terminalPanelDepth,
    terminalPanelFloor,
    outwardSide,
  });
};

directions.forEach(addResourceArea);


const isDoorPair = (first, second) =>
  Boolean(first && second && (first.kind === "door" || second.kind === "door"));

const doorTextureFor = (first, second) =>
  first.kind === "door" ? first.labelTexture : second.labelTexture;

const chooseFrontEdge = (edges) => {
  if (edges.length !== 2) {
    return edges[0];
  }
  const nonDoor = edges.find((edge) => edge.sector.kind !== "door");
  return nonDoor ?? edges[0];
};

const lineTagFor = (front, back, overrideTexture) => {
  if (overrideTexture || isDoorPair(front, back) || front.kind === "outside" || back?.kind === "outside") {
    return 0;
  }
  if (front.lineTag !== undefined) return front.lineTag;
  if (back?.lineTag !== undefined) return back.lineTag;
  const resource = front.resource ?? back?.resource;
  return resource ? resourceConfigs[resource].tag : 0;
};

// A placard's name belongs only on its long faces; the narrow end risers get
// plain metal. The long faces run along the block's wider axis.
const edgeIsLongFace = (edge, sign) => {
  const horizontal = edge.a[1] === edge.b[1];
  const wideX = (sign.x2 - sign.x1) >= (sign.y2 - sign.y1);
  return horizontal === wideX;
};

const sideTextures = (sector, other, overrideTexture, edge) => {
  if (!other) {
    return {
      top: "-",
      bottom: "-",
      mid: overrideTexture ?? sector.wall,
    };
  }
  if (isDoorPair(sector, other)) {
    // The resource word goes only on the outside (hub-facing) door face; the
    // inside gets a plain wall so it isn't left untextured.
    const room = sector.kind === "door" ? other : sector;
    return {
      top: room && room.kind === "hub" ? doorTextureFor(sector, other) : (room ? "BIGDOOR2" : "-"),
      bottom: "-",
      mid: "-",
    };
  }
  const floorStep = sector.floor !== other.floor;
  // A top texture seals the gap above the lower-ceiling sector. Suppress it only
  // when the *neighbour* is sky (so a window/ledge under a higher sky ceiling
  // bleeds sky as intended); a sky sector meeting a LOWER solid ceiling -- the
  // open core courtyard above the terminal recess, the entrance, the side
  // passages -- still needs a real wall, not a sky-bleed gap.
  const ceilingStep = sector.ceiling !== other.ceiling && other.ceilingFlat !== "F_SKY1";
  let bottom = "-";
  if (floorStep) {
    if (other.kind === "sign") bottom = edge && edgeIsLongFace(edge, other) ? other.labelTexture : other.wall;
    else if (sector.kind === "sign") bottom = edge && edgeIsLongFace(edge, sector) ? sector.labelTexture : sector.wall;
    else if (other.kind === "core-column" || other.kind === "load-gauge") bottom = other.wall;
    else if (sector.kind === "core-column" || sector.kind === "load-gauge") bottom = sector.wall;
    // The step up into a wall-terminal recess (the wall just below the screen)
    // gets a keyboard/control panel rather than a plain step riser.
    else if (other.labelSide === "top" && other.labelTexture) bottom = controlPanelTexture;
    else if (sector.kind === "outside" || other.kind === "outside") bottom = "STONE2";
    else bottom = "STEP1";
  }
  return {
    top: ceilingStep ? sector.wall : "-",
    bottom,
    mid: "-",
  };
};

// Door label offset: the label texture is wider than the door and the door
// edge is split into segments by global grid cuts. Centre one word across the
// whole door by giving each segment a continuous offset measured from the
// door's reading-start corner (the segment direction already matches the
// viewer's left-to-right for each wing), instead of re-centering every segment.
const doorTextureOffsetFor = (edge, sector, other) => {
  if (!isDoorPair(sector, other)) return 0;
  const door = sector.kind === "door" ? sector : other;
  const texW = labelTextureSize.width;
  const horizontal = edge.a[1] === edge.b[1];
  if (horizontal) {
    const pad = (texW - (door.x2 - door.x1)) / 2;
    const dist = edge.b[0] >= edge.a[0] ? edge.a[0] - door.x1 : door.x2 - edge.a[0];
    return Math.floor(pad + dist);
  }
  const pad = (texW - (door.y2 - door.y1)) / 2;
  const dist = edge.b[1] >= edge.a[1] ? edge.a[1] - door.y1 : door.y2 - edge.a[1];
  return Math.floor(pad + dist);
};

const overrideTextureOffsetFor = (edge, sector) => {
  const texW = labelTextureSize.width;
  const horizontal = edge.a[1] === edge.b[1];
  if (horizontal) {
    const pad = Math.max(0, (texW - (sector.x2 - sector.x1)) / 2);
    const dist = edge.b[0] >= edge.a[0] ? edge.a[0] - sector.x1 : sector.x2 - edge.a[0];
    return Math.floor(pad + dist);
  }
  const pad = Math.max(0, (texW - (sector.y2 - sector.y1)) / 2);
  const dist = edge.b[1] >= edge.a[1] ? edge.a[1] - sector.y1 : sector.y2 - edge.a[1];
  return Math.floor(pad + dist);
};

// Distance of this segment's start from the wall's start, so a tiling texture
// continues seamlessly across grid-cut segments instead of restarting at each.
const flowOffsetFor = (edge, sector) => {
  const horizontal = edge.a[1] === edge.b[1];
  if (horizontal) return Math.floor(edge.b[0] >= edge.a[0] ? edge.a[0] - sector.x1 : sector.x2 - edge.a[0]);
  return Math.floor(edge.b[1] >= edge.a[1] ? edge.a[1] - sector.y1 : sector.y2 - edge.a[1]);
};

const textureOffsetFor = (edge, sector, other, overrideTexture) => {
  if (isDoorPair(sector, other)) return doorTextureOffsetFor(edge, sector, other);
  if (sector.kind === "sign") return edgeIsLongFace(edge, sector) ? overrideTextureOffsetFor(edge, sector) : 0;
  if (other && other.kind === "sign") return edgeIsLongFace(edge, other) ? overrideTextureOffsetFor(edge, other) : 0;
  // Terminal control-panel riser: flow the tiling panel across its cut segments.
  if (other && other.labelSide === "top" && other.labelTexture && sector.floor < other.floor) return flowOffsetFor(edge, sector);
  if (overrideTexture) return overrideTextureOffsetFor(edge, sector);
  return 0;
};

const WAD_HEADER_SIZE = 12;
const WAD_DIRECTORY_ENTRY_SIZE = 16;

const wadLumpName = (wadBytes, offset) =>
  wadBytes.subarray(offset, offset + 8).toString("ascii").replace(/\0.*$/, "").trim();

const readWadDirectory = (wadBytes, sourcePath = baseIwadPath) => {
  if (wadBytes.length < WAD_HEADER_SIZE) {
    throw new Error(`${sourcePath} is too small to be a WAD.`);
  }

  const identification = wadBytes.subarray(0, 4).toString("ascii");
  if (identification !== "IWAD" && identification !== "PWAD") {
    throw new Error(`${sourcePath} has unsupported WAD type ${identification}.`);
  }

  const numLumps = wadBytes.readInt32LE(4);
  const directoryOffset = wadBytes.readInt32LE(8);
  if (numLumps < 0) {
    throw new Error(`${sourcePath} has an invalid negative lump count.`);
  }
  if (directoryOffset < 0) {
    throw new Error(`${sourcePath} has an invalid negative directory offset.`);
  }

  const directorySize = numLumps * WAD_DIRECTORY_ENTRY_SIZE;
  if (directoryOffset > wadBytes.length - directorySize) {
    throw new Error(`${sourcePath} WAD directory exceeds file length.`);
  }

  const entries = [];
  for (let index = 0; index < numLumps; index += 1) {
    const entryOffset = directoryOffset + index * WAD_DIRECTORY_ENTRY_SIZE;
    const offset = wadBytes.readInt32LE(entryOffset);
    const size = wadBytes.readInt32LE(entryOffset + 4);
    const name = wadLumpName(wadBytes, entryOffset + 8);

    if (offset < 0 || size < 0 || offset > wadBytes.length - size) {
      throw new Error(`${sourcePath} has invalid lump bounds for ${name || `entry ${index}`}.`);
    }

    entries.push({ name, offset, size });
  }

  return entries;
};

const readWadLump = (wadBytes, lumpName, sourcePath = baseIwadPath) => {
  const entry = readWadDirectory(wadBytes, sourcePath).find((candidate) => candidate.name === lumpName);
  if (!entry) {
    throw new Error(`Missing ${lumpName} in ${sourcePath}`);
  }
  return Buffer.from(wadBytes.subarray(entry.offset, entry.offset + entry.size));
};

// ===== Floor name inscriptions (custom flats) =====
// Doom can only add floor flats by re-bundling every stock flat into the map's
// own F_START..F_END (R_InitFlats keys off the last F_START/F_END markers), so
// we copy the IWAD flats and append our generated text flats. FLAT_DIM and the
// inscription generator (makeInscription) now live in lib/textures.mjs so any
// wing can name its own floor; this file only bundles the IWAD flats here.
const readIwadFlats = () => {
  const wad = readFileSync(baseIwadPath);
  const entries = readWadDirectory(wad, baseIwadPath);
  const start = entries.findIndex((x) => x.name === "F_START");
  const end = entries.findIndex((x) => x.name === "F_END");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${baseIwadPath} is missing a valid F_START..F_END flat range.`);
  }

  return entries.slice(start + 1, end).map(({ name, offset, size }) => {
    if (size !== 0 && size !== FLAT_DIM * FLAT_DIM) {
      throw new Error(`${baseIwadPath} flat ${name} has invalid size ${size}.`);
    }
    return lump(name, Buffer.from(wad.subarray(offset, offset + size)));
  });
};

const iwadFlats = readIwadFlats();
// Custom floor-name flats contributed by the wings (CPU's CPU CORES / RUN QUEUE /
// LOAD inscriptions today), appended to the map's flat range below.
const inscriptionFlats = wings.flatMap((wing) => wing.flats ?? []);

const basePNames = readWadLump(readFileSync(baseIwadPath), "PNAMES");
const basePatchCount = basePNames.readInt32LE(0);
const labelConfigs = Object.values(resourceConfigs);
// The four shared door/label textures (one per wing) plus each wing's own
// texture contributions, in `wings` order. Adding a texture is a single-file
// edit in the owning wing module — nothing here changes.
const textureConfigs = [
  ...labelConfigs.map(({ label, labelTexture, labelPatch, labelColor }) => ({
    texture: labelTexture,
    patch: labelPatch,
    build: () => buildLabelPatch(label, labelColor, doorWidth),
  })),
  ...wings.flatMap((wing) => wing.textures ?? []),
];

const buildPNames = () =>
  record(
    i32(basePatchCount + textureConfigs.length),
    basePNames.subarray(4),
    ...textureConfigs.map(({ patch }) => ascii8(patch))
  );

const buildTextureDefinition = ({ texture, width = labelTextureSize.width, height = labelTextureSize.height }, patchIndex) =>
  record(
    ascii8(texture),
    i32(0),
    i16(width),
    i16(height),
    i32(0),
    i16(1),
    i16(0),
    i16(0),
    i16(patchIndex),
    i16(1),
    i16(0)
  );

const buildTexture2 = () => {
  const definitions = textureConfigs.map((config, index) =>
    buildTextureDefinition(config, basePatchCount + index)
  );
  let offset = 4 + definitions.length * 4;
  const offsets = definitions.map((definition) => {
    const current = offset;
    offset += definition.length;
    return i32(current);
  });
  return record(i32(definitions.length), ...offsets, ...definitions);
};

// Per-line flags: two-sided where there's a back sector, blocking otherwise; an
// outside edge also blocks and lower-unpegs; a door pair lower-unpegs and gets
// the DR-door special. Passed to compile() so the builder stays map-agnostic.
const lineFlagsFor = (front, back) => {
  let flags = back ? lineFlags.twoSided : lineFlags.blocking;
  let special = 0;
  if (back && (front.kind === "outside" || back.kind === "outside")) {
    flags |= lineFlags.blocking | lineFlags.lowerUnpegged;
  }
  if (back && isDoorPair(front, back)) {
    flags |= lineFlags.lowerUnpegged;
    special = 1;
  }
  return { flags, special };
};

const map = compile({
  chooseFrontEdge,
  sideTextures,
  textureOffsetFor,
  lineFlagsFor,
  lineTagFor,
});

const mapLumps = [
  lump("PNAMES", buildPNames()),
  ...textureConfigs.map(({ patch, build }) => lump(patch, build())),
  lump("TEXTURE2", buildTexture2()),
  // Sprite replacements contributed by the wings (CPU's run-queue + I/O-wait orbs
  // today): each PWAD-replaces an unused IWAD item sprite by name, resolved via
  // modifiedgame + W_GetNumForName.
  ...wings.flatMap((wing) => wing.sprites ?? []).map(({ name, build }) => lump(name, build())),
  lump("F_START"),
  ...iwadFlats,
  ...inscriptionFlats,
  lump("F_END"),
  lump("E1M1"),
  lump("THINGS", map.things),
  lump("LINEDEFS", map.linedefs),
  lump("SIDEDEFS", map.sidedefs),
  lump("VERTEXES", map.vertexes),
  lump("SEGS", map.segs),
  lump("SSECTORS", map.subsectors),
  lump("NODES", map.nodes),
  lump("SECTORS", map.sectors),
  lump("REJECT", map.reject),
  lump("BLOCKMAP", map.blockmap),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buildWad(mapLumps));
console.log(`Wrote ${outputPath}`);

// Emit the interaction manifest the browser UI consumes (terminal read-points
// and hub-door probes), derived from the same constants that lay out the map.
// This is the single source of truth for those coordinates: src/index.ts reads
// this file instead of re-hardcoding values that silently drift when the map
// layout changes (e.g. when a terminal moves to a new back wall).
const doorOuterRadius = 448;   // a hub door sector spans hubRadius..doorOuterRadius
const roomCenterU = (room) => (room.u1 + room.u2) / 2;
const doorProbeRadius = hubRadius + (doorOuterRadius - hubRadius) / 2;
// Each interactable is described by one or more trigger *segments* — the
// object's actual interactable face/line(s) — rather than a single centre point,
// so the browser UI can offer the prompt anywhere along the object (including
// its edges) by measuring the player's distance to a segment instead of to its
// midpoint. Crucially a segment sits ON the object's face (a terminal's screen
// wall, a door's trigger line), so the prompt's range (useRange) is measured
// straight from the screen/door — the player must be within useRange of the
// actual object, not of a point standing out in front of it. A terminal's
// screen spans the panel's full width (terminalTextureSize.width); a door's
// trigger lines span doorWidth on the axis the door faces. Half-widths:
const terminalHalfWidth = terminalTextureSize.width / 2;
const doorHalfWidth = doorWidth / 2;
// Terminal read segment: the screen face itself, on the room's back wall (v2),
// running terminalHalfWidth either side of the room centre (all CPU/north-wing
// screens are on a back wall, so the face is x-axis).
const terminalSegment = (room) => {
  const cx = roomCenterU(room);
  const y = room.v2;
  return { ax: cx - terminalHalfWidth, ay: y, bx: cx + terminalHalfWidth, by: y };
};
// A hub door's two trigger lines. Both lines bounding the door sector are DR
// doors (special 1) — the inner line at hubRadius (entered from the hub) and the
// outer line at doorOuterRadius (entered from inside the wing) — so USE/space
// opens the door from either side. We surface the prompt for whichever line the
// player is near, so leaving a wing prompts just like entering it does. `dir` is
// the cardinal the door faces; the line spans doorHalfWidth on the cross axis.
const doorSegments = (dir) => {
  const line = (radius) => {
    switch (dir) {
      case "north":
        return { ax: -doorHalfWidth, ay: radius, bx: doorHalfWidth, by: radius };
      case "south":
        return { ax: -doorHalfWidth, ay: -radius, bx: doorHalfWidth, by: -radius };
      case "east":
        return { ax: radius, ay: -doorHalfWidth, bx: radius, by: doorHalfWidth };
      case "west":
        return { ax: -radius, ay: -doorHalfWidth, bx: -radius, by: doorHalfWidth };
      default:
        throw new Error(`Unknown door direction: ${dir}`);
    }
  };
  return [line(hubRadius), line(doorOuterRadius)];
};
const mapManifest = {
  useRange: 64,          // engine USERANGE (linuxdoom p_local.h) — USE trace reach
  doorOpenThreshold: 16, // ceiling lift past which a DR door reads as already open
  // Terminal read-points contributed by each wing (CPU's cores/runqueue/load
  // today). A wing's terminals(api) closure builds its screen-face segments from
  // the shared helpers below; the player reads one from anywhere within useRange
  // of its screen face.
  terminals: wings.flatMap((wing) =>
    wing.terminals ? wing.terminals({ terminalSegment, terminalHalfWidth }) : []
  ),
  // Four hub doors, one per cardinal exit. Each has two trigger segments (the
  // inner line at hubRadius and the outer line at doorOuterRadius), so the
  // prompt shows whether the player approaches from the hub or from inside the
  // wing. The probe point sits at the centre of the door sector between them and
  // reports that sector's live ceiling opening (shut vs. already open).
  doors: [
    { segments: doorSegments("north"), probeX: 0, probeY: doorProbeRadius },
    { segments: doorSegments("east"), probeX: doorProbeRadius, probeY: 0 },
    { segments: doorSegments("south"), probeX: 0, probeY: -doorProbeRadius },
    { segments: doorSegments("west"), probeX: -doorProbeRadius, probeY: 0 },
  ],
};
const manifestPath = fileURLToPath(new URL("../src/doomperf-map-manifest.ts", import.meta.url));
writeFileSync(
  manifestPath,
  "// GENERATED by scripts/build-doomperf-map.mjs — do not edit by hand.\n" +
    "// Map interaction geometry shared with the browser UI (src/index.ts).\n" +
    `export const mapManifest = ${JSON.stringify(mapManifest, null, 2)} as const;\n`
);
console.log(`Wrote ${manifestPath}`);
