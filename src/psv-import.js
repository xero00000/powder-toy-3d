// SPDX-License-Identifier: GPL-3.0-or-later

import { MAT, UPSTREAM_LIFE_RULES, UPSTREAM_WALLS, materialById } from "./materials.js";
import { decodeBzip } from "./ops-import.js";
import { axisMap, depthOrder, particleBounds, placementColumns } from "./import-projection.js";

const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;
const textDecoder = new TextDecoder();
const PHOTON_DECORATION_FLAG = 0x08;
const MOVABLE_SPONGE_FLAG = 0x08;

const wallId = (identifier) => UPSTREAM_WALLS.find((wall) => wall.identifier === identifier)?.id ?? 0;
const LEGACY_WALLS = new Map([
  [1, wallId("DEFAULT_WL_WALL")],
  [2, wallId("DEFAULT_WL_ABSRB")],
  [3, wallId("DEFAULT_WL_LIQD")],
  [4, wallId("DEFAULT_WL_FAN")],
  [5, wallId("DEFAULT_WL_STRM")],
  [6, wallId("DEFAULT_WL_DTECT")],
  [7, wallId("DEFAULT_WL_EWALL")],
  [8, wallId("DEFAULT_WL_CNDTW")],
  [9, wallId("DEFAULT_WL_AIR")],
  [10, wallId("DEFAULT_WL_POWDR")],
  [11, wallId("DEFAULT_WL_CNDTR")],
  [12, wallId("DEFAULT_WL_EHOLE")],
  [13, wallId("DEFAULT_WL_GAS")],
]);
const MODERN_WALLS = new Map([
  [122, wallId("DEFAULT_WL_CNDTW")],
  [123, wallId("DEFAULT_WL_EWALL")],
  [124, wallId("DEFAULT_WL_DTECT")],
  [125, wallId("DEFAULT_WL_STRM")],
  [127, wallId("DEFAULT_WL_FAN")],
  [255, wallId("DEFAULT_WL_FAN")],
  [128, wallId("DEFAULT_WL_LIQD")],
  [129, wallId("DEFAULT_WL_ABSRB")],
  [130, wallId("DEFAULT_WL_ERASE")],
  [131, wallId("DEFAULT_WL_WALL")],
  [132, wallId("DEFAULT_WL_AIR")],
  [133, wallId("DEFAULT_WL_POWDR")],
  [134, wallId("DEFAULT_WL_CNDTR")],
  [135, wallId("DEFAULT_WL_EHOLE")],
  [140, wallId("DEFAULT_WL_GAS")],
  [142, wallId("DEFAULT_WL_GRVTY")],
  [145, wallId("DEFAULT_WL_ENRGY")],
]);
const OLD_LIFE_IDS = new Map([
  ...Array.from({ length: 12 }, (_, index) => [78 + index, index]),
  ...Array.from({ length: 7 }, (_, index) => [134 + index, 12 + index]),
  ...Array.from({ length: 5 }, (_, index) => [142 + index, 19 + index]),
]);
const CTYPE_TYPES = new Map([
  [MAT.CLNE, 0], [MAT.PCLN, 43], [MAT.BCLN, 44], [MAT.SPRK, 21], [MAT.LAVA, 34],
  [MAT.PIPE, 43], [MAT.LIFE, 51], [MAT.PBCN, 52], [MAT.WIRE, 55], [MAT.STOR, 59], [MAT.CONV, 60],
]);

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

function fail(message) {
  throw new Error(`PSv import: ${message}`);
}

function mapWall(raw, version) {
  if (!raw || (version >= 44 && version < 71 && raw === 126)) return 0;
  const legacy = LEGACY_WALLS.get(raw);
  if (legacy != null) return legacy;
  if (version >= 44) return MODERN_WALLS.get(raw) ?? 0;
  return 0;
}

function isFan(raw, version) {
  return raw === 4 || (version >= 44 && raw === 127);
}

function readHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16) fail("save is truncated");
  const magic = textDecoder.decode(bytes.subarray(0, 3));
  if (magic !== "PSv" && magic !== "fuC") fail("not a PSv or fuC save");
  const savedVersion = bytes[4];
  if (savedVersion > 97) fail(`unsupported version ${savedVersion}`);
  const cellSize = bytes[5];
  const blockWidth = bytes[6];
  const blockHeight = bytes[7];
  if (cellSize !== 4) fail(`unsupported cell size ${cellSize}`);
  if (!blockWidth || !blockHeight) fail("invalid save dimensions");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decompressedLength = view.getUint32(8, true);
  if (!decompressedLength || decompressedLength > MAX_DECOMPRESSED_BYTES) fail("invalid decompressed size");
  const flags = bytes[3];
  let legacyEnable = savedVersion < 34;
  let paused = false;
  let gravityMode = 0;
  let airMode = 0;
  let gravityEnable = false;
  let legacyBeta = false;
  if (savedVersion >= 44) {
    legacyEnable = Boolean(flags & 0x01);
    paused = Boolean(flags & 0x02);
    if (savedVersion >= 46) {
      gravityMode = (flags >> 2) & 0x03;
      airMode = (flags >> 4) & 0x07;
    }
    if (savedVersion >= 49) gravityEnable = Boolean(flags & 0x80);
  } else if (savedVersion >= 34) {
    if (flags === 0 || flags === 1) legacyEnable = Boolean(flags);
    else legacyBeta = true;
  }
  return {
    bytes, magic, savedVersion, cellSize, blockWidth, blockHeight, decompressedLength,
    legacyEnable, legacyBeta, paused, gravityMode, airMode, gravityEnable,
  };
}

class PayloadReader {
  constructor(data) {
    this.data = data;
    this.offset = 0;
  }

  require(length, context) {
    if (this.offset + length > this.data.length) fail(`truncated ${context}`);
  }

  byte(context) {
    this.require(1, context);
    return this.data[this.offset++];
  }

  be16(context) {
    this.require(2, context);
    const value = (this.data[this.offset] << 8) | this.data[this.offset + 1];
    this.offset += 2;
    return value;
  }

  le16(context) {
    this.require(2, context);
    const value = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }
}

function defaultParticle(type, sourceX, sourceY) {
  const material = materialById(type);
  return {
    sourceX, sourceY, savedType: type, type,
    temperature: material.defaultTemp ?? 22,
    life: material.defaultLife ?? 0,
    ctype: type === MAT.PHOT ? 0x3fffffff : type === MAT.BIZR || type === MAT.BIZRG || type === MAT.BIZRS ? 0x47ffff : 0,
    tmp: type === MAT.COAL || type === MAT.FUSE ? 50 : 0,
    tmp2: 0, tmp3: 0, tmp4: 0,
    velocityX: 0, velocityY: 0, velocityZ: 0,
    flags: 0, decoration: 0,
  };
}

function migrateParticle(particle, version) {
  const savedType = particle.savedType;
  if (version < 90 && particle.type === MAT.PHOT) particle.flags |= PHOTON_DECORATION_FLAG;
  if (version < 79 && particle.type === MAT.SPNG && (particle.velocityX || particle.velocityY)) particle.flags |= MOVABLE_SPONGE_FLAG;

  if (version < 48 && (savedType === 147 || (savedType === MAT.BRAY && particle.life === 0))) {
    particle.type = MAT.DMND;
    particle.decoration = 0xff000000;
  }
  if (version < 51 && OLD_LIFE_IDS.has(savedType)) {
    particle.type = MAT.LIFE;
    particle.ctype = OLD_LIFE_IDS.get(savedType);
  }
  if (version < 52 && (particle.type === MAT.CLNE || particle.type === MAT.PCLN || particle.type === MAT.BCLN) && OLD_LIFE_IDS.has(particle.ctype)) {
    particle.tmp = OLD_LIFE_IDS.get(particle.ctype);
    particle.ctype = MAT.LIFE;
  }
  if (particle.type === MAT.LIFE) {
    particle.tmp2 = particle.tmp;
    const rule = UPSTREAM_LIFE_RULES[particle.ctype];
    particle.tmp = rule?.gradientColor ?? 0;
    if (!particle.decoration && rule) particle.decoration = rule.color;
  }
  if (particle.type === MAT.LCRY) {
    if (version < 67) {
      if (particle.life >= 10) {
        particle.life = 10;
        particle.tmp2 = 10;
        particle.tmp = 3;
      } else if (particle.life <= 0) {
        particle.life = 0;
        particle.tmp2 = 0;
        particle.tmp = 0;
      } else particle.tmp = 1;
    } else particle.tmp2 = particle.life;
  }
  if (version < 81) {
    if (particle.type === MAT.BOMB && particle.tmp !== 0) {
      particle.type = MAT.EMBR;
      particle.ctype = 0;
      if (particle.tmp === 1) particle.tmp = 0;
    }
    if (particle.type === MAT.DUST && particle.life > 0) {
      particle.type = MAT.EMBR;
      particle.ctype = (particle.tmp2 << 16) | (particle.tmp << 8) | particle.ctype;
      particle.tmp = 1;
    }
    if (particle.type === MAT.FIRW && particle.tmp >= 2) {
      particle.type = MAT.EMBR;
      particle.ctype = fireworkGradient(particle.tmp - 4);
      particle.tmp = 1;
    }
  }
  if (version < 89) {
    if (particle.type === MAT.FILT) {
      if (particle.tmp < 0 || particle.tmp > 3) particle.tmp = 6;
      particle.ctype = 0;
    } else if (particle.type === MAT.QRTZ || particle.type === MAT.PQRT) {
      particle.tmp2 = particle.tmp;
      particle.tmp = particle.ctype;
      particle.ctype = 0;
    }
  }
  if (version < 91) {
    if (particle.type === MAT.VINE) particle.tmp = 1;
    else if (particle.type === MAT.CONV && particle.tmp) {
      particle.ctype |= particle.tmp << 8;
      particle.tmp = 0;
    }
  }
  if (version < 93) {
    if (particle.type === MAT.PIPE || particle.type === MAT.PPIP) {
      if (particle.ctype === 1) particle.tmp |= 0x00020000;
      particle.tmp |= (particle.ctype - 1) << 18;
      particle.ctype = particle.tmp & 0xff;
      particle.tmp &= ~0xff;
    } else if (particle.type === MAT.HSWC || particle.type === MAT.PUMP) particle.tmp = 0;
  }
  return particle;
}

function mapPsvPalette(particle) {
  const mapType = (type) => {
    if (type === MAT.EMPTY) return MAT.EMPTY;
    if (type < 1 || type > 160 || (type >= 144 && type <= 146)) return MAT.EMPTY;
    return materialById(type).id === type ? type : MAT.EMPTY;
  };
  particle.type = mapType(particle.type);
  if (particle.type === MAT.EMPTY) return particle;
  const material = materialById(particle.type);
  const mapPackedType = (value) => (value & ~0xff) | mapType(value & 0xff);
  if (material.carriesCtype) particle.ctype = mapPackedType(particle.ctype);
  if (material.carriesTmp) particle.tmp = mapPackedType(particle.tmp);
  return particle;
}

export function decodePsvPayload(input, metadata) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new PayloadReader(data);
  const { blockWidth, blockHeight, cellSize = 4, savedVersion: version, magic = "PSv", legacyBeta = false } = metadata;
  if (!blockWidth || !blockHeight || cellSize !== 4) fail("invalid payload dimensions");
  const blockCount = blockWidth * blockHeight;
  const sourceWidth = blockWidth * cellSize;
  const sourceHeight = blockHeight * cellSize;
  const particleCellCount = sourceWidth * sourceHeight;

  reader.require(blockCount, "wall map");
  const rawWalls = data.slice(reader.offset, reader.offset + blockCount);
  reader.offset += blockCount;
  const walls = Array.from(rawWalls, (raw) => mapWall(raw, version));
  const fanX = new Float32Array(blockCount);
  const fanY = new Float32Array(blockCount);
  for (let index = 0; index < blockCount; index += 1) if (isFan(rawWalls[index], version)) fanX[index] = (reader.byte("fan X map") - 127) / 64;
  for (let index = 0; index < blockCount; index += 1) if (isFan(rawWalls[index], version)) fanY[index] = -(reader.byte("fan Y map") - 127) / 64;

  reader.require(particleCellCount, "particle type map");
  const typePlane = data.slice(reader.offset, reader.offset + particleCellCount);
  reader.offset += particleCellCount;
  const particles = [];
  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
      const type = typePlane[sourceX + sourceY * sourceWidth];
      if (type) particles.push(defaultParticle(type, sourceX, sourceY));
    }
  }

  for (const particle of particles) {
    particle.velocityX = (reader.byte("particle velocity") - 127) / 16;
    particle.velocityY = -(reader.byte("particle velocity") - 127) / 16;
  }
  for (const particle of particles) particle.life = version >= 44 ? reader.be16("particle life") : reader.byte("particle life") * 4;
  if (version >= 44) {
    for (const particle of particles) {
      particle.tmp = reader.be16("particle tmp");
      if (version < 53 && particle.tmp === 0) {
        const ruleIndex = OLD_LIFE_IDS.get(particle.savedType);
        if (ruleIndex != null && (UPSTREAM_LIFE_RULES[ruleIndex].ruleset >> 17) === 0) particle.tmp = 1;
      }
      if (version >= 51 && version < 53 && particle.savedType === MAT.PBCN) {
        particle.tmp2 = particle.tmp;
        particle.tmp = 0;
      }
    }
  }
  if (version >= 53) {
    for (const particle of particles) {
      if (particle.savedType === MAT.PBCN || (particle.savedType === MAT.TRON && version >= 77)) particle.tmp2 = reader.byte("particle tmp2");
    }
  }
  if (version >= 49) {
    for (const shift of [24, 16, 8, 0]) {
      for (const particle of particles) particle.decoration = (particle.decoration | (reader.byte("particle decoration") << shift)) >>> 0;
    }
  }
  if (version >= 34 && !legacyBeta) {
    for (const particle of particles) {
      let kelvin;
      if (version >= 42 && magic === "PSv") kelvin = reader.be16("particle temperature");
      else if (version >= 42) kelvin = reader.byte("particle temperature") * 9999 / 255;
      else kelvin = reader.byte("particle temperature") * 3773 / 255;
      if (particle.savedType === MAT.PUMP && version >= 42 && magic === "PSv") kelvin += 0.15;
      particle.temperature = kelvin - 273.15;
    }
  }
  for (const particle of particles) {
    const minimumVersion = CTYPE_TYPES.get(particle.savedType);
    if (minimumVersion != null && version >= minimumVersion) particle.ctype = reader.byte("particle ctype");
    mapPsvPalette(migrateParticle(particle, version));
  }

  const signs = [];
  if (reader.offset < data.length) {
    const signCount = reader.byte("sign count");
    for (let index = 0; index < signCount; index += 1) {
      const x = reader.le16("sign X");
      const y = reader.le16("sign Y");
      const justification = reader.byte("sign justification");
      const length = reader.byte("sign text length");
      reader.require(length, "sign text");
      let text = textDecoder.decode(data.subarray(reader.offset, reader.offset + length));
      reader.offset += length;
      text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 45);
      if (text === "{t}") text = "Temp: {t}";
      else if (text === "{p}") text = "Pressure: {p}";
      signs.push({ x, y, justification: justification === 0 ? "left" : justification === 2 ? "right" : "center", text });
    }
  }
  if (reader.offset !== data.length) fail("payload has trailing bytes");
  return { sourceWidth, sourceHeight, rawWalls, walls, fanX, fanY, particles, signs };
}

export function applyPsvPayload(decoded, metadata, simulation, depth = Math.floor(simulation.depth / 2)) {
  const centerZ = Math.max(0, Math.min(simulation.depth - 1, Math.round(depth)));
  const mapper = axisMap(decoded.sourceWidth, decoded.sourceHeight, simulation, particleBounds(decoded.particles, decoded.sourceWidth, decoded.sourceHeight, MAT.EMPTY));
  const zOrder = depthOrder(simulation.depth, centerZ);
  simulation.clear();
  simulation.applySettings({
    gravityMode: metadata.savedVersion < 46 ? 0 : metadata.gravityMode,
    edgeMode: 1,
    heatSimulationEnabled: !metadata.legacyEnable,
    newtonianGravityEnabled: metadata.gravityEnable === true,
    waterEqualization: false,
    airMode: metadata.savedVersion < 46 ? 0 : Math.max(0, Math.min(4, metadata.airMode)),
    ambientTemperature: 22,
    ambientHeatEnabled: false,
    vorticityCoeff: 0.1,
    convectionMode: 1,
  });

  for (let by = 0; by < metadata.blockHeight; by += 1) {
    for (let bx = 0; bx < metadata.blockWidth; bx += 1) {
      const sourceIndex = bx + by * metadata.blockWidth;
      const wall = decoded.walls[sourceIndex];
      if (!wall && !decoded.fanX[sourceIndex] && !decoded.fanY[sourceIndex]) continue;
      const [x, y] = mapper.point(bx * metadata.cellSize + 1, by * metadata.cellSize + 1);
      const target = simulation.air.indexForVoxel(x, y, centerZ);
      if (wall) simulation.walls[target] = wall + 1;
      simulation.wallFanX[target] = decoded.fanX[sourceIndex];
      simulation.wallFanY[target] = decoded.fanY[sourceIndex];
    }
  }

  let imported = 0;
  let omitted = 0;
  let importedMatter = 0;
  let importedEnergy = 0;
  const matterColumns = new Uint16Array(simulation.width * simulation.height);
  const energyColumns = new Uint16Array(simulation.width * simulation.height);
  for (const particle of decoded.particles) {
    const material = materialById(particle.type);
    if (particle.type === MAT.EMPTY || material.id !== particle.type || !material.enabled) {
      omitted += 1;
      continue;
    }
    const [x, y] = mapper.point(particle.sourceX, particle.sourceY);
    const energy = material.state === "energy";
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
          velocityZ: 0, flags: particle.flags, decoration: particle.decoration,
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

  for (const sign of decoded.signs) {
    const [x, y] = mapper.point(sign.x, sign.y);
    simulation.addSign(x, y, centerZ, sign.text, 0x8feeff, sign.justification);
  }
  simulation.currentPreset = "legacy-import";
  simulation.tick = 0;
  simulation.air.updateBlocked(simulation);
  return {
    format: metadata.magic,
    savedVersion: metadata.savedVersion,
    sourceDimensions: [decoded.sourceWidth, decoded.sourceHeight],
    scale: mapper.scale,
    contentBounds: mapper.bounds,
    imported,
    omitted,
    total: decoded.particles.length,
    paused: metadata.paused,
  };
}

export function importPsv(input, simulation, depth) {
  const metadata = readHeader(input);
  let payload;
  try {
    payload = decodeBzip(metadata.bytes.subarray(12), metadata.decompressedLength);
  } catch (error) {
    fail(error instanceof Error ? error.message.replace(/^OPS import:\s*/i, "") : "cannot decompress payload");
  }
  const decoded = decodePsvPayload(payload, metadata);
  return applyPsvPayload(decoded, metadata, simulation, depth);
}
