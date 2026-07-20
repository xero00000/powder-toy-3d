// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT, UPSTREAM_WALLS } from "../src/materials.js";

test("native remaster saves round-trip every upstream-compatible particle field", () => {
  const original = new VoxelSimulation(12, 12, 12, 0x5151);
  original.set(4, 7, 5, MAT.FILT, 812.25, -1234567, {
    ctype: MAT.FILT,
    tmp: 0x1234,
    tmp2: -42,
    tmp3: 0x7654321,
    tmp4: -0x123456,
    velocityX: 2.5,
    velocityY: -1.25,
    velocityZ: 0.75,
    flags: 0xfedcba98,
    decoration: 0xffaabbcc,
  });
  original.setEnergy(4, 7, 5, MAT.PHOT, 1200.5, -7654321, {
    ctype: 0x15555aaa,
    velocityX: -3,
    velocityY: 0.5,
    velocityZ: 1.25,
    tmp3: 3456,
    tmp4: -7890,
    flags: 0x89abcdef,
  });
  const wall = UPSTREAM_WALLS.find((entry) => entry.identifier === "DEFAULT_WL_EWALL").id;
  original.paintWallSphere(5, 5, 5, 2, wall);
  original.wallElectricity[original.air.indexForVoxel(5, 5, 5)] = 12;
  const fan = UPSTREAM_WALLS.find((entry) => entry.identifier === "DEFAULT_WL_FAN").id;
  original.paintWallSphere(9, 5, 5, 1, fan);
  original.setFanVectorSphere(9, 5, 5, 1, -3, 4, 5);
  original.addSign(6, 8, 5, "Core temperature", 0xffaa55, "right");
  original.gravityMode = 3;
  original.edgeMode = 2;
  original.customGravity = [0.25, -0.5, 0.75];
  original.air.mode = 4;
  original.air.ambientTemperature = 37.5;
  original.air.ambientHeatEnabled = false;
  original.heatSimulationEnabled = false;
  original.newtonianGravityEnabled = false;
  original.waterEqualization = true;
  original.decorationColorSpace = 3;
  original.air.edgePressure = -12.5;
  original.air.edgeVelocityX = 1.5;
  original.air.edgeVelocityY = -2.5;
  original.air.edgeVelocityZ = 3.5;
  original.air.vorticityCoeff = 0.72;
  original.air.convectionMode = 1;
  original.air.updateBlocked(original);
  original.air.injectVoxel(5, 5, 5, 17, 90, 1, 2, 3);
  original.gravity.injectVoxel(9, 9, 9, -24);
  original.gravity.step(original);
  original.set(2, 2, 2, MAT.PRTI, 22);
  original.set(3, 2, 2, MAT.OIL, 77, 19, { tmp: 33, ctype: MAT.WATR });
  original.updatePortal(original.index(2, 2, 2), 2, 2, 2, MAT.PRTI);

  const encoded = JSON.stringify(original.serialize());
  const restored = new VoxelSimulation(12, 12, 12, 0x6161);
  restored.deserialize(JSON.parse(encoded));
  const index = restored.index(4, 7, 5);
  assert.equal(restored.types[index], MAT.FILT);
  assert.equal(restored.temperatures[index], 812.25);
  assert.equal(restored.life[index], -1234567);
  assert.equal(restored.ctype[index], MAT.FILT);
  assert.equal(restored.tmp[index], 0x1234);
  assert.equal(restored.tmp2[index], -42);
  assert.equal(restored.tmp3[index], 0x7654321);
  assert.equal(restored.tmp4[index], -0x123456);
  assert.equal(restored.velocityX[index], 2.5);
  assert.equal(restored.velocityY[index], -1.25);
  assert.equal(restored.velocityZ[index], 0.75);
  assert.equal(restored.flags[index], 0xfedcba98);
  assert.equal(restored.decorations[index], 0xffaabbcc);
  assert.equal(restored.energyTypes[index], MAT.PHOT);
  assert.equal(restored.energyTemperatures[index], 1200.5);
  assert.equal(restored.energyLife[index], -7654321);
  assert.equal(restored.energyCtype[index], 0x15555aaa);
  assert.equal(restored.energyVelocityX[index], -3);
  assert.equal(restored.energyVelocityY[index], 0.5);
  assert.equal(restored.energyVelocityZ[index], 1.25);
  assert.equal(restored.energyTmp3[index], 3456);
  assert.equal(restored.energyTmp4[index], -7890);
  assert.equal(restored.energyFlags[index], 0x89abcdef);
  assert.equal(restored.wallAtVoxel(5, 5, 5), wall);
  assert.equal(restored.wallElectricity[restored.air.indexForVoxel(5, 5, 5)], 12);
  const fanIndex = restored.air.indexForVoxel(9, 5, 5);
  assert.equal(restored.wallFanX[fanIndex], -3);
  assert.equal(restored.wallFanY[fanIndex], 4);
  assert.equal(restored.wallFanZ[fanIndex], 5);
  assert.deepEqual(restored.signs[0], { x: 6, y: 8, z: 5, text: "Core temperature", color: 0xffaa55, justification: "right" });
  assert.equal(restored.gravityMode, 3);
  assert.equal(restored.edgeMode, 2);
  assert.deepEqual(restored.customGravity, [0.25, -0.5, 0.75]);
  assert.equal(restored.air.mode, 4);
  assert.equal(restored.air.ambientTemperature, 37.5);
  assert.equal(restored.air.ambientHeatEnabled, false);
  assert.equal(restored.heatSimulationEnabled, false);
  assert.equal(restored.newtonianGravityEnabled, false);
  assert.equal(restored.waterEqualization, true);
  assert.equal(restored.decorationColorSpace, 3);
  assert.equal(restored.air.edgePressure, -12.5);
  assert.equal(restored.air.edgeVelocityX, 1.5);
  assert.equal(restored.air.edgeVelocityY, -2.5);
  assert.equal(restored.air.edgeVelocityZ, 3.5);
  assert.equal(restored.air.vorticityCoeff, 0.72);
  assert.equal(restored.air.convectionMode, 1);
  assert.ok(restored.air.sampleVoxel(5, 5, 5).pressure > 16);
  assert.ok(restored.gravity.sampleVoxel(9, 9, 9).mass < -20);
  const queued = restored.serializePortalQueues().flatMap((entry) => entry[2]);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, MAT.OIL);
  assert.equal(queued[0].tmp, 33);
  assert.equal(queued[0].ctype, MAT.WATR);
});

test("snapshots restore particles, walls and air without JSON precision loss", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x7171);
  sim.set(4, 4, 4, MAT.DMND, 333.333);
  sim.air.injectVoxel(4, 4, 4, 9.876, 44.4);
  const snapshot = sim.createSnapshot();
  sim.clear();
  sim.restoreSnapshot(snapshot);
  assert.equal(sim.get(4, 4, 4), MAT.DMND);
  assert.ok(Math.abs(sim.temperatures[sim.index(4, 4, 4)] - 333.333) < 0.001);
  assert.ok(Math.abs(sim.air.sampleVoxel(4, 4, 4).pressure - 9.876) < 0.001);
});
