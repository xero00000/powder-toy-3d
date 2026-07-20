// SPDX-License-Identifier: GPL-3.0-or-later

import Bzip2Module from "./compressjs-bzip2.js";
import { MAT, UPSTREAM_ELEMENT_COUNT, materialById } from "./materials.js";

const Bzip2 = Bzip2Module?.default ?? Bzip2Module;
const CELL_SIZE = 4;
const OPS_VERSION = 100;
const MAX_UPSTREAM_WIDTH = 612;
const MAX_UPSTREAM_HEIGHT = 384;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function concat(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function int32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, Number(value) | 0, true);
  return bytes;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Number(value) >>> 0, true);
  return bytes;
}

function float64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, Number(value), true);
  return bytes;
}

function cString(value) {
  const encoded = new TextEncoder().encode(String(value));
  return concat([encoded, Uint8Array.of(0)]);
}

function bsonString(value) {
  const encoded = new TextEncoder().encode(String(value));
  return concat([int32(encoded.length + 1), encoded, Uint8Array.of(0)]);
}

function bsonEntry(key, value) {
  const name = cString(key);
  if (value instanceof Uint8Array) return concat([Uint8Array.of(0x05), name, int32(value.length), Uint8Array.of(0x80), value]);
  if (Array.isArray(value)) return concat([Uint8Array.of(0x04), name, bsonDocument(Object.fromEntries(value.map((item, index) => [String(index), item]))) ]);
  if (value && typeof value === "object") return concat([Uint8Array.of(0x03), name, bsonDocument(value)]);
  if (typeof value === "string") return concat([Uint8Array.of(0x02), name, bsonString(value)]);
  if (typeof value === "boolean") return concat([Uint8Array.of(0x08), name, Uint8Array.of(value ? 1 : 0)]);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) {
    return concat([Uint8Array.of(0x10), name, int32(value)]);
  }
  if (typeof value === "number" && Number.isFinite(value)) return concat([Uint8Array.of(0x01), name, float64(value)]);
  throw new TypeError(`cannot encode BSON value at ${key}`);
}

export function bsonDocument(document) {
  const entries = Object.entries(document).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => bsonEntry(key, value));
  const length = 4 + entries.reduce((total, entry) => total + entry.length, 0) + 1;
  return concat([int32(length), ...entries, Uint8Array.of(0)]);
}

function appendU16(target, value) {
  const encoded = Number(value) & 0xffff;
  target.push(encoded & 0xff, encoded >>> 8);
}

function appendTmp32(target, value) {
  const encoded = Number(value) >>> 0;
  target.push(encoded & 0xff, encoded >>> 8 & 0xff, encoded >>> 24 & 0xff, encoded >>> 16 & 0xff);
}

function appendCtype32(target, value) {
  const encoded = Number(value) >>> 0;
  target.push(encoded & 0xff, encoded >>> 24 & 0xff, encoded >>> 16 & 0xff, encoded >>> 8 & 0xff);
}

function needs32(value) {
  return value < 0 || value > 0xffff;
}

function encodeParticle(particle) {
  const type = particle.type;
  const life = clamp(Math.trunc(particle.life || 0), 0, 0xffff);
  const tmp = Math.trunc(particle.tmp || 0);
  const ctype = Math.trunc(particle.ctype || 0);
  const tmp2 = clamp(Math.trunc(particle.tmp2 || 0), 0, 0xffff);
  const tmp3 = Math.trunc(particle.tmp3 || 0);
  const tmp4 = Math.trunc(particle.tmp4 || 0);
  const decoration = Number(particle.decoration || 0) >>> 0;
  const encodedVx = clamp(Math.round(Number(particle.velocityX || 0) * 16 + 127), 0, 255);
  const encodedVy = clamp(Math.round(127 - Number(particle.velocityY || 0) * 16), 0, 255);
  let descriptor = 0x01;
  if (life) descriptor |= 0x02 | (life > 0xff ? 0x04 : 0);
  if (tmp) descriptor |= 0x08 | (needs32(tmp) ? 0x10 | 0x1000 : tmp > 0xff ? 0x10 : 0);
  if (ctype) descriptor |= 0x20 | (needs32(ctype) ? 0x200 : 0);
  if (decoration) descriptor |= 0x40;
  if (encodedVx !== 127) descriptor |= 0x80;
  if (encodedVy !== 127) descriptor |= 0x100;
  if (tmp2) descriptor |= 0x400 | (tmp2 > 0xff ? 0x800 : 0);
  if (tmp3 || tmp4) descriptor |= 0x2000;
  if (needs32(tmp3) || needs32(tmp4)) descriptor |= 0x8000 | 0x10000;

  const bytes = [type & 0xff, descriptor & 0xff, descriptor >>> 8 & 0xff];
  appendU16(bytes, clamp(Math.round(Number(particle.temperature || 0) + 273.15), 0, 0xffff));
  if (descriptor & 0x8000) bytes.push(descriptor >>> 16 & 0xff);
  if (descriptor & 0x02) {
    bytes.push(life & 0xff);
    if (descriptor & 0x04) bytes.push(life >>> 8);
  }
  if (descriptor & 0x08) {
    if (descriptor & 0x1000) appendTmp32(bytes, tmp);
    else {
      bytes.push(tmp & 0xff);
      if (descriptor & 0x10) bytes.push(tmp >>> 8 & 0xff);
    }
  }
  if (descriptor & 0x20) {
    if (descriptor & 0x200) appendCtype32(bytes, ctype);
    else bytes.push(ctype & 0xff);
  }
  if (descriptor & 0x40) bytes.push(decoration >>> 24, decoration >>> 16 & 0xff, decoration >>> 8 & 0xff, decoration & 0xff);
  if (descriptor & 0x80) bytes.push(encodedVx);
  if (descriptor & 0x100) bytes.push(encodedVy);
  if (descriptor & 0x400) {
    bytes.push(tmp2 & 0xff);
    if (descriptor & 0x800) bytes.push(tmp2 >>> 8);
  }
  if (descriptor & 0x2000) {
    appendU16(bytes, tmp3);
    appendU16(bytes, tmp4);
    if (descriptor & 0x10000) {
      bytes.push(tmp3 >>> 16 & 0xff, tmp3 >>> 24 & 0xff, tmp4 >>> 16 & 0xff, tmp4 >>> 24 & 0xff);
    }
  }
  return bytes;
}

function layoutFor(simulation, mode, depth) {
  if (mode === "slice") {
    const plane = clamp(Math.round(depth), 0, simulation.depth - 1);
    return {
      width: simulation.width, height: simulation.height,
      point(x, y, z) { return z === plane ? [x, y] : null; },
      source(x, y) { return [x, y, plane]; },
      includesZ(z) { return z === plane; },
    };
  }
  if (mode !== "atlas") throw new TypeError("OPS export mode must be slice or atlas");
  let columns = Math.ceil(Math.sqrt(simulation.depth * simulation.height / simulation.width));
  columns = clamp(columns, 1, Math.floor(MAX_UPSTREAM_WIDTH / simulation.width));
  const rows = Math.ceil(simulation.depth / columns);
  const width = simulation.width * columns;
  const height = simulation.height * rows;
  if (width > MAX_UPSTREAM_WIDTH || height > MAX_UPSTREAM_HEIGHT) throw new Error("3D chamber is too large for an upstream depth atlas");
  return {
    width, height,
    point(x, y, z) { return [x + z % columns * simulation.width, y + Math.floor(z / columns) * simulation.height]; },
    source(x, y) {
      const tileX = Math.floor(x / simulation.width);
      const tileY = Math.floor(y / simulation.height);
      const z = tileX + tileY * columns;
      return z < simulation.depth ? [x % simulation.width, y % simulation.height, z] : null;
    },
    includesZ(z) { return z >= 0 && z < simulation.depth; },
  };
}

function supportedType(type) {
  if (!type || type >= UPSTREAM_ELEMENT_COUNT) return false;
  const material = materialById(type);
  return Boolean(material.enabled && material.identifier?.startsWith("DEFAULT_PT_"));
}

function particleFrom(simulation, index, energy) {
  return energy ? {
    type: simulation.energyTypes[index], temperature: simulation.energyTemperatures[index], life: simulation.energyLife[index],
    ctype: simulation.energyCtype[index], tmp: simulation.energyTmp[index], tmp2: simulation.energyTmp2[index],
    tmp3: simulation.energyTmp3[index], tmp4: simulation.energyTmp4[index], velocityX: simulation.energyVelocityX[index],
    velocityY: simulation.energyVelocityY[index], decoration: simulation.energyDecorations[index],
  } : {
    type: simulation.types[index], temperature: simulation.temperatures[index], life: simulation.life[index],
    ctype: simulation.ctype[index], tmp: simulation.tmp[index], tmp2: simulation.tmp2[index], tmp3: simulation.tmp3[index],
    tmp4: simulation.tmp4[index], velocityX: simulation.velocityX[index], velocityY: simulation.velocityY[index],
    decoration: simulation.decorations[index],
  };
}

function fieldWord(value, mode) {
  const encoded = mode === "ambient"
    ? Math.round(Number(value || 0) + 273.15)
    : Math.round((clamp(Number(value || 0), -256, 255.992) + 256) * 128);
  return [encoded & 0xff, encoded >>> 8 & 0xff];
}

function projectionFields(simulation, layout, blockWidth, blockHeight) {
  const wallMap = new Uint8Array(blockWidth * blockHeight);
  const pressure = new Uint8Array(blockWidth * blockHeight * 2);
  const velocityX = new Uint8Array(blockWidth * blockHeight * 2);
  const velocityY = new Uint8Array(blockWidth * blockHeight * 2);
  const ambient = new Uint8Array(blockWidth * blockHeight * 2);
  const fans = [];
  let anyWall = false;
  let anyPressure = false;
  let anyAmbient = false;
  for (let by = 0; by < blockHeight; by += 1) {
    for (let bx = 0; bx < blockWidth; bx += 1) {
      const target = bx + by * blockWidth;
      const source = layout.source(Math.min(layout.width - 1, bx * CELL_SIZE + 1), Math.min(layout.height - 1, by * CELL_SIZE + 1));
      if (!source) continue;
      const [x, y, z] = source;
      const airIndex = simulation.air.indexForVoxel(x, y, z);
      const wall = simulation.walls[airIndex] ? simulation.walls[airIndex] - 1 : 0;
      wallMap[target] = wall;
      anyWall ||= wall !== 0;
      if (wall === 5) {
        fans.push(clamp(Math.round(simulation.wallFanX[airIndex] * 64 + 127), 0, 255));
        fans.push(clamp(Math.round(127 - simulation.wallFanY[airIndex] * 64), 0, 255));
      }
      const values = [
        [pressure, simulation.air.pressure[airIndex], "field"],
        [velocityX, simulation.air.velocityX[airIndex], "field"],
        [velocityY, -simulation.air.velocityY[airIndex], "field"],
        [ambient, simulation.air.ambientHeat[airIndex], "ambient"],
      ];
      for (const [buffer, value, mode] of values) buffer.set(fieldWord(value, mode), target * 2);
      anyPressure ||= Math.abs(simulation.air.pressure[airIndex]) > 0.001 || Math.abs(simulation.air.velocityX[airIndex]) > 0.001 || Math.abs(simulation.air.velocityY[airIndex]) > 0.001;
      anyAmbient ||= Math.abs(simulation.air.ambientHeat[airIndex] - simulation.air.ambientTemperature) > 0.05;
    }
  }
  return {
    wallMap: anyWall ? wallMap : undefined,
    fanMap: fans.length ? Uint8Array.from(fans) : undefined,
    pressMap: anyPressure ? pressure : undefined,
    vxMap: anyPressure ? velocityX : undefined,
    vyMap: anyPressure ? velocityY : undefined,
    ambientMap: simulation.air.ambientHeatEnabled && anyAmbient ? ambient : undefined,
  };
}

export function exportOps(simulation, { mode = "slice", depth = Math.floor(simulation.depth / 2), paused = false } = {}) {
  const layout = layoutFor(simulation, mode, depth);
  const blockWidth = Math.ceil(layout.width / CELL_SIZE);
  const blockHeight = Math.ceil(layout.height / CELL_SIZE);
  const buckets = Array.from({ length: layout.width * layout.height }, () => []);
  const palette = {};
  let exported = 0;
  let omitted = 0;
  const registerPaletteType = (type) => {
    if (!type) return true;
    if (!supportedType(type)) return false;
    const carried = materialById(type);
    palette[carried.identifier] = type;
    return true;
  };
  for (let z = 0; z < simulation.depth; z += 1) {
    if (!layout.includesZ(z)) continue;
    for (let y = 0; y < simulation.height; y += 1) {
      for (let x = 0; x < simulation.width; x += 1) {
        const index = simulation.index(x, y, z);
        const point = layout.point(x, y, z);
        if (!point) continue;
        const bucket = buckets[point[0] + point[1] * layout.width];
        for (const energy of [false, true]) {
          const type = energy ? simulation.energyTypes[index] : simulation.types[index];
          if (!type) continue;
          if (!supportedType(type)) { omitted += 1; continue; }
          const material = materialById(type);
          palette[material.identifier] = type;
          const particle = particleFrom(simulation, index, energy);
          for (const field of [material.carriesCtype ? "ctype" : null, material.carriesTmp ? "tmp" : null]) {
            if (!field) continue;
            const carriedType = particle[field] & 0xff;
            if (!registerPaletteType(carriedType)) {
              particle[field] &= ~0xff;
              omitted += 1;
            }
          }
          bucket.push(particle);
          exported += 1;
        }
      }
    }
  }
  const positionBytes = new Uint8Array(layout.width * layout.height * 3);
  const partBytes = [];
  for (let index = 0; index < buckets.length; index += 1) {
    const count = buckets[index].length;
    positionBytes[index * 3] = count >>> 16 & 0xff;
    positionBytes[index * 3 + 1] = count >>> 8 & 0xff;
    positionBytes[index * 3 + 2] = count & 0xff;
    for (const particle of buckets[index]) partBytes.push(...encodeParticle(particle));
  }
  const fields = projectionFields(simulation, layout, blockWidth, blockHeight);
  const signs = simulation.signs.filter((sign) => layout.includesZ(sign.z)).map((sign) => {
    const [x, y] = layout.point(sign.x, sign.y, sign.z);
    return { text: String(sign.text).slice(0, 45), justification: sign.justification === "left" ? 0 : sign.justification === "right" ? 2 : 1, x, y };
  });
  const document = {
    origin: { majorVersion: OPS_VERSION, minorVersion: 0, buildNum: 0, modId: 0, releaseType: "R", platform: "WEB", ident: "Powder Toy 3D" },
    minimumVersion: { major: OPS_VERSION, minor: 0 },
    waterEEnabled: Boolean(simulation.waterEqualization), legacyEnable: !simulation.heatSimulationEnabled,
    gravityEnable: Boolean(simulation.newtonianGravityEnabled), aheat_enable: Boolean(simulation.air.ambientHeatEnabled),
    paused: Boolean(paused), gravityMode: Number(simulation.gravityMode) || 0, airMode: Number(simulation.air.mode) || 0,
    edgeMode: Number(simulation.edgeMode) || 0, ambientAirTemp: Number(simulation.air.ambientTemperature) + 273.15,
    edgePressure: Number(simulation.air.edgePressure) || 0, edgeVelocityX: Number(simulation.air.edgeVelocityX) || 0,
    edgeVelocityY: -(Number(simulation.air.edgeVelocityY) || 0), vorticityCoeff: Number(simulation.air.vorticityCoeff) || 0.1,
    convectionMode: Number(simulation.air.convectionMode) || 0,
    ...(simulation.gravityMode === 3 ? { customGravityX: Number(simulation.customGravity[0]) || 0, customGravityY: -(Number(simulation.customGravity[1]) || 0) } : {}),
    pmapbits: 8, parts: Uint8Array.from(partBytes), partsPos: positionBytes, palette,
    ...fields, ...(signs.length ? { signs } : {}),
  };
  const bson = bsonDocument(document);
  const compressed = Uint8Array.from(Bzip2.compressFile(bson, null, 1));
  const header = concat([
    Uint8Array.of(0x4f, 0x50, 0x53, 0x31, OPS_VERSION, CELL_SIZE, blockWidth, blockHeight),
    uint32(bson.length),
  ]);
  return {
    bytes: concat([header, compressed]),
    report: { mode, depth: mode === "slice" ? clamp(Math.round(depth), 0, simulation.depth - 1) : null, width: layout.width, height: layout.height, exported, omitted },
  };
}
