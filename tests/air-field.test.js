// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { AirField3D } from "../src/air-field.js";
import { GravityField3D } from "../src/gravity-field.js";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";

test("3D pressure impulses spread into neighboring air cells", () => {
  const air = new AirField3D(12, 12, 12, 4);
  air.injectVoxel(6, 6, 6, 24, 180, 1, 2, -1);
  air.step();
  const center = air.index(1, 1, 1);
  const neighbor = air.index(2, 1, 1);
  assert.ok(air.pressure[center] > 0);
  assert.ok(air.pressure[neighbor] > 0);
  assert.ok(air.ambientHeat[neighbor] > 22);
  assert.ok(air.stats().maxVelocity > 0);
});

test("3D air kernel and loss constants match the upstream solver generalization", () => {
  const air = new AirField3D(44, 44, 44, 4);
  const weightTotal = air.kernel.reduce((total, entry) => total + entry[3], 0);
  const centerWeight = air.kernel.find(([x, y, z]) => x === 0 && y === 0 && z === 0)[3];
  const faceWeight = air.kernel.find(([x, y, z]) => x === 1 && y === 0 && z === 0)[3];
  assert.ok(Math.abs(weightTotal - 1) < 1e-12);
  assert.ok(Math.abs(faceWeight / centerWeight - Math.exp(-2)) < 1e-12);

  air.pressure.fill(10);
  air.velocityX.fill(1);
  air.ambientHeat.fill(100);
  air.vorticityCoeff = 0;
  air.convectionMode = 0;
  air.step();
  const center = air.index(5, 5, 5);
  assert.ok(Math.abs(air.pressure[center] - 9.999) < 0.00001);
  assert.ok(Math.abs(air.velocityX[center] - 0.999) < 0.00001);
  assert.ok(Math.abs(air.ambientHeat[center] - 100) < 0.00001);
});

test("air walls suppress normal flow while gravity walls separately block ambient heat", () => {
  const sim = new VoxelSimulation(28, 28, 28, 0x5150);
  const [cx, cy, cz] = [3, 3, 3];
  const center = sim.air.index(cx, cy, cz);
  const wall = sim.wallIds.DEFAULT_WL_WALL;
  sim.walls[center] = wall + 1;
  sim.air.velocityX[sim.air.index(cx - 1, cy, cz)] = 20;
  sim.air.updateBlocked(sim);
  sim.air.vorticityCoeff = 0;
  sim.air.convectionMode = 0;
  sim.air.step(sim);
  assert.equal(sim.air.velocityX[sim.air.index(cx - 1, cy, cz)], 0);
  assert.equal(sim.air.velocityX[center], 0);

  sim.walls[center] = sim.wallIds.DEFAULT_WL_GRVTY + 1;
  sim.air.ambientHeat[center] = 1000;
  sim.air.updateBlocked(sim);
  assert.equal(sim.air.blocked[center], 0);
  assert.equal(sim.air.heatBlocked[center], 1);
  sim.air.step(sim);
  assert.equal(sim.air.ambientHeat[center], 1000);
});

test("only upstream air blockers stop flow while dense low-conductivity matter blocks heat", () => {
  const stone = new VoxelSimulation(12, 12, 12, 0x5154);
  for (let z = 4; z < 8; z += 1) for (let y = 4; y < 8; y += 1) for (let x = 4; x < 8; x += 1) stone.set(x, y, z, MAT.STNE);
  stone.air.updateBlocked(stone);
  const cell = stone.air.indexForVoxel(5, 5, 5);
  assert.equal(stone.air.blocked[cell], 0);

  const titanium = new VoxelSimulation(12, 12, 12, 0x5155);
  titanium.set(5, 5, 5, MAT.TTAN);
  titanium.air.updateBlocked(titanium);
  assert.equal(titanium.air.blocked[titanium.air.indexForVoxel(5, 5, 5)], 1);

  const water = new VoxelSimulation(12, 12, 12, 0x5156);
  for (let z = 4; z < 8; z += 1) for (let y = 4; y < 8; y += 1) for (let x = 4; x < 8; x += 1) water.set(x, y, z, MAT.WATR);
  water.air.updateBlocked(water);
  const waterCell = water.air.indexForVoxel(5, 5, 5);
  assert.equal(water.air.blocked[waterCell], 0);
  assert.equal(water.air.heatBlocked[waterCell], 1);
});

test("Boussinesq convection follows inverse custom gravity with the upstream cap", () => {
  const sim = new VoxelSimulation(28, 28, 28, 0x5151);
  sim.gravityMode = 3;
  sim.customGravity = [1, 0, 0];
  sim.air.vorticityCoeff = 0;
  sim.air.convectionMode = 2;
  const center = sim.air.index(3, 3, 3);
  sim.air.ambientHeat[center] = 2022;
  sim.air.step(sim);
  assert.ok(sim.air.velocityX[center] < 0);
  assert.ok(sim.air.velocityX[center] >= -0.011);
});

test("Newtonian gravity uses the upstream constant and inverse-square falloff in 3D", () => {
  const sim = new VoxelSimulation(28, 28, 28, 0x5152);
  sim.gravity.injectVoxel(13, 13, 13, 1);
  sim.gravity.step(sim);
  const distanceOne = sim.gravity.sampleVoxel(9, 13, 13);
  const distanceTwo = sim.gravity.sampleVoxel(5, 13, 13);
  const source = sim.gravity.sampleVoxel(13, 13, 13);
  assert.ok(Math.abs(distanceOne.forceX - 0.6673) < 1e-5);
  assert.ok(Math.abs(distanceTwo.forceX - 0.6673 / 4) < 1e-5);
  assert.equal(source.forceX, 0);
  assert.equal(source.forceY, 0);
  assert.equal(source.forceZ, 0);
});

test("dense Newtonian sources use the exact zero-padded 3D FFT convolution", () => {
  const gravity = new GravityField3D(32, 32, 32, 4);
  for (let z = 0; z < gravity.depth; z += 1) {
    for (let y = 0; y < gravity.height; y += 1) {
      for (let x = 0; x < gravity.width; x += 1) {
        const index = gravity.index(x, y, z);
        const mass = 0.25 + ((x + 2 * y + 3 * z) % 7) * 0.125;
        gravity.mass[index] = mass;
        gravity.sources.push({ x, y, z, index, mass });
      }
    }
  }
  gravity.solve();
  assert.equal(gravity.lastSolver, "fft");
  const [tx, ty, tz] = [2, 5, 6];
  let expectedX = 0;
  let expectedY = 0;
  let expectedZ = 0;
  for (const source of gravity.sources) {
    const dx = source.x - tx;
    const dy = source.y - ty;
    const dz = source.z - tz;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (!distanceSq) continue;
    const strength = source.mass * 0.6673 / (distanceSq * Math.sqrt(distanceSq));
    expectedX += dx * strength;
    expectedY += dy * strength;
    expectedZ += dz * strength;
  }
  const actual = gravity.sampleVoxel(tx * 4, ty * 4, tz * 4);
  assert.ok(Math.abs(actual.forceX - expectedX) < 1e-4);
  assert.ok(Math.abs(actual.forceY - expectedY) < 1e-4);
  assert.ok(Math.abs(actual.forceZ - expectedZ) < 1e-4);
});

test("closed 3D gravity-wall shells mask both enclosed sources and force", () => {
  const sim = new VoxelSimulation(20, 20, 20, 0x5153);
  const gravityWall = sim.wallIds.DEFAULT_WL_GRVTY;
  for (let z = 1; z <= 3; z += 1) {
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 1 || x === 3 || y === 1 || y === 3 || z === 1 || z === 3) sim.walls[sim.air.index(x, y, z)] = gravityWall + 1;
      }
    }
  }
  sim.gravity.injectVoxel(1, 9, 9, 5);
  sim.gravity.step(sim);
  assert.equal(sim.gravity.mask[sim.gravity.index(2, 2, 2)], 0);
  assert.equal(sim.gravity.sampleVoxel(9, 9, 9).forceX, 0);

  sim.gravity.injectVoxel(9, 9, 9, 5);
  sim.gravity.step(sim);
  assert.equal(sim.gravity.sources.length, 0);
  assert.equal(sim.gravity.sampleVoxel(1, 9, 9).forceX, 0);
});

test("particle property fields survive cellular movement", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x8899);
  sim.heatSimulationEnabled = false;
  sim.set(4, 7, 4, MAT.SAND, 44, 12, {
    ctype: MAT.WATR,
    tmp: 1234,
    tmp2: -77,
    velocityX: 1.25,
    velocityY: -0.5,
    velocityZ: 0.75,
    flags: 9,
    decoration: 0xff44aa22,
  });
  sim.step();
  const index = sim.types.indexOf(MAT.SAND);
  assert.notEqual(index, -1);
  assert.ok(Math.abs(sim.temperatures[index] - 44) < 0.2);
  assert.equal(sim.life[index], 12);
  assert.equal(sim.ctype[index], MAT.WATR);
  assert.equal(sim.tmp[index], 1234);
  assert.equal(sim.tmp2[index], -77);
  assert.equal(sim.flags[index], 9);
  assert.equal(sim.decorations[index], 0xff44aa22);
});

test("all upstream gravity modes steer 3D particle gravity", () => {
  const off = new VoxelSimulation(12, 12, 12, 0xa110);
  off.gravityMode = 1;
  off.set(5, 8, 5, MAT.DUST);
  off.step();
  assert.equal(off.get(5, 8, 5), MAT.DUST);

  const radial = new VoxelSimulation(12, 12, 12, 0xa111);
  radial.gravityMode = 2;
  radial.set(2, 6, 6, MAT.DUST);
  radial.step();
  assert.equal(radial.get(3, 6, 6), MAT.DUST);

  const custom = new VoxelSimulation(12, 12, 12, 0xa112);
  custom.gravityMode = 3;
  custom.customGravity = [0, 0, 1];
  custom.set(5, 6, 4, MAT.DUST);
  custom.step();
  assert.equal(custom.get(5, 6, 5), MAT.DUST);
});

test("air pressure-off, velocity-off, off and frozen modes match upstream controls", () => {
  for (const [mode, expectedPressure, expectedVelocity] of [[1, 0, true], [2, true, 0], [3, 0, 0]]) {
    const sim = new VoxelSimulation(12, 12, 12, 0xa120 + mode);
    sim.air.mode = mode;
    sim.air.injectVoxel(6, 6, 6, 12, 0, 4, -3, 2);
    sim.air.step();
    const sample = sim.air.sampleVoxel(6, 6, 6);
    if (expectedPressure === true) assert.notEqual(sample.pressure, 0);
    else assert.equal(sample.pressure, expectedPressure);
    if (expectedVelocity === true) assert.notEqual(Math.hypot(sample.velocityX, sample.velocityY, sample.velocityZ), 0);
    else assert.equal(Math.hypot(sample.velocityX, sample.velocityY, sample.velocityZ), expectedVelocity);
  }
  const frozen = new VoxelSimulation(12, 12, 12, 0xa124);
  frozen.air.mode = 4;
  frozen.air.injectVoxel(6, 6, 6, 12, 10, 4, -3, 2);
  const before = frozen.air.sampleVoxel(6, 6, 6);
  frozen.air.step();
  assert.deepEqual(frozen.air.sampleVoxel(6, 6, 6), before);
});

test("ambient heat can be disabled and uses a configurable equilibrium temperature", () => {
  const sim = new VoxelSimulation(12, 12, 12, 0xa130);
  sim.air.ambientTemperature = 40;
  sim.air.clear();
  assert.equal(sim.air.sampleVoxel(5, 5, 5).temperature, 40);
  sim.set(5, 5, 5, MAT.METL, 100);
  sim.air.ambientHeatEnabled = false;
  const index = sim.index(5, 5, 5);
  sim.conductHeat(index, 5, 5, 5);
  assert.equal(sim.temperatures[index], 100);
});

test("particle heat exchange follows upstream probability, capacity and ambient coefficients", () => {
  const ambient = new VoxelSimulation(9, 9, 9, 0xa131);
  ambient.random = () => 0;
  ambient.set(4, 4, 4, MAT.METL, 22);
  const ambientIndex = ambient.index(4, 4, 4);
  const airIndex = ambient.air.indexForVoxel(4, 4, 4);
  ambient.air.ambientHeat[airIndex] = 222;
  assert.equal(ambient.conductHeat(ambientIndex, 4, 4, 4), true);
  assert.ok(Math.abs(ambient.temperatures[ambientIndex] - 30) < 1e-6);
  assert.ok(Math.abs(ambient.air.ambientHeat[airIndex] - 214) < 1e-6);

  const neighbors = new VoxelSimulation(9, 9, 9, 0xa132);
  neighbors.random = () => 0;
  neighbors.air.ambientHeatEnabled = false;
  neighbors.set(4, 4, 4, MAT.METL, 100);
  neighbors.set(5, 4, 4, MAT.WATR, 20);
  const metalIndex = neighbors.index(4, 4, 4);
  const waterIndex = neighbors.index(5, 4, 4);
  neighbors.conductHeat(metalIndex, 4, 4, 4);
  assert.ok(Math.abs(neighbors.temperatures[metalIndex] - 60) < 1e-6);
  assert.ok(Math.abs(neighbors.temperatures[waterIndex] - 60) < 1e-6);

  const chance = new VoxelSimulation(9, 9, 9, 0xa133);
  chance.random = () => 0.2;
  chance.set(4, 4, 4, MAT.WATR, 100);
  const chanceIndex = chance.index(4, 4, 4);
  assert.equal(chance.conductHeat(chanceIndex, 4, 4, 4), false);
  assert.equal(chance.temperatures[chanceIndex], 100);
});

test("heat and Newtonian gravity settings independently gate their solvers", () => {
  const heat = new VoxelSimulation(9, 9, 9, 0xa140);
  heat.set(4, 4, 4, MAT.WATR, 200);
  heat.heatSimulationEnabled = false;
  heat.step();
  assert.equal(heat.types.includes(MAT.WATR), true);
  heat.heatSimulationEnabled = true;
  heat.random = () => 0;
  heat.step();
  assert.equal(heat.types.includes(MAT.WTRV), true);

  const gravity = new VoxelSimulation(12, 12, 12, 0xa141);
  gravity.set(2, 6, 6, MAT.NBHL, 22, 0, { tmp: 3000 });
  gravity.newtonianGravityEnabled = false;
  gravity.step();
  assert.equal(gravity.gravity.stats().peakForce, 0);
  gravity.newtonianGravityEnabled = true;
  gravity.step();
  assert.ok(gravity.gravity.stats().peakForce > 0);
});

test("water equalization finds lower vacancies through connected 3D liquid", () => {
  const sim = new VoxelSimulation(8, 8, 6, 0xa142);
  sim.set(1, 4, 2, MAT.WATR);
  sim.set(2, 4, 2, MAT.WATR);
  sim.set(3, 4, 2, MAT.WATR);
  sim.set(3, 3, 2, MAT.WATR);
  const source = sim.index(1, 4, 2);
  assert.equal(sim.equalizeLiquid(source, 1, 4, 2), true);
  assert.equal(sim.get(1, 4, 2), MAT.EMPTY);
  assert.equal(sim.get(3, 2, 2), MAT.WATR);
});

test("ambient edge conditions, convection and vorticity participate in the 3D air solver", () => {
  const air = new AirField3D(12, 12, 12, 4);
  air.edgePressure = 10;
  air.edgeVelocityX = 2;
  air.vorticityCoeff = 0;
  air.step();
  assert.ok(air.pressure[air.index(0, 1, 1)] > 0);
  assert.ok(air.velocityX[air.index(0, 1, 1)] > 0);

  const convection = new AirField3D(12, 12, 12, 4);
  const center = convection.index(1, 1, 1);
  convection.ambientHeat[center] = 1022;
  convection.convectionMode = 2;
  convection.vorticityCoeff = 0;
  convection.step();
  assert.ok(convection.velocityY[center] > 0);

  const vortex = new AirField3D(20, 20, 20, 4);
  vortex.convectionMode = 0;
  vortex.vorticityCoeff = 1;
  vortex.velocityX[vortex.index(2, 2, 2)] = 8;
  vortex.velocityY[vortex.index(3, 2, 2)] = -8;
  vortex.step();
  assert.ok(vortex.stats().maxVelocity > 0);
});

test("void, solid and looping edge modes control boundary crossings", () => {
  const make = (edgeMode, seed) => {
    const sim = new VoxelSimulation(6, 6, 6, seed);
    sim.edgeMode = edgeMode;
    sim.random = () => 0;
    sim.set(3, 0, 3, MAT.DUST);
    sim.step();
    return sim;
  };
  assert.equal(make(0, 0xe001).types.includes(MAT.DUST), false);
  assert.equal(make(1, 0xe002).get(3, 0, 3), MAT.DUST);
  assert.equal(make(2, 0xe003).get(3, 5, 3), MAT.DUST);

  const energy = new VoxelSimulation(6, 6, 6, 0xe004);
  energy.edgeMode = 2;
  energy.setEnergy(5, 3, 3, MAT.PHOT, 22, 10, { velocityX: 1, velocityY: 0, velocityZ: 0 });
  energy.random = () => 0;
  energy.updateEnergy();
  assert.equal(energy.getEnergy(0, 3, 3), MAT.PHOT);
});
