// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { MAT } from "../src/materials.js";
import { VoxelSimulation } from "../src/simulation.js";

function phase(type, temperature, pressure = 0) {
  const simulation = new VoxelSimulation(9, 9, 9, type);
  const index = simulation.index(4, 4, 4);
  simulation.set(4, 4, 4, type, temperature);
  simulation.air.pressure[simulation.air.indexForVoxel(4, 4, 4)] = pressure;
  return { simulation, index };
}

test("C-4 preserves its pressure-sensitive explosive transition", () => {
  const { simulation, index } = phase(MAT.PLEX, 22, 3);
  simulation.random = () => 0;
  assert.equal(simulation.applyPhaseChange(index, MAT.PLEX), true);
  assert.equal(simulation.types[index], MAT.FIRE);
  assert.equal(simulation.life[index], 180);
  assert.ok(simulation.air.sampleVoxel(4, 4, 4).pressure > 3);
});

test("concrete and brick retain typed molten and pressure-fracture products", () => {
  const concrete = phase(MAT.CNCT, 850);
  concrete.simulation.random = () => 0;
  assert.equal(concrete.simulation.applyPhaseChange(concrete.index, MAT.CNCT), true);
  assert.equal(concrete.simulation.types[concrete.index], MAT.LAVA);
  assert.equal(concrete.simulation.ctype[concrete.index], MAT.CNCT);

  const brick = phase(MAT.BRCK, 22, 9);
  assert.equal(brick.simulation.applyPhaseChange(brick.index, MAT.BRCK), true);
  assert.equal(brick.simulation.types[brick.index], MAT.STNE);
});

test("nitrogen and carbon-dioxide solids preserve their cryogenic phase cycles", () => {
  const liquidNitrogen = phase(MAT.LNTG, -211);
  assert.equal(liquidNitrogen.simulation.applyPhaseChange(liquidNitrogen.index, MAT.LNTG), true);
  assert.equal(liquidNitrogen.simulation.types[liquidNitrogen.index], MAT.NICE);

  const nitrogenIce = phase(MAT.NICE, -210);
  assert.equal(nitrogenIce.simulation.applyPhaseChange(nitrogenIce.index, MAT.NICE), true);
  assert.equal(nitrogenIce.simulation.types[nitrogenIce.index], MAT.LNTG);

  const dryIce = phase(MAT.DRIC, -77);
  assert.equal(dryIce.simulation.applyPhaseChange(dryIce.index, MAT.DRIC), true);
  assert.equal(dryIce.simulation.types[dryIce.index], MAT.CO2);
});

test("freeze powder consumes itself and creates persistent freeze water", () => {
  const simulation = new VoxelSimulation(9, 9, 9, 0xf122);
  simulation.random = () => 0;
  const powder = simulation.index(4, 4, 4);
  const water = simulation.index(5, 4, 4);
  simulation.set(4, 4, 4, MAT.FRZZ, -20);
  simulation.set(5, 4, 4, MAT.WATR, 20);
  assert.equal(simulation.updateFreezeMatter(powder, 4, 4, 4, MAT.FRZZ), true);
  assert.equal(simulation.types[powder], MAT.EMPTY);
  assert.equal(simulation.types[water], MAT.FRZW);
  assert.equal(simulation.life[water], 100);
});

test("Newtonian white holes source bounded negative mass", () => {
  const simulation = new VoxelSimulation(9, 9, 9, 0xa441);
  simulation.set(4, 4, 4, MAT.NWHL, 22, 0, { tmp: 3000 });
  simulation.gravity.rebuild(simulation);
  assert.equal(simulation.gravity.sampleVoxel(4, 4, 4).mass, -3);
  simulation.tmp[simulation.index(4, 4, 4)] = 100000;
  simulation.gravity.rebuild(simulation);
  assert.ok(Math.abs(simulation.gravity.sampleVoxel(4, 4, 4).mass + 51.2) < 1e-5);
});

test("broken vibranium shares the charged terminal discharge without ANAR reversion", () => {
  const simulation = new VoxelSimulation(11, 9, 9, 0xb8b2);
  simulation.random = () => 0;
  const index = simulation.index(5, 4, 4);
  simulation.set(5, 4, 4, MAT.BVBR, 0, 1, { tmp: 1200 });
  simulation.set(6, 4, 4, MAT.ANAR);
  assert.equal(simulation.updateVibranium(index, 5, 4, 4, MAT.BVBR), true);
  assert.equal(simulation.types[index], MAT.EXOT);
  assert.equal(simulation.energyTypes.includes(MAT.ELEC), true);
  assert.equal(simulation.energyTypes.includes(MAT.PHOT), true);
});
