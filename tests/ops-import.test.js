// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { VoxelSimulation } from "../src/simulation.js";
import { MAT } from "../src/materials.js";
import { applyOpsDocument, decodeOpsParticleStreams, importOps, parseBson } from "../src/ops-import.js";

function bsonCString(value) {
  return Buffer.concat([Buffer.from(value), Buffer.from([0])]);
}

function bsonDocument(entries) {
  const body = [];
  for (const [type, key, payload] of entries) body.push(Buffer.from([type]), bsonCString(key), payload);
  const length = 4 + body.reduce((total, item) => total + item.length, 0) + 1;
  const header = Buffer.alloc(4);
  header.writeInt32LE(length);
  return Buffer.concat([header, ...body, Buffer.from([0])]);
}

function bsonString(value) {
  const encoded = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeInt32LE(encoded.length + 1);
  return Buffer.concat([length, encoded, Buffer.from([0])]);
}

function bsonBinary(values) {
  const encoded = Buffer.from(values);
  const length = Buffer.alloc(4);
  length.writeInt32LE(encoded.length);
  return Buffer.concat([length, Buffer.from([0x80]), encoded]);
}

function fieldValue(value) {
  const encoded = Math.round((value + 256) * 128);
  return [encoded & 0xff, encoded >> 8];
}

test("BSON decoder accepts the primitive, binary, object and array values used by OPS", () => {
  const integer = Buffer.alloc(4);
  integer.writeInt32LE(42);
  const double = Buffer.alloc(8);
  double.writeDoubleLE(3.5);
  const nested = bsonDocument([[0x08, "ready", Buffer.from([1])]]);
  const array = bsonDocument([[0x10, "0", integer], [0x02, "1", bsonString("two")]]);
  const encoded = bsonDocument([
    [0x10, "answer", integer], [0x01, "ratio", double], [0x08, "ok", Buffer.from([1])],
    [0x02, "name", bsonString("OPS")], [0x05, "data", bsonBinary([1, 2, 3])],
    [0x03, "nested", nested], [0x04, "items", array],
  ]);
  const decoded = parseBson(encoded);
  assert.equal(decoded.answer, 42);
  assert.equal(decoded.ratio, 3.5);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.name, "OPS");
  assert.deepEqual([...decoded.data], [1, 2, 3]);
  assert.deepEqual(decoded.nested, { ready: true });
  assert.deepEqual(decoded.items, [42, "two"]);
});

test("BSON decoder preserves OPS palette identifier keys despite its legacy array tag", () => {
  const water = Buffer.alloc(4);
  water.writeInt32LE(2);
  const uranium = Buffer.alloc(4);
  uranium.writeInt32LE(32);
  const palette = bsonDocument([
    [0x10, "DEFAULT_PT_WATR", water],
    [0x10, "DEFAULT_PT_URAN", uranium],
  ]);
  const decoded = parseBson(bsonDocument([[0x04, "palette", palette]]));
  assert.deepEqual(decoded.palette, { DEFAULT_PT_WATR: 2, DEFAULT_PT_URAN: 32 });
});

test("OPS1 container validation and bzip2 decompression reach the BSON payload", () => {
  const compressedEmptyBson = Buffer.from("QlpoOTFBWSZTWdEWoG0AAALAAEIAIAAhAIKTF3JFOFCQ0RagbQ==", "base64");
  const header = Buffer.from([0x4f, 0x50, 0x53, 0x31, 100, 4, 1, 1, 5, 0, 0, 0]);
  const simulation = new VoxelSimulation(8, 8, 5, 0x0b21);
  const report = importOps(Buffer.concat([header, compressedEmptyBson]), simulation, 2);
  assert.equal(report.savedVersion, 100);
  assert.equal(report.total, 0);
  assert.equal(report.imported, 0);
});

test("OPS decompression works with the browser Buffer compatibility shim", () => {
  const compressedEmptyBson = Buffer.from("QlpoOTFBWSZTWdEWoG0AAALAAEIAIAAhAIKTF3JFOFCQ0RagbQ==", "base64");
  const header = Buffer.from([0x4f, 0x50, 0x53, 0x31, 100, 4, 1, 1, 5, 0, 0, 0]);
  const saveBytes = Uint8Array.from(Buffer.concat([header, compressedEmptyBson]));
  const nativeBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const report = importOps(saveBytes, new VoxelSimulation(8, 8, 5, 0x0b21), 2);
    assert.equal(report.imported, 0);
  } finally {
    globalThis.Buffer = nativeBuffer;
  }
});

test("OPS particle stream decoder preserves every serialized particle field and flips screen-space Y velocity", () => {
  const positions = new Uint8Array(4 * 4 * 3);
  positions[(2 * 4 + 1) * 3 + 2] = 1;
  const parts = Uint8Array.from([
    MAT.DUST, 0xff, 0xbf,
    0x34, 0x12,
    0x01,
    0x78, 0x56,
    0x34, 0x12, 0x78, 0x56,
    0x44, 0x11, 0x22, 0x33,
    0xaa, 0xbb, 0xcc, 0xdd,
    143, 111,
    0x34, 0x12,
    0x34, 0x12, 0x78, 0x56, 0xbc, 0x9a, 0xf0, 0xde,
  ]);
  const [particle] = decodeOpsParticleStreams({ parts, partsPos: positions }, 4, 4, 100);
  assert.equal(particle.sourceX, 1);
  assert.equal(particle.sourceY, 2);
  assert.equal(particle.type, MAT.DUST);
  assert.ok(Math.abs(particle.temperature - (0x1234 - 273.15)) < 0.001);
  assert.equal(particle.life, 0x5678);
  assert.equal(particle.tmp, 0x78561234);
  assert.equal(particle.ctype, 0x11223344);
  assert.equal(particle.decoration, 0xaabbccdd);
  assert.equal(particle.velocityX, 1);
  assert.equal(particle.velocityY, 1);
  assert.equal(particle.tmp2, 0x1234);
  assert.equal(particle.tmp3, -0x6543edcc);
  assert.equal(particle.tmp4, -0x210fa988);
});

test("OPS palette remapping replaces only packed element bits in every declared carrier field", () => {
  const positions = new Uint8Array(4 * 4 * 3);
  positions[2] = 2;
  const packedWater = (7 << 9) | 200;
  const parts = Uint8Array.from([
    MAT.CRAY, 0x20, 0x02, 0, packedWater & 0xff, packedWater >>> 24, packedWater >>> 16, packedWater >>> 8,
    MAT.CONV, 0x38, 0x02, 0,
    packedWater & 0xff, packedWater & 0xff00 ? (packedWater >>> 8) & 0xff : 0,
    packedWater & 0xff, packedWater >>> 24, packedWater >>> 16, packedWater >>> 8,
  ]);
  const palette = {
    DEFAULT_PT_CRAY: MAT.CRAY,
    DEFAULT_PT_CONV: MAT.CONV,
    DEFAULT_PT_WATR: 200,
  };
  const decoded = decodeOpsParticleStreams({ parts, partsPos: positions, palette, pmapbits: 9 }, 4, 4, 100);
  assert.equal(decoded[0].ctype, (7 << 9) | MAT.WATR);
  assert.equal(decoded[1].tmp, (7 << 9) | MAT.WATR);
  assert.equal(decoded[1].ctype, (7 << 9) | MAT.WATR);
});

test("OPS applies upstream particle migrations before palette mapping", () => {
  const positions = new Uint8Array(4 * 4 * 3);
  positions[2] = 4;
  const parts = Uint8Array.from([
    MAT.CRAY, 0x20, 0x04, 0, MAT.WATR, 3,
    MAT.PSTN, 0x20, 0x00, 127, MAT.DUST,
    MAT.PIPE, 0x38, 0x00, 0, 0x34, 0x12, 1,
    MAT.LIFE, 0x38, 0x00, 0, 6, 0, 3,
  ]);
  const decoded = decodeOpsParticleStreams({ parts, partsPos: positions }, 4, 4, 86);
  assert.equal(decoded[0].ctype, (3 << 8) | MAT.WATR);
  assert.equal(decoded[0].tmp2, 0);
  assert.equal(decoded[1].life, 1);
  assert.ok(Math.abs(decoded[1].temperature - 10) < 0.001);
  assert.equal(decoded[2].tmp, 0x21200);
  assert.equal(decoded[3].tmp2, 6);
  assert.equal(decoded[3].tmp, 0xffff00);
  assert.notEqual(decoded[3].decoration, 0);
});

test("OPS placement restores callback-sensitive serialized particle state verbatim", () => {
  const positions = new Uint8Array(4 * 4 * 3);
  positions[2] = 1;
  const document = {
    partsPos: positions,
    parts: Uint8Array.from([MAT.LIGH, 0x02, 0x04, 0, 99, 9]),
  };
  const simulation = new VoxelSimulation(8, 8, 5, 0x9117);
  applyOpsDocument(document, { savedVersion: 100, cellSize: 4, blockWidth: 1, blockHeight: 1 }, simulation, 2);
  const lightning = simulation.types.findIndex((type) => type === MAT.LIGH);
  assert.ok(lightning >= 0);
  assert.equal(simulation.life[lightning], 99);
  assert.equal(simulation.tmp2[lightning], 9);
});

test("OPS projection fits sparse content bounds and spills dense columns into nearby 3D capacity", () => {
  const sourceWidth = 64;
  const sourceHeight = 64;
  const positions = new Uint8Array(sourceWidth * sourceHeight * 3);
  const parts = [];
  for (let y = 20; y < 28; y += 1) {
    for (let x = 20; x < 28; x += 1) {
      positions[(y * sourceWidth + x) * 3 + 2] = 1;
      parts.push(MAT.DUST, 0, 0, 0);
    }
  }
  const fitted = new VoxelSimulation(8, 8, 4, 0xf177);
  const fittedReport = applyOpsDocument(
    { partsPos: positions, parts: Uint8Array.from(parts) },
    { savedVersion: 100, cellSize: 4, blockWidth: 16, blockHeight: 16 },
    fitted,
    2,
  );
  assert.equal(fittedReport.imported, 64);
  assert.equal(fittedReport.omitted, 0);
  assert.deepEqual(fittedReport.contentBounds, { minX: 20, minY: 20, maxX: 27, maxY: 27 });
  assert.equal(fittedReport.scale, 1);

  const stackedPositions = new Uint8Array(4 * 4 * 3);
  stackedPositions[(2 * 4 + 2) * 3 + 2] = 10;
  const stackedParts = Uint8Array.from(Array.from({ length: 10 }, () => [MAT.DUST, 0, 0, 0]).flat());
  const spilled = new VoxelSimulation(6, 6, 2, 0xf178);
  const spilledReport = applyOpsDocument(
    { partsPos: stackedPositions, parts: stackedParts },
    { savedVersion: 100, cellSize: 4, blockWidth: 1, blockHeight: 1 },
    spilled,
    1,
  );
  assert.equal(spilledReport.imported, 10);
  assert.equal(spilledReport.omitted, 0);
  assert.ok(new Set(Array.from(spilled.types.entries()).filter(([, type]) => type === MAT.DUST).map(([index]) => spilled.coords(index).slice(0, 2).join(","))).size >= 5);
});

test("OPS rejects truncated optional field planes instead of partially importing them", () => {
  const simulation = new VoxelSimulation(8, 8, 5, 0x7474);
  const metadata = { savedVersion: 100, cellSize: 4, blockWidth: 2, blockHeight: 1 };
  assert.throws(
    () => applyOpsDocument({ pressMap: Uint8Array.from([0, 0]) }, metadata, simulation, 2),
    /not enough pressure data/,
  );
  assert.throws(
    () => applyOpsDocument({ gravity: new Uint8Array(16) }, metadata, simulation, 2),
    /not enough gravity data/,
  );
});

test("OPS worlds project particles, overlapping energy, fields, fan walls, SOAP links and signs into 3D", () => {
  const positions = new Uint8Array(4 * 4 * 3);
  positions[(2 * 4 + 1) * 3 + 2] = 3;
  const parts = Uint8Array.from([
    MAT.SOAP, 0, 0, 0,
    MAT.SOAP, 0, 0, 0,
    MAT.PHOT, 0, 0, 0,
  ]);
  const gravity = new Uint8Array(16);
  const gravityView = new DataView(gravity.buffer);
  gravityView.setFloat32(0, 1, true);
  gravityView.setUint32(4, 0, true);
  gravityView.setFloat32(8, 2, true);
  gravityView.setFloat32(12, 3, true);
  const document = {
    parts,
    partsPos: positions,
    soapLinks: Uint8Array.from([0, 0, 2, 0, 0, 0]),
    wallMap: Uint8Array.from([5]),
    fanMap: Uint8Array.from([191, 63]),
    pressMap: Uint8Array.from(fieldValue(1)),
    vxMap: Uint8Array.from(fieldValue(2)),
    vyMap: Uint8Array.from(fieldValue(3)),
    ambientMap: Uint8Array.from([0x2c, 0x01]),
    gravity,
    signs: [{ x: 1, y: 2, text: "Imported reactor", justification: 2 }],
    legacyEnable: true,
    gravityEnable: true,
    aheat_enable: true,
    waterEEnabled: true,
    edgePressure: -4.5,
    edgeVelocityX: 1.25,
    edgeVelocityY: -2.5,
    vorticityCoeff: 0.65,
    convectionMode: 1,
    paused: true,
  };
  const simulation = new VoxelSimulation(8, 8, 5, 0x0f51);
  const report = applyOpsDocument(document, { savedVersion: 100, cellSize: 4, blockWidth: 1, blockHeight: 1 }, simulation, 2);
  assert.deepEqual(report.sourceDimensions, [4, 4]);
  assert.equal(report.imported, 3);
  assert.equal(report.omitted, 0);
  assert.equal(report.paused, true);
  const soaps = [];
  for (let index = 0; index < simulation.size; index += 1) if (simulation.types[index] === MAT.SOAP) soaps.push(index);
  assert.equal(soaps.length, 2);
  assert.equal(simulation.tmp[soaps[0]], soaps[1]);
  assert.equal(simulation.tmp2[soaps[1]], soaps[0]);
  assert.ok(simulation.ctype[soaps[0]] & 2);
  assert.ok(simulation.ctype[soaps[1]] & 4);
  assert.equal(simulation.energyTypes.filter((type) => type === MAT.PHOT).length, 1);
  const fanIndex = simulation.walls.findIndex((wall) => wall === 6);
  assert.ok(fanIndex >= 0);
  assert.equal(simulation.wallFanX[fanIndex], 1);
  assert.equal(simulation.wallFanY[fanIndex], 1);
  assert.ok(Math.abs(simulation.air.pressure[fanIndex] - 1) < 0.001);
  assert.ok(Math.abs(simulation.air.velocityX[fanIndex] - 2) < 0.001);
  assert.ok(Math.abs(simulation.air.velocityY[fanIndex] + 3) < 0.001);
  assert.ok(Math.abs(simulation.air.ambientHeat[fanIndex] - 26.85) < 0.001);
  assert.equal(simulation.gravity.mass[fanIndex], 1);
  assert.equal(simulation.gravity.forceX[fanIndex], 2);
  assert.equal(simulation.gravity.forceY[fanIndex], -3);
  assert.equal(simulation.signs[0].text, "Imported reactor");
  assert.equal(simulation.signs[0].z, 2);
  assert.equal(simulation.signs[0].justification, "right");
  assert.equal(simulation.heatSimulationEnabled, false);
  assert.equal(simulation.newtonianGravityEnabled, true);
  assert.equal(simulation.air.ambientHeatEnabled, true);
  assert.equal(simulation.waterEqualization, true);
  assert.equal(simulation.air.edgePressure, -4.5);
  assert.equal(simulation.air.edgeVelocityX, 1.25);
  assert.equal(simulation.air.edgeVelocityY, 2.5);
  assert.equal(simulation.air.vorticityCoeff, 0.65);
  assert.equal(simulation.air.convectionMode, 1);
});
