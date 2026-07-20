// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";
import { canonicalPropertyName, parseParticleProperty } from "../src/property-tool.js";

test("property parser matches upstream names, aliases and numeric formats", () => {
  assert.equal(canonicalPropertyName("dcolor"), "dcolour");
  assert.equal(canonicalPropertyName("pavg0"), "tmp3");
  assert.deepEqual(parseParticleProperty("type", "DEFAULT_PT_WATR").value, MAT.WATR);
  assert.equal(parseParticleProperty("ctype", "0b101010").value, 42);
  assert.equal(parseParticleProperty("flags", "0xFEDCBA98").value, 0xfedcba98);
  assert.equal(parseParticleProperty("dcolour", "#FF804020").value, 0xff804020);
  assert.ok(Math.abs(parseParticleProperty("temp", "293.15K").value - 20) < 1e-6);
  assert.ok(Math.abs(parseParticleProperty("temp", "68F").value - 20) < 1e-6);
});

test("signed life and unsigned flags retain their complete upstream 32-bit ranges", () => {
  const sim = new VoxelSimulation(7, 7, 7, 0x9191);
  sim.set(3, 3, 3, MAT.DMND);
  const index = sim.index(3, 3, 3);
  assert.equal(sim.applyParticlePropertyAt(index, "life", -1234567), true);
  assert.equal(sim.applyParticlePropertyAt(index, "flags", 0xfedcba98), true);
  assert.equal(sim.life[index], -1234567);
  assert.equal(sim.flags[index], 0xfedcba98);
});

test("property type edits cross matter and energy layers while preserving particle state", () => {
  const sim = new VoxelSimulation(7, 7, 7, 0x9292);
  sim.set(3, 3, 3, MAT.DUST, 321, 44, { ctype: MAT.WATR, tmp: -7, velocityX: 1.25, decoration: 0xffa04020 });
  const index = sim.index(3, 3, 3);
  assert.equal(sim.applyParticlePropertyAt(index, "type", MAT.PHOT), true);
  assert.equal(sim.types[index], MAT.EMPTY);
  assert.equal(sim.energyTypes[index], MAT.PHOT);
  assert.equal(sim.energyTemperatures[index], 321);
  assert.equal(sim.energyLife[index], 44);
  assert.equal(sim.energyTmp[index], -7);
  assert.equal(sim.energyVelocityX[index], 1.25);
  assert.equal(sim.energyDecorations[index], 0xffa04020);
  assert.equal(sim.applyParticlePropertyAt(index, "type", MAT.WATR), true);
  assert.equal(sim.energyTypes[index], MAT.EMPTY);
  assert.equal(sim.types[index], MAT.WATR);
  assert.equal(sim.tmp[index], -7);
});

test("property brush, fill, replace and coordinate edits work on 3D voxel particles", () => {
  const sim = new VoxelSimulation(9, 8, 6, 0x9393);
  sim.set(1, 1, 2, MAT.DMND);
  sim.set(2, 1, 2, MAT.DMND);
  sim.set(2, 2, 2, MAT.DMND);
  sim.set(7, 6, 2, MAT.DMND);
  assert.equal(sim.floodPropertyPlane(1, 1, 2, "tmp", -52), 3);
  assert.equal(sim.tmp[sim.index(7, 6, 2)], 0);
  assert.equal(sim.replacePropertyPlane(2, MAT.DMND, "flags", 0x80000000), 4);
  assert.equal(sim.flags[sim.index(7, 6, 2)], 0x80000000);
  assert.equal(sim.paintPropertySphere(2, 1, 2, 0, "temp", 900), 1);
  assert.equal(sim.temperatures[sim.index(2, 1, 2)], 900);
  const moving = sim.index(1, 1, 2);
  assert.equal(sim.applyParticlePropertyAt(moving, "z", 4), true);
  assert.equal(sim.types[moving], MAT.EMPTY);
  assert.equal(sim.get(1, 1, 4), MAT.DMND);
});
