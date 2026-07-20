// SPDX-License-Identifier: GPL-3.0-or-later

import Bunzip from "seek-bzip";
import { MATERIALS, MAT, UPSTREAM_LIFE_RULES, UPSTREAM_WALLS, materialById } from "./materials.js";
import { axisMap, depthOrder, particleBounds, placementColumns } from "./import-projection.js";

const textDecoder = new TextDecoder();
const MAX_BSON_BYTES = 200 * 1024 * 1024;
const ACTOR_FAN = 0x0100;
const ACTOR_ROCKET_BOOTS = 0x0200;

const OLD_WALL_IDS = new Map([
  [122, 1], [123, 2], [124, 3], [125, 4], [127, 5], [255, 5],
  [128, 6], [129, 7], [130, 0], [131, 8], [132, 9], [133, 10],
  [134, 11], [135, 12], [140, 13], [142, 14], [145, 15],
]);

const IDENTIFIER_ALIASES = new Map([
  ["DEFAULT_PT_TUGN", [87, 1, "DEFAULT_PT_TUNG"]],
  ["DEFAULT_PT_REPL", [90, 1, "DEFAULT_PT_RPEL"]],
  ["DEFAULT_PT_E180", [92, 0, "DEFAULT_PT_HEAC"]],
  ["DEFAULT_PT_E181", [92, 0, "DEFAULT_PT_SAWD"]],
  ["DEFAULT_PT_E182", [92, 0, "DEFAULT_PT_POLO"]],
  ["DEFAULT_PT_RAYT", [93, 3, "DEFAULT_PT_LDTC"]],
]);

const COARSE_PALETTE = Object.freeze([
  [78, 1, 160, 144, 146], [79, 0, 160, 145, 146], [80, 0, 160, 146, 146],
  [80, 5, 160, 146, 146], [81, 7, 161, 146, 146], [83, 0, 162, 146, 146],
  [83, 4, 163, 146, 146], [84, 0, 166, 146, 146], [86, 0, 169, 146, 146],
  [87, 1, 172, 146, 146], [89, 0, 176, 146, 146], [90, 0, 178, 146, 146],
  [91, 0, 179, 146, 146], [92, 0, 185, 146, 146], [94, 0, 186, 146, 146],
  [96, 0, 191, 146, 146],
]);

const PRESSURE_IN_TMP3 = new Set([MAT.QRTZ, MAT.GLAS, MAT.TUNG]);
const PALETTE_CARRIER_EXCEPTIONS_98 = new Set(["ICEI", "SNOW", "RSST", "RSSS"]);
const PALETTE_CARRIER_EXCEPTIONS_99 = new Set(["PLSM", "EXOT", "FWRK", "WTRV", "FIRE", "BRMT", "FOG", "RIME"]);

// seek-bzip is an old CommonJS package which allocates `Buffer` internally and
// converts six-byte block signatures with `toString("hex")`. Browsers have no
// Buffer, and a bare Uint8Array fallback breaks that signature check because
// its toString returns comma-separated decimals. This is the complete subset
// seek-bzip needs; Node keeps using its native Buffer.
class SeekBzipBuffer extends Uint8Array {
  toString(encoding) {
    if (encoding === "hex") return Array.from(this, (value) => value.toString(16).padStart(2, "0")).join("");
    return textDecoder.decode(this);
  }

  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const source = this.subarray(sourceStart, sourceEnd);
    target.set(source, targetStart);
    return source.length;
  }
}

function fail(message) {
  throw new Error(`OPS import: ${message}`);
}

function ensure(view, offset, length, context) {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) fail(`truncated ${context}`);
}

function cString(bytes, start, end) {
  let cursor = start;
  while (cursor < end && bytes[cursor] !== 0) cursor += 1;
  if (cursor >= end) fail("unterminated BSON key");
  return [textDecoder.decode(bytes.subarray(start, cursor)), cursor + 1];
}

function bsonString(bytes, view, offset, limit) {
  ensure(view, offset, 4, "BSON string length");
  const length = view.getInt32(offset, true);
  if (length < 1 || offset + 4 + length > limit || bytes[offset + 3 + length] !== 0) fail("invalid BSON string");
  return [textDecoder.decode(bytes.subarray(offset + 4, offset + 3 + length)), offset + 4 + length];
}

function readBsonDocument(bytes, view, start, asArray = false) {
  ensure(view, start, 5, "BSON document");
  const length = view.getInt32(start, true);
  const end = start + length;
  if (length < 5 || end > bytes.length || bytes[end - 1] !== 0) fail("invalid BSON document length");
  let cursor = start + 4;
  const result = {};
  while (cursor < end - 1) {
    const type = bytes[cursor++];
    let key;
    [key, cursor] = cString(bytes, cursor, end);
    let value;
    switch (type) {
      case 0x01:
        ensure(view, cursor, 8, "BSON double");
        value = view.getFloat64(cursor, true);
        cursor += 8;
        break;
      case 0x02:
      case 0x0d:
      case 0x0e:
        [value, cursor] = bsonString(bytes, view, cursor, end);
        break;
      case 0x03:
      case 0x04: {
        // OPS deliberately emits `palette` with BSON's array type even though
        // its keys are element identifiers. Upstream's parser carries the same
        // objectEncodedAsArray compatibility exception; normal BSON arrays are
        // still normalized below.
        const nested = readBsonDocument(bytes, view, cursor, type === 0x04 && key !== "palette");
        value = nested.value;
        cursor = nested.offset;
        break;
      }
      case 0x05: {
        ensure(view, cursor, 5, "BSON binary");
        let binaryLength = view.getInt32(cursor, true);
        cursor += 4;
        const subtype = bytes[cursor++];
        if (binaryLength < 0 || cursor + binaryLength > end) fail("invalid BSON binary length");
        if (subtype === 0x02) {
          ensure(view, cursor, 4, "legacy BSON binary");
          const nestedLength = view.getInt32(cursor, true);
          cursor += 4;
          binaryLength -= 4;
          if (nestedLength !== binaryLength || binaryLength < 0) fail("invalid legacy BSON binary length");
        }
        value = bytes.slice(cursor, cursor + binaryLength);
        cursor += binaryLength;
        break;
      }
      case 0x06:
      case 0x0a:
      case 0x7f:
      case 0xff:
        value = null;
        break;
      case 0x07:
        ensure(view, cursor, 12, "BSON object id");
        value = bytes.slice(cursor, cursor + 12);
        cursor += 12;
        break;
      case 0x08:
        ensure(view, cursor, 1, "BSON boolean");
        value = bytes[cursor++] !== 0;
        break;
      case 0x09:
      case 0x11:
      case 0x12:
        ensure(view, cursor, 8, "BSON 64-bit value");
        value = view.getBigInt64(cursor, true);
        if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) value = Number(value);
        cursor += 8;
        break;
      case 0x0b: {
        const pattern = cString(bytes, cursor, end);
        const options = cString(bytes, pattern[1], end);
        value = { pattern: pattern[0], options: options[0] };
        cursor = options[1];
        break;
      }
      case 0x0f: {
        ensure(view, cursor, 4, "BSON code-with-scope");
        const totalLength = view.getInt32(cursor, true);
        if (totalLength < 14 || cursor + totalLength > end) fail("invalid BSON code-with-scope");
        cursor += totalLength;
        value = null;
        break;
      }
      case 0x10:
        ensure(view, cursor, 4, "BSON int32");
        value = view.getInt32(cursor, true);
        cursor += 4;
        break;
      case 0x13:
        ensure(view, cursor, 16, "BSON decimal128");
        value = bytes.slice(cursor, cursor + 16);
        cursor += 16;
        break;
      default:
        fail(`unsupported BSON type 0x${type.toString(16).padStart(2, "0")}`);
    }
    result[key] = value;
  }
  const value = asArray
    ? Object.keys(result).sort((a, b) => Number(a) - Number(b)).map((key) => result[key])
    : result;
  return { value, offset: end };
}

export function parseBson(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parsed = readBsonDocument(bytes, view, 0);
  if (parsed.offset !== bytes.length) fail("trailing data after BSON document");
  return parsed.value;
}

export function decodeBzip(compressed, expectedLength) {
  if (typeof globalThis.Buffer === "undefined" || globalThis.Buffer === Uint8Array) globalThis.Buffer = SeekBzipBuffer;
  const output = new Uint8Array(expectedLength);
  const outputStream = {
    position: 0,
    writeByte(value) {
      if (this.position >= output.length) fail("decompressed BSON exceeds declared size");
      output[this.position++] = value;
    },
  };
  Bunzip.decode(compressed, outputStream);
  if (outputStream.position !== expectedLength) fail("decompressed BSON length does not match header");
  return output;
}

function binary(document, key) {
  return document[key] instanceof Uint8Array ? document[key] : null;
}

function versionAtMost(major, minor, limitMajor, limitMinor) {
  return major < limitMajor || (major === limitMajor && minor <= limitMinor);
}

function paletteMap(document, savedVersion) {
  const byIdentifier = new Map(MATERIALS.map((material) => [material.identifier, material.id]));
  const result = new Map();
  const minorVersion = Math.max(0, Number(document.origin?.minorVersion) || 0);
  const hasPalette = document.palette && typeof document.palette === "object";
  if (savedVersion < 98) {
    let coarse = COARSE_PALETTE[0];
    for (const candidate of COARSE_PALETTE) {
      if (candidate[0] < savedVersion || (candidate[0] === savedVersion && candidate[1] <= minorVersion)) coarse = candidate;
    }
    for (let id = 1; id <= coarse[2]; id += 1) {
      if (id < coarse[3] || id > coarse[4]) result.set(id, id);
    }
  } else if (!hasPalette) {
    // Programmatic documents used by the editor and tests predate palette
    // emission. Real 98.0+ OPS files always contain a comprehensive palette.
    for (const material of MATERIALS) result.set(material.id, material.id);
  }
  for (const [rawIdentifier, savedId] of Object.entries(document.palette ?? {})) {
    const alias = IDENTIFIER_ALIASES.get(rawIdentifier);
    const identifier = alias && versionAtMost(savedVersion, minorVersion, alias[0], alias[1]) ? alias[2] : rawIdentifier;
    const currentId = byIdentifier.get(identifier);
    if (!Number.isInteger(savedId) || savedId <= 0 || savedId >= 512) continue;
    result.set(savedId, Number.isInteger(currentId) ? currentId : MAT.EMPTY);
  }
  return (savedId, ignoreMissing = false) => {
    if (savedId === MAT.EMPTY) return MAT.EMPTY;
    const mapped = result.get(savedId);
    if (mapped != null) return mapped;
    return ignoreMissing ? savedId : MAT.EMPTY;
  };
}

function fireworkGradient(index) {
  const stops = [0xff00ff, 0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff0000];
  const clamped = Math.max(0, Math.min(199, index));
  const segment = Math.min(4, Math.floor((clamped / 200) / 0.2));
  const alpha = Math.trunc((((clamped / 200) - segment * 0.2) / 0.2) * 255);
  const left = stops[segment];
  const right = stops[segment + 1];
  const blend = (shift) => Math.trunc(((255 - alpha) * ((left >> shift) & 0xff) + alpha * ((right >> shift) & 0xff)) / 255);
  return (blend(16) << 16) | (blend(8) << 8) | blend(0);
}

function migrateOpsParticle(particle, savedVersion) {
  if (particle.type === MAT.SOAP) particle.ctype &= ~6;
  else if (savedVersion < 81 && particle.type === MAT.BOMB && particle.tmp !== 0) {
    particle.type = MAT.EMBR;
    particle.ctype = 0;
    if (particle.tmp === 1) particle.tmp = 0;
  } else if (savedVersion < 81 && particle.type === MAT.DUST && particle.life > 0) {
    particle.type = MAT.EMBR;
    particle.ctype = (particle.tmp2 << 16) | (particle.tmp << 8) | particle.ctype;
    particle.tmp = 1;
  } else if (savedVersion < 81 && particle.type === MAT.FIRW && particle.tmp >= 2) {
    particle.type = MAT.EMBR;
    particle.ctype = fireworkGradient(particle.tmp - 4);
    particle.tmp = 1;
  } else if (particle.type === MAT.PSTN) {
    if (savedVersion < 87 && particle.ctype) particle.life = 1;
    if (savedVersion < 91) particle.kelvin = 283.15;
  } else if (savedVersion < 89 && particle.type === MAT.FILT) {
    if (particle.tmp < 0 || particle.tmp > 3) particle.tmp = 6;
    particle.ctype = 0;
  } else if (savedVersion < 89 && (particle.type === MAT.QRTZ || particle.type === MAT.PQRT)) {
    particle.tmp2 = particle.tmp;
    particle.tmp = particle.ctype;
    particle.ctype = 0;
  } else if (savedVersion < 90 && particle.type === MAT.PHOT) particle.flags |= 0x08;
  else if (savedVersion < 91 && particle.type === MAT.VINE) particle.tmp = 1;
  else if (savedVersion < 91 && particle.type === MAT.DLAY) particle.kelvin -= 1;
  else if (savedVersion < 91 && particle.type === MAT.CRAY && particle.tmp2) {
    particle.ctype |= particle.tmp2 << 8;
    particle.tmp2 = 0;
  } else if (savedVersion < 91 && particle.type === MAT.CONV && particle.tmp) {
    particle.ctype |= particle.tmp << 8;
    particle.tmp = 0;
  } else if (particle.type === MAT.PIPE || particle.type === MAT.PPIP) {
    if (savedVersion < 93) {
      if (particle.ctype === 1) particle.tmp |= 0x00020000;
      particle.tmp |= (particle.ctype - 1) << 18;
      particle.ctype = particle.tmp & 0xff;
    }
    if (savedVersion < 100) particle.tmp &= ~0xff;
  } else if (savedVersion < 93 && [MAT.TSNS, MAT.HSWC, MAT.PSNS, MAT.PUMP].includes(particle.type)) particle.tmp = 0;
  else if (savedVersion < 96 && particle.type === MAT.LIFE) {
    const rule = UPSTREAM_LIFE_RULES[particle.ctype];
    if (rule) {
      particle.tmp2 = particle.tmp;
      if (!particle.decoration) particle.decoration = rule.color;
      particle.tmp = rule.gradientColor;
    }
  }
  if (PRESSURE_IN_TMP3.has(particle.type) && (particle.tmp3 & 0x8000)) particle.tmp3 = (particle.tmp3 << 16) >> 16;
  return particle;
}

function readByte(data, state, context) {
  if (state.offset >= data.length) fail(`ran past particle data while reading ${context}`);
  return data[state.offset++];
}

function signed32(value) {
  return value | 0;
}

export function decodeOpsParticleStreams(document, sourceWidth, sourceHeight, savedVersion = 100) {
  const partsData = binary(document, "parts");
  const positions = binary(document, "partsPos");
  if (!partsData || !positions) return [];
  if (positions.length < sourceWidth * sourceHeight * 3) fail("not enough particle position data");
  const mapType = paletteMap(document, savedVersion);
  const pmapbits = Math.max(1, Math.min(30, Number(document.pmapbits) || 8));
  const pmapmask = (2 ** pmapbits) - 1;
  const particles = [];
  const state = { offset: 0 };
  let positionOffset = 0;
  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
      const count = (positions[positionOffset] << 16) | (positions[positionOffset + 1] << 8) | positions[positionOffset + 2];
      positionOffset += 3;
      for (let atPosition = 0; atPosition < count; atPosition += 1) {
        if (state.offset + 4 > partsData.length) fail("ran past particle data buffer");
        let savedType = readByte(partsData, state, "type");
        let descriptor = readByte(partsData, state, "descriptor") | (readByte(partsData, state, "descriptor") << 8);
        if (descriptor & 0x4000) savedType |= readByte(partsData, state, "extended type") << 8;
        let kelvin;
        if (descriptor & 0x01) kelvin = readByte(partsData, state, "temperature") | (readByte(partsData, state, "temperature") << 8);
        else {
          const roomOffset = readByte(partsData, state, "temperature");
          kelvin = (roomOffset >= 0x80 ? roomOffset - 0x100 : roomOffset) + 294.15;
        }
        if (descriptor & 0x8000) descriptor |= readByte(partsData, state, "third descriptor byte") << 16;
        let life = 0;
        let tmp = 0;
        let ctype = 0;
        let decoration = 0;
        let velocityX = 0;
        let velocityY = 0;
        let tmp2 = 0;
        let tmp3 = 0;
        let tmp4 = 0;
        if (descriptor & 0x02) {
          life = readByte(partsData, state, "life");
          if (descriptor & 0x04) life |= readByte(partsData, state, "life") << 8;
        }
        if (descriptor & 0x08) {
          tmp = readByte(partsData, state, "tmp");
          if (descriptor & 0x10) {
            tmp |= readByte(partsData, state, "tmp") << 8;
            if (descriptor & 0x1000) tmp = signed32(tmp | (readByte(partsData, state, "tmp") << 24) | (readByte(partsData, state, "tmp") << 16));
          }
        }
        if (descriptor & 0x20) {
          ctype = readByte(partsData, state, "ctype");
          if (descriptor & 0x200) ctype = signed32(ctype | (readByte(partsData, state, "ctype") << 24) | (readByte(partsData, state, "ctype") << 16) | (readByte(partsData, state, "ctype") << 8));
        }
        if (descriptor & 0x40) {
          decoration = ((readByte(partsData, state, "decoration") << 24) >>> 0)
            | (readByte(partsData, state, "decoration") << 16)
            | (readByte(partsData, state, "decoration") << 8)
            | readByte(partsData, state, "decoration");
          decoration >>>= 0;
        }
        if (descriptor & 0x80) velocityX = (readByte(partsData, state, "vx") - 127) / 16;
        if (descriptor & 0x100) velocityY = (readByte(partsData, state, "vy") - 127) / 16;
        if (descriptor & 0x400) {
          tmp2 = readByte(partsData, state, "tmp2");
          if (descriptor & 0x800) tmp2 |= readByte(partsData, state, "tmp2") << 8;
        }
        if (descriptor & 0x2000) {
          const low3 = readByte(partsData, state, "tmp3");
          const low3High = readByte(partsData, state, "tmp3");
          const low4 = readByte(partsData, state, "tmp4");
          const low4High = readByte(partsData, state, "tmp4");
          tmp3 = low3 | (low3High << 8);
          tmp4 = low4 | (low4High << 8);
          if (descriptor & 0x10000) {
            tmp3 = signed32(tmp3 | (readByte(partsData, state, "tmp3") << 16) | (readByte(partsData, state, "tmp3") << 24));
            tmp4 = signed32(tmp4 | (readByte(partsData, state, "tmp4") << 16) | (readByte(partsData, state, "tmp4") << 24));
          }
        }
        const particle = migrateOpsParticle({
          type: savedType, kelvin, life, ctype, tmp, tmp2, tmp3, tmp4,
          velocityX, velocityY: -velocityY, velocityZ: 0, flags: 0, decoration,
        }, savedVersion);
        const type = mapType(particle.type);
        if (type === MAT.EMPTY) {
          particles.push({ sourceX, sourceY, type, skipped: true });
          continue;
        }
        const material = materialById(type);
        const minorVersion = Math.max(0, Number(document.origin?.minorVersion) || 0);
        const ignoreMissing = (versionAtMost(savedVersion, minorVersion, 98, 2) && PALETTE_CARRIER_EXCEPTIONS_98.has(material.code))
          || (versionAtMost(savedVersion, minorVersion, 99, 5) && PALETTE_CARRIER_EXCEPTIONS_99.has(material.code));
        const mapPackedType = (value) => signed32((value & ~pmapmask) | mapType(value & pmapmask, ignoreMissing));
        if (material.carriesCtype) particle.ctype = mapPackedType(particle.ctype);
        if (material.carriesTmp) particle.tmp = mapPackedType(particle.tmp);
        particles.push({
          sourceX, sourceY, ...particle, type, temperature: particle.kelvin - 273.15,
        });
      }
    }
  }
  if (state.offset !== partsData.length) fail("particle data has trailing bytes");

  const soapLinks = binary(document, "soapLinks");
  if (soapLinks) {
    let offset = 0;
    for (let index = 0; index < particles.length; index += 1) {
      if (particles[index].type !== MAT.SOAP) continue;
      if (offset + 3 > soapLinks.length) break;
      const linked = (soapLinks[offset] << 16) | (soapLinks[offset + 1] << 8) | soapLinks[offset + 2];
      offset += 3;
      if (linked > 0 && linked <= particles.length) particles[index].soapForward = linked - 1;
    }
  }
  return particles;
}

function decodeScalarMap(data, sourceIndex, mode) {
  if (!data) return null;
  if (mode === "float") {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const offset = sourceIndex * 4;
    return offset + 4 <= data.length ? view.getFloat32(offset, true) : null;
  }
  const offset = sourceIndex * 2;
  if (offset + 2 > data.length) return null;
  const encoded = data[offset] | (data[offset + 1] << 8);
  return mode === "ambient" ? encoded - 273.15 : encoded / 128 - 256;
}

function importFields(document, blockWidth, blockHeight, mapper, simulation, centerZ) {
  const wallData = binary(document, "wallMap");
  const fanData = binary(document, "fanMap");
  const pressure = binary(document, "pressMap");
  const velocityX = binary(document, "vxMap");
  const velocityY = binary(document, "vyMap");
  const ambient = binary(document, "ambientMap");
  const blockAir = binary(document, "blockAir");
  const gravity = binary(document, "gravity");
  const blockCount = blockWidth * blockHeight;
  for (const [data, bytesPerCell, label] of [
    [wallData, 1, "wall"], [pressure, 2, "pressure"], [velocityX, 2, "vx"],
    [velocityY, 2, "vy"], [ambient, 2, "ambient heat"], [blockAir, 2, "block air"],
    [gravity, 16, "gravity"],
  ]) {
    if (data && data.length < blockCount * bytesPerCell) fail(`not enough ${label} data`);
  }
  const accumulators = new Map();
  let fanOffset = 0;
  for (let by = 0; by < blockHeight; by += 1) {
    for (let bx = 0; bx < blockWidth; bx += 1) {
      const sourceIndex = bx + by * blockWidth;
      const [x, y] = mapper.point(bx * 4 + 1, by * 4 + 1);
      const [cx, cy, cz] = simulation.air.cellForVoxel(x, y, centerZ);
      const target = simulation.air.index(cx, cy, cz);
      let accumulator = accumulators.get(target);
      if (!accumulator) {
        accumulator = { count: 0, pressure: 0, velocityX: 0, velocityY: 0, ambient: 0, ambientCount: 0, mass: 0, gravityMask: 0, forceX: 0, forceY: 0 };
        accumulators.set(target, accumulator);
      }
      accumulator.count += 1;
      const p = decodeScalarMap(pressure, sourceIndex, "field");
      const vx = decodeScalarMap(velocityX, sourceIndex, "field");
      const vy = decodeScalarMap(velocityY, sourceIndex, "field");
      const heat = decodeScalarMap(ambient, sourceIndex, "ambient");
      if (p != null) accumulator.pressure += p;
      if (vx != null) accumulator.velocityX += vx;
      if (vy != null) accumulator.velocityY -= vy;
      if (heat != null) { accumulator.ambient += heat; accumulator.ambientCount += 1; }
      if (gravity) {
        const planeBytes = blockCount * 4;
        const gravityView = new DataView(gravity.buffer, gravity.byteOffset, gravity.byteLength);
        accumulator.mass += gravityView.getFloat32(sourceIndex * 4, true);
        accumulator.gravityMask += gravityView.getUint32(planeBytes + sourceIndex * 4, true) ? 1 : 0;
        accumulator.forceX += gravityView.getFloat32(planeBytes * 2 + sourceIndex * 4, true);
        accumulator.forceY -= gravityView.getFloat32(planeBytes * 3 + sourceIndex * 4, true);
      }

      let wall = wallData?.[sourceIndex] ?? 0;
      wall = OLD_WALL_IDS.get(wall) ?? wall;
      if (wall === 5 && fanData) {
        if (fanOffset + 2 > fanData.length) fail("not enough fan data");
        simulation.wallFanX[target] = (fanData[fanOffset++] - 127) / 64;
        simulation.wallFanY[target] = -(fanData[fanOffset++] - 127) / 64;
      }
      if (wall > 0 && wall < UPSTREAM_WALLS.length) simulation.walls[target] = wall + 1;
    }
  }
  for (const [target, values] of accumulators) {
    const divisor = Math.max(1, values.count);
    simulation.air.pressure[target] = values.pressure / divisor;
    simulation.air.velocityX[target] = values.velocityX / divisor;
    simulation.air.velocityY[target] = values.velocityY / divisor;
    if (values.ambientCount) simulation.air.ambientHeat[target] = values.ambient / values.ambientCount;
    if (gravity) {
      simulation.gravity.mass[target] = values.mass / divisor;
      simulation.gravity.mask[target] = values.gravityMask >= divisor / 2 ? 1 : 0;
      simulation.gravity.forceX[target] = values.forceX / divisor;
      simulation.gravity.forceY[target] = values.forceY / divisor;
    }
  }
}

export function applyOpsDocument(document, metadata, simulation, depth = Math.floor(simulation.depth / 2)) {
  const sourceWidth = metadata.blockWidth * metadata.cellSize;
  const sourceHeight = metadata.blockHeight * metadata.cellSize;
  const centerZ = Math.max(0, Math.min(simulation.depth - 1, Math.round(depth)));
  const decoded = decodeOpsParticleStreams(document, sourceWidth, sourceHeight, metadata.savedVersion);
  const mapper = axisMap(sourceWidth, sourceHeight, simulation, particleBounds(decoded, sourceWidth, sourceHeight));
  const zOrder = depthOrder(simulation.depth, centerZ);
  const placements = new Array(decoded.length).fill(null);
  simulation.clear();
  const ambientKelvin = Number(document.ambientAirTemp);
  const gravityMode = Math.max(0, Math.min(3, Number(document.gravityMode) || 0));
  simulation.applySettings({
    gravityMode,
    edgeMode: Math.max(0, Math.min(2, Number(document.edgeMode) || 0)),
    customGravity: gravityMode === 3 ? [Number(document.customGravityX) || 0, -(Number(document.customGravityY) || 0), 0] : simulation.customGravity,
    heatSimulationEnabled: document.legacyEnable !== true,
    newtonianGravityEnabled: document.gravityEnable === true,
    waterEqualization: document.waterEEnabled === true,
    airMode: Math.max(0, Math.min(4, Number(document.airMode) || 0)),
    ambientTemperature: Number.isFinite(ambientKelvin) ? ambientKelvin - 273.15 : 22,
    ambientHeatEnabled: document.aheat_enable === true,
    edgePressure: Number(document.edgePressure) || 0,
    edgeVelocityX: Number(document.edgeVelocityX) || 0,
    edgeVelocityY: -(Number(document.edgeVelocityY) || 0),
    edgeVelocityZ: 0,
    vorticityCoeff: Number.isFinite(Number(document.vorticityCoeff)) ? Number(document.vorticityCoeff) : 0.1,
    convectionMode: Number.isFinite(Number(document.convectionMode)) ? Number(document.convectionMode) : metadata.savedVersion >= 99 ? 2 : 1,
  });
  importFields(document, metadata.blockWidth, metadata.blockHeight, mapper, simulation, centerZ);
  let imported = 0;
  let omitted = 0;
  let importedMatter = 0;
  let importedEnergy = 0;
  const matterColumns = new Uint16Array(simulation.width * simulation.height);
  const energyColumns = new Uint16Array(simulation.width * simulation.height);
  for (let particleIndex = 0; particleIndex < decoded.length; particleIndex += 1) {
    const particle = decoded[particleIndex];
    if (particle.skipped || particle.type === MAT.EMPTY || !materialById(particle.type).enabled) { omitted += 1; continue; }
    const [x, y] = mapper.point(particle.sourceX, particle.sourceY);
    const energy = materialById(particle.type).state === "energy";
    if ((energy ? importedEnergy : importedMatter) >= simulation.size) { omitted += 1; continue; }
    let placed = false;
    const columns = energy ? energyColumns : matterColumns;
    for (const [targetX, targetY] of placementColumns(simulation.width, simulation.height, x, y)) {
      const column = targetX + simulation.width * targetY;
      if (columns[column] >= simulation.depth) continue;
      for (const z of zOrder) {
        const voxel = simulation.index(targetX, targetY, z);
        if ((energy ? simulation.energyTypes[voxel] : simulation.types[voxel]) !== MAT.EMPTY) continue;
        const properties = {
          ctype: particle.ctype, tmp: particle.tmp, tmp2: particle.tmp2, tmp3: particle.tmp3, tmp4: particle.tmp4,
          velocityX: particle.velocityX * mapper.scale, velocityY: particle.velocityY * mapper.scale,
          velocityZ: particle.velocityZ, flags: particle.flags, decoration: particle.decoration,
        };
        const success = energy
          ? simulation.setEnergy(targetX, targetY, z, particle.type, particle.temperature, particle.life, properties)
          : simulation.set(targetX, targetY, z, particle.type, particle.temperature, particle.life, properties);
        if (!success) continue;
        simulation.restoreParticleState(voxel, {
          ...particle,
          velocityX: properties.velocityX,
          velocityY: properties.velocityY,
          energy,
        }, energy);
        placements[particleIndex] = { voxel, energy };
        columns[column] += 1;
        imported += 1;
        if (energy) importedEnergy += 1;
        else importedMatter += 1;
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) omitted += 1;
  }

  for (let source = 0; source < decoded.length; source += 1) {
    const linked = decoded[source].soapForward;
    if (!Number.isInteger(linked)) continue;
    const from = placements[source];
    const to = placements[linked];
    if (!from || !to || from.energy || to.energy || simulation.types[from.voxel] !== MAT.SOAP || simulation.types[to.voxel] !== MAT.SOAP) continue;
    simulation.ctype[from.voxel] |= 2;
    simulation.tmp[from.voxel] = to.voxel;
    simulation.ctype[to.voxel] |= 4;
    simulation.tmp2[to.voxel] = from.voxel;
  }

  const minorVersion = Math.max(0, Number(document.origin?.minorVersion) || 0);
  for (const sign of Array.isArray(document.signs) ? document.signs : []) {
    if (!Number.isFinite(sign?.x) || !Number.isFinite(sign?.y) || typeof sign?.text !== "string") continue;
    const [x, y] = mapper.point(sign.x, sign.y);
    const savedJustification = Number.isInteger(sign.justification) ? sign.justification : sign.ju;
    const justification = savedJustification === 0 ? "left" : savedJustification === 2 ? "right" : "center";
    let signText = sign.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 45);
    if (versionAtMost(metadata.savedVersion, minorVersion, 94, 1)) {
      if (signText === "{t}") signText = "Temp: {t}";
      else if (signText === "{p}") signText = "Pressure: {p}";
    }
    simulation.addSign(x, y, centerZ, signText, 0x8feeff, justification);
  }

  const stkm = document.stkm ?? {};
  for (const [type, fan, rocket] of [
    [MAT.STKM, stkm.fan1, stkm.rocketBoots1],
    [MAT.STKM2, stkm.fan2, stkm.rocketBoots2],
  ]) {
    const actor = simulation.types.indexOf(type);
    if (actor >= 0) simulation.flags[actor] |= (fan ? ACTOR_FAN : 0) | (rocket ? ACTOR_ROCKET_BOOTS : 0);
  }
  const fighterIndices = [];
  for (let index = 0; index < simulation.size; index += 1) if (simulation.types[index] === MAT.FIGH) fighterIndices.push(index);
  for (const fighter of Array.isArray(stkm.fanFigh) ? stkm.fanFigh : []) {
    if (Number.isInteger(fighterIndices[fighter])) simulation.flags[fighterIndices[fighter]] |= ACTOR_FAN;
  }
  for (const fighter of Array.isArray(stkm.rocketBootsFigh) ? stkm.rocketBootsFigh : []) {
    if (Number.isInteger(fighterIndices[fighter])) simulation.flags[fighterIndices[fighter]] |= ACTOR_ROCKET_BOOTS;
  }

  simulation.currentPreset = "legacy-import";
  simulation.tick = Math.max(0, Number(document.frameCount) || 0);
  simulation.air.updateBlocked(simulation);
  return {
    format: "OPS1", savedVersion: metadata.savedVersion, sourceDimensions: [sourceWidth, sourceHeight],
    scale: mapper.scale, contentBounds: mapper.bounds, imported, omitted, total: decoded.length, paused: Boolean(document.paused),
  };
}

export function importOps(input, simulation, depth) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 13 || textDecoder.decode(bytes.subarray(0, 4)) !== "OPS1") fail("not an OPS1 save");
  const savedVersion = bytes[4];
  const cellSize = bytes[5];
  const blockWidth = bytes[6];
  const blockHeight = bytes[7];
  if (cellSize !== 4) fail(`unsupported cell size ${cellSize}`);
  if (!blockWidth || !blockHeight) fail("invalid save dimensions");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bsonLength = view.getUint32(8, true);
  if (!bsonLength || bsonLength > MAX_BSON_BYTES) fail("invalid decompressed size");
  const document = parseBson(decodeBzip(bytes.subarray(12), bsonLength));
  return applyOpsDocument(document, { savedVersion, cellSize, blockWidth, blockHeight }, simulation, depth);
}
