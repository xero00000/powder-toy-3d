// SPDX-License-Identifier: GPL-3.0-or-later

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const AIR_TSTEPP = 0.3;
const AIR_TSTEPV = 0.4;
const AIR_VADV = 0.3;
const AIR_VLOSS = 0.999;
const AIR_PLOSS = 0.9999;
const ADV_DISTANCE_MULT = 0.7;
const MAX_PRESSURE = 256;
const MIN_TEMPERATURE = -273.15;
const MAX_TEMPERATURE = 9725.85;

export class AirField3D {
  constructor(voxelWidth, voxelHeight, voxelDepth, cellSize = 4) {
    this.cellSize = cellSize;
    this.width = Math.ceil(voxelWidth / cellSize);
    this.height = Math.ceil(voxelHeight / cellSize);
    this.depth = Math.ceil(voxelDepth / cellSize);
    this.size = this.width * this.height * this.depth;
    this.pressure = new Float32Array(this.size);
    this.velocityX = new Float32Array(this.size);
    this.velocityY = new Float32Array(this.size);
    this.velocityZ = new Float32Array(this.size);
    this.ambientHeat = new Float32Array(this.size);
    this.ambientHeat.fill(22);
    this.blocked = new Uint8Array(this.size);
    this.heatBlocked = new Uint8Array(this.size);
    this.nextPressure = new Float32Array(this.size);
    this.nextVelocityX = new Float32Array(this.size);
    this.nextVelocityY = new Float32Array(this.size);
    this.nextVelocityZ = new Float32Array(this.size);
    this.nextAmbientHeat = new Float32Array(this.size);
    this.mode = 0;
    this.ambientTemperature = 22;
    this.ambientHeatEnabled = true;
    this.edgePressure = 0;
    this.edgeVelocityX = 0;
    this.edgeVelocityY = 0;
    this.edgeVelocityZ = 0;
    this.vorticityCoeff = 0.1;
    this.convectionMode = 2;
    const kernel = [];
    let kernelTotal = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const weight = Math.exp(-2 * (dx * dx + dy * dy + dz * dz));
          kernel.push([dx, dy, dz, weight]);
          kernelTotal += weight;
        }
      }
    }
    this.kernel = kernel.map(([dx, dy, dz, weight]) => [dx, dy, dz, weight / kernelTotal]);
  }

  index(x, y, z) {
    return x + this.width * (y + this.height * z);
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth;
  }

  cellForVoxel(x, y, z) {
    return [
      clamp(Math.floor(x / this.cellSize), 0, this.width - 1),
      clamp(Math.floor(y / this.cellSize), 0, this.height - 1),
      clamp(Math.floor(z / this.cellSize), 0, this.depth - 1),
    ];
  }

  indexForVoxel(x, y, z) {
    const [cx, cy, cz] = this.cellForVoxel(x, y, z);
    return this.index(cx, cy, cz);
  }

  clear() {
    this.pressure.fill(this.edgePressure);
    this.velocityX.fill(this.edgeVelocityX);
    this.velocityY.fill(this.edgeVelocityY);
    this.velocityZ.fill(this.edgeVelocityZ);
    this.ambientHeat.fill(this.ambientTemperature);
    this.blocked.fill(0);
    this.heatBlocked.fill(0);
  }

  sampleVoxel(x, y, z) {
    const index = this.indexForVoxel(x, y, z);
    return {
      pressure: this.pressure[index],
      velocityX: this.velocityX[index],
      velocityY: this.velocityY[index],
      velocityZ: this.velocityZ[index],
      temperature: this.ambientHeat[index],
    };
  }

  injectVoxel(x, y, z, pressure = 0, heat = 0, velocityX = 0, velocityY = 0, velocityZ = 0) {
    const index = this.indexForVoxel(x, y, z);
    if (this.blocked[index]) return;
    this.pressure[index] = clamp(this.pressure[index] + pressure, -256, 256);
    this.ambientHeat[index] = clamp(this.ambientHeat[index] + heat, MIN_TEMPERATURE, MAX_TEMPERATURE);
    this.velocityX[index] = clamp(this.velocityX[index] + velocityX, -MAX_PRESSURE, MAX_PRESSURE);
    this.velocityY[index] = clamp(this.velocityY[index] + velocityY, -MAX_PRESSURE, MAX_PRESSURE);
    this.velocityZ[index] = clamp(this.velocityZ[index] + velocityZ, -MAX_PRESSURE, MAX_PRESSURE);
  }

  updateBlocked(simulation) {
    this.blocked.fill(0);
    const heatThreshold = Math.max(1, Math.floor(this.cellSize ** 3 * 0.5));
    const heatCounts = new Float32Array(this.size);
    const titaniumBlocks = new Uint8Array(this.size);
    const titanium = simulation.ids?.TTAN;
    const solidResist = simulation.ids?.RSSS;
    for (let z = 0; z < simulation.depth; z += 1) {
      for (let y = 0; y < simulation.height; y += 1) {
        for (let x = 0; x < simulation.width; x += 1) {
          const particleIndex = simulation.index(x, y, z);
          const type = simulation.types[particleIndex];
          if (!type) continue;
          const material = simulation.materialAt(type);
          const fieldIndex = this.indexForVoxel(x, y, z);
          const heatInsulator = material.upstream?.heatConduct === 0
            || (type === simulation.ids?.HSWC && simulation.life[particleIndex] !== 10)
            || ((type === simulation.ids?.PIPE || type === simulation.ids?.PPIP) && !(simulation.tmp[particleIndex] & 1));
          const gelScale = type === simulation.ids?.GEL ? simulation.tmp[particleIndex] * 2.55 : 1;
          const conductChance = (material.upstream?.heatConduct ?? Math.round((material.conductivity ?? 0) * 255)) * gelScale / 250;
          heatCounts[fieldIndex] += heatInsulator ? 1 : Math.max(0, 1 - Math.min(1, conductChance));
          if (type === solidResist) titaniumBlocks[fieldIndex] = 1;
          if (type === titanium) {
            let occupied = 0;
            let faceTitanium = 0;
            for (let dz = -1; dz <= 1; dz += 1) {
              for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  if (dx === 0 && dy === 0 && dz === 0) continue;
                  const nx = x + dx;
                  const ny = y + dy;
                  const nz = z + dz;
                  const neighbor = simulation.inBounds(nx, ny, nz) ? simulation.types[simulation.index(nx, ny, nz)] : 0;
                  if (neighbor !== 0) occupied += 1;
                  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1 && neighbor === titanium) faceTitanium += 1;
                }
              }
            }
            if (occupied <= 2 || simulation.tmp[particleIndex] !== 0 || (occupied <= 6 && faceTitanium >= 2)) {
              titaniumBlocks[this.indexForVoxel(x, y, z)] = 1;
            }
          }
        }
      }
    }
    for (let index = 0; index < this.size; index += 1) {
      const encodedWall = simulation.walls?.[index] ?? 0;
      const wall = encodedWall ? encodedWall - 1 : null;
      const wallBlocksAir = wall === 1 || wall === 8 || wall === 16 || (wall === 2 && !(simulation.wallElectricity?.[index] > 0));
      this.blocked[index] = titaniumBlocks[index] || wallBlocksAir ? 1 : 0;
      this.heatBlocked[index] = this.blocked[index] || wall === 14 || titaniumBlocks[index] || heatCounts[index] >= heatThreshold ? 1 : 0;
    }
  }

  neighborValue(field, x, y, z, fallback, outside = fallback) {
    if (!this.inBounds(x, y, z)) return outside;
    const index = this.index(x, y, z);
    return this.blocked[index] ? fallback : field[index];
  }

  curlAt(x, y, z) {
    if (!this.inBounds(x, y, z) || this.blocked[this.index(x, y, z)]) return [0, 0, 0];
    const index = this.index(x, y, z);
    const vx = this.velocityX[index];
    const vy = this.velocityY[index];
    const vz = this.velocityZ[index];
    const dxVy = (this.neighborValue(this.velocityY, x + 1, y, z, vy, this.edgeVelocityY) - this.neighborValue(this.velocityY, x - 1, y, z, vy, this.edgeVelocityY)) * 0.5;
    const dxVz = (this.neighborValue(this.velocityZ, x + 1, y, z, vz, this.edgeVelocityZ) - this.neighborValue(this.velocityZ, x - 1, y, z, vz, this.edgeVelocityZ)) * 0.5;
    const dyVx = (this.neighborValue(this.velocityX, x, y + 1, z, vx, this.edgeVelocityX) - this.neighborValue(this.velocityX, x, y - 1, z, vx, this.edgeVelocityX)) * 0.5;
    const dyVz = (this.neighborValue(this.velocityZ, x, y + 1, z, vz, this.edgeVelocityZ) - this.neighborValue(this.velocityZ, x, y - 1, z, vz, this.edgeVelocityZ)) * 0.5;
    const dzVx = (this.neighborValue(this.velocityX, x, y, z + 1, vx, this.edgeVelocityX) - this.neighborValue(this.velocityX, x, y, z - 1, vx, this.edgeVelocityX)) * 0.5;
    const dzVy = (this.neighborValue(this.velocityY, x, y, z + 1, vy, this.edgeVelocityY) - this.neighborValue(this.velocityY, x, y, z - 1, vy, this.edgeVelocityY)) * 0.5;
    return [dyVz - dzVy, dzVx - dxVz, dxVy - dyVx];
  }

  curlMagnitudeAt(x, y, z) {
    const [cx, cy, cz] = this.curlAt(x, y, z);
    return Math.hypot(cx, cy, cz);
  }

  gaussianAt(field, x, y, z, blocked = this.blocked) {
    const fallback = field[this.index(x, y, z)];
    let value = 0;
    for (const [dx, dy, dz, weight] of this.kernel) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) value += fallback * weight;
      else {
        const neighbor = this.index(nx, ny, nz);
        value += (blocked[neighbor] ? fallback : field[neighbor]) * weight;
      }
    }
    return value;
  }

  traceAdvectionSource(x, y, z, sourceX, sourceY, sourceZ, blocked) {
    const dx = sourceX - x;
    const dy = sourceY - y;
    const dz = sourceZ - z;
    const steps = Math.floor(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)));
    if (steps <= 1) return [sourceX, sourceY, sourceZ];
    let lastX = x;
    let lastY = y;
    let lastZ = z;
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      const tx = x + dx * fraction;
      const ty = y + dy * fraction;
      const tz = z + dz * fraction;
      const cx = Math.round(tx);
      const cy = Math.round(ty);
      const cz = Math.round(tz);
      if (!this.inBounds(cx, cy, cz) || blocked[this.index(cx, cy, cz)]) return [lastX, lastY, lastZ];
      lastX = tx;
      lastY = ty;
      lastZ = tz;
    }
    return [sourceX, sourceY, sourceZ];
  }

  trilinearAt(field, x, y, z, fallback, blocked = this.blocked) {
    if (x < 0 || y < 0 || z < 0 || x > this.width - 1 || y > this.height - 1 || z > this.depth - 1) return fallback;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = Math.min(this.width - 1, x0 + 1);
    const y1 = Math.min(this.height - 1, y0 + 1);
    const z1 = Math.min(this.depth - 1, z0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    let value = 0;
    for (const [cx, wx] of [[x0, 1 - fx], [x1, fx]]) {
      for (const [cy, wy] of [[y0, 1 - fy], [y1, fy]]) {
        for (const [cz, wz] of [[z0, 1 - fz], [z1, fz]]) {
          const index = this.index(cx, cy, cz);
          value += (blocked[index] ? fallback : field[index]) * wx * wy * wz;
        }
      }
    }
    return value;
  }

  boundaryAxes(x, y, z) {
    const tx = this.width >= 5 ? 2 : 1;
    const ty = this.height >= 5 ? 2 : 1;
    const tz = this.depth >= 5 ? 2 : 1;
    return Number(x < tx || x >= this.width - tx)
      + Number(y < ty || y >= this.height - ty)
      + Number(z < tz || z >= this.depth - tz);
  }

  updateAmbientHeat(simulation) {
    if (!this.ambientHeatEnabled) return;
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          if (this.boundaryAxes(x, y, z)) this.ambientHeat[this.index(x, y, z)] = this.ambientTemperature;
        }
      }
    }
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          const heat = this.ambientHeat[index];
          if (this.heatBlocked[index]) {
            this.nextAmbientHeat[index] = heat;
            continue;
          }
          let nextHeat = this.gaussianAt(this.ambientHeat, x, y, z, this.heatBlocked);
          const velocityX = this.gaussianAt(this.velocityX, x, y, z, this.heatBlocked);
          const velocityY = this.gaussianAt(this.velocityY, x, y, z, this.heatBlocked);
          const velocityZ = this.gaussianAt(this.velocityZ, x, y, z, this.heatBlocked);
          let sourceX = x - velocityX * ADV_DISTANCE_MULT;
          let sourceY = y - velocityY * ADV_DISTANCE_MULT;
          let sourceZ = z - velocityZ * ADV_DISTANCE_MULT;
          [sourceX, sourceY, sourceZ] = this.traceAdvectionSource(x, y, z, sourceX, sourceY, sourceZ, this.heatBlocked);
          const advected = this.trilinearAt(this.ambientHeat, sourceX, sourceY, sourceZ, nextHeat, this.heatBlocked);
          nextHeat = nextHeat * (1 - AIR_VADV) + advected * AIR_VADV;
          this.nextAmbientHeat[index] = clamp(nextHeat, MIN_TEMPERATURE, MAX_TEMPERATURE);

          if (!this.convectionMode) continue;
          const voxelX = Math.min((x + 0.5) * this.cellSize, (simulation?.width ?? this.width * this.cellSize) - 1);
          const voxelY = Math.min((y + 0.5) * this.cellSize, (simulation?.height ?? this.height * this.cellSize) - 1);
          const voxelZ = Math.min((z + 0.5) * this.cellSize, (simulation?.depth ?? this.depth * this.cellSize) - 1);
          const gravity = simulation?.gravityVectorAt
            ? simulation.gravityVectorAt(voxelX, voxelY, voxelZ, true)
            : [0, 1, 0];
          let [gx, gy, gz] = gravity;
          const gravityMagnitude = Math.hypot(gx, gy, gz);
          if (gravityMagnitude > 10) {
            gx *= 10 / gravityMagnitude;
            gy *= 10 / gravityMagnitude;
            gz *= 10 / gravityMagnitude;
          }
          let weight;
          if (this.convectionMode === 1) {
            const hx = this.neighborValue(this.ambientHeat, x - 1, y, z, heat, this.ambientTemperature);
            const hy = this.neighborValue(this.ambientHeat, x, y - 1, z, heat, this.ambientTemperature);
            const hz = this.neighborValue(this.ambientHeat, x, y, z - 1, heat, this.ambientTemperature);
            weight = ((heat - hx) * gx + (heat - hy) * gy + (heat - hz) * gz) / 5000;
            if (weight <= 0) continue;
          } else weight = Math.min(0.01, (heat - this.ambientTemperature) / 10000);
          this.velocityX[index] = clamp(this.velocityX[index] + weight * gx, -MAX_PRESSURE, MAX_PRESSURE);
          this.velocityY[index] = clamp(this.velocityY[index] + weight * gy, -MAX_PRESSURE, MAX_PRESSURE);
          this.velocityZ[index] = clamp(this.velocityZ[index] + weight * gz, -MAX_PRESSURE, MAX_PRESSURE);
        }
      }
    }
    [this.ambientHeat, this.nextAmbientHeat] = [this.nextAmbientHeat, this.ambientHeat];
  }

  step(simulation = null) {
    if (this.mode === 4) return;

    // The first two upstream edge cells are damped independently along each
    // boundary axis; corners therefore receive the mix more than once.
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          const axes = this.boundaryAxes(x, y, z);
          if (!axes) continue;
          this.pressure[index] = this.edgePressure + (this.pressure[index] - this.edgePressure) * (0.8 ** axes);
          this.velocityX[index] = this.edgeVelocityX + (this.velocityX[index] - this.edgeVelocityX) * (0.9 ** axes);
          this.velocityY[index] = this.edgeVelocityY + (this.velocityY[index] - this.edgeVelocityY) * (0.9 ** axes);
          this.velocityZ[index] = this.edgeVelocityZ + (this.velocityZ[index] - this.edgeVelocityZ) * (0.9 ** axes);
        }
      }
    }

    // Remove the normal component of velocity on both sides of air-blocking
    // cells, matching the no-through-wall condition used by the 2D solver.
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          if (!this.blocked[index]) continue;
          for (const nx of [x - 1, x, x + 1]) if (this.inBounds(nx, y, z)) this.velocityX[this.index(nx, y, z)] = 0;
          for (const ny of [y - 1, y, y + 1]) if (this.inBounds(x, ny, z)) this.velocityY[this.index(x, ny, z)] = 0;
          for (const nz of [z - 1, z, z + 1]) if (this.inBounds(x, y, nz)) this.velocityZ[this.index(x, y, nz)] = 0;
        }
      }
    }

    // Pressure from velocity divergence.
    for (let z = 1; z < this.depth - 1; z += 1) {
      for (let y = 1; y < this.height - 1; y += 1) {
        for (let x = 1; x < this.width - 1; x += 1) {
          const index = this.index(x, y, z);
          const divergence = this.velocityX[this.index(x - 1, y, z)] - this.velocityX[this.index(x + 1, y, z)]
            + this.velocityY[this.index(x, y - 1, z)] - this.velocityY[this.index(x, y + 1, z)]
            + this.velocityZ[this.index(x, y, z - 1)] - this.velocityZ[this.index(x, y, z + 1)];
          this.pressure[index] = this.edgePressure + (this.pressure[index] - this.edgePressure) * AIR_PLOSS
            + divergence * AIR_TSTEPP * 0.5;
        }
      }
    }

    // Velocity from the pressure gradient.
    for (let z = 1; z < this.depth - 1; z += 1) {
      for (let y = 1; y < this.height - 1; y += 1) {
        for (let x = 1; x < this.width - 1; x += 1) {
          const index = this.index(x, y, z);
          this.velocityX[index] = this.edgeVelocityX + (this.velocityX[index] - this.edgeVelocityX) * AIR_VLOSS
            + (this.pressure[this.index(x - 1, y, z)] - this.pressure[this.index(x + 1, y, z)]) * AIR_TSTEPV * 0.5;
          this.velocityY[index] = this.edgeVelocityY + (this.velocityY[index] - this.edgeVelocityY) * AIR_VLOSS
            + (this.pressure[this.index(x, y - 1, z)] - this.pressure[this.index(x, y + 1, z)]) * AIR_TSTEPV * 0.5;
          this.velocityZ[index] = this.edgeVelocityZ + (this.velocityZ[index] - this.edgeVelocityZ) * AIR_VLOSS
            + (this.pressure[this.index(x, y, z - 1)] - this.pressure[this.index(x, y, z + 1)]) * AIR_TSTEPV * 0.5;
          if (this.blocked[this.index(x - 1, y, z)] || this.blocked[index] || this.blocked[this.index(x + 1, y, z)]) this.velocityX[index] = 0;
          if (this.blocked[this.index(x, y - 1, z)] || this.blocked[index] || this.blocked[this.index(x, y + 1, z)]) this.velocityY[index] = 0;
          if (this.blocked[this.index(x, y, z - 1)] || this.blocked[index] || this.blocked[this.index(x, y, z + 1)]) this.velocityZ[index] = 0;
        }
      }
    }

    // Gaussian smoothing, semi-Lagrangian advection, and vorticity
    // confinement form a direct 3D generalization of Air::update_air.
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          let nextPressure = this.gaussianAt(this.pressure, x, y, z);
          let nextVelocityX = this.gaussianAt(this.velocityX, x, y, z);
          let nextVelocityY = this.gaussianAt(this.velocityY, x, y, z);
          let nextVelocityZ = this.gaussianAt(this.velocityZ, x, y, z);
          if (!this.blocked[index]) {
            let sourceX = x - nextVelocityX * ADV_DISTANCE_MULT;
            let sourceY = y - nextVelocityY * ADV_DISTANCE_MULT;
            let sourceZ = z - nextVelocityZ * ADV_DISTANCE_MULT;
            [sourceX, sourceY, sourceZ] = this.traceAdvectionSource(x, y, z, sourceX, sourceY, sourceZ, this.blocked);
            nextVelocityX = nextVelocityX * (1 - AIR_VADV)
              + this.trilinearAt(this.velocityX, sourceX, sourceY, sourceZ, nextVelocityX) * AIR_VADV;
            nextVelocityY = nextVelocityY * (1 - AIR_VADV)
              + this.trilinearAt(this.velocityY, sourceX, sourceY, sourceZ, nextVelocityY) * AIR_VADV;
            nextVelocityZ = nextVelocityZ * (1 - AIR_VADV)
              + this.trilinearAt(this.velocityZ, sourceX, sourceY, sourceZ, nextVelocityZ) * AIR_VADV;
          }
          if (this.vorticityCoeff > 0 && x > 1 && x < this.width - 2 && y > 1 && y < this.height - 2 && z > 1 && z < this.depth - 2) {
            const [curlX, curlY, curlZ] = this.curlAt(x, y, z);
            const gradientX = (this.curlMagnitudeAt(x + 1, y, z) - this.curlMagnitudeAt(x - 1, y, z)) * 0.5;
            const gradientY = (this.curlMagnitudeAt(x, y + 1, z) - this.curlMagnitudeAt(x, y - 1, z)) * 0.5;
            const gradientZ = (this.curlMagnitudeAt(x, y, z + 1) - this.curlMagnitudeAt(x, y, z - 1)) * 0.5;
            const norm = Math.hypot(gradientX, gradientY, gradientZ) + 0.001;
            const strength = this.vorticityCoeff / 5;
            nextVelocityX += strength * (gradientY * curlZ - gradientZ * curlY) / norm;
            nextVelocityY += strength * (gradientZ * curlX - gradientX * curlZ) / norm;
            nextVelocityZ += strength * (gradientX * curlY - gradientY * curlX) / norm;
          }
          if (this.mode === 1 || this.mode === 3) nextPressure = 0;
          if (this.mode === 2 || this.mode === 3) nextVelocityX = nextVelocityY = nextVelocityZ = 0;
          this.nextPressure[index] = clamp(nextPressure, -MAX_PRESSURE, MAX_PRESSURE);
          this.nextVelocityX[index] = clamp(nextVelocityX, -MAX_PRESSURE, MAX_PRESSURE);
          this.nextVelocityY[index] = clamp(nextVelocityY, -MAX_PRESSURE, MAX_PRESSURE);
          this.nextVelocityZ[index] = clamp(nextVelocityZ, -MAX_PRESSURE, MAX_PRESSURE);
        }
      }
    }

    [this.pressure, this.nextPressure] = [this.nextPressure, this.pressure];
    [this.velocityX, this.nextVelocityX] = [this.nextVelocityX, this.velocityX];
    [this.velocityY, this.nextVelocityY] = [this.nextVelocityY, this.velocityY];
    [this.velocityZ, this.nextVelocityZ] = [this.nextVelocityZ, this.velocityZ];
    this.updateAmbientHeat(simulation);
  }

  stats() {
    let maxPressure = 0;
    let maxVelocity = 0;
    let peakTemperature = 22;
    for (let index = 0; index < this.size; index += 1) {
      maxPressure = Math.max(maxPressure, Math.abs(this.pressure[index]));
      maxVelocity = Math.max(maxVelocity, Math.hypot(this.velocityX[index], this.velocityY[index], this.velocityZ[index]));
      peakTemperature = Math.max(peakTemperature, this.ambientHeat[index]);
    }
    return { maxPressure, maxVelocity, peakTemperature };
  }
}
