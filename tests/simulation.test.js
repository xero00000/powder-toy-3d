// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";

test("sand falls through empty space", () => {
  const sim = new VoxelSimulation(9, 9, 9, 1);
  sim.set(4, 7, 4, MAT.SAND);
  sim.step();
  assert.equal(sim.get(4, 7, 4), MAT.EMPTY);
  assert.ok(Array.from(sim.types).includes(MAT.SAND));
  const index = sim.types.indexOf(MAT.SAND);
  assert.ok(sim.coords(index)[1] < 7);
});

test("water flashes to steam above boiling temperature", () => {
  const sim = new VoxelSimulation(5, 5, 5, 2);
  sim.random = () => 0;
  sim.air.ambientHeatEnabled = false;
  sim.set(2, 1, 2, MAT.STONE, 140);
  sim.set(2, 2, 2, MAT.WATER, 140);
  sim.step();
  assert.ok(Array.from(sim.types).includes(MAT.STEAM));
});

test("ice melts when heated", () => {
  const sim = new VoxelSimulation(5, 5, 5, 3);
  sim.random = () => 0;
  sim.set(2, 2, 2, MAT.ICE, 20);
  sim.step();
  assert.ok(Array.from(sim.types).includes(MAT.WATER));
});

test("painting and erasing affect a real volume", () => {
  const sim = new VoxelSimulation(11, 11, 11, 4);
  const painted = sim.paintSphere(5, 5, 5, 2, MAT.METAL);
  assert.ok(painted > 20);
  assert.equal(sim.get(5, 5, 5), MAT.METAL);
  sim.paintSphere(5, 5, 5, 1, MAT.EMPTY, true);
  assert.equal(sim.get(5, 5, 5), MAT.EMPTY);
});

test("all scenarios produce meaningful populated chambers", () => {
  const sim = new VoxelSimulation();
  for (const preset of ["foundry", "reactor", "garden", "volcano"]) {
    const stats = sim.loadPreset(preset);
    assert.ok(stats.active > 500, `${preset} should populate the chamber`);
    assert.ok(stats.active < sim.size, `${preset} should leave room to simulate`);
  }
});
