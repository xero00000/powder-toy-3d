// SPDX-License-Identifier: GPL-3.0-or-later

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const NEWTONIAN_GRAVITY = 0.6673;
const CONVOLUTION_PLANS = new Map();

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function fftLine(real, imaginary, offset, stride, length, inverse) {
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i >= j) continue;
    const a = offset + i * stride;
    const b = offset + j * stride;
    [real[a], real[b]] = [real[b], real[a]];
    [imaginary[a], imaginary[b]] = [imaginary[b], imaginary[a]];
  }
  for (let span = 2; span <= length; span *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / span;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += span) {
      let phaseReal = 1;
      let phaseImaginary = 0;
      for (let lane = 0; lane < span / 2; lane += 1) {
        const even = offset + (start + lane) * stride;
        const odd = offset + (start + lane + span / 2) * stride;
        const oddReal = real[odd] * phaseReal - imaginary[odd] * phaseImaginary;
        const oddImaginary = real[odd] * phaseImaginary + imaginary[odd] * phaseReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = phaseReal * stepReal - phaseImaginary * stepImaginary;
        phaseImaginary = phaseReal * stepImaginary + phaseImaginary * stepReal;
        phaseReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < length; i += 1) {
      const index = offset + i * stride;
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

function fft3d(real, imaginary, width, height, depth, inverse = false) {
  const plane = width * height;
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) fftLine(real, imaginary, z * plane + y * width, 1, width, inverse);
  }
  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) fftLine(real, imaginary, z * plane + x, width, height, inverse);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) fftLine(real, imaginary, y * width + x, plane, depth, inverse);
  }
}

export class GravityField3D {
  constructor(voxelWidth, voxelHeight, voxelDepth, cellSize = 4) {
    this.cellSize = cellSize;
    this.width = Math.ceil(voxelWidth / cellSize);
    this.height = Math.ceil(voxelHeight / cellSize);
    this.depth = Math.ceil(voxelDepth / cellSize);
    this.size = this.width * this.height * this.depth;
    this.mass = new Float32Array(this.size);
    this.toolMass = new Float32Array(this.size);
    this.forceX = new Float32Array(this.size);
    this.forceY = new Float32Array(this.size);
    this.forceZ = new Float32Array(this.size);
    this.mask = new Uint8Array(this.size);
    this.mask.fill(1);
    this.sources = [];
    this.lastSolver = "none";
    this.prepareConvolution();
  }

  prepareConvolution() {
    this.fftWidth = nextPowerOfTwo(this.width * 2 - 1);
    this.fftHeight = nextPowerOfTwo(this.height * 2 - 1);
    this.fftDepth = nextPowerOfTwo(this.depth * 2 - 1);
    this.fftSize = this.fftWidth * this.fftHeight * this.fftDepth;
    this.fftPlane = this.fftWidth * this.fftHeight;
    const fftWorkEstimate = this.fftSize * (Math.log2(this.fftWidth) + Math.log2(this.fftHeight) + Math.log2(this.fftDepth)) * 4;
    this.fftSourceThreshold = Math.max(64, Math.ceil(fftWorkEstimate / Math.max(1, this.size)));
    this.kernelSpectra = null;
    this.massSpectrumReal = null;
    this.massSpectrumImaginary = null;
    this.fftWorkReal = null;
    this.fftWorkImaginary = null;
  }

  ensureConvolutionPlan() {
    if (this.kernelSpectra) return;
    const key = `${this.width}x${this.height}x${this.depth}`;
    let spectra = CONVOLUTION_PLANS.get(key);
    if (!spectra) {
      spectra = [];
      const kernels = [new Float64Array(this.fftSize), new Float64Array(this.fftSize), new Float64Array(this.fftSize)];
      for (let dz = 1 - this.depth; dz < this.depth; dz += 1) {
        for (let dy = 1 - this.height; dy < this.height; dy += 1) {
          for (let dx = 1 - this.width; dx < this.width; dx += 1) {
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (!distanceSq) continue;
            const x = dx < 0 ? this.fftWidth + dx : dx;
            const y = dy < 0 ? this.fftHeight + dy : dy;
            const z = dz < 0 ? this.fftDepth + dz : dz;
            const index = x + this.fftWidth * y + this.fftPlane * z;
            const factor = -NEWTONIAN_GRAVITY / (distanceSq * Math.sqrt(distanceSq));
            kernels[0][index] = dx * factor;
            kernels[1][index] = dy * factor;
            kernels[2][index] = dz * factor;
          }
        }
      }
      for (const real of kernels) {
        const imaginary = new Float64Array(this.fftSize);
        fft3d(real, imaginary, this.fftWidth, this.fftHeight, this.fftDepth);
        spectra.push({ real, imaginary });
      }
      CONVOLUTION_PLANS.set(key, spectra);
    }
    this.kernelSpectra = spectra;
    this.massSpectrumReal = new Float64Array(this.fftSize);
    this.massSpectrumImaginary = new Float64Array(this.fftSize);
    this.fftWorkReal = new Float64Array(this.fftSize);
    this.fftWorkImaginary = new Float64Array(this.fftSize);
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
    this.mass.fill(0);
    this.toolMass.fill(0);
    this.forceX.fill(0);
    this.forceY.fill(0);
    this.forceZ.fill(0);
    this.mask.fill(1);
    this.sources = [];
    this.lastSolver = "none";
  }

  injectVoxel(x, y, z, mass) {
    const index = this.indexForVoxel(x, y, z);
    this.toolMass[index] = clamp(this.toolMass[index] + mass, -256, 256);
  }

  sampleVoxel(x, y, z) {
    const index = this.indexForVoxel(x, y, z);
    return {
      mass: this.mass[index],
      forceX: this.forceX[index],
      forceY: this.forceY[index],
      forceZ: this.forceZ[index],
    };
  }

  updateMask(simulation) {
    this.mask.fill(0);
    const gravityWall = simulation.wallIds.DEFAULT_WL_GRVTY;
    const queue = [];
    const enqueue = (x, y, z) => {
      const index = this.index(x, y, z);
      if (this.mask[index] || simulation.walls[index] - 1 === gravityWall) return;
      this.mask[index] = 1;
      queue.push([x, y, z]);
    };
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        enqueue(0, y, z);
        if (this.width > 1) enqueue(this.width - 1, y, z);
      }
    }
    for (let z = 0; z < this.depth; z += 1) {
      for (let x = 0; x < this.width; x += 1) {
        enqueue(x, 0, z);
        if (this.height > 1) enqueue(x, this.height - 1, z);
      }
    }
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        enqueue(x, y, 0);
        if (this.depth > 1) enqueue(x, y, this.depth - 1);
      }
    }
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [x, y, z] = queue[cursor];
      for (const [dx, dy, dz] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (this.inBounds(nx, ny, nz)) enqueue(nx, ny, nz);
      }
    }
  }

  rebuild(simulation) {
    this.updateMask(simulation);
    this.mass.set(this.toolMass);
    this.toolMass.fill(0);

    const massIndex = (voxelIndex) => {
      const [x, y, z] = simulation.coords(voxelIndex);
      return this.indexForVoxel(x, y, z);
    };
    const addMass = (voxelIndex, amount) => {
      if (!amount) return;
      const fieldIndex = massIndex(voxelIndex);
      this.mass[fieldIndex] += amount;
    };
    const setMass = (voxelIndex, amount) => {
      this.mass[massIndex(voxelIndex)] = amount;
    };
    for (let index = 0; index < simulation.size; index += 1) {
      const type = simulation.types[index];
      if (type === simulation.ids.NBHL) addMass(index, clamp(simulation.tmp[index] * 0.001, 0.1, 51.2));
      else if (type === simulation.ids.NWHL) addMass(index, -clamp(simulation.tmp[index] * 0.001, 0.1, 51.2));
      else if (type === simulation.ids.GPMP && simulation.life[index] === 10) setMass(index, clamp(simulation.temperatures[index], -256, 256) * 0.2);
      else if (type === simulation.ids.GBMB && simulation.life[index] > 0) setMass(index, simulation.life[index] > 20 ? 20 : -80);
      if (simulation.energyTypes[index] === simulation.ids.GRVT) setMass(index, simulation.energyTmp[index] * 0.2);
    }

    this.sources = [];
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          if (this.mask[index] && Math.abs(this.mass[index]) >= 0.002) this.sources.push({ x, y, z, index, mass: this.mass[index] });
        }
      }
    }
  }

  solveDirect() {
    this.lastSolver = "direct";
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.index(x, y, z);
          if (!this.mask[index]) continue;
          let fx = 0;
          let fy = 0;
          let fz = 0;
          for (const source of this.sources) {
            const dx = source.x - x;
            const dy = source.y - y;
            const dz = source.z - z;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq === 0) continue;
            const strength = source.mass * NEWTONIAN_GRAVITY / (distanceSq * Math.sqrt(distanceSq));
            fx += dx * strength;
            fy += dy * strength;
            fz += dz * strength;
          }
          this.forceX[index] = fx;
          this.forceY[index] = fy;
          this.forceZ[index] = fz;
        }
      }
    }
  }

  solveConvolution() {
    this.ensureConvolutionPlan();
    this.lastSolver = "fft";
    this.massSpectrumReal.fill(0);
    this.massSpectrumImaginary.fill(0);
    for (let z = 0; z < this.depth; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const fieldIndex = this.index(x, y, z);
          if (this.mask[fieldIndex]) this.massSpectrumReal[x + this.fftWidth * y + this.fftPlane * z] = this.mass[fieldIndex];
        }
      }
    }
    fft3d(this.massSpectrumReal, this.massSpectrumImaginary, this.fftWidth, this.fftHeight, this.fftDepth);
    const outputs = [this.forceX, this.forceY, this.forceZ];
    for (let component = 0; component < outputs.length; component += 1) {
      const spectrum = this.kernelSpectra[component];
      for (let index = 0; index < this.fftSize; index += 1) {
        this.fftWorkReal[index] = this.massSpectrumReal[index] * spectrum.real[index]
          - this.massSpectrumImaginary[index] * spectrum.imaginary[index];
        this.fftWorkImaginary[index] = this.massSpectrumReal[index] * spectrum.imaginary[index]
          + this.massSpectrumImaginary[index] * spectrum.real[index];
      }
      fft3d(this.fftWorkReal, this.fftWorkImaginary, this.fftWidth, this.fftHeight, this.fftDepth, true);
      const output = outputs[component];
      for (let z = 0; z < this.depth; z += 1) {
        for (let y = 0; y < this.height; y += 1) {
          for (let x = 0; x < this.width; x += 1) {
            const fieldIndex = this.index(x, y, z);
            output[fieldIndex] = this.mask[fieldIndex]
              ? this.fftWorkReal[x + this.fftWidth * y + this.fftPlane * z] : 0;
          }
        }
      }
    }
  }

  solve() {
    this.forceX.fill(0);
    this.forceY.fill(0);
    this.forceZ.fill(0);
    if (!this.sources.length) { this.lastSolver = "none"; return; }
    if (this.sources.length >= this.fftSourceThreshold) this.solveConvolution();
    else this.solveDirect();
  }

  step(simulation) {
    this.rebuild(simulation);
    this.solve(simulation);
  }

  stats() {
    let peakMass = 0;
    let peakForce = 0;
    for (let index = 0; index < this.size; index += 1) {
      peakMass = Math.max(peakMass, Math.abs(this.mass[index]));
      peakForce = Math.max(peakForce, Math.hypot(this.forceX[index], this.forceY[index], this.forceZ[index]));
    }
    return { peakMass, peakForce, sources: this.sources.length, solver: this.lastSolver };
  }
}
