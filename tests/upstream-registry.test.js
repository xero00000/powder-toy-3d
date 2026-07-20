// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  CATEGORY_ORDER, MATERIALS, MATERIAL_BY_ID, MAT,
  UPSTREAM_ELEMENT_COUNT, UPSTREAM_VISIBLE_ELEMENT_COUNT, UPSTREAM_TOOLS,
  UPSTREAM_WALLS, UPSTREAM_LIFE_RULES, materialsInCategory,
} from "../src/materials.js";
import { paletteVisibilityMultiplier } from "../src/color-presentation.js";
import { VoxelSimulation } from "../src/simulation.js";

test("the complete June 2026 upstream element ID space is registered", () => {
  assert.equal(UPSTREAM_ELEMENT_COUNT, 195);
  assert.equal(MATERIALS.length, 195);
  assert.equal(UPSTREAM_VISIBLE_ELEMENT_COUNT, 175);
  assert.equal(MAT.NONE, 0);
  assert.equal(MAT.WATR, 2);
  assert.equal(MAT.SAND, 44);
  assert.equal(MAT.SEED, 195);
  assert.equal(new Set(MATERIALS.map((material) => material.id)).size, MATERIALS.length);
  assert.ok(MATERIALS.every((material) => material.id >= 0 && material.id <= 255));
});

test("the generated RGB palette exactly matches the audited upstream revision", () => {
  const signature = createHash("sha256")
    .update(MATERIALS.map((material) => `${material.code}:${material.color.toString(16).padStart(6, "0")}`).join("\n"))
    .digest("hex");
  assert.equal(signature, "ab52cd294f033bfae23147902ee78dc471539380f5b8e6e6c36f9b35d5ca3c71");
  assert.ok(MATERIALS.every((material) => material.css === `#${material.color.toString(16).padStart(6, "0")}`));
});

test("clarity mode preserves every distinct upstream base color", () => {
  const visible = MATERIALS.filter((material) => material.enabled && material.menuVisible && material.id !== MAT.NONE);
  const transformedByBase = new Map();
  for (const material of visible) {
    const color = new THREE.Color().setHex(material.color);
    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    color.multiplyScalar(paletteVisibilityMultiplier(luminance, "clarity"));
    const transformed = color.getHex();
    if (transformedByBase.has(material.color)) assert.equal(transformedByBase.get(material.color), transformed);
    else transformedByBase.set(material.color, transformed);
  }
  assert.equal(new Set(visible.map((material) => material.color)).size, 156);
  assert.equal(new Set(transformedByBase.values()).size, transformedByBase.size);
});

test("the complete upstream tool, wall and built-in Life registries are synchronized", () => {
  assert.equal(UPSTREAM_TOOLS.length, 11);
  assert.equal(UPSTREAM_WALLS.length, 19);
  assert.equal(UPSTREAM_LIFE_RULES.length, 24);
  assert.equal(UPSTREAM_TOOLS[0].identifier, "DEFAULT_TOOL_HEAT");
  assert.equal(UPSTREAM_WALLS[8].identifier, "DEFAULT_WL_WALL");
  assert.equal(UPSTREAM_LIFE_RULES[0].code, "GOL");
});

test("all menu-visible elements resolve to a supported remaster category", () => {
  const visible = MATERIALS.filter((material) => material.enabled && material.menuVisible && material.id !== MAT.NONE);
  assert.equal(visible.length, UPSTREAM_VISIBLE_ELEMENT_COUNT - 1);
  assert.ok(visible.every((material) => CATEGORY_ORDER.includes(material.category)));
  assert.ok(CATEGORY_ORDER.every((category) => materialsInCategory(category).length > 0));
});

test("every generated phase transition resolves to a registered upstream ID", () => {
  for (const material of MATERIALS) {
    for (const transition of [material.lowTemperatureTransition, material.highTemperatureTransition]) {
      if (transition != null) assert.ok(MATERIAL_BY_ID[transition], `${material.code} transition ${transition} must resolve`);
    }
  }
});

test("non-bespoke upstream powders participate in generic 3D gravity", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x44);
  sim.set(4, 7, 4, MAT.DUST);
  sim.step();
  const dust = sim.types.indexOf(MAT.DUST);
  assert.notEqual(dust, -1);
  assert.ok(sim.coords(dust)[1] < 7);
});

test("upstream callback-free visible elements close through shared canonical physics", () => {
  const callbackFree = [
    "DUST", "NITR", "GAS", "PLEX", "CNCT", "SALT", "DMND", "WAX", "MWAX", "LNTG", "INSL",
    "RBDM", "LRBD", "BGLA", "NICE", "DESL", "LO2", "DYST", "BRCK", "DRIC", "PSTE", "SAWD", "ROCK", "LIFE",
  ];
  for (const code of callbackFree) assert.equal(MATERIAL_BY_ID[MAT[code]].parity, "ported", code);

  const phase = new VoxelSimulation(9, 9, 9, 0x45);
  phase.random = () => 0;
  phase.set(4, 4, 4, MAT.WAX, 100);
  phase.step();
  assert.equal(phase.get(4, 4, 4), MAT.MWAX);
  const diamond = new VoxelSimulation(9, 9, 9, 0x46);
  diamond.set(4, 4, 4, MAT.DMND);
  diamond.air.injectVoxel(4, 4, 4, 256);
  diamond.step();
  assert.equal(diamond.get(4, 4, 4), MAT.DMND);
});

test("the implementation ledger count matches the audited upstream registry", () => {
  assert.equal(MATERIALS.filter((material) => material.parity === "ported").length, 195);
  assert.deepEqual(MATERIALS.filter((material) => material.parity === "generic").map((material) => material.code), []);
});
