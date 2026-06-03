// Low-level WAD byte primitives: pure helpers that turn values into the
// little-endian buffers Doom lumps expect, plus single-patch encoding and the
// final WAD container. None of these depend on the map's layout state, so they
// are shared verbatim by the map builder (and split out to keep it focused).

export const lump = (name, data = Buffer.alloc(0)) => ({ name, data });

export const i16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16LE(value);
  return buffer;
};

export const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

export const i32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
};

export const ascii8 = (value) => {
  if (value.length > 8) {
    throw new Error(`Doom lump field exceeds 8 bytes: ${value}`);
  }
  const buffer = Buffer.alloc(8);
  buffer.write(value, "ascii");
  return buffer;
};

export const record = (...parts) => Buffer.concat(parts);

export const buildPatch = (pixels, width, height, {
  leftOffset = 0,
  topOffset = 0,
  transparent,
} = {}) => {
  const headerSize = 8 + width * 4;
  const columns = [];
  let offset = headerSize;
  const header = record(i16(width), i16(height), i16(leftOffset), i16(topOffset));
  const offsets = Buffer.alloc(width * 4);
  for (let x = 0; x < width; x += 1) {
    offsets.writeInt32LE(offset, x * 4);
    const posts = [];
    let y = 0;
    while (y < height) {
      while (y < height && pixels[y * width + x] === transparent) {
        y += 1;
      }
      if (y >= height) {
        break;
      }
      const top = y;
      const columnPixels = [];
      while (y < height && pixels[y * width + x] !== transparent && columnPixels.length < 254) {
        columnPixels.push(pixels[y * width + x]);
        y += 1;
      }
      posts.push(record(
        Buffer.from([top, columnPixels.length, 0]),
        Buffer.from(columnPixels),
        Buffer.from([0])
      ));
    }
    const column = record(...posts, Buffer.from([255]));
    columns.push(column);
    offset += column.length;
  }
  return record(header, offsets, ...columns);
};

export const buildWad = (lumps) => {
  let fileOffset = 12;
  const directory = [];
  const body = Buffer.concat(
    lumps.map(({ name, data }) => {
      directory.push({ name, offset: fileOffset, size: data.length });
      fileOffset += data.length;
      return data;
    })
  );
  const directoryOffset = 12 + body.length;
  const header = Buffer.alloc(12);
  header.write("PWAD", 0, "ascii");
  header.writeInt32LE(lumps.length, 4);
  header.writeInt32LE(directoryOffset, 8);
  const directoryBuffer = Buffer.concat(
    directory.map(({ name, offset, size }) => {
      const entry = Buffer.alloc(16);
      entry.writeInt32LE(offset, 0);
      entry.writeInt32LE(size, 4);
      ascii8(name).copy(entry, 8);
      return entry;
    })
  );
  return record(header, body, directoryBuffer);
};
