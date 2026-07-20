// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { DECORATION_MODE, VoxelSimulation } from "../src/simulation.js";
import { MAT, UPSTREAM_WALLS } from "../src/materials.js";

const wallId = (identifier) => UPSTREAM_WALLS.find((wall) => wall.identifier === identifier).id;

test("3D sphere, cube, diamond and planar-disc brushes have distinct canonical footprints", () => {
  const counts = {};
  for (const shape of ["sphere", "cube", "diamond", "disc"]) {
    const sim = new VoxelSimulation(9, 9, 9, 0x1919);
    counts[shape] = sim.paintSphere(4, 4, 4, 2, MAT.SAND, false, {}, shape);
  }
  assert.equal(counts.sphere, 33);
  assert.equal(counts.cube, 125);
  assert.equal(counts.diamond, 25);
  assert.equal(counts.disc, 13);
});

test("decoration tools preserve upstream draw, clear and arithmetic blend semantics", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x1818);
  sim.set(4, 4, 4, MAT.DMND, 22, 0, { decoration: 0xff646464 });
  const index = sim.index(4, 4, 4);
  assert.equal(sim.paintDecorationSphere(4, 4, 4, 0, 0xff204080, DECORATION_MODE.DRAW), 1);
  assert.equal(sim.decorations[index], 0xff204080);
  sim.decorations[index] = 0xff646464;
  sim.applyDecorationAt(index, 0xffffffff, DECORATION_MODE.ADD);
  assert.equal(sim.decorations[index], 0xff676767);
  sim.decorations[index] = 0xff646464;
  sim.applyDecorationAt(index, 0xffffffff, DECORATION_MODE.SUBTRACT);
  assert.equal(sim.decorations[index], 0xff616161);
  sim.decorations[index] = 0xff646464;
  sim.applyDecorationAt(index, 0xffffffff, DECORATION_MODE.MULTIPLY);
  assert.equal(sim.decorations[index], 0xff656565);
  sim.decorations[index] = 0xff646464;
  sim.applyDecorationAt(index, 0xffffffff, DECORATION_MODE.DIVIDE);
  assert.equal(sim.decorations[index], 0xff636363);
  assert.equal(sim.applyDecorationAt(index, 0xffffffff, DECORATION_MODE.CLEAR), true);
  assert.equal(sim.decorations[index], 0);
});

test("decoration prioritizes matter over energy and can paint the exposed energy layer", () => {
  const sim = new VoxelSimulation(7, 7, 7, 0x1819);
  sim.set(3, 3, 3, MAT.GLAS);
  sim.setEnergy(3, 3, 3, MAT.PHOT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  const index = sim.index(3, 3, 3);
  sim.paintDecorationSphere(3, 3, 3, 0, 0xffaa4400, DECORATION_MODE.DRAW);
  assert.equal(sim.decorations[index], 0xffaa4400);
  assert.equal(sim.energyDecorations[index], 0);
  sim.set(3, 3, 3, MAT.EMPTY);
  sim.paintDecorationSphere(3, 3, 3, 0, 0x8088ccff, DECORATION_MODE.DRAW);
  assert.equal(sim.energyDecorations[index], 0x8088ccff);
});

test("decoration flood and replace stay on occupied connected plane regions", () => {
  const sim = new VoxelSimulation(8, 6, 5, 0x1820);
  sim.set(1, 1, 2, MAT.DMND);
  sim.set(2, 1, 2, MAT.DMND);
  sim.set(2, 2, 2, MAT.DMND);
  sim.set(6, 4, 2, MAT.DMND);
  assert.equal(sim.floodDecorationPlane(1, 1, 2, 0xffcc2200, DECORATION_MODE.DRAW), 3);
  assert.equal(sim.decorations[sim.index(2, 2, 2)], 0xffcc2200);
  assert.equal(sim.decorations[sim.index(6, 4, 2)], 0);
  assert.equal(sim.replaceDecorationPlane(2, 0xffcc2200, 0xff22cc00, DECORATION_MODE.DRAW), 3);
  assert.equal(sim.decorations[sim.index(1, 1, 2)], 0xff22cc00);
});

test("decoration smudge averages nearby decorated particles in linear-light colour space", () => {
  const sim = new VoxelSimulation(11, 11, 11, 0x1821);
  sim.set(5, 5, 5, MAT.DMND);
  sim.set(7, 6, 5, MAT.DMND, 22, 0, { decoration: 0xffff0000 });
  sim.set(3, 4, 5, MAT.DMND, 22, 0, { decoration: 0xff0000ff });
  const index = sim.index(5, 5, 5);
  assert.equal(sim.applyDecorationAt(index, 0, DECORATION_MODE.SMUDGE), true);
  const decoration = sim.decorations[index] >>> 0;
  assert.equal(decoration >>> 24, 252);
  assert.ok(((decoration >>> 16) & 0xff) >= 187);
  assert.ok((decoration & 0xff) >= 187);

  const linear = new VoxelSimulation(11, 11, 11, 0x1822);
  linear.decorationColorSpace = 1;
  linear.set(5, 5, 5, MAT.DMND, 22, 0, { decoration: 0xff000000 });
  linear.set(7, 6, 5, MAT.DMND, 22, 0, { decoration: 0xffff0000 });
  linear.set(3, 4, 5, MAT.DMND, 22, 0, { decoration: 0xff0000ff });
  const linearIndex = linear.index(5, 5, 5);
  linear.applyDecorationAt(linearIndex, 0, DECORATION_MODE.SMUDGE);
  assert.equal((linear.decorations[linearIndex] >>> 16) & 0xff, 128);
  assert.equal(linear.decorations[linearIndex] & 0xff, 128);
});

test("planar flood fill respects connected component boundaries", () => {
  const sim = new VoxelSimulation(8, 8, 5, 0x2020);
  for (let y = 0; y < 8; y += 1) sim.set(4, y, 2, MAT.DMND);
  const changed = sim.floodFillPlane(1, 1, 2, MAT.WATR);
  assert.equal(changed, 32);
  assert.equal(sim.get(3, 7, 2), MAT.WATR);
  assert.equal(sim.get(5, 1, 2), MAT.EMPTY);
  assert.equal(sim.get(4, 1, 2), MAT.DMND);
});

test("planar replace preserves other materials and supports Life properties", () => {
  const sim = new VoxelSimulation(8, 8, 5, 0x2121);
  sim.fillBox(1, 1, 2, 3, 3, 2, MAT.SAND);
  sim.set(2, 2, 2, MAT.STNE);
  const changed = sim.replacePlane(2, MAT.SAND, MAT.LIFE, { ctype: 4 });
  assert.equal(changed, 8);
  assert.equal(sim.get(2, 2, 2), MAT.STNE);
  assert.equal(sim.get(1, 1, 2), MAT.LIFE);
  assert.equal(sim.ctype[sim.index(1, 1, 2)], 4);
});

test("wall flood and replace operate on the selected coarse depth plane", () => {
  const sim = new VoxelSimulation(16, 16, 12, 0x2222);
  const solid = wallId("DEFAULT_WL_WALL");
  const detector = wallId("DEFAULT_WL_DTECT");
  sim.paintWallSphere(2, 2, 2, 1, solid);
  sim.paintWallSphere(6, 2, 2, 1, solid);
  assert.equal(sim.floodWallPlane(2, 2, 2, detector), 2);
  assert.equal(sim.wallAtVoxel(2, 2, 2), detector);
  assert.equal(sim.wallAtVoxel(6, 2, 2), detector);
  assert.equal(sim.replaceWallPlane(2, detector, null), 2);
  assert.equal(sim.wallAtVoxel(2, 2, 2), null);
  assert.equal(sim.wallAtVoxel(6, 2, 2), null);
});

test("energy flood uses its independent layer without overwriting matter", () => {
  const sim = new VoxelSimulation(8, 8, 5, 0x2323);
  sim.fillBox(0, 0, 2, 7, 7, 2, MAT.GLAS);
  const changed = sim.floodFillPlane(0, 0, 2, MAT.PHOT, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  assert.equal(changed, 64);
  assert.equal(sim.get(4, 4, 2), MAT.GLAS);
  assert.equal(sim.getEnergy(4, 4, 2), MAT.PHOT);
});

test("planar clipboard copy, cut and paste preserve complete matter and energy state", () => {
  const sim = new VoxelSimulation(16, 16, 8, 0x2424);
  sim.set(2, 3, 4, MAT.FILT, 712, 43, { ctype: 0x15555aaa, tmp: 12, tmp2: -9, tmp3: 88, tmp4: -77, velocityX: 1.5, decoration: 0xffaabbcc });
  sim.setEnergy(2, 3, 4, MAT.PHOT, 922, 91, { ctype: 0x12345678, tmp3: 54, velocityZ: -2 });
  sim.paintWallSphere(3, 3, 4, 1, wallId("DEFAULT_WL_EWALL"));
  sim.addSign(3, 4, 4, "Reactor A", 0x55ddff);
  const clipboard = sim.copyRegionPlane(2, 3, 4, 5, 4);
  assert.equal(clipboard.matter.length, 1);
  assert.equal(clipboard.energy.length, 1);
  assert.ok(clipboard.walls.length > 0);
  assert.equal(clipboard.signs[0].text, "Reactor A");
  sim.clearRegionPlane(2, 3, 4, 5, 4);
  assert.equal(sim.get(2, 3, 4), MAT.EMPTY);
  assert.equal(sim.getEnergy(2, 3, 4), MAT.EMPTY);
  assert.equal(sim.signs.length, 0);
  assert.equal(sim.pasteRegionPlane(8, 9, 4, clipboard), 2);
  const pasted = sim.index(8, 9, 4);
  assert.equal(sim.types[pasted], MAT.FILT);
  assert.equal(sim.temperatures[pasted], 712);
  assert.equal(sim.life[pasted], 43);
  assert.equal(sim.ctype[pasted], 0x15555aaa);
  assert.equal(sim.tmp2[pasted], -9);
  assert.equal(sim.tmp3[pasted], 88);
  assert.equal(sim.tmp4[pasted], -77);
  assert.equal(sim.decorations[pasted], 0xffaabbcc);
  assert.equal(sim.energyTypes[pasted], MAT.PHOT);
  assert.equal(sim.energyCtype[pasted], 0x12345678);
  assert.equal(sim.energyTmp3[pasted], 54);
  assert.equal(sim.energyVelocityZ[pasted], -2);
  assert.notEqual(sim.wallAtVoxel(8, 9, 4), null);
  assert.deepEqual(sim.signs[0], { x: 9, y: 10, z: 4, text: "Reactor A", color: 0x55ddff, justification: "center" });
});

test("clipboard version three remaps linked SOAP topology instead of retaining absolute voxel addresses", () => {
  const sim = new VoxelSimulation(16, 14, 7, 0x7777);
  sim.set(2, 3, 3, MAT.SOAP);
  sim.set(3, 3, 3, MAT.SOAP);
  const first = sim.index(2, 3, 3);
  const second = sim.index(3, 3, 3);
  assert.equal(sim.attachSoap(first, second), true);
  const clipboard = sim.copyRegionPlane(2, 3, 3, 3, 3);
  assert.equal(clipboard.version, 3);
  assert.deepEqual(clipboard.matter[0][2].soapForward, [1, 0]);
  assert.equal(sim.pasteRegionPlane(9, 8, 3, clipboard), 2);
  const pastedFirst = sim.index(9, 8, 3);
  const pastedSecond = sim.index(10, 8, 3);
  assert.equal(sim.tmp[pastedFirst], pastedSecond);
  assert.equal(sim.tmp2[pastedSecond], pastedFirst);
  assert.notEqual(sim.tmp[pastedFirst], second);

  const partial = sim.copyRegionPlane(2, 3, 2, 3, 3);
  assert.equal(sim.pasteRegionPlane(12, 8, 3, partial), 1);
  const pastedPartial = sim.index(12, 8, 3);
  assert.equal(sim.ctype[pastedPartial] & 6, 0);
  assert.equal(sim.tmp[pastedPartial], -1);
  assert.equal(sim.tmp2[pastedPartial], -1);
});
