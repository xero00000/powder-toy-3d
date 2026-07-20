// SPDX-License-Identifier: GPL-3.0-or-later

import {
  MAT, MATERIALS, UPSTREAM_LIFE_RULES, UPSTREAM_TOOLS, UPSTREAM_WALLS, materialById,
} from "./materials.js";
import { AirField3D } from "./air-field.js";
import { GravityField3D } from "./gravity-field.js";

const POWDERS = new Set(MATERIALS.filter((material) => material.render === "powder").map((material) => material.id));
const LIQUIDS = new Set(MATERIALS.filter((material) => material.render === "liquid").map((material) => material.id));
const GASES = new Set(MATERIALS.filter((material) => material.render === "gas").map((material) => material.id));
const CONDUCTORS = new Set(MATERIALS.filter((material) => material.properties.includes("PROP_CONDUCTS")).map((material) => material.id));
const isPowder = (type) => POWDERS.has(type) || materialById(type).render === "powder";
const isLiquid = (type) => LIQUIDS.has(type) || materialById(type).render === "liquid";
const isGas = (type) => GASES.has(type) || (materialById(type).render === "gas" && materialById(type).state !== "energy");
const isConductor = (type) => CONDUCTORS.has(type) || materialById(type).properties.includes("PROP_CONDUCTS");
const WALL_ID = Object.freeze(Object.fromEntries(UPSTREAM_WALLS.map((wall) => [wall.identifier, wall.id])));
const TOOL_ID = Object.freeze(Object.fromEntries(UPSTREAM_TOOLS.map((tool) => [tool.code, tool.id])));
const DIRECTIONS_2D = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];
const DIRECTIONS_6 = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const POWDER_FALL_DIRECTIONS = [
  [0, -1, 0], [-1, -1, 0], [1, -1, 0], [0, -1, -1], [0, -1, 1],
  [-1, -1, -1], [1, -1, -1], [-1, -1, 1], [1, -1, 1],
];
const PLANAR_SPREAD_DIRECTIONS = DIRECTIONS_2D.map(([dx, dz]) => [dx, 0, dz]);
const GAS_RISE_DIRECTIONS = [
  [0, 1, 0], [-1, 1, 0], [1, 1, 0], [0, 1, -1], [0, 1, 1],
  [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1],
];
const NO_DIRECTIONS = [];
const TRON_HEAD = 0x00000001;
const TRON_NOGROW = 0x00000002;
const TRON_WAIT = 0x00000004;
const TRON_NODIE = 0x00000008;
const TRON_DEATH = 0x00000010;
const TRON_NORANDOM = 0x00010000;
const TRON_DIRECTION_SHIFT = 5;
const TRON_DIRECTION_MASK = 0x7 << TRON_DIRECTION_SHIFT;
const TRON_TAIL_MASK = 0xf818;
const ACTOR_LEFT = 0x01;
const ACTOR_RIGHT = 0x02;
const ACTOR_JUMP = 0x04;
const ACTOR_EMIT = 0x08;
const ACTOR_FORWARD = 0x10;
const ACTOR_BACKWARD = 0x20;
const ACTOR_FAN = 0x0100;
const ACTOR_ROCKET_BOOTS = 0x0200;
const ACTOR_TYPES = new Set([MAT.STKM, MAT.STKM2, MAT.FIGH]);
const VIRUS_TYPES = new Set([MAT.VIRS, MAT.VRSS, MAT.VRSG]);
const DIRECTIONS_26 = [];
const SPARK_DIRECTIONS = [];
for (let dz = -2; dz <= 2; dz += 1) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= 1) DIRECTIONS_26.push([dx, dy, dz]);
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 5) SPARK_DIRECTIONS.push([dx, dy, dz]);
    }
  }
}
const OPPOSITE_DIRECTION_26 = DIRECTIONS_26.map(([dx, dy, dz]) => DIRECTIONS_26.findIndex(([ox, oy, oz]) => ox === -dx && oy === -dy && oz === -dz));
const POWERED_TOGGLE_CODES = ["PUMP", "GPMP", "HSWC", "PBCN", "PCLN", "PVOD", "PPIP"];
const POWERED_TOGGLES = new Set(POWERED_TOGGLE_CODES.map((code) => MAT[code]).filter(Number.isInteger));
const ANTIMATTER_IMMUNE = new Set([
  MAT.AMTR, MAT.DMND, MAT.CLNE, MAT.PCLN, MAT.VOID,
  MAT.BHOL, MAT.NBHL, MAT.PRTI, MAT.PRTO,
]);
const WALL_CONDUCTORS = new Set([
  WALL_ID.DEFAULT_WL_CNDTW, WALL_ID.DEFAULT_WL_EWALL, WALL_ID.DEFAULT_WL_DTECT,
  WALL_ID.DEFAULT_WL_LIQD, WALL_ID.DEFAULT_WL_CNDTR, WALL_ID.DEFAULT_WL_EHOLE,
  WALL_ID.DEFAULT_WL_STASIS,
]);
const GLASS_TYPES = new Set([MAT.GLAS, MAT.BGLA]);
const PHOTON_WAVELENGTH_MASK = 0x3fffffff;
const GLASS_IOR = 1.9;
const GLASS_DISPERSION = 0.07;
const MAX_PARTICLE_VELOCITY = 1e4;
const PLANT_PHASE_SHIFT = 1;
const PLANT_DIRECTION_SHIFT = 3;
const PLANT_COLOR_SHIFT = 6;
const PLANT_WATER_SHIFT = 12;
const PLANT_GENOME_BITS = 15;
const UPSTREAM_FLAMMABILITY = new Map([
  [MAT.ACID, 40], [MAT.DESL, 2], [MAT.DUST, 10], [MAT.DYST, 20], [MAT.GAS, 600],
  [MAT.GRAV, 10], [MAT.GUNP, 600], [MAT.INSL, 7], [MAT.LO2, 5000], [MAT.LRBD, 1000],
  [MAT.MWAX, 5], [MAT.NITR, 1000], [MAT.OIL, 20], [MAT.PLNT, 20], [MAT.PLEX, 1000],
  [MAT.RBDM, 1000], [MAT.SAWD, 10], [MAT.SPNG, 20], [MAT.VINE, 20], [MAT.VRSG, 500],
  [MAT.WOOD, 20], [MAT.YEST, 15],
]);

const fireworkGradient = (index) => {
  const stops = [0xff00ff, 0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff0000];
  const clamped = Math.max(0, Math.min(199, index));
  const segment = Math.min(4, Math.floor(clamped / 40));
  const alpha = Math.trunc(((clamped - segment * 40) / 40) * 255);
  const left = stops[segment];
  const right = stops[segment + 1];
  const blend = (shift) => Math.trunc(((255 - alpha) * ((left >> shift) & 0xff) + alpha * ((right >> shift) & 0xff)) / 255);
  return (blend(16) << 16) | (blend(8) << 8) | blend(0);
};

export const PIPE_FLAG = Object.freeze({
  CAN_CONDUCT: 0x00000001,
  PARTICLE_DECO: 0x00000002,
  COLOR_RED: 0x00040000,
  COLOR_GREEN: 0x00080000,
  COLOR_BLUE: 0x000c0000,
  COLORS: 0x000c0000,
  REVERSED: 0x01000000,
  PAUSED: 0x02000000,
});

export const DECORATION_MODE = Object.freeze({
  DRAW: 0,
  CLEAR: 1,
  ADD: 2,
  SUBTRACT: 3,
  MULTIPLY: 4,
  DIVIDE: 5,
  SMUDGE: 6,
});

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
const srgbToLinear = (value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const linearToSrgbByte = (value) => {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return clampByte(channel * 255);
};
const decorationToWorking = (value, colorSpace) => {
  const channel = value / 255;
  if (colorSpace === 1) return channel;
  if (colorSpace === 2) return channel ** 2.2;
  if (colorSpace === 3) return channel ** 1.8;
  return srgbToLinear(value);
};
const decorationFromWorking = (value, colorSpace) => {
  if (colorSpace === 1) return clampByte(value * 255);
  if (colorSpace === 2) return clampByte(value ** (1 / 2.2) * 255);
  if (colorSpace === 3) return clampByte(value ** (1 / 1.8) * 255);
  return linearToSrgbByte(value);
};
const PARTICLE_PROPERTY_FIELDS = Object.freeze({
  life: ["life", "energyLife"],
  ctype: ["ctype", "energyCtype"],
  vx: ["velocityX", "energyVelocityX"],
  vy: ["velocityY", "energyVelocityY"],
  vz: ["velocityZ", "energyVelocityZ"],
  temp: ["temperatures", "energyTemperatures"],
  flags: ["flags", "energyFlags"],
  tmp: ["tmp", "energyTmp"],
  tmp2: ["tmp2", "energyTmp2"],
  tmp3: ["tmp3", "energyTmp3"],
  tmp4: ["tmp4", "energyTmp4"],
  dcolour: ["decorations", "energyDecorations"],
});

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const floatBitsView = new DataView(new ArrayBuffer(4));
function floatToBits(value) {
  floatBitsView.setFloat32(0, value, true);
  return floatBitsView.getInt32(0, true);
}
function bitsToFloat(value) {
  floatBitsView.setInt32(0, value, true);
  return floatBitsView.getFloat32(0, true);
}
const packVelocityPair = (first, second) => ((Math.trunc(first * 255) & 0xffff) | ((Math.trunc(second * 255) & 0xffff) << 16)) | 0;
const unpackVelocityLow = (value) => ((value << 16) >> 16) / 255;
const unpackVelocityHigh = (value) => (value >> 16) / 255;

export class VoxelSimulation {
  constructor(width = 48, height = 36, depth = 28, seed = 0x50d3f00d) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.size = width * height * depth;
    this.types = new Uint8Array(this.size);
    this.temperatures = new Float32Array(this.size);
    this.life = new Int32Array(this.size);
    this.ctype = new Int32Array(this.size);
    this.tmp = new Int32Array(this.size);
    this.tmp2 = new Int32Array(this.size);
    this.tmp3 = new Int32Array(this.size);
    this.tmp4 = new Int32Array(this.size);
    this.velocityX = new Float32Array(this.size);
    this.velocityY = new Float32Array(this.size);
    this.velocityZ = new Float32Array(this.size);
    this.flags = new Uint32Array(this.size);
    this.decorations = new Uint32Array(this.size);
    this.processed = new Uint16Array(this.size);
    this.energyTypes = new Uint8Array(this.size);
    this.energyTemperatures = new Float32Array(this.size);
    this.energyLife = new Int32Array(this.size);
    this.energyCtype = new Int32Array(this.size);
    this.energyTmp = new Int32Array(this.size);
    this.energyTmp2 = new Int32Array(this.size);
    this.energyTmp3 = new Int32Array(this.size);
    this.energyTmp4 = new Int32Array(this.size);
    this.energyVelocityX = new Float32Array(this.size);
    this.energyVelocityY = new Float32Array(this.size);
    this.energyVelocityZ = new Float32Array(this.size);
    this.energyFlags = new Uint32Array(this.size);
    this.energyDecorations = new Uint32Array(this.size);
    this.energyProcessed = new Uint16Array(this.size);
    this.temperatures.fill(22);
    this.energyTemperatures.fill(22);
    this.particleFields = [
      this.types, this.temperatures, this.life, this.ctype, this.tmp, this.tmp2, this.tmp3, this.tmp4,
      this.velocityX, this.velocityY, this.velocityZ, this.flags, this.decorations,
    ];
    this.energyFields = [
      this.energyTypes, this.energyTemperatures, this.energyLife, this.energyCtype,
      this.energyTmp, this.energyTmp2, this.energyTmp3, this.energyTmp4, this.energyVelocityX, this.energyVelocityY,
      this.energyVelocityZ, this.energyFlags, this.energyDecorations,
    ];
    this.air = new AirField3D(width, height, depth, 4);
    this.gravity = new GravityField3D(width, height, depth, 4);
    this.gravityMode = 0;
    this.customGravity = [0, -1, 0];
    this.edgeMode = 1;
    this.heatSimulationEnabled = true;
    this.newtonianGravityEnabled = true;
    this.waterEqualization = false;
    this.decorationColorSpace = 0;
    this.ids = MAT;
    this.wallIds = WALL_ID;
    this.walls = new Uint8Array(this.air.size); // 0 = no wall; stored wall values are upstream IDs + 1.
    this.wallElectricity = new Uint8Array(this.air.size);
    this.wallFanX = new Float32Array(this.air.size);
    this.wallFanY = new Float32Array(this.air.size);
    this.wallFanZ = new Float32Array(this.air.size);
    this.wireless = new Uint8Array(100);
    this.wirelessNext = new Uint8Array(100);
    this.portalQueues = Array.from({ length: 100 }, () => Array.from({ length: DIRECTIONS_26.length }, () => []));
    this.actorCommands = new Uint8Array(2);
    this.actorSpawns = [null, null];
    this.actorPortalLocks = [false, false];
    this.signs = [];
    this.signVersion = 1;
    this.tick = 0;
    this.epoch = 1;
    this.random = mulberry32(seed);
    this.customElementUpdate = null;
    this.customElementUpdateTypes = null;
    this.customElementGraphics = null;
    this.customElementGraphicsTypes = null;
    this.activity = { moves: 0, reactions: 0, explosions: 0 };
    this.currentPreset = "foundry";
    this._stats = { active: 0, hot: 0, peakTemp: 22, moves: 0, reactions: 0, explosions: 0 };
  }

  index(x, y, z) {
    return x + this.width * (y + this.height * z);
  }

  coords(index) {
    const z = Math.floor(index / (this.width * this.height));
    const layerIndex = index - z * this.width * this.height;
    const y = Math.floor(layerIndex / this.width);
    return [layerIndex - y * this.width, y, z];
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth;
  }

  get(x, y, z) {
    return this.inBounds(x, y, z) ? this.types[this.index(x, y, z)] : MAT.STONE;
  }

  materialAt(type) {
    return materialById(type);
  }

  set(x, y, z, type, temperature = materialById(type).defaultTemp ?? 22, life, properties = {}) {
    if (!this.inBounds(x, y, z)) return false;
    if (materialById(type).state === "energy") return this.setEnergy(x, y, z, type, temperature, life, properties);
    const index = this.index(x, y, z);
    if (type === MAT.STKM || type === MAT.STKM2) {
      const existing = this.types.indexOf(type);
      if (existing >= 0 && existing !== index) return false;
      const player = type === MAT.STKM ? 0 : 1;
      if (!this.actorSpawns[player]) this.actorSpawns[player] = [x, y, z];
      this.actorPortalLocks[player] = false;
    } else if (type === MAT.FIGH && this.types[index] !== MAT.FIGH) {
      let fighters = 0;
      for (const existingType of this.types) if (existingType === MAT.FIGH) fighters += 1;
      if (fighters >= 100) return false;
    }
    // set() recreates the particle at this voxel. SOAP topology belongs to the
    // old particle, even when the replacement is another SOAP particle.
    if (this.types[index] === MAT.SOAP) this.detachSoap(index);
    this.types[index] = type;
    this.temperatures[index] = type === MAT.EMPTY ? 22 : temperature;
    this.life[index] = type === MAT.EMPTY ? 0 : (life ?? materialById(type).defaultLife ?? 0);
    const material = materialById(type);
    this.ctype[index] = type === MAT.EMPTY ? 0 : (properties.ctype ?? material.defaultCtype ?? 0);
    this.tmp[index] = type === MAT.EMPTY ? 0 : (properties.tmp ?? material.defaultTmp ?? 0);
    this.tmp2[index] = type === MAT.EMPTY ? 0 : (properties.tmp2 ?? material.defaultTmp2 ?? 0);
    this.tmp3[index] = type === MAT.EMPTY ? 0 : (properties.tmp3 ?? material.defaultTmp3 ?? 0);
    this.tmp4[index] = type === MAT.EMPTY ? 0 : (properties.tmp4 ?? material.defaultTmp4 ?? 0);
    this.velocityX[index] = type === MAT.EMPTY ? 0 : (properties.velocityX ?? 0);
    this.velocityY[index] = type === MAT.EMPTY ? 0 : (properties.velocityY ?? 0);
    this.velocityZ[index] = type === MAT.EMPTY ? 0 : (properties.velocityZ ?? 0);
    this.flags[index] = type === MAT.EMPTY ? 0 : (properties.flags ?? 0);
    this.decorations[index] = type === MAT.EMPTY ? 0 : (properties.decoration ?? 0);
    // Upstream create callbacks seed pressure history and per-particle visual state.
    if (type === MAT.QRTZ) {
      if (!Object.hasOwn(properties, "tmp2")) this.tmp2[index] = Math.floor(this.random() * 11);
      if (!Object.hasOwn(properties, "tmp3")) this.tmp3[index] = Math.trunc(this.air.sampleVoxel(x, y, z).pressure * 64);
    } else if (type === MAT.PQRT && !Object.hasOwn(properties, "tmp2")) {
      this.tmp2[index] = Math.floor(this.random() * 11);
    } else if (type === MAT.TUNG && !Object.hasOwn(properties, "tmp3")) {
      this.tmp3[index] = Math.trunc(this.air.sampleVoxel(x, y, z).pressure * 64);
    } else if (type === MAT.CRMC && !Object.hasOwn(properties, "tmp2")) {
      this.tmp2[index] = Math.floor(this.random() * 5);
    } else if (type === MAT.CLST && !Object.hasOwn(properties, "tmp")) {
      this.tmp[index] = Math.floor(this.random() * 7);
    } else if (type === MAT.SLCN && !Object.hasOwn(properties, "tmp")) {
      this.tmp[index] = 0x100000 + Math.floor(this.random() * 0x900000);
    } else if (type === MAT.PTNM && !Object.hasOwn(properties, "tmp") && this.random() < 1 / 15) {
      this.tmp[index] = 1;
    } else if (type === MAT.FIRE && life === undefined) {
      this.life[index] = 120 + Math.min(49, Math.floor(this.random() * 50));
    } else if (type === MAT.PLSM && life === undefined) {
      this.life[index] = 50 + Math.min(149, Math.floor(this.random() * 150));
    } else if (type === MAT.CFLM && life === undefined) {
      this.life[index] = 50 + Math.min(149, Math.floor(this.random() * 150));
    } else if (type === MAT.LAVA && life === undefined) {
      this.life[index] = 240 + Math.min(119, Math.floor(this.random() * 120));
    } else if (type === MAT.WARP && life === undefined) {
      this.life[index] = 70 + Math.min(94, Math.floor(this.random() * 95));
    } else if (type === MAT.SING && life === undefined) {
      this.life[index] = 60 + Math.floor(this.random() * 50);
    } else if (type === MAT.SEED) {
      if (!Object.hasOwn(properties, "ctype")) {
        this.ctype[index] = 0b111011000000;
        const [gx, gy, gz] = this.gravityVectorAt(x, y, z);
        const gravity = this.gravity.sampleVoxel(x, y, z);
        if (Math.hypot(gx + gravity.forceX, gy + gravity.forceY, gz + gravity.forceZ) < 0.0001) {
          this.ctype[index] |= Math.floor(this.random() * 8) << PLANT_DIRECTION_SHIFT;
        }
      }
      for (const [field, name] of [[this.tmp, "tmp"], [this.tmp2, "tmp2"], [this.tmp3, "tmp3"], [this.tmp4, "tmp4"]]) {
        if (Object.hasOwn(properties, name)) continue;
        field[index] = 0;
        for (let bit = 0; bit < PLANT_GENOME_BITS; bit += 1) if (this.random() < 0.5) field[index] |= 1 << bit;
      }
    } else if (type === MAT.LIGH) {
      this.life[index] = Math.max(0, Math.min(55, this.life[index] || 30));
      if (!Object.hasOwn(properties, "tmp")) {
        let [gx, gy, gz] = this.gravityVectorAt(x, y, z);
        let magnitude = Math.hypot(gx, gy, gz);
        if (magnitude < 0.04) {
          const azimuth = this.random() * Math.PI * 2;
          const elevation = (this.random() - 0.5) * Math.PI;
          const jitter = 0.04 - magnitude;
          gx += Math.cos(azimuth) * Math.cos(elevation) * jitter;
          gy += Math.sin(elevation) * jitter;
          gz += Math.sin(azimuth) * Math.cos(elevation) * jitter;
          magnitude = Math.hypot(gx, gy, gz);
        }
        this.tmp[index] = Math.round(Math.atan2(-gy, gx) * 180 / Math.PI + (this.random() * 41 - 20));
        this.tmp3[index] = Math.round(Math.atan2(gz, Math.hypot(gx, gy)) * 180 / Math.PI + (this.random() * 31 - 15));
      }
      if (!Object.hasOwn(properties, "tmp2")) {
        this.tmp2[index] = 4;
        this.temperatures[index] = Math.max(-273.15, Math.min(9725.85, this.life[index] * 150 - 273.15));
      }
    } else if (type === MAT.MORT && !Object.hasOwn(properties, "velocityX")) {
      this.velocityX[index] = 2;
    } else if (type === MAT.TRON && !Object.hasOwn(properties, "tmp")) {
      const direction = Math.floor(this.random() * DIRECTIONS_6.length);
      const hue = Math.floor(this.random() * 360);
      this.tmp[index] = TRON_HEAD | (direction << TRON_DIRECTION_SHIFT) | (hue << 7);
      if (!Object.hasOwn(properties, "tmp2")) this.tmp2[index] = 4;
      if (life === undefined) this.life[index] = 5;
    } else if (ACTOR_TYPES.has(type)) {
      if (!Object.hasOwn(properties, "ctype") || !this.ctype[index]) this.ctype[index] = MAT.DUST;
      if (!Object.hasOwn(properties, "tmp4")) this.tmp4[index] = 1;
    }
    return true;
  }

  getEnergy(x, y, z) {
    return this.inBounds(x, y, z) ? this.energyTypes[this.index(x, y, z)] : MAT.EMPTY;
  }

  setEnergy(x, y, z, type, temperature = materialById(type).defaultTemp ?? 22, life, properties = {}) {
    if (!this.inBounds(x, y, z) || (type !== MAT.EMPTY && materialById(type).state !== "energy")) return false;
    const index = this.index(x, y, z);
    if (type === MAT.EMPTY) {
      for (const field of this.energyFields) field[index] = 0;
      this.energyTemperatures[index] = 22;
      return true;
    }
    const material = materialById(type);
    const angle = this.random() * Math.PI * 2;
    const elevation = (this.random() - 0.5) * Math.PI * 0.72;
    const speed = type === MAT.PHOT ? 3 : type === MAT.NEUT ? 1.5 + this.random() * 0.5 : 2;
    const defaultLife = type === MAT.NEUT ? 480 + Math.floor(this.random() * 480)
      : type === MAT.ELEC || type === MAT.PROT ? 680
        : type === MAT.GRVT ? 250 + Math.floor(this.random() * 200)
          : material.defaultLife;
    this.energyTypes[index] = type;
    this.energyTemperatures[index] = temperature;
    this.energyLife[index] = life ?? defaultLife ?? 0;
    this.energyCtype[index] = properties.ctype ?? (type === MAT.PHOT ? 0x3fffffff : 0);
    this.energyTmp[index] = properties.tmp ?? material.defaultTmp ?? 0;
    this.energyTmp2[index] = properties.tmp2 ?? material.defaultTmp2 ?? 0;
    this.energyTmp3[index] = properties.tmp3 ?? material.defaultTmp3 ?? 0;
    this.energyTmp4[index] = properties.tmp4 ?? material.defaultTmp4 ?? 0;
    this.energyVelocityX[index] = properties.velocityX ?? Math.cos(angle) * Math.cos(elevation) * speed;
    this.energyVelocityY[index] = properties.velocityY ?? Math.sin(elevation) * speed;
    this.energyVelocityZ[index] = properties.velocityZ ?? Math.sin(angle) * Math.cos(elevation) * speed;
    this.energyFlags[index] = properties.flags ?? 0;
    this.energyDecorations[index] = properties.decoration ?? 0;
    return true;
  }

  clear() {
    this.types.fill(MAT.EMPTY);
    this.temperatures.fill(22);
    this.life.fill(0);
    this.ctype.fill(0);
    this.tmp.fill(0);
    this.tmp2.fill(0);
    this.tmp3.fill(0);
    this.tmp4.fill(0);
    this.velocityX.fill(0);
    this.velocityY.fill(0);
    this.velocityZ.fill(0);
    this.flags.fill(0);
    this.decorations.fill(0);
    this.processed.fill(0);
    this.energyTypes.fill(MAT.EMPTY);
    this.energyTemperatures.fill(22);
    this.energyLife.fill(0);
    this.energyCtype.fill(0);
    this.energyTmp.fill(0);
    this.energyTmp2.fill(0);
    this.energyTmp3.fill(0);
    this.energyTmp4.fill(0);
    this.energyVelocityX.fill(0);
    this.energyVelocityY.fill(0);
    this.energyVelocityZ.fill(0);
    this.energyFlags.fill(0);
    this.energyDecorations.fill(0);
    this.energyProcessed.fill(0);
    this.air.clear();
    this.gravity.clear();
    this.walls.fill(0);
    this.wallElectricity.fill(0);
    this.wallFanX.fill(0);
    this.wallFanY.fill(0);
    this.wallFanZ.fill(0);
    this.wireless.fill(0);
    this.wirelessNext.fill(0);
    this.actorCommands.fill(0);
    this.actorSpawns = [null, null];
    this.actorPortalLocks = [false, false];
    this.signs = [];
    this.signVersion += 1;
    for (const channel of this.portalQueues) for (const queue of channel) queue.length = 0;
    this.tick = 0;
    this.epoch = 1;
    this.activity = { moves: 0, reactions: 0, explosions: 0 };
  }

  brushContains(dx, dy, dz, radius, shape = "sphere") {
    if (shape === "cube") return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= radius;
    if (shape === "diamond") return Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= radius;
    if (shape === "disc") return dz === 0 && dx * dx + dy * dy <= radius * radius + 0.35;
    return dx * dx + dy * dy + dz * dz <= radius * radius + 0.35;
  }

  paintSphere(cx, cy, cz, radius, type, overwrite = false, properties = {}, shape = "sphere") {
    if (type === MAT.LIGH) {
      if (!this.inBounds(cx, cy, cz)) return 0;
      const index = this.index(cx, cy, cz);
      if (!overwrite && this.types[index] !== MAT.EMPTY) return 0;
      const power = Math.max(1, Math.min(55, Math.round(radius) * 3));
      return this.set(cx, cy, cz, type, materialById(type).defaultTemp, power, properties) ? 1 : 0;
    }
    if (type === MAT.TESC && !Object.hasOwn(properties, "tmp")) {
      properties = { ...properties, tmp: Math.min(300, Math.max(7, Math.round(radius) * 12 + 7)) };
    }
    let painted = 0;
    for (let z = Math.max(0, cz - radius); z <= Math.min(this.depth - 1, cz + radius); z += 1) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y += 1) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(this.width - 1, cx + radius); x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          const dz = z - cz;
          if (!this.brushContains(dx, dy, dz, radius, shape)) continue;
          const index = this.index(x, y, z);
          const isEnergy = materialById(type).state === "energy";
          const emptyTarget = isEnergy ? this.energyTypes[index] === MAT.EMPTY : this.types[index] === MAT.EMPTY;
          if (type === MAT.EMPTY || overwrite || emptyTarget) {
            if (type === MAT.EMPTY) {
              this.set(x, y, z, MAT.EMPTY);
              this.setEnergy(x, y, z, MAT.EMPTY);
            } else if (isEnergy) this.setEnergy(x, y, z, type, materialById(type).defaultTemp, undefined, properties);
            else this.set(x, y, z, type, materialById(type).defaultTemp, undefined, properties);
            painted += 1;
          }
        }
      }
    }
    return painted;
  }

  decorationTargetAt(index) {
    if (this.types[index] !== MAT.EMPTY) return { field: this.decorations, energy: false };
    if (this.energyTypes[index] !== MAT.EMPTY) return { field: this.energyDecorations, energy: true };
    return null;
  }

  smudgedDecoration(index, energyLayer) {
    const [x, y, z] = this.coords(index);
    const types = energyLayer ? this.energyTypes : this.types;
    const decorations = energyLayer ? this.energyDecorations : this.decorations;
    const totals = [0, 0, 0, 0];
    let count = 0;
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2 || !this.inBounds(x + dx, y + dy, z + dz)) continue;
          const neighbor = this.index(x + dx, y + dy, z + dz);
          const decoration = decorations[neighbor] >>> 0;
          if (types[neighbor] === MAT.EMPTY || decoration === 0) continue;
          totals[0] += decorationToWorking(decoration >>> 24, this.decorationColorSpace);
          totals[1] += decorationToWorking((decoration >>> 16) & 0xff, this.decorationColorSpace);
          totals[2] += decorationToWorking((decoration >>> 8) & 0xff, this.decorationColorSpace);
          totals[3] += decorationToWorking(decoration & 0xff, this.decorationColorSpace);
          count += 1;
        }
      }
    }
    if (!count) return null;
    const channels = totals.map((value) => decorationFromWorking(value / count, this.decorationColorSpace));
    if (decorations[index] === 0) channels[0] = Math.max(0, channels[0] - 3);
    return ((channels[0] << 24) | (channels[1] << 16) | (channels[2] << 8) | channels[3]) >>> 0;
  }

  applyDecorationAt(index, color, mode = DECORATION_MODE.DRAW) {
    const target = this.decorationTargetAt(index);
    if (!target) return false;
    const source = target.field[index] >>> 0;
    const sourceChannels = [source >>> 24, (source >>> 16) & 0xff, (source >>> 8) & 0xff, source & 0xff];
    const brush = [color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff];
    let result;
    if (mode === DECORATION_MODE.DRAW) result = color >>> 0;
    else if (mode === DECORATION_MODE.CLEAR) result = 0;
    else if (mode === DECORATION_MODE.SMUDGE) {
      result = this.smudgedDecoration(index, target.energy);
      if (result == null) return false;
    } else {
      const alpha = brush[0] / 255;
      const channels = [...sourceChannels];
      for (let channel = 1; channel < 4; channel += 1) {
        const blend = (brush[channel] / 255) * 0.01 * alpha;
        if (mode === DECORATION_MODE.ADD) channels[channel] = sourceChannels[channel] + blend * 255;
        else if (mode === DECORATION_MODE.SUBTRACT) channels[channel] = sourceChannels[channel] - blend * 255;
        else if (mode === DECORATION_MODE.MULTIPLY) channels[channel] = sourceChannels[channel] * (1 + blend);
        else if (mode === DECORATION_MODE.DIVIDE) channels[channel] = sourceChannels[channel] / (1 + blend);
      }
      result = ((clampByte(channels[0]) << 24) | (clampByte(channels[1]) << 16) | (clampByte(channels[2]) << 8) | clampByte(channels[3])) >>> 0;
    }
    target.field[index] = result;
    return result !== source;
  }

  paintDecorationSphere(cx, cy, cz, radius, color, mode = DECORATION_MODE.DRAW, shape = "sphere") {
    let changed = 0;
    for (let z = Math.max(0, cz - radius); z <= Math.min(this.depth - 1, cz + radius); z += 1) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y += 1) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(this.width - 1, cx + radius); x += 1) {
          if (!this.brushContains(x - cx, y - cy, z - cz, radius, shape)) continue;
          if (this.applyDecorationAt(this.index(x, y, z), color, mode)) changed += 1;
        }
      }
    }
    return changed;
  }

  particleLayerAt(index) {
    if (this.types[index] !== MAT.EMPTY) return false;
    if (this.energyTypes[index] !== MAT.EMPTY) return true;
    return null;
  }

  applyParticlePropertyAt(index, property, value) {
    if (index < 0 || index >= this.size) return false;
    const energy = this.particleLayerAt(index);
    if (energy == null) return false;
    if (property === "x" || property === "y" || property === "z") {
      const coordinates = this.coords(index);
      const axis = property === "x" ? 0 : property === "y" ? 1 : 2;
      coordinates[axis] = Math.round(value);
      if (!this.inBounds(...coordinates)) return false;
      const target = this.index(...coordinates);
      if (target === index) return false;
      if (energy) return this.moveEnergy(index, target);
      if (this.types[target] !== MAT.EMPTY) return false;
      return this.move(index, target);
    }
    if (property === "type") {
      const nextType = Math.trunc(value);
      const material = materialById(nextType);
      if (material.id !== nextType) return false;
      const currentType = energy ? this.energyTypes[index] : this.types[index];
      if (nextType === currentType) return false;
      if (nextType === MAT.EMPTY) return energy ? this.killEnergy(index) : this.set(...this.coords(index), MAT.EMPTY);
      const nextEnergy = material.state === "energy";
      const particle = this.portalParticleState(index, energy);
      const [x, y, z] = this.coords(index);
      const properties = {
        ctype: particle.ctype, tmp: particle.tmp, tmp2: particle.tmp2, tmp3: particle.tmp3, tmp4: particle.tmp4,
        velocityX: particle.velocityX, velocityY: particle.velocityY, velocityZ: particle.velocityZ,
        flags: particle.flags, decoration: particle.decoration,
      };
      if (nextEnergy === energy) {
        return energy
          ? this.setEnergy(x, y, z, nextType, particle.temperature, particle.life, properties)
          : this.set(x, y, z, nextType, particle.temperature, particle.life, properties);
      }
      if (nextEnergy && this.energyTypes[index] !== MAT.EMPTY) return false;
      if (!nextEnergy && this.types[index] !== MAT.EMPTY) return false;
      const created = nextEnergy
        ? this.setEnergy(x, y, z, nextType, particle.temperature, particle.life, properties)
        : this.set(x, y, z, nextType, particle.temperature, particle.life, properties);
      if (!created) return false;
      if (energy) this.killEnergy(index);
      else this.set(x, y, z, MAT.EMPTY);
      return true;
    }
    const fields = PARTICLE_PROPERTY_FIELDS[property];
    if (!fields) return false;
    const field = this[fields[energy ? 1 : 0]];
    let normalized = value;
    if (property === "temp") normalized = Math.max(-273.15, Math.min(9725.85, Number(value)));
    else if (property === "flags" || property === "dcolour") normalized = Number(value) >>> 0;
    else if (!["vx", "vy", "vz"].includes(property)) normalized = Math.trunc(value);
    if (!Number.isFinite(normalized)) return false;
    if (field[index] === normalized) return false;
    field[index] = normalized;
    return true;
  }

  paintPropertySphere(cx, cy, cz, radius, property, value, shape = "sphere") {
    let changed = 0;
    for (let z = Math.max(0, cz - radius); z <= Math.min(this.depth - 1, cz + radius); z += 1) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y += 1) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(this.width - 1, cx + radius); x += 1) {
          if (!this.brushContains(x - cx, y - cy, z - cz, radius, shape)) continue;
          if (this.applyParticlePropertyAt(this.index(x, y, z), property, value)) changed += 1;
        }
      }
    }
    return changed;
  }

  addSign(x, y, z, text, color = 0x8feeff, justification = "center") {
    const cleaned = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 96);
    if (!cleaned || !this.inBounds(x, y, z) || this.signs.length >= 32) return false;
    const alignment = ["left", "center", "right"].includes(justification) ? justification : "center";
    const existing = this.signs.find((sign) => sign.x === x && sign.y === y && sign.z === z);
    if (existing) {
      existing.text = cleaned;
      existing.color = color >>> 0;
      existing.justification = alignment;
    } else this.signs.push({ x, y, z, text: cleaned, color: color >>> 0, justification: alignment });
    this.signVersion += 1;
    return true;
  }

  removeSignsInSphere(cx, cy, cz, radius) {
    const before = this.signs.length;
    this.signs = this.signs.filter((sign) => (sign.x - cx) ** 2 + (sign.y - cy) ** 2 + (sign.z - cz) ** 2 > radius ** 2 + 0.35);
    if (this.signs.length !== before) this.signVersion += 1;
    return before - this.signs.length;
  }

  fillBox(x0, y0, z0, x1, y1, z1, type, temperature) {
    for (let z = Math.max(0, z0); z <= Math.min(this.depth - 1, z1); z += 1) {
      for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y += 1) {
        for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x += 1) {
          this.set(x, y, z, type, temperature);
        }
      }
    }
  }

  wallAtVoxel(x, y, z) {
    const encoded = this.walls[this.air.indexForVoxel(x, y, z)];
    return encoded === 0 ? null : encoded - 1;
  }

  wallAllows(type, x, y, z) {
    const wall = this.wallAtVoxel(x, y, z);
    if (wall == null || [
      WALL_ID.DEFAULT_WL_NOAIR, WALL_ID.DEFAULT_WL_CNDTR, WALL_ID.DEFAULT_WL_DTECT,
      WALL_ID.DEFAULT_WL_STRM, WALL_ID.DEFAULT_WL_FAN, WALL_ID.DEFAULT_WL_GRVTY,
    ].includes(wall)) return true;
    if (wall === WALL_ID.DEFAULT_WL_EWALL) return this.wallElectricity[this.air.indexForVoxel(x, y, z)] > 0;
    if (wall === WALL_ID.DEFAULT_WL_STASIS) return true;
    const material = materialById(type);
    if (wall === WALL_ID.DEFAULT_WL_LIQD) return material.render === "liquid";
    if (wall === WALL_ID.DEFAULT_WL_POWDR) return material.render === "powder";
    if (wall === WALL_ID.DEFAULT_WL_GAS) return material.render === "gas" && material.state !== "energy";
    if (wall === WALL_ID.DEFAULT_WL_ENRGY) return material.state === "energy";
    if (wall === WALL_ID.DEFAULT_WL_ABSRB || wall === WALL_ID.DEFAULT_WL_EHOLE) return true;
    return false;
  }

  wallPoweredAtVoxel(x, y, z) {
    return this.wallElectricity[this.air.indexForVoxel(x, y, z)] >= 8;
  }

  paintWallSphere(cx, cy, cz, radius, wallId, shape = "sphere") {
    const [ccx, ccy, ccz] = this.air.cellForVoxel(cx, cy, cz);
    const cellRadius = Math.max(0, Math.ceil(radius / this.air.cellSize) - 1);
    let painted = 0;
    for (let z = Math.max(0, ccz - cellRadius); z <= Math.min(this.air.depth - 1, ccz + cellRadius); z += 1) {
      for (let y = Math.max(0, ccy - cellRadius); y <= Math.min(this.air.height - 1, ccy + cellRadius); y += 1) {
        for (let x = Math.max(0, ccx - cellRadius); x <= Math.min(this.air.width - 1, ccx + cellRadius); x += 1) {
          if (!this.brushContains(x - ccx, y - ccy, z - ccz, cellRadius, shape)) continue;
          const index = this.air.index(x, y, z);
          const erased = wallId == null || wallId === WALL_ID.DEFAULT_WL_ERASE || wallId === WALL_ID.DEFAULT_WL_ERASEA;
          this.walls[index] = erased ? 0 : wallId + 1;
          if (wallId === WALL_ID.DEFAULT_WL_FAN) {
            if (this.wallFanX[index] === 0 && this.wallFanY[index] === 0 && this.wallFanZ[index] === 0) this.wallFanX[index] = 8;
          } else {
            this.wallFanX[index] = 0;
            this.wallFanY[index] = 0;
            this.wallFanZ[index] = 0;
          }
          if (wallId === WALL_ID.DEFAULT_WL_ERASEA) {
            for (let vz = z * this.air.cellSize; vz < Math.min(this.depth, (z + 1) * this.air.cellSize); vz += 1) {
              for (let vy = y * this.air.cellSize; vy < Math.min(this.height, (y + 1) * this.air.cellSize); vy += 1) {
                for (let vx = x * this.air.cellSize; vx < Math.min(this.width, (x + 1) * this.air.cellSize); vx += 1) {
                  this.set(vx, vy, vz, MAT.EMPTY);
                  this.setEnergy(vx, vy, vz, MAT.EMPTY);
                }
              }
            }
            for (let player = 0; player < this.actorSpawns.length; player += 1) {
              const spawn = this.actorSpawns[player];
              if (spawn && this.air.indexForVoxel(...spawn) === index) this.actorSpawns[player] = null;
            }
            const signCount = this.signs.length;
            this.signs = this.signs.filter((sign) => this.air.indexForVoxel(sign.x, sign.y, sign.z) !== index);
            if (this.signs.length !== signCount) this.signVersion += 1;
          }
          painted += 1;
        }
      }
    }
    this.air.updateBlocked(this);
    return painted;
  }

  setFanVectorSphere(cx, cy, cz, radius, velocityX, velocityY, velocityZ) {
    const [ccx, ccy, ccz] = this.air.cellForVoxel(cx, cy, cz);
    const cellRadius = Math.max(0, Math.ceil(radius / this.air.cellSize) - 1);
    let changed = 0;
    for (let z = Math.max(0, ccz - cellRadius); z <= Math.min(this.air.depth - 1, ccz + cellRadius); z += 1) {
      for (let y = Math.max(0, ccy - cellRadius); y <= Math.min(this.air.height - 1, ccy + cellRadius); y += 1) {
        for (let x = Math.max(0, ccx - cellRadius); x <= Math.min(this.air.width - 1, ccx + cellRadius); x += 1) {
          const index = this.air.index(x, y, z);
          if (this.walls[index] !== WALL_ID.DEFAULT_WL_FAN + 1) continue;
          this.wallFanX[index] = velocityX;
          this.wallFanY[index] = velocityY;
          this.wallFanZ[index] = velocityZ;
          changed += 1;
        }
      }
    }
    return changed;
  }

  applyWallFans() {
    for (let index = 0; index < this.walls.length; index += 1) {
      if (this.walls[index] !== WALL_ID.DEFAULT_WL_FAN + 1) continue;
      this.air.velocityX[index] += (this.wallFanX[index] - this.air.velocityX[index]) * 0.22;
      this.air.velocityY[index] += (this.wallFanY[index] - this.air.velocityY[index]) * 0.22;
      this.air.velocityZ[index] += (this.wallFanZ[index] - this.air.velocityZ[index]) * 0.22;
    }
  }

  applyToolSphere(cx, cy, cz, radius, toolId, shape = "sphere", direction = null) {
    let affected = 0;
    for (let z = Math.max(0, cz - radius); z <= Math.min(this.depth - 1, cz + radius); z += 1) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y += 1) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(this.width - 1, cx + radius); x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          const dz = z - cz;
          if (!this.brushContains(dx, dy, dz, radius, shape)) continue;
          const index = this.index(x, y, z);
          if (toolId === TOOL_ID.HEAT && this.types[index] !== MAT.EMPTY) this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + 100);
          else if (toolId === TOOL_ID.COOL && this.types[index] !== MAT.EMPTY) this.temperatures[index] = Math.max(-273.15, this.temperatures[index] - 100);
          else if (toolId === TOOL_ID.MIX && this.types[index] !== MAT.EMPTY && this.random() < 0.35) {
            const nx = Math.max(0, Math.min(this.width - 1, x + (this.random() < 0.5 ? -1 : 1)));
            this.move(index, this.index(nx, y, z));
          } else if (toolId === TOOL_ID.CYCL) {
            const radial = Math.max(1, Math.hypot(dx, dz));
            this.air.injectVoxel(x, y, z, 0, 0, -dz / radial * 0.08, 0.02, dx / radial * 0.08);
          }
          affected += 1;
        }
      }
    }

    const pressure = toolId === TOOL_ID.AIR ? 6 : toolId === TOOL_ID.VAC ? -6 : 0;
    const heat = toolId === TOOL_ID.AMBP ? 45 : toolId === TOOL_ID.AMBM ? -45 : 0;
    const gravityMass = toolId === TOOL_ID.PGRV ? 5 : toolId === TOOL_ID.NGRV ? -5 : 0;
    const wind = toolId === TOOL_ID.WIND ? direction ?? [8, 0, 0] : [0, 0, 0];
    if (pressure || heat || toolId === TOOL_ID.WIND) this.air.injectVoxel(cx, cy, cz, pressure, heat, wind[0], wind[1], wind[2]);
    if (gravityMass) this.gravity.injectVoxel(cx, cy, cz, gravityMass);
    return affected;
  }

  move(from, to) {
    const targetType = this.types[to];
    let soapCandidates = null;
    if (this.types[from] === MAT.SOAP || targetType === MAT.SOAP) {
      soapCandidates = new Set([from, to]);
      for (const index of [from, to]) {
        if (this.types[index] !== MAT.SOAP) continue;
        for (const linked of [this.tmp[index], this.tmp2[index]]) {
          if (Number.isInteger(linked) && linked >= 0 && linked < this.size) soapCandidates.add(linked);
        }
      }
    }
    for (const field of this.particleFields) {
      const value = field[from];
      field[from] = field[to];
      field[to] = value;
    }
    this.remapSoapLinks(from, to, soapCandidates);
    if (targetType === MAT.EMPTY) this.temperatures[from] = 22;
    this.processed[from] = this.epoch;
    this.processed[to] = this.epoch;
    this.activity.moves += 1;
    return true;
  }

  canDisplace(type, targetType) {
    if (targetType === MAT.EMPTY) return true;
    const target = materialById(targetType);
    const material = materialById(type);
    if (isPowder(type) && isLiquid(targetType)) return material.density > target.density;
    if (isLiquid(type) && isLiquid(targetType)) return material.density > target.density + 2;
    if (isGas(type) && isGas(targetType)) return material.density < target.density;
    return false;
  }

  gravityVectorAt(x, y, z, inverted = false) {
    let gx = 0;
    let gy = -1;
    let gz = 0;
    if (this.gravityMode === 1) return [0, 0, 0];
    if (this.gravityMode === 2) {
      gx = (this.width - 1) * 0.5 - x;
      gy = (this.height - 1) * 0.5 - y;
      gz = (this.depth - 1) * 0.5 - z;
    } else if (this.gravityMode === 3) [gx, gy, gz] = this.customGravity;
    const magnitude = Math.hypot(gx, gy, gz);
    if (magnitude < 0.0001) return [0, 0, 0];
    const direction = inverted ? -1 : 1;
    return [gx / magnitude * direction, gy / magnitude * direction, gz / magnitude * direction];
  }

  gravityMoveDirections(x, y, z, inverted = false) {
    if (this.gravityMode === 0) return inverted ? GAS_RISE_DIRECTIONS : POWDER_FALL_DIRECTIONS;
    const [gx, gy, gz] = this.gravityVectorAt(x, y, z, inverted);
    if (!gx && !gy && !gz) return NO_DIRECTIONS;
    const sx = Math.abs(gx) > 0.2 ? Math.sign(gx) : 0;
    const sy = Math.abs(gy) > 0.2 ? Math.sign(gy) : 0;
    const sz = Math.abs(gz) > 0.2 ? Math.sign(gz) : 0;
    const candidates = [[sx, sy, sz]];
    if (sx) candidates.push([sx, 0, 0]);
    if (sy) candidates.push([0, sy, 0]);
    if (sz) candidates.push([0, 0, sz]);
    if (sx && sy) candidates.push([sx, sy, 0]);
    if (sx && sz) candidates.push([sx, 0, sz]);
    if (sy && sz) candidates.push([0, sy, sz]);
    return candidates;
  }

  tryMoveThroughInvisible(index, x, y, z, nx, ny, nz) {
    if (!this.inBounds(nx, ny, nz)) return false;
    const invisible = this.index(nx, ny, nz);
    if (this.types[invisible] !== MAT.INVIS || this.tmp2[invisible] === 0) return false;
    const bx = nx + (nx - x);
    const by = ny + (ny - y);
    const bz = nz + (nz - z);
    if (!this.inBounds(bx, by, bz) || !this.wallAllows(this.types[index], bx, by, bz)) return false;
    const beyond = this.index(bx, by, bz);
    if (!this.canDisplace(this.types[index], this.types[beyond])) return false;
    return this.move(index, beyond);
  }

  tryMove(index, x, y, z, candidates) {
    const type = this.types[index];
    const material = materialById(type);
    const sourceWall = this.wallAtVoxel(x, y, z);
    const trappedInEHole = sourceWall === WALL_ID.DEFAULT_WL_EHOLE && !this.wallPoweredAtVoxel(x, y, z);
    const particleSpeed = Math.hypot(this.velocityX[index], this.velocityY[index], this.velocityZ[index]);
    if (particleSpeed > 0.1) {
      const nx = x + (Math.abs(this.velocityX[index]) > 0.1 ? Math.sign(this.velocityX[index]) : 0);
      const ny = y + (Math.abs(this.velocityY[index]) > 0.1 ? Math.sign(this.velocityY[index]) : 0);
      const nz = z + (Math.abs(this.velocityZ[index]) > 0.1 ? Math.sign(this.velocityZ[index]) : 0);
      this.velocityX[index] *= 0.9;
      this.velocityY[index] *= 0.9;
      this.velocityZ[index] *= 0.9;
      if (this.inBounds(nx, ny, nz) && this.wallAllows(type, nx, ny, nz)) {
        const target = this.index(nx, ny, nz);
        if (this.tryMoveThroughInvisible(index, x, y, z, nx, ny, nz) || this.canDisplace(type, this.types[target]) && this.move(index, target)) return true;
      }
    }
    const gravity = this.gravity.sampleVoxel(x, y, z);
    const newtonianResponse = material.upstream?.newtonianGravity ?? 1;
    const gravityX = gravity.forceX * newtonianResponse;
    const gravityY = gravity.forceY * newtonianResponse;
    const gravityZ = gravity.forceZ * newtonianResponse;
    const gravityMagnitude = Math.hypot(gravityX, gravityY, gravityZ);
    if (gravityMagnitude > 0.025 && this.random() < Math.min(0.88, gravityMagnitude * 0.38)) {
      const nx = x + (Math.abs(gravityX) > 0.02 ? Math.sign(gravityX) : 0);
      const ny = y + (Math.abs(gravityY) > 0.02 ? Math.sign(gravityY) : 0);
      const nz = z + (Math.abs(gravityZ) > 0.02 ? Math.sign(gravityZ) : 0);
      if (this.inBounds(nx, ny, nz) && this.wallAllows(type, nx, ny, nz)) {
        const target = this.index(nx, ny, nz);
        if (this.tryMoveThroughInvisible(index, x, y, z, nx, ny, nz) || this.canDisplace(type, this.types[target]) && this.move(index, target)) return true;
      }
    }
    const advection = Math.abs(material.upstream?.advection ?? 0);
    if (advection > 0 && this.random() < Math.min(0.32, advection * 0.22)) {
      const flow = this.air.sampleVoxel(x, y, z);
      const dx = Math.abs(flow.velocityX) > 0.08 ? Math.sign(flow.velocityX) : 0;
      const dy = Math.abs(flow.velocityY) > 0.08 ? Math.sign(flow.velocityY) : 0;
      const dz = Math.abs(flow.velocityZ) > 0.08 ? Math.sign(flow.velocityZ) : 0;
      if (dx || dy || dz) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz) && this.wallAllows(type, nx, ny, nz)) {
          const target = this.index(nx, ny, nz);
          if (this.tryMoveThroughInvisible(index, x, y, z, nx, ny, nz)) return true;
          if (this.canDisplace(type, this.types[target])) {
            this.velocityX[index] = flow.velocityX;
            this.velocityY[index] = flow.velocityY;
            this.velocityZ[index] = flow.velocityZ;
            return this.move(index, target);
          }
        }
      }
    }
    const offset = Math.floor(this.random() * candidates.length);
    for (let n = 0; n < candidates.length; n += 1) {
      const [dx, dy, dz] = candidates[(n + offset) % candidates.length];
      let nx = x + dx;
      let ny = y + dy;
      let nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) {
        if (this.edgeMode === 0) {
          this.transform(index, MAT.EMPTY, 22, 0);
          return true;
        }
        if (this.edgeMode !== 2) continue;
        nx = (nx + this.width) % this.width;
        ny = (ny + this.height) % this.height;
        nz = (nz + this.depth) % this.depth;
      }
      if (trappedInEHole && this.wallAtVoxel(nx, ny, nz) !== WALL_ID.DEFAULT_WL_EHOLE) continue;
      if (!this.wallAllows(type, nx, ny, nz)) continue;
      const target = this.index(nx, ny, nz);
      if (this.wallAtVoxel(nx, ny, nz) === WALL_ID.DEFAULT_WL_ABSRB) {
        this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      }
      if (this.tryMoveThroughInvisible(index, x, y, z, nx, ny, nz) || this.canDisplace(type, this.types[target]) && this.move(index, target)) return true;
    }
    return false;
  }

  transform(index, type, temperature, life) {
    if (this.types[index] === MAT.SOAP && type !== MAT.SOAP) this.detachSoap(index);
    this.types[index] = type;
    this.temperatures[index] = temperature ?? materialById(type).defaultTemp ?? 22;
    this.life[index] = life ?? materialById(type).defaultLife ?? 0;
    this.ctype[index] = materialById(type).defaultCtype ?? 0;
    this.tmp[index] = materialById(type).defaultTmp ?? 0;
    this.tmp2[index] = materialById(type).defaultTmp2 ?? 0;
    this.tmp3[index] = materialById(type).defaultTmp3 ?? 0;
    this.tmp4[index] = materialById(type).defaultTmp4 ?? 0;
    this.processed[index] = this.epoch;
    this.activity.reactions += 1;
  }

  changeTypePreserve(index, type) {
    if (index < 0 || index >= this.size || this.types[index] === type) return false;
    if (this.types[index] === MAT.SOAP && type !== MAT.SOAP) this.detachSoap(index);
    this.types[index] = type;
    this.processed[index] = this.epoch;
    this.activity.reactions += 1;
    return true;
  }

  spark(index, conductor = this.types[index], life = 4) {
    if (index < 0 || index >= this.size || conductor === MAT.EMPTY || this.types[index] === MAT.SPRK) return false;
    this.types[index] = MAT.SPRK;
    this.ctype[index] = conductor;
    this.life[index] = life;
    this.processed[index] = this.epoch;
    this.activity.reactions += 1;
    return true;
  }

  restoreSpark(index) {
    let conductor = this.ctype[index];
    if ([MAT.WATR, MAT.SLTW, MAT.PSCN, MAT.NSCN, MAT.ETRD, MAT.INWR].includes(conductor)) this.temperatures[index] = 22;
    if (!Number.isInteger(conductor) || conductor <= MAT.EMPTY || !materialById(conductor).enabled) conductor = MAT.METL;
    if (conductor === MAT.RSST) {
      this.transform(index, MAT.EMPTY, 22, 0);
      return;
    }
    this.types[index] = conductor;
    this.ctype[index] = 0;
    if (conductor === MAT.WATR) this.life[index] = 64;
    else if (conductor === MAT.SLTW) this.life[index] = 54;
    else if (conductor === MAT.SWCH) this.life[index] = 14;
    else this.life[index] = 4;
    this.processed[index] = this.epoch;
    this.activity.reactions += 1;
  }

  canSparkBetween(sender, receiver, senderIndex, receiverIndex) {
    if (sender === receiver && receiver !== MAT.INST && receiver !== MAT.QRTZ) return true;
    if (sender === MAT.INST) return receiver === MAT.NSCN;
    if (sender === MAT.SWCH && [MAT.PSCN, MAT.NSCN, MAT.WATR, MAT.SLTW, MAT.NTCT, MAT.PTCT, MAT.INWR].includes(receiver)) return false;
    if (sender === MAT.ETRD) return [MAT.METL, MAT.BMTL, MAT.BRMT, MAT.LRBD, MAT.RBDM, MAT.PSCN, MAT.NSCN].includes(receiver);
    if (sender === MAT.NTCT) return receiver === MAT.PSCN || (receiver === MAT.NSCN && this.temperatures[senderIndex] > 99.85);
    if (sender === MAT.PTCT) return receiver === MAT.PSCN || (receiver === MAT.NSCN && this.temperatures[senderIndex] < 99.85);
    if (sender === MAT.INWR) return receiver === MAT.NSCN || receiver === MAT.PSCN;
    if (receiver === MAT.NTCT) return sender === MAT.NSCN || (sender === MAT.PSCN && this.temperatures[receiverIndex] > 99.85);
    if (receiver === MAT.PTCT) return sender === MAT.NSCN || (sender === MAT.PSCN && this.temperatures[receiverIndex] < 99.85);
    if (receiver === MAT.INWR) return sender === MAT.NSCN || sender === MAT.PSCN;
    if (receiver === MAT.INST) return sender === MAT.PSCN;
    if (receiver === MAT.QRTZ) {
      const [x, y, z] = this.coords(receiverIndex);
      return [MAT.NSCN, MAT.METL, MAT.PSCN, MAT.QRTZ].includes(sender)
        && (this.temperatures[receiverIndex] < -100 || this.air.sampleVoxel(x, y, z).pressure > 8);
    }
    if (receiver === MAT.PSCN && sender === MAT.NSCN) return false;
    if (receiver === MAT.NBLE && (this.tmp[senderIndex] & 1)) return false;
    return true;
  }

  insulationBetween(firstIndex, secondIndex) {
    if (firstIndex < 0 || secondIndex < 0 || firstIndex >= this.size || secondIndex >= this.size) return false;
    const first = this.coords(firstIndex);
    const second = this.coords(secondIndex);
    const midpoint = [
      Math.trunc((first[0] + second[0]) / 2),
      Math.trunc((first[1] + second[1]) / 2),
      Math.trunc((first[2] + second[2]) / 2),
    ];
    const type = this.types[this.index(...midpoint)];
    return type === MAT.INSL || type === MAT.RSSS;
  }

  floodInstantConductor(startIndex) {
    if (this.types[startIndex] !== MAT.INST || this.life[startIndex] !== 0) return 0;
    const queue = [startIndex];
    const visited = new Set([startIndex]);
    let sparked = 0;
    while (queue.length) {
      const index = queue.pop();
      if (this.types[index] !== MAT.INST || this.life[index] !== 0) continue;
      this.spark(index, MAT.INST, 4);
      sparked += 1;
      const [x, y, z] = this.coords(index);
      for (const [dx, dy, dz] of DIRECTIONS_6) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (!visited.has(neighbor) && this.types[neighbor] === MAT.INST) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return sparked;
  }

  updateElectrodeArc(index, x, y, z) {
    const minimum = Math.max(0, this.tmp[index]);
    const maximum = this.tmp2[index] > 0 ? this.tmp2[index] : Math.hypot(this.width, this.height, this.depth);
    let target = -1;
    let targetDistance = maximum;
    for (let candidate = 0; candidate < this.size; candidate += 1) {
      if (candidate === index || this.types[candidate] !== MAT.ETRD || this.life[candidate] !== 0 || this.insulationBetween(index, candidate)) continue;
      const [tx, ty, tz] = this.coords(candidate);
      const distance = Math.hypot(tx - x, ty - y, tz - z);
      if (distance > minimum && distance < targetDistance) {
        target = candidate;
        targetDistance = distance;
      }
    }
    if (target < 0) return false;
    const [tx, ty, tz] = this.coords(target);
    const steps = Math.max(1, Math.ceil(targetDistance));
    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      const px = Math.round(x + (tx - x) * ratio);
      const py = Math.round(y + (ty - y) * ratio);
      const pz = Math.round(z + (tz - z) * ratio);
      if (!this.inBounds(px, py, pz)) continue;
      const plasma = this.index(px, py, pz);
      if (this.types[plasma] === MAT.EMPTY) {
        this.set(px, py, pz, MAT.PLSM, 3500, 20 + Math.floor(this.random() * 30));
        this.processed[plasma] = this.epoch;
      }
    }
    this.types[index] = MAT.ETRD;
    this.ctype[index] = 0;
    this.life[index] = 20;
    this.spark(target, MAT.ETRD, 9);
    return true;
  }

  updateTeslaSpark(index, x, y, z) {
    const strength = Math.max(8, Math.min(300, this.tmp[index] || 30));
    if (this.random() >= 1 / (strength * strength / 20 + 6)) return false;
    const offset = Math.floor(this.random() * DIRECTIONS_26.length);
    for (let n = 0; n < DIRECTIONS_26.length; n += 1) {
      const [dx, dy, dz] = DIRECTIONS_26[(n + offset) % DIRECTIONS_26.length];
      const nx = x + dx * 2;
      const ny = y + dy * 2;
      const nz = z + dz * 2;
      if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY) continue;
      const lightningLife = Math.floor(strength / 7)
        + Math.floor(this.random() * (3 + Math.floor(strength / 15)));
      this.set(nx, ny, nz, MAT.LIGH,
        Math.max(-273.15, Math.min(9725.85, lightningLife * strength / 2.5 - 273.15)), lightningLife, {
        tmp: Math.round(Math.atan2(-dy, dx) * 180 / Math.PI),
        tmp2: 1,
        tmp3: Math.round(Math.atan2(dz, Math.hypot(dx, dy)) * 180 / Math.PI),
        decoration: this.decorations[index],
      });
      this.processed[this.index(nx, ny, nz)] = this.epoch;
      this.temperatures[index] = Math.max(-273.15,
        (this.temperatures[index] + 273.15) * 0.8 - strength * 2 - 273.15);
      const pressure = this.air.sampleVoxel(x, y, z).pressure;
      if (Math.abs(pressure) <= 0.5) this.air.pressure[this.air.indexForVoxel(x, y, z)] = 0;
      else this.air.injectVoxel(x, y, z, pressure > 0 ? -0.5 : 0.5, 0);
      return true;
    }
    return false;
  }

  triggerEmpPulse(triggerCount = 1) {
    const active = [];
    for (let index = 0; index < this.size; index += 1) {
      const type = this.types[index];
      if (type === MAT.SPRK || (type === MAT.SWCH && this.life[index] !== 0 && this.life[index] !== 10) || (type === MAT.WIRE && this.ctype[index] > 0)) active.push(index);
    }
    const chance = (denominator) => 1 - Math.pow(1 - 1 / denominator, triggerCount);
    const binomialSteps = (denominator, maximum = 10) => {
      let steps = 0;
      for (let trigger = 0; trigger < triggerCount && steps < maximum; trigger += 1) {
        if (this.random() < 1 / denominator) steps += 1;
      }
      return steps;
    };
    const electricalCenters = new Set([MAT.PSCN, MAT.NSCN, MAT.PTCT, MAT.NTCT, MAT.INST, MAT.SWCH]);
    for (const center of active) {
      const [x, y, z] = this.coords(center);
      const centerType = this.types[center];
      const carried = centerType === MAT.SPRK ? this.ctype[center] : centerType;
      const isElectrical = electricalCenters.has(carried) || centerType === MAT.WIRE;
      if (isElectrical) {
        this.temperatures[center] = Math.min(9725.85, this.temperatures[center] + binomialSteps(100) * 3000);
        if (this.random() < chance(48)) this.changeTypePreserve(center, this.random() < 0.4 ? MAT.BREC : MAT.NTCT);
      }
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (isElectrical && neighborType === MAT.METL) {
          this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + binomialSteps(280) * 3000);
          if (this.random() < chance(300)) {
            this.changeTypePreserve(neighbor, MAT.BMTL);
            const breakFurtherChance = 1 - Math.pow(1 - 1 / 160, Math.floor(triggerCount / 2));
            if (this.random() < breakFurtherChance) {
              this.changeTypePreserve(neighbor, MAT.BRMT);
              this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + 1000);
            }
          }
        } else if (isElectrical && neighborType === MAT.BMTL) {
          this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + binomialSteps(280) * 3000);
          if (this.random() < chance(160)) {
            this.changeTypePreserve(neighbor, MAT.BRMT);
            this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + 1000);
          }
        } else if (isElectrical && neighborType === MAT.WIFI) {
          if (this.random() < chance(8)) this.temperatures[neighbor] = Math.floor(this.random() * 10000) - 273.15;
          if (this.random() < chance(16)) this.transform(neighbor, MAT.BREC, Math.min(9725.85, this.temperatures[neighbor] + 1000));
        } else if (neighborType === MAT.SWCH) {
          if (this.random() < chance(100)) this.changeTypePreserve(neighbor, MAT.BREC);
          this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + binomialSteps(100) * 2000);
        } else if (neighborType === MAT.ARAY && this.random() < chance(60)) {
          this.transform(neighbor, MAT.BREC, Math.min(9725.85, this.temperatures[neighbor] + 1000));
        } else if (neighborType === MAT.DLAY && this.random() < chance(70)) {
          this.temperatures[neighbor] = Math.floor(this.random() * 256) - 273.15;
        }
        return false;
      });
    }
  }

  updateSpark(index, x, y, z) {
    if (this.life[index] > 0) this.life[index] -= 1;
    const sender = this.ctype[index] || MAT.METL;
    if (this.life[index] <= 0) {
      this.restoreSpark(index);
      return;
    }
    this.updateCombustionInteractions(index, x, y, z, MAT.SPRK);
    if (sender === MAT.SPRK) {
      this.transform(index, MAT.EMPTY, 22, 0);
      return;
    }
    if (sender === MAT.NTCT || sender === MAT.PTCT) this.updateThermistor(index);
    if (sender === MAT.ETRD && this.life[index] === 1 && this.updateElectrodeArc(index, x, y, z)) return;
    if (sender === MAT.NBLE && this.life[index] <= 1 && !(this.tmp[index] & 1)) {
      const wasExtremelyHot = this.temperatures[index] > 5000;
      this.changeTypePreserve(index, MAT.PLSM);
      this.life[index] = 50 + Math.floor(this.random() * 150);
      this.ctype[index] = MAT.NBLE;
      if (wasExtremelyHot) this.tmp[index] |= 4;
      this.temperatures[index] = 3226.85;
      this.air.injectVoxel(x, y, z, 1, 0);
      return;
    }
    if (sender === MAT.TESC) this.updateTeslaSpark(index, x, y, z);
    if (sender === MAT.IRON) {
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (![MAT.DSTW, MAT.SLTW, MAT.WATR].includes(neighborType)) return false;
        const product = Math.floor(this.random() * 100);
        if (product === 0) this.changeTypePreserve(neighbor, MAT.O2);
        else if (product < 3) this.changeTypePreserve(neighbor, MAT.H2);
        return false;
      });
    } else if (sender === MAT.TUNG && this.temperatures[index] < 3321.85) {
      this.temperatures[index] = Math.min(9725.85,
        this.temperatures[index] + Math.floor(this.random() * 20) - 4);
    }
    if (sender === MAT.ETRD && this.life[index] === 5) {
      for (const [dx, dy, dz] of SPARK_DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        const receiver = this.types[neighbor];
        if (!isConductor(receiver) || this.life[neighbor] !== 0 || this.insulationBetween(index, neighbor)
          || !this.canSparkBetween(sender, receiver, index, neighbor)) continue;
        this.types[index] = MAT.ETRD;
        this.ctype[index] = 0;
        this.life[index] = 20;
        this.spark(neighbor, receiver, 4);
        return;
      }
    }
    if (this.life[index] >= 4) return;

    for (const [dx, dy, dz] of SPARK_DIRECTIONS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      const receiver = this.types[neighbor];
      if (receiver === MAT.EMPTY || receiver === MAT.INSL || receiver === MAT.RSSS) continue;
      const insulated = this.insulationBetween(index, neighbor);

      if (receiver === MAT.SPRK) {
        if (!insulated) {
          if (this.ctype[neighbor] === MAT.SWCH && sender === MAT.NSCN) {
            this.changeTypePreserve(neighbor, MAT.SWCH);
            this.ctype[neighbor] = 0;
            this.life[neighbor] = 9;
          } else if ([MAT.NTCT, MAT.PTCT].includes(this.ctype[neighbor]) && sender === MAT.METL) {
            this.temperatures[neighbor] = 199.85;
          }
        }
        continue;
      }

      if (receiver === MAT.SWCH) {
        if (insulated) continue;
        if (sender === MAT.PSCN && this.life[neighbor] < 10) this.life[neighbor] = 10;
        else if (sender === MAT.NSCN) this.life[neighbor] = 9;
        else if (this.life[neighbor] >= 10 && this.life[neighbor] === 10) this.spark(neighbor, MAT.SWCH, 4);
        continue;
      }
      if (receiver === MAT.PPIP) {
        if (insulated) continue;
        if (this.life[index] === 3) this.triggerPipeNetwork(neighbor, sender);
        continue;
      }
      if (POWERED_TOGGLES.has(receiver)) {
        if (sender === MAT.PSCN) this.life[neighbor] = 10;
        else if (sender === MAT.NSCN && this.life[neighbor] >= 10) this.life[neighbor] = 9;
        continue;
      }
      if (receiver === MAT.LCRY) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) > 1) continue;
        if (sender === MAT.PSCN && this.tmp[neighbor] === 0) this.tmp[neighbor] = 2;
        else if (sender === MAT.NSCN && this.tmp[neighbor] === 3) this.tmp[neighbor] = 1;
        continue;
      }
      if (receiver === MAT.EMP) {
        if (this.life[neighbor] === 0) {
          this.life[neighbor] = 220;
          this.triggerEmpPulse(1);
        }
        continue;
      }
      if (insulated) continue;
      if (sender === MAT.METL && [MAT.NTCT, MAT.PTCT, MAT.INWR].includes(receiver)) {
        this.temperatures[neighbor] = 199.85;
        if (receiver !== MAT.INWR) continue;
      }
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) >= 4 && sender !== MAT.SWCH && receiver !== MAT.SWCH) continue;
      if (!isConductor(receiver) && receiver !== MAT.INST && receiver !== MAT.QRTZ) continue;
      if (this.life[neighbor] !== 0 || !this.canSparkBetween(sender, receiver, index, neighbor)) continue;
      if (receiver === MAT.INST) {
        this.floodInstantConductor(neighbor);
        continue;
      }
      if ([MAT.WATR, MAT.SLTW].includes(receiver) && this.life[index] >= 3) continue;
      const sparkLife = receiver === MAT.WATR ? 6 : receiver === MAT.SLTW || receiver === MAT.RSST ? 5 : 4;
      if (this.spark(neighbor, receiver, sparkLife) && [MAT.METL, MAT.BMTL, MAT.BRMT, MAT.PSCN, MAT.NSCN, MAT.ETRD, MAT.NBLE, MAT.IRON].includes(receiver)) {
        if (this.temperatures[neighbor] + 10 < 399.85) this.temperatures[neighbor] += 10;
      }
    }
  }

  updateBattery(index, x, y, z) {
    for (const [dx, dy, dz] of SPARK_DIRECTIONS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      const receiver = this.types[neighbor];
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) >= 4) continue;
      if (!isConductor(receiver) || this.life[neighbor] !== 0 || this.insulationBetween(index, neighbor)) continue;
      if ([MAT.WATR, MAT.SLTW, MAT.NTCT, MAT.PTCT, MAT.INWR].includes(receiver)) continue;
      this.spark(neighbor, receiver, 4);
    }
  }

  portalDirectionIndex(dx, dy, dz) {
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const sz = Math.sign(dz);
    const direction = DIRECTIONS_26.findIndex(([px, py, pz]) => px === sx && py === sy && pz === sz);
    return direction < 0 ? 0 : direction;
  }

  portalParticleState(index, energy = false) {
    if (energy) return {
      energy: true, type: this.energyTypes[index], temperature: this.energyTemperatures[index], life: this.energyLife[index],
      ctype: this.energyCtype[index], tmp: this.energyTmp[index], tmp2: this.energyTmp2[index], tmp3: this.energyTmp3[index], tmp4: this.energyTmp4[index],
      velocityX: this.energyVelocityX[index], velocityY: this.energyVelocityY[index], velocityZ: this.energyVelocityZ[index],
      flags: this.energyFlags[index], decoration: this.energyDecorations[index],
    };
    return {
      energy: false, type: this.types[index], temperature: this.temperatures[index], life: this.life[index],
      ctype: this.ctype[index], tmp: this.tmp[index], tmp2: this.tmp2[index], tmp3: this.tmp3[index], tmp4: this.tmp4[index],
      velocityX: this.velocityX[index], velocityY: this.velocityY[index], velocityZ: this.velocityZ[index],
      flags: this.flags[index], decoration: this.decorations[index],
    };
  }

  restoreParticleState(index, particle, energy = Boolean(particle.energy)) {
    const values = [
      particle.type, particle.temperature, particle.life, particle.ctype,
      particle.tmp, particle.tmp2, particle.tmp3, particle.tmp4,
      particle.velocityX, particle.velocityY, particle.velocityZ, particle.flags, particle.decoration,
    ];
    const fields = energy ? this.energyFields : this.particleFields;
    for (let field = 0; field < fields.length; field += 1) fields[field][index] = values[field] ?? 0;
  }

  enqueuePortalParticle(portalIndex, direction, particle) {
    const channel = this.wirelessChannel(this.temperatures[portalIndex]);
    this.tmp[portalIndex] = channel;
    const queue = this.portalQueues[channel][direction];
    if (queue.length >= 80) return false;
    queue.push({ ...particle });
    if (!this.life[portalIndex]) this.life[portalIndex] = 1 + Math.floor(this.random() * 65534);
    if (!this.ctype[portalIndex]) this.ctype[portalIndex] = Math.floor(this.random() * 0x7fffffff);
    return true;
  }

  emitPortalParticle(portalIndex, target, direction) {
    const channel = this.wirelessChannel(this.temperatures[portalIndex]);
    this.tmp[portalIndex] = channel;
    const preferred = OPPOSITE_DIRECTION_26[direction];
    let queue = this.portalQueues[channel][preferred];
    if (!queue.length) queue = this.portalQueues[channel].find((candidate) => candidate.length);
    if (!queue?.length) return false;
    const particle = queue.shift();
    const [x, y, z] = this.coords(target);
    const properties = {
      ctype: particle.ctype, tmp: particle.tmp, tmp2: particle.tmp2, tmp3: particle.tmp3, tmp4: particle.tmp4,
      velocityX: particle.velocityX, velocityY: particle.velocityY, velocityZ: particle.velocityZ,
      flags: particle.flags, decoration: particle.decoration,
    };
    if (particle.energy) {
      if (this.energyTypes[target] !== MAT.EMPTY || materialById(particle.type).state !== "energy") {
        queue.unshift(particle);
        return false;
      }
      this.setEnergy(x, y, z, particle.type, particle.temperature, particle.life, properties);
      this.restoreParticleState(target, particle, true);
      this.energyProcessed[target] = this.epoch;
    } else {
      if (this.types[target] !== MAT.EMPTY || materialById(particle.type).state === "energy") {
        queue.unshift(particle);
        return false;
      }
      this.set(x, y, z, particle.type, particle.temperature, particle.life, properties);
      this.restoreParticleState(target, particle, false);
      if (particle.type === MAT.STKM) this.actorPortalLocks[0] = false;
      else if (particle.type === MAT.STKM2) this.actorPortalLocks[1] = false;
      this.processed[target] = this.epoch;
    }
    return true;
  }

  updatePortal(index, x, y, z, type) {
    const channel = this.wirelessChannel(this.temperatures[index]);
    this.tmp[index] = channel;
    let active = false;
    if (type === MAT.PRTI) {
      for (let direction = 0; direction < DIRECTIONS_26.length; direction += 1) {
        const [dx, dy, dz] = DIRECTIONS_26[direction];
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        const neighborType = this.types[neighbor];
        const excluded = [MAT.PRTI, MAT.PRTO, MAT.STKM, MAT.STKM2, MAT.FIGH];
        if (neighborType === MAT.STOR && this.tmp[neighbor]) {
          const stored = {
            energy: materialById(this.tmp[neighbor]).state === "energy", type: this.tmp[neighbor], temperature: this.temperatures[neighbor],
            life: this.tmp2[neighbor], ctype: this.tmp4[neighbor], tmp: this.tmp3[neighbor], tmp2: 0, tmp3: 0, tmp4: 0,
            velocityX: 0, velocityY: 0, velocityZ: 0, flags: this.flags[neighbor], decoration: this.decorations[neighbor],
          };
          if (this.enqueuePortalParticle(index, direction, stored)) {
            this.tmp[neighbor] = 0;
            this.tmp2[neighbor] = 0;
            this.tmp3[neighbor] = 0;
            this.tmp4[neighbor] = 0;
            active = true;
          }
        } else if (neighborType !== MAT.EMPTY && !excluded.includes(neighborType) && (materialById(neighborType).state !== "solid" || neighborType === MAT.SPRK)) {
          if (neighborType === MAT.SOAP) this.detachSoap(neighbor);
          if (this.enqueuePortalParticle(index, direction, this.portalParticleState(neighbor, false))) {
            if (neighborType === MAT.SPRK) this.restoreSpark(neighbor);
            else this.transform(neighbor, MAT.EMPTY, 22, 0);
            active = true;
          }
        } else if (this.energyTypes[neighbor] !== MAT.EMPTY) {
          if (this.enqueuePortalParticle(index, direction, this.portalParticleState(neighbor, true))) {
            this.killEnergy(neighbor);
            active = true;
          }
        }
      }
    } else {
      for (let direction = 0; direction < DIRECTIONS_26.length; direction += 1) {
        const [dx, dy, dz] = DIRECTIONS_26[direction];
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const target = this.index(nx, ny, nz);
        if (this.types[target] === MAT.EMPTY && this.emitPortalParticle(index, target, direction)) active = true;
      }
      active ||= this.portalQueues[channel].some((queue) => queue.length);
    }
    if (!active) {
      this.life[index] = 0;
      this.ctype[index] = 0;
    } else {
      this.life[index] = (this.life[index] + 17) & 0xffff;
      this.ctype[index] = (this.ctype[index] + 31) | 0;
    }
    return false;
  }

  wirelessChannel(temperature) {
    return Math.max(0, Math.min(this.wireless.length - 1, Math.floor((temperature + 300) / 100)));
  }

  updateWirelessState() {
    this.wireless.set(this.wirelessNext);
    this.wirelessNext.fill(0);
    for (let index = 0; index < this.size; index += 1) {
      if (this.types[index] !== MAT.WIFI) continue;
      const [x, y, z] = this.coords(index);
      const channel = this.wirelessChannel(this.temperatures[index]);
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType === MAT.SPRK && this.ctype[neighbor] !== MAT.NSCN && this.life[neighbor] >= 3) this.wirelessNext[channel] = 1;
        return false;
      });
    }
  }

  updateWifi(index, x, y, z) {
    const signal = this.wireless[this.wirelessChannel(this.temperatures[index])];
    if (!signal) return false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if ([MAT.NSCN, MAT.PSCN, MAT.INWR].includes(neighborType) && this.life[neighbor] === 0) this.spark(neighbor, neighborType, 4);
      return false;
    });
    return false;
  }

  rayTrigger(index, x, y, z) {
    let trigger = null;
    for (const [dx, dy, dz] of DIRECTIONS_26) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] === MAT.SPRK && this.life[neighbor] === 3) {
        trigger = { dx: -dx, dy: -dy, dz: -dz, sender: this.ctype[neighbor] };
        break;
      }
    }
    return trigger;
  }

  updateArrayRay(index, x, y, z) {
    const trigger = this.rayTrigger(index, x, y, z);
    if (!trigger) return false;
    const destroy = trigger.sender === MAT.PSCN;
    const noStop = trigger.sender === MAT.INST;
    const shortLife = this.life[index] > 0 ? this.life[index] : 30;
    const longLife = this.life[index] > 0 ? this.life[index] : 1020;
    let wavelength = 0;
    let blackDecoration = false;
    for (let step = 1; step <= Math.max(this.width, this.height, this.depth); step += 1) {
      const nx = x + trigger.dx * step;
      const ny = y + trigger.dy * step;
      const nz = z + trigger.dz * step;
      if (!this.inBounds(nx, ny, nz)) break;
      const target = this.index(nx, ny, nz);
      const targetType = this.types[target];
      if (targetType === MAT.EMPTY) {
        this.set(nx, ny, nz, MAT.BRAY, this.temperatures[index], destroy ? 2 : shortLife, {
          ctype: destroy ? 0 : wavelength,
          tmp: destroy ? 2 : 0,
          decoration: blackDecoration ? 0xff000000 : 0,
        });
        this.processed[target] = this.epoch;
        continue;
      }

      if (destroy) {
        if (targetType === MAT.BRAY) {
          this.tmp[target] = 2;
          this.life[target] = 1;
          if (blackDecoration) this.decorations[target] = 0xff000000;
          continue;
        }
        if (targetType === MAT.STOR) {
          this.tmp[target] = 0;
          this.life[target] = 0;
          continue;
        }
        if (targetType === MAT.FILT) {
          blackDecoration = this.decorations[target] === 0xff000000;
          this.life[target] = 2;
          continue;
        }
        const transparent = targetType === MAT.INWR
          || (targetType === MAT.SPRK && this.ctype[target] === MAT.INWR)
          || targetType === MAT.ARAY || targetType === MAT.WIFI
          || (targetType === MAT.SWCH && this.life[target] >= 10);
        if (transparent) continue;
        break;
      }

      if (targetType === MAT.BRAY) {
        if (this.tmp[target] === 1) {
          this.life[target] = longLife;
          if (blackDecoration) this.decorations[target] = 0xff000000;
          continue;
        }
        if (this.tmp[target] === 0 && step > 1) {
          this.life[target] = longLife;
          this.tmp[target] = 1;
          if (!this.ctype[target]) this.ctype[target] = wavelength;
        }
        if (blackDecoration) this.decorations[target] = 0xff000000;
        break;
      }
      if (targetType === MAT.FILT) {
        if (this.tmp[target] !== 6) {
          wavelength = this.filterWavelength(target, wavelength);
          if (!(wavelength & PHOTON_WAVELENGTH_MASK)) break;
        }
        blackDecoration = this.decorations[target] === 0xff000000;
        this.life[target] = 4;
        continue;
      }
      if (targetType === MAT.STOR) {
        if (this.tmp[target]) this.emitStoredParticle(target, nx, ny, nz, true);
        this.life[target] = 10;
        continue;
      }
      const transparent = targetType === MAT.INWR
        || (targetType === MAT.SPRK && this.ctype[target] === MAT.INWR)
        || targetType === MAT.ARAY || targetType === MAT.WIFI
        || (targetType === MAT.SWCH && this.life[target] >= 10);
      if (transparent) continue;
      if (step > 1 && isConductor(targetType) && this.life[target] === 0) this.spark(target, targetType, 4);
      if (noStop && this.types[target] === MAT.SPRK && isConductor(this.ctype[target])) continue;
      break;
    }
    return false;
  }

  updateCreatorRay(index, x, y, z) {
    let packedCreateType = this.ctype[index] >>> 0;
    let createType = packedCreateType & 0x1ff;
    let createExtra = packedCreateType >>> 9;
    if (!createType || !materialById(createType).enabled) {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        const neighborType = this.energyTypes[neighbor] || this.types[neighbor];
        if (!neighborType || [MAT.CRAY, MAT.PSCN, MAT.INST, MAT.METL, MAT.SPRK].includes(neighborType)) continue;
        this.ctype[index] = neighborType === MAT.LIFE
          ? (((this.energyTypes[neighbor] ? this.energyCtype[neighbor] : this.ctype[neighbor]) << 9) | MAT.LIFE)
          : neighborType;
        this.temperatures[index] = this.energyTypes[neighbor] ? this.energyTemperatures[neighbor] : this.temperatures[neighbor];
        break;
      }
      packedCreateType = this.ctype[index] >>> 0;
      createType = packedCreateType & 0x1ff;
      createExtra = packedCreateType >>> 9;
    }
    const trigger = this.rayTrigger(index, x, y, z);
    if (!trigger || !createType || !materialById(createType).enabled) return false;
    const destroy = trigger.sender === MAT.PSCN;
    const noStop = trigger.sender === MAT.INST;
    const createSpark = trigger.sender === MAT.INWR;
    let remaining = Math.max(1, Math.min(255, this.tmp[index] || 255));
    const spacing = Math.max(0, Math.min(255, this.tmp2[index]));
    let decoration = 0;
    for (let step = spacing + 1; remaining > 0; step += 1) {
      const nx = x + trigger.dx * step;
      const ny = y + trigger.dy * step;
      const nz = z + trigger.dz * step;
      if (!this.inBounds(nx, ny, nz)) break;
      const target = this.index(nx, ny, nz);
      const targetType = this.types[target];
      const energyType = this.energyTypes[target];
      const state = materialById(createType).state;
      const wallOpen = this.wallAllows(createType, nx, ny, nz);
      let created = false;
      if (createSpark && createType === MAT.SPRK && isConductor(targetType) && this.life[target] === 0) {
        created = this.spark(target, targetType, this.life[index] > 0 ? this.life[index] : 4);
        if (created) this.temperatures[target] = this.temperatures[index];
      } else if (wallOpen && targetType === MAT.EMPTY) {
        if (state === "energy" && energyType === MAT.EMPTY) {
          created = this.setEnergy(nx, ny, nz, createType, this.temperatures[index], this.life[index] > 0 ? this.life[index] : undefined, {
            decoration,
          });
          if (created) this.energyProcessed[target] = this.epoch;
        } else if (state !== "energy" && createType !== MAT.SPRK) {
          const creationLife = this.life[index] > 0 ? this.life[index]
            : createType === MAT.LIGH && createExtra > 0 ? createExtra : undefined;
          created = this.set(nx, ny, nz, createType, this.temperatures[index], creationLife, {
            ctype: createType === MAT.LIFE ? createExtra : undefined, decoration,
          });
          if (created) this.processed[target] = this.epoch;
        }
      }
      if (created) {
        remaining -= 1;
        continue;
      }
      if (wallOpen && targetType === MAT.EMPTY && state === "energy" && energyType !== MAT.EMPTY) continue;
      if (targetType === MAT.FILT) {
        if (this.decorations[target] === 0xff000000) decoration = 0xff000000;
        else if (this.tmp[target] === 0) {
          const temperatureBin = Math.max(0, Math.min(25, Math.floor(this.temperatures[target] * 0.025)));
          const wavelength = (this.ctype[target] & PHOTON_WAVELENGTH_MASK) || ((0x1f << temperatureBin) & PHOTON_WAVELENGTH_MASK);
          let red = 0;
          let green = 0;
          let blue = 0;
          for (let bit = 0; bit < 12; bit += 1) {
            red += (wavelength >> (bit + 18)) & 1;
            green += (wavelength >> (bit + 9)) & 1;
            blue += (wavelength >> bit) & 1;
          }
          const scale = 624 / (red + green + blue + 1);
          decoration = (0xff000000 | (Math.min(255, Math.floor(red * scale)) << 16)
            | (Math.min(255, Math.floor(green * scale)) << 8) | Math.min(255, Math.floor(blue * scale))) >>> 0;
        } else if (decoration === 0xff000000) decoration = 0;
        this.life[target] = 4;
        continue;
      }
      if (targetType === MAT.CRAY || noStop) continue;
      if (destroy && targetType !== MAT.EMPTY && targetType !== MAT.DMND) {
        this.transform(target, MAT.EMPTY, 22, 0);
        remaining -= 1;
        continue;
      }
      break;
    }
    return false;
  }

  updateDuplicatorRay(index, x, y, z) {
    const trigger = this.rayTrigger(index, x, y, z);
    if (!trigger) return false;
    if (trigger.sender === MAT.INWR && [trigger.dx, trigger.dy, trigger.dz].filter(Boolean).length > 1) return false;
    if (this.tmp[index] < 0) this.tmp[index] = 0;
    if (this.tmp2[index] < 0) this.tmp2[index] = 0;
    const explicitLength = Math.min(255, this.tmp[index]);
    const spacing = Math.min(255, this.tmp2[index]);
    const overwrite = trigger.sender === MAT.PSCN;
    let sourceLength = explicitLength;
    let targetStart = explicitLength ? explicitLength + spacing + 1 : -1;
    let energyLayer = false;
    let layerChosen = false;
    const copiedMatter = new Map();

    const voxelAtStep = (step) => {
      const vx = x + trigger.dx * step;
      const vy = y + trigger.dy * step;
      const vz = z + trigger.dz * step;
      if (!this.inBounds(vx, vy, vz)) return null;
      return { x: vx, y: vy, z: vz, index: this.index(vx, vy, vz) };
    };
    const chooseLayer = (voxel) => {
      if (layerChosen) return;
      if (this.types[voxel.index] !== MAT.EMPTY) {
        energyLayer = false;
        layerChosen = true;
      } else if (this.energyTypes[voxel.index] !== MAT.EMPTY) {
        energyLayer = true;
        layerChosen = true;
      }
    };

    if (explicitLength) {
      for (let step = 1; step <= explicitLength; step += 1) {
        const voxel = voxelAtStep(step);
        if (!voxel) return false;
        chooseLayer(voxel);
      }
    } else {
      sourceLength = 0;
      const packedMarker = this.ctype[index] >>> 0;
      const markerType = packedMarker & 0x1ff;
      const markerExtra = packedMarker >>> 9;
      for (let step = 1; step <= Math.max(this.width, this.height, this.depth); step += 1) {
        const voxel = voxelAtStep(step);
        if (!voxel) return false;
        chooseLayer(voxel);
        const type = energyLayer ? this.energyTypes[voxel.index] : this.types[voxel.index];
        const subtype = energyLayer ? this.energyCtype[voxel.index] : this.ctype[voxel.index];
        if (type === markerType && (markerType !== MAT.LIFE || subtype === markerExtra)) {
          sourceLength = step - 1;
          targetStart = step + spacing;
          break;
        }
      }
      if (targetStart < 0 || sourceLength <= 0) return false;
    }

    for (let offset = 0; offset < sourceLength; offset += 1) {
      const source = voxelAtStep(offset + 1);
      const targetVoxel = voxelAtStep(targetStart + offset);
      if (!source || !targetVoxel) break;
      const sourceType = energyLayer ? this.energyTypes[source.index] : this.types[source.index];
      if (overwrite) {
        if (energyLayer) this.killEnergy(targetVoxel.index);
        else if (this.types[targetVoxel.index] !== MAT.EMPTY) this.transform(targetVoxel.index, MAT.EMPTY, 22, 0);
      }
      if (!sourceType || [MAT.STKM, MAT.STKM2].includes(sourceType)) continue;
      if (energyLayer) {
        if (this.energyTypes[targetVoxel.index] !== MAT.EMPTY || !this.wallAllows(sourceType, targetVoxel.x, targetVoxel.y, targetVoxel.z)) continue;
        if (this.setEnergy(targetVoxel.x, targetVoxel.y, targetVoxel.z, sourceType, this.energyTemperatures[source.index], this.energyLife[source.index], {
          ctype: this.energyCtype[source.index], tmp: this.energyTmp[source.index], tmp2: this.energyTmp2[source.index],
          tmp3: this.energyTmp3[source.index], tmp4: this.energyTmp4[source.index],
          velocityX: this.energyVelocityX[source.index], velocityY: this.energyVelocityY[source.index], velocityZ: this.energyVelocityZ[source.index],
          flags: this.energyFlags[source.index], decoration: this.energyDecorations[source.index],
        })) {
          for (const field of this.energyFields) field[targetVoxel.index] = field[source.index];
          this.energyProcessed[targetVoxel.index] = this.epoch;
        }
      } else {
        if (this.types[targetVoxel.index] !== MAT.EMPTY || !this.wallAllows(sourceType, targetVoxel.x, targetVoxel.y, targetVoxel.z)) continue;
        const sourceIsSoap = sourceType === MAT.SOAP;
        if (this.set(targetVoxel.x, targetVoxel.y, targetVoxel.z, sourceType, this.temperatures[source.index], this.life[source.index], {
          ctype: sourceIsSoap ? this.ctype[source.index] & ~6 : this.ctype[source.index],
          tmp: sourceIsSoap ? -1 : this.tmp[source.index], tmp2: sourceIsSoap ? -1 : this.tmp2[source.index],
          tmp3: this.tmp3[source.index], tmp4: this.tmp4[source.index],
          velocityX: this.velocityX[source.index], velocityY: this.velocityY[source.index], velocityZ: this.velocityZ[source.index],
          flags: this.flags[source.index], decoration: this.decorations[source.index],
        })) {
          for (const field of this.particleFields) field[targetVoxel.index] = field[source.index];
          if (sourceIsSoap) {
            this.ctype[targetVoxel.index] &= ~6;
            this.tmp[targetVoxel.index] = -1;
            this.tmp2[targetVoxel.index] = -1;
          }
          copiedMatter.set(source.index, targetVoxel.index);
          this.processed[targetVoxel.index] = this.epoch;
        }
      }
    }
    for (const [source, target] of copiedMatter) {
      if (this.types[source] !== MAT.SOAP || !(this.ctype[source] & 2)) continue;
      const copiedLink = copiedMatter.get(this.tmp[source]);
      if (copiedLink != null) this.attachSoap(target, copiedLink);
    }
    return false;
  }

  updateSwitch(index, x, y, z) {
    if (this.life[index] > 0 && this.life[index] !== 10) this.life[index] -= 1;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (this.insulationBetween(index, neighbor)) return false;
      if (neighborType === MAT.SWCH) {
        if (this.life[index] >= 10 && this.life[neighbor] > 0 && this.life[neighbor] < 10) this.life[index] = 9;
        else if (this.life[index] === 0 && this.life[neighbor] >= 10) this.life[index] = this.life[neighbor];
      } else if (neighborType === MAT.SPRK && this.life[index] === 10 && this.life[neighbor] > 0
        && ![MAT.PSCN, MAT.NSCN].includes(this.ctype[neighbor])) {
        this.spark(index, MAT.SWCH, 4);
        return true;
      }
      return false;
    });
    if (this.types[index] !== MAT.SWCH) return true;

    const redBray = (dx, dy, dz) => {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) return false;
      const target = this.index(nx, ny, nz);
      return this.types[target] === MAT.BRAY && this.tmp[target] === 2;
    };
    const empty = (dx, dy, dz) => this.inBounds(x + dx, y + dy, z + dz)
      && this.get(x + dx, y + dy, z + dz) === MAT.EMPTY;
    const planes = [
      [[1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [0, 0, 1]],
      [[0, 1, 0], [0, 0, 1]],
    ];
    for (const [[ax, ay, az], [bx, by, bz]] of planes) {
      if (!empty(ax - bx, ay - by, az - bz) || !empty(-ax - bx, -ay - by, -az - bz)) continue;
      const beamA = redBray(ax, ay, az) || redBray(-ax, -ay, -az);
      const beamB = redBray(bx, by, bz) || redBray(-bx, -by, -bz);
      if (!beamA || !beamB) continue;
      if (this.life[index] === 10) this.life[index] = 9;
      else if (this.life[index] <= 5) this.life[index] = 14;
      break;
    }
    return false;
  }

  updateWireWorld() {
    const wires = [];
    for (let index = 0; index < this.size; index += 1) {
      if (this.types[index] === MAT.WIRE) wires.push({ index, state: this.ctype[index] });
    }
    if (!wires.length) return;
    const next = new Map();
    for (const wire of wires) {
      const [x, y, z] = this.coords(wire.index);
      let state = wire.state === 1 ? 2 : 0;
      let heads = 0;
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (this.types[neighbor] === MAT.SPRK && this.life[neighbor] === 3 && this.ctype[neighbor] === MAT.PSCN) state = 1;
        else if (this.types[neighbor] === MAT.NSCN && wire.state === 1 && this.life[neighbor] === 0) this.spark(neighbor, MAT.NSCN, 4);
        else if (this.types[neighbor] === MAT.WIRE && this.ctype[neighbor] === 1 && wire.state === 0) heads += 1;
      }
      if (wire.state === 0 && (heads === 1 || heads === 2)) state = 1;
      next.set(wire.index, state);
    }
    for (const [index, state] of next) {
      this.ctype[index] = state;
      this.tmp[index] = state;
      this.processed[index] = this.epoch;
    }
  }

  updateWallElectricity() {
    for (let index = 0; index < this.wallElectricity.length; index += 1) {
      if (this.wallElectricity[index] > 0) this.wallElectricity[index] -= 1;
    }
    const sources = [];
    for (let index = 0; index < this.size; index += 1) {
      const type = this.types[index];
      if (type !== MAT.SPRK) continue;
      const [x, y, z] = this.coords(index);
      const [cx, cy, cz] = this.air.cellForVoxel(x, y, z);
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        if (!this.air.inBounds(nx, ny, nz)) continue;
        const wallIndex = this.air.index(nx, ny, nz);
        const wall = this.walls[wallIndex] ? this.walls[wallIndex] - 1 : null;
        if (WALL_CONDUCTORS.has(wall)) sources.push(wallIndex);
      }
      const ownWall = this.air.index(cx, cy, cz);
      if (this.walls[ownWall] && WALL_CONDUCTORS.has(this.walls[ownWall] - 1)) sources.push(ownWall);
    }
    for (let wallIndex = 0; wallIndex < this.walls.length; wallIndex += 1) {
      if (this.walls[wallIndex] - 1 !== WALL_ID.DEFAULT_WL_DTECT) continue;
      const cz = Math.floor(wallIndex / (this.air.width * this.air.height));
      const layer = wallIndex - cz * this.air.width * this.air.height;
      const cy = Math.floor(layer / this.air.width);
      const cx = layer - cy * this.air.width;
      let occupied = false;
      for (let z = cz * this.air.cellSize; z < Math.min(this.depth, (cz + 1) * this.air.cellSize) && !occupied; z += 1) {
        for (let y = cy * this.air.cellSize; y < Math.min(this.height, (cy + 1) * this.air.cellSize) && !occupied; y += 1) {
          for (let x = cx * this.air.cellSize; x < Math.min(this.width, (cx + 1) * this.air.cellSize); x += 1) {
            if (this.types[this.index(x, y, z)] !== MAT.EMPTY) { occupied = true; break; }
          }
        }
      }
      if (occupied) sources.push(wallIndex);
    }
    const queue = [...new Set(sources)];
    const visited = new Set(queue);
    while (queue.length) {
      const index = queue.shift();
      this.wallElectricity[index] = 16;
      const cz = Math.floor(index / (this.air.width * this.air.height));
      const layer = index - cz * this.air.width * this.air.height;
      const cy = Math.floor(layer / this.air.width);
      const cx = layer - cy * this.air.width;
      for (const [dx, dy, dz] of DIRECTIONS_6) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        if (!this.air.inBounds(nx, ny, nz)) continue;
        const neighbor = this.air.index(nx, ny, nz);
        const wall = this.walls[neighbor] ? this.walls[neighbor] - 1 : null;
        if (!visited.has(neighbor) && WALL_CONDUCTORS.has(wall)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    this.air.updateBlocked(this);
  }

  killEnergy(index) {
    if (index < 0 || index >= this.size) return false;
    for (const field of this.energyFields) field[index] = 0;
    this.energyTemperatures[index] = 22;
    this.energyProcessed[index] = this.epoch;
    return true;
  }

  transformEnergy(index, type, properties = {}) {
    const [x, y, z] = this.coords(index);
    const temperature = properties.temperature ?? this.energyTemperatures[index] ?? materialById(type).defaultTemp;
    const life = properties.life;
    return this.setEnergy(x, y, z, type, temperature, life, {
      ctype: properties.ctype,
      tmp: properties.tmp,
      tmp2: properties.tmp2,
      tmp3: properties.tmp3,
      tmp4: properties.tmp4,
      velocityX: properties.velocityX ?? this.energyVelocityX[index],
      velocityY: properties.velocityY ?? this.energyVelocityY[index],
      velocityZ: properties.velocityZ ?? this.energyVelocityZ[index],
      flags: properties.flags ?? this.energyFlags[index],
      decoration: properties.decoration ?? this.energyDecorations[index],
    });
  }

  moveEnergy(from, to) {
    if (from === to || this.energyTypes[to] !== MAT.EMPTY) return false;
    for (const field of this.energyFields) {
      field[to] = field[from];
      field[from] = 0;
    }
    this.energyTemperatures[from] = 22;
    this.energyProcessed[from] = this.epoch;
    this.energyProcessed[to] = this.epoch;
    return true;
  }

  createEnergyNearby(x, y, z, type, properties = {}) {
    const directions = [...DIRECTIONS_26];
    const offset = Math.floor(this.random() * directions.length);
    for (let n = 0; n < directions.length; n += 1) {
      const [dx, dy, dz] = directions[(n + offset) % directions.length];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const index = this.index(nx, ny, nz);
      if (this.energyTypes[index] !== MAT.EMPTY || !this.wallAllows(type, nx, ny, nz)) continue;
      this.setEnergy(nx, ny, nz, type, properties.temperature ?? materialById(type).defaultTemp, properties.life, properties);
      this.energyProcessed[index] = this.epoch;
      return index;
    }
    return -1;
  }

  photonPasses(matterType) {
    if (matterType === MAT.EMPTY) return true;
    const matter = materialById(matterType);
    return matter.properties.includes("PROP_PHOTPASS")
      || [MAT.GLAS, MAT.BGLA, MAT.FILT, MAT.INVIS, MAT.QRTZ, MAT.PQRT].includes(matterType);
  }

  selectPhotonWavelength(index) {
    let wavelengths = this.energyCtype[index] & PHOTON_WAVELENGTH_MASK;
    if (!wavelengths) return -1;
    let first = 0;
    while (first < 30 && !(wavelengths & (1 << first))) first += 1;
    let last = 29;
    while (last >= 0 && !(wavelengths & (1 << last))) last -= 1;
    if (last - first < 5) return first + last;
    const start = first + Math.floor(this.random() * (last - first - 4));
    if (this.random() < 0.5) {
      wavelengths &= 0x1f << start;
      this.energyCtype[index] = wavelengths;
      return (start + 2) * 2;
    }
    wavelengths &= 0x0f << start;
    this.energyCtype[index] = wavelengths;
    return (start + 2) * 2 - 1;
  }

  opticalSurfaceNormal(x, y, z, incident, predicate, outward = true) {
    const sample = (sx, sy, sz) => this.inBounds(sx, sy, sz) && predicate(this.types[this.index(sx, sy, sz)]) ? 1 : 0;
    let nx = sample(x + 1, y, z) - sample(x - 1, y, z);
    let ny = sample(x, y + 1, z) - sample(x, y - 1, z);
    let nz = sample(x, y, z + 1) - sample(x, y, z - 1);
    if (outward) { nx = -nx; ny = -ny; nz = -nz; }
    let magnitude = Math.hypot(nx, ny, nz);
    if (magnitude < 1e-6) {
      [nx, ny, nz] = [-incident[0], -incident[1], -incident[2]];
      magnitude = Math.hypot(nx, ny, nz) || 1;
    }
    nx /= magnitude;
    ny /= magnitude;
    nz /= magnitude;
    if (nx * incident[0] + ny * incident[1] + nz * incident[2] > 0) return [-nx, -ny, -nz];
    return [nx, ny, nz];
  }

  setEnergyDirection(index, direction, speed = Math.hypot(this.energyVelocityX[index], this.energyVelocityY[index], this.energyVelocityZ[index])) {
    const magnitude = Math.hypot(...direction) || 1;
    this.energyVelocityX[index] = direction[0] / magnitude * speed;
    this.energyVelocityY[index] = direction[1] / magnitude * speed;
    this.energyVelocityZ[index] = direction[2] / magnitude * speed;
  }

  randomizeEnergyDirection(index, speed = Math.hypot(this.energyVelocityX[index], this.energyVelocityY[index], this.energyVelocityZ[index]) || 3) {
    const vertical = this.random() * 2 - 1;
    const azimuth = this.random() * Math.PI * 2;
    const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    this.setEnergyDirection(index, [Math.cos(azimuth) * radial, vertical, Math.sin(azimuth) * radial], speed);
  }

  refractPhotonAtBoundary(index, from, to) {
    if (this.energyTypes[index] !== MAT.PHOT) return "none";
    const fromGlass = GLASS_TYPES.has(this.types[this.index(...from)]);
    const toGlass = GLASS_TYPES.has(this.types[this.index(...to)]);
    if (fromGlass === toGlass) return "none";
    const wavelength = this.selectPhotonWavelength(index);
    if (wavelength < 0) {
      this.killEnergy(index);
      return "absorbed";
    }
    const speed = Math.hypot(this.energyVelocityX[index], this.energyVelocityY[index], this.energyVelocityZ[index]);
    if (speed < 1e-6) return "none";
    const incident = [this.energyVelocityX[index] / speed, this.energyVelocityY[index] / speed, this.energyVelocityZ[index] / speed];
    const boundary = toGlass ? to : from;
    const normal = this.opticalSurfaceNormal(...boundary, incident, (type) => GLASS_TYPES.has(type), toGlass);
    const refractiveIndex = GLASS_IOR - GLASS_DISPERSION * (wavelength - 30) / 30;
    const eta = toGlass ? 1 / refractiveIndex : refractiveIndex;
    const cosine = -(normal[0] * incident[0] + normal[1] * incident[1] + normal[2] * incident[2]);
    const discriminant = 1 - eta * eta * (1 - cosine * cosine);
    if (discriminant < 0) {
      this.setEnergyDirection(index, [
        incident[0] + 2 * cosine * normal[0],
        incident[1] + 2 * cosine * normal[1],
        incident[2] + 2 * cosine * normal[2],
      ], speed);
      return "reflected";
    }
    const normalScale = eta * cosine - Math.sqrt(discriminant);
    this.setEnergyDirection(index, [
      eta * incident[0] + normalScale * normal[0],
      eta * incident[1] + normalScale * normal[1],
      eta * incident[2] + normalScale * normal[2],
    ], speed);
    return "refracted";
  }

  photonReflectionMask(index, type) {
    let mask = materialById(type).photonReflectWavelengths ?? PHOTON_WAVELENGTH_MASK;
    if (type === MAT.LITH) mask = 0x1f << Math.max(0, Math.min(25, Math.floor(this.ctype[index] / 4)));
    else if (type === MAT.SEED) {
      const colorGenes = (this.ctype[index] >> 6) & 0x3f;
      if (!(colorGenes & 0b110000)) mask |= 1 << 25;
      if (!(colorGenes & 0b001100)) mask |= 1 << 15;
      if (!(colorGenes & 0b000011)) mask |= 1 << 5;
    }
    return mask & PHOTON_WAVELENGTH_MASK;
  }

  reflectPhotonFromMatter(index, target, x, y, z) {
    this.energyCtype[index] &= this.photonReflectionMask(target, this.types[target]);
    if (!(this.energyCtype[index] & PHOTON_WAVELENGTH_MASK)) {
      this.killEnergy(index);
      return false;
    }
    const speed = Math.hypot(this.energyVelocityX[index], this.energyVelocityY[index], this.energyVelocityZ[index]);
    if (speed < 1e-6) {
      this.randomizeEnergyDirection(index, 3);
      return true;
    }
    const incident = [this.energyVelocityX[index] / speed, this.energyVelocityY[index] / speed, this.energyVelocityZ[index] / speed];
    let normal = this.opticalSurfaceNormal(x, y, z, incident, (type) => type !== MAT.EMPTY && !this.photonPasses(type), true);
    if (this.types[target] === MAT.CRMC) {
      normal = normal.map((component) => component + (this.random() * 2 - 1) ** 3 * 0.18);
      const magnitude = Math.hypot(...normal) || 1;
      normal = normal.map((component) => component / magnitude);
    }
    const dot = incident[0] * normal[0] + incident[1] * normal[1] + incident[2] * normal[2];
    this.setEnergyDirection(index, [
      incident[0] - 2 * dot * normal[0],
      incident[1] - 2 * dot * normal[1],
      incident[2] - 2 * dot * normal[2],
    ], speed * 0.99);
    return true;
  }

  filterWavelength(index, original) {
    const mask = 0x3fffffff;
    const temperatureBin = Math.max(0, Math.min(25, Math.floor(this.temperatures[index] * 0.025)));
    const filter = (this.ctype[index] & mask) || ((0x1f << temperatureBin) & mask);
    switch (this.tmp[index]) {
      case 1: return original & filter;
      case 2: return original | filter;
      case 3: return original & (~filter);
      case 4: return (original << Math.max(1, temperatureBin)) & mask;
      case 5: return (original >>> Math.max(1, temperatureBin)) & mask;
      case 6: return original & mask;
      case 7: return (original ^ filter) & mask;
      case 8: return (~original) & mask;
      case 9: {
        const jitter = () => Math.floor(this.random() * 5) - 2;
        const red = Math.max(0, Math.min(255, ((original >> 16) & 0xff) + jitter()));
        const green = Math.max(0, Math.min(255, ((original >> 8) & 0xff) + jitter()));
        const blue = Math.max(0, Math.min(255, (original & 0xff) + jitter()));
        return ((original & 0x3f000000) | (red << 16) | (green << 8) | blue) & mask;
      }
      case 10: {
        const leastBit = filter & -filter;
        return leastBit ? (original * leastBit) & mask : original;
      }
      case 11: {
        const leastBit = filter & -filter;
        return leastBit ? Math.floor(original / leastBit) & mask : original;
      }
      default: return filter;
    }
  }

  interactEnergy(index, x, y, z, firstInteraction = true) {
    const type = this.energyTypes[index];
    const matterType = this.types[index];
    if (type === MAT.EMPTY) return false;
    if (matterType === MAT.PRTI) {
      const direction = this.portalDirectionIndex(-this.energyVelocityX[index], -this.energyVelocityY[index], -this.energyVelocityZ[index]);
      if (this.enqueuePortalParticle(index, direction, this.portalParticleState(index, true))) {
        this.killEnergy(index);
        return true;
      }
    }

    if (type === MAT.PHOT) {
      if (!(this.energyCtype[index] & 0x3fffffff)) {
        this.killEnergy(index);
        return true;
      }
      if (this.energyTemperatures[index] > 232.85 && this.random() < 1 / 10) {
        let exposed = false;
        this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
          if (neighborType === MAT.EMPTY) exposed = true;
          return false;
        });
        this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
          if (neighborType === MAT.EMPTY || neighborType === MAT.INSL) return false;
          const material = materialById(neighborType);
          const flammability = UPSTREAM_FLAMMABILITY.get(neighborType) ?? 0;
          const pressure = this.air.sampleVoxel(...this.coords(neighbor)).pressure;
          const ignitionChance = Math.max(0, Math.trunc(flammability + pressure * 10) / 1000);
          if ((exposed || material.explosive) && flammability > 0
            && (neighborType !== MAT.SPNG || this.life[neighbor] === 0) && this.random() < ignitionChance) {
            this.changeTypePreserve(neighbor, MAT.FIRE);
            this.temperatures[neighbor] = Math.max(-273.15, Math.min(9725.85,
              materialById(MAT.FIRE).defaultTemp + flammability / 2));
            this.life[neighbor] = 180 + Math.floor(this.random() * 80);
            this.tmp[neighbor] = 0;
            this.ctype[neighbor] = 0;
            if (material.explosive) this.air.injectVoxel(x, y, z, 0.25, 0);
          }
          return false;
        });
      }
      if (matterType === MAT.FILT) this.energyCtype[index] = this.filterWavelength(index, this.energyCtype[index]);
      if (matterType === MAT.C5) {
        const wavelength = this.energyCtype[index] & PHOTON_WAVELENGTH_MASK;
        if (this.life[index] > 0 && (this.ctype[index] & wavelength & 0x3fffffc0)) {
          const storedVelocity = [
            unpackVelocityLow(this.tmp[index]), unpackVelocityHigh(this.tmp[index]), unpackVelocityLow(this.tmp3[index]),
          ];
          const originalSpeed = Math.hypot(this.energyVelocityX[index], this.energyVelocityY[index], this.energyVelocityZ[index]) || 3;
          let combined = [
            this.energyVelocityX[index] + storedVelocity[0],
            this.energyVelocityY[index] + storedVelocity[1],
            this.energyVelocityZ[index] + storedVelocity[2],
          ];
          if (Math.hypot(...combined) < 1e-9) {
            const axis = Math.abs(storedVelocity[0]) < Math.abs(storedVelocity[1]) ? [1, 0, 0] : [0, 1, 0];
            combined = [
              storedVelocity[1] * axis[2] - storedVelocity[2] * axis[1],
              storedVelocity[2] * axis[0] - storedVelocity[0] * axis[2],
              storedVelocity[0] * axis[1] - storedVelocity[1] * axis[0],
            ];
            if (Math.hypot(...combined) < 1e-9) combined = [0, storedVelocity[2], -storedVelocity[1]];
          }
          this.energyCtype[index] = ((this.ctype[index] & wavelength) >>> 6) & PHOTON_WAVELENGTH_MASK;
          this.setEnergyDirection(index, combined, originalSpeed);
          this.life[index] = 0;
          this.ctype[index] = 0;
        } else if (!this.ctype[index] && (wavelength & 0x3fffffc0)) {
          this.life[index] = 1;
          this.ctype[index] = wavelength;
          this.tmp[index] = packVelocityPair(this.energyVelocityX[index], this.energyVelocityY[index]);
          this.tmp3[index] = packVelocityPair(this.energyVelocityZ[index], 0);
          this.killEnergy(index);
          return true;
        }
      }
      if (matterType === MAT.FILT && this.tmp[index] === 9) {
        this.energyVelocityX[index] += (Math.floor(this.random() * 1001) - 500) / 1000;
        this.energyVelocityY[index] += (Math.floor(this.random() * 1001) - 500) / 1000;
        this.energyVelocityZ[index] += (Math.floor(this.random() * 1001) - 500) / 1000;
      }
      if (matterType === MAT.BGLA) {
        const speed = Math.hypot(this.energyVelocityX[index], this.energyVelocityY[index], this.energyVelocityZ[index]) || 3;
        const direction = [
          this.energyVelocityX[index] / speed + (this.random() * 2 - 1) * 0.05,
          this.energyVelocityY[index] / speed + (this.random() * 2 - 1) * 0.05,
          this.energyVelocityZ[index] / speed + (this.random() * 2 - 1) * 0.05,
        ];
        this.setEnergyDirection(index, direction, speed);
      }
      if (matterType === MAT.QRTZ || matterType === MAT.PQRT) {
        this.randomizeEnergyDirection(index);
        if (this.energyCtype[index] === PHOTON_WAVELENGTH_MASK) this.energyCtype[index] = 0x1f << Math.floor(this.random() * 26);
        if (this.energyLife[index]) this.energyLife[index] += 1;
      }
      if (matterType === MAT.RSST) {
        const storedType = this.ctype[index];
        const carriedType = this.tmp[index];
        if (this.validElementType(storedType)) {
          this.set(x, y, z, storedType);
          if (this.validElementType(carriedType) && materialById(storedType).carriesCtype) this.ctype[index] = carriedType;
        } else this.changeTypePreserve(index, MAT.RSSS);
        this.killEnergy(index);
        return true;
      }
      for (let iz = -1; iz <= 1; iz += 1) {
        for (let iy = -1; iy <= 1; iy += 1) {
          for (let ix = -1; ix <= 1; ix += 1) {
            const isotopeX = x + ix;
            const isotopeY = y + iy;
            const isotopeZ = z + iz;
            if (!this.inBounds(isotopeX, isotopeY, isotopeZ)) continue;
            const isotope = this.index(isotopeX, isotopeY, isotopeZ);
            const isotopeType = this.types[isotope];
            if (![MAT.ISOZ, MAT.ISZS].includes(isotopeType) || this.random() >= 1 / 400) continue;
            const maximum = isotopeType === MAT.ISOZ ? 255 : 355;
            const speed = Math.trunc((128 + Math.floor(this.random() * (maximum - 127))) / 127);
            const azimuth = this.random() * Math.PI * 2;
            const elevation = (this.random() - 0.5) * Math.PI;
            const replacement = this.createEnergyNearby(isotopeX, isotopeY, isotopeZ, MAT.PHOT, {
              velocityX: Math.cos(azimuth) * Math.cos(elevation) * speed,
              velocityY: Math.sin(elevation) * speed,
              velocityZ: Math.sin(azimuth) * Math.cos(elevation) * speed,
            });
            if (replacement >= 0) {
              this.energyVelocityX[index] *= 0.9;
              this.energyVelocityY[index] *= 0.9;
              this.energyVelocityZ[index] *= 0.9;
              this.set(isotopeX, isotopeY, isotopeZ, MAT.EMPTY);
              this.air.injectVoxel(x, y, z, -15, 0);
            }
          }
        }
      }
      if (matterType === MAT.POLO && this.tmp[index] < 5 && this.life[index] === 0 && this.random() < 1 / 100) {
        const neutron = this.createEnergyNearby(x, y, z, MAT.NEUT, {
          temperature: (this.temperatures[index] + this.energyTemperatures[index] * 2 + 600) / 3,
        });
        if (neutron >= 0) {
          this.life[index] = 15;
          this.tmp[index] += 1;
          this.temperatures[index] = this.energyTemperatures[neutron];
          this.energyTemperatures[index] = this.energyTemperatures[neutron];
        }
      }
      return false;
    }

    if (type === MAT.NEUT) {
      const sourceIndex = index;
      const targets = [];
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const tx = x + dx;
            const ty = y + dy;
            const tz = z + dz;
            if (this.inBounds(tx, ty, tz)) targets.push(this.index(tx, ty, tz));
          }
        }
      }
      const pressureFactor = Math.max(0, 3 + Math.trunc(this.air.sampleVoxel(x, y, z).pressure));
      for (const target of targets) {
        const targetType = this.types[target];
        if (targetType === MAT.EMPTY) continue;
        const [tx, ty, tz] = this.coords(target);

        if (target === sourceIndex && targetType === MAT.GOLD && this.random() < 1 / 7) {
          this.killEnergy(sourceIndex);
          return true;
        }
        if (target === sourceIndex && targetType === MAT.RSSS) {
          const storedType = this.ctype[target];
          const carriedType = this.tmp[target];
          if (this.validElementType(storedType)) {
            this.set(tx, ty, tz, storedType);
            if (this.validElementType(carriedType) && materialById(storedType).carriesCtype) this.ctype[target] = carriedType;
          } else this.changeTypePreserve(target, MAT.RSST);
          this.killEnergy(sourceIndex);
          return true;
        }
        if (target === sourceIndex && materialById(targetType).properties.includes("PROP_NEUTABSORB")) {
          this.killEnergy(sourceIndex);
          return true;
        }

        if (targetType === MAT.WATR) {
          if (this.random() < 3 / 20) this.changeTypePreserve(target, MAT.DSTW);
          this.energyVelocityX[sourceIndex] *= 0.995;
          this.energyVelocityY[sourceIndex] *= 0.995;
          this.energyVelocityZ[sourceIndex] *= 0.995;
        } else if (targetType === MAT.ICEI || targetType === MAT.SNOW) {
          this.energyVelocityX[sourceIndex] *= 0.995;
          this.energyVelocityY[sourceIndex] *= 0.995;
          this.energyVelocityZ[sourceIndex] *= 0.995;
        } else if (targetType === MAT.PLUT && this.random() < Math.min(1, pressureFactor / 1000)) {
          if (this.random() < 1 / 3) {
            const product = this.random() < 2 / 3 ? MAT.LAVA : MAT.URAN;
            this.set(tx, ty, tz, product, 9725.85);
            if (product === MAT.LAVA) {
              this.tmp[target] = 100;
              this.ctype[target] = MAT.PLUT;
            }
          } else {
            const incidentVelocity = [
              this.energyVelocityX[sourceIndex], this.energyVelocityY[sourceIndex], this.energyVelocityZ[sourceIndex],
            ];
            this.set(tx, ty, tz, MAT.EMPTY);
            const daughter = this.createEnergyNearby(tx, ty, tz, MAT.NEUT);
            if (daughter >= 0) {
              this.energyVelocityX[daughter] = this.energyVelocityX[daughter] * 0.25 + incidentVelocity[0];
              this.energyVelocityY[daughter] = this.energyVelocityY[daughter] * 0.25 + incidentVelocity[1];
              this.energyVelocityZ[daughter] = this.energyVelocityZ[daughter] * 0.25 + incidentVelocity[2];
            }
          }
          this.air.injectVoxel(x, y, z, 10, 0);
        } else if (targetType === MAT.DEUT) {
          const concentration = this.life[target];
          if (this.random() < Math.min(1, (pressureFactor + 1 + Math.trunc(concentration / 100)) / 1000)) {
            const count = Math.max(1, Math.min(340, Math.trunc(concentration / 50)));
            const neutronTemperature = Math.min(9725.85, this.temperatures[target] + concentration * 500);
            this.set(tx, ty, tz, MAT.EMPTY);
            for (let n = 0; n < count; n += 1) this.createEnergyNearby(tx, ty, tz, MAT.NEUT, { temperature: neutronTemperature });
            this.air.injectVoxel(tx, ty, tz, 6 * count, 0);
          }
        } else if (targetType === MAT.GUNP && this.random() < 3 / 200) this.changeTypePreserve(target, MAT.DUST);
        else if (targetType === MAT.DYST && this.random() < 3 / 200) this.changeTypePreserve(target, MAT.YEST);
        else if (targetType === MAT.YEST) this.changeTypePreserve(target, MAT.DYST);
        else if (targetType === MAT.PLEX && this.random() < 3 / 200) this.changeTypePreserve(target, MAT.GOO);
        else if (targetType === MAT.NITR && this.random() < 3 / 200) this.changeTypePreserve(target, MAT.DESL);
        else if (targetType === MAT.PLNT && this.random() < 1 / 20) this.set(tx, ty, tz, MAT.WOOD);
        else if ([MAT.DESL, MAT.OIL].includes(targetType) && this.random() < 3 / 200) this.changeTypePreserve(target, MAT.GAS);
        else if (targetType === MAT.COAL && this.random() < 1 / 20) this.set(tx, ty, tz, MAT.WOOD);
        else if (targetType === MAT.BCOL && this.random() < 1 / 20) this.set(tx, ty, tz, MAT.SAWD);
        else if (targetType === MAT.DUST && this.random() < 1 / 20) this.changeTypePreserve(target, MAT.FWRK);
        else if (targetType === MAT.FWRK && this.random() < 1 / 20) this.ctype[target] = MAT.DUST;
        else if (targetType === MAT.ACID && this.random() < 1 / 20) this.set(tx, ty, tz, MAT.ISOZ);
        else if (targetType === MAT.TTAN && this.random() < 1 / 20) {
          this.killEnergy(sourceIndex);
          return true;
        } else if (targetType === MAT.EXOT && this.random() < 1 / 20) this.life[target] = 1500;
        else if (targetType === MAT.RFRG) this.set(tx, ty, tz, this.random() < 1 / 2 ? MAT.GAS : MAT.CAUS);
        else if (targetType === MAT.BASE && this.temperatures[target] > 50 && this.random() < 1 / 35) this.set(tx, ty, tz, MAT.LRBD);
        else if (target === sourceIndex && targetType === MAT.SEED) {
          const mutation = Math.floor(this.random() * 10);
          if (mutation === 0) this.ctype[target] ^= 1 << (PLANT_COLOR_SHIFT + Math.floor(this.random() * 6));
          else if (mutation >= 1 && mutation <= 4) {
            const field = [this.tmp, this.tmp2, this.tmp3, this.tmp4][mutation - 1];
            field[target] ^= 1 << Math.floor(this.random() * PLANT_GENOME_BITS);
          }
        }
      }
      return this.energyTypes[index] === MAT.EMPTY;
    }

    if (type === MAT.ELEC) {
      const electronTemperature = this.energyTemperatures[index];
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const tx = x + dx;
            const ty = y + dy;
            const tz = z + dz;
            if (!this.inBounds(tx, ty, tz)) continue;
            const target = this.index(tx, ty, tz);
            const targetMatter = this.types[target];
            const targetEnergy = targetMatter === MAT.EMPTY ? this.energyTypes[target] : MAT.EMPTY;
            const targetType = targetMatter !== MAT.EMPTY ? targetMatter : targetEnergy;
            if (targetType === MAT.EMPTY || (target === index && targetEnergy === MAT.ELEC)) continue;

            if (targetType === MAT.GLAS) {
              for (let ez = -1; ez <= 1; ez += 1) {
                for (let ey = -1; ey <= 1; ey += 1) {
                  for (let ex = -1; ex <= 1; ex += 1) {
                    const emberX = tx + ex;
                    const emberY = ty + ey;
                    const emberZ = tz + ez;
                    if (!this.inBounds(emberX, emberY, emberZ) || this.get(emberX, emberY, emberZ) !== MAT.EMPTY) continue;
                    this.set(emberX, emberY, emberZ, MAT.EMBR, electronTemperature * 0.8, 50, {
                      tmp: 0,
                      velocityX: Math.floor(this.random() * 21) - 10,
                      velocityY: Math.floor(this.random() * 21) - 10,
                      velocityZ: Math.floor(this.random() * 21) - 10,
                    });
                    this.processed[this.index(emberX, emberY, emberZ)] = this.epoch;
                  }
                }
              }
              this.killEnergy(index);
              return true;
            }
            if (targetType === MAT.LCRY) {
              this.tmp2[target] = 5 + Math.floor(this.random() * 5);
              continue;
            }
            if ([MAT.WATR, MAT.DSTW, MAT.SLTW, MAT.CBNW].includes(targetType)) {
              this.set(tx, ty, tz, this.random() < 1 / 3 ? MAT.O2 : MAT.H2);
              this.killEnergy(index);
              return true;
            }
            if (targetEnergy === MAT.PROT || targetEnergy === MAT.NEUT) {
              if (targetEnergy === MAT.PROT && (this.energyTmp2[target] & 1)) continue;
              const productTemperature = this.energyTemperatures[target];
              this.killEnergy(target);
              this.set(tx, ty, tz, MAT.H2, productTemperature, 0, { ctype: 0 });
              this.killEnergy(index);
              return true;
            }
            if (targetType === MAT.DEUT) {
              this.life[target] = Math.min(6000, this.life[target] + 1);
              this.temperatures[target] = -273.15;
              this.killEnergy(index);
              return true;
            }
            if (targetType === MAT.EXOT) {
              this.tmp2[target] += 5;
              this.life[target] = 1000;
              continue;
            }
            if (target === index && targetType === MAT.RSST) {
              this.set(tx, ty, tz, MAT.EMPTY);
              this.killEnergy(index);
              return true;
            }
            if (targetMatter !== MAT.EMPTY && materialById(targetType).properties.includes("PROP_CONDUCTS")
              && (targetType !== MAT.NBLE || electronTemperature < 1999.85)) {
              if (this.life[target] === 0) this.spark(target, targetType, 4);
              this.killEnergy(index);
              return true;
            }
          }
        }
      }
      return false;
    }

    if (type === MAT.PROT) {
      if (firstInteraction) this.air.injectVoxel(x, y, z, -0.003, 0);
      if (matterType === MAT.POLO) {
        this.tmp2[index] += 1;
        this.killEnergy(index);
        return true;
      } else if (matterType === MAT.RSSS) {
        this.transform(index, MAT.EMPTY, 22, 0);
        this.killEnergy(index);
        return true;
      } else if (matterType === MAT.SPRK) {
        const conductor = this.ctype[index] || MAT.METL;
        this.changeTypePreserve(index, conductor);
        this.ctype[index] = 0;
        this.life[index] += 44;
      } else if (matterType === MAT.DEUT
        && this.random() < Math.max(0, 4 - Math.trunc(this.air.sampleVoxel(x, y, z).pressure) + Math.trunc(this.life[index] / 100)) / 200) {
        const concentration = this.life[index];
        const count = Math.max(1, Math.min(340, Math.trunc(concentration / 50)));
        const protonTemperature = Math.min(9725.85, this.temperatures[index] + concentration * 500);
        this.set(x, y, z, MAT.EMPTY);
        for (let n = 0; n < count; n += 1) this.createEnergyNearby(x, y, z, MAT.PROT, { temperature: protonTemperature });
        this.air.injectVoxel(x, y, z, -6 * count, 0);
      } else if (matterType === MAT.LCRY && this.life[index] > 5 && this.random() < 0.1) {
        this.transformEnergy(index, MAT.PHOT, { life: Math.min(65535, this.energyLife[index] * 2), ctype: 0x3fffffff });
      } else if (matterType === MAT.EXOT) this.ctype[index] = MAT.PROT;
      else if (matterType === MAT.WIFI) {
        const protonTemperature = this.energyTemperatures[index];
        const change = protonTemperature < -100 ? -1000 : protonTemperature < 0 ? -100
          : protonTemperature > 200 ? 1000 : protonTemperature > 100 ? 100 : 0;
        this.temperatures[index] = Math.max(-273.15, Math.min(9725.85, this.temperatures[index] + change));
      } else if (matterType === MAT.SEED) {
        if (this.random() < 1 / 2) {
          const fields = [this.tmp, this.tmp2, this.tmp3, this.tmp4];
          const first = Math.floor(this.random() * fields.length);
          const second = Math.floor(this.random() * fields.length);
          const carried = fields[first][index];
          fields[first][index] = fields[second][index];
          fields[second][index] = carried;
        }
      } else if (matterType !== MAT.EMPTY) {
        const material = materialById(matterType);
        const rawFlammability = UPSTREAM_FLAMMABILITY.get(matterType) ?? 0;
        if (this.energyTemperatures[index] > 500 && (rawFlammability > 0 || material.explosive || matterType === MAT.BANG)) {
          this.set(x, y, z, MAT.FIRE);
          this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + rawFlammability * 5);
          this.air.injectVoxel(x, y, z, 1, 0);
        } else if (material.properties.includes("PROP_CONDUCTS") && this.life[index] <= 4) this.life[index] += 40;
      }

      const activeMatter = this.types[index];
      if (activeMatter !== MAT.EMPTY && matterType !== MAT.WIFI) {
        this.temperatures[index] = Math.max(-273.15, Math.min(9725.85,
          this.temperatures[index] - (this.temperatures[index] - this.energyTemperatures[index]) / 4));
      }

      if (this.energyTypes[index] === MAT.PROT && this.energyTmp[index]) {
        const collisionEnergy = this.energyTmp[index];
        let product;
        if (collisionEnergy > 500000) product = matterType === MAT.TUNG ? MAT.AMTR : MAT.SING;
        else if (collisionEnergy > 700) product = MAT.PLUT;
        else if (collisionEnergy > 420) product = MAT.URAN;
        else if (collisionEnergy > 310) product = MAT.POLO;
        else if (collisionEnergy > 250) product = MAT.PLSM;
        else if (collisionEnergy > 100) product = MAT.O2;
        else if (collisionEnergy > 50) product = MAT.CO2;
        else product = MAT.NBLE;
        const productX = x + Math.floor(this.random() * 3) - 1;
        const productY = y + Math.floor(this.random() * 3) - 1;
        const productZ = z + Math.floor(this.random() * 3) - 1;
        if (this.inBounds(productX, productY, productZ) && this.get(productX, productY, productZ) === MAT.EMPTY) {
          const productTemperature = Math.max(-273.15, Math.min(9725.85, collisionEnergy * 100 - 273.15));
          this.set(productX, productY, productZ, product);
          this.temperatures[this.index(productX, productY, productZ)] = productTemperature;
        }
        this.killEnergy(index);
        return true;
      }
      return false;
    }

    if (type === MAT.GRVT) {
      this.energyTmp[index] = Math.max(-100, Math.min(100, this.energyTmp[index]));
      if (matterType === MAT.RSSS && this.random() < 0.2) {
        this.killEnergy(index);
        return true;
      }
      this.air.injectVoxel(x, y, z, this.energyTmp[index] * 0.02, 0, 0, this.energyTmp[index] * 0.002, 0);
    }
    return false;
  }

  energyPassesMatter(type, matterType) {
    if (matterType === MAT.EMPTY) return true;
    if (type === MAT.PHOT) return this.photonPasses(matterType);
    if (type === MAT.NEUT) return !materialById(matterType).properties.includes("PROP_NEUTABSORB");
    return true;
  }

  updateEnergyParticle(startIndex) {
    let index = startIndex;
    let type = this.energyTypes[index];
    if (type === MAT.EMPTY) return;
    if (type !== MAT.PROT && this.energyLife[index] > 0) this.energyLife[index] -= 1;
    if (this.energyLife[index] === 0 && [MAT.PHOT, MAT.NEUT, MAT.ELEC, MAT.GRVT].includes(type)) {
      this.killEnergy(index);
      return;
    }
    let [x, y, z] = this.coords(index);
    if (type === MAT.PROT && this.types[index] === MAT.EMPTY && this.energyLife[index] > 0) {
      this.energyLife[index] -= 1;
      if (this.energyLife[index] === 0) {
        this.killEnergy(index);
        return;
      }
    }
    if (this.interactEnergy(index, x, y, z)) return;
    type = this.energyTypes[index];
    if (type === MAT.EMPTY) return;

    const gravity = this.gravity.sampleVoxel(x, y, z);
    const newtonianResponse = materialById(type).upstream?.newtonianGravity ?? 1;
    this.energyVelocityX[index] += gravity.forceX * newtonianResponse * 0.045;
    this.energyVelocityY[index] += gravity.forceY * newtonianResponse * 0.045;
    this.energyVelocityZ[index] += gravity.forceZ * newtonianResponse * 0.045;
    let vx = this.energyVelocityX[index];
    let vy = this.energyVelocityY[index];
    let vz = this.energyVelocityZ[index];
    const substeps = Math.max(1, Math.min(4, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz)))));
    for (let step = 0; step < substeps; step += 1) {
      let dx = Math.abs(vx) / substeps > this.random() ? Math.sign(vx) : 0;
      let dy = Math.abs(vy) / substeps > this.random() ? Math.sign(vy) : 0;
      let dz = Math.abs(vz) / substeps > this.random() ? Math.sign(vz) : 0;
      if (!dx && !dy && !dz) {
        const dominant = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz));
        if (dominant === Math.abs(vx)) dx = Math.sign(vx);
        else if (dominant === Math.abs(vy)) dy = Math.sign(vy);
        else dz = Math.sign(vz);
      }
      let nx = x + dx;
      let ny = y + dy;
      let nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) {
        if (this.edgeMode === 0) {
          this.killEnergy(index);
          return;
        }
        if (this.edgeMode === 2) {
          nx = (nx + this.width) % this.width;
          ny = (ny + this.height) % this.height;
          nz = (nz + this.depth) % this.depth;
        }
      }
      if (!this.inBounds(nx, ny, nz) || !this.wallAllows(type, nx, ny, nz)) {
        if (dx) this.energyVelocityX[index] *= -0.92;
        if (dy) this.energyVelocityY[index] *= -0.92;
        if (dz) this.energyVelocityZ[index] *= -0.92;
        break;
      }
      const target = this.index(nx, ny, nz);
      const otherEnergy = this.energyTypes[target];
      if (otherEnergy !== MAT.EMPTY) {
        if ((type === MAT.ELEC && [MAT.NEUT, MAT.PROT].includes(otherEnergy)) || (otherEnergy === MAT.ELEC && [MAT.NEUT, MAT.PROT].includes(type))) {
          const proton = type === MAT.PROT ? index : otherEnergy === MAT.PROT ? target : -1;
          if (proton >= 0 && (this.energyTmp2[proton] & 1)) {
            this.energyVelocityX[index] *= -0.9;
            this.energyVelocityY[index] *= -0.9;
            this.energyVelocityZ[index] *= -0.9;
            break;
          }
          const heavy = type === MAT.ELEC ? target : index;
          if (this.types[target] === MAT.EMPTY) this.set(nx, ny, nz, MAT.H2, this.energyTemperatures[heavy], 0, { ctype: 0 });
          this.killEnergy(target);
          this.killEnergy(index);
          return;
        }
        if (type === MAT.PROT && otherEnergy === MAT.PROT) {
          const firstSpeedSq = this.energyVelocityX[index] ** 2 + this.energyVelocityY[index] ** 2 + this.energyVelocityZ[index] ** 2;
          const secondSpeedSq = this.energyVelocityX[target] ** 2 + this.energyVelocityY[target] ** 2 + this.energyVelocityZ[target] ** 2;
          const speedProduct = Math.sqrt(firstSpeedSq * secondSpeedSq);
          const directionCosine = speedProduct > 0 ? (
            this.energyVelocityX[index] * this.energyVelocityX[target]
            + this.energyVelocityY[index] * this.energyVelocityY[target]
            + this.energyVelocityZ[index] * this.energyVelocityZ[target]
          ) / speedProduct : 1;
          if (directionCosine < -Math.cos(0.015) && firstSpeedSq + secondSpeedSq > 10) {
            this.energyTmp[target] += Math.trunc(firstSpeedSq + secondSpeedSq);
            this.killEnergy(index);
            return;
          }
        }
        this.energyVelocityX[index] *= -0.9;
        this.energyVelocityY[index] *= -0.9;
        this.energyVelocityZ[index] *= -0.9;
        break;
      }
      const matterType = this.types[target];
      if (!this.energyPassesMatter(type, matterType)) {
        if (type === MAT.PHOT && matterType !== MAT.EMPTY) {
          this.temperatures[target] = Math.min(9725.85, this.temperatures[target] + 2);
          this.reflectPhotonFromMatter(index, target, nx, ny, nz);
        } else {
          this.energyVelocityX[index] *= dx ? -0.94 : 1;
          this.energyVelocityY[index] *= dy ? -0.94 : 1;
          this.energyVelocityZ[index] *= dz ? -0.94 : 1;
        }
        break;
      }
      if (type === MAT.PHOT && GLASS_TYPES.has(this.types[index]) !== GLASS_TYPES.has(matterType)) {
        const opticalResult = this.refractPhotonAtBoundary(index, [x, y, z], [nx, ny, nz]);
        if (opticalResult === "absorbed") return;
        if (opticalResult === "reflected") break;
        vx = this.energyVelocityX[index];
        vy = this.energyVelocityY[index];
        vz = this.energyVelocityZ[index];
      }
      if (!this.moveEnergy(index, target)) break;
      index = target;
      x = nx;
      y = ny;
      z = nz;
      if (this.interactEnergy(index, x, y, z, false)) return;
      type = this.energyTypes[index];
      if (type === MAT.EMPTY) return;
      vx = this.energyVelocityX[index];
      vy = this.energyVelocityY[index];
      vz = this.energyVelocityZ[index];
    }
  }

  updateEnergy() {
    for (let index = 0; index < this.size; index += 1) {
      if (this.energyTypes[index] === MAT.EMPTY || this.energyProcessed[index] === this.epoch) continue;
      this.energyProcessed[index] = this.epoch;
      this.updateEnergyParticle(index);
    }
  }

  conductHeat(index, x, y, z) {
    const type = this.types[index];
    const material = materialById(type);
    if (this.heatInsulatorAt(index)) return false;
    const gelScale = type === MAT.GEL ? this.tmp[index] * 2.55 : 1;
    const conductChance = (material.upstream?.heatConduct ?? Math.round((material.conductivity ?? 0) * 255)) * gelScale / 250;
    if (this.random() >= conductChance) return false;

    const heatCapacityAt = (particleIndex) => {
      const particleType = this.types[particleIndex];
      let capacity = materialById(particleType).heatCapacity ?? 1;
      if ((particleType === MAT.PIPE || particleType === MAT.PPIP)
        && this.ctype[particleIndex] > MAT.EMPTY && materialById(this.ctype[particleIndex]).id === this.ctype[particleIndex]
        && materialById(this.ctype[particleIndex]).enabled) {
        capacity += materialById(this.ctype[particleIndex]).heatCapacity ?? 1;
      }
      return capacity;
    };

    const airIndex = this.air.indexForVoxel(x, y, z);
    if (this.air.ambientHeatEnabled && !material.properties.includes("PROP_NOAMBHEAT")) {
      const delta = this.air.ambientHeat[airIndex] - this.temperatures[index];
      const capacity = heatCapacityAt(index);
      const alpha = Math.min(0.04, 0.4 * capacity);
      this.temperatures[index] = Math.max(-273.15, Math.min(9725.85, this.temperatures[index] + alpha * delta / capacity));
      this.air.ambientHeat[airIndex] = Math.max(-273.15, Math.min(9725.85, this.air.ambientHeat[airIndex] - alpha * delta));
    }

    const neighbors = [];
    let capacityTotal = heatCapacityAt(index);
    let heatTotal = this.temperatures[index] * capacityTotal;
    for (const [dx, dy, dz] of DIRECTIONS_26) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      const neighborType = this.types[neighbor];
      if (neighborType === MAT.EMPTY || this.heatInsulatorAt(neighbor)
        || (type === MAT.FILT && [MAT.BRAY, MAT.BIZR, MAT.BIZRG].includes(neighborType))
        || (neighborType === MAT.FILT && [MAT.BRAY, MAT.PHOT, MAT.BIZR, MAT.BIZRG].includes(type))
        || (type === MAT.ELEC && neighborType === MAT.DEUT)
        || (type === MAT.DEUT && neighborType === MAT.ELEC)
        || (type === MAT.HSWC && neighborType === MAT.FILT && this.tmp[index] === 1)
        || (type === MAT.FILT && neighborType === MAT.HSWC && this.tmp[neighbor] === 1)) continue;
      const capacity = heatCapacityAt(neighbor);
      heatTotal += this.temperatures[neighbor] * capacity;
      capacityTotal += capacity;
      neighbors.push(neighbor);
    }
    const equilibrium = Math.max(-273.15, Math.min(9725.85, heatTotal / capacityTotal));
    this.temperatures[index] = equilibrium;
    for (const neighbor of neighbors) this.temperatures[neighbor] = equilibrium;
    return true;
  }

  applyPhaseChange(index, type) {
    const temperature = this.temperatures[index];
    const material = materialById(type);
    const [x, y, z] = this.coords(index);
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if ((type === MAT.NITR || type === MAT.PLEX) && pressure > 2.5) {
      const flammability = UPSTREAM_FLAMMABILITY.get(type) ?? 0;
      this.changeTypePreserve(index, MAT.FIRE);
      this.life[index] = 180 + Math.floor(this.random() * 80);
      this.temperatures[index] = Math.max(-273.15, Math.min(9725.85, 422 + flammability / 2));
      this.air.injectVoxel(x, y, z, 0.25, 0);
      return true;
    }

    const gravityIndex = this.air.indexForVoxel(x, y, z);
    const gravityTotal = Math.abs(this.gravity.forceX[gravityIndex] ?? 0)
      + Math.abs(this.gravity.forceY[gravityIndex] ?? 0)
      + Math.abs(this.gravity.forceZ[gravityIndex] ?? 0);
    const rawHighPressure = material.upstream.highPressureTransition;
    const rawLowPressure = material.upstream.lowPressureTransition;
    let pressureTarget = null;
    const resolvePressureTarget = (raw, resolved, pressureDriven, value) => {
      if (raw !== "ST") return resolved;
      if (type !== MAT.BMTL) return null;
      const fullThreshold = pressureDriven ? 2.5 : 0.625;
      const weakenedThreshold = pressureDriven ? 1 : 0.25;
      return value > fullThreshold || (value > weakenedThreshold && this.tmp[index] === 1) ? MAT.BRMT : null;
    };
    if (rawHighPressure != null && pressure > material.highPressure) {
      pressureTarget = resolvePressureTarget(rawHighPressure, material.highPressureTransition, true, pressure);
    } else if (rawLowPressure != null && pressure < material.lowPressure && gravityTotal <= material.lowPressure / 4) {
      pressureTarget = resolvePressureTarget(rawLowPressure, material.lowPressureTransition, true, pressure);
    } else if (rawHighPressure != null && gravityTotal > material.highPressure / 4) {
      pressureTarget = resolvePressureTarget(rawHighPressure, material.highPressureTransition, false, gravityTotal);
    }
    if (pressureTarget != null) {
      if (pressureTarget === MAT.EMPTY) this.transform(index, MAT.EMPTY, 22, 0);
      else {
        this.changeTypePreserve(index, pressureTarget);
        this.life[index] = 0;
        if (pressureTarget === MAT.BRMT) {
          this.ctype[index] = 0;
          this.tmp[index] = 0;
          this.tmp2[index] = 0;
          this.tmp3[index] = 0;
          this.tmp4[index] = 0;
        }
        if (pressureTarget === MAT.FIRE) this.life[index] = 120 + Math.min(49, Math.floor(this.random() * 50));
      }
      return true;
    }

    const rawHighTemperature = material.upstream.highTemperatureTransition;
    const rawLowTemperature = material.upstream.lowTemperatureTransition;
    const highTargetState = material.highTemperatureTransition == null ? null : materialById(material.highTemperatureTransition).state;
    const lowTargetState = material.lowTemperatureTransition == null ? null : materialById(material.lowTemperatureTransition).state;
    const highTemperature = temperature - (((material.state === "liquid" && highTargetState === "gas") || type === MAT.LNTG || type === MAT.SLTW) ? pressure * 2 : 0);
    const lowTemperature = temperature - (((material.state === "gas" && lowTargetState === "liquid") || type === MAT.WTRV) ? pressure * 2 : 0);
    if ((type === MAT.ICEI || type === MAT.SNOW)
      && (!this.ctype[index] || this.ctype[index] === MAT.ICEI || this.ctype[index] === MAT.SNOW)) this.ctype[index] = MAT.WATR;

    let transition = null;
    let specialLife = null;
    let lavaCtypeOverride = null;
    if (rawHighTemperature != null && highTemperature >= material.highTemperature) {
      if (rawHighTemperature !== "ST") {
        transition = material.highTemperatureTransition;
        if (type === MAT.FOG) this.ctype[index] = 0;
      } else if (type === MAT.ICEI || type === MAT.SNOW) {
        const storedType = this.ctype[index];
        if (storedType > MAT.EMPTY && storedType !== type && materialById(storedType).enabled) {
          const stored = materialById(storedType);
          const refreezes = stored.lowTemperatureTransition === MAT.ICEI || stored.lowTemperatureTransition === MAT.SNOW;
          if ((!refreezes || temperature >= stored.lowTemperature) && (refreezes || temperature >= -0.15)) {
            transition = storedType;
            this.ctype[index] = 0;
            this.life[index] = 0;
          }
        }
      } else if (type === MAT.SLTW) {
        transition = this.random() < 1 / 4 ? MAT.SALT : MAT.WTRV;
      } else if (type === MAT.BRMT) {
        if (this.ctype[index] !== MAT.TUNG || highTemperature >= materialById(MAT.TUNG).highTemperature) {
          transition = MAT.LAVA;
          if (this.ctype[index] === MAT.TUNG) lavaCtypeOverride = MAT.TUNG;
        }
      } else if (type === MAT.CRMC) {
        if (highTemperature >= this.phasePressureSum(x, y, z) + material.highTemperature) transition = MAT.LAVA;
      } else if (type === MAT.RIME) {
        if (this.tmp[index] > 5) {
          transition = MAT.ACID;
          specialLife = 25 + 5 * this.tmp[index];
          this.tmp[index] = 0;
        } else {
          transition = this.ctype[index] === MAT.DSTW ? MAT.DSTW : MAT.WATR;
          this.ctype[index] = 0;
        }
      }
    } else if (rawLowTemperature != null && lowTemperature < material.lowTemperature) {
      if (rawLowTemperature !== "ST") transition = material.lowTemperatureTransition;
      else if (type === MAT.WTRV) transition = temperature < -0.15 ? MAT.RIME : MAT.DSTW;
      else if (type === MAT.LAVA) {
        const storedType = this.ctype[index];
        if (storedType > MAT.EMPTY && storedType !== MAT.LAVA && materialById(storedType).enabled) {
          const stored = materialById(storedType);
          let remainsMolten = false;
          if (storedType === MAT.THRM) remainsMolten = temperature >= materialById(MAT.BMTL).highTemperature;
          else if (storedType === MAT.VIBR || storedType === MAT.BVBR) remainsMolten = temperature >= -0.15;
          else if (storedType === MAT.TUNG) remainsMolten = temperature >= stored.highTemperature;
          else if (storedType === MAT.CRMC) remainsMolten = highTemperature >= this.phasePressureSum(x, y, z) + stored.highTemperature;
          else if (stored.highTemperatureTransition === MAT.LAVA || storedType === MAT.HEAC) remainsMolten = temperature >= stored.highTemperature;
          else remainsMolten = temperature >= 699.85;
          if (!remainsMolten) {
            transition = storedType;
            this.ctype[index] = 0;
            if (transition === MAT.THRM) {
              this.tmp[index] = 0;
              transition = MAT.BMTL;
            } else if (transition === MAT.PLUT) {
              this.tmp[index] = 0;
              transition = MAT.LAVA;
            }
          }
        } else if (temperature < 699.85) transition = MAT.STNE;
      }
    }

    if (transition == null) return false;
    if (transition === MAT.EMPTY) {
      this.transform(index, MAT.EMPTY, 22, 0);
      return true;
    }
    const originalLife = this.life[index];
    if (transition === MAT.ICEI || transition === MAT.LAVA || transition === MAT.SNOW) this.ctype[index] = lavaCtypeOverride ?? type;
    if (transition === MAT.RIME) this.ctype[index] = MAT.DSTW;
    if (!(transition === MAT.ICEI && this.ctype[index] === MAT.FRZW) && transition !== MAT.ACID) this.life[index] = 0;
    this.changeTypePreserve(index, transition);
    if (specialLife != null) this.life[index] = specialLife;
    if (transition === MAT.ICEI && this.ctype[index] === MAT.FRZW) this.life[index] = originalLife;
    if (transition === MAT.FIRE) {
      this.tmp[index] = 0;
      if (type === MAT.SEED) {
        this.ctype[index] = 0;
        this.tmp2[index] = 0;
        this.tmp3[index] = 0;
        this.tmp4[index] = 0;
      }
    }
    if (materialById(transition).state === "gas" && material.state !== "gas") this.air.injectVoxel(x, y, z, 0.5, 0);
    if ([MAT.FIRE, MAT.PLSM, MAT.CFLM].includes(transition)) this.life[index] = 120 + Math.min(49, Math.floor(this.random() * 50));
    if (transition === MAT.LAVA) {
      if (this.ctype[index] === MAT.BRMT) this.ctype[index] = MAT.BMTL;
      else if ([MAT.SAND, MAT.BGLA].includes(this.ctype[index])) this.ctype[index] = MAT.GLAS;
      else if (this.ctype[index] === MAT.PQRT) this.ctype[index] = MAT.QRTZ;
      else if (this.ctype[index] === MAT.LITH && this.tmp2[index] > 3) this.ctype[index] = MAT.GLAS;
      this.life[index] = 240 + Math.min(119, Math.floor(this.random() * 120));
    }
    return true;
  }

  phasePressureSum(x, y, z) {
    let pressure = this.air.sampleVoxel(x, y, z).pressure;
    for (const [dx, dy, dz] of [[-2, 0, 0], [2, 0, 0], [0, -2, 0], [0, 2, 0], [0, 0, -2], [0, 0, 2]]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (this.inBounds(nx, ny, nz)) pressure += this.air.sampleVoxel(nx, ny, nz).pressure;
    }
    return Math.max(pressure * 2, 0);
  }

  updateCombustionInteractions(index, x, y, z, sourceType) {
    let surroundSpace = false;
    for (const [dx, dy, dz] of DIRECTIONS_26) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (this.inBounds(nx, ny, nz) && this.types[this.index(nx, ny, nz)] === MAT.EMPTY) {
        surroundSpace = true;
        break;
      }
    }
    if ([MAT.FIRE, MAT.PLSM, MAT.LAVA].includes(sourceType)) this.igniteAdjacentThermite(x, y, z);
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY || neighborType === MAT.THRM) return false;
      if ((neighborType === MAT.COAL || neighborType === MAT.BCOL)
        && (sourceType === MAT.FIRE || sourceType === MAT.PLSM)
        && this.life[neighbor] > 100 && this.random() < 1 / 500) {
        this.life[neighbor] = 99;
      }
      if (sourceType === MAT.LAVA && (neighborType === MAT.COAL || neighborType === MAT.BCOL)) {
        if (this.ctype[index] === MAT.IRON && this.random() < 1 / 500) {
          this.ctype[index] = MAT.METL;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          return false;
        }
        if ((this.ctype[index] === MAT.STNE || this.ctype[index] === MAT.EMPTY) && this.random() < 1 / 60) {
          this.ctype[index] = MAT.SLCN;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          return false;
        }
      }
      if (sourceType === MAT.LAVA) {
        if (this.ctype[index] === MAT.QRTZ && neighborType === MAT.LAVA && this.ctype[neighbor] === MAT.CLST) {
          const pressureTemperature = Math.max(this.air.sampleVoxel(x, y, z).pressure * 10, 0);
          if (this.temperatures[index] >= pressureTemperature + materialById(MAT.CRMC).highTemperature + 50) {
            this.ctype[index] = MAT.CRMC;
            this.ctype[neighbor] = MAT.CRMC;
          }
        } else if (neighborType === MAT.O2 && this.ctype[index] === MAT.SLCN) {
          const product = Math.min(2, Math.floor(this.random() * 3));
          this.ctype[index] = product === 0 ? MAT.SAND : product === 1 ? MAT.CLST : MAT.STNE;
          if (product === 1 && this.temperatures[index] >= materialById(MAT.PQRT).highTemperature * 3 + 546.3) this.ctype[index] = MAT.PQRT;
          this.tmp[index] = 0;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          return false;
        } else if (this.ctype[index] === MAT.SLCN && neighborType === MAT.LAVA && [MAT.METL, MAT.BMTL].includes(this.ctype[neighbor])) {
          this.tmp[index] = 0;
          this.ctype[index] = MAT.NSCN;
          this.ctype[neighbor] = MAT.PSCN;
        } else if (this.ctype[index] === MAT.SLCN && neighborType === MAT.LAVA && this.ctype[neighbor] === MAT.SALT) {
          if (this.temperatures[index] > materialById(MAT.LITH).highTemperature && this.random() < 1 / 1000) {
            this.ctype[index] = MAT.LITH;
            this.tmp[index] = 0;
            this.tmp2[index] = 0;
            this.life[index] = 0;
            this.transform(neighbor, MAT.EMPTY, 22, 0);
            return false;
          }
        } else if (neighborType === MAT.HEAC && this.ctype[index] === MAT.HEAC) {
          if (this.temperatures[neighbor] > materialById(MAT.HEAC).highTemperature) {
            this.changeTypePreserve(neighbor, MAT.LAVA);
            this.ctype[neighbor] = MAT.HEAC;
          }
        } else if (this.ctype[index] === MAT.ROCK && neighborType === MAT.LAVA && this.ctype[neighbor] === MAT.GOLD
          && this.tmp[neighbor] === 0 && this.air.sampleVoxel(x, y, z).pressure >= 50 && this.random() < 1 / 10000) {
          this.ctype[index] = MAT.GOLD;
          if (Math.abs(nx - x) > 1 || Math.abs(nz - z) > 1) this.tmp[index] = 1;
        } else if (this.ctype[index] === MAT.SALT && neighborType === MAT.GLAS && this.life[neighbor] < 234 * 120) {
          this.life[neighbor] += 1;
        }
      }
      const flammability = UPSTREAM_FLAMMABILITY.get(neighborType) ?? 0;
      if (!flammability || (!surroundSpace && !materialById(neighborType).explosive)
        || (neighborType === MAT.SPNG && this.life[neighbor] !== 0)) return false;
      const pressure = this.air.sampleVoxel(nx, ny, nz).pressure;
      const ignitionChance = Math.max(0, Math.min(1, Math.trunc(flammability + pressure * 10) / 1000));
      if (this.random() >= ignitionChance) return false;
      this.changeTypePreserve(neighbor, MAT.FIRE);
      this.temperatures[neighbor] = Math.max(-273.15, Math.min(9725.85, 422 + flammability / 2));
      this.life[neighbor] = 180 + Math.floor(this.random() * 80);
      this.tmp[neighbor] = 0;
      this.ctype[neighbor] = 0;
      if (materialById(neighborType).explosive) this.air.injectVoxel(x, y, z, 0.25, 0);
      return false;
    });
  }

  updateLavaState(index, x, y, z) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if (this.ctype[index] === MAT.ROCK) {
      if (pressure <= -9) {
        this.ctype[index] = MAT.STNE;
      } else if (pressure >= 25 && this.random() < 1 / 12500) {
        if (pressure <= 50) this.ctype[index] = this.random() < 0.5 ? MAT.BRMT : MAT.CNCT;
        else if (pressure <= 75) this.ctype[index] = pressure >= 73 || this.random() < 1 / 8 ? MAT.GOLD : MAT.QRTZ;
        else if (pressure <= 100 && this.temperatures[index] >= 4726.85) this.ctype[index] = this.random() < 1 / 5 ? MAT.TTAN : MAT.IRON;
        else if (this.temperatures[index] >= 4726.85 && this.random() < 1 / 5) {
          if (this.random() < 1 / 5) this.ctype[index] = MAT.URAN;
          else if (this.random() < 1 / 5) this.ctype[index] = MAT.PLUT;
          else this.ctype[index] = MAT.TUNG;
        }
      }
    } else if (this.ctype[index] === MAT.GOLD && pressure < -200
      && this.temperatures[index] > materialById(MAT.PTNM).highTemperature && this.random() < 1 / 20000) {
      this.ctype[index] = MAT.PTNM;
      this.air.injectVoxel(x, y, z, 2, 0);
    } else if ((this.ctype[index] === MAT.STNE || this.ctype[index] === MAT.EMPTY) && pressure >= 30
      && (this.temperatures[index] > materialById(MAT.ROCK).highTemperature || pressure < materialById(MAT.ROCK).highPressure)) {
      this.tmp2[index] = Math.min(10, Math.floor(this.random() * 11));
      this.ctype[index] = MAT.ROCK;
    }
  }

  updateFire(index, x, y, z) {
    if (this.life[index] <= 1) {
      if ((this.tmp[index] & 3) === 3) {
        this.changeTypePreserve(index, MAT.WTRV);
        this.life[index] = 0;
        this.ctype[index] = MAT.FIRE;
      } else if (this.temperatures[index] < 351.85) {
        this.changeTypePreserve(index, MAT.SMKE);
        this.life[index] = 250 + Math.floor(this.random() * 20);
      }
    }
    this.updateCombustionInteractions(index, x, y, z, MAT.FIRE);
    if (this.types[index] === MAT.SMKE) {
      this.life[index] = Math.max(0, this.life[index] - 1);
      return true;
    }
    if (this.types[index] !== MAT.FIRE) return true;
    if (this.life[index] > 0) this.life[index] -= 1;
    if (this.life[index] <= 0) {
      this.transform(index, MAT.EMPTY, 22, 0);
      return true;
    }
    this.tryMove(index, x, y, z, this.gravityMoveDirections(x, y, z, true));
    return false;
  }

  updateGas(index, x, y, z, type) {
    if (this.random() < (type === MAT.STEAM ? 0.88 : 0.55)) this.tryMove(index, x, y, z, this.gravityMoveDirections(x, y, z, true));
  }

  updateAcid(index, x, y, z) {
    let consumed = false;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY || neighborType === MAT.ACID || neighborType === MAT.CAUS) return false;
      if ([MAT.PLEX, MAT.NITR, MAT.GUNP, MAT.RBDM, MAT.LRBD].includes(neighborType)) {
        this.changeTypePreserve(index, MAT.FIRE);
        this.changeTypePreserve(neighbor, MAT.FIRE);
        this.life[index] = 4;
        this.life[neighbor] = 4;
        consumed = true;
        return false;
      }
      if (neighborType === MAT.WTRV) {
        if (this.random() < 1 / 250) {
          this.changeTypePreserve(index, MAT.CAUS);
          this.life[index] = 25 + Math.floor(this.random() * 50);
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          consumed = true;
        }
        return false;
      }
      const hardness = materialById(neighborType).upstream.hardness ?? 0;
      const protectedFog = (neighborType === MAT.FOG || neighborType === MAT.RIME) && this.tmp[neighbor] > 5;
      if (neighborType !== MAT.CLNE && neighborType !== MAT.PCLN && !protectedFog
        && this.life[index] > 50 && hardness > 0 && this.random() < hardness / 1000) {
        const midpoint = this.index(Math.round((x + nx) / 2), Math.round((y + ny) / 2), Math.round((z + nz) / 2));
        if (this.types[midpoint] !== MAT.GLAS) {
          this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + Math.max(0, (60 - hardness) * 7));
          this.life[index] -= 1;
          if (neighborType === MAT.LITH) this.changeTypePreserve(neighbor, MAT.H2);
          else this.transform(neighbor, MAT.EMPTY, 22, 0);
          consumed = true;
        }
      } else if (this.life[index] <= 50) {
        this.transform(index, MAT.EMPTY, 22, 0);
        consumed = true;
        return true;
      }
      return false;
    });
    if (this.types[index] !== MAT.ACID) return consumed;
    for (let trade = 0; trade < 2; trade += 1) {
      const nx = x + Math.floor(this.random() * 5) - 2;
      const ny = y + Math.floor(this.random() * 5) - 2;
      const nz = z + Math.floor(this.random() * 5) - 2;
      if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.ACID || this.life[index] <= this.life[neighbor] || this.life[index] <= 0) continue;
      const difference = this.life[index] - this.life[neighbor];
      const transfer = difference === 1 ? 1 : Math.floor(difference / 2);
      this.life[index] -= transfer;
      this.life[neighbor] += transfer;
    }
    return consumed;
  }

  plantDownOffset(x, y, z) {
    const normal = this.gravityVectorAt(x, y, z);
    const newtonian = this.gravity.sampleVoxel(x, y, z);
    const vector = [
      normal[0] + newtonian.forceX,
      normal[1] + newtonian.forceY,
      normal[2] + newtonian.forceZ,
    ];
    const magnitude = Math.hypot(...vector);
    if (magnitude < 0.0001) return null;
    let best = DIRECTIONS_26[0];
    let bestDot = -Infinity;
    for (const direction of DIRECTIONS_26) {
      const directionMagnitude = Math.hypot(...direction);
      const dot = (direction[0] * vector[0] + direction[1] * vector[1] + direction[2] * vector[2]) / directionMagnitude;
      if (dot > bestDot) {
        bestDot = dot;
        best = direction;
      }
    }
    return best;
  }

  plantDirectionOffsets(index, x, y, z, phase = (this.ctype[index] >>> PLANT_PHASE_SHIFT) & 3) {
    const down = this.plantDownOffset(x, y, z) ?? [0, -1, 0];
    const perpendicular = DIRECTIONS_26.filter(([dx, dy, dz]) => dx * down[0] + dy * down[1] + dz * down[2] === 0);
    const genomeHash = (this.tmp[index] ^ Math.imul(this.tmp2[index], 0x45d9f3b)
      ^ Math.imul(this.tmp3[index], 0x119de1f3) ^ Math.imul(this.tmp4[index], 0x3449f)
      ^ Math.imul(phase + 1, 0x9e3779b1)) >>> 0;
    const left = perpendicular[genomeHash % perpendicular.length] ?? [1, 0, 0];
    const up = down.map((component) => -component);
    const combine = (first, second) => first.map((component, axis) => Math.sign(component + second[axis]));
    const right = left.map((component) => -component);
    return [
      up, combine(up, left), left, combine(down, left),
      down, combine(down, right), right, combine(up, right),
    ];
  }

  updateGrowingPlant(index, x, y, z) {
    const temperature = this.temperatures[index];
    if (temperature > 100 || temperature < -50) {
      this.ctype[index] = 0;
      this.tmp[index] = 0;
      this.tmp2[index] = 0;
      this.tmp3[index] = 0;
      this.tmp4[index] = 0;
      return false;
    }
    if (temperature > 70 || temperature < 5 || this.random() < 0.9) return false;

    const phase = (this.ctype[index] >>> PLANT_PHASE_SHIFT) & 3;
    const direction = (this.ctype[index] >>> PLANT_DIRECTION_SHIFT) & 7;
    const water = (this.ctype[index] >>> PLANT_WATER_SHIFT) & 0xff;
    const programs = [this.tmp[index], this.tmp2[index], this.tmp3[index], this.tmp4[index]];
    const program = programs[phase];
    const offsets = this.plantDirectionOffsets(index, x, y, z, phase);
    let stopped = false;

    if (water > 0) {
      if (this.life[index] === 0) {
        const branchMask = program & 0x1f;
        let phases = program >>> 5;
        if (branchMask) {
          for (let phi = 0; phi < 5; phi += 1) {
            if ((branchMask >>> phi) & 1) {
              const nextDirection = (direction + phi + 6) % 8;
              const nextPhase = phases & 3;
              let nextWater = Math.floor(2 * water / 3);
              const downDirection = 4;
              if (nextDirection === downDirection || nextDirection === (downDirection + 1) % 8
                || nextDirection === (downDirection + 7) % 8) nextWater = Math.floor(water / 3);
              if (water > 4 && (nextDirection === (downDirection + 2) % 8
                || nextDirection === (downDirection + 6) % 8)) nextWater = Math.floor(water / 2);
              const [dx, dy, dz] = offsets[nextDirection];
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
                const nextCtype = ((nextWater & 0xff) << PLANT_WATER_SHIFT)
                  | (this.ctype[index] & (0x3f << PLANT_COLOR_SHIFT))
                  | ((nextDirection & 7) << PLANT_DIRECTION_SHIFT)
                  | ((nextPhase & 3) << PLANT_PHASE_SHIFT) | 1;
                const childLife = nextDirection % 2 ? 7 * nextWater : 10 * nextWater;
                this.set(nx, ny, nz, MAT.PLNT, materialById(MAT.PLNT).defaultTemp, childLife, {
                  ctype: nextCtype, tmp: this.tmp[index], tmp2: this.tmp2[index], tmp3: this.tmp3[index], tmp4: this.tmp4[index],
                });
                this.processed[this.index(nx, ny, nz)] = this.epoch;
              }
            }
            phases >>>= 2;
          }
        } else stopped = true;
      } else {
        const [dx, dy, dz] = offsets[direction];
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
          const childCtype = ((water & 0xff) << PLANT_WATER_SHIFT)
            | (this.ctype[index] & (0x3f << PLANT_COLOR_SHIFT))
            | ((direction & 7) << PLANT_DIRECTION_SHIFT)
            | ((phase & 3) << PLANT_PHASE_SHIFT) | 1;
          this.set(nx, ny, nz, MAT.PLNT, materialById(MAT.PLNT).defaultTemp, this.life[index], {
            ctype: childCtype, tmp: this.tmp[index], tmp2: this.tmp2[index], tmp3: this.tmp3[index], tmp4: this.tmp4[index],
          });
          this.processed[this.index(nx, ny, nz)] = this.epoch;
        }
      }

      if (!stopped) {
        if (phase || water < 12) this.transform(index, MAT.WOOD);
        else {
          this.transform(index, MAT.GOO);
          let leftDirection = (direction + 6) % 8;
          let rightDirection = (direction + 2) % 8;
          if (direction % 2) {
            leftDirection = (direction + 5) % 8;
            rightDirection = (direction + 3) % 8;
          }
          for (const sideDirection of [leftDirection, rightDirection]) {
            const [dx, dy, dz] = offsets[sideDirection];
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
              this.set(nx, ny, nz, MAT.WOOD);
              this.processed[this.index(nx, ny, nz)] = this.epoch;
            }
          }
        }
      }
    } else stopped = true;

    if (stopped) {
      if (this.random() < 0.1) {
        const [dx, dy, dz] = offsets[direction];
        const nx = x + 2 * dx;
        const ny = y + 2 * dy;
        const nz = z + 2 * dz;
        if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
          this.set(nx, ny, nz, MAT.SEED, materialById(MAT.SEED).defaultTemp, undefined, {
            ctype: this.ctype[index] & (0x3f << PLANT_COLOR_SHIFT),
            tmp: this.tmp[index], tmp2: this.tmp2[index], tmp3: this.tmp3[index], tmp4: this.tmp4[index],
            velocityX: dx, velocityY: dy, velocityZ: dz,
          });
          this.processed[this.index(nx, ny, nz)] = this.epoch;
        }
      }
      this.ctype[index] = (this.ctype[index] & (0x3f << PLANT_COLOR_SHIFT)) | (7 << PLANT_DIRECTION_SHIFT);
      this.life[index] = 0;
      this.tmp[index] = 0;
      this.tmp2[index] = 0;
      this.tmp3[index] = 0;
      this.tmp4[index] = 0;
    }
    return true;
  }

  updatePlant(index, x, y, z) {
    if (this.ctype[index] & 1) return this.updateGrowingPlant(index, x, y, z);
    const openSpace = DIRECTIONS_26.some(([dx, dy, dz]) => this.get(x + dx, y + dy, z + dz) === MAT.EMPTY);
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.WATR && this.random() < 1 / 50) {
        this.transform(neighbor, MAT.PLNT);
        this.life[neighbor] = 0;
        this.ctype[neighbor] = this.ctype[index];
      } else if (neighborType === MAT.LAVA && this.random() < 1 / 50) {
        this.changeTypePreserve(index, MAT.FIRE);
        this.life[index] = 4;
        return true;
      } else if ((neighborType === MAT.SMKE || neighborType === MAT.CO2) && this.random() < 1 / 50) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        this.life[index] = 60 + Math.floor(this.random() * 60);
      } else if (neighborType === MAT.WOOD && openSpace && this.tmp[index] === 1 && this.random() < 1 / 4) {
        const [dx, dy, dz] = DIRECTIONS_26[Math.floor(this.random() * DIRECTIONS_26.length)];
        const vx = nx + dx;
        const vy = ny + dy;
        const vz = nz + dz;
        if (this.inBounds(vx, vy, vz) && this.get(vx, vy, vz) === MAT.EMPTY) {
          this.set(vx, vy, vz, MAT.VINE, this.temperatures[index]);
          this.processed[this.index(vx, vy, vz)] = this.epoch;
        }
      }
      return false;
    });
    if (this.types[index] !== MAT.PLNT) return true;
    if (this.life[index] === 2) {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY) continue;
        this.set(nx, ny, nz, MAT.O2);
        this.processed[this.index(nx, ny, nz)] = this.epoch;
      }
      this.life[index] = 0;
    }
    if (this.temperatures[index] > 76.85 && this.temperatures[index] > this.tmp2[index]) {
      this.tmp2[index] = Math.floor(this.temperatures[index]);
    }
    return false;
  }

  visitNeighbors(x, y, z, radius, visitor) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (!this.inBounds(nx, ny, nz)) continue;
          const neighbor = this.index(nx, ny, nz);
          if (visitor(neighbor, this.types[neighbor], nx, ny, nz) === true) return true;
        }
      }
    }
    return false;
  }

  updateWaterChemistry(index, x, y, z, type) {
    let sourceKilled = false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (type === MAT.WATR) {
        if (neighborType === MAT.SALT && this.random() < 1 / 50) {
          this.changeTypePreserve(index, MAT.SLTW);
          if (this.random() < 1 / 3) this.changeTypePreserve(neighbor, MAT.SLTW);
        } else if ((neighborType === MAT.RBDM || neighborType === MAT.LRBD)
          && this.temperatures[index] > 12 && this.random() < 1 / 100) {
          this.changeTypePreserve(index, MAT.FIRE);
          this.life[index] = 4;
          this.ctype[index] = MAT.WATR;
        } else if (neighborType === MAT.FIRE && this.ctype[neighbor] !== MAT.WATR) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          if (this.random() < 1 / 30) {
            this.transform(index, MAT.EMPTY, 22, 0);
            sourceKilled = true;
            return true;
          }
        } else if (neighborType === MAT.SLTW && this.random() < 1 / 2000) {
          this.changeTypePreserve(index, MAT.SLTW);
        } else if (neighborType === MAT.ROCK
          && Math.abs(this.velocityX[index]) + Math.abs(this.velocityY[index]) + Math.abs(this.velocityZ[index]) >= 0.5
          && this.random() < 1 / 1000) {
          this.changeTypePreserve(neighbor, this.random() < 1 / 3 ? MAT.SAND : MAT.STNE);
        }
      } else if (type === MAT.DSTW) {
        if (neighborType === MAT.SALT && this.random() < 1 / 50) {
          this.changeTypePreserve(index, MAT.SLTW);
          if (this.random() < 1 / 3) this.changeTypePreserve(neighbor, MAT.SLTW);
        } else if (neighborType === MAT.SLTW) {
          if (this.random() < 1 / 2000) this.changeTypePreserve(index, MAT.SLTW);
          else if (this.random() < 1 / 100) this.changeTypePreserve(index, MAT.WATR);
        } else if (neighborType === MAT.WATR && this.random() < 1 / 100) {
          this.changeTypePreserve(index, MAT.WATR);
        } else if ((neighborType === MAT.RBDM || neighborType === MAT.LRBD)
          && this.temperatures[index] > -261.15 && this.random() < 1 / 100) {
          this.changeTypePreserve(index, MAT.FIRE);
          this.life[index] = 4;
        } else if (neighborType === MAT.FIRE) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          if (this.random() < 1 / 30) {
            this.transform(index, MAT.EMPTY, 22, 0);
            sourceKilled = true;
            return true;
          }
        } else if (neighborType === MAT.SMKE
          && this.temperatures[neighbor] > 40 && this.temperatures[neighbor] < 60
          && this.temperatures[index] > 40 && this.temperatures[index] < 60
          && this.random() < 1 / 100) {
          this.changeTypePreserve(index, MAT.BASE);
          this.life[index] = 1;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        }
      } else if (type === MAT.SLTW) {
        if (neighborType === MAT.SALT && this.random() < 1 / 2000) {
          this.changeTypePreserve(neighbor, MAT.SLTW);
        } else if (neighborType === MAT.PLNT && this.random() < 1 / 40) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        } else if ((neighborType === MAT.RBDM || neighborType === MAT.LRBD)
          && this.temperatures[index] > 12 && this.random() < 1 / 100) {
          this.changeTypePreserve(index, MAT.FIRE);
          this.life[index] = 4;
          this.ctype[index] = MAT.WATR;
        } else if (neighborType === MAT.FIRE && this.ctype[neighbor] !== MAT.WATR) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          if (this.random() < 1 / 30) {
            this.transform(index, MAT.EMPTY, 22, 0);
            sourceKilled = true;
            return true;
          }
        }
      }
      return false;
    });
    return sourceKilled;
  }

  updateBase(index, x, y, z) {
    this.life[index] = Math.max(1, Math.min(100, this.life[index] || 1));
    this.tmp[index] = 0;
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if (this.life[index] < 100 && pressure < 10 && this.temperatures[index] > 120 && this.random() < 0.05) {
      if (this.random() < 1 / (this.life[index] + 1)) {
        this.transform(index, MAT.BOYL, this.temperatures[index]);
        return true;
      }
      this.life[index] += 1;
      this.temperatures[index] -= 20 / this.life[index];
    }
    if (this.temperatures[index] < -this.life[index] / 4) {
      this.transform(index, MAT.ICEI, this.temperatures[index]);
      this.ctype[index] = MAT.BASE;
      return true;
    }
    let reacted = this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      const ignored = [MAT.BASE, MAT.SALT, MAT.SLTW, MAT.BOYL, MAT.MERC, MAT.BMTL, MAT.BRMT, MAT.SOAP, MAT.CLNE, MAT.PCLN].includes(neighborType)
        || ((neighborType === MAT.ICEI || neighborType === MAT.SNOW) && this.ctype[neighbor] === MAT.BASE)
        || (neighborType === MAT.SPRK && (this.ctype[neighbor] === MAT.BMTL || this.ctype[neighbor] === MAT.BRMT));
      if (neighborType === MAT.EMPTY || ignored) return false;
      if (this.life[index] > 1 && [MAT.WATR, MAT.DSTW, MAT.CBNW].includes(neighborType)) {
        if (this.random() < 1 / 20) {
          const concentration = Math.floor(this.life[index] / 2);
          this.transform(neighbor, MAT.BASE, this.temperatures[neighbor], concentration);
          this.temperatures[neighbor] += concentration / 10;
          this.life[index] -= concentration;
        }
      } else if (neighborType === MAT.ACID || neighborType === MAT.CAUS) {
        if (this.life[neighbor] > 50 && this.life[index] > 0) {
          this.life[neighbor] -= 1;
          this.life[index] -= 1;
        }
        if (this.life[neighbor] <= 50) this.transform(neighbor, neighborType === MAT.ACID ? MAT.SLTW : MAT.EMPTY, 22, 0);
        if (this.life[index] <= 0) {
          this.transform(index, MAT.SLTW, 22);
          return true;
        }
      } else if (neighborType === MAT.OIL && this.life[index] >= 70) {
        this.transform(index, MAT.SOAP, this.temperatures[index]);
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        return true;
      } else if (neighborType === MAT.GOO && this.life[index] > 1) {
        this.transform(neighbor, MAT.GEL, this.temperatures[neighbor]);
        this.life[index] -= 1;
      } else if (neighborType === MAT.BCOL && this.life[index] > 1) {
        this.transform(neighbor, MAT.GUNP, this.temperatures[neighbor]);
        this.life[index] -= 1;
      } else if (neighborType === MAT.LAVA && this.ctype[neighbor] === MAT.ROCK && pressure >= 10 && this.random() < 1 / 1000) {
        this.transform(index, MAT.MERC, this.temperatures[index]);
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        return true;
      } else {
        const neighborMaterial = materialById(neighborType);
        const conductiveSolid = neighborMaterial.properties.includes("TYPE_SOLID") && neighborMaterial.properties.includes("PROP_CONDUCTS");
        const hardness = neighborMaterial.upstream.hardness ?? 0;
        if (this.life[index] >= 10 && conductiveSolid && this.random() < 0.1) {
          this.transform(neighbor, MAT.BMTL, this.temperatures[neighbor]);
          this.tmp[neighbor] = 20 + Math.floor(this.random() * 10);
          this.life[index] -= 1;
          this.tmp[index] = 1;
        } else if (hardness > 0 && hardness < 50 && this.life[index] >= 2 * hardness && this.random() < (50 - hardness) / 1000) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          this.life[index] -= 2;
          this.tmp[index] = 1;
        }
      }
      return false;
    });
    if (reacted && this.types[index] !== MAT.BASE) return true;
    for (let trade = 0; trade < 2; trade += 1) {
      const nx = x + Math.floor(this.random() * 3) - 1;
      const ny = y + Math.floor(this.random() * 3) - 1;
      const nz = z + Math.floor(this.random() * 3) - 1;
      if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.BASE || this.life[index] <= this.life[neighbor] || this.life[index] <= 1) continue;
      const difference = this.life[index] - this.life[neighbor];
      const transfer = difference === 1 ? 1 : Math.floor(difference / 2);
      this.life[index] -= transfer;
      this.life[neighbor] += transfer;
      reacted = true;
    }
    return reacted;
  }

  updateVirus(index, x, y, z, type) {
    const nextRandomBits = () => Math.floor(this.random() * 0x100000000) >>> 0;
    let randomBits = nextRandomBits();
    if (this.tmp3[index] > 0) {
      this.tmp3[index] -= randomBits & 1 ? 0 : 1;
      if (this.tmp3[index] === 0) {
        const original = this.tmp2[index];
        if (original === MAT.EMPTY) this.transform(index, MAT.EMPTY, 22, 0);
        else if (original > MAT.EMPTY && materialById(original).id === original && materialById(original).enabled) {
          this.changeTypePreserve(index, original);
        }
        this.tmp2[index] = 0;
        this.tmp3[index] = 0;
        this.tmp4[index] = 0;
      }
      return false;
    }
    if (this.tmp4[index] > 0) {
      if (!(randomBits & 7) && --this.tmp4[index] <= 0) {
        this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      }
      randomBits >>>= 3;
    }

    let surroundSpace = false;
    for (const [dx, dy, dz] of DIRECTIONS_26) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (this.inBounds(nx, ny, nz) && this.types[this.index(nx, ny, nz)] === MAT.EMPTY) {
        surroundSpace = true;
        break;
      }
    }

    for (let direction = 0; direction < DIRECTIONS_26.length; direction += 1) {
      if (direction === DIRECTIONS_26.length / 2) randomBits = nextRandomBits();
      const [dx, dy, dz] = DIRECTIONS_26[direction];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      const neighborType = this.types[neighbor];
      if (neighborType === MAT.EMPTY) continue;

      if (VIRUS_TYPES.has(neighborType) && this.tmp3[neighbor] > 0) {
        this.tmp3[index] = this.tmp3[neighbor] + (randomBits & 3 ? 2 : 1);
        return false;
      }
      if (neighborType === MAT.SOAP) {
        this.tmp3[index] += 10;
        if (!(randomBits & 3)) this.transform(neighbor, MAT.EMPTY, 22, 0);
        return false;
      }
      if (neighborType === MAT.PLSM) {
        const chance = Math.max(0, Math.min(1, (10 + Math.trunc(this.air.sampleVoxel(nx, ny, nz).pressure)) / 100));
        if (surroundSpace && this.random() < chance) {
          this.set(x, y, z, MAT.PLSM);
          return true;
        }
        continue;
      }
      if (!VIRUS_TYPES.has(neighborType) && neighborType !== MAT.DMND && neighborType !== MAT.BASE) {
        if (!(randomBits & 7)) {
          this.tmp2[neighbor] = neighborType;
          this.tmp3[neighbor] = 0;
          this.tmp4[neighbor] = this.tmp4[index] ? this.tmp4[index] + 1 : 0;
          const virusType = this.temperatures[neighbor] < 31.85 ? MAT.VRSS
            : this.temperatures[neighbor] > 399.85 ? MAT.VRSG : MAT.VIRS;
          this.changeTypePreserve(neighbor, virusType);
        }
        randomBits >>>= 3;
      } else if (this.energyTypes[neighbor] === MAT.PROT) {
        this.tmp4[index] = 0;
      }
    }
    return false;
  }

  updateOxygen(index, x, y, z) {
    let reacted = false;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (neighborType === MAT.FIRE) {
        this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + Math.floor(this.random() * 100));
        if (this.tmp[neighbor] & 1) this.temperatures[neighbor] = 3200;
        this.tmp[neighbor] |= 2;
        this.set(x, y, z, MAT.FIRE);
        this.temperatures[index] += Math.floor(this.random() * 100);
        this.tmp[index] |= 2;
        reacted = true;
      } else if (neighborType === MAT.PLSM && !(this.tmp[neighbor] & 4)) {
        this.set(x, y, z, MAT.FIRE);
        this.temperatures[index] += Math.floor(this.random() * 100);
        this.tmp[index] |= 2;
        reacted = true;
      }
      return false;
    });
    if (this.temperatures[index] > 9700 && this.air.sampleVoxel(x, y, z).pressure > 250) {
      const gravity = this.gravity.sampleVoxel(x, y, z);
      if (gravity.forceX ** 2 + gravity.forceY ** 2 + gravity.forceZ ** 2 > 400 && this.random() < 1 / 5) {
        this.set(x, y, z, MAT.BRMT);
        this.createEnergyNearby(x, y, z, MAT.NEUT, { temperature: 9725.85 });
        this.createEnergyNearby(x, y, z, MAT.PHOT, { temperature: 9725.85, tmp: 1 });
        const nx = x + Math.floor(this.random() * 3) - 1;
        const ny = y + Math.floor(this.random() * 3) - 1;
        const nz = z + Math.floor(this.random() * 3) - 1;
        if (this.inBounds(nx, ny, nz)) {
          const target = this.index(nx, ny, nz);
          if (this.types[target] === MAT.EMPTY || this.types[target] === MAT.O2 || this.canDisplace(MAT.PLSM, this.types[target])) {
            this.set(nx, ny, nz, MAT.PLSM, 9725.85, undefined, { tmp: 4 });
            this.processed[target] = this.epoch;
          }
        }
        this.createEnergyNearby(x, y, z, MAT.GRVT, { temperature: 9725.85 });
        this.temperatures[index] = 9725.85;
        this.air.pressure[this.air.indexForVoxel(x, y, z)] = 256;
        reacted = true;
      }
    }
    return reacted;
  }

  updateHydrogen(index, x, y, z) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    const reacted = this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (pressure > 8 && neighborType === MAT.DESL) {
        this.changeTypePreserve(neighbor, MAT.WATR);
        this.changeTypePreserve(index, MAT.OIL);
        return true;
      }
      if (pressure > 45) return false;
      if (neighborType === MAT.FIRE) {
        this.temperatures[neighbor] = this.tmp[neighbor] & 2 ? 3200 : 2200;
        this.tmp[neighbor] |= 1;
        this.set(x, y, z, MAT.FIRE);
        this.temperatures[index] += Math.floor(this.random() * 100);
        this.tmp[index] |= 1;
        return true;
      }
      if ((neighborType === MAT.PLSM && !(this.tmp[neighbor] & 4))
        || (neighborType === MAT.LAVA && this.ctype[neighbor] !== MAT.BMTL)) {
        this.set(x, y, z, MAT.FIRE);
        this.temperatures[index] += Math.floor(this.random() * 100);
        this.tmp[index] |= 1;
        return true;
      }
      return false;
    });
    if (reacted) return true;
    if (this.temperatures[index] > 2000 && pressure > 50 && this.random() < 0.2) {
      const fusionTemp = this.temperatures[index];
      this.set(x, y, z, MAT.NBLE);
      this.tmp[index] = 1;
      this.createEnergyNearby(x, y, z, MAT.NEUT, { temperature: fusionTemp });
      if (this.random() < 0.1) this.createEnergyNearby(x, y, z, MAT.ELEC, { temperature: fusionTemp });
      this.createEnergyNearby(x, y, z, MAT.PHOT, { temperature: fusionTemp, ctype: 0x7c0000, tmp: 1 });
      const nx = x + Math.floor(this.random() * 3) - 1;
      const ny = y + Math.floor(this.random() * 3) - 1;
      const nz = z + Math.floor(this.random() * 3) - 1;
      if (this.inBounds(nx, ny, nz)) {
        const target = this.index(nx, ny, nz);
        if (this.types[target] === MAT.EMPTY || this.types[target] === MAT.H2 || this.canDisplace(MAT.PLSM, this.types[target])) {
          this.set(nx, ny, nz, MAT.PLSM, fusionTemp, undefined, { tmp: 4 });
          this.processed[target] = this.epoch;
        }
      }
      this.temperatures[index] = Math.min(9725.85, fusionTemp + 750 + Math.floor(this.random() * 500));
      this.air.injectVoxel(x, y, z, 30, 0);
      return true;
    }
    return false;
  }

  updateCarbonatedWater(index, x, y, z) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if (pressure <= 3 && (pressure <= -0.5 || this.random() < 1 / 4000)) {
      this.changeTypePreserve(index, MAT.CO2);
      this.ctype[index] = 5;
      this.air.injectVoxel(x, y, z, 0.5, 0);
    }
    if (this.tmp2[index] !== 20) this.tmp2[index] += this.tmp2[index] > 20 ? -1 : 1;
    else if (this.random() < 1 / 200) this.tmp2[index] = Math.floor(this.random() * 40);
    if (this.tmp[index] > 0) {
      if (this.tmp[index] === 1 && this.random() < 3 / 4) {
        this.changeTypePreserve(index, MAT.CO2);
        this.ctype[index] = 5;
        this.air.injectVoxel(x, y, z, 0.2, 0);
      }
      this.tmp[index] -= 1;
    }

    let sourceKilled = false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      const properties = materialById(neighborType).properties;
      if (properties.includes("TYPE_PART") && this.tmp[index] === 0 && this.random() < 1 / 83) {
        this.tmp[index] = Math.floor(this.random() * 25);
      } else if (properties.includes("TYPE_SOLID") && neighborType !== MAT.DMND && neighborType !== MAT.GLAS
        && this.tmp[index] === 0 && this.random() < Math.max(0, Math.trunc(2 - pressure)) / 6667) {
        this.changeTypePreserve(index, MAT.CO2);
        this.ctype[index] = 5;
        this.air.injectVoxel(x, y, z, 0.2, 0);
      }
      if (neighborType === MAT.CBNW) {
        if (this.tmp[index] === 0 && this.tmp[neighbor] !== 0) {
          this.tmp[index] = this.tmp[neighbor];
          if (neighbor > index) this.tmp[index] -= 1;
        } else if (this.tmp[index] !== 0 && this.tmp[neighbor] === 0) {
          this.tmp[neighbor] = this.tmp[index];
          if (neighbor > index) this.tmp[neighbor] += 1;
        }
      } else if ((neighborType === MAT.RBDM || neighborType === MAT.LRBD)
        && this.temperatures[index] > 12 && this.random() < 1 / 166) {
        this.changeTypePreserve(index, MAT.FIRE);
        this.life[index] = 4;
        this.ctype[index] = MAT.WATR;
      } else if (neighborType === MAT.FIRE && this.ctype[neighbor] !== MAT.WATR) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        if (this.random() < 1 / 50) {
          this.transform(index, MAT.EMPTY, 22, 0);
          sourceKilled = true;
          return true;
        }
      }
      return false;
    });
    return sourceKilled;
  }

  fireworkGravityAt(x, y, z, type) {
    const elementGravity = materialById(type).upstream?.gravity ?? 0;
    const [baseX, baseY, baseZ] = this.gravityVectorAt(x, y, z);
    const field = this.gravity.sampleVoxel(x, y, z);
    let gx = baseX * elementGravity + field.forceX;
    let gy = baseY * elementGravity + field.forceY;
    let gz = baseZ * elementGravity + field.forceZ;
    let magnitude = Math.hypot(gx, gy, gz);
    if (magnitude < 0.001) {
      const azimuth = this.random() * Math.PI * 2;
      const vertical = this.random() * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const fallback = Math.max(0.0001, elementGravity * 0.5);
      gx += Math.cos(azimuth) * radial * fallback;
      gy += vertical * fallback;
      gz += Math.sin(azimuth) * radial * fallback;
      magnitude = Math.hypot(gx, gy, gz);
    }
    return [gx / magnitude, gy / magnitude, gz / magnitude];
  }

  createEmberBurst(index, x, y, z, type) {
    const color = type === MAT.FIRW
      ? fireworkGradient(Math.floor(this.random() * 200))
      : ((11 + Math.floor(this.random() * 245)) << 16)
        | ((11 + Math.floor(this.random() * 245)) << 8)
        | (11 + Math.floor(this.random() * 245));
    const candidates = [];
    for (let dz = -2; dz <= 2; dz += 1) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      if ((!dx && !dy && !dz) || !this.inBounds(x + dx, y + dy, z + dz) || this.get(x + dx, y + dy, z + dz) !== MAT.EMPTY) continue;
      candidates.push([x + dx, y + dy, z + dz]);
    }
    for (let n = candidates.length - 1; n > 0; n -= 1) {
      const swap = Math.floor(this.random() * (n + 1));
      [candidates[n], candidates[swap]] = [candidates[swap], candidates[n]];
    }
    let created = 0;
    for (const [nx, ny, nz] of candidates.slice(0, 40)) {
      const magnitude = (40 + Math.floor(this.random() * 60)) * 0.05;
      const azimuth = this.random() * Math.PI * 2;
      const vertical = this.random() * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      this.set(nx, ny, nz, MAT.EMBR, 5476.85 + Math.floor(this.random() * 500), 70 + Math.floor(this.random() * 40), {
        ctype: color, tmp: 1,
        velocityX: this.velocityX[index] * 0.5 + Math.cos(azimuth) * radial * magnitude,
        velocityY: this.velocityY[index] * 0.5 + vertical * magnitude,
        velocityZ: this.velocityZ[index] * 0.5 + Math.sin(azimuth) * radial * magnitude,
        decoration: this.decorations[index],
      });
      this.processed[this.index(nx, ny, nz)] = this.epoch;
      created += 1;
    }
    this.air.injectVoxel(x, y, z, 8, 0);
    this.activity.explosions += 1;
    this.transform(index, MAT.EMPTY, 22, 0);
    return created;
  }

  updateFirework(index, x, y, z, type) {
    if (type === MAT.FIRW) {
      if (this.tmp[index] <= 0) {
        let ignited = false;
        this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
          if ([MAT.FIRE, MAT.PLSM, MAT.THDR].includes(neighborType)) ignited = true;
          return ignited;
        });
        if (ignited) {
          this.tmp[index] = 1;
          this.life[index] = 20 + Math.floor(this.random() * 10);
          const gravity = this.fireworkGravityAt(x, y, z, type);
          const speed = (this.life[index] + 20) * 0.2;
          this.velocityX[index] -= gravity[0] * speed;
          this.velocityY[index] -= gravity[1] * speed;
          this.velocityZ[index] -= gravity[2] * speed;
        }
      } else if (this.tmp[index] === 1 && this.life[index] <= 0) this.tmp[index] = 2;
      else if (this.tmp[index] >= 2) {
        this.createEmberBurst(index, x, y, z, type);
        return true;
      }
      return false;
    }

    let exposed = false;
    this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY) exposed = true;
      return exposed;
    });
    if (this.life[index] === 0 && (this.ctype[index] === MAT.DUST || (exposed && this.temperatures[index] > 126.85 && this.random() < (9 + (this.temperatures[index] + 273.15) / 40) / 100000))) {
      const gravity = this.fireworkGravityAt(x, y, z, type);
      const maximum = Math.max(Math.abs(gravity[0]), Math.abs(gravity[1]), Math.abs(gravity[2]));
      const target = [x - Math.round(gravity[0] / maximum), y - Math.round(gravity[1] / maximum), z - Math.round(gravity[2] / maximum)];
      if (this.inBounds(...target) && this.wallAllows(type, ...target) && this.canDisplace(type, this.get(...target))) {
        const parallel = (Math.floor(this.random() * 201) - 100) * 0.002;
        const azimuth = this.random() * Math.PI * 2;
        const reference = Math.abs(gravity[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let px = gravity[1] * reference[2] - gravity[2] * reference[1];
        let py = gravity[2] * reference[0] - gravity[0] * reference[2];
        let pz = gravity[0] * reference[1] - gravity[1] * reference[0];
        const perpendicularLength = Math.hypot(px, py, pz);
        px /= perpendicularLength; py /= perpendicularLength; pz /= perpendicularLength;
        const qx = gravity[1] * pz - gravity[2] * py;
        const qy = gravity[2] * px - gravity[0] * pz;
        const qz = gravity[0] * py - gravity[1] * px;
        const sideways = (Math.floor(this.random() * 201) - 100) * 0.005;
        const sx = px * Math.cos(azimuth) + qx * Math.sin(azimuth);
        const sy = py * Math.cos(azimuth) + qy * Math.sin(azimuth);
        const sz = pz * Math.cos(azimuth) + qz * Math.sin(azimuth);
        this.life[index] = 18 + Math.floor(this.random() * 10);
        this.ctype[index] = 0;
        this.velocityX[index] -= (gravity[0] * (1 + parallel) + sx * sideways) * 15;
        this.velocityY[index] -= (gravity[1] * (1 + parallel) + sy * sideways) * 15;
        this.velocityZ[index] -= (gravity[2] * (1 + parallel) + sz * sideways) * 15;
      }
    } else if (this.life[index] > 0 && this.life[index] < 3) {
      this.createEmberBurst(index, x, y, z, type);
      return true;
    } else if (this.life[index] >= 45) this.life[index] = 0;
    return false;
  }

  updateShield(index, x, y, z, type) {
    const growAroundSpark = (sparkX, sparkY, sparkZ, life) => {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = sparkX + dx;
        const ny = sparkY + dy;
        const nz = sparkZ + dz;
        if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY) continue;
        this.set(nx, ny, nz, MAT.SHLD1, materialById(MAT.SHLD1).defaultTemp, life);
        this.processed[this.index(nx, ny, nz)] = this.epoch;
      }
    };

    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (type === MAT.SHLD1) {
        if (neighborType === MAT.SPRK && this.life[index] === 0) {
          if (this.random() < 11 / 40) {
            this.changeTypePreserve(index, MAT.SHLD2);
            this.life[index] = 7;
          }
          growAroundSpark(nx, ny, nz);
        } else if (neighborType === MAT.SHLD3 && this.random() < 2 / 5) {
          this.changeTypePreserve(index, MAT.SHLD2);
          this.life[index] = 7;
        }
      } else if (type === MAT.SHLD2) {
        if (neighborType === MAT.EMPTY) {
          if (this.life[index] > 0) {
            this.set(nx, ny, nz, MAT.SHLD1);
            this.processed[neighbor] = this.epoch;
          }
        } else if (neighborType === MAT.SPRK && this.life[index] === 0) {
          if (this.random() < 1 / 8) {
            this.changeTypePreserve(index, MAT.SHLD3);
            this.life[index] = 7;
          }
          growAroundSpark(nx, ny, nz, 7);
        } else if (neighborType === MAT.SHLD4 && this.random() < 2 / 5) {
          this.changeTypePreserve(index, MAT.SHLD3);
          this.life[index] = 7;
        }
      } else if (type === MAT.SHLD3) {
        if (neighborType === MAT.EMPTY) {
          if (this.random() < 1 / 2500) {
            this.set(nx, ny, nz, MAT.SHLD1, materialById(MAT.SHLD1).defaultTemp, 7);
            this.processed[neighbor] = this.epoch;
            this.changeTypePreserve(index, MAT.SHLD2);
          }
        } else if (neighborType === MAT.SHLD1 && this.life[index] > 3) {
          this.changeTypePreserve(neighbor, MAT.SHLD2);
          this.life[neighbor] = 7;
        } else if (neighborType === MAT.SPRK && this.life[index] === 0) {
          if (this.random() < 3 / 500) {
            this.changeTypePreserve(index, MAT.SHLD4);
            this.life[index] = 7;
          }
          growAroundSpark(nx, ny, nz, 7);
        }
      } else if (type === MAT.SHLD4) {
        if (neighborType === MAT.EMPTY) {
          if (this.random() < 1 / 5500) {
            this.set(nx, ny, nz, MAT.SHLD1, materialById(MAT.SHLD1).defaultTemp, 7);
            this.processed[neighbor] = this.epoch;
            this.changeTypePreserve(index, MAT.SHLD2);
          }
        } else if (neighborType === MAT.SHLD2 && this.life[index] > 3) {
          this.changeTypePreserve(neighbor, MAT.SHLD3);
          this.life[neighbor] = 7;
        } else if (neighborType === MAT.SPRK && this.life[index] === 0) {
          growAroundSpark(nx, ny, nz, 7);
        }
      }
      return false;
    });
    return false;
  }

  updateFogRime(index, x, y, z, type) {
    if (type === MAT.RIME) {
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType === MAT.EMPTY) return false;
        if (neighborType === MAT.SPRK) {
          this.changeTypePreserve(index, MAT.FOG);
          this.life[index] = 60 + Math.floor(this.random() * 60);
        } else if (neighborType === MAT.GAS && this.tmp[index] < 10) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          if (this.ctype[index] === MAT.DSTW) this.ctype[index] = 0;
          else this.tmp[index] += 1;
        } else if (neighborType === MAT.FOG && this.life[neighbor] > 0) {
          this.changeTypePreserve(index, MAT.FOG);
          this.life[index] = this.life[neighbor];
        }
        return false;
      });
      return false;
    }
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY) return false;
      if (materialById(neighborType).properties.includes("TYPE_SOLID")
        && ![MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.PBCN].includes(neighborType)
        && this.life[index] === 0 && this.random() < 0.1) {
        this.changeTypePreserve(index, MAT.RIME);
      }
      if (neighborType === MAT.SPRK) this.life[index] += Math.floor(this.random() * 20);
      if (neighborType === MAT.GAS && this.tmp[index] < 10) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        if (this.ctype[index] === MAT.DSTW) this.ctype[index] = 0;
        else this.tmp[index] += 1;
      }
      return false;
    });
    return false;
  }

  updateGel(index, x, y, z) {
    this.tmp[index] = Math.max(0, Math.min(100, this.tmp[index]));
    const denominator = this.tmp[index] * 10 + 500;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY) return false;
      if ([MAT.WATR, MAT.DSTW, MAT.FRZW].includes(neighborType) && this.tmp[index] < 100 && this.random() < 500 / denominator) {
        this.tmp[index] += 1;
        this.transform(neighbor, MAT.EMPTY, 22, 0);
      } else if (neighborType === MAT.PSTE && this.tmp[index] < 100 && this.random() < 20 / denominator) {
        this.tmp[index] += 1;
        this.set(nx, ny, nz, MAT.CLST);
      } else if (neighborType === MAT.SLTW && this.tmp[index] < 100 && this.random() < 50 / denominator) {
        this.tmp[index] += 1;
        if (this.random() < 0.75) this.transform(neighbor, MAT.EMPTY, 22, 0);
        else this.changeTypePreserve(neighbor, MAT.SALT);
      } else if (neighborType === MAT.CBNW && this.tmp[index] < 100 && this.random() < 100 / denominator) {
        this.tmp[index] += 1;
        this.changeTypePreserve(neighbor, MAT.CO2);
      } else if (neighborType === MAT.GEL && this.tmp[index] > this.tmp[neighbor] + 1) {
        this.tmp[index] -= 1;
        this.tmp[neighbor] += 1;
      } else if (neighborType === MAT.SPNG) {
        if (this.life[neighbor] > 0 && this.tmp[index] < this.life[neighbor] + 1) {
          this.life[neighbor] -= 1;
          this.tmp[index] += 1;
        } else if (this.tmp[index] > this.life[neighbor] + 1) {
          this.tmp[index] -= 1;
          this.life[neighbor] += 1;
        }
      } else if (neighborType === MAT.BASE && this.tmp[index] > 0 && this.life[neighbor] > 1) {
        this.life[neighbor] -= 1;
        this.tmp[index] -= 1;
      }

      const distanceX = x - nx;
      const distanceY = y - ny;
      const distanceZ = z - nz;
      const distanceSquared = distanceX ** 2 + distanceY ** 2 + distanceZ ** 2;
      const neighborMaterial = materialById(neighborType);
      const closeRange = Math.abs(nx - x) < 2 && Math.abs(ny - y) < 2 && Math.abs(nz - z) < 2;
      if (distanceSquared > 1.5 && (neighborType === MAT.GEL || !neighborMaterial.upstream.falldown || closeRange)) {
        const adjustedDistance = distanceSquared - 0.5;
        let force = 5 * (1 - this.tmp[index] / 100)
          * (adjustedDistance / (distanceSquared + adjustedDistance) - 0.5);
        if (neighborMaterial.properties.includes("TYPE_LIQUID")) force *= 0.1;
        const forceX = distanceX * force;
        const forceY = distanceY * force;
        const forceZ = distanceZ * force;
        this.velocityX[index] += forceX;
        this.velocityY[index] += forceY;
        this.velocityZ[index] += forceZ;
        if (neighborMaterial.properties.includes("TYPE_PART") || neighborType === MAT.GOO) {
          this.velocityX[neighbor] -= forceX;
          this.velocityY[neighbor] -= forceY;
          this.velocityZ[neighbor] -= forceZ;
        }
      }
      return false;
    });
    return false;
  }

  updateGlow(index, x, y, z) {
    const reacted = this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType === MAT.WATR && this.random() < 1 / 400) {
        this.transform(index, MAT.EMPTY, 22, 0);
        this.changeTypePreserve(neighbor, MAT.DEUT);
        this.life[neighbor] = 10;
        return true;
      }
      if (neighborType === MAT.GEL) {
        this.transform(index, MAT.EMPTY, 22, 0);
        this.changeTypePreserve(neighbor, MAT.RSST);
        this.tmp[neighbor] = 0;
        return true;
      }
      return false;
    });
    if (reacted) return true;
    const field = this.air.sampleVoxel(x, y, z);
    this.ctype[index] = Math.max(0, Math.trunc(field.pressure * 16));
    this.tmp[index] = Math.abs(Math.trunc((field.velocityX + field.velocityY + field.velocityZ) * 16))
      + Math.abs(Math.trunc((this.velocityX[index] + this.velocityY[index] + this.velocityZ[index]) * 64));
    return false;
  }

  updateBizarre(index, x, y, z) {
    const source = this.decorations[index] >>> 0;
    if (!source) return false;
    const blend = (target, desired) => Math.max(0, Math.min(255, target + Math.sign(desired - target) + Math.round((desired - target) / 21)));
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY || [MAT.BIZR, MAT.BIZRG, MAT.BIZRS].includes(neighborType)) return false;
      const target = this.decorations[neighbor] >>> 0;
      const alpha = blend((target >>> 24) & 0xff, (source >>> 24) & 0xff);
      const red = blend((target >>> 16) & 0xff, (source >>> 16) & 0xff);
      const green = blend((target >>> 8) & 0xff, (source >>> 8) & 0xff);
      const blue = blend(target & 0xff, source & 0xff);
      this.decorations[neighbor] = ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
      return false;
    });
    return false;
  }

  updateInvisible(index, x, y, z) {
    const resistance = this.tmp[index] > 0 ? this.tmp[index] : 4;
    this.tmp2[index] = Math.abs(this.air.sampleVoxel(x, y, z).pressure) > resistance ? 1 : 0;
    return false;
  }

  updateLithium(index, x, y, z) {
    this.ctype[index] = Math.max(0, this.ctype[index]);
    let charged = false;
    let discharged = false;
    const reacted = this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY) {
        if (this.life[index] > 1012 && this.random() < 0.1) this.set(...this.coords(neighbor), MAT.FIRE);
        return false;
      }
      if ([MAT.SLTW, MAT.WTRV, MAT.WATR, MAT.DSTW, MAT.CBNW].includes(neighborType)) {
        if (this.life[index] > 1016) {
          this.changeTypePreserve(neighbor, MAT.WTRV);
          this.temperatures[neighbor] = 166.85;
        } else if (this.tmp[index] + this.tmp2[index] < 10) {
          if (this.temperatures[index] > 166.85) {
            this.life[index] = 1024 + Math.min(96, this.ctype[index] * 4);
            this.tmp[index] = 10;
          } else {
            this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + 20.365 + this.ctype[index] ** 2 * 1.5);
            this.tmp[index] += 1;
          }
          this.changeTypePreserve(neighbor, MAT.H2);
        }
      } else if (neighborType === MAT.CO2 && this.tmp[index] + this.tmp2[index] < 10) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        this.tmp2[index] += 1;
      } else if (neighborType === MAT.SPRK) {
        if (!this.insulationBetween(index, neighbor) && this.tmp[index] + this.tmp2[index] < 5
          && this.ctype[neighbor] === MAT.PSCN && this.life[neighbor] === 3 && !charged && this.life[index] === 0) charged = true;
      } else if (neighborType === MAT.NSCN) {
        if (!this.insulationBetween(index, neighbor) && this.life[neighbor] === 0 && this.ctype[index] > 0 && this.life[index] === 0) {
          this.spark(neighbor, MAT.NSCN, 4);
          discharged = true;
        }
      } else if (neighborType === MAT.FIRE && this.temperatures[index] > 166.85 && this.random() < 1 / 40 && this.tmp[index] < 6) {
        this.life[index] = 1013;
        this.tmp[index] += 1;
      } else if (neighborType === MAT.O2 && this.life[index] > 1000 && this.random() < 0.1) {
        this.changeTypePreserve(index, MAT.PLSM);
        this.changeTypePreserve(neighbor, MAT.PLSM);
        this.air.injectVoxel(x, y, z, 4, 0);
        return true;
      }
      return false;
    });
    if (reacted && this.types[index] !== MAT.LITH) return true;
    if (charged) {
      this.ctype[index] += 1;
      this.life[index] = 8;
    }
    if (discharged) {
      this.ctype[index] = Math.max(0, this.ctype[index] - 1);
      this.life[index] = 8;
    }
    for (let trade = 0; trade < 9; trade += 1) {
      const nx = x + Math.floor(this.random() * 7) - 3;
      const ny = y + Math.floor(this.random() * 7) - 3;
      const nz = z + Math.floor(this.random() * 7) - 3;
      if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.LITH) continue;
      if (this.life[index] < 1000 && this.ctype[index] > 90 && this.life[neighbor] > 1000) this.life[index] = 1024;
      if (this.ctype[index] > this.ctype[neighbor]) {
        const transfer = Math.ceil((this.ctype[index] - this.ctype[neighbor]) / 2);
        this.ctype[neighbor] += transfer;
        this.ctype[index] -= transfer;
        break;
      }
    }
    if (this.life[index] < 1000 && this.ctype[index] >= 100) this.life[index] = 1024;
    if (this.life[index] === 1000) {
      const storedEnergy = this.ctype[index];
      const glass = this.tmp2[index] >= 3;
      this.life[index] = 0;
      this.changeTypePreserve(index, MAT.LAVA);
      this.temperatures[index] = Math.min(9725.85, (glass ? 1726.85 : 226.85) + storedEnergy * 10);
      this.ctype[index] = glass ? MAT.GLAS : MAT.LITH;
      return true;
    }
    return false;
  }

  updateSponge(index, x, y, z) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    const canAbsorb = this.life[index] < 50 && Math.abs(pressure) <= 3 && this.temperatures[index] <= 100.85;
    if (canAbsorb) {
      const denominator = this.life[index] * 200 + 500;
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
        if ([MAT.WATR, MAT.DSTW, MAT.FRZW].includes(neighborType)
          && this.life[index] < 50 && this.random() < 500 / denominator) {
          this.life[index] += 1;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        } else if (neighborType === MAT.SLTW && this.life[index] < 50 && this.random() < 50 / denominator) {
          this.life[index] += 1;
          if (this.random() < 0.75) this.transform(neighbor, MAT.EMPTY, 22, 0);
          else this.changeTypePreserve(neighbor, MAT.SALT);
        } else if (neighborType === MAT.CBNW && this.life[index] < 50 && this.random() < 100 / denominator) {
          this.life[index] += 1;
          this.changeTypePreserve(neighbor, MAT.CO2);
        } else if (neighborType === MAT.PSTE && this.life[index] < 50 && this.random() < 20 / denominator) {
          this.life[index] += 1;
          this.set(nx, ny, nz, MAT.CLST);
        }
        return false;
      });
    } else {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        if (this.life[index] < 1) break;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY) continue;
        this.set(nx, ny, nz, MAT.WATR);
        this.life[index] -= 1;
      }
    }

    for (let trade = 0; trade < 9; trade += 1) {
      const nx = x + Math.floor(this.random() * 5) - 2;
      const ny = y + Math.floor(this.random() * 5) - 2;
      const nz = z + Math.floor(this.random() * 5) - 2;
      if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.SPNG || this.life[index] <= this.life[neighbor] || this.life[index] <= 0) continue;
      const difference = this.life[index] - this.life[neighbor];
      const transfer = difference === 1 ? 1 : Math.trunc(difference / 2);
      this.life[neighbor] += transfer;
      this.life[index] -= transfer;
      break;
    }

    let nearbyFire = 0;
    if (this.life[index] > 0) {
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType !== MAT.FIRE) return false;
        nearbyFire += 1;
        if (this.life[neighbor] > 60) this.life[neighbor] -= Math.trunc(this.life[neighbor] / 60);
        else if (this.life[neighbor] > 2) this.life[neighbor] -= 1;
        return false;
      });
    }
    if (nearbyFire && this.life[index] > 3) this.life[index] -= Math.trunc(this.life[index] / 3);
    if (nearbyFire > 1) nearbyFire = Math.trunc(nearbyFire / 2);
    if (nearbyFire || this.temperatures[index] >= 100.85) {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        if (this.life[index] < 1) break;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY) continue;
        this.set(nx, ny, nz, MAT.WTRV);
        const vapor = this.index(nx, ny, nz);
        this.temperatures[vapor] = this.temperatures[index];
        nearbyFire -= 1;
        this.life[index] -= 1;
        this.temperatures[index] -= 20;
      }
    }
    if (nearbyFire > 0) this.life[index] = Math.max(0, this.life[index] - nearbyFire);
    return false;
  }

  updateMercury(index, x, y, z) {
    this.temperatures[index] = Math.max(-273.15, Math.min(9725.85, this.temperatures[index]));
    const temperatureKelvin = this.temperatures[index] + 273.15;
    let maximum = Math.trunc(10000 / (temperatureKelvin + 1)) - 1;
    const integerTemperature = Math.max(1, Math.trunc(temperatureKelvin) + 1);
    if (this.random() < (10000 % integerTemperature) / integerTemperature) maximum += 1;
    this.tmp[index] = Math.max(0, Math.min(10000, this.tmp[index]));
    if (this.tmp[index] < maximum) {
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (this.tmp[index] >= maximum) return false;
        if (neighborType === MAT.MERC && this.random() < 1 / 3
          && this.tmp[index] + this.tmp[neighbor] + 1 <= maximum) {
          this.tmp[index] += this.tmp[neighbor] + 1;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        }
        return false;
      });
    } else if (this.tmp[index] > maximum) {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        if (this.tmp[index] <= maximum) break;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY) continue;
        this.set(nx, ny, nz, MAT.MERC, this.temperatures[index], 0, { tmp: 0, decoration: this.decorations[index] });
        this.tmp[index] -= 1;
      }
    }
    for (let trade = 0; trade < 4; trade += 1) {
      const nx = x + Math.floor(this.random() * 5) - 2;
      const ny = y + Math.floor(this.random() * 5) - 2;
      const nz = z + Math.floor(this.random() * 5) - 2;
      if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.MERC || this.tmp[index] <= this.tmp[neighbor] || this.tmp[index] <= 0) continue;
      const difference = this.tmp[index] - this.tmp[neighbor];
      const transfer = difference === 1 ? 1 : Math.trunc(difference / 2);
      this.tmp[neighbor] += transfer;
      this.tmp[index] -= transfer;
    }
    return false;
  }

  breedSeeds(first, second) {
    const firstCtype = this.ctype[first];
    const secondCtype = this.ctype[second];
    const firstOld = [this.tmp[first], this.tmp2[first], this.tmp3[first], this.tmp4[first]];
    const secondOld = [this.tmp[second], this.tmp2[second], this.tmp3[second], this.tmp4[second]];
    const firstNew = [...firstOld];
    const secondNew = [...secondOld];
    this.ctype[first] = 1;
    this.ctype[second] = 1;

    for (let gene = 0; gene < 3; gene += 1) {
      const shift = 2 * gene + PLANT_COLOR_SHIFT;
      for (const child of [first, second]) {
        const firstAllele = (firstCtype >>> (shift + (this.random() < 0.5 ? 0 : 1))) & 1;
        const secondAllele = (secondCtype >>> (shift + (this.random() < 0.5 ? 0 : 1))) & 1;
        this.ctype[child] |= firstAllele << shift;
        this.ctype[child] |= secondAllele << (shift + 1);
      }
    }

    for (let bit = 0; bit < 5; bit += 1) {
      for (let field = 0; field < 4; field += 1) {
        firstNew[field] |= (this.random() < 0.5 ? firstOld[field] : secondOld[field]) & (1 << bit);
        secondNew[field] |= (this.random() < 0.5 ? firstOld[field] : secondOld[field]) & (1 << bit);
      }
    }
    for (let bit = 5; bit < PLANT_GENOME_BITS; bit += 2) {
      for (let field = 0; field < 4; field += 1) {
        firstNew[field] |= (this.random() < 0.5 ? firstOld[field] : secondOld[field]) & (3 << bit);
        secondNew[field] |= (this.random() < 0.5 ? firstOld[field] : secondOld[field]) & (3 << bit);
      }
    }
    [this.tmp[first], this.tmp2[first], this.tmp3[first], this.tmp4[first]] = firstNew;
    [this.tmp[second], this.tmp2[second], this.tmp3[second], this.tmp4[second]] = secondNew;
  }

  updateSeed(index, x, y, z) {
    const temperature = this.temperatures[index];
    if (temperature > 46.85 && this.air.sampleVoxel(x, y, z).pressure > 50 && this.random() < 1 / 150) {
      this.transform(index, MAT.MWAX);
      return true;
    }
    let water = (this.ctype[index] >>> PLANT_WATER_SHIFT) & 0xff;
    if (temperature > 70 || temperature < 5) {
      water = 0;
      this.life[index] = 0;
      this.ctype[index] &= ~(0xff << PLANT_WATER_SHIFT);
      return false;
    }

    if (water > 3) {
      const offsets = this.plantDirectionOffsets(index, x, y, z, 0);
      const down = offsets[4];
      const up = offsets[0];
      const ground = this.get(x + down[0], y + down[1], z + down[2]);
      const above = this.get(x + up[0], y + up[1], z + up[2]);
      if ((ground === MAT.SAND || ground === MAT.SPNG) && above === MAT.EMPTY) {
        if (this.life[index] > 200) {
          this.changeTypePreserve(index, MAT.PLNT);
          this.ctype[index] &= ~((7 << PLANT_DIRECTION_SHIFT) | (3 << PLANT_PHASE_SHIFT));
          this.ctype[index] |= 1;
          this.life[index] = 15 * water;
          return true;
        }
        this.life[index] += 1;
      } else this.life[index] = 0;
    }

    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType === MAT.WATR && water < 31) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        water += 1;
        this.life[index] = 0;
      } else if (neighborType === MAT.DEUT && water < 255) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        water += 1;
        this.life[index] = 0;
      } else if ((neighborType === MAT.CBNW || neighborType === MAT.DSTW) && water < 3) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        water += 1;
        this.life[index] = 0;
      } else if (neighborType === MAT.SLTW && water > 0) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        water -= 1;
        this.life[index] = 0;
      } else if (neighborType === MAT.SPNG && water < 15 && this.life[neighbor] > 0) {
        this.life[neighbor] -= 1;
        water += 1;
        this.life[index] = 0;
      } else if (neighborType === MAT.SEED && water > 0 && !(this.ctype[index] & 1)
        && !(this.ctype[neighbor] & 1) && this.random() < 0.1) {
        this.breedSeeds(index, neighbor);
      }
      return false;
    });
    this.ctype[index] = (this.ctype[index] & ~(0xff << PLANT_WATER_SHIFT)) | ((water & 0xff) << PLANT_WATER_SHIFT);
    return false;
  }

  updateVine(index, x, y, z) {
    const dx = Math.floor(this.random() * 3) - 1;
    const dy = Math.floor(this.random() * 3) - 1;
    const dz = Math.floor(this.random() * 3) - 1;
    if (dx || dy || dz) {
      if (this.random() < 1 / 15) {
        this.changeTypePreserve(index, MAT.PLNT);
        return true;
      }
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
        this.set(nx, ny, nz, MAT.VINE, this.temperatures[index]);
        this.processed[this.index(nx, ny, nz)] = this.epoch;
        this.changeTypePreserve(index, MAT.PLNT);
        return true;
      }
    }
    if (this.temperatures[index] > 76.85 && this.temperatures[index] > this.tmp2[index]) this.tmp2[index] = Math.floor(this.temperatures[index]);
    return false;
  }

  updateGoo(index, x, y, z) {
    const flow = this.air.sampleVoxel(x, y, z);
    if (this.life[index] === 0 && flow.pressure > 1) this.life[index] = 300 + Math.floor(this.random() * 80);
    if (this.life[index] > 0) {
      this.velocityX[index] += flow.velocityX * 0.1;
      this.velocityY[index] += flow.velocityY * 0.1;
      this.velocityZ[index] += flow.velocityZ * 0.1;
      this.tryMove(index, x, y, z, []);
    }
    return false;
  }

  updateBreakableMetal(index, x, y, z, type) {
    if (type === MAT.BMTL) {
      if (this.tmp[index] > 1) {
        this.tmp[index] -= 1;
        this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
          if ((neighborType === MAT.METL || neighborType === MAT.IRON) && this.random() < 1 / 100) {
            this.changeTypePreserve(neighbor, MAT.BMTL);
            if (this.tmp[index] <= 7) {
              this.tmp[index] = 1;
              this.tmp[neighbor] = 1;
            } else {
              this.tmp[neighbor] = this.tmp[index] - Math.floor(this.random() * 5);
            }
          }
          return false;
        });
      } else if (this.tmp[index] === 1 && this.random() < 1 / 1000) {
        this.tmp[index] = 0;
        this.changeTypePreserve(index, MAT.BRMT);
        return true;
      }
      return false;
    }

    if (this.temperatures[index] <= 250) return false;
    const denominator = Math.max(2, Math.trunc(1000 + (this.temperatures[index] - 250) * 2));
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType !== MAT.BREC || this.random() >= 1 / denominator) return false;
      if (this.random() < 0.5) this.set(nx, ny, nz, MAT.THRM);
      else this.set(x, y, z, MAT.THRM);
      return false;
    });
    return false;
  }

  createMatterNearby(x, y, z, type, temperature, life, properties = {}) {
    const offset = Math.floor(this.random() * DIRECTIONS_26.length);
    for (let step = 0; step < DIRECTIONS_26.length; step += 1) {
      const [dx, dy, dz] = DIRECTIONS_26[(offset + step) % DIRECTIONS_26.length];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const target = this.index(nx, ny, nz);
      if (this.types[target] !== MAT.EMPTY || !this.wallAllows(type, nx, ny, nz)) continue;
      this.set(nx, ny, nz, type, temperature, life, properties);
      this.processed[target] = this.epoch;
      return target;
    }
    return -1;
  }

  updateCoal(index, x, y, z, type) {
    if (this.life[index] <= 0) {
      this.set(x, y, z, MAT.FIRE);
      return true;
    }
    if (this.life[index] < 100) {
      this.life[index] -= 1;
      const fireX = x + Math.floor(this.random() * 3) - 1;
      const fireY = y + Math.floor(this.random() * 3) - 1;
      const fireZ = z + Math.floor(this.random() * 3) - 1;
      if (this.inBounds(fireX, fireY, fireZ) && this.get(fireX, fireY, fireZ) === MAT.EMPTY
        && this.wallAllows(MAT.FIRE, fireX, fireY, fireZ)) {
        this.set(fireX, fireY, fireZ, MAT.FIRE);
        this.processed[this.index(fireX, fireY, fireZ)] = this.epoch;
      }
    }
    if (type === MAT.COAL) {
      const pressure = this.air.sampleVoxel(x, y, z).pressure;
      if (pressure > 4.3 && this.tmp[index] > 40) this.tmp[index] = 39;
      else if (this.tmp[index] > 0 && this.tmp[index] < 40) this.tmp[index] -= 1;
      else if (this.tmp[index] <= 0) {
        this.changeTypePreserve(index, MAT.BCOL);
        return true;
      }
    }
    if (this.temperatures[index] > this.tmp2[index]) this.tmp2[index] = Math.trunc(this.temperatures[index]);
    return false;
  }

  updateIron(index, x, y, z) {
    if (this.life[index] !== 0) return false;
    const rustChance = new Map([
      [MAT.SALT, 1 / 47], [MAT.SLTW, 1 / 67], [MAT.WATR, 1 / 1200], [MAT.O2, 1 / 250], [MAT.LO2, 1],
    ]);
    const rusted = this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
      const chance = rustChance.get(neighborType);
      return chance !== undefined && this.random() < chance;
    });
    if (!rusted) return false;
    this.changeTypePreserve(index, MAT.BMTL);
    this.tmp[index] = 20 + Math.floor(this.random() * 10);
    return true;
  }

  updateQuartz(index, x, y, z, type) {
    if (type === MAT.QRTZ) {
      const pressure = Math.trunc(this.air.sampleVoxel(x, y, z).pressure * 64);
      const tolerance = Math.max(0, this.temperatures[index] + 273.15) * 1.0666;
      if (Math.abs(pressure - this.tmp3[index]) > tolerance) {
        this.changeTypePreserve(index, MAT.PQRT);
        this.life[index] = 5;
      }
      this.tmp3[index] = pressure;
    }
    if (this.life[index] > 5) this.life[index] = 5;
    if (this.tmp[index] !== -1) {
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType === MAT.SLTW && this.random() < 1 / 500) {
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          this.tmp[index] += 1;
        }
        return false;
      });
    }
    const speedSq = this.velocityX[index] ** 2 + this.velocityY[index] ** 2 + this.velocityZ[index] ** 2;
    if (this.tmp[index] <= 0 || speedSq >= 0.2 || this.life[index] > 0) return false;
    let grew = false;
    for (let trade = 0; trade < 9; trade += 1) {
      const growDirection = DIRECTIONS_26[Math.floor(this.random() * DIRECTIONS_26.length)];
      if (!grew) {
        const [dx, dy, dz] = growDirection;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
          this.set(nx, ny, nz, MAT.QRTZ, this.temperatures[index], undefined, { tmp2: this.tmp2[index] });
          const grown = this.index(nx, ny, nz);
          if (this.random() < 0.5) this.tmp2[grown] = Math.max(0, Math.min(10, this.tmp2[grown] + Math.floor(this.random() * 3) - 1));
          this.tmp[index] -= 1;
          if (type === MAT.PQRT) this.changeTypePreserve(index, MAT.QRTZ);
          if (this.random() < 0.5) this.tmp[grown] = -1;
          else if (this.tmp[index] === 0 && this.random() < 1 / 15) this.tmp[index] = -1;
          this.processed[grown] = this.epoch;
          grew = true;
        }
      }
      const diffuseDirection = DIRECTIONS_26[Math.floor(this.random() * DIRECTIONS_26.length)];
      const distance = this.random() < 0.5 ? 1 : 2;
      const nx = x + diffuseDirection[0] * distance;
      const ny = y + diffuseDirection[1] * distance;
      const nz = z + diffuseDirection[2] * distance;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.QRTZ || this.tmp[neighbor] < 0 || this.tmp[index] <= this.tmp[neighbor]) continue;
      const difference = this.tmp[index] - this.tmp[neighbor];
      const transfer = difference === 1 ? 1 : Math.floor(difference / 2);
      this.tmp[neighbor] += transfer;
      this.tmp[index] -= transfer;
      break;
    }
    return false;
  }

  updateGold(index, x, y, z) {
    for (let sample = 0; sample < 8; sample += 1) {
      let packed = Math.floor(this.random() * 0x100000000) >>> 0;
      const dx = (packed % 9) - 4;
      packed >>>= 4;
      const dy = (packed % 9) - 4;
      packed >>>= 4;
      const dz = (packed % 9) - 4;
      if (Number(dx !== 0) + Number(dy !== 0) + Number(dz !== 0) !== 1) continue;
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] === MAT.BMTL && this.tmp[neighbor] !== 0) {
        this.tmp[neighbor] = 0;
        this.changeTypePreserve(neighbor, MAT.IRON);
      }
    }
    if (this.life[index] !== 0) return false;
    for (const [dx, dy, dz] of DIRECTIONS_6) {
      const nx = x + dx * 4;
      const ny = y + dy * 4;
      const nz = z + dz * 4;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] === MAT.SPRK && this.life[neighbor] > 0 && this.life[neighbor] < 4) {
        this.spark(index, MAT.GOLD, 4);
        return true;
      }
    }
    return false;
  }

  updateTungsten(index, x, y, z) {
    const meltingPoint = 3421.85;
    let oxygenIgnition = false;
    if (this.temperatures[index] > 2126.85) {
      this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
        if (neighborType === MAT.O2) oxygenIgnition = true;
        return oxygenIgnition;
      });
    }
    if ((this.temperatures[index] > meltingPoint && this.random() < 1 / 20) || oxygenIgnition) {
      if (this.random() < 1 / 50) {
        this.air.injectVoxel(x, y, z, 50);
        if (oxygenIgnition) this.temperatures[index] = Math.min(9725.85, meltingPoint + 200 + Math.floor(this.random() * 600));
        this.velocityX[index] += Math.floor(this.random() * 101) - 50;
        this.velocityY[index] += Math.floor(this.random() * 101) - 50;
        this.velocityZ[index] += Math.floor(this.random() * 101) - 50;
        return true;
      }
      if (this.random() < 1 / 100) {
        this.changeTypePreserve(index, MAT.FIRE);
        this.life[index] = Math.floor(this.random() * 500);
        return true;
      }
      this.changeTypePreserve(index, MAT.LAVA);
      this.ctype[index] = MAT.TUNG;
      return true;
    }
    const pressure = Math.trunc(this.air.sampleVoxel(x, y, z).pressure * 64);
    if (Math.abs(pressure - this.tmp3[index]) > 32) {
      this.changeTypePreserve(index, MAT.BRMT);
      this.ctype[index] = MAT.TUNG;
      return true;
    }
    this.tmp3[index] = pressure;
    return false;
  }

  updateCeramic(index, x, y, z) {
    if (this.air.sampleVoxel(x, y, z).pressure >= -30) return false;
    const temperature = this.temperatures[index];
    this.set(x, y, z, MAT.CLST);
    this.temperatures[index] = temperature;
    return true;
  }

  heatInsulatorAt(index, energy = false) {
    const type = energy ? this.energyTypes[index] : this.types[index];
    if (type === MAT.EMPTY) return false;
    const conductivity = materialById(type).conductivity ?? 0;
    const life = energy ? this.energyLife[index] : this.life[index];
    const tmp = energy ? this.energyTmp[index] : this.tmp[index];
    return conductivity <= 0
      || (type === MAT.HSWC && life !== 10)
      || ((type === MAT.PIPE || type === MAT.PPIP) && (tmp & 1) === 0);
  }

  clearHeatLine(x, y, z, tx, ty, tz) {
    const steps = Math.max(Math.abs(tx - x), Math.abs(ty - y), Math.abs(tz - z));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const nx = Math.round(x + (tx - x) * ratio);
      const ny = Math.round(y + (ty - y) * ratio);
      const nz = Math.round(z + (tz - z) * ratio);
      if (!this.inBounds(nx, ny, nz)) return false;
      const point = this.index(nx, ny, nz);
      if (this.types[point] !== MAT.EMPTY && this.heatInsulatorAt(point)) return false;
    }
    return true;
  }

  updateHeatConductor(index, x, y, z) {
    const matter = [];
    const energy = [];
    let heat = 0;
    let capacity = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx * 4;
          const ny = y + dy * 4;
          const nz = z + dz * 4;
          if (!this.inBounds(nx, ny, nz) || !this.clearHeatLine(x, y, z, nx, ny, nz)) continue;
          const target = this.index(nx, ny, nz);
          if (this.types[target] !== MAT.EMPTY && !this.heatInsulatorAt(target)) {
            const targetMaterial = materialById(this.types[target]);
            let weight = targetMaterial.heatCapacity ?? 1;
            if ((this.types[target] === MAT.PIPE || this.types[target] === MAT.PPIP)
              && this.ctype[target] > MAT.EMPTY && materialById(this.ctype[target]).id === this.ctype[target]
              && materialById(this.ctype[target]).enabled) {
              weight += materialById(this.ctype[target]).heatCapacity ?? 1;
            }
            heat += this.temperatures[target] * weight;
            capacity += weight;
            matter.push(target);
          }
          if (this.energyTypes[target] !== MAT.EMPTY && !this.heatInsulatorAt(target, true)) {
            const weight = materialById(this.energyTypes[target]).heatCapacity ?? 1;
            heat += this.energyTemperatures[target] * weight;
            capacity += weight;
            energy.push(target);
          }
        }
      }
    }
    if (capacity <= 0) return false;
    const equilibrium = Math.max(-273.15, Math.min(9725.85, heat / capacity));
    this.temperatures[index] = equilibrium;
    for (const target of matter) this.temperatures[target] = equilibrium;
    for (const target of energy) this.energyTemperatures[target] = equilibrium;
    return false;
  }

  updateBrokenElectronics(index, x, y, z) {
    if (this.life[index] === 0) return false;
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if (pressure <= 10) return false;
    if (this.temperatures[index] > 8726.85 && pressure > 30 && this.random() < 1 / 200) {
      this.changeTypePreserve(index, MAT.EXOT);
      this.life[index] = 1000;
    }
    this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + pressure / 8);
    return this.types[index] === MAT.EXOT;
  }

  updateClay(index, x, y, z) {
    let reacted = false;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.WATR && this.random() < 1 / 1500) {
        this.set(x, y, z, MAT.PSTS);
        this.set(nx, ny, nz, MAT.EMPTY);
        reacted = true;
        return false;
      }
      if (neighborType === MAT.NITR) {
        this.set(x, y, z, MAT.BANG);
        this.set(nx, ny, nz, MAT.BANG);
        reacted = true;
        return false;
      }
      if (neighborType === MAT.CLST) {
        const temperature = this.temperatures[index];
        const cohesion = temperature < -78.15 ? 0.05 : temperature < 21.85 ? 0.015 : temperature < 76.85 ? 0.01 : 0.005;
        this.velocityX[index] += cohesion * (nx - x);
        this.velocityY[index] += cohesion * (ny - y);
        this.velocityZ[index] += cohesion * (nz - z);
      }
      return false;
    });
    return reacted;
  }

  updateSilicon(index, x, y, z) {
    if (this.tmp[index] === 0) this.tmp[index] = 0x100000 + Math.floor(this.random() * 0x900000);
    const increment = (this.tmp[index] >>> 20) & 0xfff;
    const phase = (this.tmp[index] & 0xfff) + increment;
    if (phase & 0x1000) {
      const next = Math.floor(this.random() * 16);
      this.tmp[index] = (this.tmp[index] & 0xfff00000) | (phase & 0xfff) | (next << 16) | ((this.tmp[index] >>> 4) & 0xf000);
    } else {
      this.tmp[index] = (this.tmp[index] & 0xfffff000) | phase;
    }
    if (this.life[index] !== 0 || this.temperatures[index] >= 100) return false;
    for (const [dx, dy, dz] of DIRECTIONS_6) {
      const nx = x + dx * 4;
      const ny = y + dy * 4;
      const nz = z + dz * 4;
      if (!this.inBounds(nx, ny, nz)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] === MAT.SPRK && this.life[neighbor] > 0 && this.life[neighbor] < 4) {
        this.spark(index, MAT.SLCN, 4);
        return true;
      }
    }
    return false;
  }

  updatePlatinum(index, x, y, z) {
    let sparked = false;
    if (this.life[index] === 0) {
      for (const [dx, dy, dz] of DIRECTIONS_6) {
        const nx = x + dx * 4;
        const ny = y + dy * 4;
        const nz = z + dz * 4;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (this.types[neighbor] === MAT.SPRK && this.life[neighbor] > 0 && this.life[neighbor] < 4) {
          this.spark(index, MAT.PTNM, 4);
          sparked = true;
          break;
        }
      }
    }

    let hydrogen = -1;
    let steam = -1;
    const probability = Math.min(1, Math.max(0, (this.temperatures[index] + 273.15) / 1773.15)) ** 2;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.H2 && hydrogen < 0) hydrogen = neighbor;
      if (neighborType === MAT.WTRV && steam < 0) steam = neighbor;
      if ([MAT.SHLD1, MAT.SHLD2, MAT.SHLD3].includes(neighborType) && this.life[neighbor] === 0) {
        this.changeTypePreserve(neighbor, neighborType === MAT.SHLD1 ? MAT.SHLD2 : neighborType === MAT.SHLD2 ? MAT.SHLD3 : MAT.SHLD4);
        this.life[neighbor] = 7;
      } else if (neighborType === MAT.ISZS || neighborType === MAT.ISOZ) {
        this.changeTypePreserve(neighbor, MAT.PLUT);
        this.createEnergyNearby(nx, ny, nz, MAT.PHOT);
      } else if (this.random() <= probability) {
        const pressure = this.air.sampleVoxel(nx, ny, nz).pressure;
        if (neighborType === MAT.GAS && this.temperatures[neighbor] >= 200 && pressure > 2) {
          this.changeTypePreserve(neighbor, MAT.INSL);
          this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + 60);
        } else if (neighborType === MAT.BREC && this.temperatures[neighbor] > 1000 && pressure > 50) {
          this.changeTypePreserve(neighbor, MAT.EXOT);
          this.temperatures[neighbor] -= 30;
          this.temperatures[index] -= 30;
        } else if (neighborType === MAT.SMKE) this.changeTypePreserve(neighbor, MAT.CO2);
        else if (neighborType === MAT.RSST) this.set(nx, ny, nz, MAT.BIZR);
      }
      return false;
    });

    if (hydrogen >= 0 && this.types[hydrogen] === MAT.H2) {
      const [hx, hy, hz] = this.coords(hydrogen);
      let completed = false;
      this.visitNeighbors(hx, hy, hz, 1, (neighbor, neighborType, nx, ny, nz) => {
        if (neighbor === index || completed) return false;
        if (neighborType === MAT.DESL) {
          this.changeTypePreserve(neighbor, MAT.WATR);
          this.changeTypePreserve(hydrogen, MAT.OIL);
          completed = true;
        } else if (neighborType === MAT.O2 && this.life[index] === 0) {
          this.changeTypePreserve(neighbor, MAT.DSTW);
          this.changeTypePreserve(hydrogen, MAT.DSTW);
          this.temperatures[neighbor] += 5;
          this.temperatures[hydrogen] += 5;
          this.spark(index, MAT.PTNM, 4);
          completed = true;
        } else if (neighborType === MAT.H2 && this.random() < 1 / 1000
          && this.temperatures[neighbor] > 500 && this.temperatures[hydrogen] > 500) {
          this.changeTypePreserve(neighbor, MAT.NBLE);
          this.temperatures[neighbor] += 1000;
          const neutronTemp = this.temperatures[hydrogen] + 1000;
          this.transform(hydrogen, MAT.EMPTY, 22, 0);
          this.setEnergy(hx, hy, hz, MAT.NEUT, neutronTemp);
          this.air.injectVoxel(nx, ny, nz, 10);
          this.createEnergyNearby(nx, ny, nz, MAT.PHOT, { temperature: this.temperatures[neighbor], ctype: 0x7c0000, tmp: 1 });
          if (this.random() < 0.1) this.createEnergyNearby(nx, ny, nz, MAT.ELEC, { temperature: this.temperatures[neighbor] });
          completed = true;
        }
        return completed;
      });
    }

    if (steam >= 0 && this.types[steam] === MAT.WTRV) {
      const [sx, sy, sz] = this.coords(steam);
      this.visitNeighbors(sx, sy, sz, 1, (neighbor, neighborType, nx, ny, nz) => {
        if (neighborType !== MAT.BCOL || this.temperatures[neighbor] <= 200 || this.temperatures[steam] <= 200
          || this.air.sampleVoxel(nx, ny, nz).pressure <= 7) return false;
        this.changeTypePreserve(neighbor, MAT.OIL);
        this.transform(steam, MAT.EMPTY, 22, 0);
        return true;
      });
    }
    return sparked || this.types[index] === MAT.SPRK;
  }

  updateSnow(index, x, y, z) {
    if (this.ctype[index] === MAT.FRZW) this.temperatures[index] = Math.max(-273.15, this.temperatures[index] - 1);
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if ((neighborType !== MAT.SALT && neighborType !== MAT.SLTW) || this.random() >= 1 / 333) return false;
      this.changeTypePreserve(index, MAT.SLTW);
      this.changeTypePreserve(neighbor, MAT.SLTW);
      return false;
    });
    return false;
  }

  updatePlasma(index, x, y, z) {
    if (this.life[index] <= 1) {
      if (this.ctype[index] === MAT.NBLE) {
        this.changeTypePreserve(index, MAT.NBLE);
        this.life[index] = 0;
      } else if ((this.tmp[index] & 3) === 3) {
        this.changeTypePreserve(index, MAT.WTRV);
        this.life[index] = 0;
        this.ctype[index] = MAT.FIRE;
      }
    }
    this.updateCombustionInteractions(index, x, y, z, MAT.PLSM);
    if (this.types[index] !== MAT.PLSM) return true;
    if (this.life[index] > 0) this.life[index] -= 1;
    if (this.life[index] <= 0) {
      this.transform(index, MAT.EMPTY, 22, 0);
      return true;
    }
    return false;
  }

  updateNobleGas(index, x, y, z) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if (this.temperatures[index] <= 5000 || pressure <= 100) return false;
    this.tmp[index] |= 1;
    if (this.random() >= 1 / 5) return false;
    const temperature = this.temperatures[index];
    this.set(x, y, z, MAT.CO2);
    this.createEnergyNearby(x, y, z, MAT.NEUT, { temperature });
    if (this.random() < 1 / 25) this.createEnergyNearby(x, y, z, MAT.ELEC, { temperature });
    this.createEnergyNearby(x, y, z, MAT.PHOT, { temperature, ctype: 0x0f800000, tmp: 1 });
    const plasmaX = x + Math.floor(this.random() * 3) - 1;
    const plasmaY = y + Math.floor(this.random() * 3) - 1;
    const plasmaZ = z + Math.floor(this.random() * 3) - 1;
    if (this.inBounds(plasmaX, plasmaY, plasmaZ)) {
      const plasmaIndex = this.index(plasmaX, plasmaY, plasmaZ);
      const targetType = this.types[plasmaIndex];
      if ((targetType === MAT.EMPTY || targetType === MAT.NBLE || this.canDisplace(MAT.PLSM, targetType))
        && this.wallAllows(MAT.PLSM, plasmaX, plasmaY, plasmaZ)) {
        this.set(plasmaX, plasmaY, plasmaZ, MAT.PLSM, temperature, undefined, { tmp: 4 });
        this.processed[plasmaIndex] = this.epoch;
      }
    }
    this.temperatures[index] = Math.min(9725.85, temperature + 1750 + Math.floor(this.random() * 500));
    this.air.injectVoxel(x, y, z, 50);
    return true;
  }

  updateYeast(index, x, y, z) {
    this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
      if (neighborType === MAT.DYST && this.random() < 1 / 6) {
        this.changeTypePreserve(index, MAT.DYST);
      }
      return false;
    });
    if (this.temperatures[index] > 29.85 && this.temperatures[index] < 43.85) {
      const yeastX = x + Math.floor(this.random() * 3) - 1;
      const yeastY = y + Math.floor(this.random() * 3) - 1;
      const yeastZ = z + Math.floor(this.random() * 3) - 1;
      if (this.inBounds(yeastX, yeastY, yeastZ) && this.get(yeastX, yeastY, yeastZ) === MAT.EMPTY
        && this.wallAllows(MAT.YEST, yeastX, yeastY, yeastZ)) {
        this.set(yeastX, yeastY, yeastZ, MAT.YEST);
        this.processed[this.index(yeastX, yeastY, yeastZ)] = this.epoch;
      }
    }
    return false;
  }

  igniteAdjacentThermite(x, y, z) {
    let ignited = 0;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType !== MAT.THRM) return false;
      const brokenMetal = this.random() < 1 / 500;
      this.changeTypePreserve(neighbor, MAT.LAVA);
      this.temperatures[neighbor] = 3226.85;
      if (brokenMetal) {
        this.ctype[neighbor] = MAT.BMTL;
        this.air.injectVoxel(nx, ny, nz, 50, 0);
      } else {
        this.life[neighbor] = 400;
        this.ctype[neighbor] = MAT.THRM;
        this.tmp[neighbor] = 20;
      }
      ignited += 1;
      return false;
    });
    return ignited;
  }

  updateMort(index, x, y, z) {
    if (this.inBounds(x, y - 1, z) && this.get(x, y - 1, z) === MAT.EMPTY) {
      this.set(x, y - 1, z, MAT.SMKE);
    }
    return false;
  }

  updateCarbonDioxide(index, x, y, z) {
    const reacted = this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY) {
        if (this.ctype[index] === 5 && this.random() < 1 / 2000) {
          this.set(nx, ny, nz, MAT.WATR);
          this.ctype[index] = 0;
        }
        return false;
      }
      if (neighborType === MAT.FIRE) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        if (this.random() < 1 / 30) {
          this.transform(index, MAT.EMPTY, 22, 0);
          return true;
        }
      } else if ((neighborType === MAT.WATR || neighborType === MAT.DSTW) && this.random() < 1 / 50) {
        this.changeTypePreserve(neighbor, MAT.CBNW);
        if (this.ctype[index] === 5) this.set(x, y, z, MAT.WATR);
        else this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      }
      return false;
    });
    if (reacted || this.types[index] !== MAT.CO2) return true;
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    if (this.temperatures[index] > 9500 && pressure > 200 && this.random() < 1 / 5) {
      this.set(x, y, z, MAT.O2);
      this.createEnergyNearby(x, y, z, MAT.NEUT, { temperature: 9725.85 });
      if (this.random() < 1 / 50) this.createEnergyNearby(x, y, z, MAT.ELEC, { temperature: 9725.85 });
      this.temperatures[index] = 9725.85;
      this.air.injectVoxel(x, y, z, 100);
      return true;
    }
    return false;
  }

  glassBetween(x, y, z, tx, ty, tz) {
    const steps = Math.max(Math.abs(tx - x), Math.abs(ty - y), Math.abs(tz - z));
    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      const nx = Math.round(x + (tx - x) * ratio);
      const ny = Math.round(y + (ty - y) * ratio);
      const nz = Math.round(z + (tz - z) * ratio);
      if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.GLAS) return true;
    }
    return false;
  }

  updateCausticGas(index, x, y, z) {
    let converted = false;
    const destroyed = this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY) return false;
      if (neighborType === MAT.GAS) {
        if (this.air.sampleVoxel(nx, ny, nz).pressure > 3) {
          this.changeTypePreserve(neighbor, MAT.RFRG);
          this.changeTypePreserve(index, MAT.RFRG);
          converted = true;
        }
        return false;
      }
      if ([MAT.ACID, MAT.CAUS, MAT.RFRG, MAT.RFGL].includes(neighborType)) return false;
      const hardness = materialById(neighborType).upstream?.hardness ?? 0;
      const protectedTarget = neighborType === MAT.CLNE || neighborType === MAT.PCLN
        || ((neighborType === MAT.FOG || neighborType === MAT.RIME) && this.tmp[neighbor] > 5);
      const corrodes = !protectedTarget && this.random() < hardness / 1000;
      if (corrodes && this.life[index] > 50 && !this.glassBetween(x, y, z, nx, ny, nz)) {
        this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + Math.max(0, (60 - hardness) * 7));
        this.life[index] -= 1;
        this.transform(neighbor, MAT.EMPTY, 22, 0);
      } else if (this.life[index] <= 50) {
        this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      }
      return false;
    });
    return converted || destroyed;
  }

  updateFreezeMatter(index, x, y, z, type) {
    if (type === MAT.FRZZ) {
      return this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType !== MAT.WATR || this.random() >= 1 / 20) return false;
        this.changeTypePreserve(neighbor, MAT.FRZW);
        this.life[neighbor] = 100;
        this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      });
    }
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType === MAT.WATR && this.random() < 1 / 14) this.changeTypePreserve(neighbor, MAT.FRZW);
      return false;
    });
    let freezes = this.life[index] === 0 && this.random() < 1 / 192;
    if (!freezes) freezes = this.random() < Math.max(0, 100 - this.life[index]) / 50000;
    if (!freezes) return false;
    this.changeTypePreserve(index, MAT.ICEI);
    this.ctype[index] = MAT.FRZW;
    this.temperatures[index] = Math.max(-273.15, this.temperatures[index] - 200);
    return true;
  }

  updateGravityDust(index) {
    const speedSq = this.velocityX[index] ** 2 + this.velocityY[index] ** 2 + this.velocityZ[index] ** 2;
    if (speedSq >= 0.1 && this.life[index] === 0 && this.random() < 1 / 512) this.life[index] = 48;
    return false;
  }

  updateAntiAir(index, x, y, z) {
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType !== MAT.CFLM || this.random() >= 1 / 4) return false;
      this.changeTypePreserve(index, MAT.CFLM);
      this.life[index] = 50 + Math.floor(this.random() * 150);
      this.temperatures[index] = 0;
      this.temperatures[neighbor] = 0;
      this.air.injectVoxel(x, y, z, -0.5);
      return false;
    });
    return false;
  }

  updateBoyleGas(index, x, y, z) {
    const limit = (this.temperatures[index] + 273.15) / 100;
    const [cx, cy, cz] = this.air.cellForVoxel(x, y, z);
    // Preserve the original vertical-column pressure floor and mirror its
    // horizontal relaxation stencil through the added depth axis.
    for (const [dx, dy, dz, raiseOnly] of [
      [0, 0, 0, true], [0, 1, 0, true], [0, -1, 0, true],
      [1, 0, 0, false], [1, 1, 0, false], [-1, 0, 0, false], [-1, -1, 0, false],
      [0, 0, 1, false], [0, 1, 1, false], [0, 0, -1, false], [0, -1, -1, false],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (!this.air.inBounds(nx, ny, nz)) continue;
      const airIndex = this.air.index(nx, ny, nz);
      const pressure = this.air.pressure[airIndex];
      if (raiseOnly && pressure >= limit) continue;
      this.air.pressure[airIndex] = Math.max(-256, Math.min(256, pressure + 0.001 * (limit - pressure)));
    }
    return this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType === MAT.WATR && this.random() < 1 / 30) this.changeTypePreserve(neighbor, MAT.FOG);
      else if (neighborType === MAT.O2 && this.random() < 1 / 9) {
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        this.changeTypePreserve(index, MAT.WATR);
        this.air.injectVoxel(x, y, z, 4);
        return true;
      }
      return false;
    });
  }

  updateRefrigerant(index, x, y, z) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    const oldPressure = bitsToFloat(this.tmp[index]);
    if (Number.isNaN(oldPressure)) {
      this.tmp[index] = floatToBits(pressure);
      return false;
    }
    const absoluteTemperature = this.temperatures[index] + 273.15;
    const pressureRatio = (pressure + 257) / (oldPressure + 257);
    this.temperatures[index] = Math.max(-273.15, Math.min(9725.85, absoluteTemperature * pressureRatio - 273.15));
    this.tmp[index] = floatToBits(pressure);
    return false;
  }

  updateResist(index, x, y, z, type) {
    if (type === MAT.RSST) {
      const reacted = this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType === MAT.GUNP) {
          this.set(x, y, z, MAT.FIRW);
          this.set(...this.coords(neighbor), MAT.EMPTY);
          return true;
        }
        if (neighborType === MAT.BCOL) {
          this.set(x, y, z, MAT.FSEP);
          this.life[index] = 50;
          this.set(...this.coords(neighbor), MAT.EMPTY);
          return true;
        }
        if ((neighborType === MAT.CLNE || neighborType === MAT.PCLN) && this.ctype[neighbor] !== MAT.RSST) this.ctype[index] = this.ctype[neighbor];
        if ((neighborType === MAT.BCLN || neighborType === MAT.PBCN) && this.ctype[neighbor] !== MAT.RSST) this.tmp[index] = this.ctype[neighbor];
        return false;
      });
      return reacted;
    }
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if ((neighborType === MAT.CLNE || neighborType === MAT.PCLN) && this.ctype[neighbor] !== MAT.RSSS) this.ctype[index] = this.ctype[neighbor];
      if ((neighborType === MAT.BCLN || neighborType === MAT.PBCN) && this.ctype[neighbor] !== MAT.RSSS) this.tmp[index] = this.ctype[neighbor];
      return false;
    });
    this.air.blocked[this.air.indexForVoxel(x, y, z)] = 1;
    return false;
  }

  setActorCommand(player, command, active) {
    if ((player !== 0 && player !== 1) || !Number.isInteger(command)) return false;
    if (active) this.actorCommands[player] |= command;
    else this.actorCommands[player] &= ~command;
    return true;
  }

  actorIndex(type) {
    return this.types.indexOf(type);
  }

  respawnActors() {
    for (let player = 0; player < 2; player += 1) {
      const type = player === 0 ? MAT.STKM : MAT.STKM2;
      const spawn = this.actorSpawns[player];
      if (!spawn || this.actorPortalLocks[player] || this.actorIndex(type) >= 0) continue;
      const [x, y, z] = spawn;
      if (this.inBounds(x, y, z) && this.get(x, y, z) === MAT.EMPTY) this.set(x, y, z, type);
    }
  }

  actorCanCarry(type) {
    if (!type || ACTOR_TYPES.has(type) || [MAT.SPAWN, MAT.SPAWN2].includes(type)) return false;
    if ([MAT.TESC, MAT.LIGH, MAT.LOVE, MAT.LOLZ].includes(type)) return true;
    const material = materialById(type);
    return material.render === "powder" || material.render === "liquid" || material.render === "gas" || material.state === "energy";
  }

  setActorElement(index, type) {
    if (!this.actorCanCarry(type)) return false;
    this.ctype[index] = type === MAT.TESC ? MAT.LIGH : type;
    this.flags[index] &= ~ACTOR_FAN;
    return true;
  }

  actorCellPassable(type, x, y, z, sourceIndex = -1) {
    if (!this.inBounds(x, y, z) || !this.wallAllows(type, x, y, z)) return false;
    const target = this.index(x, y, z);
    if (target === sourceIndex || this.types[target] === MAT.EMPTY) return true;
    if (ACTOR_TYPES.has(this.types[target])) return false;
    return materialById(this.types[target]).render !== "solid";
  }

  canActorOccupy(type, x, y, z, sourceIndex = -1) {
    for (let bodyOffset = 0; bodyOffset <= 3; bodyOffset += 1) {
      if (!this.actorCellPassable(type, x, y - bodyOffset, z, sourceIndex)) return false;
    }
    return true;
  }

  actorGrounded(type, x, y, z) {
    return !this.actorCellPassable(type, x, y - 4, z);
  }

  moveActorAxis(index, dx, dy, dz) {
    const [x, y, z] = this.coords(index);
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!this.canActorOccupy(this.types[index], nx, ny, nz, index)) return index;
    const target = this.index(nx, ny, nz);
    this.move(index, target);
    return target;
  }

  damageActor(index, amount) {
    if (this.types[index] === MAT.EMPTY || amount <= 0) return false;
    if (amount >= this.life[index]) {
      this.life[index] = 0;
      return true;
    }
    this.life[index] -= amount;
    return false;
  }

  killActor(index, x, y, z) {
    const carried = materialById(this.ctype[index]).id === this.ctype[index] && this.ctype[index] !== MAT.EMPTY ? this.ctype[index] : MAT.DUST;
    if (this.flags[index] & ACTOR_FAN) {
      this.air.injectVoxel(x, y, z, 64, 0);
    } else {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== 1 || this.random() > 0.62) continue;
        const nx = x + dx * 2;
        const ny = y + dy * 2;
        const nz = z + dz * 2;
        if (!this.inBounds(nx, ny, nz)) continue;
        const target = this.index(nx, ny, nz);
        if (materialById(carried).state === "energy") {
          if (this.energyTypes[target] === MAT.EMPTY) this.setEnergy(nx, ny, nz, carried, this.temperatures[index]);
        } else if (this.types[target] === MAT.EMPTY) this.set(nx, ny, nz, carried, this.temperatures[index]);
      }
    }
    this.transform(index, MAT.EMPTY, 22, 0);
    return true;
  }

  actorPortalInteraction(index, x, y, z) {
    let entered = false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType !== MAT.PRTI) return false;
      const dx = nx - x;
      const dy = ny - y;
      const dz = nz - z;
      const direction = DIRECTIONS_26.findIndex(([vx, vy, vz]) => vx === dx && vy === dy && vz === dz);
      if (direction < 0 || !this.enqueuePortalParticle(neighbor, direction, this.portalParticleState(index, false))) return false;
      const actorType = this.types[index];
      if (actorType === MAT.STKM) this.actorPortalLocks[0] = true;
      else if (actorType === MAT.STKM2) this.actorPortalLocks[1] = true;
      this.transform(index, MAT.EMPTY, 22, 0);
      entered = true;
      return true;
    });
    return entered;
  }

  interactActor(index, x, y, z) {
    if (this.actorPortalInteraction(index, x, y, z) || this.actorPortalInteraction(index, x, y - 3, z)) return true;
    let damage = 0;
    let destroyed = false;
    const seenMatter = new Set();
    const matterInteraction = (neighbor, neighborType) => {
      if (seenMatter.has(neighbor)) return false;
      seenMatter.add(neighbor);
      if (!neighborType || neighbor === index) return false;
      if (neighborType === MAT.PLNT && this.life[index] < 100) {
        this.life[index] = Math.min(100, this.life[index] + 5);
        this.transform(neighbor, MAT.EMPTY, 22, 0);
        return false;
      }
      if (neighborType === MAT.SPRK && this.ctype[index] !== MAT.LIGH) damage += 32 + Math.floor(this.random() * 20);
      const neighborMaterial = materialById(neighborType);
      if (![MAT.INSL, MAT.CRMC].includes(neighborType)
        && ((this.ctype[index] !== MAT.LIGH && this.temperatures[neighbor] >= 50) || this.temperatures[neighbor] <= -30)
        && !((this.flags[index] & ACTOR_ROCKET_BOOTS) && neighborType === MAT.PLSM)) damage += 2;
      if (neighborMaterial.properties.includes("PROP_DEADLY")) damage += neighborType === MAT.ACID ? 5 : 1;
      if (neighborMaterial.properties.includes("PROP_RADIOACTIVE")) damage += 1;
      if ([MAT.BHOL, MAT.NBHL].includes(neighborType)
        || ([MAT.VOID, MAT.PVOD].includes(neighborType) && this.holeAccepts(neighbor, this.types[index]))) {
        destroyed = true;
        return true;
      }
      this.setActorElement(index, neighborType);
      return false;
    };
    this.visitNeighbors(x, y, z, 2, matterInteraction);
    if (!destroyed) this.visitNeighbors(x, y - 3, z, 1, matterInteraction);
    if (!destroyed) {
      const seenEnergy = new Set();
      for (const [centerY, radius] of [[y, 2], [y - 3, 1]]) {
        for (let dz = -radius; dz <= radius && !destroyed; dz += 1) {
          for (let dy = -radius; dy <= radius && !destroyed; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
              const nx = x + dx;
              const ny = centerY + dy;
              const nz = z + dz;
              if (!this.inBounds(nx, ny, nz)) continue;
              const neighbor = this.index(nx, ny, nz);
              if (seenEnergy.has(neighbor)) continue;
              seenEnergy.add(neighbor);
              if (this.energyTypes[neighbor] === MAT.NEUT) {
                damage += this.life[index] <= 100 ? Math.max(1, Math.floor((102 - this.life[index]) / 2)) : Math.ceil(this.life[index] * 0.1);
                this.killEnergy(neighbor);
              } else this.setActorElement(index, this.energyTypes[neighbor]);
            }
          }
        }
      }
    }
    for (const wallY of [y, y - 3]) {
      if (!this.inBounds(x, wallY, z)) continue;
      const wall = this.wallAtVoxel(x, wallY, z);
      if (wall === WALL_ID.DEFAULT_WL_FAN) this.flags[index] |= ACTOR_FAN;
      else if (wall === WALL_ID.DEFAULT_WL_EHOLE) this.flags[index] &= ~ACTOR_ROCKET_BOOTS;
      else if (wall === WALL_ID.DEFAULT_WL_GRVTY) this.flags[index] |= ACTOR_ROCKET_BOOTS;
    }
    if (destroyed || this.damageActor(index, damage)) return this.killActor(index, x, y, z);
    return false;
  }

  actorFacingVector(index) {
    const facing = this.tmp4[index] & 3;
    return facing === 0 ? [-1, 0, 0] : facing === 1 ? [1, 0, 0] : facing === 2 ? [0, 0, -1] : [0, 0, 1];
  }

  actorWeaponDangerous(type) {
    if ([MAT.LIGH, MAT.NEUT].includes(type)) return true;
    const material = materialById(type);
    return material.properties.includes("PROP_DEADLY") || material.properties.includes("PROP_RADIOACTIVE")
      || (material.defaultTemp ?? 22) >= 50 || (material.defaultTemp ?? 22) <= -30;
  }

  fighterCommand(index, x, y, z) {
    let target = -1;
    let targetDistance = Infinity;
    for (const playerType of [MAT.STKM, MAT.STKM2]) {
      const candidate = this.actorIndex(playerType);
      if (candidate < 0) continue;
      const [tx, ty, tz] = this.coords(candidate);
      const distance = (tx - x) ** 2 + (ty - y) ** 2 + (tz - z) ** 2;
      if (distance < targetDistance) {
        target = candidate;
        targetDistance = distance;
      }
    }
    this.tmp2[index] = target < 0 ? 0 : 1;
    if (target < 0) return 0;
    const [tx, ty, tz] = this.coords(target);
    let command = 0;
    const dx = tx - x;
    const dz = tz - z;
    if (Math.abs(dx) >= Math.abs(dz)) command |= dx < 0 ? ACTOR_LEFT : ACTOR_RIGHT;
    else command |= dz < 0 ? ACTOR_FORWARD : ACTOR_BACKWARD;
    if (ty > y + 1 || !this.canActorOccupy(MAT.FIGH, x + Math.sign(dx), y, z + Math.sign(dz))) command |= ACTOR_JUMP;
    if (targetDistance < 600 && this.actorWeaponDangerous(this.ctype[index])) command |= ACTOR_EMIT;
    return command;
  }

  emitActorElement(index, x, y, z) {
    const [dx, , dz] = this.actorFacingVector(index);
    const ex = x + dx * 2;
    const ey = Math.min(this.height - 1, y + 1);
    const ez = z + dz * 2;
    if (!this.inBounds(ex, ey, ez)) return false;
    if (this.flags[index] & ACTOR_FAN) {
      this.air.injectVoxel(ex, ey, ez, 0.45, 0, dx * 8, 0, dz * 8);
      this.tmp3[index] = 0;
      return true;
    }
    const element = materialById(this.ctype[index]).id === this.ctype[index] && this.ctype[index] !== MAT.EMPTY ? this.ctype[index] : MAT.DUST;
    if (element === MAT.LIGH && this.tmp3[index] < 30) return false;
    const target = this.index(ex, ey, ez);
    if (materialById(element).state === "energy") {
      if (this.energyTypes[target] !== MAT.EMPTY) return false;
      this.setEnergy(ex, ey, ez, element, Math.max(this.temperatures[index], materialById(element).defaultTemp ?? 22), undefined, {
        velocityX: dx * (element === MAT.PHOT ? 3 : 2), velocityY: 0, velocityZ: dz * (element === MAT.PHOT ? 3 : 2),
      });
    } else if (this.types[target] !== MAT.EMPTY) {
      if (!this.spark(target)) return false;
    } else {
      this.set(ex, ey, ez, element, materialById(element).defaultTemp, undefined, { velocityX: dx * 5, velocityY: 0.3, velocityZ: dz * 5 });
    }
    this.velocityX[index] -= dx * (materialById(element).density ?? 50) / 1000;
    this.velocityZ[index] -= dz * (materialById(element).density ?? 50) / 1000;
    this.tmp3[index] = 0;
    return true;
  }

  updateActor(index, x, y, z, type) {
    let command = type === MAT.FIGH ? this.fighterCommand(index, x, y, z) : this.actorCommands[type === MAT.STKM ? 0 : 1];
    this.tmp3[index] = Math.min(65535, this.tmp3[index] + 1);
    if (this.temperatures[index] < -30) this.damageActor(index, 1);
    else if (this.temperatures[index] < 36.45) this.temperatures[index] += 1;
    if (this.life[index] < 1 || (this.air.sampleVoxel(x, y, z).pressure >= 4.5 && !(this.flags[index] & ACTOR_FAN))) return this.killActor(index, x, y, z);

    if (command & ACTOR_LEFT) {
      this.velocityX[index] -= 0.34;
      this.tmp4[index] = 0;
    }
    if (command & ACTOR_RIGHT) {
      this.velocityX[index] += 0.34;
      this.tmp4[index] = 1;
    }
    if (command & ACTOR_FORWARD) {
      this.velocityZ[index] -= 0.34;
      this.tmp4[index] = 2;
    }
    if (command & ACTOR_BACKWARD) {
      this.velocityZ[index] += 0.34;
      this.tmp4[index] = 3;
    }
    const grounded = this.actorGrounded(type, x, y, z);
    const rocketBoots = Boolean(this.flags[index] & ACTOR_ROCKET_BOOTS);
    if (command & ACTOR_JUMP) {
      if (rocketBoots) this.velocityY[index] += 0.48;
      else if (grounded) this.velocityY[index] = 1.72;
    }
    if (rocketBoots && command) {
      const belowY = y - 4;
      if (this.inBounds(x, belowY, z) && this.get(x, belowY, z) === MAT.EMPTY && this.random() < 0.45) {
        this.set(x, belowY, z, MAT.PLSM, 3200, 40, { velocityY: -3 });
      }
    }
    if ((command & (ACTOR_LEFT | ACTOR_RIGHT)) === (ACTOR_LEFT | ACTOR_RIGHT) && rocketBoots) this.velocityX[index] *= 0.5;
    if ((command & (ACTOR_FORWARD | ACTOR_BACKWARD)) === (ACTOR_FORWARD | ACTOR_BACKWARD) && rocketBoots) this.velocityZ[index] *= 0.5;

    const gravity = this.gravity.sampleVoxel(x, y, z);
    const air = this.air.sampleVoxel(x, y, z);
    const [baseGravityX, baseGravityY, baseGravityZ] = this.gravityVectorAt(x, y, z);
    const newtonianResponse = materialById(type).upstream?.newtonianGravity ?? 1;
    this.velocityX[index] = Math.max(-1.6, Math.min(1.6, this.velocityX[index] + baseGravityX * 0.22 + gravity.forceX * newtonianResponse * 0.08 + air.velocityX * 0.012));
    this.velocityY[index] = Math.max(-2.2, Math.min(2.2, this.velocityY[index] + baseGravityY * 0.22 + gravity.forceY * newtonianResponse * 0.08 + air.velocityY * 0.012));
    this.velocityZ[index] = Math.max(-1.6, Math.min(1.6, this.velocityZ[index] + baseGravityZ * 0.22 + gravity.forceZ * newtonianResponse * 0.08 + air.velocityZ * 0.012));
    if (!(command & (ACTOR_LEFT | ACTOR_RIGHT))) this.velocityX[index] *= 0.76;
    if (!(command & (ACTOR_FORWARD | ACTOR_BACKWARD))) this.velocityZ[index] *= 0.76;

    let active = index;
    if (Math.abs(this.velocityY[active]) >= 0.35) {
      const next = this.moveActorAxis(active, 0, Math.sign(this.velocityY[active]), 0);
      if (next === active) this.velocityY[active] = 0;
      else active = next;
    }
    if (Math.abs(this.velocityX[active]) >= 0.35) {
      const next = this.moveActorAxis(active, Math.sign(this.velocityX[active]), 0, 0);
      if (next === active) this.velocityX[active] = 0;
      else active = next;
    }
    if (Math.abs(this.velocityZ[active]) >= 0.35) {
      const next = this.moveActorAxis(active, 0, 0, Math.sign(this.velocityZ[active]));
      if (next === active) this.velocityZ[active] = 0;
      else active = next;
    }
    const [ax, ay, az] = this.coords(active);
    if (this.interactActor(active, ax, ay, az)) return true;
    if (command & ACTOR_EMIT) this.emitActorElement(active, ax, ay, az);
    return true;
  }

  canTronEnter(x, y, z, distance = 0) {
    if (!this.inBounds(x, y, z) || this.wallAtVoxel(x, y, z) != null) return false;
    const index = this.index(x, y, z);
    const type = this.types[index];
    if (type === MAT.EMPTY) return true;
    if (type === MAT.SWCH && this.life[index] >= 10) return true;
    if (type === MAT.INVIS && this.tmp2[index] === 1) return true;
    const properties = materialById(type).properties;
    const expiresWhileMoving = (properties.includes("PROP_LIFE_KILL_DEC") && this.life[index] > 0)
      || (properties.includes("PROP_LIFE_KILL") && properties.includes("PROP_LIFE_DEC"));
    return expiresWhileMoving && this.life[index] < distance;
  }

  tronSightScore(x, y, z, direction, length) {
    const [dx, dy, dz] = DIRECTIONS_6[direction];
    const opposite = direction % 2 === 0 ? direction + 1 : direction - 1;
    let score = 0;
    let rx = x;
    let ry = y;
    let rz = z;
    for (let step = 1; step <= length; step += 1) {
      rx += dx;
      ry += dy;
      rz += dz;
      if (!this.canTronEnter(rx, ry, rz, step - 1)) break;
      score += 1;
      const reach = length - step;
      if (reach <= 0) continue;
      for (let side = 0; side < DIRECTIONS_6.length; side += 1) {
        if (side === direction || side === opposite) continue;
        const [sx, sy, sz] = DIRECTIONS_6[side];
        let clear = 0;
        for (let offset = 1; offset <= reach; offset += 1) {
          if (!this.canTronEnter(rx + sx * offset, ry + sy * offset, rz + sz * offset, step + offset - 1)) break;
          clear += 1;
          score += 1;
        }
        if (clear === reach) return length + 1;
      }
    }
    return score;
  }

  createTronHead(source, x, y, z, direction) {
    if (!this.canTronEnter(x, y, z, 0)) return -1;
    const target = this.index(x, y, z);
    if (this.types[target] !== MAT.EMPTY) this.transform(target, MAT.EMPTY, 22, 0);
    if (this.life[source] >= 100) {
      if (!(this.tmp[source] & TRON_NOGROW)) this.tmp2[source] += 1;
      this.life[source] = 5;
    }
    let headFlags = TRON_HEAD | (direction << TRON_DIRECTION_SHIFT)
      | (this.tmp[source] & (TRON_NOGROW | TRON_NODIE | TRON_NORANDOM | 0xf800));
    if (target > source) headFlags |= TRON_WAIT;
    this.set(x, y, z, MAT.TRON, materialById(MAT.TRON).defaultTemp, this.life[source] + 2, {
      tmp: headFlags,
      tmp2: this.tmp2[source],
      ctype: this.ctype[source],
    });
    return target;
  }

  updateTron(index, x, y, z) {
    if (this.tmp[index] & TRON_WAIT) {
      this.tmp[index] &= ~TRON_WAIT;
      return false;
    }
    if (!(this.tmp[index] & TRON_HEAD)) {
      if (this.tmp[index] & TRON_NODIE) this.life[index] += 1;
      return false;
    }

    const encodedDirection = (this.tmp[index] & TRON_DIRECTION_MASK) >> TRON_DIRECTION_SHIFT;
    const originalDirection = encodedDirection < DIRECTIONS_6.length ? encodedDirection : 0;
    const opposite = originalDirection % 2 === 0 ? originalDirection + 1 : originalDirection - 1;
    const candidates = [originalDirection];
    for (let direction = 0; direction < DIRECTIONS_6.length; direction += 1) {
      if (direction !== originalDirection && direction !== opposite) candidates.push(direction);
    }

    if (!(this.tmp[index] & TRON_NORANDOM) && this.random() < 2 / 340) {
      const randomTurn = 1 + Math.floor(this.random() * (candidates.length - 1));
      [candidates[0], candidates[randomTurn]] = [candidates[randomTurn], candidates[0]];
    } else if (!(this.tmp[index] & TRON_NORANDOM)) {
      for (let cursor = candidates.length - 1; cursor > 1; cursor -= 1) {
        const swap = 1 + Math.floor(this.random() * cursor);
        [candidates[cursor], candidates[swap]] = [candidates[swap], candidates[cursor]];
      }
    }

    let direction = candidates[0];
    let bestScore = this.tronSightScore(x, y, z, direction, this.tmp2[index]);
    for (let candidate = 1; candidate < candidates.length; candidate += 1) {
      const score = this.tronSightScore(x, y, z, candidates[candidate], this.tmp2[index]);
      if (score > bestScore) {
        bestScore = score;
        direction = candidates[candidate];
      }
    }
    const [dx, dy, dz] = DIRECTIONS_6[direction];
    if (this.createTronHead(index, x + dx, y + dy, z + dz, direction) < 0) this.tmp[index] |= TRON_DEATH;
    this.life[index] = this.tmp2[index];
    this.tmp[index] &= TRON_TAIL_MASK;
    return false;
  }

  validSoapLink(index) {
    return Number.isInteger(index) && index >= 0 && index < this.size && this.types[index] === MAT.SOAP;
  }

  detachSoap(index) {
    if (index < 0 || index >= this.size || this.types[index] !== MAT.SOAP) return false;
    const flags = this.ctype[index];
    const forward = this.tmp[index];
    const backward = this.tmp2[index];
    if ((flags & 2) && this.validSoapLink(forward) && (this.ctype[forward] & 4)) {
      this.ctype[forward] &= ~4;
      this.tmp2[forward] = -1;
    }
    if ((flags & 4) && this.validSoapLink(backward) && (this.ctype[backward] & 2)) {
      this.ctype[backward] &= ~2;
      this.tmp[backward] = -1;
    }
    this.ctype[index] = 0;
    this.tmp[index] = -1;
    this.tmp2[index] = -1;
    return true;
  }

  attachSoap(first, second) {
    if (first === second || !this.validSoapLink(first) || !this.validSoapLink(second)) return false;
    if (!(this.ctype[second] & 4)) {
      this.ctype[first] |= 2;
      this.tmp[first] = second;
      this.ctype[second] |= 4;
      this.tmp2[second] = first;
      return true;
    }
    if (!(this.ctype[second] & 2)) {
      this.ctype[first] |= 4;
      this.tmp2[first] = second;
      this.ctype[second] |= 2;
      this.tmp[second] = first;
      return true;
    }
    return false;
  }

  remapSoapLinks(first, second, candidates) {
    if (first === second || !candidates) return;
    for (const index of candidates) {
      if (this.types[index] !== MAT.SOAP) continue;
      if (this.tmp[index] === first) this.tmp[index] = second;
      else if (this.tmp[index] === second) this.tmp[index] = first;
      if (this.tmp2[index] === first) this.tmp2[index] = second;
      else if (this.tmp2[index] === second) this.tmp2[index] = first;
    }
  }

  breakOpenSoapChain(start) {
    const connected = [];
    const queue = [start];
    const visited = new Set();
    while (queue.length && connected.length < this.size) {
      const current = queue.pop();
      if (visited.has(current) || !this.validSoapLink(current)) continue;
      visited.add(current);
      connected.push(current);
      if ((this.ctype[current] & 2) && this.validSoapLink(this.tmp[current])) queue.push(this.tmp[current]);
      if ((this.ctype[current] & 4) && this.validSoapLink(this.tmp2[current])) queue.push(this.tmp2[current]);
    }
    for (const current of connected) {
      this.ctype[current] = 0;
      this.tmp[current] = -1;
      this.tmp2[current] = -1;
    }
  }

  updateSoap(index, x, y, z) {
    if ((this.ctype[index] & 2) && !this.validSoapLink(this.tmp[index])) {
      this.ctype[index] &= ~2;
      this.tmp[index] = -1;
    }
    if ((this.ctype[index] & 4) && !this.validSoapLink(this.tmp2[index])) {
      this.ctype[index] &= ~4;
      this.tmp2[index] = -1;
    }

    if (this.ctype[index] & 1) {
      if (this.temperatures[index] > -25) {
        if (this.life[index] <= 0 && (this.ctype[index] & 6) !== 6) {
          this.breakOpenSoapChain(index);
          return false;
        }
        if ((this.ctype[index] & 6) === 6 && this.validSoapLink(this.tmp[index])
          && (this.ctype[this.tmp[index]] & 6) === 6 && this.tmp[this.tmp[index]] === index) {
          this.detachSoap(index);
          return false;
        }
        this.velocityY[index] = (this.velocityY[index] + 0.1) * 0.5;
        this.velocityX[index] *= 0.5;
        this.velocityZ[index] *= 0.5;
      }

      if (!(this.ctype[index] & 2)) {
        this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
          if (neighborType === MAT.SOAP && (this.ctype[neighbor] & 1)
            && (!(this.ctype[neighbor] & 4) || !(this.ctype[neighbor] & 2))) return this.attachSoap(index, neighbor);
          return false;
        });
      } else if (this.life[index] <= 0) {
        let collision = false;
        this.visitNeighbors(x, y, z, 2, (_neighbor, neighborType, nx, ny, nz) => {
          if (this.wallAtVoxel(nx, ny, nz) != null) collision = true;
          else if (neighborType !== MAT.EMPTY && neighborType !== MAT.SOAP && neighborType !== MAT.GLAS
            && materialById(neighborType).render !== "gas") collision = true;
          return collision;
        });
        if (collision && this.temperatures[index] > -25) {
          this.detachSoap(index);
          return false;
        }
      }

      if ((this.ctype[index] & 2) && this.validSoapLink(this.tmp[index])) {
        const mate = this.tmp[index];
        const [mx, my, mz] = this.coords(mate);
        const dx = x - mx;
        const dy = y - my;
        const dz = z - mz;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        const spring = 9 / (distanceSq + 9) - 0.5;
        this.velocityX[mate] -= dx * spring;
        this.velocityY[mate] -= dy * spring;
        this.velocityZ[mate] -= dz * spring;
        this.velocityX[index] += dx * spring;
        this.velocityY[index] += dy * spring;
        this.velocityZ[index] += dz * spring;

        if ((this.ctype[mate] & 2) && this.validSoapLink(this.tmp[mate])) {
          const next = this.tmp[mate];
          const [nx, ny, nz] = this.coords(next);
          const bendX = nx - mx;
          const bendY = ny - my;
          const bendZ = nz - mz;
          const bendSq = bendX * bendX + bendY * bendY + bendZ * bendZ;
          const bend = (81 / (bendSq + 81) - 0.5) * 0.5;
          this.velocityX[mate] -= bendX * bend;
          this.velocityY[mate] -= bendY * bend;
          this.velocityZ[mate] -= bendZ * bend;
          this.velocityX[next] += bendX * bend;
          this.velocityY[next] += bendY * bend;
          this.velocityZ[next] += bendZ * bend;
        }
      }
    } else {
      const pressure = this.air.sampleVoxel(x, y, z).pressure;
      if (Math.abs(pressure) > 0.5) {
        this.ctype[index] = 1;
        this.life[index] = 10;
      }
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (neighborType !== MAT.OIL) return false;
        const gravity = this.gravity.sampleVoxel(x, y, z);
        const vx = ((this.velocityX[index] - gravity.forceX) * 0.5 + this.velocityX[neighbor]) / 2;
        const vy = ((this.velocityY[index] - gravity.forceY) * 0.5 + this.velocityY[neighbor]) / 2;
        const vz = ((this.velocityZ[index] - gravity.forceZ) * 0.5 + this.velocityZ[neighbor]) / 2;
        this.velocityX[index] = this.velocityX[neighbor] = vx;
        this.velocityY[index] = this.velocityY[neighbor] = vy;
        this.velocityZ[index] = this.velocityZ[neighbor] = vz;
        return false;
      });
    }

    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY || neighborType === MAT.SOAP) return false;
      const decoration = this.decorations[neighbor] >>> 0;
      const red = Math.trunc(((decoration >>> 16) & 0xff) * 0.85);
      const green = Math.trunc(((decoration >>> 8) & 0xff) * 0.85);
      const blue = Math.trunc((decoration & 0xff) * 0.85);
      const alpha = Math.trunc(((decoration >>> 24) & 0xff) * 0.85);
      this.decorations[neighbor] = ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
      return false;
    });
    return false;
  }

  updateDeuterium(index, x, y, z) {
    const capacityTemperature = Math.max(1, this.temperatures[index] + 274.15);
    const gravity = this.gravity.sampleVoxel(x, y, z);
    const gravityMagnitude = Math.abs(gravity.forceX) + Math.abs(gravity.forceY) + Math.abs(gravity.forceZ);
    const gravityMultiplier = Math.trunc(5 - 8 / (gravityMagnitude + 2));
    const capacityDenominator = Math.max(1, Math.trunc(capacityTemperature + 1));
    let maxLife = Math.trunc(10000 / (capacityTemperature + 1) - 1);
    if (this.random() < (10000 % capacityDenominator) / capacityDenominator) maxLife += 1;
    maxLife = Math.max(0, maxLife * gravityMultiplier);

    if (this.life[index] < maxLife) {
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType !== MAT.DEUT || this.random() >= 1 / 3) return false;
        const amount = this.life[neighbor] + 1;
        if (amount <= maxLife - this.life[index]) {
          this.life[index] += amount;
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        }
        return this.life[index] >= maxLife;
      });
    } else if (this.life[index] > maxLife) {
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        if (this.life[index] <= maxLife) break;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz) || this.get(nx, ny, nz) !== MAT.EMPTY || !this.wallAllows(MAT.DEUT, nx, ny, nz)) continue;
        this.set(nx, ny, nz, MAT.DEUT, this.temperatures[index], 0);
        this.processed[this.index(nx, ny, nz)] = this.epoch;
        this.life[index] -= 1;
      }
    }

    for (let trade = 0; trade < 4; trade += 1) {
      const nx = x + Math.floor(this.random() * 5) - 2;
      const ny = y + Math.floor(this.random() * 5) - 2;
      const nz = z + Math.floor(this.random() * 5) - 2;
      if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (this.types[neighbor] !== MAT.DEUT || this.life[index] <= this.life[neighbor] || this.life[index] <= 0) continue;
      const transfer = Math.max(1, Math.floor((this.life[index] - this.life[neighbor]) / 2));
      this.life[index] -= transfer;
      this.life[neighbor] = Math.min(65535, this.life[neighbor] + transfer);
    }
    return false;
  }

  updatePolonium(index, x, y, z) {
    if (this.tmp2[index] >= 10) {
      this.transform(index, MAT.PLUT, (this.temperatures[index] + 326.85) / 2);
      return true;
    }
    if (this.tmp[index] < 5 && this.life[index] === 0 && this.random() < 1 / 10000) {
      const neutron = this.createEnergyNearby(x, y, z, MAT.NEUT);
      if (neutron >= 0) {
        this.life[index] = 15;
        this.tmp[index] += 1;
        this.temperatures[index] = (this.temperatures[index] + this.energyTemperatures[neutron] + 600) / 2;
        this.energyTemperatures[neutron] = this.temperatures[index];
      }
    }
    if (this.temperatures[index] < 115) this.temperatures[index] = Math.min(115, this.temperatures[index] + 0.2);
    return false;
  }

  updateWarp(index, x, y, z) {
    if (this.tmp2[index] > 2000) {
      this.temperatures[index] = 9725.85;
      this.air.injectVoxel(x, y, z, this.tmp2[index] / 5000, 0);
      if (this.random() < 1 / 50 && this.energyTypes[index] === MAT.EMPTY) {
        this.setEnergy(x, y, z, MAT.ELEC, 9725.85);
        this.energyProcessed[index] = this.epoch;
      }
    }
    const excluded = new Set([MAT.WARP, MAT.STKM, MAT.STKM2, MAT.DMND, MAT.CLNE, MAT.BCLN, MAT.PCLN]);
    for (let trade = 0; trade < 5; trade += 1) {
      const dx = Math.floor(this.random() * 3) - 1;
      const dy = Math.floor(this.random() * 3) - 1;
      const dz = Math.floor(this.random() * 3) - 1;
      if (dx === 0 && dy === 0 && dz === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const target = this.index(nx, ny, nz);
      if (this.types[target] === MAT.EMPTY || excluded.has(this.types[target])) continue;
      this.move(index, target);
      this.velocityX[index] = Math.floor(this.random() * 4) - 1.5;
      this.velocityY[index] = Math.floor(this.random() * 4) - 2;
      this.velocityZ[index] = Math.floor(this.random() * 4) - 2;
      this.life[target] = Math.min(65535, this.life[target] + 4);
      return true;
    }
    return false;
  }

  updateExoticMatter(index, x, y, z) {
    let converted = false;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (neighborType === MAT.WARP && this.tmp2[neighbor] > 2000 && this.random() < 0.01) this.tmp2[index] += 100;
      else if (neighborType === MAT.EXOT) {
        if (this.ctype[neighbor] === MAT.PROT) this.ctype[index] = MAT.PROT;
        if (this.life[neighbor] === 1500 && this.random() < 0.001) this.life[index] = 1500;
      } else if (neighborType === MAT.LAVA && [MAT.TTAN, MAT.GOLD].includes(this.ctype[neighbor]) && this.random() < 0.1) {
        this.ctype[neighbor] = MAT.VIBR;
        this.transform(index, MAT.EMPTY, 22, 0);
        converted = true;
        return true;
      } else if (neighborType === MAT.LAVA && this.ctype[neighbor] === MAT.VIBR && this.random() < 0.001) {
        this.transform(index, MAT.EMPTY, 22, 0);
        converted = true;
        return true;
      }
      if (this.tmp[index] > 245 && this.life[index] > 1337 && ![
        MAT.EXOT, MAT.BREC, MAT.DMND, MAT.CLNE, MAT.PRTI, MAT.PRTO, MAT.PCLN, MAT.VOID, MAT.NBHL, MAT.WARP,
      ].includes(neighborType) && neighborType !== MAT.EMPTY) {
        this.set(x, y, z, neighborType);
        converted = true;
        return true;
      }
      return false;
    });
    if (converted) return true;

    this.tmp[index] -= 1;
    this.tmp2[index] -= 1;
    if (this.tmp[index] < 1 || this.tmp[index] > 250) this.tmp[index] = 250;
    if (this.tmp2[index] < 1) this.tmp2[index] = 1;
    else if (this.tmp2[index] > 6000) {
      this.tmp2[index] = 10000;
      if (this.life[index] < 1001) {
        this.changeTypePreserve(index, MAT.WARP);
        this.tmp2[index] = 10000;
        return true;
      }
    } else if (this.life[index] < 1001) {
      this.air.injectVoxel(x, y, z, this.tmp2[index] / 160000, 0);
    }
    if (this.air.sampleVoxel(x, y, z).pressure > 200 && this.temperatures[index] > 8726.85 && this.tmp2[index] > 200) {
      this.changeTypePreserve(index, MAT.WARP);
      this.tmp2[index] = 6000;
      return true;
    }

    if (this.tmp2[index] > 100) {
      for (let trade = 0; trade < 9; trade += 1) {
        const nx = x + Math.floor(this.random() * 5) - 2;
        const ny = y + Math.floor(this.random() * 5) - 2;
        const nz = z + Math.floor(this.random() * 5) - 2;
        if (!this.inBounds(nx, ny, nz) || (nx === x && ny === y && nz === z)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (this.types[neighbor] !== MAT.EXOT || this.tmp2[neighbor] < 0 || this.tmp2[index] <= this.tmp2[neighbor]) continue;
        const transfer = Math.max(1, Math.floor((this.tmp2[index] - this.tmp2[neighbor]) / 2));
        this.tmp2[index] -= transfer;
        this.tmp2[neighbor] += transfer;
        break;
      }
    }
    if (this.ctype[index] === MAT.PROT) {
      if (this.temperatures[index] < -223.15) {
        this.set(x, y, z, MAT.CFLM);
        return true;
      }
      this.temperatures[index] -= 1;
    } else if (this.temperatures[index] < 0) {
      this.velocityX[index] = 0;
      this.velocityY[index] = 0;
      this.velocityZ[index] = 0;
      this.air.injectVoxel(x, y, z, -0.01, 0);
      this.tmp[index] -= 1;
    }
    return false;
  }

  updateVibranium(index, x, y, z, type) {
    const pressure = this.air.sampleVoxel(x, y, z).pressure;
    const nextRandomBits = () => Math.floor(this.random() * 0x100000000) >>> 0;
    let randomBits = 0;
    if (this.life[index] === 0) {
      if (this.temperatures[index] > 1.5) {
        this.tmp[index] += 1;
        this.temperatures[index] -= 3;
      } else if (this.temperatures[index] < -1.5) {
        this.tmp[index] -= 1;
        this.temperatures[index] += 3;
      }
      if (pressure > 2.5) {
        this.tmp[index] += 7;
        this.air.injectVoxel(x, y, z, -1, 0);
      } else if (pressure < -2.5) {
        this.tmp[index] -= 2;
        this.air.injectVoxel(x, y, z, 1, 0);
      }
      if (this.tmp[index] > 1000) this.life[index] = 750;
    } else {
      randomBits = nextRandomBits();
      if (this.life[index] < 300) {
        const [dx, dy, dz] = DIRECTIONS_26[randomBits % DIRECTIONS_26.length];
        randomBits >>>= 5;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz)) {
          const neighbor = this.index(nx, ny, nz);
          const neighborType = this.types[neighbor];
          if (neighborType !== MAT.EMPTY && neighborType !== MAT.BREC
            && materialById(neighborType).properties.includes("PROP_CONDUCTS") && this.life[neighbor] === 0) {
            this.spark(neighbor, neighborType, 4);
          }
        }
      }
      if (this.life[index] < 500 && this.tmp[index] > 0) {
        const dx = randomBits % 7 - 3;
        randomBits >>>= 3;
        const dy = randomBits % 7 - 3;
        randomBits >>>= 3;
        const dz = randomBits % 7 - 3;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz)) {
          const neighbor = this.index(nx, ny, nz);
          const neighborType = this.types[neighbor];
          if (neighborType !== MAT.EMPTY && ![MAT.VIBR, MAT.BVBR].includes(neighborType) && !this.heatInsulatorAt(neighbor)) {
            this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + this.tmp[index] * 3);
            this.tmp[index] = 0;
          }
        }
      }
      if (this.life[index] === 1) {
        if (!this.tmp2[index]) {
          this.createEnergyNearby(x, y, z, MAT.ELEC, { temperature: 6726.85 });
          this.createEnergyNearby(x, y, z, MAT.PHOT, { temperature: 6726.85, ctype: 0x3fffffff });
          for (const [dx, dy, dz] of DIRECTIONS_26) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (this.inBounds(nx, ny, nz) && this.get(nx, ny, nz) === MAT.EMPTY) {
              this.set(nx, ny, nz, MAT.BREC, 6726.85);
              this.processed[this.index(nx, ny, nz)] = this.epoch;
              break;
            }
          }
          this.set(x, y, z, MAT.EXOT);
          this.tmp2[index] = nextRandomBits() % 1000;
          this.temperatures[index] = 8726.85;
          this.air.injectVoxel(x, y, z, 50, 0);
          return true;
        }
        this.tmp2[index] = 0;
        this.temperatures[index] = 0;
        this.tmp[index] = 0;
      }
    }

    let changed = false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (this.life[index] && [MAT.VIBR, MAT.BVBR].includes(neighborType)) {
        if (!this.life[neighbor]) this.tmp[neighbor] += 45;
        else if (this.tmp2[index] && this.life[index] > 75 && this.random() < 0.5) {
          this.tmp2[neighbor] = 1;
          this.tmp[index] = 0;
        }
      } else if (this.life[index] && neighborType === MAT.CFLM) {
        this.tmp2[index] = 1;
        this.tmp[index] = 0;
      } else if (!this.life[index] && neighborType === MAT.EXOT && this.random() < 1 / 25) {
        this.changeTypePreserve(index, MAT.EXOT);
        changed = true;
        return true;
      }
      if (type === MAT.VIBR && neighborType === MAT.ANAR) {
        this.changeTypePreserve(index, MAT.BVBR);
        this.air.injectVoxel(x, y, z, -1, 0);
      }
      return false;
    });
    if (changed) return true;
    this.tmp[index] = Math.max(0, Math.min(1 << 15, this.tmp[index]));
    for (let trade = 0; trade < 9; trade += 1) {
      if (trade % 2 === 0) randomBits = nextRandomBits();
      const dx = randomBits % 7 - 3;
      randomBits >>>= 3;
      const dy = randomBits % 7 - 3;
      randomBits >>>= 3;
      const dz = randomBits % 7 - 3;
      randomBits >>>= 3;
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz) || (dx === 0 && dy === 0 && dz === 0)) continue;
      const neighbor = this.index(nx, ny, nz);
      if (![MAT.VIBR, MAT.BVBR].includes(this.types[neighbor]) || this.tmp[index] <= this.tmp[neighbor]) continue;
      const transfer = Math.floor((this.tmp[index] - this.tmp[neighbor]) / 2);
      this.tmp[index] -= transfer;
      this.tmp[neighbor] += transfer;
      break;
    }
    return false;
  }

  updateNuclearElement(index, x, y, z, type) {
    if (type === MAT.URAN) {
      const pressure = this.air.sampleVoxel(x, y, z).pressure;
      if (this.heatSimulationEnabled && pressure > 0) {
        if (this.temperatures[index] <= -273.15) this.temperatures[index] = -273.14;
        else this.temperatures[index] = Math.min(9725.85, (this.temperatures[index] + 273.15) * (1 + pressure / 2000) - 273.15);
      }
      return false;
    }
    if (type === MAT.PLUT) {
      const pressure = Math.max(0, this.air.sampleVoxel(x, y, z).pressure);
      if (pressure > 0 && this.random() < 0.01 && this.random() < Math.min(1, pressure * 5 / 1000)) {
        this.transform(index, MAT.EMPTY, 22, 0);
        this.setEnergy(x, y, z, MAT.NEUT, materialById(MAT.NEUT).defaultTemp);
        this.energyProcessed[index] = this.epoch;
        return true;
      }
      return false;
    }
    if (type === MAT.POLO) return this.updatePolonium(index, x, y, z);
    if (type === MAT.DEUT) return this.updateDeuterium(index, x, y, z);
    if (type === MAT.ISOZ || type === MAT.ISZS) {
      const pressure = this.air.sampleVoxel(x, y, z).pressure;
      if (pressure < 0 && this.random() < 1 / 200 && this.random() < Math.min(1, -pressure * 4 / 1000)) {
        const speed = (128 + Math.floor(this.random() * 228)) / 127;
        const angle = this.random() * Math.PI * 2;
        const elevation = (this.random() - 0.5) * Math.PI;
        this.transform(index, MAT.EMPTY, 22, 0);
        this.setEnergy(x, y, z, MAT.PHOT, materialById(MAT.PHOT).defaultTemp, undefined, {
          ctype: 0x3fffffff,
          velocityX: Math.cos(angle) * Math.cos(elevation) * speed,
          velocityY: Math.sin(elevation) * speed,
          velocityZ: Math.sin(angle) * Math.cos(elevation) * speed,
        });
        this.energyProcessed[index] = this.epoch;
        return true;
      }
      return false;
    }
    if (type === MAT.WARP) return this.updateWarp(index, x, y, z);
    if (type === MAT.EXOT) return this.updateExoticMatter(index, x, y, z);
    if (type === MAT.VIBR || type === MAT.BVBR) return this.updateVibranium(index, x, y, z, type);
    return false;
  }

  validElementType(type) {
    return Number.isInteger(type) && type > MAT.EMPTY && materialById(type).id === type && materialById(type).enabled;
  }

  cloneExclusions(powered = false, converter = false) {
    const excluded = [MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.PBCN, MAT.STKM, MAT.STKM2];
    if (powered) excluded.push(MAT.SPRK, MAT.NSCN, MAT.PSCN);
    if (converter) excluded.push(MAT.CONV);
    return excluded;
  }

  learnClonerType(index, x, y, z, powered = false) {
    const excluded = this.cloneExclusions(powered);
    return this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      const energyType = this.energyTypes[neighbor];
      const targetType = energyType !== MAT.EMPTY ? energyType : neighborType;
      if (!this.validElementType(targetType) || excluded.includes(targetType)) return false;
      this.ctype[index] = targetType;
      if (targetType === MAT.LIFE || targetType === MAT.LAVA) {
        this.tmp[index] = energyType !== MAT.EMPTY ? this.energyCtype[neighbor] : this.ctype[neighbor];
      }
      return true;
    });
  }

  createClonedParticle(clonerIndex, x, y, z, cloneType, dx, dy, dz, velocity = null) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!this.inBounds(nx, ny, nz) || !this.wallAllows(cloneType, nx, ny, nz)) return false;
    const target = this.index(nx, ny, nz);
    let cloneCtype = materialById(cloneType).defaultCtype;
    if (cloneType === MAT.LIFE) cloneCtype = this.tmp[clonerIndex];
    else if (cloneType === MAT.LAVA && this.validElementType(this.tmp[clonerIndex])
      && materialById(this.tmp[clonerIndex]).highTemperatureTransition === MAT.LAVA) cloneCtype = this.tmp[clonerIndex];
    if (materialById(cloneType).state === "energy") {
      if (this.energyTypes[target] !== MAT.EMPTY) return false;
      const properties = { ctype: cloneCtype };
      if (velocity) [properties.velocityX, properties.velocityY, properties.velocityZ] = velocity;
      this.setEnergy(nx, ny, nz, cloneType, materialById(cloneType).defaultTemp, undefined, properties);
      this.energyProcessed[target] = this.epoch;
      return true;
    }
    if (this.types[target] !== MAT.EMPTY) return false;
    this.set(nx, ny, nz, cloneType, materialById(cloneType).defaultTemp, undefined, { ctype: cloneCtype });
    this.processed[target] = this.epoch;
    return true;
  }

  updateCloner(index, x, y, z, type) {
    const powered = type === MAT.PCLN || type === MAT.PBCN;
    const breakable = type === MAT.BCLN || type === MAT.PBCN;
    const field = this.air.sampleVoxel(x, y, z);

    if (type === MAT.BCLN && !this.life[index] && field.pressure > 4) {
      this.life[index] = 80 + Math.floor(this.random() * 40);
    } else if (type === MAT.PBCN && !this.tmp2[index] && field.pressure > 4) {
      this.tmp2[index] = 80 + Math.floor(this.random() * 40);
    }
    if (breakable && (type === MAT.BCLN ? this.life[index] : this.tmp2[index])) {
      this.velocityX[index] += field.velocityX * 0.1;
      this.velocityY[index] += field.velocityY * 0.1;
      this.velocityZ[index] += field.velocityZ * 0.1;
      if (type === MAT.PBCN) {
        this.tmp2[index] -= 1;
        if (this.tmp2[index] <= 0) {
          this.transform(index, MAT.EMPTY, 22, 0);
          return true;
        }
      }
    }

    if (type === MAT.PCLN) {
      if (this.life[index] > 0 && this.life[index] !== 10) this.life[index] -= 1;
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (neighborType !== MAT.PCLN) return false;
        if (this.life[index] === 10 && this.life[neighbor] > 0 && this.life[neighbor] < 10) this.life[index] = 9;
        else if (this.life[index] === 0 && this.life[neighbor] === 10) this.life[index] = 10;
        return false;
      });
    } else if (type === MAT.PBCN) {
      if (this.life[index] !== 10) {
        if (this.life[index] > 0) this.life[index] -= 1;
      } else {
        this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
          if (neighborType !== MAT.PBCN) return false;
          if (this.life[neighbor] > 0 && this.life[neighbor] < 10) this.life[index] = 9;
          else if (this.life[neighbor] === 0) this.life[neighbor] = 10;
          return false;
        });
      }
    }

    if (!this.validElementType(this.ctype[index]) || this.cloneExclusions(powered).includes(this.ctype[index])) {
      this.learnClonerType(index, x, y, z, powered);
      return false;
    }
    if (powered && this.life[index] !== 10) return false;

    const cloneType = this.ctype[index];
    if (cloneType === MAT.PHOT && powered) {
      for (const [dx, dy, dz] of DIRECTIONS_26) this.createClonedParticle(index, x, y, z, cloneType, dx, dy, dz, [dx * 3, dy * 3, dz * 3]);
      return false;
    }
    if (cloneType === MAT.LIFE && powered) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) this.createClonedParticle(index, x, y, z, cloneType, dx, dy, dz);
        }
      }
      return false;
    }
    if (cloneType === MAT.LIGH && this.random() >= 1 / 30) return false;
    const dx = Math.floor(this.random() * 3) - 1;
    const dy = Math.floor(this.random() * 3) - 1;
    const dz = Math.floor(this.random() * 3) - 1;
    this.createClonedParticle(index, x, y, z, cloneType, dx, dy, dz);
    return false;
  }

  converterCandidateAllowed(type, restrictElement, inverted) {
    return type !== MAT.EMPTY && (!restrictElement || ((type === restrictElement) !== inverted));
  }

  convertParticleAt(target, sourceEnergy, convertTo, subtype) {
    const [x, y, z] = this.coords(target);
    const properties = convertTo === MAT.LIFE ? { ctype: subtype } : {};
    if (sourceEnergy) this.killEnergy(target);
    if (materialById(convertTo).state === "energy") {
      if (!sourceEnergy && this.types[target] !== MAT.EMPTY) this.transform(target, MAT.EMPTY, 22, 0);
      if (this.energyTypes[target] !== MAT.EMPTY) this.killEnergy(target);
      this.setEnergy(x, y, z, convertTo, materialById(convertTo).defaultTemp, undefined, properties);
      this.energyProcessed[target] = this.epoch;
    } else {
      if (this.types[target] !== MAT.EMPTY) this.transform(target, MAT.EMPTY, 22, 0);
      this.set(x, y, z, convertTo, materialById(convertTo).defaultTemp, undefined, properties);
      this.processed[target] = this.epoch;
    }
  }

  updateConverter(index, x, y, z) {
    const packedCtype = this.ctype[index] >>> 0;
    const convertTo = packedCtype & 0x1ff;
    if (!this.validElementType(convertTo) || convertTo === MAT.CONV) {
      const excluded = this.cloneExclusions(false, true);
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        const energyType = this.energyTypes[neighbor];
        const targetType = energyType !== MAT.EMPTY ? energyType : neighborType;
        if (!this.validElementType(targetType) || excluded.includes(targetType)) return false;
        this.ctype[index] = targetType === MAT.LIFE
          ? ((energyType !== MAT.EMPTY ? this.energyCtype[neighbor] : this.ctype[neighbor]) << 9) | MAT.LIFE
          : targetType;
        return true;
      });
      return false;
    }

    const restrictElement = this.validElementType(this.tmp[index]) ? this.tmp[index] : MAT.EMPTY;
    const inverted = this.tmp2[index] === 1;
    const subtype = packedCtype >>> 9;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      const energyType = this.energyTypes[neighbor];
      let sourceEnergy = false;
      let candidate = MAT.EMPTY;
      if (this.converterCandidateAllowed(energyType, restrictElement, inverted)) {
        candidate = energyType;
        sourceEnergy = true;
      } else if (this.converterCandidateAllowed(neighborType, restrictElement, inverted)) candidate = neighborType;
      if (candidate === MAT.EMPTY || candidate === MAT.CONV || candidate === MAT.DMND || candidate === convertTo) return false;
      this.convertParticleAt(neighbor, sourceEnergy, convertTo, subtype);
      return false;
    });
    return false;
  }

  updateHole(index, x, y, z, type) {
    const poweredVoid = type === MAT.PVOD;
    if (poweredVoid) {
      if (this.life[index] > 0 && this.life[index] !== 10) this.life[index] -= 1;
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (neighborType !== MAT.PVOD) return false;
        if (this.life[index] === 10 && this.life[neighbor] > 0 && this.life[neighbor] < 10) this.life[index] = 9;
        else if (this.life[index] === 0 && this.life[neighbor] === 10) this.life[index] = 10;
        return false;
      });
      if (this.life[index] !== 10) return false;
    }
    if (type === MAT.BHOL) this.air.injectVoxel(x, y, z, -0.65, 0);
    else if (type === MAT.WHOL) this.air.injectVoxel(x, y, z, 0.65, 0);
    const blackHole = type === MAT.BHOL || type === MAT.NBHL;
    const whiteHole = type === MAT.WHOL || type === MAT.NWHL;
    const protectedTypes = [MAT.DMND, MAT.VOID, MAT.PVOD, MAT.BHOL, MAT.WHOL, MAT.NBHL, MAT.NWHL];
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType !== MAT.EMPTY && !protectedTypes.includes(neighborType)) {
        if (blackHole) {
          this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + this.temperatures[neighbor] * 0.5);
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        } else if (whiteHole && neighborType === MAT.ANAR) {
          this.temperatures[index] = Math.max(-273.15, this.temperatures[index] - (9725.85 - this.temperatures[neighbor]) * 0.5);
          this.transform(neighbor, MAT.EMPTY, 22, 0);
        } else if (!whiteHole && this.holeAccepts(index, neighborType)) this.transform(neighbor, MAT.EMPTY, 22, 0);
      }
      const energyType = this.energyTypes[neighbor];
      if (energyType !== MAT.EMPTY) {
        if (blackHole) {
          this.temperatures[index] = Math.min(9725.85, this.temperatures[index] + this.energyTemperatures[neighbor] * 0.5);
          this.killEnergy(neighbor);
        } else if (!whiteHole && this.holeAccepts(index, energyType)) this.killEnergy(neighbor);
      }
      return false;
    });
    return false;
  }

  holeAccepts(index, particleType) {
    const holeType = this.types[index];
    if (holeType === MAT.PVOD && this.life[index] !== 10) return false;
    if (holeType !== MAT.VOID && holeType !== MAT.PVOD) return true;
    return !this.ctype[index] || ((this.ctype[index] === particleType) !== Boolean(this.tmp[index] & 1));
  }

  activateNearbyConductors(x, y, z, radius = 2) {
    let activated = 0;
    const source = this.index(x, y, z);
    this.visitNeighbors(x, y, z, radius, (neighbor, neighborType) => {
      if (!this.insulationBetween(source, neighbor) && isConductor(neighborType) && ![MAT.WATR, MAT.SLTW, MAT.NTCT, MAT.PTCT, MAT.INWR].includes(neighborType) && this.life[neighbor] === 0) {
        if (this.spark(neighbor, neighborType, 4)) activated += 1;
      }
      return false;
    });
    return activated;
  }

  writeAdjacentFilterLines(x, y, z, value) {
    let written = 0;
    for (const [dx, dy, dz] of DIRECTIONS_26) {
      let nx = x + dx;
      let ny = y + dy;
      let nz = z + dz;
      while (this.inBounds(nx, ny, nz)) {
        const filter = this.index(nx, ny, nz);
        if (this.types[filter] !== MAT.FILT) break;
        this.ctype[filter] = value | 0;
        written += 1;
        nx += dx;
        ny += dy;
        nz += dz;
      }
    }
    return written;
  }

  sensorOccupant(index) {
    if (this.types[index] !== MAT.EMPTY) return {
      energy: false, type: this.types[index], temperature: this.temperatures[index], life: this.life[index], ctype: this.ctype[index],
      velocityX: this.velocityX[index], velocityY: this.velocityY[index], velocityZ: this.velocityZ[index],
    };
    if (this.energyTypes[index] !== MAT.EMPTY) return {
      energy: true, type: this.energyTypes[index], temperature: this.energyTemperatures[index], life: this.energyLife[index], ctype: this.energyCtype[index],
      velocityX: this.energyVelocityX[index], velocityY: this.energyVelocityY[index], velocityZ: this.energyVelocityZ[index],
    };
    return null;
  }

  updateLinearDetector(index, x, y, z) {
    if (this.tmp[index] < 0) this.tmp[index] = 0;
    if (this.tmp2[index] < 0) this.tmp2[index] = 0;
    const targetType = this.ctype[index];
    const detectLength = this.tmp[index];
    const skip = Math.max(0, this.life[index]);
    const invertFilter = Boolean(this.tmp2[index] & 0x1);
    const ignoreEnergy = Boolean(this.tmp2[index] & 0x2);
    const copyColor = !(this.tmp2[index] & 0x4);
    const keepSearching = Boolean(this.tmp2[index] & 0x8);
    const maximum = detectLength ? skip + detectLength : Math.max(this.width, this.height, this.depth);
    const photData = new Set([MAT.FILT, MAT.PHOT, MAT.BRAY, MAT.BIZR, MAT.BIZRG, MAT.BIZRS]);

    for (const [dx, dy, dz] of DIRECTIONS_26) {
      const inputX = x + dx;
      const inputY = y + dy;
      const inputZ = z + dz;
      if (!this.inBounds(inputX, inputY, inputZ)) continue;
      const input = this.index(inputX, inputY, inputZ);
      const inputType = this.types[input];
      const boolMode = isConductor(inputType)
        && ![MAT.WATR, MAT.SLTW, MAT.NTCT, MAT.PTCT, MAT.INWR].includes(inputType)
        && this.life[input] === 0;
      const filterMode = copyColor && inputType === MAT.FILT;
      if (!boolMode && !filterMode) continue;
      const stepX = -dx;
      const stepY = -dy;
      const stepZ = -dz;
      for (let step = skip + 1; step <= maximum; step += 1) {
        const scanX = x + stepX * step;
        const scanY = y + stepY * step;
        const scanZ = z + stepZ * step;
        if (!this.inBounds(scanX, scanY, scanZ)) break;
        const scan = this.index(scanX, scanY, scanZ);
        let occupant = this.types[scan] !== MAT.EMPTY ? this.sensorOccupant(scan) : null;
        if (!occupant && !ignoreEnergy && this.energyTypes[scan] !== MAT.EMPTY) occupant = this.sensorOccupant(scan);
        if (!occupant) continue;
        const matchesType = occupant.type === targetType;
        const matchesFilter = !targetType || (invertFilter !== matchesType);
        if (!matchesFilter) {
          if (keepSearching) continue;
          break;
        }
        if (boolMode) {
          this.spark(input, inputType, 4);
          break;
        }
        if (!photData.has(occupant.type)) continue;
        let wavelength = occupant.ctype;
        if (occupant.type === MAT.FILT) {
          const temperatureBin = Math.max(0, Math.min(25, Math.floor(occupant.temperature * 0.025)));
          wavelength = wavelength || ((0x1f << temperatureBin) & PHOTON_WAVELENGTH_MASK);
        }
        let filterX = inputX;
        let filterY = inputY;
        let filterZ = inputZ;
        while (this.inBounds(filterX, filterY, filterZ)) {
          const filter = this.index(filterX, filterY, filterZ);
          if (this.types[filter] !== MAT.FILT) break;
          this.ctype[filter] = wavelength;
          filterX += dx;
          filterY += dy;
          filterZ += dz;
        }
        break;
      }
    }
    return false;
  }

  updateSensor(index, x, y, z, type) {
    if (type === MAT.LDTC) return this.updateLinearDetector(index, x, y, z);
    if (type === MAT.PSNS) {
      const pressure = this.air.sampleVoxel(x, y, z).pressure;
      if (this.tmp[index] === 1) this.writeAdjacentFilterLines(x, y, z, 0x10000000 + Math.round(pressure) + 256);
      else if ((this.tmp[index] === 0 && pressure > this.temperatures[index])
        || (this.tmp[index] === 2 && pressure < this.temperatures[index])) this.activateNearbyConductors(x, y, z, 2);
      return false;
    }

    const radius = Math.max(0, Math.min(25, this.tmp2[index]));
    this.tmp2[index] = radius;
    if (this.life[index]) {
      this.life[index] = 0;
      this.activateNearbyConductors(x, y, z, 2);
    }
    let detected = false;
    let serialized = false;
    let serializedValue = 0;
    this.visitNeighbors(x, y, z, radius, (neighbor) => {
      const occupant = this.sensorOccupant(neighbor);
      if (!occupant) return false;
      if (type === MAT.DTEC) {
        if (occupant.type === this.ctype[index]
          && (occupant.type !== MAT.LIFE || !this.tmp[index] || this.tmp[index] === occupant.ctype)) detected = true;
        if (occupant.type === MAT.PHOT || (occupant.type === MAT.BRAY && this.tmp[neighbor] !== 2)
          || [MAT.BIZR, MAT.BIZRG, MAT.BIZRS].includes(occupant.type)) {
          serialized = true;
          serializedValue = occupant.ctype;
        }
      } else if (type === MAT.TSNS) {
        if (this.tmp[index] === 0 && ![MAT.TSNS, MAT.METL].includes(occupant.type) && occupant.temperature > this.temperatures[index]) detected = true;
        else if (this.tmp[index] === 2 && ![MAT.TSNS, MAT.METL].includes(occupant.type) && occupant.temperature < this.temperatures[index]) detected = true;
        else if (this.tmp[index] === 1 && ![MAT.TSNS, MAT.FILT].includes(occupant.type)) {
          serialized = true;
          serializedValue = 0x10000000 + Math.trunc(occupant.temperature + 273.15);
        }
      } else if (type === MAT.LSNS) {
        if (this.tmp[index] === 0 && occupant.type !== MAT.METL && occupant.life > this.temperatures[index]) detected = true;
        else if (this.tmp[index] === 2 && occupant.type !== MAT.METL && occupant.life <= this.temperatures[index]) detected = true;
        else if (this.tmp[index] === 1 && ![MAT.LSNS, MAT.FILT].includes(occupant.type) && occupant.life >= 0) {
          serialized = true;
          serializedValue = 0x10000000 + occupant.life;
        } else if (this.tmp[index] === 3 && occupant.type === MAT.FILT) {
          serialized = true;
          serializedValue = occupant.ctype;
        }
      } else if (type === MAT.VSNS) {
        const speed = Math.hypot(occupant.velocityX, occupant.velocityY, occupant.velocityZ);
        const nonSolid = materialById(occupant.type).state !== "solid";
        if (this.tmp[index] === 0 && nonSolid && speed > this.temperatures[index]) detected = true;
        else if (this.tmp[index] === 2 && nonSolid && speed <= this.temperatures[index]) detected = true;
        else if (this.tmp[index] === 1 && nonSolid && ![MAT.VSNS, MAT.FILT].includes(occupant.type)) {
          serialized = true;
          serializedValue = 0x10000000 + Math.round(speed);
        } else if (this.tmp[index] === 3 && occupant.type === MAT.FILT) {
          const speedValue = occupant.ctype - 0x10000000;
          if (speedValue >= 0 && speedValue < 10000) {
            serialized = true;
            serializedValue = speedValue;
          }
        }
      }
      return false;
    });

    if (detected) this.life[index] = 1;
    if (type === MAT.DTEC && serialized) this.writeAdjacentFilterLines(x, y, z, serializedValue);
    else if (type === MAT.TSNS && this.tmp[index] === 1 && serialized) this.writeAdjacentFilterLines(x, y, z, serializedValue);
    else if (type === MAT.LSNS && serialized) {
      if (this.tmp[index] === 1) this.writeAdjacentFilterLines(x, y, z, serializedValue);
      else if (this.tmp[index] === 3) {
        this.visitNeighbors(x, y, z, 1, (neighbor) => {
          const occupant = this.sensorOccupant(neighbor);
          if (!occupant || occupant.type === MAT.FILT) return false;
          if (occupant.energy) this.energyLife[neighbor] = serializedValue - 0x10000000;
          else this.life[neighbor] = serializedValue - 0x10000000;
          return false;
        });
      }
    } else if (type === MAT.VSNS && serialized) {
      if (this.tmp[index] === 1) this.writeAdjacentFilterLines(x, y, z, serializedValue);
      else if (this.tmp[index] === 3) {
        this.visitNeighbors(x, y, z, 1, (neighbor) => {
          const occupant = this.sensorOccupant(neighbor);
          if (!occupant || occupant.type === MAT.FILT || materialById(occupant.type).state === "solid") return false;
          const magnitude = Math.hypot(occupant.velocityX, occupant.velocityY, occupant.velocityZ);
          if (magnitude <= 0) return false;
          const scale = serializedValue / magnitude;
          if (occupant.energy) {
            this.energyVelocityX[neighbor] *= scale;
            this.energyVelocityY[neighbor] *= scale;
            this.energyVelocityZ[neighbor] *= scale;
          } else {
            this.velocityX[neighbor] *= scale;
            this.velocityY[neighbor] *= scale;
            this.velocityZ[neighbor] *= scale;
          }
          return false;
        });
      }
    }
    return false;
  }

  shiftPistonStack(startX, startY, startZ, dx, dy, dz, amount, maxSize, blockedType = 0, cancelOnObstacle = false) {
    if (amount <= 0 || !this.inBounds(startX, startY, startZ)) return 0;
    const startIndex = this.index(startX, startY, startZ);
    const frameMode = this.types[startIndex] === MAT.FRME;
    const seeds = [startIndex];
    const frameVisited = new Set(seeds);
    if (frameMode) {
      while (seeds.length && frameVisited.size < 225) {
        const frame = seeds.shift();
        const [fx, fy, fz] = this.coords(frame);
        for (const [sx, sy, sz] of DIRECTIONS_6) {
          if (sx * dx + sy * dy + sz * dz !== 0) continue;
          const nx = fx + sx;
          const ny = fy + sy;
          const nz = fz + sz;
          if (!this.inBounds(nx, ny, nz)) continue;
          const neighbor = this.index(nx, ny, nz);
          if (!frameVisited.has(neighbor) && this.types[neighbor] === MAT.FRME) {
            frameVisited.add(neighbor);
            seeds.push(neighbor);
          }
        }
      }
    }

    const lineStarts = frameMode ? [...frameVisited] : [startIndex];
    const tryAmount = (travel, commit) => {
      const moving = new Set();
      for (const lineStart of lineStarts) {
        const [lx, ly, lz] = this.coords(lineStart);
        let spaces = 0;
        let pushed = 0;
        for (let step = 0; step < maxSize + travel; step += 1) {
          const nx = lx + dx * step;
          const ny = ly + dy * step;
          const nz = lz + dz * step;
          if (!this.inBounds(nx, ny, nz)) break;
          const current = this.index(nx, ny, nz);
          const currentType = this.types[current];
          if (blockedType && currentType === blockedType) break;
          if (currentType === MAT.EMPTY) {
            spaces += 1;
            if (spaces >= travel) break;
          } else {
            if (pushed >= maxSize) break;
            moving.add(current);
            pushed += 1;
          }
        }
        if (spaces < travel) return false;
      }
      for (const source of moving) {
        const [sx, sy, sz] = this.coords(source);
        const tx = sx + dx * travel;
        const ty = sy + dy * travel;
        const tz = sz + dz * travel;
        if (!this.inBounds(tx, ty, tz) || !this.wallAllows(this.types[source], tx, ty, tz)) return false;
        const target = this.index(tx, ty, tz);
        if (this.types[target] !== MAT.EMPTY && !moving.has(target)) return false;
      }
      if (!commit) return true;
      const ordered = [...moving].sort((a, b) => {
        const [ax, ay, az] = this.coords(a);
        const [bx, by, bz] = this.coords(b);
        return (bx * dx + by * dy + bz * dz) - (ax * dx + ay * dy + az * dz);
      });
      for (const source of ordered) {
        const [sx, sy, sz] = this.coords(source);
        this.move(source, this.index(sx + dx * travel, sy + dy * travel, sz + dz * travel));
      }
      return true;
    };
    const minimum = cancelOnObstacle ? amount : 1;
    for (let travel = amount; travel >= minimum; travel -= 1) {
      if (tryAmount(travel, false)) {
        tryAmount(travel, true);
        return travel;
      }
    }
    return 0;
  }

  updatePiston(index, x, y, z) {
    if (this.life[index]) return false;
    let state = 0;
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      const axial = Number(nx !== x) + Number(ny !== y) + Number(nz !== z) === 1;
      if (axial && neighborType === MAT.SPRK && this.life[neighbor] === 3) {
        state = this.ctype[neighbor] === MAT.PSCN ? 1 : -1;
        return true;
      }
      return false;
    });
    if (!state) return false;

    for (const [dx, dy, dz] of DIRECTIONS_6) {
      const adjacentX = x + dx;
      const adjacentY = y + dy;
      const adjacentZ = z + dz;
      if (!this.inBounds(adjacentX, adjacentY, adjacentZ) || this.get(adjacentX, adjacentY, adjacentZ) !== MAT.PSTN
        || this.life[this.index(adjacentX, adjacentY, adjacentZ)] !== 0) continue;
      const pistonCells = [];
      let amount = 0;
      let step = 0;
      for (; step < Math.max(this.width, this.height, this.depth); step += 1) {
        const px = x + dx * step;
        const py = y + dy * step;
        const pz = z + dz * step;
        if (!this.inBounds(px, py, pz)) break;
        const piston = this.index(px, py, pz);
        if (this.types[piston] !== MAT.PSTN) break;
        pistonCells.push(piston);
        if (this.life[piston] === 0) amount += Math.max(0, Math.floor((this.temperatures[piston] + 5) / 10));
      }
      if (amount <= 0) continue;
      const endX = x + dx * step;
      const endY = y + dy * step;
      const endZ = z + dz * step;
      const maxSize = this.tmp[index] || 31;
      const armCount = pistonCells.filter((piston) => this.life[piston] > 0).length;
      const armLimit = this.tmp2[index] || 255;
      if (state > 0) {
        if (armCount + amount > armLimit) {
          if (this.tmp3[index] & 0x02) continue;
          amount = armLimit - armCount;
        }
        if (amount <= 0) continue;
        const moved = this.shiftPistonStack(
          endX, endY, endZ, dx, dy, dz, amount, maxSize, this.ctype[index], Boolean(this.tmp3[index] & 0x01),
        );
        if (!moved && this.inBounds(endX, endY, endZ) && this.get(endX, endY, endZ) !== MAT.EMPTY) continue;
        for (let arm = 0; arm < moved; arm += 1) {
          const ax = endX + dx * arm;
          const ay = endY + dy * arm;
          const az = endZ + dz * arm;
          if (!this.inBounds(ax, ay, az) || this.get(ax, ay, az) !== MAT.EMPTY) break;
          this.set(ax, ay, az, MAT.PSTN, this.temperatures[index], 1, { decoration: this.decorations[index] });
          this.processed[this.index(ax, ay, az)] = this.epoch;
        }
      } else {
        if (amount > armCount && (this.tmp3[index] & 0x08)) continue;
        const active = pistonCells.filter((piston) => this.life[piston] > 0).slice(-Math.min(amount, armCount));
        if (!active.length) continue;
        const savedArms = active.map((arm) => ({ arm, state: this.portalParticleState(arm) }));
        for (const arm of active) {
          const [ax, ay, az] = this.coords(arm);
          this.set(ax, ay, az, MAT.EMPTY);
        }
        let moved = active.length;
        if (this.inBounds(endX, endY, endZ) && this.get(endX, endY, endZ) !== MAT.EMPTY) {
          moved = this.shiftPistonStack(
            endX, endY, endZ, -dx, -dy, -dz, active.length, maxSize, this.ctype[index], Boolean(this.tmp3[index] & 0x04),
          );
        }
        if (!moved && (this.tmp3[index] & 0x04)) {
          for (const { arm, state: armState } of savedArms) {
            const [ax, ay, az] = this.coords(arm);
            this.set(ax, ay, az, armState.type, armState.temperature, armState.life, {
              ctype: armState.ctype, tmp: armState.tmp, tmp2: armState.tmp2, tmp3: armState.tmp3, tmp4: armState.tmp4,
              velocityX: armState.velocityX, velocityY: armState.velocityY, velocityZ: armState.velocityZ,
              flags: armState.flags, decoration: armState.decoration,
            });
          }
          continue;
        }
      }
      for (const piston of pistonCells) this.processed[piston] = this.epoch;
      return false;
    }
    return false;
  }

  updateForceRay(index, x, y, z) {
    const length = this.tmp[index] > 0 ? this.tmp[index] : 10;
    const force = this.temperatures[index] / 10;
    for (const [sparkDx, sparkDy, sparkDz] of DIRECTIONS_26) {
      const sx = x + sparkDx;
      const sy = y + sparkDy;
      const sz = z + sparkDz;
      if (!this.inBounds(sx, sy, sz) || this.get(sx, sy, sz) !== MAT.SPRK) continue;
      const dx = -sparkDx;
      const dy = -sparkDy;
      const dz = -sparkDz;
      for (let step = 1; step <= length + 1; step += 1) {
        const nx = x + dx * step;
        const ny = y + dy * step;
        const nz = z + dz * step;
        if (!this.inBounds(nx, ny, nz)) break;
        const target = this.index(nx, ny, nz);
        const matterType = this.types[target];
        if (matterType !== MAT.EMPTY) {
          if (materialById(matterType).state === "solid") continue;
          this.velocityX[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.velocityX[target] + dx * force));
          this.velocityY[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.velocityY[target] + dy * force));
          this.velocityZ[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.velocityZ[target] + dz * force));
        } else if (this.energyTypes[target] !== MAT.EMPTY) {
          this.energyVelocityX[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.energyVelocityX[target] + dx * force));
          this.energyVelocityY[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.energyVelocityY[target] + dy * force));
          this.energyVelocityZ[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.energyVelocityZ[target] + dz * force));
        }
      }
    }
    return false;
  }

  updateRepeller(index, x, y, z) {
    const force = this.temperatures[index] / 10;
    for (let sample = 0; sample <= 10; sample += 1) {
      const dx = Math.floor(this.random() * 21) - 10;
      const dy = Math.floor(this.random() * 21) - 10;
      const dz = Math.floor(this.random() * 21) - 10;
      if ((!dx && !dy && !dz) || !this.inBounds(x + dx, y + dy, z + dz)) continue;
      const target = this.index(x + dx, y + dy, z + dz);
      const matterType = this.types[target];
      if (matterType !== MAT.EMPTY) {
        if (materialById(matterType).state === "solid" || (this.ctype[index] && this.ctype[index] !== matterType)) continue;
        this.velocityX[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.velocityX[target] + Math.sign(dx) * force));
        this.velocityY[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.velocityY[target] + Math.sign(dy) * force));
        this.velocityZ[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.velocityZ[target] + Math.sign(dz) * force));
      } else {
        const energyType = this.energyTypes[target];
        if (energyType === MAT.EMPTY || (this.ctype[index] && this.ctype[index] !== energyType)) continue;
        this.energyVelocityX[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.energyVelocityX[target] + Math.sign(dx) * force));
        this.energyVelocityY[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.energyVelocityY[target] + Math.sign(dy) * force));
        this.energyVelocityZ[target] = Math.max(-MAX_PARTICLE_VELOCITY, Math.min(MAX_PARTICLE_VELOCITY, this.energyVelocityZ[target] + Math.sign(dz) * force));
      }
    }
    return false;
  }

  updateDamageParticle(index, x, y, z) {
    let impact = false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType !== MAT.EMPTY && ![MAT.DMG, MAT.EMBR, MAT.DMND, MAT.CLNE, MAT.PCLN, MAT.BCLN].includes(neighborType)) impact = true;
      return impact;
    });
    if (!impact) return false;
    this.transform(index, MAT.EMPTY, 22, 0);
    const radius = Math.min(25, Math.max(this.width, this.height, this.depth));
    for (let nz = Math.max(0, z - radius); nz <= Math.min(this.depth - 1, z + radius); nz += 1) {
      for (let ny = Math.max(0, y - radius); ny <= Math.min(this.height - 1, y + radius); ny += 1) {
        for (let nx = Math.max(0, x - radius); nx <= Math.min(this.width - 1, x + radius); nx += 1) {
          const dx = nx - x;
          const dy = ny - y;
          const dz = nz - z;
          const distanceSq = dx * dx + dy * dy + dz * dz;
          if (!distanceSq || Math.floor(Math.sqrt(distanceSq)) > radius) continue;
          const target = this.index(nx, ny, nz);
          const targetType = this.types[target];
          if (targetType === MAT.EMPTY) continue;
          const inverse = 7 / Math.sqrt(distanceSq);
          const forceX = dx * inverse;
          const forceY = dy * inverse;
          const forceZ = dz * inverse;
          this.velocityX[target] += forceX;
          this.velocityY[target] += forceY;
          this.velocityZ[target] += forceZ;
          this.air.injectVoxel(nx, ny, nz, 1, 0, forceX, forceY, forceZ);
          const material = materialById(targetType);
          if (material.highPressureTransition != null) this.transform(target, material.highPressureTransition, this.temperatures[target]);
          else if (targetType === MAT.BMTL) this.transform(target, MAT.BRMT, this.temperatures[target]);
          else if (targetType === MAT.GLAS) this.transform(target, MAT.BGLA, this.temperatures[target]);
          else if (targetType === MAT.COAL) this.transform(target, MAT.BCOL, this.temperatures[target]);
          else if (targetType === MAT.QRTZ) this.transform(target, MAT.PQRT, this.temperatures[target]);
          else if (targetType === MAT.TUNG) {
            this.transform(target, MAT.BRMT, this.temperatures[target]);
            this.ctype[target] = MAT.TUNG;
          } else if (targetType === MAT.WOOD) this.transform(target, MAT.SAWD, this.temperatures[target]);
        }
      }
    }
    return true;
  }

  updateGravityBomb(index, x, y, z) {
    if (this.life[index] > 0) return false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType !== MAT.EMPTY && ![MAT.BOMB, MAT.GBMB, MAT.CLNE, MAT.PCLN, MAT.DMND].includes(neighborType)) {
        this.life[index] = 60;
        return true;
      }
      return false;
    });
    return false;
  }

  updateForceElement(index, x, y, z, type) {
    const programmed = this.life[index];
    const factor = type === MAT.ACEL
      ? (programmed !== 0 ? 1 + Math.max(0, Math.min(1000, programmed)) / 100 : 1.1)
      : (programmed !== 0 ? 1 - Math.max(0, Math.min(100, programmed)) / 100 : 1 / 1.1);
    this.tmp[index] = 0;
    for (const [dx, dy, dz] of DIRECTIONS_6) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const target = this.index(nx, ny, nz);
      const matterType = this.types[target];
      const matterMovable = matterType !== MAT.EMPTY && materialById(matterType).state !== "solid";
      if (matterType !== MAT.EMPTY) {
        if (!matterMovable) continue;
        let vx = this.velocityX[target] * factor;
        let vy = this.velocityY[target] * factor;
        let vz = this.velocityZ[target] * factor;
        if (type === MAT.ACEL) {
          const maximum = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz));
          if (maximum > MAX_PARTICLE_VELOCITY) {
            const scale = MAX_PARTICLE_VELOCITY / maximum;
            vx *= scale;
            vy *= scale;
            vz *= scale;
          }
        }
        this.velocityX[target] = vx;
        this.velocityY[target] = vy;
        this.velocityZ[target] = vz;
        this.tmp[index] = 1;
      } else if (this.energyTypes[target] !== MAT.EMPTY) {
        let vx = this.energyVelocityX[target] * factor;
        let vy = this.energyVelocityY[target] * factor;
        let vz = this.energyVelocityZ[target] * factor;
        if (type === MAT.ACEL) {
          const maximum = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz));
          if (maximum > MAX_PARTICLE_VELOCITY) {
            const scale = MAX_PARTICLE_VELOCITY / maximum;
            vx *= scale;
            vy *= scale;
            vz *= scale;
          }
        }
        this.energyVelocityX[target] = vx;
        this.energyVelocityY[target] = vy;
        this.energyVelocityZ[target] = vz;
        this.tmp[index] = 1;
      }
    }
    return false;
  }

  updateDelay(index, x, y, z) {
    const oldLife = this.life[index];
    if (this.life[index] > 0) this.life[index] -= 1;
    this.temperatures[index] = Math.max(1, this.temperatures[index]);
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (this.insulationBetween(index, neighbor)) return false;
      if (neighborType === MAT.SPRK && this.life[index] === 0 && this.life[neighbor] > 0 && this.life[neighbor] < 4 && this.ctype[neighbor] === MAT.PSCN) {
        this.life[index] = Math.max(1, Math.min(65535, Math.round(this.temperatures[index])));
      } else if (neighborType === MAT.DLAY) {
        if (this.life[index] === 0 && this.life[neighbor] > 0) {
          this.life[index] = this.life[neighbor];
          if (neighbor > index) this.life[index] -= 1;
        } else if (this.life[index] > 0 && this.life[neighbor] === 0) {
          this.life[neighbor] = this.life[index];
          if (neighbor > index) this.life[neighbor] += 1;
        }
      } else if (neighborType === MAT.NSCN && oldLife === 1 && this.life[neighbor] === 0) {
        this.spark(neighbor, MAT.NSCN, 4);
      }
      return false;
    });
    return false;
  }

  updateThermistor(index) {
    if (this.temperatures[index] > 21.85) this.temperatures[index] = Math.max(21.85, this.temperatures[index] - 2.5);
    return false;
  }

  updatePoweredElement(index, x, y, z, type) {
    if (type === MAT.LCRY) {
      let check;
      let setTo;
      if (this.tmp[index] === 1) {
        if (this.life[index] <= 0) this.tmp[index] = 0;
        else {
          this.life[index] = Math.max(0, this.life[index] - 2);
          this.tmp2[index] = this.life[index];
        }
        check = 3;
        setTo = 1;
      } else if (this.tmp[index] === 0) {
        check = 3;
        setTo = 1;
      } else if (this.tmp[index] === 2) {
        if (this.life[index] >= 10) this.tmp[index] = 3;
        else {
          this.life[index] = Math.min(10, this.life[index] + 2);
          this.tmp2[index] = this.life[index];
        }
        check = 0;
        setTo = 2;
      } else if (this.tmp[index] === 3) {
        check = 0;
        setTo = 2;
      } else {
        this.tmp[index] = 0;
        this.life[index] = 0;
        this.tmp2[index] = 0;
        return false;
      }
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType === MAT.LCRY && this.tmp[neighbor] === check) this.tmp[neighbor] = setTo;
        return false;
      });
      return false;
    }
    if (this.life[index] !== 10) {
      if (this.life[index] > 0) this.life[index] -= 1;
      return false;
    }
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
      if (neighborType !== type) return false;
      if (this.life[neighbor] > 0 && this.life[neighbor] < 10) this.life[index] = 9;
      else if (this.life[neighbor] === 0) this.life[neighbor] = 10;
      return false;
    });
    if (type === MAT.PUMP) {
      this.temperatures[index] = Math.max(-256, Math.min(256, this.temperatures[index]));
      if (this.tmp[index] === 1) {
        this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
          if (neighborType !== MAT.FILT) return false;
          const pressure = this.ctype[neighbor] - 0x10000000;
          if (pressure >= 0 && pressure <= 512) this.air.pressure[this.air.indexForVoxel(nx, ny, nz)] = pressure - 256;
          return false;
        });
      } else {
        const [cx, cy, cz] = this.air.cellForVoxel(x, y, z);
        for (const [dx, dy, dz] of [[0, 0, 0], ...DIRECTIONS_6]) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nz = cz + dz;
          if (!this.air.inBounds(nx, ny, nz)) continue;
          const airIndex = this.air.index(nx, ny, nz);
          this.air.pressure[airIndex] += 0.1 * (this.temperatures[index] - this.air.pressure[airIndex]);
        }
      }
    } else if (type === MAT.HSWC) {
      if (this.tmp[index] === 1) this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType !== MAT.FILT) return false;
        const temperatureKelvin = this.ctype[neighbor] - 0x10000000;
        if (temperatureKelvin >= 0 && temperatureKelvin <= 9999) this.temperatures[index] = temperatureKelvin - 273.15;
        return false;
      });
    } else if (type === MAT.GPMP) {
      this.temperatures[index] = Math.max(-256, Math.min(256, this.temperatures[index]));
    }
    return false;
  }

  updateSingularity(index, x, y, z) {
    const targetPressure = -this.life[index];
    const [cx, cy, cz] = this.air.cellForVoxel(x, y, z);
    for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (!this.air.inBounds(nx, ny, nz)) continue;
      const airIndex = this.air.index(nx, ny, nz);
      this.air.pressure[airIndex] = Math.max(-256, Math.min(256,
        this.air.pressure[airIndex] + 0.1 * (targetPressure - this.air.pressure[airIndex])));
    }
    if (this.life[index] < 1) {
      const mass = Math.abs(this.tmp[index]);
      const spawnCount = mass > 255 ? 3019 : Math.floor((Math.floor(mass / 8) ** 2) * Math.PI);
      for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        if (!this.air.inBounds(nx, ny, nz)) continue;
        const airIndex = this.air.index(nx, ny, nz);
        this.air.pressure[airIndex] = Math.max(-256, Math.min(256, this.air.pressure[airIndex] + this.tmp[index]));
      }
      this.transform(index, MAT.EMPTY, 22, 0);
      this.emitSingularityBurst(x, y, z, spawnCount);
      return true;
    }
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY || neighborType === MAT.DMND || this.random() >= 1 / 3) return false;
      if (neighborType === MAT.SING && this.life[neighbor] > 10) {
        if (this.life[index] + this.life[neighbor] > 255) return false;
        this.life[index] += this.life[neighbor];
      } else {
        if (this.life[index] + 3 > 255) {
          if (neighborType !== MAT.SING && this.random() < 1 / 1000) {
            this.transform(neighbor, MAT.SING, 22, 60 + Math.floor(this.random() * 50));
          }
          return false;
        }
        this.life[index] += 3;
        this.tmp[index] += 1;
      }
      this.temperatures[index] = Math.max(-273.15, Math.min(9725.85,
        this.temperatures[index] + this.temperatures[neighbor]));
      this.transform(neighbor, MAT.EMPTY, 22, 0);
      return false;
    });
    return false;
  }

  emitSingularityBurst(x, y, z, spawnCount) {
    let emitted = 0;
    const maxRadius = Math.max(this.width, this.height, this.depth);
    for (let radius = 0; radius < maxRadius && emitted < spawnCount; radius += 1) {
      const candidates = [];
      for (let dz = -radius; dz <= radius; dz += 1) for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz)) candidates.push([nx, ny, nz]);
      }
      const offset = candidates.length ? Math.floor(this.random() * candidates.length) : 0;
      for (let n = 0; n < candidates.length && emitted < spawnCount; n += 1) {
        const [nx, ny, nz] = candidates[(n + offset) % candidates.length];
        const particleIndex = this.index(nx, ny, nz);
        if (this.energyTypes[particleIndex] !== MAT.EMPTY || !this.wallAllows(MAT.PHOT, nx, ny, nz)) continue;
        const type = [MAT.PHOT, MAT.NEUT, MAT.ELEC][Math.floor(this.random() * 3)];
        const life = Math.floor(this.random() * 300);
        const azimuth = this.random() * Math.PI * 2;
        const vertical = this.random() * 2 - 1;
        const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
        const speed = this.random() * 5;
        this.setEnergy(nx, ny, nz, type, 4726.35, life, {
          velocityX: radial * Math.cos(azimuth) * speed,
          velocityY: vertical * speed,
          velocityZ: radial * Math.sin(azimuth) * speed,
        });
        this.energyProcessed[particleIndex] = this.epoch;
        emitted += 1;
      }
    }
    return emitted;
  }

  updateAntimatter(index, x, y, z) {
    let destroyed = false;
    this.visitNeighbors(x, y, z, 1, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY || ANTIMATTER_IMMUNE.has(neighborType)) return false;
      this.life[index] += 1;
      if (this.life[index] === 4) {
        this.transform(index, MAT.EMPTY, 22, 0);
        destroyed = true;
        return true;
      }
      const photon = this.random() < 0.1;
      this.transform(neighbor, MAT.EMPTY, 22, 0);
      if (photon) {
        this.setEnergy(nx, ny, nz, MAT.PHOT);
        this.energyProcessed[neighbor] = this.epoch;
      }
      this.air.injectVoxel(x, y, z, -2, 0);
      return false;
    });
    return destroyed;
  }

  detonateBomb(cx, cy, cz) {
    this.activity.explosions += 1;
    const preserve = new Set([MAT.DMND, MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.VIBR]);
    const innerRadius = 8;
    for (let z = Math.max(0, cz - innerRadius); z <= Math.min(this.depth - 1, cz + innerRadius); z += 1) {
      for (let y = Math.max(0, cy - innerRadius); y <= Math.min(this.height - 1, cy + innerRadius); y += 1) {
        for (let x = Math.max(0, cx - innerRadius); x <= Math.min(this.width - 1, cx + innerRadius); x += 1) {
          const distanceSq = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (distanceSq > innerRadius * innerRadius) continue;
          const index = this.index(x, y, z);
          const type = this.types[index];
          if (preserve.has(type)) continue;
          this.set(x, y, z, MAT.EMBR, 9725.85, 2, { tmp: 2 });
          this.processed[index] = this.epoch;
          this.air.injectVoxel(x, y, z, 0.1, 0);
        }
      }
    }
    const outerRadius = innerRadius + 1;
    for (let z = Math.max(0, cz - outerRadius); z <= Math.min(this.depth - 1, cz + outerRadius); z += 1) {
      for (let y = Math.max(0, cy - outerRadius); y <= Math.min(this.height - 1, cy + outerRadius); y += 1) {
        for (let x = Math.max(0, cx - outerRadius); x <= Math.min(this.width - 1, cx + outerRadius); x += 1) {
          const distanceSq = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (distanceSq > outerRadius * outerRadius) continue;
          const index = this.index(x, y, z);
          if (this.types[index] !== MAT.EMPTY) continue;
          this.set(x, y, z, MAT.EMBR, 9725.85, 50, {
            velocityX: Math.floor(this.random() * 41) - 20,
            velocityY: Math.floor(this.random() * 41) - 20,
            velocityZ: Math.floor(this.random() * 41) - 20,
          });
          this.processed[index] = this.epoch;
        }
      }
    }
    return true;
  }

  createLightningLine(sourceIndex, x, y, z, azimuth, elevation, life, state) {
    const yaw = azimuth * Math.PI / 180;
    const pitch = elevation * Math.PI / 180;
    const length = Math.max(1, Math.floor(life * 1.5 + this.random() * (life + 1)));
    const vx = Math.cos(yaw) * Math.cos(pitch);
    const vy = -Math.sin(yaw) * Math.cos(pitch);
    const vz = Math.sin(pitch);
    const decoration = this.decorations[sourceIndex];
    const seen = new Set();
    let created = 0;
    for (let step = 1; step <= length; step += 1) {
      const nx = Math.round(x + vx * step);
      const ny = Math.round(y + vy * step);
      const nz = Math.round(z + vz * step);
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.inBounds(nx, ny, nz) || !this.wallAllows(MAT.LIGH, nx, ny, nz)) break;
      const target = this.index(nx, ny, nz);
      const targetType = this.types[target];
      if ([MAT.BHOL, MAT.NBHL].includes(targetType)
        || ([MAT.VOID, MAT.PVOD].includes(targetType) && this.holeAccepts(target, MAT.LIGH))) break;
      if (targetType !== MAT.EMPTY) continue;
      const last = step === length;
      const nextLife = last ? Math.max(0, Math.floor(life / 1.5 - Math.floor(this.random() * 2))) : life;
      let nextState = 7;
      if (last && nextLife > 1) nextState = this.random() < 0.7 ? 2 : 0;
      this.set(nx, ny, nz, MAT.LIGH, this.temperatures[sourceIndex], nextLife, {
        tmp: Math.round(azimuth), tmp2: nextState, tmp3: Math.round(elevation), decoration,
      });
      this.processed[target] = this.epoch;
      created += 1;
    }
    return created;
  }

  updateLightning(index, x, y, z) {
    const life = this.life[index];
    const power = Math.max(0, Math.floor((this.temperatures[index] + 273.15) * (1 + life / 40) * 0.65));
    if (this.air.ambientHeatEnabled) {
      const airIndex = this.air.indexForVoxel(x, y, z);
      this.air.ambientHeat[airIndex] = Math.min(9725.85, this.air.ambientHeat[airIndex] + power / 50);
    }
    let exposed = false;
    this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
      if (neighborType === MAT.EMPTY) exposed = true;
      return false;
    });
    this.visitNeighbors(x, y, z, 2, (neighbor, neighborType, nx, ny, nz) => {
      if (neighborType === MAT.EMPTY || neighborType === MAT.LIGH || neighborType === MAT.TESC) return false;
      const material = materialById(neighborType);
      const flammability = UPSTREAM_FLAMMABILITY.get(neighborType) ?? 0;
      const neighborPressure = this.air.sampleVoxel(nx, ny, nz).pressure;
      const ignitionChance = Math.max(0, Math.min(1,
        Math.trunc(flammability + neighborPressure * 10) / 1000));
      if ((exposed || material.explosive) && (neighborType !== MAT.SPNG || this.life[neighbor] === 0)
        && flammability > 0 && this.random() < ignitionChance) {
        this.changeTypePreserve(neighbor, MAT.FIRE);
        this.temperatures[neighbor] = Math.max(-273.15, Math.min(9725.85,
          materialById(MAT.FIRE).defaultTemp + flammability / 2));
        this.life[neighbor] = 180 + Math.floor(this.random() * 80);
        this.tmp[neighbor] = 0;
        this.ctype[neighbor] = 0;
        if (material.explosive) this.air.injectVoxel(x, y, z, 0.25, 0);
        return false;
      }
      if ([MAT.CLNE, MAT.THDR, MAT.DMND, MAT.FIRE].includes(neighborType)) {
        this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + power / 10);
        return false;
      }
      if (neighborType === MAT.DEUT || neighborType === MAT.PLUT) {
        this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + power);
        this.air.injectVoxel(x, y, z, power / 35, 0);
        if (this.random() < 1 / 3) {
          const temperature = this.temperatures[neighbor];
          this.transform(neighbor, MAT.EMPTY, 22, 0);
          this.setEnergy(nx, ny, nz, MAT.NEUT, temperature, 480 + Math.floor(this.random() * 480), {
            velocityX: Math.floor(this.random() * 11) - 5,
            velocityY: Math.floor(this.random() * 11) - 5,
            velocityZ: Math.floor(this.random() * 11) - 5,
          });
        }
        return false;
      }
      if ((neighborType === MAT.COAL || neighborType === MAT.BCOL) && this.life[neighbor] > 100) this.life[neighbor] = 99;
      if (ACTOR_TYPES.has(neighborType) && this.ctype[neighbor] !== MAT.LIGH) this.life[neighbor] -= Math.floor(power / 100);
      if (neighborType === MAT.HEAC) {
        this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + power / 10);
        if (this.temperatures[neighbor] > material.highTemperature) {
          this.transform(neighbor, MAT.LAVA, this.temperatures[neighbor]);
          this.ctype[neighbor] = MAT.HEAC;
          return false;
        }
      }
      if (isConductor(this.types[neighbor]) && this.life[neighbor] === 0) this.spark(neighbor, this.types[neighbor], 4);
      this.air.injectVoxel(x, y, z, power / 400, 0);
      const activeMaterial = materialById(this.types[neighbor]);
      const heatInsulator = activeMaterial.conductivity <= 0
        || (this.types[neighbor] === MAT.HSWC && this.life[neighbor] !== 10)
        || ([MAT.PIPE, MAT.PPIP].includes(this.types[neighbor]) && (this.tmp[neighbor] & 1) === 0);
      if (!heatInsulator) this.temperatures[neighbor] = Math.min(9725.85, this.temperatures[neighbor] + power / 1.3);
      return false;
    });

    let state = this.tmp2[index];
    if (state === 1 || state === 3 || (state >= 6 && state <= 8)) {
      this.tmp2[index] -= 1;
      return false;
    }
    if (state === 5 || life <= 1) {
      this.transform(index, MAT.EMPTY, 22, 0);
      return true;
    }
    const azimuth = this.tmp[index] + Math.floor(this.random() * 61) - 30;
    const elevation = Math.max(-85, Math.min(85, this.tmp3[index] + Math.floor(this.random() * 41) - 20));
    this.createLightningLine(index, x, y, z, azimuth, elevation, life, state);
    if (state === 2) {
      const branchAzimuth = azimuth + Math.floor(this.random() * 201) - 100;
      const branchElevation = Math.max(-85, Math.min(85, elevation + Math.floor(this.random() * 141) - 70));
      this.createLightningLine(index, x, y, z, branchAzimuth, branchElevation, life, state);
    }
    this.tmp2[index] = 7;
    return false;
  }

  floodBangState(startIndex, state = 2) {
    if (startIndex < 0 || startIndex >= this.size || this.types[startIndex] !== MAT.BANG) return 0;
    const queue = [startIndex];
    const visited = new Set([startIndex]);
    let changed = 0;
    while (queue.length) {
      const current = queue.pop();
      if (this.types[current] !== MAT.BANG) continue;
      this.tmp[current] = state;
      changed += 1;
      const [x, y, z] = this.coords(current);
      for (const [dx, dy, dz] of DIRECTIONS_6) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (!visited.has(neighbor) && this.types[neighbor] === MAT.BANG) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return changed;
  }

  updateExplosiveElement(index, x, y, z, type) {
    if (type === MAT.THDR) {
      let discharged = false;
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (isConductor(neighborType) && this.life[neighbor] === 0
          && ![MAT.WATR, MAT.SLTW].includes(neighborType) && this.ctype[neighbor] !== MAT.SPRK) {
          this.spark(neighbor, neighborType, 4);
          discharged = true;
        } else if (neighborType !== MAT.EMPTY && ![MAT.CLNE, MAT.THDR, MAT.SPRK, MAT.DMND, MAT.FIRE].includes(neighborType)) {
          this.air.injectVoxel(x, y, z, 100, 0);
          discharged = true;
        }
        return false;
      });
      if (discharged) {
        this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      }
      return false;
    }
    if (type === MAT.BOMB) {
      let impact = false;
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        if (neighborType !== MAT.EMPTY && ![MAT.BOMB, MAT.EMBR, MAT.DMND, MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.VIBR].includes(neighborType)) impact = true;
        return false;
      });
      if (impact) {
        return this.detonateBomb(x, y, z);
      }
      return false;
    }
    if (type === MAT.DEST) {
      const dx = Math.floor(this.random() * 5) - 2;
      const dy = Math.floor(this.random() * 5) - 2;
      const dz = Math.floor(this.random() * 5) - 2;
      const tx = x + dx;
      const ty = y + dy;
      const tz = z + dz;
      if (!this.inBounds(tx, ty, tz)) return false;
      const target = this.index(tx, ty, tz);
      const targetType = this.types[target];
      if (targetType === MAT.EMPTY || [MAT.DEST, MAT.DMND, MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.PBCN].includes(targetType)) return false;
      if (this.life[index] <= 0 || this.life[index] > 37) {
        this.life[index] = 30 + Math.floor(this.random() * 20);
        this.air.injectVoxel(x, y, z, 60, 0);
      }
      if (targetType === MAT.PLUT || targetType === MAT.DEUT) {
        this.air.injectVoxel(x, y, z, 20, 0);
        if (this.random() < 0.5) {
          this.set(tx, ty, tz, MAT.EMPTY);
          this.setEnergy(tx, ty, tz, MAT.NEUT, 9725.85);
          this.energyProcessed[target] = this.epoch;
          this.air.injectVoxel(x, y, z, 10, 0);
          this.life[index] -= 4;
        }
      } else if (targetType === MAT.INSL) {
        this.set(tx, ty, tz, MAT.PLSM);
        this.processed[target] = this.epoch;
      } else if (this.random() < 1 / 3) {
        this.set(tx, ty, tz, MAT.EMPTY);
        this.life[index] -= materialById(targetType).state === "solid" ? 12 : 4;
        if (this.life[index] <= 0) this.life[index] = 1;
      } else {
        const material = materialById(targetType);
        const heatInsulator = material.conductivity === 0
          || (targetType === MAT.HSWC && this.life[target] !== 10)
          || ([MAT.PIPE, MAT.PPIP].includes(targetType) && (this.tmp[target] & PIPE_FLAG.CAN_CONDUCT) === 0);
        if (!heatInsulator) this.temperatures[target] = 9725.85;
      }
      this.temperatures[index] = 9725.85;
      this.air.injectVoxel(x, y, z, 80, 0);
      return false;
    }
    if (type === MAT.THRM) return false;
    if (type === MAT.FUSE || type === MAT.FSEP) {
      if (this.life[index] <= 0) {
        this.set(x, y, z, MAT.PLSM, materialById(MAT.PLSM).defaultTemp, 50);
        this.processed[index] = this.epoch;
        return true;
      }
      if (this.life[index] < 40) {
        this.life[index] -= 1;
        if (this.random() < (type === MAT.FSEP ? 0.1 : 0.01)) {
          const nx = x + Math.floor(this.random() * 3) - 1;
          const ny = y + Math.floor(this.random() * 3) - 1;
          const nz = z + Math.floor(this.random() * 3) - 1;
          if (this.inBounds(nx, ny, nz)) {
            const plasma = this.index(nx, ny, nz);
            if (this.types[plasma] === MAT.EMPTY && this.wallAllows(MAT.PLSM, nx, ny, nz)) {
              this.set(nx, ny, nz, MAT.PLSM, materialById(MAT.PLSM).defaultTemp, 50);
              this.processed[plasma] = this.epoch;
            }
          }
        }
      }
      if (type === MAT.FSEP && this.life[index] >= 40) {
        this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
          if ((neighborType === MAT.SPRK || this.temperatures[index] >= 400) && this.life[index] > 40 && this.random() < 1 / 15) this.life[index] = 39;
          return false;
        });
      }
      if (type === MAT.FUSE && this.air.sampleVoxel(x, y, z).pressure > 2.7 && this.tmp[index] > 40) this.tmp[index] = 39;
      else if (type === MAT.FUSE && this.tmp[index] <= 0) {
        this.set(x, y, z, MAT.FSEP);
        this.processed[index] = this.epoch;
        return true;
      } else if (type === MAT.FUSE && this.tmp[index] < 40) this.tmp[index] -= 1;
      if (type === MAT.FUSE) this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (this.life[index] <= 40) return false;
        if (neighborType === MAT.SPRK || (this.temperatures[index] >= 700 && this.random() < 1 / 20)) this.life[index] = 39;
        return false;
      });
      return false;
    }
    if (type === MAT.C5) {
      let detonated = false;
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        const heatInsulator = neighborType !== MAT.EMPTY && (materialById(neighborType).conductivity === 0
          || (neighborType === MAT.HSWC && this.life[neighbor] !== 10)
          || ([MAT.PIPE, MAT.PPIP].includes(neighborType) && (this.tmp[neighbor] & PIPE_FLAG.CAN_CONDUCT) === 0));
        const cold = neighborType !== MAT.EMPTY && neighborType !== MAT.C5
          && this.temperatures[neighbor] < -173.15 && !heatInsulator;
        if ((cold || neighborType === MAT.CFLM) && this.random() < 1 / 6) {
          this.changeTypePreserve(index, MAT.CFLM);
          this.temperatures[neighbor] = -273.15;
          this.temperatures[index] = -273.15;
          this.life[index] = 50 + Math.floor(this.random() * 150);
          this.air.injectVoxel(x, y, z, 1.5, 0);
          detonated = true;
        }
        return false;
      });
      if (this.ctype[index] && !this.life[index]) {
        const storedWavelength = this.ctype[index];
        const velocityX = unpackVelocityLow(this.tmp[index]);
        const velocityY = unpackVelocityHigh(this.tmp[index]);
        const velocityZ = unpackVelocityLow(this.tmp3[index]);
        if (this.energyTypes[index] === MAT.EMPTY) {
          this.setEnergy(x, y, z, MAT.PHOT, this.temperatures[index], undefined, {
            ctype: storedWavelength, velocityX, velocityY, velocityZ,
          });
          this.energyProcessed[index] = this.epoch;
        }
        this.ctype[index] = 0;
        this.tmp[index] = 0;
        this.tmp2[index] = 0;
        this.tmp3[index] = 0;
      }
      return detonated;
    }
    if (type === MAT.BANG) {
      if (this.tmp[index] === 0) {
        if (this.temperatures[index] >= 399.85) this.tmp[index] = 1;
        else this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
          if ([MAT.FIRE, MAT.PLSM, MAT.SPRK, MAT.LIGH].includes(neighborType)) this.tmp[index] = 1;
          return false;
        });
      } else if (this.tmp[index] === 1) {
        this.floodBangState(index, 2);
      } else if (this.tmp[index] === 2) this.tmp[index] = 3;
      else {
        const sourceTemperature = this.temperatures[index];
        this.air.injectVoxel(x, y, z, 0.5, 0);
        this.activity.explosions += 1;
        if (this.random() < 1 / 3) {
          const product = this.random() < 0.5 ? MAT.FIRE : MAT.SMKE;
          const productLife = product === MAT.FIRE
            ? 120 + Math.floor(this.random() * 50)
            : 500 + Math.floor(this.random() * 50);
          const productTemperature = Math.max(-273.15, Math.min(9725.85, sourceTemperature + 2226.6));
          this.transform(index, product, productTemperature, productLife);
        } else if (this.random() < 1 / 15) {
          const productTemperature = Math.max(-273.15, Math.min(9725.85, sourceTemperature + 3059.85));
          this.transform(index, MAT.EMBR, productTemperature, 50);
          this.tmp[index] = 0;
          this.velocityX[index] = Math.floor(this.random() * 21) - 10;
          this.velocityY[index] = Math.floor(this.random() * 21) - 10;
          this.velocityZ[index] = Math.floor(this.random() * 21) - 10;
        } else this.transform(index, MAT.EMPTY, 22, 0);
        return true;
      }
      return false;
    }
    if (type === MAT.IGNT) {
      if (this.tmp[index] === 0) {
        this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
          if ([MAT.FIRE, MAT.PLSM, MAT.SPRK, MAT.LIGH].includes(neighborType)
            || (neighborType === MAT.IGNT && this.life[neighbor] === 1)) this.tmp[index] = 1;
          return false;
        });
      } else if (this.life[index] > 0) {
        const ember = this.random() < 2 / 3;
        const nx = x + Math.floor(this.random() * 3) - 1;
        const ny = y + Math.floor(this.random() * 3) - 1;
        const nz = z + Math.floor(this.random() * 3) - 1;
        if (this.inBounds(nx, ny, nz)) {
          const target = this.index(nx, ny, nz);
          if (this.types[target] === MAT.EMPTY && this.wallAllows(ember ? MAT.EMBR : MAT.FIRE, nx, ny, nz)) {
            if (ember) {
              this.set(nx, ny, nz, MAT.EMBR, Math.max(-273.15, Math.min(9725.85, this.temperatures[index] + 126.85)), 30, {
                tmp: 0,
                velocityX: Math.floor(this.random() * 21) - 10,
                velocityY: Math.floor(this.random() * 21) - 10,
                velocityZ: Math.floor(this.random() * 21) - 10,
              });
            } else {
              this.set(nx, ny, nz, MAT.FIRE, materialById(MAT.FIRE).defaultTemp, 120 + Math.floor(this.random() * 50));
            }
            this.processed[target] = this.epoch;
          }
        }
        this.life[index] -= 1;
      }
      return false;
    }
    if (type === MAT.LIGH) {
      return this.updateLightning(index, x, y, z);
    }
    return false;
  }

  applyAutomaticLifeDecay() {
    const customLife = new Set([MAT.FIRE, MAT.PLSM, MAT.WTRV, MAT.SPRK, MAT.SWCH, MAT.FUSE, MAT.FSEP, MAT.LIGH]);
    for (let index = 0; index < this.size; index += 1) {
      const type = this.types[index];
      if (type === MAT.EMPTY || customLife.has(type)) continue;
      const properties = materialById(type).properties;
      if (this.life[index] > 0 && properties.includes("PROP_LIFE_DEC")) {
        this.life[index] -= 1;
        if (this.life[index] <= 0 && (properties.includes("PROP_LIFE_KILL_DEC") || properties.includes("PROP_LIFE_KILL"))) this.transform(index, MAT.EMPTY, 22, 0);
      } else if (this.life[index] <= 0 && properties.includes("PROP_LIFE_KILL") && !properties.includes("PROP_LIFE_KILL_DEC")) {
        this.transform(index, MAT.EMPTY, 22, 0);
      }
    }
  }

  storeParticleInPipe(pipeIndex, particleIndex, storedType, storage = false) {
    const sourceEnergy = this.energyTypes[particleIndex] === storedType;
    if (!sourceEnergy && storedType === MAT.SOAP) this.detachSoap(particleIndex);
    if (storage) this.tmp[pipeIndex] = storedType;
    else this.ctype[pipeIndex] = storedType;
    this.temperatures[pipeIndex] = sourceEnergy ? this.energyTemperatures[particleIndex] : this.temperatures[particleIndex];
    this.tmp2[pipeIndex] = sourceEnergy ? this.energyLife[particleIndex] : this.life[particleIndex];
    this.tmp3[pipeIndex] = sourceEnergy ? this.energyTmp[particleIndex] : this.tmp[particleIndex];
    this.tmp4[pipeIndex] = sourceEnergy ? this.energyCtype[particleIndex] : this.ctype[particleIndex];
    const decoration = sourceEnergy ? this.energyDecorations[particleIndex] : this.decorations[particleIndex];
    if (decoration && !this.decorations[pipeIndex]) {
      this.decorations[pipeIndex] = decoration;
      if (!storage) this.tmp[pipeIndex] |= PIPE_FLAG.PARTICLE_DECO;
    }
    if (sourceEnergy) this.killEnergy(particleIndex);
    else this.transform(particleIndex, MAT.EMPTY, 22, 0);
    this.flags[pipeIndex] = 1;
  }

  emitStoredParticle(pipeIndex, x, y, z, storage = false) {
    const storedType = storage ? this.tmp[pipeIndex] : this.ctype[pipeIndex];
    if (!storedType || !materialById(storedType).enabled) return false;
    for (const [dx, dy, dz] of DIRECTIONS_26) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz) || !this.wallAllows(storedType, nx, ny, nz)) continue;
      const target = this.index(nx, ny, nz);
      const particleDecoration = storage || (this.tmp[pipeIndex] & PIPE_FLAG.PARTICLE_DECO) ? this.decorations[pipeIndex] : 0;
      const properties = { ctype: this.tmp4[pipeIndex], tmp: this.tmp3[pipeIndex], decoration: particleDecoration };
      if (materialById(storedType).state === "energy") {
        if (this.energyTypes[target] !== MAT.EMPTY) continue;
        this.setEnergy(nx, ny, nz, storedType, this.temperatures[pipeIndex], this.tmp2[pipeIndex], properties);
        this.energyTemperatures[target] = this.temperatures[pipeIndex];
        this.energyLife[target] = this.tmp2[pipeIndex];
        this.energyTmp[target] = this.tmp3[pipeIndex];
        this.energyCtype[target] = this.tmp4[pipeIndex];
        this.energyProcessed[target] = this.epoch;
      } else {
        if (this.types[target] !== MAT.EMPTY) continue;
        this.set(nx, ny, nz, storedType, this.temperatures[pipeIndex], this.tmp2[pipeIndex], properties);
        this.temperatures[target] = this.temperatures[pipeIndex];
        this.life[target] = this.tmp2[pipeIndex];
        this.tmp[target] = this.tmp3[pipeIndex];
        this.ctype[target] = this.tmp4[pipeIndex];
        this.processed[target] = this.epoch;
      }
      if (storage) this.tmp[pipeIndex] = 0;
      else this.ctype[pipeIndex] = 0;
      this.tmp2[pipeIndex] = 0;
      this.tmp3[pipeIndex] = 0;
      this.tmp4[pipeIndex] = 0;
      if (storage || (this.tmp[pipeIndex] & PIPE_FLAG.PARTICLE_DECO)) this.decorations[pipeIndex] = 0;
      if (!storage) this.tmp[pipeIndex] &= ~PIPE_FLAG.PARTICLE_DECO;
      this.flags[pipeIndex] = 0;
      return true;
    }
    return false;
  }

  pipeNextColor(color) {
    if (color === PIPE_FLAG.COLOR_RED) return PIPE_FLAG.COLOR_BLUE;
    if (color === PIPE_FLAG.COLOR_BLUE) return PIPE_FLAG.COLOR_GREEN;
    return PIPE_FLAG.COLOR_RED;
  }

  pipePreviousColor(color) {
    if (color === PIPE_FLAG.COLOR_RED) return PIPE_FLAG.COLOR_GREEN;
    if (color === PIPE_FLAG.COLOR_GREEN) return PIPE_FLAG.COLOR_BLUE;
    return PIPE_FLAG.COLOR_RED;
  }

  initializePipeNetwork(startIndex) {
    if (![MAT.PIPE, MAT.PPIP].includes(this.types[startIndex])) return 0;
    const component = [];
    const queue = [startIndex];
    const visited = new Set([startIndex]);
    while (queue.length) {
      const index = queue.shift();
      component.push(index);
      const [x, y, z] = this.coords(index);
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (visited.has(neighbor) || ![MAT.PIPE, MAT.PPIP].includes(this.types[neighbor])) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    let seed = component.find((index) => (this.tmp[index] & PIPE_FLAG.COLORS) !== 0);
    if (seed == null) seed = Math.min(...component);
    const colors = new Map([[seed, (this.tmp[seed] & PIPE_FLAG.COLORS) || PIPE_FLAG.COLOR_RED]]);
    queue.push(seed);
    const colored = new Set();
    while (queue.length) {
      const index = queue.shift();
      if (colored.has(index)) continue;
      colored.add(index);
      const color = colors.get(index) || PIPE_FLAG.COLOR_RED;
      this.tmp[index] = (this.tmp[index] & ~PIPE_FLAG.COLORS) | color;
      this.life[index] = Math.min(this.life[index], 6);
      const [x, y, z] = this.coords(index);
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (!visited.has(neighbor) || colored.has(neighbor)) continue;
        if (!colors.has(neighbor)) colors.set(neighbor, this.pipeNextColor(color));
        queue.push(neighbor);
      }
    }
    return component.length;
  }

  triggerPipeNetwork(startIndex, sparkedBy) {
    if (this.types[startIndex] !== MAT.PPIP && sparkedBy !== MAT.HEAC) return 0;
    const queue = [startIndex];
    const visited = new Set([startIndex]);
    let changed = 0;
    while (queue.length) {
      const index = queue.pop();
      const type = this.types[index];
      if (sparkedBy === MAT.HEAC) this.tmp[index] |= PIPE_FLAG.CAN_CONDUCT;
      else if (sparkedBy === MAT.PSCN) this.tmp[index] &= ~PIPE_FLAG.PAUSED;
      else if (sparkedBy === MAT.NSCN) this.tmp[index] |= PIPE_FLAG.PAUSED;
      else if (sparkedBy === MAT.INST) this.tmp[index] ^= PIPE_FLAG.REVERSED;
      else continue;
      changed += 1;
      const [x, y, z] = this.coords(index);
      for (const [dx, dy, dz] of DIRECTIONS_26) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        const matches = sparkedBy === MAT.HEAC
          ? [MAT.PIPE, MAT.PPIP].includes(this.types[neighbor])
          : this.types[neighbor] === type;
        if (!matches || visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    return changed;
  }

  transferPipePayload(source, target, incomingDirection) {
    this.ctype[target] = this.ctype[source];
    this.temperatures[target] = this.temperatures[source];
    this.tmp2[target] = this.tmp2[source];
    this.tmp3[target] = this.tmp3[source];
    this.tmp4[target] = this.tmp4[source];
    if (this.tmp[source] & PIPE_FLAG.PARTICLE_DECO) {
      if (!this.decorations[target]) {
        this.decorations[target] = this.decorations[source];
        this.tmp[target] |= PIPE_FLAG.PARTICLE_DECO;
      }
      this.decorations[source] = 0;
      this.tmp[source] &= ~PIPE_FLAG.PARTICLE_DECO;
    }
    this.flags[target] = ((incomingDirection + 1) << 8) | 1;
    this.ctype[source] = 0;
    this.tmp2[source] = 0;
    this.tmp3[source] = 0;
    this.tmp4[source] = 0;
    this.flags[source] = 0;
  }

  updatePipe(index, x, y, z, type) {
    if (!(this.tmp[index] & PIPE_FLAG.COLORS)) this.initializePipeNetwork(index);
    if (type === MAT.PPIP && (this.tmp[index] & PIPE_FLAG.PAUSED)) return false;
    let heatPipe = false;
    this.visitNeighbors(x, y, z, 1, (_neighbor, neighborType) => {
      if (neighborType === MAT.HEAC) heatPipe = true;
      return false;
    });
    if (heatPipe && !(this.tmp[index] & PIPE_FLAG.CAN_CONDUCT)) this.triggerPipeNetwork(index, MAT.HEAC);
    if (!this.ctype[index]) {
      let captured = false;
      this.visitNeighbors(x, y, z, 1, (neighbor, neighborType) => {
        const energyType = this.energyTypes[neighbor];
        const targetType = energyType || neighborType;
        if (!targetType || [MAT.PIPE, MAT.PPIP, MAT.STOR].includes(targetType)) return false;
        if (energyType || materialById(targetType).state !== "solid") {
          this.storeParticleInPipe(index, neighbor, targetType, false);
          captured = true;
          return true;
        }
        return false;
      });
      return captured;
    }

    const age = Math.min(255, (this.flags[index] & 0xff) + 1);
    this.flags[index] = (this.flags[index] & ~0xff) | age;
    const previousDirection = (this.flags[index] >> 8) - 1;
    const color = this.tmp[index] & PIPE_FLAG.COLORS;
    const desiredColor = this.tmp[index] & PIPE_FLAG.REVERSED ? this.pipePreviousColor(color) : this.pipeNextColor(color);
    const candidates = [];
    for (let direction = 0; direction < DIRECTIONS_26.length; direction += 1) {
      if (direction === previousDirection) continue;
      const [dx, dy, dz] = DIRECTIONS_26[direction];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      const target = this.index(nx, ny, nz);
      if (![MAT.PIPE, MAT.PPIP].includes(this.types[target]) || this.ctype[target]) continue;
      if (this.types[target] === MAT.PPIP && (this.tmp[target] & PIPE_FLAG.PAUSED)) continue;
      candidates.push({ direction, target, preferred: (this.tmp[target] & PIPE_FLAG.COLORS) === desiredColor });
    }
    const choices = candidates.some((candidate) => candidate.preferred) ? candidates.filter((candidate) => candidate.preferred) : candidates;
    if (choices.length) {
      const choice = choices[Math.floor(this.random() * choices.length)];
      this.transferPipePayload(index, choice.target, OPPOSITE_DIRECTION_26[choice.direction]);
      this.processed[choice.target] = this.epoch;
      return false;
    }
    if ((this.flags[index] & 0xff) >= 3) this.emitStoredParticle(index, x, y, z, false);
    return false;
  }

  updateStorage(index, x, y, z) {
    if (!this.tmp[index] && this.life[index] === 0) {
      let captured = false;
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        const energyType = this.energyTypes[neighbor];
        const targetType = energyType || neighborType;
        if (!targetType || targetType === MAT.STOR || materialById(targetType).state === "solid") return false;
        if (this.ctype[index] && targetType !== this.ctype[index]) return false;
        this.storeParticleInPipe(index, neighbor, targetType, true);
        captured = true;
        return true;
      });
      if (captured) return false;
    }
    if (this.tmp[index]) {
      let release = false;
      this.visitNeighbors(x, y, z, 2, (neighbor, neighborType) => {
        if (neighborType === MAT.SPRK && this.ctype[neighbor] === MAT.PSCN && this.life[neighbor] > 0 && this.life[neighbor] < 4) release = true;
        if ([MAT.PIPE, MAT.PPIP].includes(neighborType) && !this.ctype[neighbor]) {
          this.ctype[neighbor] = this.tmp[index];
          this.temperatures[neighbor] = this.temperatures[index];
          this.tmp2[neighbor] = this.tmp2[index];
          this.tmp3[neighbor] = this.tmp3[index];
          this.tmp4[neighbor] = this.tmp4[index];
          this.tmp[index] = 0;
          this.processed[neighbor] = this.epoch;
          return true;
        }
        return false;
      });
      if (release && this.emitStoredParticle(index, x, y, z, true)) this.life[index] = 10;
    } else if (this.life[index] > 0) this.life[index] -= 1;
    return false;
  }

  updateReactiveElement(index, x, y, z, type) {
    if (ACTOR_TYPES.has(type)) return this.updateActor(index, x, y, z, type);
    if (type === MAT.SNOW) return this.updateSnow(index, x, y, z);
    if (type === MAT.PLSM) return this.updatePlasma(index, x, y, z);
    if (type === MAT.NBLE) return this.updateNobleGas(index, x, y, z);
    if (type === MAT.YEST) return this.updateYeast(index, x, y, z);
    if (type === MAT.MORT) return this.updateMort(index, x, y, z);
    if (type === MAT.CO2) return this.updateCarbonDioxide(index, x, y, z);
    if (type === MAT.CAUS) return this.updateCausticGas(index, x, y, z);
    if (type === MAT.FRZZ || type === MAT.FRZW) return this.updateFreezeMatter(index, x, y, z, type);
    if (type === MAT.GRAV) return this.updateGravityDust(index);
    if (type === MAT.ANAR) return this.updateAntiAir(index, x, y, z);
    if (type === MAT.BOYL) return this.updateBoyleGas(index, x, y, z);
    if (type === MAT.RFRG || type === MAT.RFGL) return this.updateRefrigerant(index, x, y, z);
    if (type === MAT.RSST || type === MAT.RSSS) return this.updateResist(index, x, y, z, type);
    if (type === MAT.SOAP) return this.updateSoap(index, x, y, z);
    if (type === MAT.TRON) return this.updateTron(index, x, y, z);
    if (type === MAT.GOO) return this.updateGoo(index, x, y, z);
    if (type === MAT.BMTL || type === MAT.BRMT) return this.updateBreakableMetal(index, x, y, z, type);
    if (type === MAT.COAL || type === MAT.BCOL) return this.updateCoal(index, x, y, z, type);
    if (type === MAT.IRON) return this.updateIron(index, x, y, z);
    if (type === MAT.QRTZ || type === MAT.PQRT) return this.updateQuartz(index, x, y, z, type);
    if (type === MAT.GOLD) return this.updateGold(index, x, y, z);
    if (type === MAT.TUNG) return this.updateTungsten(index, x, y, z);
    if (type === MAT.CRMC) return this.updateCeramic(index, x, y, z);
    if (type === MAT.HEAC) return this.updateHeatConductor(index, x, y, z);
    if (type === MAT.PTNM) return this.updatePlatinum(index, x, y, z);
    if (type === MAT.BREC) return this.updateBrokenElectronics(index, x, y, z);
    if (type === MAT.CLST) return this.updateClay(index, x, y, z);
    if (type === MAT.SLCN) return this.updateSilicon(index, x, y, z);
    if ([MAT.WATR, MAT.DSTW, MAT.SLTW].includes(type)) return this.updateWaterChemistry(index, x, y, z, type);
    if (type === MAT.BASE) return this.updateBase(index, x, y, z);
    if ([MAT.VIRS, MAT.VRSS, MAT.VRSG].includes(type)) return this.updateVirus(index, x, y, z, type);
    if (type === MAT.O2) return this.updateOxygen(index, x, y, z);
    if (type === MAT.H2) return this.updateHydrogen(index, x, y, z);
    if (type === MAT.CBNW) return this.updateCarbonatedWater(index, x, y, z);
    if ([MAT.SHLD1, MAT.SHLD2, MAT.SHLD3, MAT.SHLD4].includes(type)) return this.updateShield(index, x, y, z, type);
    if (type === MAT.FOG || type === MAT.RIME) return this.updateFogRime(index, x, y, z, type);
    if (type === MAT.GEL) return this.updateGel(index, x, y, z);
    if (type === MAT.GLOW) return this.updateGlow(index, x, y, z);
    if ([MAT.BIZR, MAT.BIZRG, MAT.BIZRS].includes(type)) return this.updateBizarre(index, x, y, z);
    if (type === MAT.INVIS) return this.updateInvisible(index, x, y, z);
    if (type === MAT.LITH) return this.updateLithium(index, x, y, z);
    if (type === MAT.SPNG) return this.updateSponge(index, x, y, z);
    if (type === MAT.MERC) return this.updateMercury(index, x, y, z);
    if (type === MAT.SEED) return this.updateSeed(index, x, y, z);
    if (type === MAT.VINE) return this.updateVine(index, x, y, z);
    if (type === MAT.DLAY) return this.updateDelay(index, x, y, z);
    if (type === MAT.NTCT || type === MAT.PTCT) return this.updateThermistor(index);
    if ([MAT.URAN, MAT.PLUT, MAT.POLO, MAT.DEUT, MAT.ISOZ, MAT.ISZS, MAT.WARP, MAT.EXOT, MAT.VIBR, MAT.BVBR].includes(type)) return this.updateNuclearElement(index, x, y, z, type);
    if ([MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.PBCN].includes(type)) return this.updateCloner(index, x, y, z, type);
    if (type === MAT.CONV) return this.updateConverter(index, x, y, z);
    if ([MAT.VOID, MAT.PVOD, MAT.BHOL, MAT.WHOL, MAT.NBHL, MAT.NWHL].includes(type)) return this.updateHole(index, x, y, z, type);
    if ([MAT.DTEC, MAT.TSNS, MAT.PSNS, MAT.LSNS, MAT.LDTC, MAT.VSNS].includes(type)) return this.updateSensor(index, x, y, z, type);
    if (type === MAT.PSTN) return this.updatePiston(index, x, y, z);
    if (type === MAT.FRAY) return this.updateForceRay(index, x, y, z);
    if (type === MAT.RPEL) return this.updateRepeller(index, x, y, z);
    if (type === MAT.DMG) return this.updateDamageParticle(index, x, y, z);
    if (type === MAT.GBMB) return this.updateGravityBomb(index, x, y, z);
    if (type === MAT.ACEL || type === MAT.DCEL) return this.updateForceElement(index, x, y, z, type);
    if ([MAT.LCRY, MAT.PUMP, MAT.GPMP, MAT.HSWC].includes(type)) return this.updatePoweredElement(index, x, y, z, type);
    if (type === MAT.SING) return this.updateSingularity(index, x, y, z);
    if (type === MAT.AMTR) return this.updateAntimatter(index, x, y, z);
    if (type === MAT.FIRW || type === MAT.FWRK) return this.updateFirework(index, x, y, z, type);
    if ([MAT.THDR, MAT.BOMB, MAT.DEST, MAT.THRM, MAT.FUSE, MAT.FSEP, MAT.C5, MAT.BANG, MAT.IGNT, MAT.LIGH].includes(type)) return this.updateExplosiveElement(index, x, y, z, type);
    if (type === MAT.PIPE || type === MAT.PPIP) return this.updatePipe(index, x, y, z, type);
    if (type === MAT.STOR) return this.updateStorage(index, x, y, z);
    if (type === MAT.PRTI || type === MAT.PRTO) return this.updatePortal(index, x, y, z, type);
    if (type === MAT.WIFI) return this.updateWifi(index, x, y, z);
    if (type === MAT.ARAY) return this.updateArrayRay(index, x, y, z);
    if (type === MAT.CRAY) return this.updateCreatorRay(index, x, y, z);
    if (type === MAT.DRAY) return this.updateDuplicatorRay(index, x, y, z);
    return false;
  }

  updateLife() {
    if (!this.types.includes(MAT.LIFE)) return 0;
    const changes = [];
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          const existing = this.types[index] === MAT.LIFE;
          let ruleId = existing ? this.ctype[index] : -1;
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (!this.inBounds(nx, ny, z)) continue;
              const neighbor = this.index(nx, ny, z);
              if (this.types[neighbor] !== MAT.LIFE || this.tmp[neighbor] > 0) continue;
              if (ruleId < 0) ruleId = this.ctype[neighbor];
              if (this.ctype[neighbor] === ruleId) neighbors += 1;
            }
          }
          if (ruleId < 0 || !UPSTREAM_LIFE_RULES[ruleId]) continue;
          const ruleset = UPSTREAM_LIFE_RULES[ruleId].ruleset;
          const survives = Boolean((ruleset >> neighbors) & 1);
          const born = Boolean((ruleset >> (neighbors + 8)) & 1);
          const states = ((ruleset >> 17) & 0xf) + 2;
          if (existing && this.tmp[index] > 0) {
            changes.push({ index, type: this.tmp[index] <= 1 ? MAT.EMPTY : MAT.LIFE, ctype: ruleId, tmp: this.tmp[index] - 1 });
          } else if (existing && !survives) {
            changes.push({ index, type: states > 2 ? MAT.LIFE : MAT.EMPTY, ctype: ruleId, tmp: states > 2 ? states - 2 : 0 });
          } else if (!existing && born) {
            changes.push({ index, type: MAT.LIFE, ctype: ruleId, tmp: 0 });
          }
        }
      }
    }
    for (const change of changes) {
      if (change.type === MAT.EMPTY) {
        const [x, y, z] = this.coords(change.index);
        this.set(x, y, z, MAT.EMPTY);
      } else {
        this.types[change.index] = MAT.LIFE;
        this.ctype[change.index] = change.ctype;
        this.tmp[change.index] = change.tmp;
        this.temperatures[change.index] = 22;
      }
      this.processed[change.index] = this.epoch;
    }
    return changes.length;
  }

  updatePowder(index, x, y, z) {
    this.tryMove(index, x, y, z, this.gravityMoveDirections(x, y, z));
  }

  equalizeLiquid(index, x, y, z) {
    const type = this.types[index];
    if (!isLiquid(type)) return false;
    const gravity = this.gravityVectorAt(x, y, z);
    if (!gravity.some((component) => Math.abs(component) > 0.01)) return false;
    const dominant = Math.abs(gravity[0]) >= Math.abs(gravity[1]) && Math.abs(gravity[0]) >= Math.abs(gravity[2]) ? 0
      : Math.abs(gravity[1]) >= Math.abs(gravity[2]) ? 1 : 2;
    const down = [0, 0, 0];
    down[dominant] = Math.sign(gravity[dominant]);
    const queue = [index];
    const visited = new Set([index]);
    let bestTarget = -1;
    let bestDrop = 0;
    while (queue.length && visited.size <= 512) {
      const current = queue.shift();
      const [cx, cy, cz] = this.coords(current);
      const tx = cx + down[0];
      const ty = cy + down[1];
      const tz = cz + down[2];
      const drop = (tx - x) * gravity[0] + (ty - y) * gravity[1] + (tz - z) * gravity[2];
      if (drop > bestDrop && this.inBounds(tx, ty, tz)) {
        const target = this.index(tx, ty, tz);
        if (this.types[target] === MAT.EMPTY && this.wallAllows(type, tx, ty, tz)) {
          bestTarget = target;
          bestDrop = drop;
        }
      }
      for (const [dx, dy, dz] of DIRECTIONS_6) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        if (!this.inBounds(nx, ny, nz)) continue;
        const neighbor = this.index(nx, ny, nz);
        if (visited.has(neighbor) || !isLiquid(this.types[neighbor])) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    return bestTarget >= 0 ? this.move(index, bestTarget) : false;
  }

  updateLiquid(index, x, y, z, type) {
    if (type === MAT.ACID && this.updateAcid(index, x, y, z)) return;
    if (type === MAT.LAVA) {
      this.updateLavaState(index, x, y, z);
      this.updateCombustionInteractions(index, x, y, z, MAT.LAVA);
      if (this.random() > 0.42) return;
    }
    if (this.tryMove(index, x, y, z, this.gravityMoveDirections(x, y, z))) return;
    if (this.waterEqualization && this.random() < 1 / 200 && this.equalizeLiquid(index, x, y, z)) return;
    if (this.random() > (type === MAT.LAVA ? 0.28 : 0.78)) return;
    this.tryMove(index, x, y, z, PLANAR_SPREAD_DIRECTIONS);
  }

  step() {
    this.tick += 1;
    this.epoch += 1;
    if (this.epoch >= 65534) {
      this.processed.fill(0);
      this.energyProcessed.fill(0);
      this.epoch = 1;
    }
    this.activity = { moves: 0, reactions: 0, explosions: 0 };
    this.respawnActors();
    this.applyAutomaticLifeDecay();
    this.updateEnergy();
    if (this.newtonianGravityEnabled) this.gravity.step(this);
    else {
      this.gravity.mass.fill(0);
      this.gravity.forceX.fill(0);
      this.gravity.forceY.fill(0);
      this.gravity.forceZ.fill(0);
      this.gravity.sources = [];
    }
    this.updateWirelessState();
    this.updateWallElectricity();
    this.applyWallFans();
    this.updateWireWorld();
    this.updateLife();

    const flipX = this.random() < 0.5;
    const flipZ = this.random() < 0.5;
    for (let y = 0; y < this.height; y += 1) {
      for (let zStep = 0; zStep < this.depth; zStep += 1) {
        const z = flipZ ? this.depth - 1 - zStep : zStep;
        for (let xStep = 0; xStep < this.width; xStep += 1) {
          const x = flipX ? this.width - 1 - xStep : xStep;
          const index = this.index(x, y, z);
          const type = this.types[index];
          if (type === MAT.EMPTY || this.processed[index] === this.epoch) continue;
          this.processed[index] = this.epoch;

          if (type === MAT.LIFE || type === MAT.WIRE) continue;
          if (this.wallAtVoxel(x, y, z) === WALL_ID.DEFAULT_WL_STASIS && !this.wallPoweredAtVoxel(x, y, z)) continue;

          if (this.heatSimulationEnabled) {
            const conductedHeat = this.conductHeat(index, x, y, z);
            if (this.types[index] !== type || (conductedHeat && this.applyPhaseChange(index, type))) continue;
          }
          if (this.customElementUpdateTypes?.has(type)
            && (this.customElementUpdate?.(type, index, x, y, z) === true || this.types[index] !== type)) continue;
          if (this.updateReactiveElement(index, x, y, z, type)) continue;

          if (type === MAT.SPRK) this.updateSpark(index, x, y, z);
          else if (type === MAT.BTRY) this.updateBattery(index, x, y, z);
          else if (type === MAT.SWCH) this.updateSwitch(index, x, y, z);
          else if (type === MAT.FIRE) this.updateFire(index, x, y, z);
          else if (isGas(type)) this.updateGas(index, x, y, z, type);
          else if (isPowder(type)) this.updatePowder(index, x, y, z);
          else if (isLiquid(type)) this.updateLiquid(index, x, y, z, type);
          else if (type === MAT.PLANT) this.updatePlant(index, x, y, z);
          else {
            if (Math.abs(this.temperatures[index] - 22) > 0.1) this.temperatures[index] += (22 - this.temperatures[index]) * 0.0008;
          }

          const activeType = this.types[index];
          if (activeType !== MAT.EMPTY) {
            const activeMaterial = materialById(activeType);
            const hotAir = activeMaterial.upstream?.hotAir ?? 0;
            const excessHeat = Math.max(0, this.temperatures[index] - 22);
            if (hotAir || excessHeat > 80) {
              this.air.injectVoxel(x, y, z, hotAir * 0.45, excessHeat * 0.00045, 0, hotAir * 0.8, 0);
            }
          }
        }
      }
    }
    // Particle callbacks can create, remove or move TTAN/RSSS and heat blockers.
    // Rebuild the coarse masks immediately before the upstream-ordered air pass.
    this.air.updateBlocked(this);
    this.air.step(this);

    this._stats.moves = this.activity.moves;
    this._stats.reactions = this.activity.reactions;
    this._stats.explosions = this.activity.explosions;
    return this.activity;
  }

  calculateStats() {
    let active = 0;
    let hot = 0;
    let peakTemp = 22;
    for (let index = 0; index < this.size; index += 1) {
      if (this.types[index] === MAT.EMPTY) continue;
      active += 1;
      const temperature = this.temperatures[index];
      if (temperature > 120) hot += 1;
      if (temperature > peakTemp) peakTemp = temperature;
    }
    for (let index = 0; index < this.size; index += 1) {
      if (this.energyTypes[index] === MAT.EMPTY) continue;
      active += 1;
      const temperature = this.energyTemperatures[index];
      if (temperature > 120) hot += 1;
      if (temperature > peakTemp) peakTemp = temperature;
    }
    this._stats.active = active;
    this._stats.hot = hot;
    this._stats.peakTemp = peakTemp;
    const airStats = this.air.stats();
    const gravityStats = this.gravity.stats();
    this._stats.maxPressure = airStats.maxPressure;
    this._stats.maxAirVelocity = airStats.maxVelocity;
    this._stats.peakAmbientTemp = airStats.peakTemperature;
    this._stats.maxGravity = gravityStats.peakForce;
    this._stats.gravitySources = gravityStats.sources;
    return { ...this._stats };
  }

  serializePortalQueues() {
    const entries = [];
    for (let channel = 0; channel < this.portalQueues.length; channel += 1) {
      for (let direction = 0; direction < this.portalQueues[channel].length; direction += 1) {
        const queue = this.portalQueues[channel][direction];
        if (queue.length) entries.push([channel, direction, queue.map((particle) => ({ ...particle }))]);
      }
    }
    return entries;
  }

  restorePortalQueues(entries = []) {
    for (const channel of this.portalQueues) for (const queue of channel) queue.length = 0;
    for (const [channel, direction, queue] of entries ?? []) {
      if (!Number.isInteger(channel) || channel < 0 || channel >= this.portalQueues.length) continue;
      if (!Number.isInteger(direction) || direction < 0 || direction >= DIRECTIONS_26.length || !Array.isArray(queue)) continue;
      this.portalQueues[channel][direction].push(...queue.slice(0, 80).map((particle) => ({ ...particle })));
    }
  }

  applySettings(settings = {}) {
    const finite = (value, fallback, min, max) => {
      const number = Number(value);
      return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
    };
    this.gravityMode = Math.max(0, Math.min(3, Number(settings.gravityMode) || 0));
    this.edgeMode = Math.max(0, Math.min(2, Number(settings.edgeMode ?? 1)));
    if (Array.isArray(settings.customGravity) && settings.customGravity.length === 3) this.customGravity = settings.customGravity.map(Number);
    this.heatSimulationEnabled = settings.heatSimulationEnabled !== false;
    this.newtonianGravityEnabled = settings.newtonianGravityEnabled !== false;
    this.waterEqualization = settings.waterEqualization === true;
    this.decorationColorSpace = Math.max(0, Math.min(3, Number(settings.decorationColorSpace) || 0));
    this.air.mode = Math.max(0, Math.min(4, Number(settings.airMode) || 0));
    this.air.ambientTemperature = finite(settings.ambientTemperature, 22, -273.15, 9725.85);
    this.air.ambientHeatEnabled = settings.ambientHeatEnabled !== false;
    this.air.edgePressure = finite(settings.edgePressure, 0, -256, 256);
    this.air.edgeVelocityX = finite(settings.edgeVelocityX, 0, -256, 256);
    this.air.edgeVelocityY = finite(settings.edgeVelocityY, 0, -256, 256);
    this.air.edgeVelocityZ = finite(settings.edgeVelocityZ, 0, -256, 256);
    this.air.vorticityCoeff = finite(settings.vorticityCoeff, 0.1, 0, 1);
    this.air.convectionMode = Math.max(0, Math.min(2, Number(settings.convectionMode ?? 2)));
  }

  createSnapshot() {
    return {
      tick: this.tick,
      currentPreset: this.currentPreset,
      particleFields: this.particleFields.map((field) => field.slice()),
      energyFields: this.energyFields.map((field) => field.slice()),
      walls: this.walls.slice(),
      wallElectricity: this.wallElectricity.slice(),
      wallFans: [this.wallFanX.slice(), this.wallFanY.slice(), this.wallFanZ.slice()],
      wireless: [this.wireless.slice(), this.wirelessNext.slice()],
      portals: this.serializePortalQueues(),
      actorSpawns: this.actorSpawns.map((spawn) => spawn ? [...spawn] : null),
      actorPortalLocks: [...this.actorPortalLocks],
      signs: this.signs.map((sign) => ({ ...sign })),
      settings: {
        gravityMode: this.gravityMode, customGravity: [...this.customGravity], edgeMode: this.edgeMode, airMode: this.air.mode,
        ambientTemperature: this.air.ambientTemperature, ambientHeatEnabled: this.air.ambientHeatEnabled,
        heatSimulationEnabled: this.heatSimulationEnabled, newtonianGravityEnabled: this.newtonianGravityEnabled,
        waterEqualization: this.waterEqualization, decorationColorSpace: this.decorationColorSpace,
        edgePressure: this.air.edgePressure, edgeVelocityX: this.air.edgeVelocityX, edgeVelocityY: this.air.edgeVelocityY,
        edgeVelocityZ: this.air.edgeVelocityZ, vorticityCoeff: this.air.vorticityCoeff, convectionMode: this.air.convectionMode,
      },
      air: {
        pressure: this.air.pressure.slice(),
        velocityX: this.air.velocityX.slice(),
        velocityY: this.air.velocityY.slice(),
        velocityZ: this.air.velocityZ.slice(),
        ambientHeat: this.air.ambientHeat.slice(),
      },
      gravity: {
        mass: this.gravity.mass.slice(),
        toolMass: this.gravity.toolMass.slice(),
        mask: this.gravity.mask.slice(),
        forceX: this.gravity.forceX.slice(),
        forceY: this.gravity.forceY.slice(),
        forceZ: this.gravity.forceZ.slice(),
      },
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot?.particleFields || snapshot.particleFields.length !== this.particleFields.length) throw new Error("Invalid Powder Toy 3D snapshot");
    for (let index = 0; index < this.particleFields.length; index += 1) this.particleFields[index].set(snapshot.particleFields[index]);
    if (snapshot.energyFields?.length === this.energyFields.length) {
      for (let index = 0; index < this.energyFields.length; index += 1) this.energyFields[index].set(snapshot.energyFields[index]);
    } else {
      for (const field of this.energyFields) field.fill(0);
      this.energyTemperatures.fill(22);
    }
    this.walls.set(snapshot.walls);
    this.wallElectricity.set(snapshot.wallElectricity);
    if (snapshot.wallFans?.length === 3) {
      this.wallFanX.set(snapshot.wallFans[0]);
      this.wallFanY.set(snapshot.wallFans[1]);
      this.wallFanZ.set(snapshot.wallFans[2]);
    } else {
      this.wallFanX.fill(0);
      this.wallFanY.fill(0);
      this.wallFanZ.fill(0);
    }
    if (snapshot.wireless?.length === 2) {
      this.wireless.set(snapshot.wireless[0]);
      this.wirelessNext.set(snapshot.wireless[1]);
    } else {
      this.wireless.fill(0);
      this.wirelessNext.fill(0);
    }
    this.restorePortalQueues(snapshot.portals);
    this.actorSpawns = snapshot.actorSpawns?.map((spawn) => Array.isArray(spawn) ? [...spawn] : null) ?? [null, null];
    for (let player = 0; player < 2; player += 1) {
      const type = player === 0 ? MAT.STKM : MAT.STKM2;
      const actor = this.actorIndex(type);
      if (!this.actorSpawns[player] && actor >= 0) this.actorSpawns[player] = this.coords(actor);
    }
    this.actorPortalLocks = snapshot.actorPortalLocks?.map(Boolean) ?? [false, false];
    this.applySettings(snapshot.settings);
    this.signs = (snapshot.signs ?? []).filter((sign) => this.inBounds(sign.x, sign.y, sign.z)).slice(0, 32).map((sign) => ({
      ...sign,
      justification: ["left", "center", "right"].includes(sign.justification) ? sign.justification : "center",
    }));
    this.signVersion += 1;
    this.air.pressure.set(snapshot.air.pressure);
    this.air.velocityX.set(snapshot.air.velocityX);
    this.air.velocityY.set(snapshot.air.velocityY);
    this.air.velocityZ.set(snapshot.air.velocityZ);
    this.air.ambientHeat.set(snapshot.air.ambientHeat);
    if (snapshot.gravity) {
      for (const field of ["mass", "toolMass", "mask", "forceX", "forceY", "forceZ"]) {
        if (snapshot.gravity[field]) this.gravity[field].set(snapshot.gravity[field]);
      }
    }
    this.tick = snapshot.tick ?? 0;
    this.currentPreset = snapshot.currentPreset ?? "custom";
    this.processed.fill(0);
    this.energyProcessed.fill(0);
    this.epoch = 1;
    this.air.updateBlocked(this);
    return this.calculateStats();
  }

  serialize() {
    const particles = [];
    const energy = [];
    for (let index = 0; index < this.size; index += 1) {
      if (this.types[index] === MAT.EMPTY) continue;
      const [x, y, z] = this.coords(index);
      particles.push([
        x, y, z, this.types[index], Math.round(this.temperatures[index] * 100) / 100,
        this.life[index], this.ctype[index], this.tmp[index], this.tmp2[index],
        Math.round(this.velocityX[index] * 1000) / 1000,
        Math.round(this.velocityY[index] * 1000) / 1000,
        Math.round(this.velocityZ[index] * 1000) / 1000,
        this.flags[index], this.decorations[index], this.tmp3[index], this.tmp4[index],
      ]);
    }
    for (let index = 0; index < this.size; index += 1) {
      if (this.energyTypes[index] === MAT.EMPTY) continue;
      const [x, y, z] = this.coords(index);
      energy.push([
        x, y, z, this.energyTypes[index], Math.round(this.energyTemperatures[index] * 100) / 100,
        this.energyLife[index], this.energyCtype[index], this.energyTmp[index], this.energyTmp2[index],
        Math.round(this.energyVelocityX[index] * 1000) / 1000,
        Math.round(this.energyVelocityY[index] * 1000) / 1000,
        Math.round(this.energyVelocityZ[index] * 1000) / 1000,
        this.energyFlags[index], this.energyDecorations[index], this.energyTmp3[index], this.energyTmp4[index],
      ]);
    }
    const walls = [];
    for (let index = 0; index < this.walls.length; index += 1) {
      if (this.walls[index] || this.wallElectricity[index]) walls.push([
        index, this.walls[index], this.wallElectricity[index],
        this.wallFanX[index], this.wallFanY[index], this.wallFanZ[index],
      ]);
    }
    return {
      format: "powder-toy-3d",
      version: 6,
      dimensions: [this.width, this.height, this.depth],
      tick: this.tick,
      preset: this.currentPreset,
      particles,
      energy,
      walls,
      portals: this.serializePortalQueues(),
      actorSpawns: this.actorSpawns.map((spawn) => spawn ? [...spawn] : null),
      actorPortalLocks: [...this.actorPortalLocks],
      signs: this.signs.map((sign) => ({ ...sign })),
      settings: {
        gravityMode: this.gravityMode, customGravity: [...this.customGravity], edgeMode: this.edgeMode, airMode: this.air.mode,
        ambientTemperature: this.air.ambientTemperature, ambientHeatEnabled: this.air.ambientHeatEnabled,
        heatSimulationEnabled: this.heatSimulationEnabled, newtonianGravityEnabled: this.newtonianGravityEnabled,
        waterEqualization: this.waterEqualization, decorationColorSpace: this.decorationColorSpace,
        edgePressure: this.air.edgePressure, edgeVelocityX: this.air.edgeVelocityX, edgeVelocityY: this.air.edgeVelocityY,
        edgeVelocityZ: this.air.edgeVelocityZ, vorticityCoeff: this.air.vorticityCoeff, convectionMode: this.air.convectionMode,
      },
      air: {
        pressure: Array.from(this.air.pressure, (value) => Math.round(value * 1000) / 1000),
        velocityX: Array.from(this.air.velocityX, (value) => Math.round(value * 1000) / 1000),
        velocityY: Array.from(this.air.velocityY, (value) => Math.round(value * 1000) / 1000),
        velocityZ: Array.from(this.air.velocityZ, (value) => Math.round(value * 1000) / 1000),
        ambientHeat: Array.from(this.air.ambientHeat, (value) => Math.round(value * 100) / 100),
      },
      gravity: {
        mass: Array.from(this.gravity.mass, (value) => Math.round(value * 1000) / 1000),
        toolMass: Array.from(this.gravity.toolMass, (value) => Math.round(value * 1000) / 1000),
        mask: Array.from(this.gravity.mask),
        forceX: Array.from(this.gravity.forceX, (value) => Math.round(value * 1000) / 1000),
        forceY: Array.from(this.gravity.forceY, (value) => Math.round(value * 1000) / 1000),
        forceZ: Array.from(this.gravity.forceZ, (value) => Math.round(value * 1000) / 1000),
      },
    };
  }

  deserialize(save) {
    if (save?.format !== "powder-toy-3d" || !Array.isArray(save.dimensions)) throw new Error("Unsupported save format");
    if (save.dimensions[0] !== this.width || save.dimensions[1] !== this.height || save.dimensions[2] !== this.depth) throw new Error("Save chamber dimensions do not match this simulation");
    this.clear();
    for (const particle of save.particles ?? []) {
      const [x, y, z, type, temperature, life, ctype, tmp, tmp2, velocityX, velocityY, velocityZ, flags, decoration, tmp3, tmp4] = particle;
      if (!this.inBounds(x, y, z) || materialById(type).id !== type || !materialById(type).enabled || type === MAT.EMPTY) continue;
      this.set(x, y, z, type, temperature, life, { ctype, tmp, tmp2, tmp3, tmp4, velocityX, velocityY, velocityZ, flags, decoration });
    }
    for (const particle of save.energy ?? []) {
      const [x, y, z, type, temperature, life, ctype, tmp, tmp2, velocityX, velocityY, velocityZ, flags, decoration, tmp3, tmp4] = particle;
      if (!this.inBounds(x, y, z) || materialById(type).id !== type || materialById(type).state !== "energy") continue;
      this.setEnergy(x, y, z, type, temperature, life, { ctype, tmp, tmp2, tmp3, tmp4, velocityX, velocityY, velocityZ, flags, decoration });
    }
    for (const [index, wall, electricity, fanX = 0, fanY = 0, fanZ = 0] of save.walls ?? []) {
      if (index < 0 || index >= this.walls.length) continue;
      this.walls[index] = wall;
      this.wallElectricity[index] = electricity;
      this.wallFanX[index] = fanX;
      this.wallFanY[index] = fanY;
      this.wallFanZ[index] = fanZ;
    }
    this.restorePortalQueues(save.portals);
    if (Array.isArray(save.actorSpawns)) this.actorSpawns = save.actorSpawns.map((spawn) => Array.isArray(spawn) ? [...spawn] : null).slice(0, 2);
    while (this.actorSpawns.length < 2) this.actorSpawns.push(null);
    if (Array.isArray(save.actorPortalLocks)) this.actorPortalLocks = save.actorPortalLocks.map(Boolean).slice(0, 2);
    while (this.actorPortalLocks.length < 2) this.actorPortalLocks.push(false);
    this.applySettings(save.settings);
    this.signs = (save.signs ?? []).filter((sign) => this.inBounds(sign.x, sign.y, sign.z) && typeof sign.text === "string").slice(0, 32).map((sign) => ({
      x: sign.x, y: sign.y, z: sign.z, text: sign.text.slice(0, 96), color: Number(sign.color) >>> 0,
      justification: ["left", "center", "right"].includes(sign.justification) ? sign.justification : "center",
    }));
    this.signVersion += 1;
    for (const field of ["pressure", "velocityX", "velocityY", "velocityZ", "ambientHeat"]) {
      if (Array.isArray(save.air?.[field]) && save.air[field].length === this.air[field].length) this.air[field].set(save.air[field]);
    }
    for (const field of ["mass", "toolMass", "mask", "forceX", "forceY", "forceZ"]) {
      if (Array.isArray(save.gravity?.[field]) && save.gravity[field].length === this.gravity[field].length) this.gravity[field].set(save.gravity[field]);
    }
    this.tick = Number(save.tick) || 0;
    this.currentPreset = save.preset ?? "custom";
    this.air.updateBlocked(this);
    return this.calculateStats();
  }

  floodFillPlane(x, y, z, replacementType, properties = {}) {
    if (!this.inBounds(x, y, z)) return 0;
    const start = this.index(x, y, z);
    const energyLayer = materialById(replacementType).state === "energy"
      || (replacementType === MAT.EMPTY && this.types[start] === MAT.EMPTY && this.energyTypes[start] !== MAT.EMPTY);
    const field = energyLayer ? this.energyTypes : this.types;
    const targetType = field[start];
    if (targetType === replacementType) return 0;
    const queue = [[x, y]];
    const visited = new Uint8Array(this.width * this.height);
    let changed = 0;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
      const planeIndex = cx + this.width * cy;
      if (visited[planeIndex]) continue;
      visited[planeIndex] = 1;
      const index = this.index(cx, cy, z);
      if (field[index] !== targetType) continue;
      if (energyLayer) this.setEnergy(cx, cy, z, replacementType, materialById(replacementType).defaultTemp, undefined, properties);
      else this.set(cx, cy, z, replacementType, materialById(replacementType).defaultTemp, undefined, properties);
      changed += 1;
      queue.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }
    return changed;
  }

  replacePlane(z, targetType, replacementType, properties = {}, energyLayer = false) {
    let changed = 0;
    const field = energyLayer ? this.energyTypes : this.types;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.index(x, y, z);
        if (field[index] !== targetType) continue;
        if (energyLayer) this.setEnergy(x, y, z, replacementType, materialById(replacementType).defaultTemp, undefined, properties);
        else this.set(x, y, z, replacementType, materialById(replacementType).defaultTemp, undefined, properties);
        changed += 1;
      }
    }
    return changed;
  }

  floodDecorationPlane(x, y, z, color, mode = DECORATION_MODE.DRAW) {
    if (!this.inBounds(x, y, z)) return 0;
    const start = this.index(x, y, z);
    const target = this.decorationTargetAt(start);
    if (!target) return 0;
    const types = target.energy ? this.energyTypes : this.types;
    const targetDecoration = target.field[start] >>> 0;
    const queue = [[x, y]];
    const visited = new Uint8Array(this.width * this.height);
    let changed = 0;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
      const planeIndex = cx + this.width * cy;
      if (visited[planeIndex]) continue;
      visited[planeIndex] = 1;
      const index = this.index(cx, cy, z);
      if (types[index] === MAT.EMPTY || target.field[index] !== targetDecoration) continue;
      if (target.energy && this.types[index] !== MAT.EMPTY) continue;
      if (this.applyDecorationAt(index, color, mode)) changed += 1;
      queue.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }
    return changed;
  }

  replaceDecorationPlane(z, targetDecoration, color, mode = DECORATION_MODE.DRAW, energyLayer = false) {
    if (z < 0 || z >= this.depth) return 0;
    const types = energyLayer ? this.energyTypes : this.types;
    const decorations = energyLayer ? this.energyDecorations : this.decorations;
    let changed = 0;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.index(x, y, z);
        if (types[index] === MAT.EMPTY || decorations[index] !== (targetDecoration >>> 0)) continue;
        if (energyLayer && this.types[index] !== MAT.EMPTY) continue;
        if (this.applyDecorationAt(index, color, mode)) changed += 1;
      }
    }
    return changed;
  }

  floodPropertyPlane(x, y, z, property, value) {
    if (!this.inBounds(x, y, z)) return 0;
    const start = this.index(x, y, z);
    const energy = this.particleLayerAt(start);
    if (energy == null) return 0;
    const types = energy ? this.energyTypes : this.types;
    const targetType = types[start];
    const queue = [[x, y]];
    const visited = new Uint8Array(this.width * this.height);
    let changed = 0;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
      const planeIndex = cx + this.width * cy;
      if (visited[planeIndex]) continue;
      visited[planeIndex] = 1;
      const index = this.index(cx, cy, z);
      if (types[index] !== targetType || (energy && this.types[index] !== MAT.EMPTY)) continue;
      if (this.applyParticlePropertyAt(index, property, value)) changed += 1;
      queue.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }
    return changed;
  }

  replacePropertyPlane(z, targetType, property, value, energyLayer = false) {
    if (z < 0 || z >= this.depth) return 0;
    const types = energyLayer ? this.energyTypes : this.types;
    let changed = 0;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.index(x, y, z);
        if (types[index] !== targetType || (energyLayer && this.types[index] !== MAT.EMPTY)) continue;
        if (this.applyParticlePropertyAt(index, property, value)) changed += 1;
      }
    }
    return changed;
  }

  copyRegionPlane(x0, y0, x1, y1, z) {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(this.width - 1, Math.max(x0, x1));
    const minY = Math.max(0, Math.min(y0, y1));
    const maxY = Math.min(this.height - 1, Math.max(y0, y1));
    const plane = Math.max(0, Math.min(this.depth - 1, z));
    const matter = [];
    const energy = [];
    const walls = [];
    const signs = this.signs.filter((sign) => sign.z === plane && sign.x >= minX && sign.x <= maxX && sign.y >= minY && sign.y <= maxY)
      .map((sign) => ({ ...sign, x: sign.x - minX, y: sign.y - minY, z: 0 }));
    const copiedWallCells = new Set();
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = this.index(x, y, plane);
        if (this.types[index] !== MAT.EMPTY) matter.push([x - minX, y - minY, this.portalParticleState(index, false)]);
        if (this.energyTypes[index] !== MAT.EMPTY) energy.push([x - minX, y - minY, this.portalParticleState(index, true)]);
        const wallIndex = this.air.indexForVoxel(x, y, plane);
        if ((this.walls[wallIndex] || this.wallElectricity[wallIndex]) && !copiedWallCells.has(wallIndex)) {
          copiedWallCells.add(wallIndex);
          const [cellX, cellY] = this.air.cellForVoxel(x, y, plane);
          walls.push([
            cellX - Math.floor(minX / this.air.cellSize), cellY - Math.floor(minY / this.air.cellSize),
            this.walls[wallIndex], this.wallElectricity[wallIndex],
            this.wallFanX[wallIndex], this.wallFanY[wallIndex], this.wallFanZ[wallIndex],
          ]);
        }
      }
    }
    for (const [relativeX, relativeY, particle] of matter) {
      if (particle.type !== MAT.SOAP) continue;
      const source = this.index(minX + relativeX, minY + relativeY, plane);
      if (!(this.ctype[source] & 2)) continue;
      const linked = this.tmp[source];
      if (linked < 0 || linked >= this.size || this.types[linked] !== MAT.SOAP) continue;
      const [linkedX, linkedY, linkedZ] = this.coords(linked);
      if (linkedZ !== plane || linkedX < minX || linkedX > maxX || linkedY < minY || linkedY > maxY) continue;
      particle.soapForward = [linkedX - minX, linkedY - minY];
    }
    return { format: "powder-toy-3d-clipboard", version: 3, width: maxX - minX + 1, height: maxY - minY + 1, matter, energy, walls, signs };
  }

  clearRegionPlane(x0, y0, x1, y1, z) {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(this.width - 1, Math.max(x0, x1));
    const minY = Math.max(0, Math.min(y0, y1));
    const maxY = Math.min(this.height - 1, Math.max(y0, y1));
    const plane = Math.max(0, Math.min(this.depth - 1, z));
    const clearedWalls = new Set();
    let changed = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = this.index(x, y, plane);
        if (this.types[index] !== MAT.EMPTY || this.energyTypes[index] !== MAT.EMPTY) changed += 1;
        this.set(x, y, plane, MAT.EMPTY);
        this.setEnergy(x, y, plane, MAT.EMPTY);
        const wallIndex = this.air.indexForVoxel(x, y, plane);
        if (!clearedWalls.has(wallIndex)) {
          clearedWalls.add(wallIndex);
          this.walls[wallIndex] = 0;
          this.wallElectricity[wallIndex] = 0;
          this.wallFanX[wallIndex] = 0;
          this.wallFanY[wallIndex] = 0;
          this.wallFanZ[wallIndex] = 0;
        }
      }
    }
    const signCount = this.signs.length;
    this.signs = this.signs.filter((sign) => sign.z !== plane || sign.x < minX || sign.x > maxX || sign.y < minY || sign.y > maxY);
    if (this.signs.length !== signCount) this.signVersion += 1;
    this.air.updateBlocked(this);
    return changed;
  }

  pasteRegionPlane(originX, originY, z, clipboard, overwrite = true) {
    if (clipboard?.format !== "powder-toy-3d-clipboard") return 0;
    const plane = Math.max(0, Math.min(this.depth - 1, z));
    let pasted = 0;
    const matterTargets = new Map();
    const coordinateKey = (x, y) => `${x},${y}`;
    const pasteParticle = (relativeX, relativeY, particle) => {
      const x = originX + relativeX;
      const y = originY + relativeY;
      if (!this.inBounds(x, y, plane) || !materialById(particle.type).enabled) return -1;
      const index = this.index(x, y, plane);
      const properties = {
        ctype: particle.ctype, tmp: particle.tmp, tmp2: particle.tmp2, tmp3: particle.tmp3, tmp4: particle.tmp4,
        velocityX: particle.velocityX, velocityY: particle.velocityY, velocityZ: particle.velocityZ,
        flags: particle.flags, decoration: particle.decoration,
      };
      if (!particle.energy && particle.type === MAT.SOAP) {
        properties.ctype &= ~6;
        properties.tmp = -1;
        properties.tmp2 = -1;
      }
      if (particle.energy) {
        if (!overwrite && this.energyTypes[index] !== MAT.EMPTY) return -1;
        this.setEnergy(x, y, plane, particle.type, particle.temperature, particle.life, properties);
      } else {
        if (!overwrite && this.types[index] !== MAT.EMPTY) return -1;
        this.set(x, y, plane, particle.type, particle.temperature, particle.life, properties);
        this.restoreParticleState(index, particle, false);
        if (particle.type === MAT.SOAP) {
          this.ctype[index] &= ~6;
          this.tmp[index] = -1;
          this.tmp2[index] = -1;
        }
      }
      pasted += 1;
      return index;
    };
    for (const [x, y, particle] of clipboard.matter ?? []) {
      const target = pasteParticle(x, y, particle);
      if (target >= 0) matterTargets.set(coordinateKey(x, y), target);
    }
    for (const [x, y, particle] of clipboard.energy ?? []) pasteParticle(x, y, particle);
    for (const [x, y, particle] of clipboard.matter ?? []) {
      if (particle.type !== MAT.SOAP || !Array.isArray(particle.soapForward)) continue;
      const source = matterTargets.get(coordinateKey(x, y));
      const target = matterTargets.get(coordinateKey(particle.soapForward[0], particle.soapForward[1]));
      if (!Number.isInteger(source) || !Number.isInteger(target) || source === target
        || this.types[source] !== MAT.SOAP || this.types[target] !== MAT.SOAP) continue;
      this.ctype[source] |= 2;
      this.tmp[source] = target;
      this.ctype[target] |= 4;
      this.tmp2[target] = source;
    }
    const baseCellX = Math.floor(originX / this.air.cellSize);
    const baseCellY = Math.floor(originY / this.air.cellSize);
    const [, , cellZ] = this.air.cellForVoxel(originX, originY, plane);
    for (const [relativeX, relativeY, wall, electricity, fanX = 0, fanY = 0, fanZ = 0] of clipboard.walls ?? []) {
      const cellX = baseCellX + relativeX;
      const cellY = baseCellY + relativeY;
      if (!this.air.inBounds(cellX, cellY, cellZ)) continue;
      const wallIndex = this.air.index(cellX, cellY, cellZ);
      this.walls[wallIndex] = wall;
      this.wallElectricity[wallIndex] = electricity;
      this.wallFanX[wallIndex] = fanX;
      this.wallFanY[wallIndex] = fanY;
      this.wallFanZ[wallIndex] = fanZ;
    }
    for (const sign of clipboard.signs ?? []) this.addSign(originX + sign.x, originY + sign.y, plane, sign.text, sign.color, sign.justification);
    this.air.updateBlocked(this);
    return pasted;
  }

  floodWallPlane(x, y, z, replacementWall) {
    const [cx, cy, cz] = this.air.cellForVoxel(x, y, z);
    const target = this.walls[this.air.index(cx, cy, cz)];
    const replacement = replacementWall == null || replacementWall === WALL_ID.DEFAULT_WL_ERASE ? 0 : replacementWall + 1;
    if (target === replacement) return 0;
    const queue = [[cx, cy]];
    const visited = new Uint8Array(this.air.width * this.air.height);
    let changed = 0;
    while (queue.length) {
      const [wx, wy] = queue.pop();
      if (wx < 0 || wx >= this.air.width || wy < 0 || wy >= this.air.height) continue;
      const planeIndex = wx + this.air.width * wy;
      if (visited[planeIndex]) continue;
      visited[planeIndex] = 1;
      const index = this.air.index(wx, wy, cz);
      if (this.walls[index] !== target) continue;
      this.walls[index] = replacement;
      this.wallElectricity[index] = 0;
      this.wallFanX[index] = replacement === WALL_ID.DEFAULT_WL_FAN + 1 ? 8 : 0;
      this.wallFanY[index] = 0;
      this.wallFanZ[index] = 0;
      changed += 1;
      queue.push([wx - 1, wy], [wx + 1, wy], [wx, wy - 1], [wx, wy + 1]);
    }
    this.air.updateBlocked(this);
    return changed;
  }

  replaceWallPlane(z, targetWall, replacementWall) {
    const [, , cz] = this.air.cellForVoxel(0, 0, z);
    const target = targetWall == null ? 0 : targetWall + 1;
    const replacement = replacementWall == null || replacementWall === WALL_ID.DEFAULT_WL_ERASE ? 0 : replacementWall + 1;
    let changed = 0;
    for (let y = 0; y < this.air.height; y += 1) {
      for (let x = 0; x < this.air.width; x += 1) {
        const index = this.air.index(x, y, cz);
        if (this.walls[index] !== target) continue;
        this.walls[index] = replacement;
        this.wallElectricity[index] = 0;
        this.wallFanX[index] = replacement === WALL_ID.DEFAULT_WL_FAN + 1 ? 8 : 0;
        this.wallFanY[index] = 0;
        this.wallFanZ[index] = 0;
        changed += 1;
      }
    }
    this.air.updateBlocked(this);
    return changed;
  }

  loadPreset(name = "foundry") {
    this.clear();
    this.currentPreset = name;
    if (name === "reactor") this.buildReactor();
    else if (name === "garden") this.buildGarden();
    else if (name === "volcano") this.buildVolcano();
    else this.buildFoundry();
    return this.calculateStats();
  }

  buildFoundry() {
    const w = this.width;
    const h = this.height;
    const d = this.depth;
    this.fillBox(2, 1, 2, w - 3, 2, d - 3, MAT.TTAN);
    for (let z = 5; z < d - 5; z += 1) {
      for (let x = 5; x < w - 5; x += 1) {
        if (x < 8 || x > w - 9 || z < 7 || z > d - 8) this.fillBox(x, 3, z, x, 9, z, MAT.METAL);
      }
    }
    this.fillBox(8, 3, 7, w - 9, 6, d - 8, MAT.LAVA, 1280);
    // Suspended glass hoppers keep the hero scene legible while feeding the crucible.
    this.fillBox(8, 14, 7, 8, 28, d - 8, MAT.METAL);
    this.fillBox(18, 14, 7, 18, 28, d - 8, MAT.METAL);
    this.fillBox(9, 14, 7, 17, 14, d - 8, MAT.METAL);
    this.fillBox(9, 15, 7, 17, 27, 7, MAT.GLASS);
    this.fillBox(9, 15, d - 8, 17, 27, d - 8, MAT.GLASS);
    this.fillBox(10, 15, 8, 16, 25, d - 9, MAT.SAND);
    this.fillBox(12, 14, 10, 14, 14, d - 11, MAT.EMPTY);

    this.fillBox(w - 19, 15, 7, w - 19, 27, d - 8, MAT.METAL);
    this.fillBox(w - 9, 15, 7, w - 9, 27, d - 8, MAT.METAL);
    this.fillBox(w - 18, 15, 7, w - 10, 15, d - 8, MAT.METAL);
    this.fillBox(w - 18, 16, 7, w - 10, 26, 7, MAT.GLASS);
    this.fillBox(w - 18, 16, d - 8, w - 10, 26, d - 8, MAT.GLASS);
    this.fillBox(w - 17, 16, 8, w - 11, 24, d - 9, MAT.WATER, 12);

    for (let y = 3; y < 27; y += 3) {
      this.fillBox(5, y, 5, 6, y, d - 6, MAT.METAL);
      this.fillBox(w - 7, y, 5, w - 6, y, d - 6, MAT.METAL);
    }
    this.fillBox(5, 27, 5, w - 6, 28, 6, MAT.METAL);
    this.fillBox(5, 27, d - 7, w - 6, 28, d - 6, MAT.METAL);
    this.fillBox(18, 3, 10, 19, 9, d - 11, MAT.GLASS);
    this.fillBox(w - 20, 3, 10, w - 19, 9, d - 11, MAT.GLASS);
  }

  buildReactor() {
    const w = this.width;
    const d = this.depth;
    this.fillBox(3, 1, 3, w - 4, 2, d - 4, MAT.METAL);
    this.fillBox(8, 3, 7, w - 9, 15, 7, MAT.GLASS);
    this.fillBox(8, 3, d - 8, w - 9, 15, d - 8, MAT.GLASS);
    this.fillBox(8, 3, 8, 8, 15, d - 9, MAT.GLASS);
    this.fillBox(w - 9, 3, 8, w - 9, 15, d - 9, MAT.GLASS);
    this.fillBox(10, 3, 9, w - 11, 8, d - 10, MAT.WATER, 10);
    this.fillBox(16, 9, 11, w - 17, 14, d - 12, MAT.GUNPOWDER);
    this.fillBox(20, 3, 12, w - 21, 12, d - 13, MAT.METAL);
    this.paintSphere(Math.floor(w / 2), 10, Math.floor(d / 2), 2, MAT.FIRE, true);
  }

  buildGarden() {
    const w = this.width;
    const d = this.depth;
    this.fillBox(2, 1, 2, w - 3, 2, d - 3, MAT.TTAN);
    this.fillBox(4, 3, 4, w - 5, 5, d - 5, MAT.SAND);
    this.fillBox(6, 6, 6, w - 7, 9, d - 7, MAT.WATER, 14);
    for (let z = 7; z < d - 7; z += 3) {
      for (let x = 8; x < w - 8; x += 4) this.fillBox(x, 6, z, x, 7 + Math.floor(this.random() * 3), z, MAT.PLANT);
    }
    this.fillBox(3, 3, 3, 3, 12, d - 4, MAT.GLASS);
    this.fillBox(w - 4, 3, 3, w - 4, 12, d - 4, MAT.GLASS);
  }

  buildVolcano() {
    const w = this.width;
    const d = this.depth;
    const cx = Math.floor(w / 2);
    const cz = Math.floor(d / 2);
    this.fillBox(1, 1, 1, w - 2, 2, d - 2, MAT.BRCK);
    for (let y = 3; y < 24; y += 1) {
      const outer = Math.max(4, Math.floor(16 - y * 0.46));
      const inner = Math.max(2, Math.floor(outer * 0.35));
      for (let z = Math.max(1, cz - outer); z <= Math.min(d - 2, cz + outer); z += 1) {
        for (let x = Math.max(1, cx - outer); x <= Math.min(w - 2, cx + outer); x += 1) {
          const distance = Math.hypot(x - cx, z - cz);
          if (distance <= outer && distance >= inner) this.set(x, y, z, MAT.BRCK, 180 + y * 4);
          else if (distance < inner && y < 19) this.set(x, y, z, MAT.LAVA, 1320);
        }
      }
    }
    this.paintSphere(cx, 8, cz, 4, MAT.LAVA, true);
    this.fillBox(cx - 1, 19, cz - 1, cx + 1, 27, cz + 1, MAT.FIRE, 900);
  }
}
