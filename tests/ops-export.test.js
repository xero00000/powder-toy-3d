// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { PIPE_FLAG, VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";
import { exportOps } from "../src/ops-export.js";
import { importOps } from "../src/ops-import.js";

test("OPS slice export round-trips matter, energy and extended particle state", () => {
  const source = new VoxelSimulation(8, 8, 5, 0x1001);
  source.clear();
  source.set(2, 3, 2, MAT.WATR, 123, 513, {
    ctype: 0x12345678, tmp: -1234567, tmp2: 700, tmp3: -987654, tmp4: 0x1234567,
    velocityX: 1.25, velocityY: -0.75, decoration: 0xaabbccdd,
  });
  source.setEnergy(2, 3, 2, MAT.PHOT, 456, 42, {
    ctype: 0x03fffffff, tmp: 2, tmp2: 9, tmp3: 10, tmp4: 11,
    velocityX: -1, velocityY: 0.5, decoration: 0x44556677,
  });
  source.addSign(2, 3, 2, "Depth {temp}", 0x8feeff, "center");
  const { bytes, report } = exportOps(source, { mode: "slice", depth: 2, paused: true });
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "OPS1");
  assert.deepEqual(report, { mode: "slice", depth: 2, width: 8, height: 8, exported: 2, omitted: 0 });

  const restored = new VoxelSimulation(8, 8, 5, 0x1002);
  const imported = importOps(bytes, restored, 2);
  assert.equal(imported.imported, 2);
  assert.equal(imported.paused, true);
  const matterIndex = restored.types.indexOf(MAT.WATR);
  const energyIndex = restored.energyTypes.indexOf(MAT.PHOT);
  assert.ok(matterIndex >= 0);
  assert.ok(energyIndex >= 0);
  assert.equal(restored.life[matterIndex], 513);
  assert.equal(restored.ctype[matterIndex], 0x12345678);
  assert.equal(restored.tmp[matterIndex], -1234567);
  assert.equal(restored.tmp2[matterIndex], 700);
  assert.equal(restored.tmp3[matterIndex], -987654);
  assert.equal(restored.tmp4[matterIndex], 0x1234567);
  assert.equal(restored.decorations[matterIndex], 0xaabbccdd);
  assert.ok(Math.abs(restored.temperatures[matterIndex] - 122.85) < 0.01);
  assert.equal(restored.energyCtype[energyIndex], 0x03fffffff);
  assert.equal(restored.energyDecorations[energyIndex], 0x44556677);
  assert.equal(restored.signs.length, 1);
});

test("OPS depth-atlas export preserves all supported particles and reports custom omissions", () => {
  const source = new VoxelSimulation(8, 8, 5, 0x2001);
  source.clear();
  source.set(1, 1, 0, MAT.SAND, 22);
  source.set(1, 1, 4, MAT.WATR, 22);
  source.types[source.index(2, 2, 2)] = 255;
  const { bytes, report } = exportOps(source, { mode: "atlas" });
  assert.equal(report.exported, 2);
  assert.equal(report.omitted, 1);
  assert.ok(report.width > source.width || report.height > source.height);
  const restored = new VoxelSimulation(16, 16, 8, 0x2002);
  const imported = importOps(bytes, restored, 4);
  assert.equal(imported.imported, 2);
  assert.ok(restored.types.includes(MAT.SAND));
  assert.ok(restored.types.includes(MAT.WATR));
});

test("OPS round-trip preserves single-voxel PIPE/STOR payloads and emits PIPE state", () => {
  const source = new VoxelSimulation(8, 8, 5, 0x2011);
  source.clear();
  source.set(3, 3, 2, MAT.PIPE, 84, 0, {
    ctype: MAT.WATR,
    tmp: PIPE_FLAG.COLOR_RED | PIPE_FLAG.PARTICLE_DECO,
    tmp2: 27,
    tmp3: 0x123456,
    tmp4: MAT.OIL,
    decoration: 0xcc44aaff,
  });
  source.set(5, 3, 2, MAT.STOR, 55, 0, { tmp: MAT.OIL, tmp2: 12, tmp3: 34, tmp4: MAT.WATR });
  const { bytes } = exportOps(source, { mode: "slice", depth: 2 });
  const restored = new VoxelSimulation(8, 8, 5, 0x2012);
  importOps(bytes, restored, 2);
  const pipe = restored.types.indexOf(MAT.PIPE);
  assert.ok(pipe >= 0);
  assert.equal(restored.ctype[pipe], MAT.WATR);
  assert.ok(restored.tmp[pipe] & PIPE_FLAG.PARTICLE_DECO);
  const storage = restored.types.indexOf(MAT.STOR);
  assert.ok(storage >= 0);
  assert.equal(restored.tmp[storage], MAT.OIL);
  assert.equal(restored.tmp4[storage], MAT.WATR);
  const [x, y, z] = restored.coords(pipe);
  for (let step = 0; step < 3; step += 1) restored.updatePipe(pipe, x, y, z, MAT.PIPE);
  const payload = restored.types.indexOf(MAT.WATR);
  assert.ok(payload >= 0);
  assert.equal(restored.life[payload], 27);
  assert.equal(restored.tmp[payload], 0x123456);
  assert.equal(restored.ctype[payload], MAT.OIL);
  assert.equal(restored.decorations[payload], 0xcc44aaff);
  assert.ok(Math.abs(restored.temperatures[payload] - 83.85) < 0.01);
});

test("OPS exporter carries projected walls, fans and field data", () => {
  const source = new VoxelSimulation(8, 8, 5, 0x3001);
  source.clear();
  const wallIndex = source.air.indexForVoxel(2, 2, 2);
  source.walls[wallIndex] = 6;
  source.wallFanX[wallIndex] = 1.5;
  source.wallFanY[wallIndex] = -0.5;
  source.air.pressure[wallIndex] = 12.25;
  source.air.velocityX[wallIndex] = 1;
  source.air.velocityY[wallIndex] = -2;
  source.air.ambientHeat[wallIndex] = 88;
  const { bytes } = exportOps(source, { mode: "slice", depth: 2 });
  const restored = new VoxelSimulation(8, 8, 5, 0x3002);
  importOps(bytes, restored, 2);
  const restoredFan = [...restored.walls].findIndex((wall) => wall === 6);
  assert.ok(restoredFan >= 0);
  assert.ok(Math.abs(restored.wallFanX[restoredFan] - 1.5) < 0.02);
  assert.ok(Math.abs(restored.wallFanY[restoredFan] + 0.5) < 0.02);
  assert.ok([...restored.air.pressure].some((value) => Math.abs(value - 12.25) < 0.02));
  assert.ok([...restored.air.ambientHeat].some((value) => Math.abs(value - 87.85) < 0.02));
});
