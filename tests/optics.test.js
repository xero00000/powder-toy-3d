// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { MAT, MATERIAL_BY_ID } from "../src/materials.js";
import { VoxelSimulation } from "../src/simulation.js";

function glassHalfSpace(simulation) {
  for (let x = 5; x < simulation.width; x += 1) {
    for (let y = 0; y < simulation.height; y += 1) {
      for (let z = 0; z < simulation.depth; z += 1) simulation.set(x, y, z, MAT.GLAS);
    }
  }
}

test("photons obey 3D Snell refraction and preserve speed at a glass boundary", () => {
  const simulation = new VoxelSimulation(12, 9, 9, 0x1066);
  glassHalfSpace(simulation);
  simulation.setEnergy(4, 4, 4, MAT.PHOT, 922, 60, {
    ctype: 1 << 15, velocityX: 2, velocityY: 1, velocityZ: 0,
  });
  const index = simulation.index(4, 4, 4);
  const beforeSpeed = Math.hypot(simulation.energyVelocityX[index], simulation.energyVelocityY[index]);
  assert.equal(simulation.refractPhotonAtBoundary(index, [4, 4, 4], [5, 4, 4]), "refracted");
  const afterSpeed = Math.hypot(simulation.energyVelocityX[index], simulation.energyVelocityY[index], simulation.energyVelocityZ[index]);
  assert.ok(Math.abs(beforeSpeed - afterSpeed) < 1e-5);
  assert.ok(simulation.energyVelocityX[index] > 2);
  assert.ok(simulation.energyVelocityY[index] < 1);
});

test("glass dispersion bends different photon wavelength bins by different amounts", () => {
  const tangent = [];
  for (const [seed, wavelength] of [[0x1067, 1 << 1], [0x1068, 1 << 28]]) {
    const simulation = new VoxelSimulation(12, 9, 9, seed);
    glassHalfSpace(simulation);
    simulation.setEnergy(4, 4, 4, MAT.PHOT, 922, 60, {
      ctype: wavelength, velocityX: 2, velocityY: 1, velocityZ: 0,
    });
    const index = simulation.index(4, 4, 4);
    simulation.refractPhotonAtBoundary(index, [4, 4, 4], [5, 4, 4]);
    tangent.push(simulation.energyVelocityY[index]);
  }
  assert.ok(tangent[0] < tangent[1]);
});

test("shallow photons undergo total internal reflection when leaving glass", () => {
  const simulation = new VoxelSimulation(12, 9, 9, 0x1069);
  glassHalfSpace(simulation);
  simulation.setEnergy(5, 4, 4, MAT.PHOT, 922, 60, {
    ctype: 1 << 15, velocityX: -0.5, velocityY: 2.95, velocityZ: 0,
  });
  const index = simulation.index(5, 4, 4);
  assert.equal(simulation.refractPhotonAtBoundary(index, [5, 4, 4], [4, 4, 4]), "reflected");
  assert.ok(simulation.energyVelocityX[index] > 0);
  assert.ok(simulation.energyVelocityY[index] > 0);
});

test("opaque materials filter reflected photons with upstream spectral masks", () => {
  assert.equal(MATERIAL_BY_ID[MAT.ACID].photonReflectWavelengths, 0x1fe001fe);
  const simulation = new VoxelSimulation(9, 9, 9, 0x1070);
  simulation.set(5, 4, 4, MAT.ACID);
  simulation.setEnergy(4, 4, 4, MAT.PHOT, 922, 60, {
    ctype: (1 << 2) | (1 << 10), velocityX: 1, velocityY: 0, velocityZ: 0,
  });
  const index = simulation.index(4, 4, 4);
  assert.equal(simulation.reflectPhotonFromMatter(index, simulation.index(5, 4, 4), 5, 4, 4), true);
  assert.equal(simulation.energyCtype[index], 1 << 2);
  assert.ok(simulation.energyVelocityX[index] < 0);

  const absorbed = new VoxelSimulation(9, 9, 9, 0x1071);
  absorbed.set(5, 4, 4, MAT.ACID);
  absorbed.setEnergy(4, 4, 4, MAT.PHOT, 922, 60, {
    ctype: 1 << 10, velocityX: 1, velocityY: 0, velocityZ: 0,
  });
  const absorbedIndex = absorbed.index(4, 4, 4);
  assert.equal(absorbed.reflectPhotonFromMatter(absorbedIndex, absorbed.index(5, 4, 4), 5, 4, 4), false);
  assert.equal(absorbed.energyTypes[absorbedIndex], MAT.EMPTY);
});

test("broken glass scatters photons in 3D while quartz randomizes and narrows white light", () => {
  const broken = new VoxelSimulation(9, 9, 9, 0x1072);
  broken.set(4, 4, 4, MAT.BGLA);
  broken.setEnergy(4, 4, 4, MAT.PHOT, 922, 60, {
    ctype: 0x3fffffff, velocityX: 3, velocityY: 0, velocityZ: 0,
  });
  const brokenIndex = broken.index(4, 4, 4);
  broken.interactEnergy(brokenIndex, 4, 4, 4);
  assert.ok(Math.abs(broken.energyVelocityY[brokenIndex]) > 1e-4 || Math.abs(broken.energyVelocityZ[brokenIndex]) > 1e-4);
  assert.ok(Math.abs(Math.hypot(broken.energyVelocityX[brokenIndex], broken.energyVelocityY[brokenIndex], broken.energyVelocityZ[brokenIndex]) - 3) < 1e-5);

  const quartz = new VoxelSimulation(9, 9, 9, 0x1073);
  quartz.set(4, 4, 4, MAT.QRTZ);
  quartz.setEnergy(4, 4, 4, MAT.PHOT, 922, 60, {
    ctype: 0x3fffffff, velocityX: 3, velocityY: 0, velocityZ: 0,
  });
  const quartzIndex = quartz.index(4, 4, 4);
  quartz.interactEnergy(quartzIndex, 4, 4, 4);
  assert.notEqual(quartz.energyCtype[quartzIndex], 0x3fffffff);
  assert.ok(quartz.energyCtype[quartzIndex] & 0x3fffffff);
  assert.ok(Math.abs(quartz.energyVelocityY[quartzIndex]) > 1e-4 || Math.abs(quartz.energyVelocityZ[quartzIndex]) > 1e-4);
});
