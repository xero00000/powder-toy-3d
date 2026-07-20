// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { executeConsoleCommand } from "../src/console.js";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";

test("simulation console creates, inspects and edits matter and energy fields", () => {
  const simulation = new VoxelSimulation(10, 10, 8, 0xc011);
  let mutations = 0;
  const context = { simulation, beforeMutate: () => { mutations += 1; } };
  assert.match(executeConsoleCommand("create WATR 2 3 4", context), /Created 1 WATR/);
  assert.equal(simulation.get(2, 3, 4), MAT.WATR);
  executeConsoleCommand("temp 2 3 4 87.5", context);
  executeConsoleCommand("set 2 3 4 tmp2 -17", context);
  const index = simulation.index(2, 3, 4);
  assert.equal(simulation.temperatures[index], 87.5);
  assert.equal(simulation.tmp2[index], -17);
  assert.match(executeConsoleCommand("inspect 2 3 4", context), /matter=WATR/);

  executeConsoleCommand("create PHOT 2 3 4", context);
  assert.equal(simulation.energyTypes[index], MAT.PHOT);
  executeConsoleCommand("set 2 3 4 ctype 12345", context);
  assert.equal(simulation.ctype[index], 12345);
  assert.equal(simulation.energyCtype[index], 12345);
  executeConsoleCommand("prop 2 3 4 flags 0xFEDCBA98", context);
  assert.equal(simulation.flags[index], 0xfedcba98);
  assert.equal(simulation.energyFlags[index], 0);
  assert.match(executeConsoleCommand("count PHOT", context), /1 .*energy/);
  const stats = executeConsoleCommand("stats", context);
  assert.match(stats, /Tick 0  particles=2 \(1 matter, 1 energy\)/);
  assert.match(stats, /pressure=0\.000/);
  assert.match(stats, /moves=0  reactions=0  explosions=0/);
  assert.equal(mutations, 6);
});

test("simulation console controls fields, signs, stepping, pause and views", () => {
  const simulation = new VoxelSimulation(10, 10, 8, 0xc012);
  let paused = false;
  let view = "clarity";
  const context = {
    simulation,
    paused: () => paused,
    setPaused: (value) => { paused = value; },
    setView: (value) => { view = value; },
  };
  executeConsoleCommand("pressure 5 5 4 12.5", context);
  assert.equal(simulation.air.sampleVoxel(5, 5, 4).pressure, 12.5);
  executeConsoleCommand("gravity 5 5 4 -25", context);
  assert.equal(simulation.gravity.toolMass[simulation.gravity.indexForVoxel(5, 5, 4)], -25);
  executeConsoleCommand('sign 5 5 4 "Containment core"', context);
  assert.equal(simulation.signs[0].text, "Containment core");
  executeConsoleCommand("pause on", context);
  assert.equal(paused, true);
  executeConsoleCommand("view heat", context);
  assert.equal(view, "heat");
  executeConsoleCommand("step 3", context);
  assert.equal(simulation.tick, 3);
  executeConsoleCommand("heat off", context);
  executeConsoleCommand("newton off", context);
  executeConsoleCommand("water on", context);
  executeConsoleCommand("edgepressure -7.5", context);
  executeConsoleCommand("edgevelocity 1 -2 3", context);
  executeConsoleCommand("vorticity 0.75", context);
  executeConsoleCommand("convection 1", context);
  executeConsoleCommand("decospace 2", context);
  assert.equal(simulation.heatSimulationEnabled, false);
  assert.equal(simulation.newtonianGravityEnabled, false);
  assert.equal(simulation.waterEqualization, true);
  assert.equal(simulation.air.edgePressure, -7.5);
  assert.deepEqual([simulation.air.edgeVelocityX, simulation.air.edgeVelocityY, simulation.air.edgeVelocityZ], [1, -2, 3]);
  assert.equal(simulation.air.vorticityCoeff, 0.75);
  assert.equal(simulation.air.convectionMode, 1);
  assert.equal(simulation.decorationColorSpace, 2);
});

test("simulation console rejects unsafe fields, invalid coordinates and unknown commands", () => {
  const simulation = new VoxelSimulation(6, 6, 6, 0xc013);
  assert.throws(() => executeConsoleCommand("set 2 2 2 constructor 1", { simulation }), /Unknown writable field/);
  assert.throws(() => executeConsoleCommand("create WATR 99 2 2", { simulation }), /outside the chamber/);
  assert.throws(() => executeConsoleCommand("javascript alert", { simulation }), /Unknown command/);
  assert.match(executeConsoleCommand("help", { simulation }), /create TYPE/);
  assert.match(executeConsoleCommand("help", { simulation }), /count \[TYPE\]  stats/);
});
