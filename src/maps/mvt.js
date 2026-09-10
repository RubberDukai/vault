'use strict';
/**
 * Mapbox Vector Tile decoder.
 *
 * A vector tile is protobuf-encoded geometry. Rather than pull in a protobuf
 * library we decode the small subset the MVT schema actually uses — which keeps
 * the whole map stack dependency-free and readable.
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

const GEOMETRY_TYPES = { 0: 'unknown', 1: 'point', 2: 'line', 3: 'polygon' };

const CMD_MOVE_TO = 1;
const CMD_LINE_TO = 2;
const CMD_CLOSE_PATH = 7;

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
  }

  get done() {
    return this.pos >= this.buf.length;
  }

  varint() {
    let result = 0;
    let shift = 1;
    let byte;
    do {
      byte = this.buf[this.pos++];
      result += (byte & 0x7f) * shift;
      shift *= 128;
    } while (byte >= 0x80);
    return result;
  }

  /** Field tag: the field number and wire type packed into one varint. */
  tag() {
    const value = this.varint();
    return { field: value >> 3, wireType: value & 0x07 };
  }

  bytes() {
    const length = this.varint();
    const slice = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  string() {
    return this.bytes().toString('utf8');
  }

  double() {
    const value = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return value;
  }

  float() {
    const value = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return value;
  }

  /** Skip a field we do not care about, whatever its wire type. */
  skip(wireType) {
    switch (wireType) {
      case 0: this.varint(); break;
      case 1: this.pos += 8; break;
      case 2: this.pos += this.varint(); break;
      case 5: this.pos += 4; break;
      default: throw new Error(`Unknown protobuf wire type ${wireType}`);
    }
  }
}

/** Zigzag: protobuf's way of encoding signed numbers efficiently. */
function zigzag(n) {
  return (n >> 1) ^ -(n & 1);
}

function readValue(buffer) {
  const reader = new Reader(buffer);
  while (!reader.done) {
    const { field, wireType } = reader.tag();
    switch (field) {
      case 1: return reader.string();
      case 2: return reader.float();
      case 3: return reader.double();
      case 4: return reader.varint();                 // int64
      case 5: return reader.varint();                 // uint64
      case 6: return zigzag(reader.varint());         // sint64
      case 7: return reader.varint() !== 0;           // bool
      default: reader.skip(wireType);
    }
  }
  return null;
}

/**
 * Decode the geometry command stream into rings of points, normalised to a
 * 0..1 range so the client can scale them to whatever tile size it draws at.
 */
function decodeGeometry(commands, extent) {
  const rings = [];
  let current = null;
  let x = 0;
  let y = 0;
  let i = 0;

  while (i < commands.length) {
    const commandInteger = commands[i++];
    const id = commandInteger & 0x7;
    const count = commandInteger >> 3;

    if (id === CMD_MOVE_TO) {
      for (let n = 0; n < count; n++) {
        x += zigzag(commands[i++]);
        y += zigzag(commands[i++]);
        current = [[x / extent, y / extent]];
        rings.push(current);
      }
    } else if (id === CMD_LINE_TO) {
      for (let n = 0; n < count; n++) {
        x += zigzag(commands[i++]);
        y += zigzag(commands[i++]);
        if (current) current.push([x / extent, y / extent]);
      }
    } else if (id === CMD_CLOSE_PATH) {
      if (current && current.length > 0) current.push([current[0][0], current[0][1]]);
    } else {
      break; // unrecognised command; the rest of the stream is not trustworthy
    }
  }

  return rings;
}

function decodeFeature(buffer, keys, values, extent) {
  const reader = new Reader(buffer);
  const feature = { type: 'unknown', properties: {}, geometry: [] };
  let tags = [];
  let geometryCommands = [];

  while (!reader.done) {
    const { field, wireType } = reader.tag();
    switch (field) {
      case 1:
        feature.id = reader.varint();
        break;
      case 2: {
        const packed = new Reader(reader.bytes());
        tags = [];
        while (!packed.done) tags.push(packed.varint());
        break;
      }
      case 3:
        feature.type = GEOMETRY_TYPES[reader.varint()] || 'unknown';
        break;
      case 4: {
        const packed = new Reader(reader.bytes());
        geometryCommands = [];
        while (!packed.done) geometryCommands.push(packed.varint());
        break;
      }
      default:
        reader.skip(wireType);
    }
  }

  // Tags are index pairs into the layer's shared key and value tables.
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const key = keys[tags[i]];
    if (key !== undefined) feature.properties[key] = values[tags[i + 1]];
  }

  feature.geometry = decodeGeometry(geometryCommands, extent);
  return feature;
}

function decodeLayer(buffer) {
  const reader = new Reader(buffer);
  const layer = { name: '', version: 1, extent: 4096, features: [] };
  const featureBuffers = [];
  const keys = [];
  const values = [];

  while (!reader.done) {
    const { field, wireType } = reader.tag();
    switch (field) {
      case 1: layer.name = reader.string(); break;
      case 2: featureBuffers.push(reader.bytes()); break;
      case 3: keys.push(reader.string()); break;
      case 4: values.push(readValue(reader.bytes())); break;
      case 5: layer.extent = reader.varint(); break;
      case 15: layer.version = reader.varint(); break;
      default: reader.skip(wireType);
    }
  }

  for (const featureBuffer of featureBuffers) {
    layer.features.push(decodeFeature(featureBuffer, keys, values, layer.extent));
  }
  return layer;
}

/** Decode a whole tile into named layers. */
function decodeTile(buffer) {
  const reader = new Reader(buffer);
  const layers = {};

  while (!reader.done) {
    const { field, wireType } = reader.tag();
    if (field === 3) {
      const layer = decodeLayer(reader.bytes());
      layers[layer.name] = layer;
    } else {
      reader.skip(wireType);
    }
  }
  return layers;
}

module.exports = { decodeTile, decodeLayer, GEOMETRY_TYPES };
