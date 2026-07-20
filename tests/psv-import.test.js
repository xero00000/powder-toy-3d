// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { MAT, UPSTREAM_WALLS } from "../src/materials.js";
import { VoxelSimulation } from "../src/simulation.js";
import { applyPsvPayload, decodePsvPayload, importPsv } from "../src/psv-import.js";

const wallId = (identifier) => UPSTREAM_WALLS.find((wall) => wall.identifier === identifier).id;

function pushBe16(output, value) {
  output.push((value >> 8) & 0xff, value & 0xff);
}

function makeVersion77Payload() {
  const output = [127, 131, 191, 63]; // FAN, WALL, +1 fan X, -1 legacy fan Y.
  const typePlane = new Uint8Array(8 * 4);
  typePlane[1 + 1 * 8] = MAT.SAND;
  typePlane[2 + 1 * 8] = MAT.PHOT;
  typePlane[3 + 1 * 8] = MAT.LIFE;
  typePlane[4 + 1 * 8] = MAT.PBCN;
  typePlane[5 + 1 * 8] = MAT.TRON;
  output.push(...typePlane);
  const types = [MAT.SAND, MAT.PHOT, MAT.LIFE, MAT.PBCN, MAT.TRON];
  for (let index = 0; index < types.length; index += 1) output.push(index ? 127 : 143, index ? 127 : 111);
  for (const life of [300, 40, 12, 4, 5]) pushBe16(output, life);
  for (const tmp of [0x1234, 2, 6, 8, 10]) pushBe16(output, tmp);
  output.push(9, 7); // Conditional PBCN and TRON tmp2 values.
  const decoration = [0x80402010, 0, 0, 0, 0];
  for (const shift of [24, 16, 8, 0]) for (const color of decoration) output.push((color >>> shift) & 0xff);
  for (const kelvin of [300, 1200, 295, 294, 293]) pushBe16(output, kelvin);
  output.push(3, MAT.WATR); // LIFE and PBCN ctypes.
  output.push(1, 1, 0, 2, 0, 2, 3, 0x7b, 0x74, 0x7d); // One right-aligned "{t}" sign.
  return Uint8Array.from(output);
}

const metadata = Object.freeze({
  magic: "PSv", savedVersion: 77, cellSize: 4, blockWidth: 2, blockHeight: 1,
  legacyEnable: false, legacyBeta: false, paused: true, gravityMode: 2, airMode: 3, gravityEnable: true,
});

test("PSv payload decoder restores interleaved legacy fields and migrations", () => {
  const decoded = decodePsvPayload(makeVersion77Payload(), metadata);
  assert.deepEqual(decoded.walls, [wallId("DEFAULT_WL_FAN"), wallId("DEFAULT_WL_WALL")]);
  assert.equal(decoded.fanX[0], 1);
  assert.equal(decoded.fanY[0], 1);
  assert.equal(decoded.particles.length, 5);
  assert.deepEqual(decoded.particles.map((particle) => particle.type), [MAT.SAND, MAT.PHOT, MAT.LIFE, MAT.PBCN, MAT.TRON]);
  const dust = decoded.particles[0];
  assert.equal(dust.life, 300);
  assert.equal(dust.tmp, 0x1234);
  assert.equal(dust.velocityX, 1);
  assert.equal(dust.velocityY, 1);
  assert.equal(dust.decoration, 0x80402010);
  assert.ok(Math.abs(dust.temperature - 26.85) < 0.001);
  assert.equal(decoded.particles[1].flags, 0x08);
  assert.equal(decoded.particles[2].ctype, 3);
  assert.equal(decoded.particles[2].tmp2, 6);
  assert.equal(decoded.particles[3].ctype, MAT.WATR);
  assert.equal(decoded.particles[3].tmp2, 9);
  assert.equal(decoded.particles[4].tmp2, 7);
  assert.deepEqual(decoded.signs, [{ x: 1, y: 2, justification: "right", text: "Temp: {t}" }]);
});

test("PSv payloads project walls, energy, matter, settings and signs into a 3D chamber", () => {
  const simulation = new VoxelSimulation(16, 12, 8, 123);
  const report = applyPsvPayload(decodePsvPayload(makeVersion77Payload(), metadata), metadata, simulation, 4);
  assert.equal(report.format, "PSv");
  assert.equal(report.imported, 5);
  assert.equal(report.omitted, 0);
  assert.equal(report.paused, true);
  assert.equal(simulation.gravityMode, 2);
  assert.equal(simulation.air.mode, 3);
  assert.equal(simulation.heatSimulationEnabled, true);
  assert.equal(simulation.newtonianGravityEnabled, true);
  assert.ok(simulation.types.includes(MAT.SAND));
  assert.ok(simulation.types.includes(MAT.LIFE));
  assert.ok(simulation.energyTypes.includes(MAT.PHOT));
  const fan = simulation.walls.findIndex((wall) => wall === wallId("DEFAULT_WL_FAN") + 1);
  assert.ok(fan >= 0);
  assert.equal(simulation.wallFanX[fan], 1);
  assert.equal(simulation.wallFanY[fan], 1);
  assert.equal(simulation.signs.length, 1);
  assert.equal(simulation.signs[0].text, "Temp: {t}");
  assert.equal(simulation.signs[0].justification, "right");
});

test("PSv projection fits sparse content bounds and spills dense columns into nearby 3D capacity", () => {
  const particle = (sourceX, sourceY) => ({
    sourceX, sourceY, savedType: MAT.DUST, type: MAT.DUST, temperature: 22, life: 0,
    ctype: 0, tmp: 0, tmp2: 0, tmp3: 0, tmp4: 0, velocityX: 0, velocityY: 0,
    velocityZ: 0, flags: 0, decoration: 0,
  });
  const decoded = {
    sourceWidth: 64,
    sourceHeight: 64,
    walls: new Uint8Array(16 * 16),
    fanX: new Float32Array(16 * 16),
    fanY: new Float32Array(16 * 16),
    particles: Array.from({ length: 10 }, () => particle(40, 40)),
    signs: [],
  };
  const simulation = new VoxelSimulation(6, 6, 2, 0xf179);
  const report = applyPsvPayload(
    decoded,
    { ...metadata, blockWidth: 16, blockHeight: 16 },
    simulation,
    1,
  );
  assert.equal(report.imported, 10);
  assert.equal(report.omitted, 0);
  assert.deepEqual(report.contentBounds, { minX: 40, minY: 40, maxX: 40, maxY: 40 });
  assert.equal(report.scale, 1);
  assert.ok(new Set(Array.from(simulation.types.entries())
    .filter(([, type]) => type === MAT.DUST)
    .map(([index]) => simulation.coords(index).slice(0, 2).join(","))).size >= 5);
});

test("PSv container importer validates the header and bunzip payload", () => {
  const compressed = Uint8Array.from(Buffer.from("QlpoOTFBWSZTWb2P95MAAABAAEACIAAhAIKDF3JFOFCQvY/3kw==", "base64"));
  const save = new Uint8Array(12 + compressed.length);
  save.set([0x50, 0x53, 0x76, 0x80, 77, 4, 1, 1, 17, 0, 0, 0]);
  save.set(compressed, 12);
  const simulation = new VoxelSimulation(8, 8, 6, 456);
  const report = importPsv(save, simulation, 3);
  assert.equal(report.savedVersion, 77);
  assert.equal(report.total, 0);
  assert.equal(report.imported, 0);
  assert.equal(simulation.newtonianGravityEnabled, true);
});

test("pre-51 GoL IDs become canonical LIFE rules", () => {
  const oldMetadata = { ...metadata, savedVersion: 50 };
  const particle = {
    sourceX: 0, sourceY: 0, savedType: 134, type: 134, temperature: 22, life: 0,
    ctype: 0, tmp: 0, tmp2: 0, tmp3: 0, tmp4: 0, velocityX: 0, velocityY: 0,
    velocityZ: 0, flags: 0, decoration: 0,
  };
  const decoded = {
    sourceWidth: 4, sourceHeight: 4, walls: [0], fanX: new Float32Array(1), fanY: new Float32Array(1),
    particles: [particle], signs: [],
  };
  // Exercise the migration through an authentic minimal v50 property stream.
  const payload = [];
  payload.push(0, ...new Uint8Array(16).fill(0));
  payload[1] = 134;
  payload.push(127, 127, 0, 0, 0, 0, 0, 0, 0, 0); // velocity, life, tmp and ARGB.
  pushBe16(payload, 295);
  const migrated = decodePsvPayload(Uint8Array.from(payload), { ...oldMetadata, blockWidth: 1, blockHeight: 1 });
  assert.equal(migrated.particles[0].type, MAT.LIFE);
  assert.equal(migrated.particles[0].ctype, 12);
  assert.equal(migrated.particles[0].tmp2, 1);
  assert.equal(decoded.particles[0].type, 134); // decoder does not mutate caller-owned fixture objects.
});

test("PSv coarse palette rejects element IDs that did not exist in the legacy format", () => {
  const payload = [0, ...new Uint8Array(16)];
  payload[1] = MAT.LDTC;
  payload.push(127, 127, 0, 0, 0, 0, 0, 0, 0, 0); // velocity, life, tmp and ARGB.
  pushBe16(payload, 295);
  const decoded = decodePsvPayload(Uint8Array.from(payload), {
    ...metadata, savedVersion: 77, blockWidth: 1, blockHeight: 1,
  });
  assert.equal(decoded.particles.length, 1);
  assert.equal(decoded.particles[0].type, MAT.EMPTY);
});
