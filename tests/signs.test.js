// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";
import { formatSignText, parseSignAction } from "../src/signs.js";

test("dynamic signs resolve upstream particle and field placeholders with energy priority", () => {
  const sim = new VoxelSimulation(8, 8, 6, 0x5155);
  sim.set(3, 4, 2, MAT.DMND, 100, 12, { ctype: MAT.WATR, tmp: 4, tmp2: 5 });
  sim.setEnergy(3, 4, 2, MAT.PHOT, 450, -23, { ctype: MAT.FILT, tmp: 88, tmp2: -99, velocityX: 0, velocityY: 0, velocityZ: 0 });
  sim.air.pressure[sim.air.indexForVoxel(3, 4, 2)] = 7.25;
  sim.air.ambientHeat[sim.air.indexForVoxel(3, 4, 2)] = 31.5;
  const sign = { x: 3, y: 4, z: 2, text: "{type} {temp} {pres} {aheat} {ctype} {life} {tmp} {tmp2}" };
  assert.equal(formatSignText(sim, sign), "PHOT 450.00 7.25 31.50 FILT -23 88 -99");
  assert.equal(formatSignText(sim, { ...sign, text: "unknown {future}" }), "unknown {future}");
});

test("legacy save, thread, button and search signs expose their display label", () => {
  assert.deepEqual(parseSignAction("{c:12345|Open save}"), { type: "save", target: "12345", label: "Open save" });
  assert.deepEqual(parseSignAction("{t:42|Forum thread}"), { type: "thread", target: "42", label: "Forum thread" });
  assert.equal(formatSignText(null, { text: "{b|Trigger}" }), "Trigger");
  assert.equal(formatSignText(null, { text: "{s:nuclear|Search}" }), "Search");
});

test("sign alignment and colour survive clipboard pasting", () => {
  const sim = new VoxelSimulation(12, 10, 6, 0x5156);
  assert.equal(sim.addSign(2, 3, 2, "Aligned", 0xff8844, "left"), true);
  const clipboard = sim.copyRegionPlane(2, 3, 2, 3, 2);
  assert.equal(sim.pasteRegionPlane(7, 6, 2, clipboard), 0);
  assert.deepEqual(sim.signs[1], { x: 7, y: 6, z: 2, text: "Aligned", color: 0xff8844, justification: "left" });
});
