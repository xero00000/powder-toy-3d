// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { PIPE_FLAG, VoxelSimulation } from "../src/simulation.js";
import { MAT, UPSTREAM_LIFE_RULES, UPSTREAM_TOOLS, UPSTREAM_WALLS, materialById } from "../src/materials.js";

const wallId = (identifier) => UPSTREAM_WALLS.find((wall) => wall.identifier === identifier).id;
const toolId = (code) => UPSTREAM_TOOLS.find((tool) => tool.code === code).id;

test("coarse 3D walls enforce original material filters", () => {
  const sim = new VoxelSimulation(12, 12, 12, 0x1010);
  const liquidWall = wallId("DEFAULT_WL_LIQD");
  sim.paintWallSphere(5, 5, 5, 2, liquidWall);
  assert.equal(sim.wallAllows(MAT.WATR, 5, 5, 5), true);
  assert.equal(sim.wallAllows(MAT.SAND, 5, 5, 5), false);

  sim.paintWallSphere(5, 5, 5, 2, wallId("DEFAULT_WL_WALL"));
  assert.equal(sim.wallAllows(MAT.WATR, 5, 5, 5), false);
  assert.equal(sim.air.blocked[sim.air.indexForVoxel(5, 5, 5)], 1);
});

test("upstream heat, cool, air and vacuum tools modify their target fields", () => {
  const sim = new VoxelSimulation(12, 12, 12, 0x2020);
  sim.set(5, 5, 5, MAT.METL, 22);
  sim.applyToolSphere(5, 5, 5, 1, toolId("HEAT"));
  assert.equal(sim.temperatures[sim.index(5, 5, 5)], 122);
  sim.applyToolSphere(5, 5, 5, 1, toolId("COOL"));
  assert.equal(sim.temperatures[sim.index(5, 5, 5)], 22);
  sim.applyToolSphere(5, 5, 5, 1, toolId("AIR"));
  assert.ok(sim.air.sampleVoxel(5, 5, 5).pressure > 0);
  sim.applyToolSphere(5, 5, 5, 1, toolId("VAC"));
  assert.ok(Math.abs(sim.air.sampleVoxel(5, 5, 5).pressure) < 0.001);
});

test("all 11 simulation tools produce their distinct 3D field or particle effect", () => {
  assert.equal(UPSTREAM_TOOLS.length, 11);
  const at = (code) => UPSTREAM_TOOLS.find((tool) => tool.code === code).id;
  const thermal = new VoxelSimulation(12, 12, 12, 0x2021);
  thermal.set(5, 5, 5, MAT.METL, 22);
  thermal.applyToolSphere(5, 5, 5, 1, at("HEAT"));
  thermal.applyToolSphere(5, 5, 5, 1, at("COOL"));
  assert.equal(thermal.temperatures[thermal.index(5, 5, 5)], 22);
  thermal.applyToolSphere(5, 5, 5, 1, at("AIR"));
  assert.ok(thermal.air.sampleVoxel(5, 5, 5).pressure > 0);
  thermal.applyToolSphere(5, 5, 5, 1, at("VAC"));
  assert.equal(thermal.air.sampleVoxel(5, 5, 5).pressure, 0);
  thermal.applyToolSphere(5, 5, 5, 1, at("AMBP"));
  assert.ok(thermal.air.sampleVoxel(5, 5, 5).temperature > 22);
  thermal.applyToolSphere(5, 5, 5, 1, at("AMBM"));
  assert.equal(thermal.air.sampleVoxel(5, 5, 5).temperature, 22);

  const gravity = new VoxelSimulation(12, 12, 12, 0x2022);
  gravity.applyToolSphere(5, 5, 5, 1, at("PGRV"));
  assert.ok(gravity.gravity.toolMass[gravity.gravity.indexForVoxel(5, 5, 5)] > 0);
  gravity.applyToolSphere(5, 5, 5, 1, at("NGRV"));
  assert.equal(gravity.gravity.toolMass[gravity.gravity.indexForVoxel(5, 5, 5)], 0);

  const mix = new VoxelSimulation(12, 12, 12, 0x2023);
  mix.random = () => 0;
  mix.set(5, 5, 5, MAT.SAND);
  mix.applyToolSphere(5, 5, 5, 1, at("MIX"));
  assert.equal(mix.get(4, 5, 5), MAT.SAND);

  const flow = new VoxelSimulation(16, 16, 16, 0x2024);
  flow.applyToolSphere(8, 8, 8, 4, at("CYCL"));
  assert.ok(flow.air.velocityX.some((value) => value !== 0));
  assert.ok(flow.air.velocityZ.some((value) => value !== 0));
  flow.applyToolSphere(8, 8, 8, 1, at("WIND"), "sphere", [0, 3, -7]);
  const wind = flow.air.sampleVoxel(8, 8, 8);
  assert.ok(wind.velocityY > 0);
  assert.ok(wind.velocityZ < 0);
});

test("all 19 wall definitions enforce filters, air blocking, fans and erase-all semantics", () => {
  assert.equal(UPSTREAM_WALLS.length, 19);
  const allows = new Map([
    ["DEFAULT_WL_CNDTW", [MAT.SAND, false]], ["DEFAULT_WL_EWALL", [MAT.SAND, false]],
    ["DEFAULT_WL_DTECT", [MAT.SAND, true]], ["DEFAULT_WL_STRM", [MAT.SAND, true]],
    ["DEFAULT_WL_FAN", [MAT.SAND, true]], ["DEFAULT_WL_LIQD", [MAT.WATR, true]],
    ["DEFAULT_WL_ABSRB", [MAT.SAND, true]], ["DEFAULT_WL_WALL", [MAT.SAND, false]],
    ["DEFAULT_WL_AIR", [MAT.SAND, false]], ["DEFAULT_WL_POWDR", [MAT.SAND, true]],
    ["DEFAULT_WL_CNDTR", [MAT.SAND, true]], ["DEFAULT_WL_EHOLE", [MAT.SAND, true]],
    ["DEFAULT_WL_GAS", [MAT.GAS, true]], ["DEFAULT_WL_GRVTY", [MAT.SAND, true]],
    ["DEFAULT_WL_ENRGY", [MAT.PHOT, true]], ["DEFAULT_WL_NOAIR", [MAT.SAND, true]],
    ["DEFAULT_WL_STASIS", [MAT.SAND, true]],
  ]);
  for (const wall of UPSTREAM_WALLS) {
    if (["DEFAULT_WL_ERASE", "DEFAULT_WL_ERASEA"].includes(wall.identifier)) continue;
    const sim = new VoxelSimulation(12, 12, 12, wall.id + 0x2030);
    sim.paintWallSphere(5, 5, 5, 1, wall.id);
    const [type, expected] = allows.get(wall.identifier);
    assert.equal(sim.wallAllows(type, 5, 5, 5), expected, wall.identifier);
  }

  const electric = new VoxelSimulation(12, 12, 12, 0x2040);
  electric.paintWallSphere(5, 5, 5, 1, wallId("DEFAULT_WL_EWALL"));
  const wallIndex = electric.air.indexForVoxel(5, 5, 5);
  electric.wallElectricity[wallIndex] = 16;
  assert.equal(electric.wallAllows(MAT.SAND, 5, 5, 5), true);

  const fan = new VoxelSimulation(12, 12, 12, 0x2041);
  fan.paintWallSphere(5, 5, 5, 1, wallId("DEFAULT_WL_FAN"));
  fan.setFanVectorSphere(5, 5, 5, 1, 0, 6, -2);
  fan.applyWallFans();
  const air = fan.air.sampleVoxel(5, 5, 5);
  assert.ok(air.velocityY > 0);
  assert.ok(air.velocityZ < 0);

  const erase = new VoxelSimulation(12, 12, 12, 0x2042);
  erase.set(5, 5, 5, MAT.STNE);
  erase.setEnergy(5, 5, 5, MAT.PHOT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  erase.paintWallSphere(5, 5, 5, 1, wallId("DEFAULT_WL_WALL"));
  erase.paintWallSphere(5, 5, 5, 1, wallId("DEFAULT_WL_ERASEA"));
  assert.equal(erase.get(5, 5, 5), MAT.EMPTY);
  assert.equal(erase.getEnergy(5, 5, 5), MAT.EMPTY);
  assert.equal(erase.wallAtVoxel(5, 5, 5), null);
});

test("the canonical Game of Life rule evolves synchronously on each depth plane", () => {
  const sim = new VoxelSimulation(9, 9, 5, 0x3030);
  for (const x of [3, 4, 5]) sim.set(x, 4, 2, MAT.LIFE, 22, 0, { ctype: 0 });
  sim.step();
  assert.equal(sim.get(4, 3, 2), MAT.LIFE);
  assert.equal(sim.get(4, 4, 2), MAT.LIFE);
  assert.equal(sim.get(4, 5, 2), MAT.LIFE);
  assert.equal(sim.get(3, 4, 2), MAT.EMPTY);
  assert.equal(sim.get(5, 4, 2), MAT.EMPTY);
});

test("all 24 built-in Life rules honor every encoded survival and birth count", () => {
  const neighbors = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (const rule of UPSTREAM_LIFE_RULES) {
    const states = ((rule.ruleset >> 17) & 0xf) + 2;
    for (let count = 0; count <= 8; count += 1) {
      const survival = new VoxelSimulation(7, 7, 3, rule.id * 100 + count);
      survival.set(3, 3, 1, MAT.LIFE, 22, 0, { ctype: rule.id });
      for (let n = 0; n < count; n += 1) survival.set(3 + neighbors[n][0], 3 + neighbors[n][1], 1, MAT.LIFE, 22, 0, { ctype: rule.id });
      survival.updateLife();
      const survives = Boolean((rule.ruleset >> count) & 1);
      const center = survival.index(3, 3, 1);
      if (survives) {
        assert.equal(survival.types[center], MAT.LIFE, `${rule.code} S${count}`);
        assert.equal(survival.tmp[center], 0, `${rule.code} S${count} primary state`);
      } else if (states > 2) {
        assert.equal(survival.types[center], MAT.LIFE, `${rule.code} generations S${count}`);
        assert.equal(survival.tmp[center], states - 2, `${rule.code} decay S${count}`);
      } else assert.equal(survival.types[center], MAT.EMPTY, `${rule.code} !S${count}`);

      if (count === 0) continue;
      const birth = new VoxelSimulation(7, 7, 3, rule.id * 1000 + count);
      for (let n = 0; n < count; n += 1) birth.set(3 + neighbors[n][0], 3 + neighbors[n][1], 1, MAT.LIFE, 22, 0, { ctype: rule.id });
      birth.updateLife();
      assert.equal(birth.get(3, 3, 1) === MAT.LIFE, Boolean((rule.ruleset >> (count + 8)) & 1), `${rule.code} B${count}`);
    }
  }
});

test("battery sparks conductors and sparks propagate through a 3D circuit", () => {
  const sim = new VoxelSimulation(12, 8, 8, 0x4040);
  sim.set(2, 4, 4, MAT.BTRY);
  sim.set(4, 4, 4, MAT.METL);
  sim.set(6, 4, 4, MAT.METL);
  sim.step();
  assert.equal(sim.get(4, 4, 4), MAT.SPRK);
  assert.equal(sim.ctype[sim.index(4, 4, 4)], MAT.METL);
  sim.step();
  assert.equal(sim.get(6, 4, 4), MAT.SPRK);
});

test("spark carriers preserve their original recovery and material-specific callbacks", () => {
  const recovery = new VoxelSimulation(12, 9, 9, 0x4041);
  recovery.set(4, 4, 4, MAT.SPRK, 300, 1, { ctype: MAT.WATR });
  recovery.updateSpark(recovery.index(4, 4, 4), 4, 4, 4);
  assert.equal(recovery.get(4, 4, 4), MAT.WATR);
  assert.equal(recovery.life[recovery.index(4, 4, 4)], 64);
  assert.equal(recovery.temperatures[recovery.index(4, 4, 4)], 22);

  const thermistor = new VoxelSimulation(12, 9, 9, 0x4042);
  thermistor.set(4, 4, 4, MAT.SPRK, 30, 3, { ctype: MAT.NTCT });
  thermistor.updateSpark(thermistor.index(4, 4, 4), 4, 4, 4);
  assert.equal(thermistor.temperatures[thermistor.index(4, 4, 4)], 27.5);

  const iron = new VoxelSimulation(12, 9, 9, 0x4043);
  iron.random = () => 0;
  iron.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.IRON });
  iron.set(5, 4, 4, MAT.WATR);
  iron.updateSpark(iron.index(4, 4, 4), 4, 4, 4);
  assert.equal(iron.get(5, 4, 4), MAT.O2);

  const tungsten = new VoxelSimulation(12, 9, 9, 0x4044);
  tungsten.random = () => 0;
  tungsten.set(4, 4, 4, MAT.SPRK, 100, 3, { ctype: MAT.TUNG });
  tungsten.updateSpark(tungsten.index(4, 4, 4), 4, 4, 4);
  assert.equal(tungsten.temperatures[tungsten.index(4, 4, 4)], 96);

  const invalid = new VoxelSimulation(12, 9, 9, 0x4045);
  invalid.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.SPRK });
  invalid.updateSpark(invalid.index(4, 4, 4), 4, 4, 4);
  assert.equal(invalid.get(4, 4, 4), MAT.EMPTY);
});

test("spark-to-spark controls, ETRD timing and noble plasma retain upstream quirks", () => {
  const switchOff = new VoxelSimulation(14, 9, 9, 0x4046);
  switchOff.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.NSCN });
  switchOff.set(5, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.SWCH });
  switchOff.updateSpark(switchOff.index(4, 4, 4), 4, 4, 4);
  assert.equal(switchOff.get(5, 4, 4), MAT.SWCH);
  assert.equal(switchOff.life[switchOff.index(5, 4, 4)], 9);

  const heated = new VoxelSimulation(14, 9, 9, 0x4047);
  heated.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  heated.set(5, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PTCT });
  heated.updateSpark(heated.index(4, 4, 4), 4, 4, 4);
  assert.ok(Math.abs(heated.temperatures[heated.index(5, 4, 4)] - 199.85) < 1e-3);

  const electrode = new VoxelSimulation(14, 9, 9, 0x4048);
  electrode.set(4, 4, 4, MAT.SPRK, 22, 6, { ctype: MAT.ETRD });
  electrode.set(5, 4, 4, MAT.METL);
  electrode.updateSpark(electrode.index(4, 4, 4), 4, 4, 4);
  assert.equal(electrode.get(4, 4, 4), MAT.ETRD);
  assert.equal(electrode.life[electrode.index(4, 4, 4)], 20);
  assert.equal(electrode.get(5, 4, 4), MAT.SPRK);

  const noble = new VoxelSimulation(14, 9, 9, 0x4049);
  noble.random = () => 0;
  noble.set(4, 4, 4, MAT.SPRK, 6000, 2, { ctype: MAT.NBLE, tmp: 0 });
  noble.updateSpark(noble.index(4, 4, 4), 4, 4, 4);
  const plasma = noble.index(4, 4, 4);
  assert.equal(noble.types[plasma], MAT.PLSM);
  assert.equal(noble.life[plasma], 50);
  assert.equal(noble.ctype[plasma], MAT.NBLE);
  assert.equal(noble.tmp[plasma] & 4, 4);
  assert.ok(Math.abs(noble.temperatures[plasma] - 3226.85) < 1e-3);
});

test("silicon polarity drives switches and prevents NSCN to PSCN conduction", () => {
  const sim = new VoxelSimulation(10, 8, 8, 0x5050);
  sim.set(3, 4, 4, MAT.PSCN);
  sim.spark(sim.index(3, 4, 4), MAT.PSCN);
  sim.set(4, 4, 4, MAT.SWCH);
  sim.step();
  assert.equal(sim.life[sim.index(4, 4, 4)], 10);

  const blocked = new VoxelSimulation(10, 8, 8, 0x5051);
  blocked.set(3, 4, 4, MAT.NSCN);
  blocked.spark(blocked.index(3, 4, 4), MAT.NSCN);
  blocked.set(4, 4, 4, MAT.PSCN);
  blocked.step();
  assert.equal(blocked.get(4, 4, 4), MAT.PSCN);
});

test("switches synchronize networks, conduct active sparks and accept crossed red BRAY", () => {
  const network = new VoxelSimulation(14, 10, 9, 0x5052);
  network.set(5, 5, 4, MAT.SWCH);
  network.set(6, 5, 4, MAT.SWCH, 22, 10);
  network.updateSwitch(network.index(5, 5, 4), 5, 5, 4);
  assert.equal(network.life[network.index(5, 5, 4)], 10);
  network.life[network.index(6, 5, 4)] = 6;
  network.updateSwitch(network.index(5, 5, 4), 5, 5, 4);
  assert.equal(network.life[network.index(5, 5, 4)], 9);

  const conducting = new VoxelSimulation(14, 10, 9, 0x5053);
  conducting.set(5, 5, 4, MAT.SWCH, 22, 10);
  conducting.set(6, 5, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  conducting.updateSwitch(conducting.index(5, 5, 4), 5, 5, 4);
  assert.equal(conducting.get(5, 5, 4), MAT.SPRK);
  assert.equal(conducting.ctype[conducting.index(5, 5, 4)], MAT.SWCH);

  const crossed = new VoxelSimulation(14, 10, 9, 0x5054);
  crossed.set(5, 5, 4, MAT.SWCH);
  crossed.set(4, 5, 4, MAT.BRAY, 22, 2, { tmp: 2 });
  crossed.set(5, 4, 4, MAT.BRAY, 22, 2, { tmp: 2 });
  crossed.updateSwitch(crossed.index(5, 5, 4), 5, 5, 4);
  assert.equal(crossed.life[crossed.index(5, 5, 4)], 14);
});

test("PSCN floods a connected three-dimensional instant-conductor network", () => {
  const sim = new VoxelSimulation(10, 8, 8, 0x6060);
  sim.set(2, 4, 4, MAT.PSCN);
  sim.spark(sim.index(2, 4, 4), MAT.PSCN);
  sim.set(3, 4, 4, MAT.INST);
  sim.set(4, 4, 4, MAT.INST);
  sim.set(4, 5, 4, MAT.INST);
  sim.set(4, 5, 5, MAT.INST);
  sim.step();
  for (const [x, y, z] of [[3, 4, 4], [4, 4, 4], [4, 5, 4], [4, 5, 5]]) {
    assert.equal(sim.get(x, y, z), MAT.SPRK);
    assert.equal(sim.ctype[sim.index(x, y, z)], MAT.INST);
  }
});

test("WireWorld head and tail states advance synchronously in 3D", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x7070);
  for (const x of [3, 4, 5]) sim.set(x, 4, 4, MAT.WIRE);
  sim.ctype[sim.index(3, 4, 4)] = 1;
  sim.step();
  assert.equal(sim.ctype[sim.index(3, 4, 4)], 2);
  assert.equal(sim.ctype[sim.index(4, 4, 4)], 1);
  assert.equal(sim.ctype[sim.index(5, 4, 4)], 0);
});

test("detector and E-wall electricity propagate and open the chamber wall", () => {
  const sim = new VoxelSimulation(16, 12, 12, 0x8080);
  sim.paintWallSphere(2, 2, 2, 1, wallId("DEFAULT_WL_DTECT"));
  sim.paintWallSphere(6, 2, 2, 1, wallId("DEFAULT_WL_EWALL"));
  sim.set(2, 2, 2, MAT.DMND);
  assert.equal(sim.wallAllows(MAT.SAND, 6, 2, 2), false);
  sim.step();
  assert.ok(sim.wallElectricity[sim.air.indexForVoxel(6, 2, 2)] >= 8);
  assert.equal(sim.wallAllows(MAT.SAND, 6, 2, 2), true);
});

test("energy particles coexist with matter and photons transmit or reflect", () => {
  const pass = new VoxelSimulation(10, 8, 8, 0x9090);
  pass.set(4, 4, 4, MAT.GLAS);
  pass.setEnergy(3, 4, 4, MAT.PHOT, 922, 20, { ctype: 0x3fffffff, velocityX: 1, velocityY: 0, velocityZ: 0 });
  pass.step();
  assert.equal(pass.get(4, 4, 4), MAT.GLAS);
  assert.equal(pass.getEnergy(4, 4, 4), MAT.PHOT);

  const reflect = new VoxelSimulation(10, 8, 8, 0x9091);
  reflect.set(4, 4, 4, MAT.DMND);
  reflect.setEnergy(3, 4, 4, MAT.PHOT, 922, 20, { ctype: 0x3fffffff, velocityX: 1, velocityY: 0, velocityZ: 0 });
  reflect.step();
  assert.equal(reflect.getEnergy(3, 4, 4), MAT.PHOT);
  assert.ok(reflect.energyVelocityX[reflect.index(3, 4, 4)] < 0);
});

test("electrons spark metal and neutrons apply canonical material reactions", () => {
  const electron = new VoxelSimulation(10, 8, 8, 0xa0a0);
  electron.set(4, 4, 4, MAT.METL);
  electron.setEnergy(3, 4, 4, MAT.ELEC, 222, 20, { velocityX: 1, velocityY: 0, velocityZ: 0 });
  electron.step();
  assert.equal(electron.get(4, 4, 4), MAT.SPRK);
  assert.equal(electron.getEnergy(4, 4, 4), MAT.EMPTY);

  const neutron = new VoxelSimulation(10, 8, 8, 0xa0a1);
  neutron.set(4, 4, 4, MAT.YEST);
  neutron.setEnergy(3, 4, 4, MAT.NEUT, 26, 20, { velocityX: 1, velocityY: 0, velocityZ: 0 });
  neutron.step();
  assert.equal(neutron.get(4, 4, 4), MAT.DYST);
  assert.equal(neutron.getEnergy(4, 4, 4), MAT.NEUT);
});

test("neutrons exhaust the volumetric reaction stencil with canonical recreated products", () => {
  const chemistry = new VoxelSimulation(11, 9, 9, 0xa0a2);
  chemistry.setEnergy(5, 4, 4, MAT.NEUT, 26, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  chemistry.set(6, 4, 4, MAT.RFRG, 900, 12, { ctype: MAT.WATR, tmp: 90, velocityX: 3 });
  chemistry.set(5, 5, 4, MAT.BASE, 51, 80, { tmp: 7, velocityY: 4 });
  chemistry.random = () => 0;
  assert.equal(chemistry.interactEnergy(chemistry.index(5, 4, 4), 5, 4, 4), false);
  for (const [particle, expected] of [[chemistry.index(6, 4, 4), MAT.GAS], [chemistry.index(5, 5, 4), MAT.LRBD]]) {
    assert.deepEqual([
      chemistry.types[particle], chemistry.temperatures[particle], chemistry.life[particle],
      chemistry.ctype[particle], chemistry.tmp[particle], chemistry.velocityX[particle], chemistry.velocityY[particle],
    ], [expected, materialById(expected).defaultTemp, materialById(expected).defaultLife,
      materialById(expected).defaultCtype, materialById(expected).defaultTmp, 0, 0]);
  }

  const deuterium = new VoxelSimulation(11, 9, 9, 0xa0a3);
  deuterium.set(5, 4, 4, MAT.DEUT, 20, 120);
  deuterium.setEnergy(5, 4, 4, MAT.NEUT, 26, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  deuterium.random = () => 0;
  assert.equal(deuterium.interactEnergy(deuterium.index(5, 4, 4), 5, 4, 4), false);
  assert.equal(deuterium.get(5, 4, 4), MAT.EMPTY);
  assert.equal(deuterium.energyTypes.filter((type) => type === MAT.NEUT).length, 3);
  assert.equal(deuterium.air.sampleVoxel(5, 4, 4).pressure, 12);

  const plutonium = new VoxelSimulation(11, 9, 9, 0xa0a4);
  plutonium.set(5, 4, 4, MAT.PLUT, 200, 9, { ctype: MAT.WATR, tmp: 7, velocityX: 3 });
  plutonium.setEnergy(5, 4, 4, MAT.NEUT, 26, 100, { velocityX: 1, velocityY: 0, velocityZ: 0 });
  plutonium.random = () => 0;
  plutonium.interactEnergy(plutonium.index(5, 4, 4), 5, 4, 4);
  const product = plutonium.index(5, 4, 4);
  assert.deepEqual([
    plutonium.types[product], plutonium.life[product], plutonium.ctype[product],
    plutonium.tmp[product], plutonium.velocityX[product],
  ], [MAT.LAVA, 240, MAT.PLUT, 100, 0]);
  assert.ok(Math.abs(plutonium.temperatures[product] - 9725.85) < 0.01);
  assert.equal(plutonium.air.sampleVoxel(5, 4, 4).pressure, 10);
});

test("electrons scan volumetrically, preserve glass and respect protected protons", () => {
  const glass = new VoxelSimulation(12, 10, 10, 0xa0a5);
  glass.set(6, 5, 5, MAT.GLAS, 22);
  glass.setEnergy(4, 5, 5, MAT.ELEC, 222, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  glass.random = () => 0;
  assert.equal(glass.interactEnergy(glass.index(4, 5, 5), 4, 5, 5), true);
  assert.equal(glass.get(6, 5, 5), MAT.GLAS);
  assert.equal(glass.energyTypes.includes(MAT.ELEC), false);
  assert.equal(glass.types.filter((type) => type === MAT.EMBR).length, 26);
  const ember = glass.types.findIndex((type) => type === MAT.EMBR);
  assert.ok(Math.abs(glass.temperatures[ember] - 177.6) < 0.001);
  assert.deepEqual([
    glass.life[ember], glass.tmp[ember], glass.velocityX[ember], glass.velocityY[ember], glass.velocityZ[ember],
  ], [50, 0, -10, -10, -10]);

  const electrolysis = new VoxelSimulation(12, 10, 10, 0xa0a6);
  electrolysis.set(6, 5, 5, MAT.WATR, 500, 8, { tmp: 4, velocityX: 3 });
  electrolysis.setEnergy(4, 5, 5, MAT.ELEC, 222, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  electrolysis.random = () => 0;
  assert.equal(electrolysis.interactEnergy(electrolysis.index(4, 5, 5), 4, 5, 5), true);
  const oxygen = electrolysis.index(6, 5, 5);
  assert.deepEqual([
    electrolysis.types[oxygen], electrolysis.temperatures[oxygen], electrolysis.life[oxygen],
    electrolysis.tmp[oxygen], electrolysis.velocityX[oxygen],
  ], [MAT.O2, materialById(MAT.O2).defaultTemp, materialById(MAT.O2).defaultLife, materialById(MAT.O2).defaultTmp, 0]);

  const protectedProton = new VoxelSimulation(12, 10, 10, 0xa0a7);
  protectedProton.setEnergy(4, 5, 5, MAT.ELEC, 222, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  protectedProton.setEnergy(6, 5, 5, MAT.PROT, 777, 75, { tmp2: 1, velocityX: 0, velocityY: 0, velocityZ: 0 });
  assert.equal(protectedProton.interactEnergy(protectedProton.index(4, 5, 5), 4, 5, 5), false);
  assert.equal(protectedProton.getEnergy(4, 5, 5), MAT.ELEC);
  assert.equal(protectedProton.getEnergy(6, 5, 5), MAT.PROT);

  protectedProton.energyTmp2[protectedProton.index(6, 5, 5)] = 0;
  assert.equal(protectedProton.interactEnergy(protectedProton.index(4, 5, 5), 4, 5, 5), true);
  assert.equal(protectedProton.getEnergy(4, 5, 5), MAT.EMPTY);
  assert.equal(protectedProton.getEnergy(6, 5, 5), MAT.EMPTY);
  assert.equal(protectedProton.get(6, 5, 5), MAT.H2);
  assert.equal(protectedProton.temperatures[protectedProton.index(6, 5, 5)], 777);
});

test("photons exhaust adjacent isotopes, ignite their hot stencil and recreate typed resist payloads", () => {
  const isotopes = new VoxelSimulation(12, 10, 10, 0xa0a8);
  isotopes.set(6, 5, 5, MAT.ISOZ);
  isotopes.set(5, 6, 5, MAT.ISZS);
  isotopes.setEnergy(5, 5, 5, MAT.PHOT, 300, 100, { velocityX: 3, velocityY: 0, velocityZ: 0 });
  isotopes.random = () => 0;
  assert.equal(isotopes.interactEnergy(isotopes.index(5, 5, 5), 5, 5, 5), false);
  assert.equal(isotopes.get(6, 5, 5), MAT.EMPTY);
  assert.equal(isotopes.get(5, 6, 5), MAT.EMPTY);
  assert.equal(isotopes.energyTypes.filter((type) => type === MAT.PHOT).length, 3);
  assert.ok(Math.abs(isotopes.energyVelocityX[isotopes.index(5, 5, 5)] - 2.43) < 0.001);
  assert.equal(isotopes.air.sampleVoxel(5, 5, 5).pressure, -30);

  const ignition = new VoxelSimulation(12, 10, 10, 0xa0a9);
  ignition.set(7, 5, 5, MAT.WOOD, 22, 0, { tmp: 8, velocityX: 3 });
  ignition.setEnergy(5, 5, 5, MAT.PHOT, 300, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  ignition.random = () => 0;
  ignition.interactEnergy(ignition.index(5, 5, 5), 5, 5, 5);
  const fire = ignition.index(7, 5, 5);
  assert.deepEqual([
    ignition.types[fire], ignition.temperatures[fire], ignition.life[fire], ignition.ctype[fire], ignition.tmp[fire], ignition.velocityX[fire],
  ], [MAT.FIRE, 432, 180, 0, 0, 3]);

  const resist = new VoxelSimulation(10, 9, 9, 0xa0aa);
  resist.set(4, 4, 4, MAT.RSST, 900, 8, { ctype: MAT.LAVA, tmp: MAT.TUNG, velocityX: 4 });
  resist.setEnergy(4, 4, 4, MAT.PHOT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  resist.random = () => 0;
  assert.equal(resist.interactEnergy(resist.index(4, 4, 4), 4, 4, 4), true);
  const lava = resist.index(4, 4, 4);
  assert.deepEqual([
    resist.types[lava], resist.temperatures[lava], resist.life[lava], resist.ctype[lava], resist.tmp[lava], resist.velocityX[lava],
  ], [MAT.LAVA, materialById(MAT.LAVA).defaultTemp, 240, MAT.TUNG, materialById(MAT.LAVA).defaultTmp, 0]);
});

test("protons cancel active sparks while retaining their independent energy layer", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0xb0b0);
  sim.set(4, 4, 4, MAT.METL);
  sim.spark(sim.index(4, 4, 4), MAT.METL);
  sim.setEnergy(4, 4, 4, MAT.PROT, 520, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  sim.step();
  assert.equal(sim.get(4, 4, 4), MAT.METL);
  assert.equal(sim.getEnergy(4, 4, 4), MAT.PROT);
});

test("protons preserve their full implosion, chemistry, lifetime and synthesis table", () => {
  const implosion = new VoxelSimulation(12, 10, 10, 0xb0b1);
  implosion.set(5, 5, 5, MAT.DEUT, 20, 120);
  implosion.setEnergy(5, 5, 5, MAT.PROT, 600, 80, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  implosion.random = () => 0;
  assert.equal(implosion.interactEnergy(implosion.index(5, 5, 5), 5, 5, 5), false);
  assert.equal(implosion.get(5, 5, 5), MAT.EMPTY);
  assert.equal(implosion.energyTypes.filter((type) => type === MAT.PROT).length, 3);
  assert.ok(Math.abs(implosion.air.sampleVoxel(5, 5, 5).pressure + 12.003) < 0.001);

  const chemistry = new VoxelSimulation(12, 10, 10, 0xb0b2);
  chemistry.set(4, 5, 5, MAT.WIFI, 22);
  chemistry.setEnergy(4, 5, 5, MAT.PROT, -150, 80, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  chemistry.interactEnergy(chemistry.index(4, 5, 5), 4, 5, 5);
  assert.ok(Math.abs(chemistry.temperatures[chemistry.index(4, 5, 5)] + 273.15) < 0.001);
  chemistry.set(6, 5, 5, MAT.EXOT, 20, 1000);
  chemistry.setEnergy(6, 5, 5, MAT.PROT, 400, 80, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  chemistry.interactEnergy(chemistry.index(6, 5, 5), 6, 5, 5);
  assert.equal(chemistry.ctype[chemistry.index(6, 5, 5)], MAT.PROT);

  const ignition = new VoxelSimulation(12, 10, 10, 0xb0b3);
  ignition.set(5, 5, 5, MAT.OIL, 22);
  ignition.setEnergy(5, 5, 5, MAT.PROT, 600, 80, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  ignition.random = () => 0;
  ignition.interactEnergy(ignition.index(5, 5, 5), 5, 5, 5);
  assert.equal(ignition.get(5, 5, 5), MAT.FIRE);
  assert.equal(ignition.life[ignition.index(5, 5, 5)], 120);
  assert.ok(Math.abs(ignition.temperatures[ignition.index(5, 5, 5)] - 541.5) < 0.001);
  assert.ok(Math.abs(ignition.air.sampleVoxel(5, 5, 5).pressure - 0.997) < 0.001);

  const collision = new VoxelSimulation(12, 10, 10, 0xb0b4);
  collision.setEnergy(4, 5, 5, MAT.PROT, 500, 80, { velocityX: 3, velocityY: 0, velocityZ: 0 });
  collision.setEnergy(5, 5, 5, MAT.PROT, 500, 80, { velocityX: -3, velocityY: 0, velocityZ: 0 });
  collision.random = () => 0;
  collision.updateEnergyParticle(collision.index(4, 5, 5));
  assert.equal(collision.getEnergy(4, 5, 5), MAT.EMPTY);
  assert.equal(collision.energyTmp[collision.index(5, 5, 5)], 18);
  collision.updateEnergyParticle(collision.index(5, 5, 5));
  assert.equal(collision.energyTypes.includes(MAT.PROT), false);
  assert.equal(collision.types.includes(MAT.NBLE), true);
  const noble = collision.types.findIndex((type) => type === MAT.NBLE);
  assert.ok(Math.abs(collision.temperatures[noble] - 1526.85) < 0.01);

  const lifetime = new VoxelSimulation(9, 9, 9, 0xb0b5);
  lifetime.setEnergy(4, 4, 4, MAT.PROT, 22, 2, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  lifetime.step();
  assert.equal(lifetime.getEnergy(4, 4, 4), MAT.PROT);
  lifetime.step();
  assert.equal(lifetime.energyTypes.includes(MAT.PROT), false);
});

test("positive and negative gravity tools create signed 3D Newtonian fields", () => {
  const attractive = new VoxelSimulation(20, 12, 12, 0xc0c0);
  attractive.applyToolSphere(10, 6, 6, 2, toolId("PGRV"));
  attractive.gravity.step(attractive);
  assert.ok(attractive.gravity.sampleVoxel(2, 6, 6).forceX > 0);
  assert.ok(attractive.gravity.sampleVoxel(18, 6, 6).forceX < 0);

  const repulsive = new VoxelSimulation(20, 12, 12, 0xc0c1);
  repulsive.applyToolSphere(10, 6, 6, 2, toolId("NGRV"));
  repulsive.gravity.step(repulsive);
  assert.ok(repulsive.gravity.sampleVoxel(2, 6, 6).forceX < 0);
  assert.ok(repulsive.gravity.sampleVoxel(18, 6, 6).forceX > 0);
});

test("gravitons source the gravity solver and gravity walls mask their cell", () => {
  const sim = new VoxelSimulation(20, 12, 12, 0xd0d0);
  sim.setEnergy(10, 6, 6, MAT.GRVT, 22, 100, { tmp: 80, velocityX: 0, velocityY: 0, velocityZ: 0 });
  sim.paintWallSphere(2, 6, 6, 1, wallId("DEFAULT_WL_GRVTY"));
  sim.gravity.step(sim);
  assert.ok(sim.gravity.sampleVoxel(6, 6, 6).forceX > 0);
  assert.equal(sim.gravity.sampleVoxel(2, 6, 6).forceX, 0);
});

test("canonical pressure transitions and generic gases run in the shared engine", () => {
  const pressure = new VoxelSimulation(9, 9, 9, 0xe0e0);
  pressure.random = () => 0;
  pressure.set(4, 4, 4, MAT.ICEI, -8);
  pressure.air.injectVoxel(4, 4, 4, 2);
  pressure.step();
  assert.equal(pressure.get(4, 4, 4), MAT.SNOW);

  const gas = new VoxelSimulation(9, 9, 9, 0xe0e1);
  gas.random = () => 0;
  gas.set(4, 4, 4, MAT.GAS);
  gas.step();
  assert.equal(gas.get(4, 5, 4), MAT.GAS);
});

test("ambient heat exchanges with conductive particles", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0xf0f0);
  sim.random = () => 1;
  sim.set(4, 4, 4, MAT.METL, 22);
  sim.air.ambientHeat[sim.air.indexForVoxel(4, 4, 4)] = 222;
  sim.step();
  assert.ok(sim.temperatures[sim.index(4, 4, 4)] > 22);
  assert.ok(sim.air.sampleVoxel(4, 4, 4).temperature < 222);
});

test("water dissolves salt without enabling legacy instant-lava quenching", () => {
  const salt = new VoxelSimulation(10, 8, 8, 0x1111);
  salt.random = () => 0;
  salt.set(4, 4, 4, MAT.WATR);
  salt.set(5, 4, 4, MAT.SALT);
  salt.updateWaterChemistry(salt.index(4, 4, 4), 4, 4, 4, MAT.WATR);
  assert.equal(salt.get(4, 4, 4), MAT.SLTW);
  assert.equal(salt.types.filter((type) => type === MAT.SLTW).length, 2);

  const lava = new VoxelSimulation(10, 8, 8, 0x1112);
  lava.random = () => 0.5;
  lava.set(4, 4, 4, MAT.WATR);
  lava.set(5, 4, 4, MAT.LAVA, 1200);
  lava.updateWaterChemistry(lava.index(4, 4, 4), 4, 4, 4, MAT.WATR);
  assert.equal(lava.get(4, 4, 4), MAT.WATR);
  assert.equal(lava.get(5, 4, 4), MAT.LAVA);
});

test("water families retain their distinct rubidium, erosion, smoke and plant reactions", () => {
  const rubidium = new VoxelSimulation(10, 9, 9, 0x1113);
  rubidium.random = () => 0;
  rubidium.set(4, 4, 4, MAT.WATR, 13);
  rubidium.set(5, 4, 4, MAT.RBDM);
  rubidium.updateWaterChemistry(rubidium.index(4, 4, 4), 4, 4, 4, MAT.WATR);
  assert.equal(rubidium.get(4, 4, 4), MAT.FIRE);
  assert.equal(rubidium.life[rubidium.index(4, 4, 4)], 4);
  assert.equal(rubidium.ctype[rubidium.index(4, 4, 4)], MAT.WATR);

  const erosion = new VoxelSimulation(10, 9, 9, 0x1114);
  erosion.random = () => 0;
  erosion.set(4, 4, 4, MAT.WATR, 22, 0, { velocityZ: 0.5 });
  erosion.set(5, 4, 4, MAT.ROCK);
  erosion.updateWaterChemistry(erosion.index(4, 4, 4), 4, 4, 4, MAT.WATR);
  assert.equal(erosion.get(5, 4, 4), MAT.SAND);

  const smoke = new VoxelSimulation(10, 9, 9, 0x1115);
  smoke.random = () => 0;
  smoke.set(4, 4, 4, MAT.DSTW, 50);
  smoke.set(5, 4, 4, MAT.SMKE, 50);
  smoke.updateWaterChemistry(smoke.index(4, 4, 4), 4, 4, 4, MAT.DSTW);
  assert.equal(smoke.get(4, 4, 4), MAT.BASE);
  assert.equal(smoke.life[smoke.index(4, 4, 4)], 1);
  assert.equal(smoke.get(5, 4, 4), MAT.EMPTY);

  const saltPlant = new VoxelSimulation(10, 9, 9, 0x1116);
  saltPlant.random = () => 0;
  saltPlant.set(4, 4, 4, MAT.SLTW);
  saltPlant.set(5, 4, 4, MAT.PLNT);
  saltPlant.updateWaterChemistry(saltPlant.index(4, 4, 4), 4, 4, 4, MAT.SLTW);
  assert.equal(saltPlant.get(5, 4, 4), MAT.EMPTY);
});

test("carbonated water propagates bubble countdowns and releases pressurized CO2", () => {
  const vacuum = new VoxelSimulation(10, 9, 9, 0x1117);
  vacuum.set(4, 4, 4, MAT.CBNW);
  vacuum.air.pressure[vacuum.air.indexForVoxel(4, 4, 4)] = -1;
  vacuum.updateCarbonatedWater(vacuum.index(4, 4, 4), 4, 4, 4);
  assert.equal(vacuum.get(4, 4, 4), MAT.CO2);
  assert.equal(vacuum.ctype[vacuum.index(4, 4, 4)], 5);
  assert.ok(vacuum.air.sampleVoxel(4, 4, 4).pressure > -1);

  const countdown = new VoxelSimulation(10, 9, 9, 0x1118);
  countdown.random = () => 0;
  countdown.set(4, 4, 4, MAT.CBNW, 22, 0, { tmp: 1, tmp2: 10 });
  countdown.air.pressure[countdown.air.indexForVoxel(4, 4, 4)] = 5;
  countdown.updateCarbonatedWater(countdown.index(4, 4, 4), 4, 4, 4);
  assert.equal(countdown.get(4, 4, 4), MAT.CO2);
  assert.equal(countdown.tmp[countdown.index(4, 4, 4)], 0);
  assert.equal(countdown.tmp2[countdown.index(4, 4, 4)], 11);

  const propagation = new VoxelSimulation(10, 9, 9, 0x1119);
  propagation.random = () => 1;
  propagation.set(4, 4, 4, MAT.CBNW, 22, 0, { tmp: 0, tmp2: 20 });
  propagation.set(5, 4, 4, MAT.CBNW, 22, 0, { tmp: 5, tmp2: 20 });
  propagation.air.pressure[propagation.air.indexForVoxel(4, 4, 4)] = 5;
  propagation.updateCarbonatedWater(propagation.index(4, 4, 4), 4, 4, 4);
  assert.equal(propagation.tmp[propagation.index(4, 4, 4)], 4);
});

test("base neutralizes acid, makes soap and rusts conductive solids", () => {
  const neutral = new VoxelSimulation(9, 9, 9, 0x1212);
  neutral.set(4, 4, 4, MAT.BASE, 22, 76);
  neutral.set(5, 4, 4, MAT.ACID, 22, 76);
  for (let tick = 0; tick < 27; tick += 1) neutral.updateBase(neutral.index(4, 4, 4), 4, 4, 4);
  assert.equal(neutral.get(5, 4, 4), MAT.SLTW);

  const soap = new VoxelSimulation(9, 9, 9, 0x1213);
  soap.set(4, 4, 4, MAT.BASE, 22, 80);
  soap.set(5, 4, 4, MAT.OIL);
  assert.equal(soap.updateBase(soap.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(soap.get(4, 4, 4), MAT.SOAP);
  assert.equal(soap.get(5, 4, 4), MAT.EMPTY);
});

test("acid uses concentration, hardness, glass shielding and canonical reaction products", () => {
  const inert = new VoxelSimulation(12, 10, 10, 0x1214);
  inert.random = () => 1;
  inert.set(5, 5, 5, MAT.ACID);
  assert.equal(inert.life[inert.index(5, 5, 5)], 75);
  inert.updateAcid(inert.index(5, 5, 5), 5, 5, 5);
  assert.equal(inert.life[inert.index(5, 5, 5)], 75);

  const explosive = new VoxelSimulation(12, 10, 10, 0x1215);
  explosive.set(5, 5, 5, MAT.ACID);
  explosive.set(6, 5, 5, MAT.GUNP);
  explosive.updateAcid(explosive.index(5, 5, 5), 5, 5, 5);
  assert.equal(explosive.get(5, 5, 5), MAT.FIRE);
  assert.equal(explosive.get(6, 5, 5), MAT.FIRE);
  assert.equal(explosive.life[explosive.index(5, 5, 5)], 4);
  assert.equal(explosive.life[explosive.index(6, 5, 5)], 4);

  const steam = new VoxelSimulation(12, 10, 10, 0x1216);
  steam.random = () => 0;
  steam.set(5, 5, 5, MAT.ACID);
  steam.set(6, 5, 5, MAT.WTRV);
  steam.updateAcid(steam.index(5, 5, 5), 5, 5, 5);
  assert.equal(steam.get(5, 5, 5), MAT.CAUS);
  assert.equal(steam.life[steam.index(5, 5, 5)], 25);
  assert.equal(steam.get(6, 5, 5), MAT.EMPTY);

  const dissolve = new VoxelSimulation(12, 10, 10, 0x1217);
  dissolve.random = () => 0;
  dissolve.set(5, 5, 5, MAT.ACID, 22);
  dissolve.set(7, 5, 5, MAT.WOOD);
  dissolve.updateAcid(dissolve.index(5, 5, 5), 5, 5, 5);
  assert.equal(dissolve.get(7, 5, 5), MAT.EMPTY);
  assert.equal(dissolve.life[dissolve.index(5, 5, 5)], 74);
  assert.equal(dissolve.temperatures[dissolve.index(5, 5, 5)], 330);

  const shielded = new VoxelSimulation(12, 10, 10, 0x1218);
  shielded.random = () => 0;
  shielded.set(5, 5, 5, MAT.ACID);
  shielded.set(6, 5, 5, MAT.GLAS);
  shielded.set(7, 5, 5, MAT.WOOD);
  shielded.updateAcid(shielded.index(5, 5, 5), 5, 5, 5);
  assert.equal(shielded.get(7, 5, 5), MAT.WOOD);
  assert.equal(shielded.life[shielded.index(5, 5, 5)], 75);

  const lithium = new VoxelSimulation(12, 10, 10, 0x1219);
  lithium.random = () => 0;
  lithium.set(5, 5, 5, MAT.ACID);
  lithium.set(6, 5, 5, MAT.LITH);
  lithium.updateAcid(lithium.index(5, 5, 5), 5, 5, 5);
  assert.equal(lithium.get(6, 5, 5), MAT.H2);
  assert.equal(lithium.life[lithium.index(5, 5, 5)], 74);
});

test("base dilutes, diffuses, freezes and applies upstream corrosion products", () => {
  const dilution = new VoxelSimulation(12, 10, 10, 0x121a);
  dilution.random = () => 0;
  dilution.set(5, 5, 5, MAT.BASE, 22, 80);
  dilution.set(6, 5, 5, MAT.WATR, 10);
  dilution.updateBase(dilution.index(5, 5, 5), 5, 5, 5);
  assert.equal(dilution.get(6, 5, 5), MAT.BASE);
  assert.equal(dilution.life[dilution.index(5, 5, 5)], 40);
  assert.equal(dilution.life[dilution.index(6, 5, 5)], 40);
  assert.equal(dilution.temperatures[dilution.index(6, 5, 5)], 14);

  const frozen = new VoxelSimulation(12, 10, 10, 0x121b);
  frozen.set(5, 5, 5, MAT.BASE, -20, 76);
  assert.equal(frozen.updateBase(frozen.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(frozen.get(5, 5, 5), MAT.ICEI);
  assert.equal(frozen.ctype[frozen.index(5, 5, 5)], MAT.BASE);
  assert.equal(frozen.life[frozen.index(5, 5, 5)], 0);

  const extraction = new VoxelSimulation(12, 10, 10, 0x121c);
  extraction.random = () => 0;
  extraction.set(5, 5, 5, MAT.BASE, 22, 76);
  extraction.set(6, 5, 5, MAT.LAVA, 1500, 300, { ctype: MAT.ROCK });
  extraction.air.pressure[extraction.air.indexForVoxel(5, 5, 5)] = 10;
  assert.equal(extraction.updateBase(extraction.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(extraction.get(5, 5, 5), MAT.MERC);
  assert.equal(extraction.get(6, 5, 5), MAT.EMPTY);

  const corrosion = new VoxelSimulation(12, 10, 10, 0x121d);
  corrosion.random = () => 0;
  corrosion.set(5, 5, 5, MAT.BASE, 22, 76);
  corrosion.set(6, 5, 5, MAT.WOOD);
  corrosion.updateBase(corrosion.index(5, 5, 5), 5, 5, 5);
  assert.equal(corrosion.get(6, 5, 5), MAT.EMPTY);
  assert.equal(corrosion.life[corrosion.index(5, 5, 5)], 74);
  assert.equal(corrosion.tmp[corrosion.index(5, 5, 5)], 1);

  const diffusion = new VoxelSimulation(12, 10, 10, 0x121e);
  diffusion.set(5, 5, 5, MAT.BASE, 22, 90);
  diffusion.set(4, 4, 4, MAT.BASE, 22, 30);
  diffusion.random = () => 0;
  diffusion.updateBase(diffusion.index(5, 5, 5), 5, 5, 5);
  assert.equal(diffusion.life[diffusion.index(5, 5, 5)], 60);
  assert.equal(diffusion.life[diffusion.index(4, 4, 4)], 60);
});

test("virus retains the infected type in tmp2 and soap starts its cure", () => {
  const infect = new VoxelSimulation(9, 9, 9, 0x1313);
  infect.random = () => 0;
  infect.set(4, 4, 4, MAT.VIRS);
  infect.set(5, 4, 4, MAT.METL);
  infect.updateVirus(infect.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.equal(infect.get(5, 4, 4), MAT.VRSS);
  assert.equal(infect.tmp2[infect.index(5, 4, 4)], MAT.METL);

  const cure = new VoxelSimulation(9, 9, 9, 0x1314);
  cure.random = () => 0;
  cure.set(4, 4, 4, MAT.VIRS);
  cure.set(5, 4, 4, MAT.SOAP);
  cure.updateVirus(cure.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.ok(cure.tmp3[cure.index(4, 4, 4)] >= 10);
});

test("virus preserves infected particle state and selects its temperature phase", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x1315);
  sim.random = () => 0;
  sim.set(4, 4, 4, MAT.VIRS);
  sim.set(3, 3, 3, MAT.METL, 20, 17, {
    ctype: MAT.GOLD, tmp: 7, velocityX: 1.25, decoration: 0xff123456,
  });
  sim.set(4, 3, 3, MAT.WATR, 100, 23, { tmp: 8 });
  sim.set(5, 3, 3, MAT.GAS, 500, 29, { tmp: 9 });

  sim.updateVirus(sim.index(4, 4, 4), 4, 4, 4, MAT.VIRS);

  const cold = sim.index(3, 3, 3);
  const temperate = sim.index(4, 3, 3);
  const hot = sim.index(5, 3, 3);
  assert.equal(sim.types[cold], MAT.VRSS);
  assert.equal(sim.types[temperate], MAT.VIRS);
  assert.equal(sim.types[hot], MAT.VRSG);
  assert.equal(sim.tmp2[cold], MAT.METL);
  assert.equal(sim.tmp2[temperate], MAT.WATR);
  assert.equal(sim.tmp2[hot], MAT.GAS);
  assert.equal(sim.life[cold], 17);
  assert.equal(sim.ctype[cold], MAT.GOLD);
  assert.equal(sim.tmp[cold], 7);
  assert.equal(sim.velocityX[cold], 1.25);
  assert.equal(sim.decorations[cold], 0xff123456);
  assert.equal(sim.tmp4[cold], 250);
  assert.equal(sim.tmp4[temperate], 250);
  assert.equal(sim.tmp4[hot], 250);
});

test("virus curing restores the original type and cured virus outranks soap", () => {
  const restored = new VoxelSimulation(9, 9, 9, 0x1316);
  restored.random = () => 0;
  restored.set(4, 4, 4, MAT.VIRS, 123, 19, {
    ctype: MAT.GOLD, tmp: 6, tmp2: MAT.METL, tmp3: 1, tmp4: 44,
    velocityY: -1.5, decoration: 0xff654321,
  });
  const restoredIndex = restored.index(4, 4, 4);
  restored.updateVirus(restoredIndex, 4, 4, 4, MAT.VIRS);
  assert.equal(restored.types[restoredIndex], MAT.METL);
  assert.equal(restored.temperatures[restoredIndex], 123);
  assert.equal(restored.life[restoredIndex], 19);
  assert.equal(restored.ctype[restoredIndex], MAT.GOLD);
  assert.equal(restored.tmp[restoredIndex], 6);
  assert.equal(restored.velocityY[restoredIndex], -1.5);
  assert.equal(restored.decorations[restoredIndex], 0xff654321);
  assert.equal(restored.tmp2[restoredIndex], 0);
  assert.equal(restored.tmp3[restoredIndex], 0);
  assert.equal(restored.tmp4[restoredIndex], 0);

  const spread = new VoxelSimulation(9, 9, 9, 0x1317);
  spread.random = () => 0;
  spread.set(4, 4, 4, MAT.VIRS, 72, 0, { tmp4: 0 });
  spread.set(3, 3, 3, MAT.VRSS, 22, 0, { tmp2: MAT.METL, tmp3: 4, tmp4: 0 });
  spread.set(5, 4, 4, MAT.SOAP);
  spread.updateVirus(spread.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.equal(spread.tmp3[spread.index(4, 4, 4)], 5);
  assert.equal(spread.get(5, 4, 4), MAT.SOAP);
});

test("virus plasma destruction requires space and local pressure while protons stabilize only protected contacts", () => {
  const blocked = new VoxelSimulation(9, 9, 9, 0x1318);
  blocked.random = () => 0;
  blocked.set(4, 4, 4, MAT.VIRS);
  for (let z = 3; z <= 5; z += 1) {
    for (let y = 3; y <= 5; y += 1) {
      for (let x = 3; x <= 5; x += 1) {
        if (x === 4 && y === 4 && z === 4) continue;
        blocked.set(x, y, z, x === 3 && y === 3 && z === 3 ? MAT.PLSM : MAT.DMND);
      }
    }
  }
  blocked.updateVirus(blocked.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.equal(blocked.get(4, 4, 4), MAT.VIRS);

  const open = new VoxelSimulation(9, 9, 9, 0x1319);
  open.random = () => 0;
  open.set(4, 4, 4, MAT.VIRS);
  open.set(3, 3, 3, MAT.PLSM);
  open.air.pressure[open.air.indexForVoxel(3, 3, 3)] = 15;
  open.updateVirus(open.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.equal(open.get(4, 4, 4), MAT.PLSM);
  assert.ok(Math.abs(open.temperatures[open.index(4, 4, 4)] - 9725.85) < 0.01);
  assert.equal(open.life[open.index(4, 4, 4)], 50);

  const protectedContact = new VoxelSimulation(9, 9, 9, 0x1320);
  protectedContact.random = () => 9 / 0x100000000;
  protectedContact.set(4, 4, 4, MAT.VIRS, 72, 0, { tmp4: 88 });
  protectedContact.set(3, 3, 3, MAT.DMND);
  protectedContact.setEnergy(3, 3, 3, MAT.PROT);
  protectedContact.updateVirus(protectedContact.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.equal(protectedContact.tmp4[protectedContact.index(4, 4, 4)], 0);

  const infectableContact = new VoxelSimulation(9, 9, 9, 0x1321);
  infectableContact.random = () => 9 / 0x100000000;
  infectableContact.set(4, 4, 4, MAT.VIRS, 72, 0, { tmp4: 88 });
  infectableContact.set(3, 3, 3, MAT.METL);
  infectableContact.setEnergy(3, 3, 3, MAT.PROT);
  infectableContact.updateVirus(infectableContact.index(4, 4, 4), 4, 4, 4, MAT.VIRS);
  assert.equal(infectableContact.tmp4[infectableContact.index(4, 4, 4)], 88);

  const expires = new VoxelSimulation(9, 9, 9, 0x1322);
  expires.random = () => 0;
  expires.set(4, 4, 4, MAT.VRSS, 22, 0, { tmp4: 1 });
  expires.updateVirus(expires.index(4, 4, 4), 4, 4, 4, MAT.VRSS);
  assert.equal(expires.get(4, 4, 4), MAT.EMPTY);
});

test("all three virus phases start with the upstream 250-frame infection reserve", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x1323);
  sim.set(3, 4, 4, MAT.VIRS);
  sim.set(4, 4, 4, MAT.VRSS);
  sim.set(5, 4, 4, MAT.VRSG);
  assert.equal(sim.tmp4[sim.index(3, 4, 4)], 250);
  assert.equal(sim.tmp4[sim.index(4, 4, 4)], 250);
  assert.equal(sim.tmp4[sim.index(5, 4, 4)], 250);
});

test("hydrogen burns and fuses into nuclear matter under heat and pressure", () => {
  const burn = new VoxelSimulation(10, 8, 8, 0x1414);
  burn.random = () => 0;
  burn.set(4, 4, 4, MAT.H2);
  burn.set(5, 4, 4, MAT.FIRE, 900, 20, { tmp: 2 });
  burn.updateHydrogen(burn.index(4, 4, 4), 4, 4, 4);
  assert.equal(burn.get(4, 4, 4), MAT.FIRE);
  assert.equal(burn.life[burn.index(4, 4, 4)], 120);
  assert.equal(burn.tmp[burn.index(4, 4, 4)], 1);
  assert.equal(burn.temperatures[burn.index(5, 4, 4)], 3200);
  assert.equal(burn.tmp[burn.index(5, 4, 4)], 3);

  const blocked = new VoxelSimulation(10, 8, 8, 0x1416);
  blocked.random = () => 0;
  blocked.set(4, 4, 4, MAT.H2, 22);
  blocked.set(5, 4, 4, MAT.PLSM, 3500, 50, { tmp: 4 });
  blocked.air.injectVoxel(4, 4, 4, 20);
  assert.equal(blocked.updateHydrogen(blocked.index(4, 4, 4), 4, 4, 4), false);
  assert.equal(blocked.get(4, 4, 4), MAT.H2);

  const fusion = new VoxelSimulation(10, 8, 8, 0x1415);
  fusion.random = () => 0;
  fusion.set(4, 4, 4, MAT.H2, 2500);
  fusion.air.injectVoxel(4, 4, 4, 60);
  assert.equal(fusion.updateHydrogen(fusion.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(fusion.get(4, 4, 4), MAT.NBLE);
  assert.ok(fusion.energyTypes.some((type) => type === MAT.NEUT));
  assert.ok(fusion.energyTypes.some((type) => type === MAT.PHOT));
  assert.ok(fusion.energyTypes.some((type) => type === MAT.ELEC));
  assert.ok(fusion.types.some((type) => type === MAT.PLSM));
  assert.equal(fusion.temperatures[fusion.index(4, 4, 4)], 3250);
  assert.equal(fusion.air.sampleVoxel(4, 4, 4).pressure, 90);
});

test("oxygen couples FIRE and PLSM flags and reaches its gravity-driven stellar branch", () => {
  const fire = new VoxelSimulation(11, 9, 9, 0x1417);
  fire.random = () => 0;
  fire.set(4, 4, 4, MAT.O2);
  fire.set(5, 4, 4, MAT.FIRE, 800, 30, { tmp: 1 });
  assert.equal(fire.updateOxygen(fire.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(fire.get(4, 4, 4), MAT.FIRE);
  assert.equal(fire.life[fire.index(4, 4, 4)], 120);
  assert.equal(fire.tmp[fire.index(4, 4, 4)], 2);
  assert.equal(fire.temperatures[fire.index(5, 4, 4)], 3200);
  assert.equal(fire.tmp[fire.index(5, 4, 4)], 3);

  const protectedPlasma = new VoxelSimulation(11, 9, 9, 0x1418);
  protectedPlasma.random = () => 0;
  protectedPlasma.set(4, 4, 4, MAT.O2);
  protectedPlasma.set(5, 4, 4, MAT.PLSM, 3500, 50, { tmp: 4 });
  assert.equal(protectedPlasma.updateOxygen(protectedPlasma.index(4, 4, 4), 4, 4, 4), false);
  assert.equal(protectedPlasma.get(4, 4, 4), MAT.O2);

  const stellar = new VoxelSimulation(11, 9, 9, 0x1419);
  stellar.random = () => 0;
  stellar.set(5, 4, 4, MAT.O2, 9725.85);
  const airIndex = stellar.air.indexForVoxel(5, 4, 4);
  stellar.air.pressure[airIndex] = 256;
  stellar.gravity.forceX[airIndex] = 21;
  assert.equal(stellar.updateOxygen(stellar.index(5, 4, 4), 5, 4, 4), true);
  assert.equal(stellar.get(5, 4, 4), MAT.BRMT);
  assert.ok(Math.abs(stellar.temperatures[stellar.index(5, 4, 4)] - 9725.85) < 0.01);
  assert.ok(stellar.energyTypes.some((type) => type === MAT.NEUT));
  assert.ok(stellar.energyTypes.some((type) => type === MAT.PHOT));
  assert.ok(stellar.energyTypes.some((type) => type === MAT.GRVT));
  assert.ok(stellar.types.some((type) => type === MAT.PLSM));
  assert.equal(stellar.air.sampleVoxel(5, 4, 4).pressure, 256);
});

test("cloners acquire a ctype and duplicate matter into empty 3D neighbors", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x1515);
  sim.random = () => 0;
  sim.set(4, 4, 4, MAT.CLNE);
  sim.set(5, 4, 4, MAT.WATR);
  sim.updateCloner(sim.index(4, 4, 4), 4, 4, 4, MAT.CLNE);
  assert.equal(sim.ctype[sim.index(4, 4, 4)], MAT.WATR);
  sim.updateCloner(sim.index(4, 4, 4), 4, 4, 4, MAT.CLNE);
  assert.equal(sim.types.filter((type) => type === MAT.WATR).length, 2);

  const powered = new VoxelSimulation(9, 9, 9, 0x1516);
  powered.random = () => 0;
  powered.set(4, 4, 4, MAT.PCLN, 22, 0, { ctype: MAT.SAND });
  powered.updateCloner(powered.index(4, 4, 4), 4, 4, 4, MAT.PCLN);
  assert.equal(powered.types.filter((type) => type === MAT.SAND).length, 0);
  powered.life[powered.index(4, 4, 4)] = 10;
  powered.updateCloner(powered.index(4, 4, 4), 4, 4, 4, MAT.PCLN);
  assert.equal(powered.types.filter((type) => type === MAT.SAND).length, 1);
});

test("powered cloners propagate network state and emit volumetric photon and Life bursts", () => {
  const network = new VoxelSimulation(11, 11, 11, 0x1517);
  network.set(5, 5, 5, MAT.PCLN, 22, 10);
  network.set(6, 6, 6, MAT.PCLN, 22, 0);
  network.updateCloner(network.index(6, 6, 6), 6, 6, 6, MAT.PCLN);
  assert.equal(network.life[network.index(6, 6, 6)], 10);
  network.life[network.index(6, 6, 6)] = 5;
  network.updateCloner(network.index(5, 5, 5), 5, 5, 5, MAT.PCLN);
  assert.equal(network.life[network.index(5, 5, 5)], 9);

  const photons = new VoxelSimulation(11, 11, 11, 0x1518);
  photons.set(5, 5, 5, MAT.PCLN, 22, 10, { ctype: MAT.PHOT });
  photons.updateCloner(photons.index(5, 5, 5), 5, 5, 5, MAT.PCLN);
  assert.equal(photons.energyTypes.filter((type) => type === MAT.PHOT).length, 26);
  const diagonal = photons.index(6, 6, 6);
  assert.deepEqual([
    photons.energyVelocityX[diagonal], photons.energyVelocityY[diagonal], photons.energyVelocityZ[diagonal],
  ], [3, 3, 3]);

  const life = new VoxelSimulation(11, 11, 11, 0x1519);
  life.set(5, 5, 5, MAT.PCLN, 22, 10, { ctype: MAT.LIFE, tmp: 7 });
  life.updateCloner(life.index(5, 5, 5), 5, 5, 5, MAT.PCLN);
  assert.equal(life.types.filter((type) => type === MAT.LIFE).length, 26);
  assert.equal(life.ctype[life.index(4, 4, 4)], 7);
});

test("breakable clones enter pressure-driven advection and destruction countdowns", () => {
  const bcln = new VoxelSimulation(9, 9, 9, 0x151a);
  bcln.random = () => 0;
  bcln.set(4, 4, 4, MAT.BCLN, 22, 0, { ctype: MAT.SAND });
  bcln.air.injectVoxel(4, 4, 4, 5, 0, 2, -1, 3);
  bcln.updateCloner(bcln.index(4, 4, 4), 4, 4, 4, MAT.BCLN);
  assert.equal(bcln.life[bcln.index(4, 4, 4)], 80);
  assert.ok(Math.abs(bcln.velocityX[bcln.index(4, 4, 4)] - 0.2) < 1e-6);
  assert.ok(Math.abs(bcln.velocityY[bcln.index(4, 4, 4)] + 0.1) < 1e-6);
  assert.ok(Math.abs(bcln.velocityZ[bcln.index(4, 4, 4)] - 0.3) < 1e-6);

  const pbcn = new VoxelSimulation(9, 9, 9, 0x151b);
  pbcn.random = () => 0;
  pbcn.set(4, 4, 4, MAT.PBCN, 22, 10, { ctype: MAT.SAND });
  pbcn.air.injectVoxel(4, 4, 4, 5);
  pbcn.updateCloner(pbcn.index(4, 4, 4), 4, 4, 4, MAT.PBCN);
  assert.equal(pbcn.tmp2[pbcn.index(4, 4, 4)], 79);
  pbcn.tmp2[pbcn.index(4, 4, 4)] = 1;
  assert.equal(pbcn.updateCloner(pbcn.index(4, 4, 4), 4, 4, 4, MAT.PBCN), true);
  assert.equal(pbcn.get(4, 4, 4), MAT.EMPTY);
});

test("voids drain matter and converters retain and apply their selected type", () => {
  const drain = new VoxelSimulation(9, 9, 9, 0x1616);
  drain.set(4, 4, 4, MAT.VOID);
  drain.set(5, 4, 4, MAT.SAND);
  drain.updateHole(drain.index(4, 4, 4), 4, 4, 4, MAT.VOID);
  assert.equal(drain.get(5, 4, 4), MAT.EMPTY);

  const convert = new VoxelSimulation(9, 9, 9, 0x1617);
  convert.set(4, 4, 4, MAT.CONV, 22, 0, { ctype: MAT.WATR });
  convert.set(5, 4, 4, MAT.SAND);
  convert.updateConverter(convert.index(4, 4, 4), 4, 4, 4);
  assert.equal(convert.get(5, 4, 4), MAT.WATR);
});

test("void ctype filters select or invert matter and independent energy consumption", () => {
  const selected = new VoxelSimulation(9, 9, 9, 0x161d);
  selected.set(4, 4, 4, MAT.VOID, 22, 0, { ctype: MAT.SAND });
  selected.set(5, 4, 4, MAT.SAND);
  selected.set(3, 4, 4, MAT.WATR);
  selected.setEnergy(4, 5, 4, MAT.PHOT);
  selected.updateHole(selected.index(4, 4, 4), 4, 4, 4, MAT.VOID);
  assert.equal(selected.get(5, 4, 4), MAT.EMPTY);
  assert.equal(selected.get(3, 4, 4), MAT.WATR);
  assert.equal(selected.getEnergy(4, 5, 4), MAT.PHOT);

  const inverted = new VoxelSimulation(9, 9, 9, 0x161e);
  inverted.set(4, 4, 4, MAT.VOID, 22, 0, { ctype: MAT.SAND, tmp: 1 });
  inverted.set(5, 4, 4, MAT.SAND);
  inverted.set(3, 4, 4, MAT.WATR);
  inverted.setEnergy(4, 5, 4, MAT.PHOT);
  inverted.updateHole(inverted.index(4, 4, 4), 4, 4, 4, MAT.VOID);
  assert.equal(inverted.get(5, 4, 4), MAT.SAND);
  assert.equal(inverted.get(3, 4, 4), MAT.EMPTY);
  assert.equal(inverted.getEnergy(4, 5, 4), MAT.EMPTY);
});

test("powered void networks pull activation, propagate shutdown and only drain while fully on", () => {
  const off = new VoxelSimulation(9, 9, 9, 0x161f);
  off.set(4, 4, 4, MAT.PVOD, 22, 0);
  off.set(5, 4, 4, MAT.SAND);
  off.updateHole(off.index(4, 4, 4), 4, 4, 4, MAT.PVOD);
  assert.equal(off.get(5, 4, 4), MAT.SAND);

  const network = new VoxelSimulation(11, 11, 11, 0x1620);
  network.set(4, 4, 4, MAT.PVOD, 22, 10);
  network.set(6, 5, 5, MAT.PVOD, 22, 0);
  network.updateHole(network.index(6, 5, 5), 6, 5, 5, MAT.PVOD);
  assert.equal(network.life[network.index(6, 5, 5)], 10);
  network.life[network.index(6, 5, 5)] = 5;
  network.updateHole(network.index(4, 4, 4), 4, 4, 4, MAT.PVOD);
  assert.equal(network.life[network.index(4, 4, 4)], 9);
});

test("vacuum and Newtonian black holes keep separate air, gravity and thermal semantics", () => {
  const vacuum = new VoxelSimulation(9, 9, 9, 0x1621);
  vacuum.set(4, 4, 4, MAT.BHOL, 92, 0, { tmp: 77 });
  vacuum.set(5, 4, 4, MAT.SAND, 100);
  vacuum.setEnergy(4, 5, 4, MAT.PHOT, 50);
  vacuum.updateHole(vacuum.index(4, 4, 4), 4, 4, 4, MAT.BHOL);
  assert.equal(vacuum.get(5, 4, 4), MAT.EMPTY);
  assert.equal(vacuum.getEnergy(4, 5, 4), MAT.EMPTY);
  assert.equal(vacuum.temperatures[vacuum.index(4, 4, 4)], 167);
  assert.equal(vacuum.tmp[vacuum.index(4, 4, 4)], 77);
  assert.ok(vacuum.air.sampleVoxel(4, 4, 4).pressure < 0);

  const newtonian = new VoxelSimulation(9, 9, 9, 0x1622);
  newtonian.set(4, 4, 4, MAT.NBHL, 22, 0, { tmp: 1000 });
  newtonian.updateHole(newtonian.index(4, 4, 4), 4, 4, 4, MAT.NBHL);
  assert.equal(newtonian.air.sampleVoxel(4, 4, 4).pressure, 0);
  newtonian.gravity.rebuild(newtonian);
  assert.equal(newtonian.gravity.sampleVoxel(4, 4, 4).mass, 1);
  newtonian.tmp[newtonian.index(4, 4, 4)] = -1000;
  newtonian.gravity.rebuild(newtonian);
  assert.ok(Math.abs(newtonian.gravity.sampleVoxel(4, 4, 4).mass - 0.1) < 1e-6);
});

test("white holes repel normally but consume anti-air with upstream cooling", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x1623);
  sim.set(4, 4, 4, MAT.WHOL, 6);
  sim.set(5, 4, 4, MAT.ANAR, 25);
  sim.set(3, 4, 4, MAT.SAND);
  sim.updateHole(sim.index(4, 4, 4), 4, 4, 4, MAT.WHOL);
  assert.equal(sim.get(5, 4, 4), MAT.EMPTY);
  assert.equal(sim.get(3, 4, 4), MAT.SAND);
  assert.equal(sim.temperatures[sim.index(4, 4, 4)], -273.1499938964844);
  assert.ok(sim.air.sampleVoxel(4, 4, 4).pressure > 0);
});

test("converters preserve packed Life subtypes and honor normal and inverted restrictions", () => {
  const learn = new VoxelSimulation(9, 9, 9, 0x1618);
  learn.set(4, 4, 4, MAT.CONV);
  learn.set(5, 4, 4, MAT.LIFE, 22, 0, { ctype: 7 });
  learn.updateConverter(learn.index(4, 4, 4), 4, 4, 4);
  assert.equal(learn.ctype[learn.index(4, 4, 4)], (7 << 9) | MAT.LIFE);

  const packed = new VoxelSimulation(9, 9, 9, 0x1619);
  packed.set(4, 4, 4, MAT.CONV, 22, 0, { ctype: (3 << 9) | MAT.LIFE });
  packed.set(5, 4, 4, MAT.SAND);
  packed.updateConverter(packed.index(4, 4, 4), 4, 4, 4);
  assert.equal(packed.get(5, 4, 4), MAT.LIFE);
  assert.equal(packed.ctype[packed.index(5, 4, 4)], 3);

  const restricted = new VoxelSimulation(9, 9, 9, 0x161a);
  restricted.set(4, 4, 4, MAT.CONV, 22, 0, { ctype: MAT.WATR, tmp: MAT.SAND });
  restricted.set(5, 4, 4, MAT.SAND);
  restricted.set(3, 4, 4, MAT.DUST);
  restricted.updateConverter(restricted.index(4, 4, 4), 4, 4, 4);
  assert.equal(restricted.get(5, 4, 4), MAT.WATR);
  assert.equal(restricted.get(3, 4, 4), MAT.DUST);

  const inverted = new VoxelSimulation(9, 9, 9, 0x161b);
  inverted.set(4, 4, 4, MAT.CONV, 22, 0, { ctype: MAT.WATR, tmp: MAT.SAND, tmp2: 1 });
  inverted.set(5, 4, 4, MAT.SAND);
  inverted.set(3, 4, 4, MAT.DUST);
  inverted.updateConverter(inverted.index(4, 4, 4), 4, 4, 4);
  assert.equal(inverted.get(5, 4, 4), MAT.SAND);
  assert.equal(inverted.get(3, 4, 4), MAT.WATR);
});

test("converter energy priority resets the complete overlapping voxel to its selected type", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x161c);
  sim.set(4, 4, 4, MAT.CONV, 22, 0, { ctype: MAT.WATR });
  sim.set(5, 4, 4, MAT.SAND, 800, 17, { ctype: MAT.LAVA, tmp: 99 });
  sim.setEnergy(5, 4, 4, MAT.PHOT, 1200, 40, { ctype: 0x1f });
  sim.updateConverter(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.getEnergy(5, 4, 4), MAT.EMPTY);
  assert.equal(sim.get(5, 4, 4), MAT.WATR);
  assert.equal(sim.temperatures[sim.index(5, 4, 4)], materialById(MAT.WATR).defaultTemp);
  assert.equal(sim.life[sim.index(5, 4, 4)], 0);
  assert.equal(sim.tmp[sim.index(5, 4, 4)], 0);
});

test("detectors spark adjacent conductors when their configured ctype is present", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x1717);
  sim.set(5, 4, 4, MAT.DTEC, 22, 0, { ctype: MAT.WATR, tmp2: 3 });
  sim.set(7, 4, 4, MAT.WATR);
  sim.set(4, 4, 4, MAT.METL);
  sim.updateSensor(sim.index(5, 4, 4), 5, 4, 4, MAT.DTEC);
  assert.equal(sim.get(4, 4, 4), MAT.METL);
  assert.equal(sim.life[sim.index(5, 4, 4)], 1);
  sim.updateSensor(sim.index(5, 4, 4), 5, 4, 4, MAT.DTEC);
  assert.equal(sim.get(4, 4, 4), MAT.SPRK);
  assert.equal(sim.ctype[sim.index(4, 4, 4)], MAT.METL);
});

test("temperature sensors support delayed high, inverted-low and FILT serialization modes", () => {
  const high = new VoxelSimulation(12, 9, 9, 0x1718);
  high.set(5, 4, 4, MAT.TSNS, 50, 0, { tmp2: 2 });
  high.set(7, 4, 4, MAT.DUST, 100);
  high.set(4, 4, 4, MAT.METL);
  high.updateSensor(high.index(5, 4, 4), 5, 4, 4, MAT.TSNS);
  assert.equal(high.life[high.index(5, 4, 4)], 1);
  assert.equal(high.get(4, 4, 4), MAT.METL);
  high.updateSensor(high.index(5, 4, 4), 5, 4, 4, MAT.TSNS);
  assert.equal(high.get(4, 4, 4), MAT.SPRK);

  const low = new VoxelSimulation(12, 9, 9, 0x1719);
  low.set(5, 4, 4, MAT.TSNS, 50, 0, { tmp: 2, tmp2: 2 });
  low.set(7, 4, 4, MAT.DUST, 20);
  low.updateSensor(low.index(5, 4, 4), 5, 4, 4, MAT.TSNS);
  assert.equal(low.life[low.index(5, 4, 4)], 1);

  const serialize = new VoxelSimulation(12, 9, 9, 0x171a);
  serialize.set(5, 4, 4, MAT.TSNS, 50, 0, { tmp: 1, tmp2: 3 });
  serialize.set(4, 4, 4, MAT.FILT);
  serialize.set(7, 4, 4, MAT.DUST, 100);
  serialize.updateSensor(serialize.index(5, 4, 4), 5, 4, 4, MAT.TSNS);
  assert.equal(serialize.ctype[serialize.index(4, 4, 4)], 0x10000000 + 373);
});

test("pressure sensors compare against Celsius temperature and serialize signed pressure", () => {
  const high = new VoxelSimulation(12, 9, 9, 0x171b);
  high.set(5, 4, 4, MAT.PSNS, 4);
  high.set(4, 4, 4, MAT.METL);
  high.air.injectVoxel(5, 4, 4, 5);
  high.updateSensor(high.index(5, 4, 4), 5, 4, 4, MAT.PSNS);
  assert.equal(high.get(4, 4, 4), MAT.SPRK);

  const low = new VoxelSimulation(12, 9, 9, 0x171c);
  low.set(5, 4, 4, MAT.PSNS, 4, 0, { tmp: 2 });
  low.set(4, 4, 4, MAT.METL);
  low.air.injectVoxel(5, 4, 4, -5);
  low.updateSensor(low.index(5, 4, 4), 5, 4, 4, MAT.PSNS);
  assert.equal(low.get(4, 4, 4), MAT.SPRK);

  const serialize = new VoxelSimulation(12, 9, 9, 0x171d);
  serialize.set(5, 4, 4, MAT.PSNS, 4, 0, { tmp: 1 });
  serialize.set(4, 4, 4, MAT.FILT);
  serialize.air.injectVoxel(5, 4, 4, 12);
  serialize.updateSensor(serialize.index(5, 4, 4), 5, 4, 4, MAT.PSNS);
  assert.equal(serialize.ctype[serialize.index(4, 4, 4)], 0x10000000 + 268);
});

test("life sensors threshold, serialize and deserialize particle life", () => {
  const detect = new VoxelSimulation(12, 9, 9, 0x171e);
  detect.set(5, 4, 4, MAT.LSNS, 4, 0, { tmp2: 3 });
  detect.set(7, 4, 4, MAT.FIRE, 900, 10);
  detect.updateSensor(detect.index(5, 4, 4), 5, 4, 4, MAT.LSNS);
  assert.equal(detect.life[detect.index(5, 4, 4)], 1);

  const serialize = new VoxelSimulation(12, 9, 9, 0x171f);
  serialize.set(5, 4, 4, MAT.LSNS, 4, 0, { tmp: 1, tmp2: 3 });
  serialize.set(4, 4, 4, MAT.FILT);
  serialize.set(7, 4, 4, MAT.WATR, 22, 17);
  serialize.updateSensor(serialize.index(5, 4, 4), 5, 4, 4, MAT.LSNS);
  assert.equal(serialize.ctype[serialize.index(4, 4, 4)], 0x10000000 + 17);

  const deserialize = new VoxelSimulation(12, 9, 9, 0x1720);
  deserialize.set(5, 4, 4, MAT.LSNS, 4, 0, { tmp: 3, tmp2: 3 });
  deserialize.set(4, 4, 4, MAT.FILT, 22, 0, { ctype: 0x10000000 + 23 });
  deserialize.set(6, 4, 4, MAT.DUST);
  deserialize.updateSensor(deserialize.index(5, 4, 4), 5, 4, 4, MAT.LSNS);
  assert.equal(deserialize.life[deserialize.index(6, 4, 4)], 23);
});

test("velocity sensors use 3D speed and round-trip magnitude through FILT", () => {
  const detect = new VoxelSimulation(12, 9, 9, 0x1721);
  detect.set(5, 4, 4, MAT.VSNS, 4, 0, { tmp2: 3 });
  detect.set(7, 4, 4, MAT.DUST, 22, 0, { velocityX: 3, velocityY: 4, velocityZ: 12 });
  detect.set(6, 4, 4, MAT.METL, 22, 0, { velocityX: 100 });
  detect.updateSensor(detect.index(5, 4, 4), 5, 4, 4, MAT.VSNS);
  assert.equal(detect.life[detect.index(5, 4, 4)], 1);

  const serialize = new VoxelSimulation(12, 9, 9, 0x1722);
  serialize.set(5, 4, 4, MAT.VSNS, 4, 0, { tmp: 1, tmp2: 3 });
  serialize.set(4, 4, 4, MAT.FILT);
  serialize.set(7, 4, 4, MAT.DUST, 22, 0, { velocityX: 3, velocityY: 4 });
  serialize.updateSensor(serialize.index(5, 4, 4), 5, 4, 4, MAT.VSNS);
  assert.equal(serialize.ctype[serialize.index(4, 4, 4)], 0x10000000 + 5);

  const deserialize = new VoxelSimulation(12, 9, 9, 0x1723);
  deserialize.set(5, 4, 4, MAT.VSNS, 4, 0, { tmp: 3, tmp2: 3 });
  deserialize.set(4, 4, 4, MAT.FILT, 22, 0, { ctype: 0x10000000 + 10 });
  deserialize.set(6, 4, 4, MAT.DUST, 22, 0, { velocityX: 3, velocityY: 4 });
  deserialize.updateSensor(deserialize.index(5, 4, 4), 5, 4, 4, MAT.VSNS);
  assert.ok(Math.abs(Math.hypot(deserialize.velocityX[deserialize.index(6, 4, 4)], deserialize.velocityY[deserialize.index(6, 4, 4)]) - 10) < 1e-5);
});

test("linear detectors scan opposite their conductor and honor keep-searching and colour-copy flags", () => {
  const blocked = new VoxelSimulation(14, 9, 9, 0x1724);
  blocked.set(5, 4, 4, MAT.LDTC, 22, 0, { ctype: MAT.WATR, tmp: 4 });
  blocked.set(4, 4, 4, MAT.METL);
  blocked.set(6, 4, 4, MAT.SAND);
  blocked.set(7, 4, 4, MAT.WATR);
  blocked.updateSensor(blocked.index(5, 4, 4), 5, 4, 4, MAT.LDTC);
  assert.equal(blocked.get(4, 4, 4), MAT.METL);
  blocked.tmp2[blocked.index(5, 4, 4)] = 0x8;
  blocked.updateSensor(blocked.index(5, 4, 4), 5, 4, 4, MAT.LDTC);
  assert.equal(blocked.get(4, 4, 4), MAT.SPRK);

  const color = new VoxelSimulation(14, 9, 9, 0x1725);
  color.set(5, 4, 4, MAT.LDTC, 22, 0, { ctype: MAT.PHOT, tmp: 4 });
  color.set(4, 4, 4, MAT.FILT);
  color.setEnergy(7, 4, 4, MAT.PHOT, 600, 50, { ctype: 1 << 18 });
  color.updateSensor(color.index(5, 4, 4), 5, 4, 4, MAT.LDTC);
  assert.equal(color.ctype[color.index(4, 4, 4)], 1 << 18);
});

test("accelerators affect independent energy velocity and singularities consume matter", () => {
  const accelerator = new VoxelSimulation(10, 9, 9, 0x1818);
  accelerator.set(4, 4, 4, MAT.ACEL);
  accelerator.setEnergy(5, 4, 4, MAT.PHOT, 922, 20, { velocityX: 1, velocityY: 0, velocityZ: 0 });
  accelerator.updateForceElement(accelerator.index(4, 4, 4), 4, 4, 4, MAT.ACEL);
  assert.ok(accelerator.energyVelocityX[accelerator.index(5, 4, 4)] > 1);

  const singularity = new VoxelSimulation(10, 9, 9, 0x1819);
  singularity.random = () => 0;
  singularity.set(4, 4, 4, MAT.SING);
  singularity.set(5, 4, 4, MAT.STNE);
  singularity.updateSingularity(singularity.index(4, 4, 4), 4, 4, 4);
  assert.equal(singularity.get(5, 4, 4), MAT.EMPTY);
  assert.equal(singularity.life[singularity.index(4, 4, 4)], 63);
  assert.equal(singularity.tmp[singularity.index(4, 4, 4)], 1);
  assert.equal(singularity.air.sampleVoxel(4, 4, 4).pressure, -6);
});

test("ACEL and DCEL use programmable strength on six face neighbors with matter priority", () => {
  const accelerator = new VoxelSimulation(11, 11, 11, 0x181f);
  const source = accelerator.index(5, 5, 5);
  accelerator.set(5, 5, 5, MAT.ACEL, 22, 250);
  accelerator.set(6, 5, 5, MAT.DUST, 22, 0, { velocityX: 2, velocityY: 1, velocityZ: -1 });
  accelerator.set(6, 6, 5, MAT.DUST, 22, 0, { velocityX: 2 });
  accelerator.set(7, 5, 5, MAT.DUST, 22, 0, { velocityX: 2 });
  accelerator.set(4, 5, 5, MAT.METL);
  accelerator.setEnergy(4, 5, 5, MAT.PHOT, 22, 20, { velocityX: 2, velocityY: 0, velocityZ: 0 });
  accelerator.updateForceElement(source, 5, 5, 5, MAT.ACEL);
  assert.deepEqual([
    accelerator.velocityX[accelerator.index(6, 5, 5)],
    accelerator.velocityY[accelerator.index(6, 5, 5)],
    accelerator.velocityZ[accelerator.index(6, 5, 5)],
  ], [7, 3.5, -3.5]);
  assert.equal(accelerator.velocityX[accelerator.index(6, 6, 5)], 2);
  assert.equal(accelerator.velocityX[accelerator.index(7, 5, 5)], 2);
  assert.equal(accelerator.energyVelocityX[accelerator.index(4, 5, 5)], 2);
  assert.equal(accelerator.tmp[source], 1);

  accelerator.life[source] = 2000;
  accelerator.velocityX[accelerator.index(6, 5, 5)] = 9000;
  accelerator.velocityY[accelerator.index(6, 5, 5)] = 4500;
  accelerator.velocityZ[accelerator.index(6, 5, 5)] = -2250;
  accelerator.updateForceElement(source, 5, 5, 5, MAT.ACEL);
  assert.equal(accelerator.velocityX[accelerator.index(6, 5, 5)], 10000);
  assert.equal(accelerator.velocityY[accelerator.index(6, 5, 5)], 5000);
  assert.equal(accelerator.velocityZ[accelerator.index(6, 5, 5)], -2500);

  const decelerator = new VoxelSimulation(9, 9, 9, 0x1820);
  const decel = decelerator.index(4, 4, 4);
  decelerator.set(4, 4, 4, MAT.DCEL);
  decelerator.set(5, 4, 4, MAT.WATR, 22, 0, { velocityX: 11 });
  decelerator.updateForceElement(decel, 4, 4, 4, MAT.DCEL);
  assert.equal(decelerator.velocityX[decelerator.index(5, 4, 4)], 10);
  decelerator.life[decel] = 25;
  decelerator.updateForceElement(decel, 4, 4, 4, MAT.DCEL);
  assert.equal(decelerator.velocityX[decelerator.index(5, 4, 4)], 7.5);
  decelerator.life[decel] = 100;
  decelerator.updateForceElement(decel, 4, 4, 4, MAT.DCEL);
  assert.equal(decelerator.velocityX[decelerator.index(5, 4, 4)], 0);
  decelerator.set(5, 4, 4, MAT.EMPTY);
  decelerator.updateForceElement(decel, 4, 4, 4, MAT.DCEL);
  assert.equal(decelerator.tmp[decel], 0);
});

test("SING creation, merging and saturated secondary seeding match upstream state rules", () => {
  const created = new VoxelSimulation(9, 9, 9, 0x181a);
  created.random = () => 0;
  created.set(4, 4, 4, MAT.SING);
  assert.equal(created.life[created.index(4, 4, 4)], 60);
  const maximum = new VoxelSimulation(9, 9, 9, 0x181b);
  maximum.random = () => 0.999999;
  maximum.set(4, 4, 4, MAT.SING);
  assert.equal(maximum.life[maximum.index(4, 4, 4)], 109);

  const merge = new VoxelSimulation(9, 9, 9, 0x181c);
  merge.random = () => 0;
  merge.set(4, 4, 4, MAT.SING, 100, 100, { tmp: 7 });
  merge.set(5, 4, 4, MAT.SING, 200, 50, { tmp: 99 });
  merge.updateSingularity(merge.index(4, 4, 4), 4, 4, 4);
  assert.equal(merge.life[merge.index(4, 4, 4)], 150);
  assert.equal(merge.tmp[merge.index(4, 4, 4)], 7);
  assert.equal(merge.temperatures[merge.index(4, 4, 4)], 300);
  assert.equal(merge.get(5, 4, 4), MAT.EMPTY);

  const saturated = new VoxelSimulation(9, 9, 9, 0x181d);
  saturated.random = () => 0;
  saturated.set(4, 4, 4, MAT.SING, 22, 254, { tmp: 8 });
  saturated.set(5, 4, 4, MAT.SAND);
  saturated.updateSingularity(saturated.index(4, 4, 4), 4, 4, 4);
  assert.equal(saturated.life[saturated.index(4, 4, 4)], 254);
  assert.equal(saturated.tmp[saturated.index(4, 4, 4)], 8);
  assert.equal(saturated.get(5, 4, 4), MAT.SING);
  assert.equal(saturated.life[saturated.index(5, 4, 4)], 60);
});

test("expired SING pops with mass-scaled pressure and a hot volumetric energy burst", () => {
  const sim = new VoxelSimulation(15, 15, 15, 0x181e);
  sim.random = () => 0;
  sim.set(7, 7, 7, MAT.SING, 22, 0, { tmp: 16 });

  assert.equal(sim.updateSingularity(sim.index(7, 7, 7), 7, 7, 7), true);
  assert.equal(sim.get(7, 7, 7), MAT.EMPTY);
  assert.equal(sim.energyTypes.filter((type) => type !== MAT.EMPTY).length, 12);
  assert.equal(sim.energyTypes.filter((type) => type === MAT.PHOT).length, 12);
  assert.equal(sim.air.sampleVoxel(7, 7, 7).pressure, 16);
  const emitted = sim.energyTypes.findIndex((type) => type !== MAT.EMPTY);
  assert.ok(Math.abs(sim.energyTemperatures[emitted] - 4726.35) < 0.01);
  assert.equal(sim.energyLife[emitted], 0);
});

test("thunder discharges into conductors and contact bombs destroy a 3D radius", () => {
  const thunder = new VoxelSimulation(12, 9, 9, 0x1919);
  thunder.set(4, 4, 4, MAT.THDR);
  thunder.set(5, 4, 4, MAT.METL);
  thunder.updateExplosiveElement(thunder.index(4, 4, 4), 4, 4, 4, MAT.THDR);
  assert.equal(thunder.get(4, 4, 4), MAT.EMPTY);
  assert.equal(thunder.get(5, 4, 4), MAT.SPRK);
  assert.equal(thunder.air.sampleVoxel(4, 4, 4).temperature, 22);

  const guarded = new VoxelSimulation(12, 9, 9, 0x1918);
  guarded.set(4, 4, 4, MAT.THDR);
  guarded.set(5, 4, 4, MAT.METL, 22, 0, { ctype: MAT.SPRK });
  guarded.updateExplosiveElement(guarded.index(4, 4, 4), 4, 4, 4, MAT.THDR);
  assert.equal(guarded.get(5, 4, 4), MAT.METL);
  assert.equal(guarded.get(4, 4, 4), MAT.EMPTY);
  assert.equal(guarded.air.sampleVoxel(4, 4, 4).pressure, 100);

  const bomb = new VoxelSimulation(21, 21, 21, 0x191a);
  bomb.random = () => 0;
  bomb.set(10, 10, 10, MAT.BOMB);
  bomb.set(11, 10, 10, MAT.STNE);
  bomb.set(10, 12, 10, MAT.DMND);
  bomb.setEnergy(12, 10, 10, MAT.PHOT, 600, 80, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  assert.equal(bomb.updateExplosiveElement(bomb.index(10, 10, 10), 10, 10, 10, MAT.BOMB), true);
  assert.equal(bomb.types.includes(MAT.BOMB), false);
  const core = bomb.index(10, 10, 10);
  assert.equal(bomb.types[core], MAT.EMBR);
  assert.equal(bomb.life[core], 2);
  assert.equal(bomb.tmp[core], 2);
  assert.equal(bomb.get(11, 10, 10), MAT.EMBR);
  assert.equal(bomb.get(10, 12, 10), MAT.DMND);
  assert.equal(bomb.getEnergy(12, 10, 10), MAT.PHOT);
  const shell = bomb.index(19, 10, 10);
  assert.equal(bomb.types[shell], MAT.EMBR);
  assert.equal(bomb.life[shell], 50);
  assert.equal(bomb.tmp[shell], 0);
  assert.deepEqual([bomb.velocityX[shell], bomb.velocityY[shell], bomb.velocityZ[shell]], [-20, -20, -20]);
  assert.ok(bomb.activity.explosions > 0);
  assert.ok(bomb.air.sampleVoxel(10, 10, 10).pressure > 0);
});

test("DEST samples one nearby voxel and keeps its solid, nuclear and insulation branches distinct", () => {
  const targetedRandom = (tail = []) => {
    const values = [3.25 / 5, 2.25 / 5, 2.25 / 5, ...tail];
    let draw = 0;
    return () => values[draw++] ?? 0;
  };

  const solid = new VoxelSimulation(12, 12, 12, 0x191b);
  solid.set(5, 5, 5, MAT.DEST);
  solid.set(6, 5, 5, MAT.METL);
  solid.random = targetedRandom([0, 0]);
  solid.updateExplosiveElement(solid.index(5, 5, 5), 5, 5, 5, MAT.DEST);
  assert.equal(solid.get(6, 5, 5), MAT.EMPTY);
  assert.equal(solid.life[solid.index(5, 5, 5)], 18);
  assert.ok(Math.abs(solid.temperatures[solid.index(5, 5, 5)] - 9725.85) < 0.01);
  assert.equal(solid.air.sampleVoxel(5, 5, 5).pressure, 140);

  const insulated = new VoxelSimulation(12, 12, 12, 0x191c);
  insulated.set(5, 5, 5, MAT.DEST, 22, 20);
  insulated.set(6, 5, 5, MAT.INSL);
  insulated.random = targetedRandom([0]);
  insulated.updateExplosiveElement(insulated.index(5, 5, 5), 5, 5, 5, MAT.DEST);
  assert.equal(insulated.get(6, 5, 5), MAT.PLSM);
  assert.ok(insulated.life[insulated.index(6, 5, 5)] >= 50);
  assert.equal(insulated.life[insulated.index(5, 5, 5)], 20);
  assert.equal(insulated.air.sampleVoxel(5, 5, 5).pressure, 80);

  const inertNuclear = new VoxelSimulation(12, 12, 12, 0x191d);
  inertNuclear.set(5, 5, 5, MAT.DEST);
  inertNuclear.set(6, 5, 5, MAT.PLUT, 300);
  inertNuclear.random = targetedRandom([0, 0.75]);
  inertNuclear.updateExplosiveElement(inertNuclear.index(5, 5, 5), 5, 5, 5, MAT.DEST);
  assert.equal(inertNuclear.get(6, 5, 5), MAT.PLUT);
  assert.equal(inertNuclear.life[inertNuclear.index(5, 5, 5)], 30);
  assert.equal(inertNuclear.air.sampleVoxel(5, 5, 5).pressure, 160);

  const fission = new VoxelSimulation(12, 12, 12, 0x191e);
  fission.set(5, 5, 5, MAT.DEST);
  fission.set(6, 5, 5, MAT.DEUT);
  fission.random = targetedRandom([0, 0]);
  fission.updateExplosiveElement(fission.index(5, 5, 5), 5, 5, 5, MAT.DEST);
  assert.equal(fission.get(6, 5, 5), MAT.EMPTY);
  assert.equal(fission.getEnergy(6, 5, 5), MAT.NEUT);
  assert.ok(Math.abs(fission.energyTemperatures[fission.index(6, 5, 5)] - 9725.85) < 0.01);
  assert.equal(fission.life[fission.index(5, 5, 5)], 26);
  assert.equal(fission.air.sampleVoxel(5, 5, 5).pressure, 170);
});

test("thermite only ignites near FIRE, PLSM or LAVA and preserves both molten product branches", () => {
  const inert = new VoxelSimulation(11, 11, 11, 0x191f);
  inert.set(5, 5, 5, MAT.THRM, 1000);
  inert.set(6, 5, 5, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  assert.equal(inert.updateExplosiveElement(inert.index(5, 5, 5), 5, 5, 5, MAT.THRM), false);
  assert.equal(inert.get(5, 5, 5), MAT.THRM);

  const common = new VoxelSimulation(12, 12, 12, 0x1920);
  common.random = () => 1;
  common.set(4, 5, 5, MAT.FIRE, 1000, 100);
  common.set(6, 5, 5, MAT.THRM);
  common.updateFire(common.index(4, 5, 5), 4, 5, 5);
  const molten = common.index(6, 5, 5);
  assert.equal(common.types[molten], MAT.LAVA);
  assert.equal(common.ctype[molten], MAT.THRM);
  assert.equal(common.life[molten], 400);
  assert.equal(common.tmp[molten], 20);
  assert.ok(Math.abs(common.temperatures[molten] - 3226.85) < 0.01);
  assert.equal(common.air.sampleVoxel(6, 5, 5).pressure, 0);

  const rare = new VoxelSimulation(12, 12, 12, 0x1921);
  rare.random = () => 0;
  rare.set(4, 5, 5, MAT.PLSM, 3000, 100);
  rare.set(6, 5, 5, MAT.THRM);
  rare.updatePlasma(rare.index(4, 5, 5), 4, 5, 5);
  const broken = rare.index(6, 5, 5);
  assert.equal(rare.types[broken], MAT.LAVA);
  assert.equal(rare.ctype[broken], MAT.BMTL);
  assert.equal(rare.life[broken], 0);
  assert.equal(rare.tmp[broken], 0);
  assert.equal(rare.air.sampleVoxel(6, 5, 5).pressure, 50);

  const lava = new VoxelSimulation(12, 12, 12, 0x1922);
  lava.random = () => 1;
  lava.set(4, 5, 5, MAT.LAVA, 2000);
  lava.set(4, 5, 7, MAT.THRM);
  lava.updateLiquid(lava.index(4, 5, 5), 4, 5, 5, MAT.LAVA);
  assert.equal(lava.get(4, 5, 7), MAT.LAVA);
  assert.equal(lava.ctype[lava.index(4, 5, 7)], MAT.THRM);
});

test("fuses ignite from sparks, C-5 responds to cold and TNT advances its state machine", () => {
  const fuse = new VoxelSimulation(10, 9, 9, 0x1a1a);
  fuse.random = () => 1;
  fuse.set(4, 4, 4, MAT.FUSE);
  fuse.set(5, 4, 4, MAT.METL);
  fuse.spark(fuse.index(5, 4, 4), MAT.METL);
  fuse.updateExplosiveElement(fuse.index(4, 4, 4), 4, 4, 4, MAT.FUSE);
  assert.equal(fuse.life[fuse.index(4, 4, 4)], 39);

  const powder = new VoxelSimulation(10, 9, 9, 0x1a19);
  powder.random = () => 1;
  powder.set(4, 4, 4, MAT.FSEP);
  powder.set(5, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  powder.updateExplosiveElement(powder.index(4, 4, 4), 4, 4, 4, MAT.FSEP);
  assert.equal(powder.life[powder.index(4, 4, 4)], 50);
  powder.random = () => 0;
  powder.updateExplosiveElement(powder.index(4, 4, 4), 4, 4, 4, MAT.FSEP);
  assert.equal(powder.life[powder.index(4, 4, 4)], 39);

  const burning = new VoxelSimulation(10, 9, 9, 0x1a18);
  burning.set(4, 4, 4, MAT.FUSE, 22, 39);
  const plasmaDraws = [0, 0.9, 0.5, 0.5];
  let plasmaDraw = 0;
  burning.random = () => plasmaDraws[plasmaDraw++] ?? 1;
  burning.updateExplosiveElement(burning.index(4, 4, 4), 4, 4, 4, MAT.FUSE);
  assert.equal(burning.life[burning.index(4, 4, 4)], 38);
  assert.equal(burning.get(5, 4, 4), MAT.PLSM);
  assert.equal(burning.life[burning.index(5, 4, 4)], 50);

  const exhausted = new VoxelSimulation(10, 9, 9, 0x1a17);
  exhausted.set(4, 4, 4, MAT.FUSE, 22, 27, { tmp: 0 });
  exhausted.random = () => 1;
  exhausted.updateExplosiveElement(exhausted.index(4, 4, 4), 4, 4, 4, MAT.FUSE);
  assert.equal(exhausted.get(4, 4, 4), MAT.FSEP);
  assert.equal(exhausted.life[exhausted.index(4, 4, 4)], 50);

  const spent = new VoxelSimulation(10, 9, 9, 0x1a16);
  spent.set(4, 4, 4, MAT.FSEP, 22, 0);
  spent.updateExplosiveElement(spent.index(4, 4, 4), 4, 4, 4, MAT.FSEP);
  assert.equal(spent.get(4, 4, 4), MAT.PLSM);
  assert.equal(spent.life[spent.index(4, 4, 4)], 50);
  assert.ok(spent.temperatures[spent.index(4, 4, 4)] > 9000);

  const c5 = new VoxelSimulation(10, 9, 9, 0x1a1b);
  c5.random = () => 0;
  c5.set(4, 4, 4, MAT.C5);
  c5.set(5, 4, 4, MAT.ICEI, -200);
  c5.updateExplosiveElement(c5.index(4, 4, 4), 4, 4, 4, MAT.C5);
  assert.equal(c5.get(4, 4, 4), MAT.CFLM);
  assert.ok(Math.abs(c5.temperatures[c5.index(5, 4, 4)] + 273.15) < 0.01);
  assert.equal(c5.air.sampleVoxel(4, 4, 4).temperature, 22);

  const tnt = new VoxelSimulation(10, 9, 9, 0x1a1c);
  tnt.random = () => 0;
  tnt.set(4, 4, 4, MAT.BANG, 500);
  tnt.set(5, 4, 4, MAT.BANG, 22);
  tnt.set(6, 4, 4, MAT.BANG, 22);
  tnt.set(8, 4, 4, MAT.BANG, 22);
  tnt.updateExplosiveElement(tnt.index(4, 4, 4), 4, 4, 4, MAT.BANG);
  assert.equal(tnt.tmp[tnt.index(4, 4, 4)], 1);
  tnt.updateExplosiveElement(tnt.index(4, 4, 4), 4, 4, 4, MAT.BANG);
  assert.equal(tnt.tmp[tnt.index(4, 4, 4)], 2);
  assert.equal(tnt.tmp[tnt.index(5, 4, 4)], 2);
  assert.equal(tnt.tmp[tnt.index(6, 4, 4)], 2);
  assert.equal(tnt.tmp[tnt.index(8, 4, 4)], 0);
  tnt.updateExplosiveElement(tnt.index(4, 4, 4), 4, 4, 4, MAT.BANG);
  tnt.updateExplosiveElement(tnt.index(4, 4, 4), 4, 4, 4, MAT.BANG);
  assert.equal(tnt.get(4, 4, 4), MAT.FIRE);
  assert.equal(tnt.life[tnt.index(4, 4, 4)], 120);
  assert.ok(Math.abs(tnt.temperatures[tnt.index(4, 4, 4)] - 2726.6) < 0.01);
  assert.ok(Math.abs(tnt.air.sampleVoxel(4, 4, 4).pressure - 0.5) < 0.001);

  const legacyTiming = new VoxelSimulation(10, 9, 9, 0x1a1f);
  legacyTiming.random = () => 0;
  legacyTiming.set(4, 4, 4, MAT.BANG, 500);
  for (let tick = 0; tick < 4; tick += 1) legacyTiming.updateExplosiveElement(legacyTiming.index(4, 4, 4), 4, 4, 4, MAT.BANG);
  assert.notEqual(legacyTiming.get(4, 4, 4), MAT.BANG);
});

test("ignition cord lights, emits three-dimensional sparks and propagates only on its final burn tick", () => {
  const dormant = new VoxelSimulation(10, 9, 9, 0x1a20);
  dormant.set(4, 4, 4, MAT.IGNT, 22);
  dormant.updateExplosiveElement(dormant.index(4, 4, 4), 4, 4, 4, MAT.IGNT);
  assert.equal(dormant.tmp[dormant.index(4, 4, 4)], 0);
  assert.equal(dormant.life[dormant.index(4, 4, 4)], 3);

  const burning = new VoxelSimulation(10, 9, 9, 0x1a21);
  burning.set(4, 4, 4, MAT.IGNT, 100);
  burning.set(3, 4, 4, MAT.FIRE, 900, 20);
  burning.random = () => 0;
  const cord = burning.index(4, 4, 4);
  burning.updateExplosiveElement(cord, 4, 4, 4, MAT.IGNT);
  assert.equal(burning.tmp[cord], 1);
  assert.equal(burning.life[cord], 3);
  const draws = [0, 0.999, 0.5, 0.5, 0.999, 0, 0.5];
  let draw = 0;
  burning.random = () => draws[draw++] ?? 0.5;
  burning.updateExplosiveElement(cord, 4, 4, 4, MAT.IGNT);
  const ember = burning.index(5, 4, 4);
  assert.equal(burning.types[ember], MAT.EMBR);
  assert.equal(burning.life[ember], 30);
  assert.ok(Math.abs(burning.temperatures[ember] - 226.85) < 0.01);
  assert.equal(burning.velocityX[ember], 10);
  assert.equal(burning.velocityY[ember], -10);
  assert.equal(burning.velocityZ[ember], 0);
  assert.equal(burning.life[cord], 2);

  const propagation = new VoxelSimulation(10, 9, 9, 0x1a22);
  propagation.set(4, 4, 4, MAT.IGNT, 22, 1, { tmp: 1 });
  propagation.set(5, 4, 4, MAT.IGNT, 22);
  propagation.random = () => 1;
  propagation.updateExplosiveElement(propagation.index(5, 4, 4), 5, 4, 4, MAT.IGNT);
  assert.equal(propagation.tmp[propagation.index(5, 4, 4)], 1);
  assert.equal(propagation.life[propagation.index(5, 4, 4)], 3);
  propagation.updateExplosiveElement(propagation.index(4, 4, 4), 4, 4, 4, MAT.IGNT);
  assert.equal(propagation.life[propagation.index(4, 4, 4)], 0);
  propagation.applyAutomaticLifeDecay();
  assert.equal(propagation.get(4, 4, 4), MAT.EMPTY);
});

test("fire, plasma, cold flame and lava use their upstream creation lifetimes", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x1a23);
  sim.random = () => 0;
  sim.set(3, 4, 4, MAT.FIRE);
  sim.set(4, 4, 4, MAT.PLSM);
  sim.set(5, 4, 4, MAT.CFLM);
  sim.set(6, 4, 4, MAT.LAVA);
  assert.equal(sim.temperatures[sim.index(3, 4, 4)], 422);
  assert.equal(sim.temperatures[sim.index(6, 4, 4)], 1522);
  assert.equal(sim.life[sim.index(3, 4, 4)], 120);
  assert.equal(sim.life[sim.index(4, 4, 4)], 50);
  assert.equal(sim.life[sim.index(5, 4, 4)], 50);
  assert.equal(sim.life[sim.index(6, 4, 4)], 240);
});

test("painted smoke and steam keep upstream zero-life persistence instead of artificial timers", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x1a2b);
  sim.set(4, 4, 4, MAT.SMKE);
  sim.set(5, 4, 4, MAT.WTRV);
  assert.equal(sim.temperatures[sim.index(4, 4, 4)], 342);
  assert.equal(sim.temperatures[sim.index(5, 4, 4)], 122);
  assert.equal(sim.life[sim.index(4, 4, 4)], 0);
  assert.equal(sim.life[sim.index(5, 4, 4)], 0);
  sim.applyAutomaticLifeDecay();
  sim.random = () => 1;
  sim.updateGas(sim.index(4, 4, 4), 4, 4, 4, MAT.SMKE);
  sim.updateGas(sim.index(5, 4, 4), 5, 4, 4, MAT.WTRV);
  assert.equal(sim.get(4, 4, 4), MAT.SMKE);
  assert.equal(sim.get(5, 4, 4), MAT.WTRV);
});

test("combustion uses open-space, pressure and exact upstream flammability in 3D", () => {
  const open = new VoxelSimulation(12, 11, 11, 0x1a24);
  open.set(4, 5, 5, MAT.FIRE, 700, 20);
  open.set(6, 5, 5, MAT.WOOD);
  open.random = () => 0;
  open.updateFire(open.index(4, 5, 5), 4, 5, 5);
  const wood = open.index(6, 5, 5);
  assert.equal(open.types[wood], MAT.FIRE);
  assert.equal(open.life[wood], 180);
  assert.ok(Math.abs(open.temperatures[wood] - 432) < 0.001);

  const sealed = new VoxelSimulation(12, 11, 11, 0x1a25);
  sealed.set(5, 5, 5, MAT.FIRE, 700, 20);
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx || dy || dz) sealed.set(5 + dx, 5 + dy, 5 + dz, MAT.STNE);
      }
    }
  }
  sealed.set(7, 5, 5, MAT.WOOD);
  sealed.random = () => 0;
  sealed.updateFire(sealed.index(5, 5, 5), 5, 5, 5);
  assert.equal(sealed.get(7, 5, 5), MAT.WOOD);

  const explosive = new VoxelSimulation(12, 11, 11, 0x1a26);
  explosive.set(5, 5, 5, MAT.PLSM, 4000, 20);
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx || dy || dz) explosive.set(5 + dx, 5 + dy, 5 + dz, MAT.STNE);
      }
    }
  }
  explosive.set(7, 5, 5, MAT.GUNP);
  explosive.random = () => 0;
  explosive.updatePlasma(explosive.index(5, 5, 5), 5, 5, 5);
  const gunpowder = explosive.index(7, 5, 5);
  assert.equal(explosive.types[gunpowder], MAT.FIRE);
  assert.ok(Math.abs(explosive.temperatures[gunpowder] - 722) < 0.001);
  assert.ok(Math.abs(explosive.air.sampleVoxel(5, 5, 5).pressure - 0.25) < 0.001);

  const pressurized = new VoxelSimulation(12, 11, 11, 0x1a27);
  pressurized.set(4, 5, 5, MAT.LAVA, 1500, 300);
  pressurized.set(6, 5, 5, MAT.DESL);
  pressurized.air.pressure[pressurized.air.indexForVoxel(6, 5, 5)] = 1;
  pressurized.random = () => 0.01;
  pressurized.updateCombustionInteractions(pressurized.index(4, 5, 5), 4, 5, 5, MAT.LAVA);
  assert.equal(pressurized.get(6, 5, 5), MAT.FIRE);
});

test("molten rock follows pressure ore formation and molten silicon chemistry", () => {
  const vacuum = new VoxelSimulation(12, 11, 11, 0x1a2c);
  vacuum.set(5, 5, 5, MAT.LAVA, 2000, 300, { ctype: MAT.ROCK });
  vacuum.air.pressure[vacuum.air.indexForVoxel(5, 5, 5)] = -9;
  vacuum.updateLavaState(vacuum.index(5, 5, 5), 5, 5, 5);
  assert.equal(vacuum.ctype[vacuum.index(5, 5, 5)], MAT.STNE);

  const rock = new VoxelSimulation(12, 11, 11, 0x1a2d);
  rock.set(5, 5, 5, MAT.LAVA, 5000, 300, { ctype: MAT.ROCK });
  rock.air.pressure[rock.air.indexForVoxel(5, 5, 5)] = 40;
  rock.random = () => 0;
  rock.updateLavaState(rock.index(5, 5, 5), 5, 5, 5);
  assert.equal(rock.ctype[rock.index(5, 5, 5)], MAT.BRMT);

  const silicon = new VoxelSimulation(12, 11, 11, 0x1a2e);
  silicon.set(5, 5, 5, MAT.LAVA, 2000, 300, { ctype: MAT.SLCN, tmp: 12 });
  silicon.set(6, 5, 5, MAT.O2);
  silicon.random = () => 0;
  silicon.updateCombustionInteractions(silicon.index(5, 5, 5), 5, 5, 5, MAT.LAVA);
  assert.equal(silicon.ctype[silicon.index(5, 5, 5)], MAT.SAND);
  assert.equal(silicon.tmp[silicon.index(5, 5, 5)], 0);
  assert.equal(silicon.get(6, 5, 5), MAT.EMPTY);

  const semiconductor = new VoxelSimulation(12, 11, 11, 0x1a2f);
  semiconductor.set(5, 5, 5, MAT.LAVA, 2000, 300, { ctype: MAT.SLCN, tmp: 4 });
  semiconductor.set(6, 5, 5, MAT.LAVA, 2000, 300, { ctype: MAT.METL });
  semiconductor.random = () => 1;
  semiconductor.updateCombustionInteractions(semiconductor.index(5, 5, 5), 5, 5, 5, MAT.LAVA);
  assert.equal(semiconductor.ctype[semiconductor.index(5, 5, 5)], MAT.NSCN);
  assert.equal(semiconductor.ctype[semiconductor.index(6, 5, 5)], MAT.PSCN);
  assert.equal(semiconductor.tmp[semiconductor.index(5, 5, 5)], 0);

  const ceramic = new VoxelSimulation(12, 11, 11, 0x1a30);
  ceramic.set(5, 5, 5, MAT.LAVA, 3000, 300, { ctype: MAT.QRTZ });
  ceramic.set(6, 5, 5, MAT.LAVA, 3000, 300, { ctype: MAT.CLST });
  ceramic.updateCombustionInteractions(ceramic.index(5, 5, 5), 5, 5, 5, MAT.LAVA);
  assert.equal(ceramic.ctype[ceramic.index(5, 5, 5)], MAT.CRMC);
  assert.equal(ceramic.ctype[ceramic.index(6, 5, 5)], MAT.CRMC);
});

test("phase changes preserve upstream pressure explosives, boiling shifts and typed lava", () => {
  const nitrite = new VoxelSimulation(10, 9, 9, 0x1a31);
  nitrite.set(4, 4, 4, MAT.NITR, 22);
  nitrite.air.pressure[nitrite.air.indexForVoxel(4, 4, 4)] = 3;
  nitrite.random = () => 0;
  assert.equal(nitrite.applyPhaseChange(nitrite.index(4, 4, 4), MAT.NITR), true);
  assert.equal(nitrite.get(4, 4, 4), MAT.FIRE);
  assert.equal(nitrite.life[nitrite.index(4, 4, 4)], 180);
  assert.equal(nitrite.temperatures[nitrite.index(4, 4, 4)], 922);
  assert.ok(Math.abs(nitrite.air.sampleVoxel(4, 4, 4).pressure - 3.25) < 0.001);

  const gunpowder = new VoxelSimulation(10, 9, 9, 0x1a32);
  gunpowder.set(4, 4, 4, MAT.GUNP, 22);
  gunpowder.air.pressure[gunpowder.air.indexForVoxel(4, 4, 4)] = 3;
  gunpowder.random = () => 0;
  assert.equal(gunpowder.applyPhaseChange(gunpowder.index(4, 4, 4), MAT.GUNP), false);
  assert.equal(gunpowder.get(4, 4, 4), MAT.GUNP);

  const boiling = new VoxelSimulation(10, 9, 9, 0x1a33);
  boiling.set(4, 4, 4, MAT.WATR, 101);
  boiling.air.pressure[boiling.air.indexForVoxel(4, 4, 4)] = 1;
  assert.equal(boiling.applyPhaseChange(boiling.index(4, 4, 4), MAT.WATR), false);
  boiling.air.pressure[boiling.air.indexForVoxel(4, 4, 4)] = 0;
  assert.equal(boiling.applyPhaseChange(boiling.index(4, 4, 4), MAT.WATR), true);
  assert.equal(boiling.get(4, 4, 4), MAT.WTRV);
  assert.equal(boiling.life[boiling.index(4, 4, 4)], 0);

  const steam = new VoxelSimulation(10, 9, 9, 0x1a34);
  steam.set(4, 4, 4, MAT.WTRV, 90);
  assert.equal(steam.applyPhaseChange(steam.index(4, 4, 4), MAT.WTRV), true);
  assert.equal(steam.get(4, 4, 4), MAT.DSTW);
  steam.set(5, 4, 4, MAT.WTRV, -1);
  assert.equal(steam.applyPhaseChange(steam.index(5, 4, 4), MAT.WTRV), true);
  assert.equal(steam.get(5, 4, 4), MAT.RIME);
  assert.equal(steam.ctype[steam.index(5, 4, 4)], MAT.DSTW);

  const saltWater = new VoxelSimulation(10, 9, 9, 0x1a35);
  saltWater.set(4, 4, 4, MAT.SLTW, 110);
  saltWater.random = () => 0;
  assert.equal(saltWater.applyPhaseChange(saltWater.index(4, 4, 4), MAT.SLTW), true);
  assert.equal(saltWater.get(4, 4, 4), MAT.SALT);

  const lava = new VoxelSimulation(10, 9, 9, 0x1a36);
  lava.set(3, 4, 4, MAT.LAVA, 600, 300);
  assert.equal(lava.applyPhaseChange(lava.index(3, 4, 4), MAT.LAVA), true);
  assert.equal(lava.get(3, 4, 4), MAT.STNE);
  lava.set(4, 4, 4, MAT.LAVA, 900, 300, { ctype: MAT.THRM, tmp: 20 });
  assert.equal(lava.applyPhaseChange(lava.index(4, 4, 4), MAT.LAVA), true);
  assert.equal(lava.get(4, 4, 4), MAT.BMTL);
  assert.equal(lava.tmp[lava.index(4, 4, 4)], 0);
  lava.set(5, 4, 4, MAT.LAVA, 1100, 300, { ctype: MAT.THRM, tmp: 20 });
  assert.equal(lava.applyPhaseChange(lava.index(5, 4, 4), MAT.LAVA), false);
  assert.equal(lava.get(5, 4, 4), MAT.LAVA);

  const melt = new VoxelSimulation(10, 9, 9, 0x1a37);
  melt.random = () => 0;
  melt.set(4, 4, 4, MAT.SAND, 1800);
  assert.equal(melt.applyPhaseChange(melt.index(4, 4, 4), MAT.SAND), true);
  assert.equal(melt.get(4, 4, 4), MAT.LAVA);
  assert.equal(melt.ctype[melt.index(4, 4, 4)], MAT.GLAS);
  assert.equal(melt.life[melt.index(4, 4, 4)], 240);
});

test("breakable metal uses exact pressure thresholds and clears carried state", () => {
  const intact = new VoxelSimulation(10, 9, 9, 0x1a38);
  intact.set(4, 4, 4, MAT.BMTL, 22, 5, { ctype: MAT.WATR, tmp: 0, tmp2: 7, tmp3: 8, tmp4: 9 });
  intact.air.pressure[intact.air.indexForVoxel(4, 4, 4)] = 2;
  assert.equal(intact.applyPhaseChange(intact.index(4, 4, 4), MAT.BMTL), false);
  intact.air.pressure[intact.air.indexForVoxel(4, 4, 4)] = 3;
  assert.equal(intact.applyPhaseChange(intact.index(4, 4, 4), MAT.BMTL), true);
  const broken = intact.index(4, 4, 4);
  assert.equal(intact.types[broken], MAT.BRMT);
  assert.deepEqual([intact.life[broken], intact.ctype[broken], intact.tmp[broken], intact.tmp2[broken], intact.tmp3[broken], intact.tmp4[broken]], [0, 0, 0, 0, 0, 0]);

  const weakened = new VoxelSimulation(10, 9, 9, 0x1a39);
  weakened.set(4, 4, 4, MAT.BMTL, 22, 0, { tmp: 1 });
  weakened.air.pressure[weakened.air.indexForVoxel(4, 4, 4)] = 1.1;
  assert.equal(weakened.applyPhaseChange(weakened.index(4, 4, 4), MAT.BMTL), true);
  assert.equal(weakened.get(4, 4, 4), MAT.BRMT);
});

test("spent fire follows the exact smoke, water-vapour and hot-extinction branches", () => {
  const smoke = new VoxelSimulation(10, 9, 9, 0x1a28);
  smoke.random = () => 0;
  smoke.set(4, 4, 4, MAT.FIRE, 300, 1);
  smoke.updateFire(smoke.index(4, 4, 4), 4, 4, 4);
  assert.equal(smoke.get(4, 4, 4), MAT.SMKE);
  assert.equal(smoke.life[smoke.index(4, 4, 4)], 249);

  const water = new VoxelSimulation(10, 9, 9, 0x1a29);
  water.set(4, 4, 4, MAT.FIRE, 900, 1, { tmp: 3 });
  water.updateFire(water.index(4, 4, 4), 4, 4, 4);
  assert.equal(water.get(4, 4, 4), MAT.WTRV);
  assert.equal(water.ctype[water.index(4, 4, 4)], MAT.FIRE);
  assert.equal(water.life[water.index(4, 4, 4)], 0);

  const hot = new VoxelSimulation(10, 9, 9, 0x1a2a);
  hot.set(4, 4, 4, MAT.FIRE, 400, 1);
  hot.updateFire(hot.index(4, 4, 4), 4, 4, 4);
  assert.equal(hot.get(4, 4, 4), MAT.EMPTY);
});

test("C-5 stores, delays and momentum-combines compatible photons in three dimensions", () => {
  const delayed = new VoxelSimulation(10, 10, 10, 0x1a1d);
  const cell = delayed.index(4, 4, 4);
  delayed.set(4, 4, 4, MAT.C5, 18);
  delayed.setEnergy(4, 4, 4, MAT.PHOT, 500, 80, {
    ctype: 0x3fffffc0, velocityX: 1.25, velocityY: -0.5, velocityZ: 0.75,
  });
  assert.equal(delayed.interactEnergy(cell, 4, 4, 4), true);
  assert.equal(delayed.getEnergy(4, 4, 4), MAT.EMPTY);
  assert.equal(delayed.life[cell], 1);
  assert.equal(delayed.ctype[cell], 0x3fffffc0);
  delayed.applyAutomaticLifeDecay();
  delayed.updateExplosiveElement(cell, 4, 4, 4, MAT.C5);
  assert.equal(delayed.getEnergy(4, 4, 4), MAT.PHOT);
  assert.equal(delayed.energyCtype[cell], 0x3fffffc0);
  assert.ok(Math.abs(delayed.energyVelocityX[cell] - 1.25) < 0.01);
  assert.ok(Math.abs(delayed.energyVelocityY[cell] + 0.5) < 0.01);
  assert.ok(Math.abs(delayed.energyVelocityZ[cell] - 0.75) < 0.01);
  assert.equal(delayed.ctype[cell], 0);

  const combine = new VoxelSimulation(10, 10, 10, 0x1a1e);
  const combined = combine.index(4, 4, 4);
  combine.set(4, 4, 4, MAT.C5);
  combine.setEnergy(4, 4, 4, MAT.PHOT, 500, 80, {
    ctype: 0x3fffffc0, velocityX: 1, velocityY: 0, velocityZ: 0,
  });
  combine.interactEnergy(combined, 4, 4, 4);
  combine.setEnergy(4, 4, 4, MAT.PHOT, 500, 80, {
    ctype: 0x3fffffc0, velocityX: 0, velocityY: 1, velocityZ: 0,
  });
  combine.interactEnergy(combined, 4, 4, 4);
  assert.equal(combine.getEnergy(4, 4, 4), MAT.PHOT);
  assert.equal(combine.energyCtype[combined], (0x3fffffc0 >>> 6) & 0x3fffffff);
  assert.ok(Math.abs(combine.energyVelocityX[combined] - Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(combine.energyVelocityY[combined] - Math.SQRT1_2) < 0.01);
  assert.equal(combine.life[combined], 0);
  assert.equal(combine.ctype[combined], 0);

  const insulated = new VoxelSimulation(10, 10, 10, 0x1a1f);
  insulated.random = () => 0;
  insulated.set(4, 4, 4, MAT.C5);
  insulated.set(5, 4, 4, MAT.INSL, -250);
  insulated.updateExplosiveElement(insulated.index(4, 4, 4), 4, 4, 4, MAT.C5);
  assert.equal(insulated.get(4, 4, 4), MAT.C5);
});

test("automatic upstream life flags age and remove transient particles", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x1b1b);
  sim.set(4, 6, 4, MAT.EMBR, 500, 2);
  sim.step();
  assert.equal(sim.types.includes(MAT.EMBR), true);
  sim.step();
  assert.equal(sim.types.includes(MAT.EMBR), false);
});

test("pipes capture, transport and emit full particle state through a 3D line", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x1c1c);
  sim.set(4, 4, 4, MAT.PIPE);
  sim.set(5, 4, 4, MAT.PIPE);
  sim.set(3, 4, 4, MAT.WATR, 64, 23, { ctype: MAT.SLTW, tmp: 44 });
  sim.updatePipe(sim.index(4, 4, 4), 4, 4, 4, MAT.PIPE);
  assert.equal(sim.get(3, 4, 4), MAT.EMPTY);
  assert.equal(sim.ctype[sim.index(4, 4, 4)], MAT.WATR);
  sim.updatePipe(sim.index(4, 4, 4), 4, 4, 4, MAT.PIPE);
  assert.equal(sim.ctype[sim.index(5, 4, 4)], MAT.WATR);
  sim.updatePipe(sim.index(5, 4, 4), 5, 4, 4, MAT.PIPE);
  sim.updatePipe(sim.index(5, 4, 4), 5, 4, 4, MAT.PIPE);
  assert.equal(sim.ctype[sim.index(5, 4, 4)], 0);
  const emitted = sim.types.findIndex((type) => type === MAT.WATR);
  assert.notEqual(emitted, -1);
  assert.equal(sim.life[emitted], 23);
  assert.equal(sim.ctype[emitted], MAT.SLTW);
  assert.equal(sim.tmp[emitted], 44);
});

test("3D pipe networks initialize a repeating route colour and follow it through branches", () => {
  const sim = new VoxelSimulation(14, 10, 10, 0x1c1d);
  for (let x = 4; x <= 7; x += 1) sim.set(x, 5, 5, MAT.PIPE);
  assert.equal(sim.initializePipeNetwork(sim.index(4, 5, 5)), 4);
  assert.deepEqual([4, 5, 6, 7].map((x) => sim.tmp[sim.index(x, 5, 5)] & PIPE_FLAG.COLORS), [
    PIPE_FLAG.COLOR_RED, PIPE_FLAG.COLOR_BLUE, PIPE_FLAG.COLOR_GREEN, PIPE_FLAG.COLOR_RED,
  ]);
  sim.set(3, 5, 5, MAT.OIL, 71, 17, { tmp: 42, ctype: MAT.WATR });
  sim.updatePipe(sim.index(4, 5, 5), 4, 5, 5, MAT.PIPE);
  sim.updatePipe(sim.index(4, 5, 5), 4, 5, 5, MAT.PIPE);
  assert.equal(sim.ctype[sim.index(5, 5, 5)], MAT.OIL);
  sim.updatePipe(sim.index(5, 5, 5), 5, 5, 5, MAT.PIPE);
  assert.equal(sim.ctype[sim.index(6, 5, 5)], MAT.OIL);
});

test("powered-pipe pause and reverse triggers flood through a connected 3D network", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x1c1e);
  sim.set(4, 5, 5, MAT.PPIP);
  sim.set(5, 5, 5, MAT.PPIP);
  sim.set(5, 6, 6, MAT.PPIP);
  const start = sim.index(4, 5, 5);
  assert.equal(sim.triggerPipeNetwork(start, MAT.NSCN), 3);
  for (const [x, y, z] of [[4, 5, 5], [5, 5, 5], [5, 6, 6]]) assert.ok(sim.tmp[sim.index(x, y, z)] & PIPE_FLAG.PAUSED);
  assert.equal(sim.triggerPipeNetwork(start, MAT.PSCN), 3);
  assert.equal(sim.triggerPipeNetwork(start, MAT.INST), 3);
  for (const [x, y, z] of [[4, 5, 5], [5, 5, 5], [5, 6, 6]]) {
    const flags = sim.tmp[sim.index(x, y, z)];
    assert.equal(flags & PIPE_FLAG.PAUSED, 0);
    assert.ok(flags & PIPE_FLAG.REVERSED);
  }
});

test("pipes carry particle decoration separately from their route colour and HEAC enables network conduction", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x1c1f);
  sim.set(4, 5, 5, MAT.PIPE);
  sim.set(5, 5, 5, MAT.PIPE);
  sim.set(4, 6, 5, MAT.HEAC);
  sim.set(3, 5, 5, MAT.WATR, 65, 12, { decoration: 0xff38a9ef });
  const first = sim.index(4, 5, 5);
  const second = sim.index(5, 5, 5);
  sim.updatePipe(first, 4, 5, 5, MAT.PIPE);
  assert.ok(sim.tmp[first] & PIPE_FLAG.PARTICLE_DECO);
  assert.ok(sim.tmp[first] & PIPE_FLAG.CAN_CONDUCT);
  assert.ok(sim.tmp[second] & PIPE_FLAG.CAN_CONDUCT);
  sim.updatePipe(first, 4, 5, 5, MAT.PIPE);
  assert.equal(sim.decorations[first], 0);
  assert.equal(sim.decorations[second], 0xff38a9ef);
  sim.updatePipe(second, 5, 5, 5, MAT.PIPE);
  sim.updatePipe(second, 5, 5, 5, MAT.PIPE);
  const emitted = sim.types.findIndex((type, index) => type === MAT.WATR && index !== sim.index(3, 5, 5));
  assert.notEqual(emitted, -1);
  assert.equal(sim.decorations[emitted], 0xff38a9ef);
});

test("storage captures one non-solid particle and PSCN releases it", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x1d1d);
  sim.set(5, 4, 4, MAT.STOR);
  sim.set(6, 4, 4, MAT.OIL, 88, 13, { tmp: 72, ctype: MAT.WATR });
  sim.updateStorage(sim.index(5, 4, 4), 5, 4, 4);
  assert.equal(sim.tmp[sim.index(5, 4, 4)], MAT.OIL);
  assert.equal(sim.get(6, 4, 4), MAT.EMPTY);
  sim.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.updateStorage(sim.index(5, 4, 4), 5, 4, 4);
  assert.equal(sim.tmp[sim.index(5, 4, 4)], 0);
  const emitted = sim.types.findIndex((type) => type === MAT.OIL);
  assert.notEqual(emitted, -1);
  assert.equal(sim.life[emitted], 13);
  assert.equal(sim.tmp[emitted], 72);
});

test("WIFI transmits one frame later between matching temperature channels", () => {
  const sim = new VoxelSimulation(14, 9, 9, 0x1e1e);
  sim.set(3, 4, 4, MAT.WIFI, 22);
  sim.set(2, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.set(9, 4, 4, MAT.WIFI, 22);
  sim.set(10, 4, 4, MAT.PSCN);
  sim.updateWirelessState();
  sim.updateWifi(sim.index(9, 4, 4), 9, 4, 4);
  assert.equal(sim.get(10, 4, 4), MAT.PSCN);
  sim.updateWirelessState();
  sim.updateWifi(sim.index(9, 4, 4), 9, 4, 4);
  assert.equal(sim.get(10, 4, 4), MAT.SPRK);
  assert.equal(sim.ctype[sim.index(10, 4, 4)], MAT.PSCN);
});

test("WIFI only accepts positive sparks and only outputs to its three original wire types", () => {
  const sim = new VoxelSimulation(14, 9, 9, 0x1e1f);
  sim.set(3, 4, 4, MAT.WIFI, 22);
  sim.set(2, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.NSCN });
  sim.set(9, 4, 4, MAT.WIFI, 22);
  sim.set(10, 4, 4, MAT.PSCN);
  sim.updateWirelessState();
  sim.updateWirelessState();
  sim.updateWifi(sim.index(9, 4, 4), 9, 4, 4);
  assert.equal(sim.get(10, 4, 4), MAT.PSCN);

  sim.ctype[sim.index(2, 4, 4)] = MAT.PSCN;
  sim.set(10, 4, 4, MAT.METL);
  sim.updateWirelessState();
  sim.updateWirelessState();
  sim.updateWifi(sim.index(9, 4, 4), 9, 4, 4);
  assert.equal(sim.get(10, 4, 4), MAT.METL);
});

test("array, creator and duplicator rays operate away from their spark source", () => {
  const array = new VoxelSimulation(14, 9, 9, 0x1f1f);
  array.set(4, 4, 4, MAT.ARAY);
  array.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  array.updateArrayRay(array.index(4, 4, 4), 4, 4, 4);
  assert.equal(array.get(5, 4, 4), MAT.BRAY);
  assert.ok(array.life[array.index(5, 4, 4)] > 0);

  const creator = new VoxelSimulation(14, 9, 9, 0x1f20);
  creator.set(4, 4, 4, MAT.CRAY, 22, 0, { ctype: MAT.WATR, tmp: 3 });
  creator.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  creator.updateCreatorRay(creator.index(4, 4, 4), 4, 4, 4);
  assert.equal(creator.get(5, 4, 4), MAT.WATR);
  assert.equal(creator.get(7, 4, 4), MAT.WATR);

  const duplicator = new VoxelSimulation(14, 9, 9, 0x1f21);
  duplicator.set(4, 4, 4, MAT.DRAY, 22, 0, { tmp: 1 });
  duplicator.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  duplicator.set(5, 4, 4, MAT.SAND, 66, 7, { ctype: MAT.WATR, tmp: 55 });
  duplicator.updateDuplicatorRay(duplicator.index(4, 4, 4), 4, 4, 4);
  assert.equal(duplicator.get(6, 4, 4), MAT.SAND);
  assert.equal(duplicator.temperatures[duplicator.index(6, 4, 4)], 66);
  assert.equal(duplicator.tmp[duplicator.index(6, 4, 4)], 55);
});

test("array rays extend along 3D diagonals and preserve normal beam temperature and life", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x1f22);
  sim.set(4, 4, 4, MAT.ARAY, 315, 45);
  sim.set(3, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.updateArrayRay(sim.index(4, 4, 4), 4, 4, 4);
  const beam = sim.index(5, 5, 5);
  assert.equal(sim.types[beam], MAT.BRAY);
  assert.equal(sim.temperatures[beam], 315);
  assert.equal(sim.life[beam], 45);
  assert.equal(sim.tmp[beam], 0);
});

test("PSCN array rays erase existing BRAY into a continuing red beam", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x1f23);
  sim.set(4, 4, 4, MAT.ARAY);
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.set(5, 4, 4, MAT.BRAY, 22, 30);
  sim.updateArrayRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.tmp[sim.index(5, 4, 4)], 2);
  assert.equal(sim.life[sim.index(5, 4, 4)], 1);
  assert.equal(sim.get(6, 4, 4), MAT.BRAY);
  assert.equal(sim.tmp[sim.index(6, 4, 4)], 2);
});

test("INST array rays spark conductors without stopping their beam", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x1f24);
  sim.set(4, 4, 4, MAT.ARAY);
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.INST });
  sim.set(6, 4, 4, MAT.METL);
  sim.updateArrayRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(6, 4, 4), MAT.SPRK);
  assert.equal(sim.ctype[sim.index(6, 4, 4)], MAT.METL);
  assert.equal(sim.get(7, 4, 4), MAT.BRAY);
});

test("array rays inherit FILT wavelengths and convert collided normal BRAY to long life", () => {
  const filtered = new VoxelSimulation(12, 9, 9, 0x1f25);
  filtered.set(4, 4, 4, MAT.ARAY);
  filtered.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  filtered.set(5, 4, 4, MAT.FILT, 22, 0, { ctype: 1 << 20, decoration: 0xff000000 });
  filtered.updateArrayRay(filtered.index(4, 4, 4), 4, 4, 4);
  const colored = filtered.index(6, 4, 4);
  assert.equal(filtered.ctype[colored], 1 << 20);
  assert.equal(filtered.decorations[colored], 0xff000000);
  assert.equal(filtered.life[filtered.index(5, 4, 4)], 4);

  const collision = new VoxelSimulation(12, 9, 9, 0x1f26);
  collision.set(4, 4, 4, MAT.ARAY);
  collision.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  collision.set(6, 4, 4, MAT.BRAY, 22, 12);
  collision.updateArrayRay(collision.index(4, 4, 4), 4, 4, 4);
  assert.equal(collision.tmp[collision.index(6, 4, 4)], 1);
  assert.equal(collision.life[collision.index(6, 4, 4)], 1020);
  assert.equal(collision.get(7, 4, 4), MAT.EMPTY);
});

test("creator rays honor particle count, empty-space offset, temperature and life", () => {
  const sim = new VoxelSimulation(14, 9, 9, 0x1f27);
  sim.set(4, 4, 4, MAT.CRAY, 88, 7, { ctype: MAT.WATR, tmp: 2, tmp2: 2 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.updateCreatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(5, 4, 4), MAT.EMPTY);
  assert.equal(sim.get(6, 4, 4), MAT.EMPTY);
  assert.equal(sim.get(7, 4, 4), MAT.WATR);
  assert.equal(sim.get(8, 4, 4), MAT.WATR);
  assert.equal(sim.temperatures[sim.index(7, 4, 4)], 88);
  assert.equal(sim.life[sim.index(7, 4, 4)], 7);
  assert.equal(sim.get(9, 4, 4), MAT.EMPTY);
});

test("creator rays preserve packed Life variants and continue past occupied energy slots", () => {
  const life = new VoxelSimulation(14, 9, 9, 0x1e2c);
  life.set(4, 4, 4, MAT.CRAY, 22, 0, { ctype: (7 << 9) | MAT.LIFE, tmp: 1 });
  life.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  life.updateCreatorRay(life.index(4, 4, 4), 4, 4, 4);
  assert.equal(life.get(5, 4, 4), MAT.LIFE);
  assert.equal(life.ctype[life.index(5, 4, 4)], 7);

  const energy = new VoxelSimulation(14, 9, 9, 0x1e2d);
  energy.set(4, 4, 4, MAT.CRAY, 22, 0, { ctype: MAT.PHOT, tmp: 1 });
  energy.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  energy.setEnergy(5, 4, 4, MAT.NEUT);
  energy.updateCreatorRay(energy.index(4, 4, 4), 4, 4, 4);
  assert.equal(energy.getEnergy(5, 4, 4), MAT.NEUT);
  assert.equal(energy.getEnergy(6, 4, 4), MAT.PHOT);
  assert.equal(energy.energyCtype[energy.index(6, 4, 4)], 0x3fffffff);
});

test("PSCN creator rays erase non-diamond particles while INST rays pass obstructions", () => {
  const destroy = new VoxelSimulation(12, 9, 9, 0x1f28);
  destroy.set(4, 4, 4, MAT.CRAY, 22, 0, { ctype: MAT.WATR, tmp: 4 });
  destroy.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  destroy.set(5, 4, 4, MAT.SAND);
  destroy.set(6, 4, 4, MAT.DMND);
  destroy.updateCreatorRay(destroy.index(4, 4, 4), 4, 4, 4);
  assert.equal(destroy.get(5, 4, 4), MAT.EMPTY);
  assert.equal(destroy.get(6, 4, 4), MAT.DMND);

  const noStop = new VoxelSimulation(12, 9, 9, 0x1f29);
  noStop.set(4, 4, 4, MAT.CRAY, 22, 0, { ctype: MAT.WATR, tmp: 1 });
  noStop.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.INST });
  noStop.set(5, 4, 4, MAT.SAND);
  noStop.updateCreatorRay(noStop.index(4, 4, 4), 4, 4, 4);
  assert.equal(noStop.get(5, 4, 4), MAT.SAND);
  assert.equal(noStop.get(6, 4, 4), MAT.WATR);
});

test("creator rays acquire adjacent energy and carry FILT decoration into their output", () => {
  const acquire = new VoxelSimulation(12, 9, 9, 0x1f2a);
  acquire.set(4, 4, 4, MAT.CRAY);
  acquire.setEnergy(5, 5, 5, MAT.PHOT, 321);
  acquire.updateCreatorRay(acquire.index(4, 4, 4), 4, 4, 4);
  assert.equal(acquire.ctype[acquire.index(4, 4, 4)], MAT.PHOT);
  assert.equal(acquire.temperatures[acquire.index(4, 4, 4)], 321);

  const filtered = new VoxelSimulation(12, 9, 9, 0x1f2b);
  filtered.set(4, 4, 4, MAT.CRAY, 22, 0, { ctype: MAT.DUST, tmp: 1 });
  filtered.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  filtered.set(5, 4, 4, MAT.FILT, 22, 0, { ctype: 1 << 20 });
  filtered.updateCreatorRay(filtered.index(4, 4, 4), 4, 4, 4);
  assert.equal(filtered.get(6, 4, 4), MAT.DUST);
  assert.notEqual(filtered.decorations[filtered.index(6, 4, 4)], 0);
  assert.equal(filtered.life[filtered.index(5, 4, 4)], 4);
});

test("INWR-triggered SPRK creator rays energize occupied conductors", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x1f2c);
  sim.set(4, 4, 4, MAT.CRAY, 130, 0, { ctype: MAT.SPRK, tmp: 1 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.INWR });
  sim.set(5, 4, 4, MAT.METL);
  sim.updateCreatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(5, 4, 4), MAT.SPRK);
  assert.equal(sim.ctype[sim.index(5, 4, 4)], MAT.METL);
  assert.equal(sim.temperatures[sim.index(5, 4, 4)], 130);
});

test("duplicator rays copy multi-voxel matter lines after their configured gap", () => {
  const sim = new VoxelSimulation(16, 9, 9, 0x1f2d);
  sim.set(4, 4, 4, MAT.DRAY, 22, 0, { tmp: 2, tmp2: 1 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.set(5, 4, 4, MAT.DUST, 72, 9, { ctype: MAT.WATR, tmp: 31, flags: 0xabc, decoration: 0xff336699 });
  sim.set(6, 4, 4, MAT.OIL, 41, 8, { tmp2: 44, velocityZ: 1.5 });
  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(8, 4, 4), MAT.DUST);
  assert.equal(sim.get(9, 4, 4), MAT.OIL);
  assert.equal(sim.temperatures[sim.index(8, 4, 4)], 72);
  assert.equal(sim.tmp[sim.index(8, 4, 4)], 31);
  assert.equal(sim.flags[sim.index(8, 4, 4)], 0xabc);
  assert.equal(sim.decorations[sim.index(8, 4, 4)], 0xff336699);
  assert.equal(sim.velocityZ[sim.index(9, 4, 4)], 1.5);
});

test("duplicator rays remap SOAP topology and preserve raw callback-sensitive state", () => {
  const sim = new VoxelSimulation(18, 9, 9, 0x1f2c);
  sim.set(4, 4, 4, MAT.DRAY, 22, 0, { tmp: 3, tmp2: 1 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.set(5, 4, 4, MAT.SOAP);
  sim.set(6, 4, 4, MAT.SOAP);
  assert.equal(sim.attachSoap(sim.index(5, 4, 4), sim.index(6, 4, 4)), true);
  sim.set(7, 4, 4, MAT.LIGH, 1200, 55, { tmp: 17, tmp2: 9, tmp3: -4 });
  sim.life[sim.index(7, 4, 4)] = 99;

  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  const first = sim.index(9, 4, 4);
  const second = sim.index(10, 4, 4);
  const lightning = sim.index(11, 4, 4);
  assert.equal(sim.types[first], MAT.SOAP);
  assert.equal(sim.types[second], MAT.SOAP);
  assert.equal(sim.tmp[first], second);
  assert.equal(sim.tmp2[second], first);
  assert.notEqual(sim.tmp[first], sim.index(6, 4, 4));
  assert.equal(sim.types[lightning], MAT.LIGH);
  assert.equal(sim.life[lightning], 99);
  assert.equal(sim.tmp2[lightning], 9);
});

test("PSCN duplicator rays overwrite targets and reproduce holes in the source line", () => {
  const sim = new VoxelSimulation(14, 9, 9, 0x1f2e);
  sim.set(4, 4, 4, MAT.DRAY, 22, 0, { tmp: 2 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.set(5, 4, 4, MAT.SAND);
  sim.set(7, 4, 4, MAT.OIL);
  sim.set(8, 4, 4, MAT.OIL);
  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(7, 4, 4), MAT.SAND);
  assert.equal(sim.get(8, 4, 4), MAT.EMPTY);
});

test("duplicator rays select and preserve the independent energy layer", () => {
  const sim = new VoxelSimulation(14, 9, 9, 0x1f2f);
  sim.set(4, 4, 4, MAT.DRAY, 22, 0, { tmp: 2 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.setEnergy(5, 4, 4, MAT.PHOT, 650, 52, {
    ctype: 1 << 19, tmp: 12, velocityX: 2.5, flags: 0x1234, decoration: 0xff55aaff,
  });
  sim.setEnergy(6, 4, 4, MAT.NEUT, 90, 77, { velocityZ: -1.25 });
  sim.set(7, 4, 4, MAT.GLAS);
  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.getEnergy(7, 4, 4), MAT.PHOT);
  assert.equal(sim.getEnergy(8, 4, 4), MAT.NEUT);
  assert.equal(sim.get(7, 4, 4), MAT.GLAS);
  assert.equal(sim.energyCtype[sim.index(7, 4, 4)], 1 << 19);
  assert.equal(sim.energyFlags[sim.index(7, 4, 4)], 0x1234);
  assert.equal(sim.energyDecorations[sim.index(7, 4, 4)], 0xff55aaff);
  assert.equal(sim.energyVelocityZ[sim.index(8, 4, 4)], -1.25);
});

test("zero-length duplicator rays copy a run up to the selected marker", () => {
  const sim = new VoxelSimulation(14, 9, 9, 0x1f30);
  sim.set(4, 4, 4, MAT.DRAY);
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.set(5, 4, 4, MAT.SAND);
  sim.set(6, 4, 4, MAT.WATR);
  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(7, 4, 4), MAT.SAND);
  assert.equal(sim.get(8, 4, 4), MAT.WATR);
});

test("zero-length duplicator rays match the packed Life marker subtype", () => {
  const sim = new VoxelSimulation(16, 9, 9, 0x1f32);
  sim.set(4, 4, 4, MAT.DRAY, 22, 0, { ctype: (2 << 9) | MAT.LIFE, tmp2: 1 });
  sim.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sim.set(5, 4, 4, MAT.LIFE, 22, 0, { ctype: 1 });
  sim.set(6, 4, 4, MAT.SAND);
  sim.set(7, 4, 4, MAT.LIFE, 22, 0, { ctype: 2 });
  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(8, 4, 4), MAT.LIFE);
  assert.equal(sim.ctype[sim.index(8, 4, 4)], 1);
  assert.equal(sim.get(9, 4, 4), MAT.SAND);
});

test("INWR cannot trigger a duplicator ray diagonally through 3D", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x1f31);
  sim.set(4, 4, 4, MAT.DRAY, 22, 0, { tmp: 1 });
  sim.set(3, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.INWR });
  sim.set(5, 5, 5, MAT.SAND);
  sim.updateDuplicatorRay(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.get(6, 6, 6), MAT.EMPTY);
});

test("uranium heats under pressure and pressurized plutonium emits a neutron", () => {
  const uranium = new VoxelSimulation(10, 9, 9, 0x2020);
  uranium.set(4, 4, 4, MAT.URAN, 52);
  uranium.air.injectVoxel(4, 4, 4, 100);
  uranium.updateNuclearElement(uranium.index(4, 4, 4), 4, 4, 4, MAT.URAN);
  assert.ok(uranium.temperatures[uranium.index(4, 4, 4)] > 52);

  const legacyUranium = new VoxelSimulation(10, 9, 9, 0x2022);
  legacyUranium.heatSimulationEnabled = false;
  legacyUranium.set(4, 4, 4, MAT.URAN, 52);
  legacyUranium.air.injectVoxel(4, 4, 4, 100);
  legacyUranium.updateNuclearElement(legacyUranium.index(4, 4, 4), 4, 4, 4, MAT.URAN);
  assert.equal(legacyUranium.temperatures[legacyUranium.index(4, 4, 4)], 52);

  const plutonium = new VoxelSimulation(10, 9, 9, 0x2021);
  plutonium.random = () => 0;
  plutonium.set(4, 4, 4, MAT.PLUT);
  plutonium.air.injectVoxel(4, 4, 4, 100);
  assert.equal(plutonium.updateNuclearElement(plutonium.index(4, 4, 4), 4, 4, 4, MAT.PLUT), true);
  assert.equal(plutonium.get(4, 4, 4), MAT.EMPTY);
  assert.equal(plutonium.getEnergy(4, 4, 4), MAT.NEUT);
});

test("polonium emits neutrons and proton exposure transmutes it into plutonium", () => {
  const decay = new VoxelSimulation(10, 9, 9, 0x2121);
  decay.random = () => 0;
  decay.set(4, 4, 4, MAT.POLO);
  decay.updatePolonium(decay.index(4, 4, 4), 4, 4, 4);
  assert.equal(decay.tmp[decay.index(4, 4, 4)], 1);
  assert.equal(decay.life[decay.index(4, 4, 4)], 15);
  assert.equal(decay.energyTypes.includes(MAT.NEUT), true);
  const emittedNeutron = decay.energyTypes.findIndex((type) => type === MAT.NEUT);
  assert.ok(Math.abs(decay.temperatures[decay.index(4, 4, 4)] - 370.5) < 0.001);
  assert.ok(Math.abs(decay.energyTemperatures[emittedNeutron] - 370.5) < 0.001);

  const transmute = new VoxelSimulation(10, 9, 9, 0x2122);
  const index = transmute.index(4, 4, 4);
  transmute.set(4, 4, 4, MAT.POLO, 115, 0, { tmp2: 9 });
  transmute.setEnergy(4, 4, 4, MAT.PROT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  assert.equal(transmute.interactEnergy(index, 4, 4, 4), true);
  assert.equal(transmute.getEnergy(4, 4, 4), MAT.EMPTY);
  transmute.updatePolonium(index, 4, 4, 4);
  assert.equal(transmute.get(4, 4, 4), MAT.PLUT);
});

test("cold deuterium concentrates and isotope-z decays into photons under vacuum", () => {
  const deuterium = new VoxelSimulation(10, 9, 9, 0x2222);
  deuterium.random = () => 0;
  deuterium.set(4, 4, 4, MAT.DEUT, -250, 10);
  deuterium.set(5, 4, 4, MAT.DEUT, -250, 20);
  deuterium.updateDeuterium(deuterium.index(4, 4, 4), 4, 4, 4);
  assert.equal(deuterium.get(5, 4, 4), MAT.EMPTY);
  assert.ok(deuterium.life[deuterium.index(4, 4, 4)] >= 31);

  const capacity = new VoxelSimulation(10, 9, 9, 0x2224);
  capacity.random = () => 0.5;
  capacity.set(4, 4, 4, MAT.DEUT, -250, 396);
  capacity.updateDeuterium(capacity.index(4, 4, 4), 4, 4, 4);
  assert.equal(capacity.life[capacity.index(4, 4, 4)], 396);

  const isotope = new VoxelSimulation(10, 9, 9, 0x2223);
  isotope.random = () => 0;
  isotope.set(4, 4, 4, MAT.ISOZ);
  isotope.air.injectVoxel(4, 4, 4, -100);
  assert.equal(isotope.updateNuclearElement(isotope.index(4, 4, 4), 4, 4, 4, MAT.ISOZ), true);
  assert.equal(isotope.get(4, 4, 4), MAT.EMPTY);
  assert.equal(isotope.getEnergy(4, 4, 4), MAT.PHOT);
  assert.equal(isotope.energyTemperatures[isotope.index(4, 4, 4)], materialById(MAT.PHOT).defaultTemp);

  const stimulated = new VoxelSimulation(10, 9, 9, 0x2225);
  stimulated.random = () => 0;
  stimulated.set(4, 4, 4, MAT.ISOZ);
  stimulated.setEnergy(4, 4, 4, MAT.PHOT, 700, 200, {
    velocityX: 3, velocityY: 0, velocityZ: 0, ctype: 0x1f,
  });
  assert.equal(stimulated.interactEnergy(stimulated.index(4, 4, 4), 4, 4, 4), false);
  assert.equal(stimulated.get(4, 4, 4), MAT.EMPTY);
  assert.equal(stimulated.energyTypes.filter((type) => type === MAT.PHOT).length, 2);
  assert.ok(Math.abs(stimulated.energyVelocityX[stimulated.index(4, 4, 4)] - 2.7) < 0.001);
  const daughter = stimulated.energyTypes.findIndex((type, index) => type === MAT.PHOT && index !== stimulated.index(4, 4, 4));
  assert.equal(stimulated.energyTemperatures[daughter], materialById(MAT.PHOT).defaultTemp);
  assert.ok(stimulated.air.sampleVoxel(4, 4, 4).pressure <= -15);
});

test("warp displaces matter while charged exotic matter becomes warp", () => {
  const created = new VoxelSimulation(10, 9, 9, 0x2322);
  created.random = () => 0;
  created.set(4, 4, 4, MAT.WARP);
  assert.equal(created.life[created.index(4, 4, 4)], 70);

  const displacement = new VoxelSimulation(10, 9, 9, 0x2323);
  displacement.random = () => 0;
  displacement.set(4, 4, 4, MAT.WARP, 22, 100);
  displacement.set(3, 3, 3, MAT.SAND);
  assert.equal(displacement.updateWarp(displacement.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(displacement.get(4, 4, 4), MAT.SAND);
  assert.equal(displacement.get(3, 3, 3), MAT.WARP);
  assert.equal(displacement.life[displacement.index(3, 3, 3)], 104);
  assert.deepEqual([
    displacement.velocityX[displacement.index(4, 4, 4)],
    displacement.velocityY[displacement.index(4, 4, 4)],
    displacement.velocityZ[displacement.index(4, 4, 4)],
  ], [-1.5, -2, -2]);

  const exotic = new VoxelSimulation(10, 9, 9, 0x2324);
  exotic.set(4, 4, 4, MAT.EXOT, 20, 1000, { tmp: 244, tmp2: 6002 });
  assert.equal(exotic.updateExoticMatter(exotic.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(exotic.get(4, 4, 4), MAT.WARP);
  assert.ok(exotic.life[exotic.index(4, 4, 4)] > 0);

  const mimic = new VoxelSimulation(10, 9, 9, 0x2325);
  mimic.random = () => 0;
  mimic.set(4, 4, 4, MAT.EXOT, 800, 1500, { tmp: 246, tmp2: 80, velocityX: 6, ctype: MAT.PROT });
  mimic.set(5, 4, 4, MAT.SAND, 300, 7, { tmp: 99 });
  assert.equal(mimic.updateExoticMatter(mimic.index(4, 4, 4), 4, 4, 4), true);
  assert.deepEqual([
    mimic.get(4, 4, 4), mimic.temperatures[mimic.index(4, 4, 4)], mimic.life[mimic.index(4, 4, 4)],
    mimic.tmp[mimic.index(4, 4, 4)], mimic.velocityX[mimic.index(4, 4, 4)],
  ], [MAT.SAND, materialById(MAT.SAND).defaultTemp, materialById(MAT.SAND).defaultLife, materialById(MAT.SAND).defaultTmp, 0]);
});

test("charged vibranium discharges into exotic matter, energy and pressure", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x2424);
  sim.random = () => 0;
  sim.set(5, 5, 5, MAT.VIBR, 0, 1, { tmp: 1200 });
  assert.equal(sim.updateVibranium(sim.index(5, 5, 5), 5, 5, 5, MAT.VIBR), true);
  assert.equal(sim.get(5, 5, 5), MAT.EXOT);
  assert.equal(sim.energyTypes.includes(MAT.ELEC), true);
  assert.equal(sim.energyTypes.includes(MAT.PHOT), true);
  assert.equal(sim.types.includes(MAT.BREC), true);
  assert.ok(sim.air.sampleVoxel(5, 5, 5).pressure >= 50);

  const sampledConduction = new VoxelSimulation(12, 10, 10, 0x2425);
  sampledConduction.set(5, 5, 5, MAT.VIBR, 0, 200, { tmp: 0 });
  sampledConduction.set(6, 5, 5, MAT.METL);
  sampledConduction.set(4, 5, 5, MAT.METL);
  const draws = [13 / 0x100000000, 0, 0, 0, 0, 0];
  sampledConduction.random = () => draws.shift() ?? 0;
  sampledConduction.updateVibranium(sampledConduction.index(5, 5, 5), 5, 5, 5, MAT.VIBR);
  assert.equal(sampledConduction.get(6, 5, 5), MAT.SPRK);
  assert.equal(sampledConduction.get(4, 5, 5), MAT.METL);
});

test("electrodes bridge through plasma and Tesla coils launch 3D lightning", () => {
  const electrodes = new VoxelSimulation(14, 10, 10, 0x2525);
  electrodes.random = () => 0;
  electrodes.set(3, 5, 5, MAT.SPRK, 22, 2, { ctype: MAT.ETRD });
  electrodes.set(9, 5, 5, MAT.ETRD);
  electrodes.updateSpark(electrodes.index(3, 5, 5), 3, 5, 5);
  assert.equal(electrodes.get(3, 5, 5), MAT.ETRD);
  assert.equal(electrodes.get(9, 5, 5), MAT.SPRK);
  assert.equal(electrodes.types.includes(MAT.PLSM), true);

  const tesla = new VoxelSimulation(14, 12, 12, 0x2526);
  tesla.random = () => 0;
  tesla.set(6, 6, 6, MAT.SPRK, 220, 3, { ctype: MAT.TESC, tmp: 50 });
  tesla.updateSpark(tesla.index(6, 6, 6), 6, 6, 6);
  assert.equal(tesla.types.includes(MAT.LIGH), true);
  const lightning = tesla.types.findIndex((type) => type === MAT.LIGH);
  assert.ok(tesla.life[lightning] > 0);
});

test("lightning and Tesla brush strength follow the original size-driven creation rules in 3D", () => {
  const lightning = new VoxelSimulation(18, 16, 14, 0x2527);
  assert.equal(lightning.paintSphere(8, 8, 7, 4, MAT.LIGH), 1);
  const bolt = lightning.index(8, 8, 7);
  assert.equal(lightning.types.filter((type) => type === MAT.LIGH).length, 1);
  assert.equal(lightning.life[bolt], 12);
  assert.equal(lightning.tmp2[bolt], 4);
  assert.ok(Math.abs(lightning.temperatures[bolt] - 1526.85) < 1e-3);

  const tesla = new VoxelSimulation(18, 16, 14, 0x2528);
  assert.ok(tesla.paintSphere(8, 8, 7, 2, MAT.TESC) > 1);
  for (let index = 0; index < tesla.size; index += 1) {
    if (tesla.types[index] === MAT.TESC) assert.equal(tesla.tmp[index], 31);
  }
});

test("lightning grows a staged volumetric bolt with a live continuation tip", () => {
  const sim = new VoxelSimulation(36, 24, 24, 0x2529);
  sim.random = () => 0.5;
  sim.set(5, 12, 6, MAT.LIGH, 1800, 12, { tmp: 0, tmp2: 4, tmp3: 25 });
  const origin = sim.index(5, 12, 6);
  sim.updateLightning(origin, 5, 12, 6);
  const bolts = [];
  for (let index = 0; index < sim.size; index += 1) if (sim.types[index] === MAT.LIGH) bolts.push(index);
  assert.ok(bolts.length > 12);
  assert.ok(bolts.some((index) => sim.coords(index)[2] > 6));
  assert.equal(sim.tmp2[origin], 7);
  assert.ok(bolts.some((index) => sim.life[index] < 12 && [0, 2].includes(sim.tmp2[index])));
});

test("lightning applies power-scaled conductor, nuclear, pressure and ambient-heat reactions", () => {
  const sim = new VoxelSimulation(14, 12, 12, 0x2530);
  sim.random = () => 0;
  sim.set(6, 6, 6, MAT.LIGH, 3000, 20, { tmp: 0, tmp2: 1, tmp3: 0 });
  sim.set(7, 6, 6, MAT.METL);
  sim.set(5, 6, 6, MAT.DEUT);
  const source = sim.index(6, 6, 6);
  const airBefore = sim.air.sampleVoxel(6, 6, 6).temperature;
  sim.updateLightning(source, 6, 6, 6);
  assert.equal(sim.get(7, 6, 6), MAT.SPRK);
  assert.equal(sim.get(5, 6, 6), MAT.EMPTY);
  assert.equal(sim.getEnergy(5, 6, 6), MAT.NEUT);
  assert.ok(sim.air.sampleVoxel(6, 6, 6).pressure > 0);
  assert.ok(sim.air.sampleVoxel(6, 6, 6).temperature > airBefore);
  assert.equal(sim.tmp2[source], 0);
});

test("spent lightning segments retain power while counting down before removal", () => {
  const sim = new VoxelSimulation(10, 9, 8, 0x2531);
  sim.set(5, 4, 4, MAT.LIGH, 1200, 8, { tmp: 0, tmp2: 7, tmp3: 0 });
  const bolt = sim.index(5, 4, 4);
  sim.updateLightning(bolt, 5, 4, 4);
  assert.equal(sim.tmp2[bolt], 6);
  assert.equal(sim.life[bolt], 8);
  sim.updateLightning(bolt, 5, 4, 4);
  assert.equal(sim.tmp2[bolt], 5);
  sim.updateLightning(bolt, 5, 4, 4);
  assert.equal(sim.get(5, 4, 4), MAT.EMPTY);
});

test("lightning uses neighbor pressure, permits dry sponge and lets console states above eight fire", () => {
  const ignition = new VoxelSimulation(16, 10, 8, 0x2532);
  ignition.random = () => 0.03;
  ignition.set(7, 5, 4, MAT.LIGH, 1526.85, 12, { tmp: 0, tmp2: 1, tmp3: 0 });
  ignition.set(9, 5, 4, MAT.SPNG, 22, 0);
  ignition.air.pressure[ignition.air.indexForVoxel(7, 5, 4)] = -3;
  ignition.air.pressure[ignition.air.indexForVoxel(9, 5, 4)] = 3;
  ignition.updateLightning(ignition.index(7, 5, 4), 7, 5, 4);
  const sponge = ignition.index(9, 5, 4);
  assert.equal(ignition.types[sponge], MAT.FIRE);
  assert.equal(ignition.life[sponge], 182);

  const consoleState = new VoxelSimulation(24, 12, 10, 0x2533);
  consoleState.random = () => 0;
  consoleState.set(5, 6, 5, MAT.LIGH, 1526.85, 12, { tmp: 0, tmp2: 9, tmp3: 0 });
  const origin = consoleState.index(5, 6, 5);
  consoleState.updateLightning(origin, 5, 6, 5);
  assert.equal(consoleState.tmp2[origin], 7);
  assert.ok(consoleState.types.filter((type) => type === MAT.LIGH).length > 1);
});

test("delay gates count down temperature-defined timing and pulse NSCN", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x2626);
  sim.set(5, 4, 4, MAT.DLAY, 4);
  sim.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.updateDelay(sim.index(5, 4, 4), 5, 4, 4);
  assert.equal(sim.life[sim.index(5, 4, 4)], 4);
  sim.life[sim.index(5, 4, 4)] = 1;
  sim.set(6, 4, 4, MAT.NSCN);
  sim.updateDelay(sim.index(5, 4, 4), 5, 4, 4);
  assert.equal(sim.get(6, 4, 4), MAT.SPRK);
  assert.equal(sim.ctype[sim.index(6, 4, 4)], MAT.NSCN);
});

test("EMP pulses damage activated electronics and nearby metal", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x2727);
  sim.random = () => 0;
  sim.set(5, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.set(6, 4, 4, MAT.METL);
  sim.triggerEmpPulse(1);
  assert.ok([MAT.BREC, MAT.NTCT].includes(sim.get(5, 4, 4)));
  assert.equal(sim.get(6, 4, 4), MAT.BMTL);

  const trigger = new VoxelSimulation(12, 9, 9, 0x2728);
  trigger.random = () => 1;
  trigger.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  trigger.set(5, 4, 4, MAT.EMP);
  trigger.updateSpark(trigger.index(4, 4, 4), 4, 4, 4);
  assert.equal(trigger.life[trigger.index(5, 4, 4)], 220);
});

test("EMP applies binomial heat, secondary metal breakage and Kelvin delay randomization", () => {
  const metal = new VoxelSimulation(12, 10, 9, 0x2630);
  metal.random = () => 0;
  metal.set(5, 5, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  metal.set(6, 5, 4, MAT.METL, 22);
  metal.triggerEmpPulse(2);
  const damaged = metal.index(6, 5, 4);
  assert.equal(metal.types[damaged], MAT.BRMT);
  assert.equal(metal.temperatures[damaged], 7022);

  const delay = new VoxelSimulation(12, 10, 9, 0x2631);
  const draws = [0, 0.5];
  delay.random = () => draws.shift() ?? 1;
  delay.set(5, 5, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  delay.set(6, 5, 4, MAT.DLAY, 80);
  delay.triggerEmpPulse(1);
  assert.ok(Math.abs(delay.temperatures[delay.index(6, 5, 4)] + 145.15) < 1e-3);
});

test("thermistors enforce hot NTC and cold PTC polarity while cooling toward room temperature", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x2828);
  const sender = sim.index(4, 4, 4);
  const receiver = sim.index(5, 4, 4);
  sim.set(4, 4, 4, MAT.NTCT, 120);
  sim.set(5, 4, 4, MAT.NSCN);
  assert.equal(sim.canSparkBetween(MAT.NTCT, MAT.NSCN, sender, receiver), true);
  sim.temperatures[sender] = 20;
  assert.equal(sim.canSparkBetween(MAT.NTCT, MAT.NSCN, sender, receiver), false);
  sim.set(4, 4, 4, MAT.PTCT, 20);
  assert.equal(sim.canSparkBetween(MAT.PTCT, MAT.NSCN, sender, receiver), true);
  sim.temperatures[sender] = 120;
  assert.equal(sim.canSparkBetween(MAT.PTCT, MAT.NSCN, sender, receiver), false);
  sim.updateThermistor(sender);
  assert.equal(sim.temperatures[sender], 117.5);
});

test("liquid crystal charges, fades and propagates its transition through a 3D cluster", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x2829);
  sim.set(4, 4, 4, MAT.LCRY, 22, 0, { tmp: 2 });
  sim.set(5, 5, 5, MAT.LCRY);
  const crystal = sim.index(4, 4, 4);
  sim.updatePoweredElement(crystal, 4, 4, 4, MAT.LCRY);
  assert.equal(sim.life[crystal], 2);
  assert.equal(sim.tmp2[crystal], 2);
  assert.equal(sim.tmp[sim.index(5, 5, 5)], 2);
  for (let tick = 0; tick < 5; tick += 1) sim.updatePoweredElement(crystal, 4, 4, 4, MAT.LCRY);
  assert.equal(sim.life[crystal], 10);
  assert.equal(sim.tmp[crystal], 3);
  sim.tmp[crystal] = 1;
  sim.updatePoweredElement(crystal, 4, 4, 4, MAT.LCRY);
  assert.equal(sim.life[crystal], 8);
  assert.equal(sim.tmp2[crystal], 8);
});

test("powered networks propagate activation and shutdown countdowns in 3D", () => {
  const activate = new VoxelSimulation(12, 9, 9, 0x282a);
  activate.set(4, 4, 4, MAT.PUMP, 0, 10);
  activate.set(5, 5, 5, MAT.PUMP, 0, 0);
  activate.updatePoweredElement(activate.index(4, 4, 4), 4, 4, 4, MAT.PUMP);
  assert.equal(activate.life[activate.index(5, 5, 5)], 10);

  const shutdown = new VoxelSimulation(12, 9, 9, 0x282b);
  shutdown.set(4, 4, 4, MAT.GPMP, 0, 10);
  shutdown.set(5, 5, 5, MAT.GPMP, 0, 5);
  const pump = shutdown.index(4, 4, 4);
  shutdown.updatePoweredElement(pump, 4, 4, 4, MAT.GPMP);
  assert.equal(shutdown.life[pump], 9);
  shutdown.updatePoweredElement(pump, 4, 4, 4, MAT.GPMP);
  assert.equal(shutdown.life[pump], 8);
});

test("pressure pumps relax coarse 3D air cells or deserialize pressure from FILT", () => {
  const relax = new VoxelSimulation(12, 9, 9, 0x282c);
  relax.set(5, 4, 4, MAT.PUMP, 100, 10);
  relax.updatePoweredElement(relax.index(5, 4, 4), 5, 4, 4, MAT.PUMP);
  assert.ok(Math.abs(relax.air.sampleVoxel(5, 4, 4).pressure - 10) < 1e-5);

  const deserialize = new VoxelSimulation(12, 9, 9, 0x282d);
  deserialize.set(5, 4, 4, MAT.PUMP, 0, 10, { tmp: 1 });
  deserialize.set(6, 4, 4, MAT.FILT, 22, 0, { ctype: 0x10000000 + 300 });
  deserialize.updatePoweredElement(deserialize.index(5, 4, 4), 5, 4, 4, MAT.PUMP);
  assert.equal(deserialize.air.sampleVoxel(6, 4, 4).pressure, 44);
});

test("gravity pumps source temperature-scaled mass and heat switches deserialize Kelvin FILT data", () => {
  const gravity = new VoxelSimulation(12, 9, 9, 0x282e);
  gravity.set(5, 4, 4, MAT.GPMP, 50, 10);
  gravity.gravity.rebuild(gravity);
  assert.equal(gravity.gravity.sampleVoxel(5, 4, 4).mass, 10);
  gravity.life[gravity.index(5, 4, 4)] = 9;
  gravity.gravity.rebuild(gravity);
  assert.equal(gravity.gravity.sampleVoxel(5, 4, 4).mass, 0);

  const heat = new VoxelSimulation(12, 9, 9, 0x282f);
  heat.set(5, 4, 4, MAT.HSWC, 0, 10, { tmp: 1 });
  heat.set(6, 4, 4, MAT.FILT, 22, 0, { ctype: 0x10000000 + 373 });
  const heatSwitch = heat.index(5, 4, 4);
  heat.updatePoweredElement(heatSwitch, 5, 4, 4, MAT.HSWC);
  assert.ok(Math.abs(heat.temperatures[heatSwitch] - 99.85) < 1e-5);
  assert.equal(heat.heatInsulatorAt(heatSwitch), false);
  heat.life[heatSwitch] = 9;
  assert.equal(heat.heatInsulatorAt(heatSwitch), true);
});

test("INSL and RSSS block midpoint spark and battery conduction in all three axes", () => {
  for (const [offset, insulator] of [MAT.INSL, MAT.RSSS].entries()) {
    const spark = new VoxelSimulation(10, 9, 9, 0x2830 + offset);
    spark.set(2, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.METL });
    spark.set(3, 3, 3, insulator);
    spark.set(4, 4, 3, MAT.METL);
    spark.updateSpark(spark.index(2, 3, 3), 2, 3, 3);
    assert.equal(spark.get(4, 4, 3), MAT.METL);

    const battery = new VoxelSimulation(10, 9, 9, 0x2840 + offset);
    battery.set(2, 3, 3, MAT.BTRY);
    battery.set(3, 3, 3, insulator);
    battery.set(4, 4, 3, MAT.METL);
    battery.updateBattery(battery.index(2, 3, 3), 2, 3, 3);
    assert.equal(battery.get(4, 4, 3), MAT.METL);
  }

  const control = new VoxelSimulation(10, 9, 9, 0x2850);
  control.set(2, 3, 3, MAT.BTRY);
  control.set(4, 4, 3, MAT.METL);
  control.updateBattery(control.index(2, 3, 3), 2, 3, 3);
  assert.equal(control.get(4, 4, 3), MAT.SPRK);
});

test("midpoint insulation blocks switches and powered-pipe controls but preserves original toggle quirks", () => {
  const switches = new VoxelSimulation(12, 9, 9, 0x2860);
  switches.set(2, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  switches.set(3, 3, 3, MAT.INSL);
  switches.set(4, 4, 3, MAT.SWCH);
  switches.updateSpark(switches.index(2, 3, 3), 2, 3, 3);
  assert.equal(switches.life[switches.index(4, 4, 3)], 0);

  const pipes = new VoxelSimulation(12, 9, 9, 0x2861);
  pipes.set(2, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.NSCN });
  pipes.set(3, 3, 3, MAT.RSSS);
  pipes.set(4, 4, 3, MAT.PPIP);
  pipes.updateSpark(pipes.index(2, 3, 3), 2, 3, 3);
  assert.equal(pipes.tmp[pipes.index(4, 4, 3)] & PIPE_FLAG.PAUSED, 0);

  const legacyToggle = new VoxelSimulation(12, 9, 9, 0x2862);
  legacyToggle.set(2, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  legacyToggle.set(3, 3, 3, MAT.INSL);
  legacyToggle.set(4, 4, 3, MAT.PUMP);
  legacyToggle.updateSpark(legacyToggle.index(2, 3, 3), 2, 3, 3);
  assert.equal(legacyToggle.life[legacyToggle.index(4, 4, 3)], 10);
});

test("insulation blocks delay inputs and outputs without changing their countdown state", () => {
  const input = new VoxelSimulation(12, 9, 9, 0x2870);
  input.set(2, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  input.set(3, 3, 3, MAT.INSL);
  input.set(4, 4, 3, MAT.DLAY, 4);
  input.updateDelay(input.index(4, 4, 3), 4, 4, 3);
  assert.equal(input.life[input.index(4, 4, 3)], 0);

  const output = new VoxelSimulation(12, 9, 9, 0x2871);
  output.set(2, 3, 3, MAT.DLAY, 4, 1);
  output.set(3, 3, 3, MAT.RSSS);
  output.set(4, 4, 3, MAT.NSCN);
  output.updateDelay(output.index(2, 3, 3), 2, 3, 3);
  assert.equal(output.get(4, 4, 3), MAT.NSCN);
  assert.equal(output.life[output.index(2, 3, 3)], 0);
});

test("pressure sensors trigger while midpoint insulation blocks only their conductor output", () => {
  const sim = new VoxelSimulation(12, 9, 9, 0x2880);
  sim.set(2, 3, 3, MAT.PSNS, 4);
  sim.set(3, 3, 3, MAT.INSL);
  sim.set(4, 4, 3, MAT.METL);
  sim.set(2, 4, 3, MAT.METL);
  sim.air.injectVoxel(2, 3, 3, 12);
  const sensor = sim.index(2, 3, 3);
  sim.updateSensor(sensor, 2, 3, 3, MAT.PSNS);
  assert.equal(sim.get(4, 4, 3), MAT.METL);
  assert.equal(sim.get(2, 4, 3), MAT.SPRK);
});

test("electrode arcs respect midpoint insulation before producing plasma", () => {
  for (const [offset, insulator] of [MAT.INSL, MAT.RSSS].entries()) {
    const sim = new VoxelSimulation(12, 9, 9, 0x2890 + offset);
    sim.set(2, 4, 4, MAT.ETRD);
    sim.set(4, 4, 4, insulator);
    sim.set(6, 4, 4, MAT.ETRD);
    assert.equal(sim.updateElectrodeArc(sim.index(2, 4, 4), 2, 4, 4), false);
    assert.equal(sim.get(6, 4, 4), MAT.ETRD);
    assert.equal(sim.types.includes(MAT.PLSM), false);
  }
});

test("quartz only accepts electricity when colder than -100 C or above pressure eight", () => {
  const makeQuartz = (seed, temperature, pressure = 0) => {
    const sim = new VoxelSimulation(10, 9, 9, seed);
    sim.set(4, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
    sim.set(5, 4, 4, MAT.QRTZ, temperature);
    if (pressure) sim.air.injectVoxel(5, 4, 4, pressure);
    sim.updateSpark(sim.index(4, 4, 4), 4, 4, 4);
    return sim;
  };
  assert.equal(makeQuartz(0x28a0, 22).get(5, 4, 4), MAT.QRTZ);
  assert.equal(makeQuartz(0x28a1, -101).get(5, 4, 4), MAT.SPRK);
  assert.equal(makeQuartz(0x28a2, 22, 9).get(5, 4, 4), MAT.SPRK);
});

test("pistons extend a 3D arm, push a stack and retract sticky payloads", () => {
  const sim = new VoxelSimulation(16, 10, 10, 0x2929);
  sim.set(4, 5, 5, MAT.PSTN, 10);
  sim.set(5, 5, 5, MAT.PSTN, 10);
  sim.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.set(6, 5, 5, MAT.SAND);
  sim.updatePiston(sim.index(4, 5, 5), 4, 5, 5);
  assert.equal(sim.get(6, 5, 5), MAT.PSTN);
  assert.equal(sim.get(7, 5, 5), MAT.PSTN);
  assert.equal(sim.get(8, 5, 5), MAT.SAND);
  assert.equal(sim.life[sim.index(6, 5, 5)], 1);

  sim.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.NSCN });
  sim.updatePiston(sim.index(4, 5, 5), 4, 5, 5);
  assert.equal(sim.get(6, 5, 5), MAT.SAND);
  assert.equal(sim.get(7, 5, 5), MAT.EMPTY);
  assert.equal(sim.get(8, 5, 5), MAT.EMPTY);
});

test("piston arm-limit flags choose shortening or an atomic extension abort", () => {
  const make = (flags) => {
    const sim = new VoxelSimulation(14, 10, 10, 0x292a + flags);
    sim.set(4, 5, 5, MAT.PSTN, 10, 0, { tmp2: 1, tmp3: flags });
    sim.set(5, 5, 5, MAT.PSTN, 10);
    sim.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
    sim.set(6, 5, 5, MAT.SAND);
    sim.updatePiston(sim.index(4, 5, 5), 4, 5, 5);
    return sim;
  };
  const shortened = make(0);
  assert.equal(shortened.get(6, 5, 5), MAT.PSTN);
  assert.equal(shortened.get(7, 5, 5), MAT.SAND);
  const cancelled = make(0x02);
  assert.equal(cancelled.get(6, 5, 5), MAT.SAND);
  assert.equal(cancelled.types.filter((type) => type === MAT.PSTN).length, 2);
});

test("piston obstacle flags choose available travel or cancel before moving anything", () => {
  const make = (flags) => {
    const sim = new VoxelSimulation(14, 10, 10, 0x292c + flags);
    sim.set(4, 5, 5, MAT.PSTN, 10, 0, { ctype: MAT.DMND, tmp3: flags });
    sim.set(5, 5, 5, MAT.PSTN, 10);
    sim.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
    sim.set(6, 5, 5, MAT.SAND);
    sim.set(8, 5, 5, MAT.DMND);
    sim.updatePiston(sim.index(4, 5, 5), 4, 5, 5);
    return sim;
  };
  const shortened = make(0);
  assert.equal(shortened.get(6, 5, 5), MAT.PSTN);
  assert.equal(shortened.get(7, 5, 5), MAT.SAND);
  const cancelled = make(0x01);
  assert.equal(cancelled.get(6, 5, 5), MAT.SAND);
  assert.equal(cancelled.get(7, 5, 5), MAT.EMPTY);
});

test("piston retraction flags reject short arms and restore frame branches on obstacles", () => {
  const short = new VoxelSimulation(14, 10, 10, 0x292e);
  short.set(4, 5, 5, MAT.PSTN, 10, 0, { tmp3: 0x08 });
  short.set(5, 5, 5, MAT.PSTN, 10);
  short.set(6, 5, 5, MAT.PSTN, 10, 1);
  short.set(7, 5, 5, MAT.SAND);
  short.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.NSCN });
  short.updatePiston(short.index(4, 5, 5), 4, 5, 5);
  assert.equal(short.get(6, 5, 5), MAT.PSTN);
  assert.equal(short.get(7, 5, 5), MAT.SAND);

  const frame = new VoxelSimulation(14, 12, 10, 0x292f);
  frame.set(4, 5, 5, MAT.PSTN, 10, 0, { ctype: MAT.DMND, tmp3: 0x04 });
  frame.set(5, 5, 5, MAT.PSTN, 10);
  frame.set(6, 5, 5, MAT.PSTN, 10, 1, { decoration: 0xff123456 });
  frame.set(7, 5, 5, MAT.FRME);
  frame.set(7, 6, 5, MAT.FRME);
  frame.set(6, 6, 5, MAT.DMND);
  frame.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.NSCN });
  frame.updatePiston(frame.index(4, 5, 5), 4, 5, 5);
  assert.equal(frame.get(6, 5, 5), MAT.PSTN);
  assert.equal(frame.life[frame.index(6, 5, 5)], 1);
  assert.equal(frame.decorations[frame.index(6, 5, 5)], 0xff123456);
  assert.equal(frame.get(7, 5, 5), MAT.FRME);
  assert.equal(frame.get(7, 6, 5), MAT.FRME);
});

test("a piston arm cannot masquerade as the inactive base that selects direction", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x2930);
  sim.set(4, 5, 5, MAT.PSTN, 10);
  sim.set(5, 5, 5, MAT.PSTN, 10, 1);
  sim.set(4, 4, 5, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  sim.set(6, 5, 5, MAT.SAND);
  sim.updatePiston(sim.index(4, 5, 5), 4, 5, 5);
  assert.equal(sim.get(5, 5, 5), MAT.PSTN);
  assert.equal(sim.life[sim.index(5, 5, 5)], 1);
  assert.equal(sim.get(6, 5, 5), MAT.SAND);
});

test("force rays use every spark, include the configured end cell and respect matter shielding", () => {
  const ray = new VoxelSimulation(14, 10, 10, 0x2a2a);
  ray.set(4, 5, 5, MAT.FRAY, 20, 0, { tmp: 2 });
  ray.set(3, 5, 5, MAT.SPRK, 22, 1, { ctype: MAT.PSCN });
  ray.set(7, 5, 5, MAT.WATR);
  ray.set(4, 4, 5, MAT.SPRK, 22, 2, { ctype: MAT.NSCN });
  ray.set(4, 7, 5, MAT.OIL);
  ray.set(6, 5, 5, MAT.METL);
  ray.setEnergy(6, 5, 5, MAT.PHOT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  ray.updateForceRay(ray.index(4, 5, 5), 4, 5, 5);
  assert.equal(ray.velocityX[ray.index(7, 5, 5)], 2);
  assert.equal(ray.velocityY[ray.index(4, 7, 5)], 2);
  assert.equal(ray.energyVelocityX[ray.index(6, 5, 5)], 0);
});

test("RPEL samples eleven 3D points, filters types, attracts when cold and gives matter priority", () => {
  const repeller = new VoxelSimulation(14, 10, 10, 0x2a2b);
  repeller.set(4, 5, 5, MAT.RPEL, 20, 0, { ctype: MAT.WATR });
  repeller.set(7, 5, 5, MAT.WATR);
  repeller.set(4, 7, 5, MAT.OIL);
  const samples = [13.25 / 21, 10.25 / 21, 10.25 / 21];
  let draw = 0;
  repeller.random = () => samples[draw++ % samples.length];
  repeller.updateRepeller(repeller.index(4, 5, 5), 4, 5, 5);
  assert.equal(repeller.velocityX[repeller.index(7, 5, 5)], 22);
  assert.equal(repeller.velocityY[repeller.index(4, 7, 5)], 0);

  const attraction = new VoxelSimulation(14, 10, 10, 0x2a2c);
  attraction.set(4, 5, 5, MAT.RPEL, -20);
  attraction.set(7, 5, 5, MAT.DUST);
  attraction.setEnergy(7, 5, 5, MAT.PHOT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  draw = 0;
  attraction.random = () => samples[draw++ % samples.length];
  attraction.updateRepeller(attraction.index(4, 5, 5), 4, 5, 5);
  assert.equal(attraction.velocityX[attraction.index(7, 5, 5)], -22);
  assert.equal(attraction.energyVelocityX[attraction.index(7, 5, 5)], 0);
});

test("damage particles fracture canonical materials and emit a pressure wave", () => {
  const sim = new VoxelSimulation(14, 12, 12, 0x2b2b);
  sim.set(6, 6, 6, MAT.DMG);
  sim.set(7, 6, 6, MAT.STNE);
  sim.set(6, 8, 6, MAT.BMTL);
  assert.equal(sim.updateDamageParticle(sim.index(6, 6, 6), 6, 6, 6), true);
  assert.equal(sim.get(6, 6, 6), MAT.EMPTY);
  assert.equal(sim.get(6, 8, 6), MAT.BRMT);
  assert.ok(sim.air.sampleVoxel(6, 6, 6).pressure > 0);
  const wave = sim.air.sampleVoxel(6, 8, 6);
  assert.ok(wave.pressure >= 1);
  assert.ok(wave.velocityY > 0);

  const shell = new VoxelSimulation(64, 20, 20, 0x2b2c);
  shell.set(30, 10, 10, MAT.DMG);
  shell.set(31, 10, 10, MAT.STNE);
  shell.set(55, 15, 10, MAT.WOOD);
  shell.updateDamageParticle(shell.index(30, 10, 10), 30, 10, 10);
  assert.equal(shell.get(55, 15, 10), MAT.SAWD);
});

test("gravity bombs stick on contact then reverse from attraction to repulsion", () => {
  const sim = new VoxelSimulation(32, 12, 12, 0x2c2c);
  sim.set(16, 6, 6, MAT.GBMB);
  sim.set(17, 6, 6, MAT.STNE);
  sim.updateGravityBomb(sim.index(16, 6, 6), 16, 6, 6);
  assert.equal(sim.life[sim.index(16, 6, 6)], 60);
  sim.gravity.step(sim);
  assert.ok(sim.gravity.sampleVoxel(2, 6, 6).forceX > 0);
  sim.life[sim.index(16, 6, 6)] = 10;
  sim.gravity.step(sim);
  assert.ok(sim.gravity.sampleVoxel(2, 6, 6).forceX < 0);
});

test("temperature-matched 3D portals preserve full matter particle state", () => {
  const sim = new VoxelSimulation(16, 12, 12, 0x2d2d);
  sim.set(4, 6, 6, MAT.PRTI, 22);
  sim.set(5, 6, 6, MAT.WATR, 64, 23, { ctype: MAT.SLTW, tmp: 44, tmp2: 55, velocityX: 1.5 });
  sim.updatePortal(sim.index(4, 6, 6), 4, 6, 6, MAT.PRTI);
  assert.equal(sim.get(5, 6, 6), MAT.EMPTY);
  assert.equal(sim.serializePortalQueues().flatMap((entry) => entry[2]).length, 1);

  sim.set(11, 6, 6, MAT.PRTO, 22);
  sim.updatePortal(sim.index(11, 6, 6), 11, 6, 6, MAT.PRTO);
  const emitted = sim.types.findIndex((type) => type === MAT.WATR);
  assert.notEqual(emitted, -1);
  assert.equal(sim.temperatures[emitted], 64);
  assert.equal(sim.life[emitted], 23);
  assert.equal(sim.ctype[emitted], MAT.SLTW);
  assert.equal(sim.tmp[emitted], 44);
  assert.equal(sim.tmp2[emitted], 55);
  assert.equal(sim.velocityX[emitted], 1.5);
});

test("portals queue and emit independent energy without displacing matter", () => {
  const sim = new VoxelSimulation(16, 12, 12, 0x2e2e);
  sim.set(4, 6, 6, MAT.PRTI, 122);
  sim.setEnergy(5, 6, 6, MAT.PHOT, 911, 91, { ctype: 0x15555aaa, tmp3: 77, velocityX: -2 });
  sim.updatePortal(sim.index(4, 6, 6), 4, 6, 6, MAT.PRTI);
  assert.equal(sim.getEnergy(5, 6, 6), MAT.EMPTY);
  sim.set(11, 6, 6, MAT.PRTO, 122);
  sim.updatePortal(sim.index(11, 6, 6), 11, 6, 6, MAT.PRTO);
  const emitted = sim.energyTypes.findIndex((type) => type === MAT.PHOT);
  assert.notEqual(emitted, -1);
  assert.equal(sim.energyTemperatures[emitted], 911);
  assert.equal(sim.energyLife[emitted], 91);
  assert.equal(sim.energyCtype[emitted], 0x15555aaa);
  assert.equal(sim.energyTmp3[emitted], 77);
  assert.equal(sim.energyVelocityX[emitted], -2);
});

test("fireworks launch colorful 3D ember bursts with persistent velocity", () => {
  const sim = new VoxelSimulation(14, 14, 14, 0x2f2f);
  sim.random = () => 0.5;
  sim.set(7, 7, 7, MAT.FIRW, 22, 0, { tmp: 2, velocityY: 3 });
  assert.equal(sim.updateFirework(sim.index(7, 7, 7), 7, 7, 7, MAT.FIRW), true);
  assert.equal(sim.get(7, 7, 7), MAT.EMPTY);
  assert.equal(sim.types.filter((type) => type === MAT.EMBR).length, 40);
  const ember = sim.types.findIndex((type) => type === MAT.EMBR);
  assert.ok(sim.ctype[ember] > 0xff);
  assert.ok(Math.hypot(sim.velocityX[ember], sim.velocityY[ember], sim.velocityZ[ember]) > 1);
  assert.ok(sim.air.sampleVoxel(7, 7, 7).pressure >= 8);
  assert.equal(sim.air.sampleVoxel(7, 7, 7).temperature, 22);

  const launch = new VoxelSimulation(12, 12, 12, 0x2f30);
  launch.random = () => 0;
  launch.set(5, 5, 5, MAT.FIRW);
  launch.set(6, 5, 5, MAT.FIRE, 900, 20);
  launch.updateFirework(launch.index(5, 5, 5), 5, 5, 5, MAT.FIRW);
  assert.equal(launch.life[launch.index(5, 5, 5)], 20);
  assert.equal(launch.velocityY[launch.index(5, 5, 5)], 8);

  const custom = new VoxelSimulation(12, 12, 12, 0x2f31);
  custom.gravityMode = 3;
  custom.customGravity = [1, 0, 0];
  custom.random = () => 0;
  custom.set(5, 5, 5, MAT.FIRW);
  custom.set(5, 6, 5, MAT.PLSM, 3000, 20);
  custom.updateFirework(custom.index(5, 5, 5), 5, 5, 5, MAT.FIRW);
  assert.equal(custom.velocityX[custom.index(5, 5, 5)], -8);

  const obstructed = new VoxelSimulation(12, 12, 12, 0x2f32);
  obstructed.random = () => 0;
  obstructed.set(5, 5, 5, MAT.FWRK, 22, 0, { ctype: MAT.DUST });
  obstructed.set(5, 6, 5, MAT.STNE);
  obstructed.updateFirework(obstructed.index(5, 5, 5), 5, 5, 5, MAT.FWRK);
  assert.equal(obstructed.life[obstructed.index(5, 5, 5)], 0);
});

test("sparked shields upgrade and grow a protective 3D shell", () => {
  const sim = new VoxelSimulation(12, 12, 12, 0x3031);
  sim.random = () => 0;
  sim.set(5, 5, 5, MAT.SHLD1);
  sim.set(6, 5, 5, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  assert.equal(sim.updateShield(sim.index(5, 5, 5), 5, 5, 5, MAT.SHLD1), false);
  assert.equal(sim.get(5, 5, 5), MAT.SHLD2);
  assert.ok(sim.types.filter((type) => type === MAT.SHLD1).length > 1);
  for (let index = 0; index < sim.size; index += 1) {
    if (sim.types[index] === MAT.SHLD1) assert.equal(sim.life[index], 0);
  }
});

test("all four shield levels retain their distinct growth and recovery programs", () => {
  const levelTwo = new VoxelSimulation(11, 11, 11, 0x3032);
  levelTwo.set(5, 5, 5, MAT.SHLD2, 22, 5);
  levelTwo.updateShield(levelTwo.index(5, 5, 5), 5, 5, 5, MAT.SHLD2);
  assert.equal(levelTwo.types.filter((type) => type === MAT.SHLD1).length, 26);
  for (let index = 0; index < levelTwo.size; index += 1) {
    if (levelTwo.types[index] === MAT.SHLD1) assert.equal(levelTwo.life[index], 0);
  }

  const recoverOne = new VoxelSimulation(11, 11, 11, 0x3033);
  recoverOne.random = () => 0;
  recoverOne.set(5, 5, 5, MAT.SHLD1, 77, 0, { tmp: 9, decoration: 0xff123456 });
  recoverOne.set(4, 4, 4, MAT.SHLD3);
  recoverOne.updateShield(recoverOne.index(5, 5, 5), 5, 5, 5, MAT.SHLD1);
  const recoveredOne = recoverOne.index(5, 5, 5);
  assert.equal(recoverOne.types[recoveredOne], MAT.SHLD2);
  assert.equal(recoverOne.life[recoveredOne], 7);
  assert.equal(recoverOne.temperatures[recoveredOne], 77);
  assert.equal(recoverOne.tmp[recoveredOne], 9);
  assert.equal(recoverOne.decorations[recoveredOne], 0xff123456);

  const recoverTwo = new VoxelSimulation(11, 11, 11, 0x3034);
  recoverTwo.random = () => 0;
  recoverTwo.set(5, 5, 5, MAT.SHLD2);
  recoverTwo.set(4, 4, 4, MAT.SHLD4);
  recoverTwo.updateShield(recoverTwo.index(5, 5, 5), 5, 5, 5, MAT.SHLD2);
  assert.equal(recoverTwo.get(5, 5, 5), MAT.SHLD3);
  assert.equal(recoverTwo.life[recoverTwo.index(5, 5, 5)], 7);

  const spontaneousThree = new VoxelSimulation(11, 11, 11, 0x3035);
  spontaneousThree.random = () => 0;
  spontaneousThree.set(5, 5, 5, MAT.SHLD3);
  spontaneousThree.updateShield(spontaneousThree.index(5, 5, 5), 5, 5, 5, MAT.SHLD3);
  assert.equal(spontaneousThree.get(5, 5, 5), MAT.SHLD2);
  assert.equal(spontaneousThree.types.filter((type) => type === MAT.SHLD1).length, 26);
  for (let index = 0; index < spontaneousThree.size; index += 1) {
    if (spontaneousThree.types[index] === MAT.SHLD1) assert.equal(spontaneousThree.life[index], 7);
  }

  const spontaneousFour = new VoxelSimulation(11, 11, 11, 0x3036);
  spontaneousFour.random = () => 0;
  spontaneousFour.set(5, 5, 5, MAT.SHLD4);
  spontaneousFour.updateShield(spontaneousFour.index(5, 5, 5), 5, 5, 5, MAT.SHLD4);
  assert.equal(spontaneousFour.get(5, 5, 5), MAT.SHLD2);
  assert.equal(spontaneousFour.types.filter((type) => type === MAT.SHLD1).length, 26);
});

test("high shields promote neighboring shell cells without erasing particle state", () => {
  const levelThree = new VoxelSimulation(11, 11, 11, 0x3037);
  levelThree.random = () => 0.5;
  levelThree.set(5, 5, 5, MAT.SHLD3, 22, 5);
  levelThree.set(6, 5, 5, MAT.SHLD1, 88, 2, { ctype: MAT.GOLD, tmp: 6, decoration: 0xffabcdef });
  levelThree.updateShield(levelThree.index(5, 5, 5), 5, 5, 5, MAT.SHLD3);
  const promotedTwo = levelThree.index(6, 5, 5);
  assert.equal(levelThree.types[promotedTwo], MAT.SHLD2);
  assert.equal(levelThree.life[promotedTwo], 7);
  assert.equal(levelThree.temperatures[promotedTwo], 88);
  assert.equal(levelThree.ctype[promotedTwo], MAT.GOLD);
  assert.equal(levelThree.tmp[promotedTwo], 6);
  assert.equal(levelThree.decorations[promotedTwo], 0xffabcdef);

  const levelFour = new VoxelSimulation(11, 11, 11, 0x3038);
  levelFour.random = () => 0.5;
  levelFour.set(5, 5, 5, MAT.SHLD4, 22, 5);
  levelFour.set(6, 5, 5, MAT.SHLD2, 91, 2, { tmp2: 12, decoration: 0xff112233 });
  levelFour.updateShield(levelFour.index(5, 5, 5), 5, 5, 5, MAT.SHLD4);
  const promotedThree = levelFour.index(6, 5, 5);
  assert.equal(levelFour.types[promotedThree], MAT.SHLD3);
  assert.equal(levelFour.life[promotedThree], 7);
  assert.equal(levelFour.temperatures[promotedThree], 91);
  assert.equal(levelFour.tmp2[promotedThree], 12);
  assert.equal(levelFour.decorations[promotedThree], 0xff112233);
});

test("rime and fog exchange through sparks and solid-surface deposition", () => {
  const rime = new VoxelSimulation(10, 9, 9, 0x3131);
  rime.random = () => 0;
  rime.set(4, 4, 4, MAT.RIME);
  rime.set(5, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  assert.equal(rime.updateFogRime(rime.index(4, 4, 4), 4, 4, 4, MAT.RIME), false);
  assert.equal(rime.get(4, 4, 4), MAT.FOG);
  assert.ok(rime.life[rime.index(4, 4, 4)] >= 60);

  const fog = new VoxelSimulation(10, 9, 9, 0x3132);
  fog.random = () => 0;
  fog.set(4, 4, 4, MAT.FOG);
  fog.set(5, 4, 4, MAT.METL);
  fog.updateFogRime(fog.index(4, 4, 4), 4, 4, 4, MAT.FOG);
  assert.equal(fog.get(4, 4, 4), MAT.RIME);
});

test("fog and rime preserve carried state and continue all neighbor reactions", () => {
  const rime = new VoxelSimulation(10, 9, 9, 0x3133);
  rime.random = () => 0;
  rime.set(4, 4, 4, MAT.RIME, -30, 0, {
    ctype: MAT.DSTW, tmp: 4, tmp2: 8, velocityZ: 1.5, decoration: 0xff123456,
  });
  rime.set(3, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  rime.updateFogRime(rime.index(4, 4, 4), 4, 4, 4, MAT.RIME);
  const rimeIndex = rime.index(4, 4, 4);
  assert.equal(rime.types[rimeIndex], MAT.FOG);
  assert.equal(rime.life[rimeIndex], 60);
  assert.equal(rime.ctype[rimeIndex], MAT.DSTW);
  assert.equal(rime.tmp[rimeIndex], 4);
  assert.equal(rime.tmp2[rimeIndex], 8);
  assert.equal(rime.velocityZ[rimeIndex], 1.5);
  assert.equal(rime.decorations[rimeIndex], 0xff123456);

  const deposition = new VoxelSimulation(10, 9, 9, 0x3134);
  deposition.random = () => 0;
  deposition.set(4, 4, 4, MAT.FOG, -30, 0, {
    ctype: MAT.GOLD, tmp: 2, tmp2: 7, decoration: 0xff654321,
  });
  deposition.set(3, 3, 3, MAT.METL);
  deposition.set(4, 3, 3, MAT.GAS);
  deposition.updateFogRime(deposition.index(4, 4, 4), 4, 4, 4, MAT.FOG);
  const depositionIndex = deposition.index(4, 4, 4);
  assert.equal(deposition.types[depositionIndex], MAT.RIME);
  assert.equal(deposition.ctype[depositionIndex], MAT.GOLD);
  assert.equal(deposition.tmp[depositionIndex], 3);
  assert.equal(deposition.tmp2[depositionIndex], 7);
  assert.equal(deposition.decorations[depositionIndex], 0xff654321);
  assert.equal(deposition.get(4, 3, 3), MAT.EMPTY);

  const sparks = new VoxelSimulation(10, 9, 9, 0x3135);
  sparks.random = () => 0.999999;
  sparks.set(4, 4, 4, MAT.FOG, -30, 65530);
  sparks.set(3, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sparks.set(4, 3, 3, MAT.SPRK, 22, 3, { ctype: MAT.METL });
  sparks.updateFogRime(sparks.index(4, 4, 4), 4, 4, 4, MAT.FOG);
  assert.equal(sparks.life[sparks.index(4, 4, 4)], 65568);
});

test("filters implement upstream wavelength modes and pressure opens invisible matter", () => {
  const filter = new VoxelSimulation(10, 9, 9, 0x3232);
  const index = filter.index(4, 4, 4);
  filter.set(4, 4, 4, MAT.FILT, 22, 0, { ctype: 0x0000ff00, tmp: 2 });
  assert.equal(filter.filterWavelength(index, 0x000000ff), 0x0000ffff);
  filter.tmp[index] = 8;
  assert.equal(filter.filterWavelength(index, 0x000000ff), (~0x000000ff) & 0x3fffffff);

  const invisible = new VoxelSimulation(10, 9, 9, 0x3233);
  invisible.set(5, 4, 4, MAT.INVIS);
  invisible.air.injectVoxel(5, 4, 4, 8);
  invisible.updateInvisible(invisible.index(5, 4, 4), 5, 4, 4);
  assert.equal(invisible.tmp2[invisible.index(5, 4, 4)], 1);
  invisible.set(4, 4, 4, MAT.SAND);
  assert.equal(invisible.tryMoveThroughInvisible(invisible.index(4, 4, 4), 4, 4, 4, 5, 4, 4), true);
  assert.equal(invisible.get(5, 4, 4), MAT.INVIS);
  assert.equal(invisible.get(6, 4, 4), MAT.SAND);
});

test("gel absorbs water, glow reacts with gel, and bizarre matter paints decoration", () => {
  const gel = new VoxelSimulation(10, 9, 9, 0x3333);
  gel.random = () => 0;
  gel.set(4, 4, 4, MAT.GEL);
  gel.set(5, 4, 4, MAT.WATR);
  gel.updateGel(gel.index(4, 4, 4), 4, 4, 4);
  assert.equal(gel.get(5, 4, 4), MAT.EMPTY);
  assert.equal(gel.tmp[gel.index(4, 4, 4)], 1);

  const glow = new VoxelSimulation(10, 9, 9, 0x3334);
  glow.set(4, 4, 4, MAT.GLOW);
  glow.set(5, 4, 4, MAT.GEL);
  assert.equal(glow.updateGlow(glow.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(glow.get(4, 4, 4), MAT.EMPTY);
  assert.equal(glow.get(5, 4, 4), MAT.RSST);

  const bizarre = new VoxelSimulation(10, 9, 9, 0x3335);
  bizarre.set(4, 4, 4, MAT.BIZR, 22, 0, { decoration: 0xffff0044 });
  bizarre.set(5, 4, 4, MAT.STNE);
  bizarre.updateBizarre(bizarre.index(4, 4, 4), 4, 4, 4);
  assert.notEqual(bizarre.decorations[bizarre.index(5, 4, 4)], 0);
});

test("gel absorbs paste and base water while applying saturation-scaled 3D adhesion", () => {
  const paste = new VoxelSimulation(11, 11, 11, 0x33351);
  paste.random = () => 0;
  paste.set(5, 5, 5, MAT.GEL, 20, 0, { tmp: 0 });
  paste.set(6, 5, 5, MAT.PSTE, 70, 31, { tmp: 9, decoration: 0xff123456 });
  paste.updateGel(paste.index(5, 5, 5), 5, 5, 5);
  assert.equal(paste.get(6, 5, 5), MAT.CLST);
  assert.equal(paste.tmp[paste.index(5, 5, 5)], 1);
  assert.equal(paste.temperatures[paste.index(6, 5, 5)], materialById(MAT.CLST).defaultTemp);
  assert.equal(paste.life[paste.index(6, 5, 5)], materialById(MAT.CLST).defaultLife);

  const base = new VoxelSimulation(11, 11, 11, 0x33352);
  base.set(5, 5, 5, MAT.GEL, 20, 0, { tmp: 5 });
  base.set(6, 5, 5, MAT.BASE, 22, 10);
  base.updateGel(base.index(5, 5, 5), 5, 5, 5);
  assert.equal(base.tmp[base.index(5, 5, 5)], 4);
  assert.equal(base.life[base.index(6, 5, 5)], 9);

  const adhesion = new VoxelSimulation(11, 11, 11, 0x33353);
  adhesion.set(5, 5, 5, MAT.GEL, 20, 0, { tmp: 0 });
  adhesion.set(7, 5, 5, MAT.DMND);
  adhesion.updateGel(adhesion.index(5, 5, 5), 5, 5, 5);
  assert.ok(adhesion.velocityX[adhesion.index(5, 5, 5)] > 0.3);
  assert.equal(adhesion.velocityY[adhesion.index(5, 5, 5)], 0);
  assert.equal(adhesion.velocityZ[adhesion.index(5, 5, 5)], 0);
});

test("glow preserves reaction products and samples signed 3D field sums", () => {
  const gel = new VoxelSimulation(10, 9, 9, 0x3336);
  gel.set(4, 4, 4, MAT.GLOW);
  gel.set(5, 4, 4, MAT.GEL, 77, 29, {
    ctype: MAT.GOLD, tmp: 8, tmp2: 6, velocityZ: 1.5, decoration: 0xff123456,
  });
  gel.updateGlow(gel.index(4, 4, 4), 4, 4, 4);
  const gelIndex = gel.index(5, 4, 4);
  assert.equal(gel.types[gelIndex], MAT.RSST);
  assert.equal(gel.temperatures[gelIndex], 77);
  assert.equal(gel.life[gelIndex], 29);
  assert.equal(gel.ctype[gelIndex], MAT.GOLD);
  assert.equal(gel.tmp[gelIndex], 0);
  assert.equal(gel.tmp2[gelIndex], 6);
  assert.equal(gel.velocityZ[gelIndex], 1.5);
  assert.equal(gel.decorations[gelIndex], 0xff123456);

  const water = new VoxelSimulation(10, 9, 9, 0x3337);
  water.random = () => 0;
  water.set(4, 4, 4, MAT.GLOW);
  water.set(5, 4, 4, MAT.WATR, 61, 35, { tmp: 9, decoration: 0xff654321 });
  water.updateGlow(water.index(4, 4, 4), 4, 4, 4);
  const waterIndex = water.index(5, 4, 4);
  assert.equal(water.types[waterIndex], MAT.DEUT);
  assert.equal(water.temperatures[waterIndex], 61);
  assert.equal(water.life[waterIndex], 10);
  assert.equal(water.tmp[waterIndex], 9);
  assert.equal(water.decorations[waterIndex], 0xff654321);

  const field = new VoxelSimulation(10, 9, 9, 0x3338);
  field.set(4, 4, 4, MAT.GLOW, 42, 0, { velocityX: -1, velocityY: 1, velocityZ: -0.5 });
  const airIndex = field.air.indexForVoxel(4, 4, 4);
  field.air.pressure[airIndex] = 1.5;
  field.air.velocityX[airIndex] = 1;
  field.air.velocityY[airIndex] = -1;
  field.air.velocityZ[airIndex] = 2;
  field.updateGlow(field.index(4, 4, 4), 4, 4, 4);
  assert.equal(field.ctype[field.index(4, 4, 4)], 24);
  assert.equal(field.tmp[field.index(4, 4, 4)], 64);
});

test("bizarre matter uses exact decoration convergence and default spectra in every phase", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x3339);
  sim.set(4, 4, 4, MAT.BIZR, 22, 0, { decoration: 0xffff0044 });
  sim.set(5, 4, 4, MAT.STNE);
  sim.updateBizarre(sim.index(4, 4, 4), 4, 4, 4);
  assert.equal(sim.decorations[sim.index(5, 4, 4)], 0x0d0d0004);
  sim.set(3, 4, 4, MAT.BIZRG);
  sim.set(6, 4, 4, MAT.BIZRS);
  assert.equal(sim.ctype[sim.index(4, 4, 4)], 0x47ffff);
  assert.equal(sim.ctype[sim.index(3, 4, 4)], 0x47ffff);
  assert.equal(sim.ctype[sim.index(6, 4, 4)], 0x47ffff);
});

test("invisible matter uses strict symmetric pressure resistance", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x3340);
  sim.set(4, 4, 4, MAT.INVIS);
  const index = sim.index(4, 4, 4);
  const airIndex = sim.air.indexForVoxel(4, 4, 4);
  sim.air.pressure[airIndex] = 4;
  sim.updateInvisible(index, 4, 4, 4);
  assert.equal(sim.tmp2[index], 0);
  sim.air.pressure[airIndex] = 4.01;
  sim.updateInvisible(index, 4, 4, 4);
  assert.equal(sim.tmp2[index], 1);
  sim.tmp[index] = 6;
  sim.air.pressure[airIndex] = -6;
  sim.updateInvisible(index, 4, 4, 4);
  assert.equal(sim.tmp2[index], 0);
  sim.air.pressure[airIndex] = -7;
  sim.updateInvisible(index, 4, 4, 4);
  assert.equal(sim.tmp2[index], 1);
});

test("lithium reacts with water and stores then discharges electrical energy", () => {
  const chemistry = new VoxelSimulation(10, 9, 9, 0x3434);
  chemistry.set(4, 4, 4, MAT.LITH, 22);
  chemistry.set(5, 4, 4, MAT.WATR);
  chemistry.updateLithium(chemistry.index(4, 4, 4), 4, 4, 4);
  assert.equal(chemistry.get(5, 4, 4), MAT.H2);
  assert.equal(chemistry.tmp[chemistry.index(4, 4, 4)], 1);
  assert.ok(chemistry.temperatures[chemistry.index(4, 4, 4)] > 22);

  const battery = new VoxelSimulation(10, 9, 9, 0x3435);
  battery.set(4, 4, 4, MAT.LITH);
  battery.set(3, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  battery.updateLithium(battery.index(4, 4, 4), 4, 4, 4);
  assert.equal(battery.ctype[battery.index(4, 4, 4)], 1);
  battery.life[battery.index(4, 4, 4)] = 0;
  battery.set(3, 4, 4, MAT.EMPTY);
  battery.set(5, 4, 4, MAT.NSCN);
  battery.updateLithium(battery.index(4, 4, 4), 4, 4, 4);
  assert.equal(battery.get(5, 4, 4), MAT.SPRK);
  assert.equal(battery.ctype[battery.index(4, 4, 4)], 0);
});

test("lithium preserves water state, emits fire and removes the old invented photon path", () => {
  const cold = new VoxelSimulation(11, 11, 11, 0x3436);
  cold.random = () => 0.5;
  cold.set(5, 5, 5, MAT.LITH, 22, 0, { ctype: 2 });
  cold.set(6, 5, 5, MAT.WATR, 48, 37, { tmp: 7, tmp2: 4, decoration: 0xff123456 });
  cold.updateLithium(cold.index(5, 5, 5), 5, 5, 5);
  const coldWater = cold.index(6, 5, 5);
  assert.equal(cold.types[coldWater], MAT.H2);
  assert.equal(cold.temperatures[coldWater], 48);
  assert.equal(cold.life[coldWater], 37);
  assert.equal(cold.tmp[coldWater], 7);
  assert.equal(cold.tmp2[coldWater], 4);
  assert.equal(cold.decorations[coldWater], 0xff123456);
  assert.ok(Math.abs(cold.temperatures[cold.index(5, 5, 5)] - 48.365) < 0.01);

  const steam = new VoxelSimulation(11, 11, 11, 0x3437);
  steam.random = () => 0.5;
  steam.set(5, 5, 5, MAT.LITH, 170, 1017);
  steam.set(6, 5, 5, MAT.WATR, 20, 41, { tmp: 11, decoration: 0xff654321 });
  steam.updateLithium(steam.index(5, 5, 5), 5, 5, 5);
  const steamIndex = steam.index(6, 5, 5);
  assert.equal(steam.types[steamIndex], MAT.WTRV);
  assert.ok(Math.abs(steam.temperatures[steamIndex] - 166.85) < 0.01);
  assert.equal(steam.life[steamIndex], 41);
  assert.equal(steam.tmp[steamIndex], 11);
  assert.equal(steam.decorations[steamIndex], 0xff654321);

  const burning = new VoxelSimulation(11, 11, 11, 0x3438);
  burning.random = () => 0;
  burning.set(5, 5, 5, MAT.LITH, 170, 1013);
  burning.updateLithium(burning.index(5, 5, 5), 5, 5, 5);
  assert.ok(burning.types.some((type) => type === MAT.FIRE));
  assert.equal(burning.energyTypes.some((type) => type === MAT.PHOT), false);
});

test("lithium respects battery insulation and preserves both plasma reactants", () => {
  const charge = new VoxelSimulation(12, 10, 10, 0x3439);
  charge.set(4, 4, 4, MAT.LITH);
  charge.set(5, 4, 4, MAT.INSL);
  charge.set(6, 4, 4, MAT.SPRK, 22, 3, { ctype: MAT.PSCN });
  charge.updateLithium(charge.index(4, 4, 4), 4, 4, 4);
  assert.equal(charge.ctype[charge.index(4, 4, 4)], 0);

  const discharge = new VoxelSimulation(12, 10, 10, 0x3440);
  discharge.set(4, 4, 4, MAT.LITH, 22, 0, { ctype: 4 });
  discharge.set(5, 4, 4, MAT.RSSS);
  discharge.set(6, 4, 4, MAT.NSCN);
  discharge.updateLithium(discharge.index(4, 4, 4), 4, 4, 4);
  assert.equal(discharge.get(6, 4, 4), MAT.NSCN);
  assert.equal(discharge.ctype[discharge.index(4, 4, 4)], 4);

  const oxygen = new VoxelSimulation(12, 10, 10, 0x3441);
  oxygen.random = () => 0;
  oxygen.set(4, 4, 4, MAT.LITH, 170, 1013, { ctype: 12, tmp: 4, decoration: 0xff102030 });
  oxygen.set(5, 4, 4, MAT.O2, 61, 27, { tmp: 8, tmp2: 3, decoration: 0xff405060 });
  const ambientBefore = oxygen.air.sampleVoxel(4, 4, 4).temperature;
  oxygen.updateLithium(oxygen.index(4, 4, 4), 4, 4, 4);
  const source = oxygen.index(4, 4, 4);
  const target = oxygen.index(5, 4, 4);
  assert.equal(oxygen.types[source], MAT.PLSM);
  assert.equal(oxygen.types[target], MAT.PLSM);
  assert.equal(oxygen.temperatures[source], 170);
  assert.equal(oxygen.temperatures[target], 61);
  assert.equal(oxygen.life[source], 1013);
  assert.equal(oxygen.life[target], 27);
  assert.equal(oxygen.tmp[source], 4);
  assert.equal(oxygen.tmp[target], 8);
  assert.equal(oxygen.tmp2[target], 3);
  assert.equal(oxygen.decorations[source], 0xff102030);
  assert.equal(oxygen.decorations[target], 0xff405060);
  assert.equal(oxygen.air.sampleVoxel(4, 4, 4).pressure, 4);
  assert.equal(oxygen.air.sampleVoxel(4, 4, 4).temperature, ambientBefore);
});

test("lithium randomly trades charge, propagates overcharge and melts to the correct product", () => {
  const trade = new VoxelSimulation(12, 12, 12, 0x3442);
  trade.random = () => 0.999999;
  trade.set(5, 5, 5, MAT.LITH, 22, 0, { ctype: 99 });
  trade.set(8, 8, 8, MAT.LITH, 22, 1020, { ctype: 0 });
  trade.updateLithium(trade.index(5, 5, 5), 5, 5, 5);
  assert.equal(trade.life[trade.index(5, 5, 5)], 1024);
  assert.equal(trade.ctype[trade.index(5, 5, 5)], 49);
  assert.equal(trade.ctype[trade.index(8, 8, 8)], 50);

  const lithiumLava = new VoxelSimulation(10, 9, 9, 0x3443);
  lithiumLava.set(4, 4, 4, MAT.LITH, 100, 1000, {
    ctype: 25, tmp2: 2, velocityX: 1.25, decoration: 0xff112233,
  });
  lithiumLava.updateLithium(lithiumLava.index(4, 4, 4), 4, 4, 4);
  const lithiumIndex = lithiumLava.index(4, 4, 4);
  assert.equal(lithiumLava.types[lithiumIndex], MAT.LAVA);
  assert.equal(lithiumLava.ctype[lithiumIndex], MAT.LITH);
  assert.ok(Math.abs(lithiumLava.temperatures[lithiumIndex] - 476.85) < 0.01);
  assert.equal(lithiumLava.life[lithiumIndex], 0);
  assert.equal(lithiumLava.velocityX[lithiumIndex], 1.25);
  assert.equal(lithiumLava.decorations[lithiumIndex], 0xff112233);

  const glassLava = new VoxelSimulation(10, 9, 9, 0x3444);
  glassLava.set(4, 4, 4, MAT.LITH, 100, 1000, { ctype: 25, tmp2: 3 });
  glassLava.updateLithium(glassLava.index(4, 4, 4), 4, 4, 4);
  const glassIndex = glassLava.index(4, 4, 4);
  assert.equal(glassLava.types[glassIndex], MAT.LAVA);
  assert.equal(glassLava.ctype[glassIndex], MAT.GLAS);
  assert.ok(Math.abs(glassLava.temperatures[glassIndex] - 1976.85) < 0.01);
});

test("sponge absorbs water and mercury contracts or expands with temperature", () => {
  const sponge = new VoxelSimulation(10, 9, 9, 0x3535);
  sponge.random = () => 0;
  sponge.set(4, 4, 4, MAT.SPNG, 22);
  sponge.set(5, 4, 4, MAT.WATR);
  sponge.updateSponge(sponge.index(4, 4, 4), 4, 4, 4);
  assert.equal(sponge.get(5, 4, 4), MAT.EMPTY);
  assert.equal(sponge.life[sponge.index(4, 4, 4)], 1);

  const mercury = new VoxelSimulation(10, 9, 9, 0x3536);
  mercury.random = () => 0;
  mercury.set(4, 4, 4, MAT.MERC, -200, 0, { tmp: 10 });
  mercury.set(5, 4, 4, MAT.MERC, -200, 0, { tmp: 8 });
  mercury.updateMercury(mercury.index(4, 4, 4), 4, 4, 4);
  assert.equal(mercury.get(5, 4, 4), MAT.EMPTY);
  assert.ok(mercury.tmp[mercury.index(4, 4, 4)] >= 19);
});

test("sponge exhausts stored water, boils it around fire and uses randomized diffusion", () => {
  const paste = new VoxelSimulation(11, 11, 11, 0x3537);
  paste.random = () => 0;
  paste.set(5, 5, 5, MAT.SPNG);
  paste.set(6, 5, 5, MAT.PSTE, 70, 20, { tmp: 8 });
  paste.updateSponge(paste.index(5, 5, 5), 5, 5, 5);
  assert.equal(paste.get(6, 5, 5), MAT.CLST);
  assert.equal(paste.life[paste.index(5, 5, 5)], 1);

  const release = new VoxelSimulation(11, 11, 11, 0x3538);
  release.set(5, 5, 5, MAT.SPNG, 22, 3);
  release.air.pressure[release.air.indexForVoxel(5, 5, 5)] = 4;
  release.updateSponge(release.index(5, 5, 5), 5, 5, 5);
  assert.equal(release.types.filter((type) => type === MAT.WATR).length, 3);
  assert.equal(release.life[release.index(5, 5, 5)], 0);

  const steam = new VoxelSimulation(11, 11, 11, 0x3539);
  steam.set(5, 5, 5, MAT.SPNG, 22, 10);
  steam.set(6, 5, 5, MAT.FIRE, 422, 61);
  steam.updateSponge(steam.index(5, 5, 5), 5, 5, 5);
  assert.equal(steam.types.filter((type) => type === MAT.WTRV).length, 7);
  assert.equal(steam.life[steam.index(5, 5, 5)], 0);
  assert.equal(steam.life[steam.index(6, 5, 5)], 60);
  assert.equal(steam.temperatures[steam.index(5, 5, 5)], -118);

  const diffuse = new VoxelSimulation(12, 12, 12, 0x3540);
  diffuse.random = () => 0.999999;
  diffuse.set(5, 5, 5, MAT.SPNG, 22, 10);
  diffuse.set(7, 7, 7, MAT.SPNG, 22, 0);
  diffuse.updateSponge(diffuse.index(5, 5, 5), 5, 5, 5);
  assert.equal(diffuse.life[diffuse.index(5, 5, 5)], 5);
  assert.equal(diffuse.life[diffuse.index(7, 7, 7)], 5);
});

test("mercury merges and splits every available unit then performs four random charge trades", () => {
  const merge = new VoxelSimulation(11, 11, 11, 0x3541);
  merge.random = () => 0;
  merge.set(5, 5, 5, MAT.MERC, -200, 0, { tmp: 0 });
  merge.set(4, 4, 4, MAT.MERC, -200, 0, { tmp: 1 });
  merge.set(5, 4, 4, MAT.MERC, -200, 0, { tmp: 1 });
  merge.updateMercury(merge.index(5, 5, 5), 5, 5, 5);
  assert.equal(merge.tmp[merge.index(5, 5, 5)], 4);
  assert.equal(merge.get(4, 4, 4), MAT.EMPTY);
  assert.equal(merge.get(5, 4, 4), MAT.EMPTY);

  const split = new VoxelSimulation(11, 11, 11, 0x3542);
  split.random = () => 0.5;
  split.set(5, 5, 5, MAT.MERC, 9725.85, 0, { tmp: 3, decoration: 0xff334455 });
  split.updateMercury(split.index(5, 5, 5), 5, 5, 5);
  assert.equal(split.types.filter((type) => type === MAT.MERC).length, 4);
  assert.equal(split.tmp[split.index(5, 5, 5)], 0);
  const mercuryDecorations = [];
  for (let index = 0; index < split.size; index += 1) {
    if (split.types[index] === MAT.MERC && index !== split.index(5, 5, 5)) mercuryDecorations.push(split.decorations[index]);
  }
  assert.deepEqual(mercuryDecorations, [0xff334455, 0xff334455, 0xff334455]);

  const trade = new VoxelSimulation(12, 12, 12, 0x3543);
  trade.random = () => 0.999999;
  trade.set(5, 5, 5, MAT.MERC, 22, 0, { tmp: 20 });
  trade.set(7, 7, 7, MAT.MERC, 22, 0, { tmp: 0 });
  trade.updateMercury(trade.index(5, 5, 5), 5, 5, 5);
  assert.equal(trade.tmp[trade.index(5, 5, 5)], 10);
  assert.equal(trade.tmp[trade.index(7, 7, 7)], 10);
});

test("watered seeds grow upward from sand and vines propagate in three dimensions", () => {
  const tree = new VoxelSimulation(12, 12, 12, 0x3636);
  tree.random = () => 0;
  tree.set(5, 4, 5, MAT.SAND);
  tree.set(5, 5, 5, MAT.SEED, 22, 201, { ctype: 5 << 12 });
  assert.equal(tree.updateSeed(tree.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(tree.get(5, 5, 5), MAT.PLNT);
  tree.random = () => 0.95;
  tree.updatePlant(tree.index(5, 5, 5), 5, 5, 5);
  assert.equal(tree.get(5, 6, 5), MAT.PLNT);
  assert.ok([MAT.WOOD, MAT.GOO].includes(tree.get(5, 5, 5)));

  const vine = new VoxelSimulation(12, 12, 12, 0x3637);
  const vineRandom = [0.9, 0.5, 0.5, 0.5];
  vine.random = () => vineRandom.shift() ?? 0.5;
  vine.set(5, 5, 5, MAT.VINE);
  assert.equal(vine.updateVine(vine.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(vine.get(5, 5, 5), MAT.PLNT);
  assert.equal(vine.types.includes(MAT.VINE), true);
});

test("seeds generate complete genomes, drink typed water and breed once", () => {
  const generated = new VoxelSimulation(10, 10, 10, 0x3638);
  generated.random = () => 0;
  generated.set(4, 4, 4, MAT.SEED);
  const generatedIndex = generated.index(4, 4, 4);
  assert.equal(generated.ctype[generatedIndex] & 0b111111000000, 0b111011000000);
  assert.deepEqual([
    generated.tmp[generatedIndex], generated.tmp2[generatedIndex], generated.tmp3[generatedIndex], generated.tmp4[generatedIndex],
  ], [0x7fff, 0x7fff, 0x7fff, 0x7fff]);

  const breeding = new VoxelSimulation(10, 10, 10, 0x3639);
  breeding.random = () => 0;
  breeding.set(4, 4, 4, MAT.SEED, 22, 0, { ctype: (1 << 12) | (0b101010 << 6), tmp: 1, tmp2: 2, tmp3: 4, tmp4: 8 });
  breeding.set(5, 4, 4, MAT.SEED, 22, 0, { ctype: 0b010101 << 6, tmp: 16, tmp2: 32, tmp3: 64, tmp4: 128 });
  breeding.updateSeed(breeding.index(4, 4, 4), 4, 4, 4);
  assert.equal(breeding.ctype[breeding.index(4, 4, 4)] & 1, 1);
  assert.equal(breeding.ctype[breeding.index(5, 4, 4)] & 1, 1);

  const nutrition = new VoxelSimulation(10, 10, 10, 0x363a);
  nutrition.set(4, 4, 4, MAT.SEED, 22, 0, { ctype: 0, tmp: 0, tmp2: 0, tmp3: 0, tmp4: 0 });
  nutrition.set(5, 4, 4, MAT.DEUT);
  nutrition.set(3, 4, 4, MAT.DSTW);
  nutrition.updateSeed(nutrition.index(4, 4, 4), 4, 4, 4);
  assert.equal((nutrition.ctype[nutrition.index(4, 4, 4)] >>> 12) & 0xff, 2);
  nutrition.temperatures[nutrition.index(4, 4, 4)] = 71;
  nutrition.life[nutrition.index(4, 4, 4)] = 50;
  nutrition.updateSeed(nutrition.index(4, 4, 4), 4, 4, 4);
  assert.equal((nutrition.ctype[nutrition.index(4, 4, 4)] >>> 12) & 0xff, 0);
  assert.equal(nutrition.life[nutrition.index(4, 4, 4)], 0);
});

test("tree plants execute packed branch programs and retire into inherited seeds", () => {
  const branching = new VoxelSimulation(12, 12, 12, 0x363b);
  branching.random = () => 0.95;
  const source = branching.index(6, 6, 6);
  branching.set(6, 6, 6, MAT.PLNT, 22, 0, {
    ctype: (9 << 12) | 1, tmp: 1 | (2 << 5), tmp2: 0, tmp3: 0, tmp4: 0,
  });
  assert.equal(branching.updatePlant(source, 6, 6, 6), true);
  assert.equal(branching.types[source], MAT.WOOD);
  const child = branching.types.findIndex((type) => type === MAT.PLNT);
  assert.ok(child >= 0);
  assert.equal((branching.ctype[child] >>> 1) & 3, 2);
  assert.equal((branching.ctype[child] >>> 12) & 0xff, 4);
  assert.equal(branching.life[child], 40);

  const retiring = new VoxelSimulation(12, 12, 12, 0x363c);
  const sequence = [0.95, 0];
  retiring.random = () => sequence.shift() ?? 0;
  const retired = retiring.index(6, 6, 6);
  retiring.set(6, 6, 6, MAT.PLNT, 22, 0, {
    ctype: (0b100101 << 6) | 1, tmp: 0x123, tmp2: 0x456, tmp3: 0x789, tmp4: 0x321,
  });
  retiring.updatePlant(retired, 6, 6, 6);
  assert.equal(retiring.ctype[retired], (0b100101 << 6) | (7 << 3));
  const seed = retiring.types.findIndex((type) => type === MAT.SEED);
  assert.ok(seed >= 0);
  assert.equal(retiring.ctype[seed], 0b100101 << 6);
  assert.deepEqual([retiring.tmp[seed], retiring.tmp2[seed], retiring.tmp3[seed], retiring.tmp4[seed]], [0x123, 0x456, 0x789, 0x321]);
});

test("ordinary plants consume water and carbon, emit oxygen and ignite on lava", () => {
  const water = new VoxelSimulation(10, 10, 10, 0x363d);
  water.random = () => 0;
  water.set(4, 4, 4, MAT.PLNT, 22, 0, { ctype: 0x540 });
  water.set(5, 4, 4, MAT.WATR);
  water.updatePlant(water.index(4, 4, 4), 4, 4, 4);
  assert.equal(water.get(5, 4, 4), MAT.PLNT);
  assert.equal(water.ctype[water.index(5, 4, 4)], 0x540);

  const carbon = new VoxelSimulation(10, 10, 10, 0x363e);
  carbon.random = () => 0;
  carbon.set(4, 4, 4, MAT.PLNT);
  carbon.set(5, 4, 4, MAT.CO2);
  carbon.updatePlant(carbon.index(4, 4, 4), 4, 4, 4);
  assert.equal(carbon.get(5, 4, 4), MAT.EMPTY);
  assert.equal(carbon.life[carbon.index(4, 4, 4)], 60);

  const oxygen = new VoxelSimulation(10, 10, 10, 0x363f);
  oxygen.set(4, 4, 4, MAT.PLNT, 22, 2);
  oxygen.updatePlant(oxygen.index(4, 4, 4), 4, 4, 4);
  assert.equal(oxygen.life[oxygen.index(4, 4, 4)], 0);
  assert.ok(oxygen.types.filter((type) => type === MAT.O2).length > 6);

  const lava = new VoxelSimulation(10, 10, 10, 0x3640);
  lava.random = () => 0;
  lava.set(4, 4, 4, MAT.PLNT);
  lava.set(5, 4, 4, MAT.LAVA);
  lava.updatePlant(lava.index(4, 4, 4), 4, 4, 4);
  assert.equal(lava.get(4, 4, 4), MAT.FIRE);
  assert.equal(lava.life[lava.index(4, 4, 4)], 4);
});

test("goo deforms under pressure and breakable metal preserves rust state", () => {
  const goo = new VoxelSimulation(10, 9, 9, 0x3737);
  goo.random = () => 0;
  goo.set(4, 4, 4, MAT.GOO);
  const gooAir = goo.air.indexForVoxel(4, 4, 4);
  goo.air.pressure[gooAir] = 2;
  goo.air.velocityX[gooAir] = 4;
  goo.air.velocityY[gooAir] = 4;
  goo.air.velocityZ[gooAir] = 4;
  goo.updateGoo(goo.index(4, 4, 4), 4, 4, 4);
  assert.equal(goo.get(4, 4, 4), MAT.EMPTY);
  const deformed = goo.index(5, 5, 5);
  assert.equal(goo.types[deformed], MAT.GOO);
  assert.equal(goo.life[deformed], 300);
  assert.deepEqual([goo.velocityX[deformed], goo.velocityY[deformed], goo.velocityZ[deformed]].map((value) => Math.round(value * 100) / 100), [0.36, 0.36, 0.36]);

  const pressure = new VoxelSimulation(10, 9, 9, 0x3738);
  pressure.set(4, 4, 4, MAT.BMTL);
  pressure.air.pressure[pressure.air.indexForVoxel(4, 4, 4)] = 3;
  assert.equal(pressure.applyPhaseChange(pressure.index(4, 4, 4), MAT.BMTL), true);
  assert.equal(pressure.get(4, 4, 4), MAT.BRMT);

  const corrosion = new VoxelSimulation(10, 9, 9, 0x3739);
  corrosion.random = () => 0;
  corrosion.set(4, 4, 4, MAT.BMTL, 22, 0, { tmp: 3 });
  corrosion.set(5, 4, 4, MAT.METL);
  corrosion.updateBreakableMetal(corrosion.index(4, 4, 4), 4, 4, 4, MAT.BMTL);
  assert.equal(corrosion.get(5, 4, 4), MAT.BMTL);
  assert.equal(corrosion.tmp[corrosion.index(5, 4, 4)], 1);

  const thermite = new VoxelSimulation(10, 9, 9, 0x373a);
  thermite.random = () => 0;
  thermite.set(4, 4, 4, MAT.BRMT, 300, 4, { ctype: MAT.WATR, tmp: 8 });
  thermite.set(5, 4, 4, MAT.BREC, 800, 5, { tmp: 91 });
  thermite.set(4, 4, 5, MAT.BREC, 900, 6, { tmp: 92 });
  assert.equal(thermite.updateBreakableMetal(thermite.index(4, 4, 4), 4, 4, 4, MAT.BRMT), false);
  for (const [x, y, z] of [[5, 4, 4], [4, 4, 5]]) {
    const product = thermite.index(x, y, z);
    assert.equal(thermite.types[product], MAT.THRM);
    assert.equal(thermite.temperatures[product], materialById(MAT.THRM).defaultTemp);
    assert.deepEqual([thermite.life[product], thermite.ctype[product], thermite.tmp[product]], [0, 0, 0]);
  }
});

test("coal pressure-fractures, remembers heat and enters its slow burn cycle", () => {
  const fracture = new VoxelSimulation(10, 9, 9, 0x3838);
  fracture.set(4, 4, 4, MAT.COAL, 300);
  const index = fracture.index(4, 4, 4);
  fracture.tmp[index] = 0;
  assert.equal(fracture.updateCoal(index, 4, 4, 4, MAT.COAL), true);
  assert.equal(fracture.get(4, 4, 4), MAT.BCOL);

  const burn = new VoxelSimulation(10, 9, 9, 0x3839);
  burn.random = () => 0;
  burn.set(4, 4, 4, MAT.BCOL, 420, 99);
  burn.updateCoal(burn.index(4, 4, 4), 4, 4, 4, MAT.BCOL);
  assert.equal(burn.life[burn.index(4, 4, 4)], 98);
  assert.equal(burn.tmp2[burn.index(4, 4, 4)], 420);
  const emitted = burn.index(3, 3, 3);
  assert.equal(burn.types[emitted], MAT.FIRE);
  assert.equal(burn.temperatures[emitted], materialById(MAT.FIRE).defaultTemp);
  assert.equal(burn.life[emitted], 120);

  const exhausted = new VoxelSimulation(10, 9, 9, 0x383a);
  exhausted.random = () => 0;
  exhausted.set(4, 4, 4, MAT.COAL, 900, 0, { ctype: MAT.WATR, tmp: 99, tmp2: 600 });
  assert.equal(exhausted.updateCoal(exhausted.index(4, 4, 4), 4, 4, 4, MAT.COAL), true);
  const fire = exhausted.index(4, 4, 4);
  assert.equal(exhausted.types[fire], MAT.FIRE);
  assert.equal(exhausted.temperatures[fire], materialById(MAT.FIRE).defaultTemp);
  assert.deepEqual([exhausted.ctype[fire], exhausted.tmp[fire], exhausted.tmp2[fire], exhausted.life[fire]], [0, 0, 0, 120]);
});

test("iron rusts, gold reverses corrosion and absorbs neutrons", () => {
  const iron = new VoxelSimulation(12, 10, 10, 0x3939);
  iron.random = () => 0;
  iron.set(5, 5, 5, MAT.IRON);
  iron.set(6, 5, 5, MAT.LO2);
  assert.equal(iron.updateIron(iron.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(iron.get(5, 5, 5), MAT.BMTL);
  assert.equal(iron.tmp[iron.index(5, 5, 5)], 20);

  const gold = new VoxelSimulation(14, 10, 10, 0x393a);
  gold.random = () => 1074.1 / 0x100000000;
  gold.set(6, 5, 5, MAT.GOLD);
  gold.set(5, 5, 5, MAT.BMTL, 22, 0, { tmp: 8 });
  gold.updateGold(gold.index(6, 5, 5), 6, 5, 5);
  assert.equal(gold.get(5, 5, 5), MAT.IRON);
  gold.setEnergy(6, 5, 5, MAT.NEUT, 22, 100, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  gold.random = () => 0;
  assert.equal(gold.interactEnergy(gold.index(6, 5, 5), 6, 5, 5), true);
  assert.equal(gold.getEnergy(6, 5, 5), MAT.EMPTY);
});

test("quartz records pressure, fractures on a pressure shock and absorbs salt water", () => {
  const fracture = new VoxelSimulation(10, 9, 9, 0x3a3a);
  const airIndex = fracture.air.indexForVoxel(4, 4, 4);
  fracture.air.pressure[airIndex] = 5;
  fracture.set(4, 4, 4, MAT.QRTZ);
  const index = fracture.index(4, 4, 4);
  assert.equal(fracture.tmp3[index], 320);
  fracture.air.pressure[airIndex] = 20;
  fracture.updateQuartz(index, 4, 4, 4, MAT.QRTZ);
  assert.equal(fracture.get(4, 4, 4), MAT.PQRT);
  assert.equal(fracture.life[index], 5);

  const absorb = new VoxelSimulation(10, 9, 9, 0x3a3b);
  absorb.set(4, 4, 4, MAT.QRTZ);
  absorb.set(5, 4, 4, MAT.SLTW);
  const quartz = absorb.index(4, 4, 4);
  absorb.velocityX[quartz] = 1;
  absorb.random = () => 0;
  absorb.updateQuartz(quartz, 4, 4, 4, MAT.QRTZ);
  assert.equal(absorb.get(5, 4, 4), MAT.EMPTY);
  assert.equal(absorb.tmp[quartz], 1);

  const growth = new VoxelSimulation(10, 9, 9, 0x3a3c);
  growth.random = () => 0;
  growth.set(4, 4, 4, MAT.PQRT, 100, 0, { tmp: 1, tmp2: 5 });
  growth.updateQuartz(growth.index(4, 4, 4), 4, 4, 4, MAT.PQRT);
  assert.equal(growth.get(4, 4, 4), MAT.QRTZ);
  const crystal = growth.index(3, 3, 3);
  assert.equal(growth.types[crystal], MAT.QRTZ);
  assert.equal(growth.temperatures[crystal], 100);
  assert.equal(growth.tmp2[crystal], 4);
  assert.equal(growth.tmp[crystal], -1);
});

test("titanium blocks air and tungsten fractures or burns with oxygen", () => {
  const titanium = new VoxelSimulation(12, 12, 12, 0x3b3b);
  titanium.set(5, 5, 5, MAT.TTAN, 22, 0, { tmp: 1 });
  titanium.air.updateBlocked(titanium);
  assert.equal(titanium.air.blocked[titanium.air.indexForVoxel(5, 5, 5)], 1);

  const brittle = new VoxelSimulation(12, 12, 12, 0x3b3c);
  brittle.set(5, 5, 5, MAT.TUNG);
  const tungsten = brittle.index(5, 5, 5);
  brittle.air.pressure[brittle.air.indexForVoxel(5, 5, 5)] = 1;
  assert.equal(brittle.updateTungsten(tungsten, 5, 5, 5), true);
  assert.equal(brittle.get(5, 5, 5), MAT.BRMT);
  assert.equal(brittle.ctype[tungsten], MAT.TUNG);

  const oxygen = new VoxelSimulation(12, 12, 12, 0x3b3d);
  oxygen.set(5, 5, 5, MAT.TUNG, 2200);
  oxygen.set(6, 5, 5, MAT.O2);
  oxygen.random = () => 0.5;
  assert.equal(oxygen.updateTungsten(oxygen.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(oxygen.get(5, 5, 5), MAT.LAVA);
  assert.equal(oxygen.ctype[oxygen.index(5, 5, 5)], MAT.TUNG);

  const fire = new VoxelSimulation(12, 12, 12, 0x3b3e);
  const fireDraws = [0.5, 0, 0.2];
  fire.random = () => fireDraws.shift() ?? 0;
  fire.set(5, 5, 5, MAT.TUNG, 2200, 7, { ctype: MAT.WATR, tmp: 31, velocityX: 3, velocityY: 4, velocityZ: 5 });
  fire.set(6, 5, 5, MAT.O2);
  assert.equal(fire.updateTungsten(fire.index(5, 5, 5), 5, 5, 5), true);
  const fireIndex = fire.index(5, 5, 5);
  assert.equal(fire.types[fireIndex], MAT.FIRE);
  assert.deepEqual([fire.temperatures[fireIndex], fire.life[fireIndex], fire.ctype[fireIndex], fire.tmp[fireIndex]], [2200, 100, MAT.WATR, 31]);
  assert.deepEqual([fire.velocityX[fireIndex], fire.velocityY[fireIndex], fire.velocityZ[fireIndex]], [3, 4, 5]);

  const puff = new VoxelSimulation(12, 12, 12, 0x3b3f);
  puff.random = () => 0;
  puff.set(5, 5, 5, MAT.TUNG, 2200);
  puff.set(6, 5, 5, MAT.O2);
  assert.equal(puff.updateTungsten(puff.index(5, 5, 5), 5, 5, 5), true);
  const puffIndex = puff.index(5, 5, 5);
  assert.equal(puff.types[puffIndex], MAT.TUNG);
  assert.ok(Math.abs(puff.temperatures[puffIndex] - 3621.85) < 0.01);
  assert.deepEqual([puff.velocityX[puffIndex], puff.velocityY[puffIndex], puff.velocityZ[puffIndex]], [-50, -50, -50]);
  assert.equal(puff.air.sampleVoxel(5, 5, 5).pressure, 50);
});

test("ceramic records visual grain, crushes in vacuum and carries its lava identity", () => {
  const vacuum = new VoxelSimulation(10, 9, 9, 0x3c3c);
  vacuum.random = () => 0;
  vacuum.set(4, 4, 4, MAT.CRMC, 22);
  const index = vacuum.index(4, 4, 4);
  assert.equal(vacuum.tmp2[index], 0);
  vacuum.air.pressure[vacuum.air.indexForVoxel(4, 4, 4)] = -31;
  assert.equal(vacuum.updateCeramic(index, 4, 4, 4), true);
  assert.equal(vacuum.get(4, 4, 4), MAT.CLST);
  assert.equal(vacuum.temperatures[index], 22);

  const melt = new VoxelSimulation(10, 9, 9, 0x3c3d);
  melt.set(4, 4, 4, MAT.CRMC, 2614);
  assert.equal(melt.applyPhaseChange(melt.index(4, 4, 4), MAT.CRMC), true);
  assert.equal(melt.get(4, 4, 4), MAT.LAVA);
  assert.equal(melt.ctype[melt.index(4, 4, 4)], MAT.CRMC);
});

test("rapid heat conductor equilibrates visible matter and independent energy at range", () => {
  const sim = new VoxelSimulation(14, 10, 10, 0x3d3d);
  sim.set(5, 5, 5, MAT.HEAC, 100);
  sim.set(9, 5, 5, MAT.STNE, 0);
  sim.setEnergy(5, 9, 5, MAT.PHOT, 200, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  sim.set(5, 5, 9, MAT.PIPE, 0, 0, { ctype: MAT.BASE, tmp: PIPE_FLAG.CAN_CONDUCT });
  sim.updateHeatConductor(sim.index(5, 5, 5), 5, 5, 5);
  const equilibrium = 300 / 5.5;
  assert.equal(materialById(MAT.BASE).heatCapacity, 1.5);
  assert.ok(Math.abs(sim.temperatures[sim.index(5, 5, 5)] - equilibrium) < 0.001);
  assert.ok(Math.abs(sim.temperatures[sim.index(9, 5, 5)] - equilibrium) < 0.001);
  assert.ok(Math.abs(sim.temperatures[sim.index(5, 5, 9)] - equilibrium) < 0.001);
  assert.ok(Math.abs(sim.energyTemperatures[sim.index(5, 9, 5)] - equilibrium) < 0.001);

  const blocked = new VoxelSimulation(14, 10, 10, 0x3d3e);
  blocked.set(5, 5, 5, MAT.HEAC, 100);
  blocked.set(7, 5, 5, MAT.INSL, 20);
  blocked.set(9, 5, 5, MAT.STNE, 0);
  blocked.updateHeatConductor(blocked.index(5, 5, 5), 5, 5, 5);
  assert.equal(blocked.temperatures[blocked.index(9, 5, 5)], 0);
});

test("broken electronics become exotic under a sustained extreme spark and pressure", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x3e3e);
  sim.random = () => 0;
  sim.set(4, 4, 4, MAT.BREC, 9001, 4);
  sim.air.pressure[sim.air.indexForVoxel(4, 4, 4)] = 40;
  assert.equal(sim.updateBrokenElectronics(sim.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(sim.get(4, 4, 4), MAT.EXOT);
  assert.equal(sim.life[sim.index(4, 4, 4)], 1000);
});

test("clay makes solid paste with water and detonating compound with nitrite", () => {
  const paste = new VoxelSimulation(10, 9, 9, 0x3f3f);
  paste.random = () => 0;
  paste.set(4, 4, 4, MAT.CLST);
  paste.set(5, 4, 4, MAT.WATR);
  assert.equal(paste.updateClay(paste.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(paste.get(4, 4, 4), MAT.PSTS);
  assert.equal(paste.get(5, 4, 4), MAT.EMPTY);

  const explosive = new VoxelSimulation(10, 9, 9, 0x3f40);
  explosive.set(4, 4, 4, MAT.CLST);
  explosive.set(5, 4, 4, MAT.NITR);
  assert.equal(explosive.updateClay(explosive.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(explosive.get(4, 4, 4), MAT.BANG);
  assert.equal(explosive.get(5, 4, 4), MAT.BANG);

  const exhaustive = new VoxelSimulation(10, 9, 9, 0x3f42);
  exhaustive.random = () => 0;
  exhaustive.set(4, 4, 4, MAT.CLST, 300, 9, { ctype: MAT.WATR, tmp2: 4, velocityX: 3 });
  exhaustive.set(3, 4, 4, MAT.WATR);
  exhaustive.set(5, 4, 4, MAT.WATR);
  exhaustive.updateClay(exhaustive.index(4, 4, 4), 4, 4, 4);
  assert.equal(exhaustive.get(3, 4, 4), MAT.EMPTY);
  assert.equal(exhaustive.get(5, 4, 4), MAT.EMPTY);
  assert.deepEqual([
    exhaustive.get(4, 4, 4),
    exhaustive.temperatures[exhaustive.index(4, 4, 4)],
    exhaustive.life[exhaustive.index(4, 4, 4)],
    exhaustive.ctype[exhaustive.index(4, 4, 4)],
    exhaustive.velocityX[exhaustive.index(4, 4, 4)],
  ], [MAT.PSTS, materialById(MAT.PSTS).defaultTemp, materialById(MAT.PSTS).defaultLife, materialById(MAT.PSTS).defaultCtype, 0]);

  const pressure = new VoxelSimulation(10, 9, 9, 0x3f41);
  pressure.random = () => 0;
  pressure.set(4, 4, 4, MAT.PSTS);
  pressure.step();
  assert.equal(pressure.get(4, 4, 4), MAT.PSTE);
});

test("silicon sparkles advance and platinum catalyzes hydrogen with oxygen", () => {
  const silicon = new VoxelSimulation(14, 10, 10, 0x4041);
  silicon.random = () => 0;
  silicon.set(5, 5, 5, MAT.SLCN, 22);
  const siliconIndex = silicon.index(5, 5, 5);
  const initial = silicon.tmp[siliconIndex];
  silicon.set(9, 5, 5, MAT.SPRK, 22, 2, { ctype: MAT.METL });
  assert.equal(silicon.updateSilicon(siliconIndex, 5, 5, 5), true);
  assert.equal(silicon.get(5, 5, 5), MAT.SPRK);
  assert.equal(silicon.ctype[siliconIndex], MAT.SLCN);
  assert.notEqual(initial, 0);

  const catalyst = new VoxelSimulation(12, 10, 10, 0x4042);
  catalyst.random = () => 0;
  catalyst.set(5, 5, 5, MAT.PTNM);
  catalyst.set(6, 5, 5, MAT.H2);
  catalyst.set(7, 5, 5, MAT.O2);
  assert.equal(catalyst.updatePlatinum(catalyst.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(catalyst.get(5, 5, 5), MAT.SPRK);
  assert.equal(catalyst.get(6, 5, 5), MAT.DSTW);
  assert.equal(catalyst.get(7, 5, 5), MAT.DSTW);

  const conductingCatalyst = new VoxelSimulation(14, 10, 10, 0x4043);
  conductingCatalyst.random = () => 0;
  conductingCatalyst.set(5, 5, 5, MAT.PTNM, 1500, 0, { tmp: 0 });
  conductingCatalyst.set(9, 5, 5, MAT.SPRK, 22, 2, { ctype: MAT.METL });
  conductingCatalyst.set(6, 5, 5, MAT.RSST, 800, 8, { ctype: MAT.WATR, tmp: 5, velocityX: 4 });
  assert.equal(conductingCatalyst.updatePlatinum(conductingCatalyst.index(5, 5, 5), 5, 5, 5), true);
  const bizarre = conductingCatalyst.index(6, 5, 5);
  assert.equal(conductingCatalyst.get(5, 5, 5), MAT.SPRK);
  assert.deepEqual([
    conductingCatalyst.types[bizarre], conductingCatalyst.temperatures[bizarre], conductingCatalyst.life[bizarre],
    conductingCatalyst.ctype[bizarre], conductingCatalyst.tmp[bizarre], conductingCatalyst.velocityX[bizarre],
  ], [MAT.BIZR, materialById(MAT.BIZR).defaultTemp, materialById(MAT.BIZR).defaultLife,
    materialById(MAT.BIZR).defaultCtype, materialById(MAT.BIZR).defaultTmp, 0]);
});

test("snow preserves its frozen source, melts correctly and reacts with salt", () => {
  const melt = new VoxelSimulation(10, 9, 9, 0x4141);
  melt.set(4, 4, 4, MAT.SNOW, 1);
  assert.equal(melt.applyPhaseChange(melt.index(4, 4, 4), MAT.SNOW), true);
  assert.equal(melt.get(4, 4, 4), MAT.WATR);

  const salt = new VoxelSimulation(10, 9, 9, 0x4142);
  salt.random = () => 0;
  salt.set(4, 4, 4, MAT.SNOW, -30, 0, { ctype: MAT.FRZW });
  salt.set(5, 4, 4, MAT.SALT);
  salt.set(4, 4, 5, MAT.SALT);
  salt.updateSnow(salt.index(4, 4, 4), 4, 4, 4);
  assert.equal(salt.get(4, 4, 4), MAT.SLTW);
  assert.equal(salt.get(5, 4, 4), MAT.SLTW);
  assert.equal(salt.get(4, 4, 5), MAT.SLTW);
  assert.equal(salt.temperatures[salt.index(4, 4, 4)], -31);
});

test("plasma gets an upstream lifetime and extreme noble gas decomposes", () => {
  const plasma = new VoxelSimulation(10, 9, 9, 0x4242);
  plasma.random = () => 0;
  plasma.set(4, 4, 4, MAT.PLSM, 3500);
  assert.equal(plasma.life[plasma.index(4, 4, 4)], 50);
  plasma.life[plasma.index(4, 4, 4)] = 1;
  plasma.ctype[plasma.index(4, 4, 4)] = MAT.NBLE;
  assert.equal(plasma.updatePlasma(plasma.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(plasma.get(4, 4, 4), MAT.NBLE);

  const noble = new VoxelSimulation(12, 10, 10, 0x4243);
  noble.random = () => 0;
  noble.set(5, 5, 5, MAT.NBLE, 5001, 17, { ctype: MAT.WATR, tmp: 81, tmp2: 92, decoration: 0xff00ff00 });
  noble.air.pressure[noble.air.indexForVoxel(5, 5, 5)] = 101;
  assert.equal(noble.updateNobleGas(noble.index(5, 5, 5), 5, 5, 5), true);
  const nobleProduct = noble.index(5, 5, 5);
  assert.equal(noble.types[nobleProduct], MAT.CO2);
  assert.deepEqual([noble.life[nobleProduct], noble.ctype[nobleProduct], noble.tmp[nobleProduct], noble.tmp2[nobleProduct], noble.decorations[nobleProduct]], [0, 0, 0, 0, 0]);
  assert.ok(noble.energyTypes.includes(MAT.NEUT));
  assert.ok(noble.types.includes(MAT.PLSM));
});

test("warm yeast reproduces and the hidden steam train emits smoke", () => {
  const yeast = new VoxelSimulation(10, 9, 9, 0x4343);
  yeast.random = () => 0;
  yeast.set(4, 4, 4, MAT.YEST, 37);
  yeast.set(5, 4, 4, MAT.DYST);
  yeast.updateYeast(yeast.index(4, 4, 4), 4, 4, 4);
  assert.equal(yeast.get(4, 4, 4), MAT.DYST);
  assert.equal(yeast.get(3, 3, 3), MAT.YEST);
  assert.equal(yeast.temperatures[yeast.index(3, 3, 3)], materialById(MAT.YEST).defaultTemp);

  const train = new VoxelSimulation(10, 9, 9, 0x4344);
  train.set(4, 5, 4, MAT.MORT, 900);
  assert.equal(train.velocityX[train.index(4, 5, 4)], 2);
  train.updateMort(train.index(4, 5, 4), 4, 5, 4);
  assert.equal(train.get(4, 4, 4), MAT.SMKE);
  assert.equal(train.temperatures[train.index(4, 4, 4)], materialById(MAT.SMKE).defaultTemp);
});

test("carbon dioxide extinguishes fire and caustic gas makes refrigerant", () => {
  const dioxide = new VoxelSimulation(10, 9, 9, 0x4444);
  dioxide.random = () => 0.5;
  dioxide.set(4, 4, 4, MAT.CO2);
  dioxide.set(5, 4, 4, MAT.FIRE);
  dioxide.updateCarbonDioxide(dioxide.index(4, 4, 4), 4, 4, 4);
  assert.equal(dioxide.get(5, 4, 4), MAT.EMPTY);

  const caustic = new VoxelSimulation(10, 9, 9, 0x4445);
  caustic.random = () => 0;
  caustic.set(4, 4, 4, MAT.CAUS);
  caustic.set(5, 4, 4, MAT.GAS);
  caustic.air.pressure[caustic.air.indexForVoxel(5, 4, 4)] = 4;
  assert.equal(caustic.updateCausticGas(caustic.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(caustic.get(4, 4, 4), MAT.RFRG);
  assert.equal(caustic.get(5, 4, 4), MAT.RFRG);
});

test("caustic gas converts every pressurized GAS contact but leaves low-pressure GAS intact", () => {
  const compressed = new VoxelSimulation(12, 10, 10, 0x4448);
  compressed.set(5, 5, 5, MAT.CAUS);
  compressed.set(6, 5, 5, MAT.GAS);
  compressed.set(5, 5, 6, MAT.GAS);
  compressed.air.pressure[compressed.air.indexForVoxel(6, 5, 5)] = 4;
  compressed.air.pressure[compressed.air.indexForVoxel(5, 5, 6)] = 4;
  assert.equal(compressed.updateCausticGas(compressed.index(5, 5, 5), 5, 5, 5), true);
  assert.equal(compressed.get(6, 5, 5), MAT.RFRG);
  assert.equal(compressed.get(5, 5, 6), MAT.RFRG);

  const lowPressure = new VoxelSimulation(12, 10, 10, 0x4449);
  lowPressure.random = () => 0;
  lowPressure.set(5, 5, 5, MAT.CAUS);
  lowPressure.set(6, 5, 5, MAT.GAS);
  lowPressure.updateCausticGas(lowPressure.index(5, 5, 5), 5, 5, 5);
  assert.equal(lowPressure.get(6, 5, 5), MAT.GAS);
  assert.equal(lowPressure.life[lowPressure.index(5, 5, 5)], 75);
});

test("carbon dioxide recreates conserved water and stellar oxygen with canonical defaults", () => {
  const carbonated = new VoxelSimulation(10, 9, 9, 0x4446);
  carbonated.random = () => 0;
  carbonated.set(4, 4, 4, MAT.CO2, 800, 14, { ctype: 5, tmp: 91, tmp2: 92, decoration: 0xff00ff00 });
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        carbonated.set(4 + dx, 4 + dy, 4 + dz, MAT.DMND);
      }
    }
  }
  carbonated.set(5, 4, 4, MAT.WATR, 70, 3, { tmp: 11 });
  carbonated.updateCarbonDioxide(carbonated.index(4, 4, 4), 4, 4, 4);
  const waterProduct = carbonated.index(4, 4, 4);
  assert.equal(carbonated.types[waterProduct], MAT.WATR);
  assert.deepEqual([
    carbonated.temperatures[waterProduct], carbonated.life[waterProduct], carbonated.ctype[waterProduct],
    carbonated.tmp[waterProduct], carbonated.tmp2[waterProduct], carbonated.decorations[waterProduct],
  ], [materialById(MAT.WATR).defaultTemp, 0, 0, 0, 0, 0]);
  assert.equal(carbonated.get(5, 4, 4), MAT.CBNW);
  assert.equal(carbonated.tmp[carbonated.index(5, 4, 4)], 11);

  const stellar = new VoxelSimulation(12, 10, 10, 0x4447);
  stellar.random = () => 0;
  stellar.set(5, 5, 5, MAT.CO2, 9501, 33, { ctype: MAT.WATR, tmp: 72, tmp2: 73, decoration: 0xffff0000 });
  stellar.air.pressure[stellar.air.indexForVoxel(5, 5, 5)] = 201;
  assert.equal(stellar.updateCarbonDioxide(stellar.index(5, 5, 5), 5, 5, 5), true);
  const oxygenProduct = stellar.index(5, 5, 5);
  assert.equal(stellar.types[oxygenProduct], MAT.O2);
  assert.deepEqual([stellar.life[oxygenProduct], stellar.ctype[oxygenProduct], stellar.tmp[oxygenProduct], stellar.tmp2[oxygenProduct], stellar.decorations[oxygenProduct]], [0, 0, 0, 0, 0]);
  assert.ok(Math.abs(stellar.temperatures[oxygenProduct] - 9725.85) < 0.01);
  assert.ok(stellar.energyTypes.includes(MAT.NEUT));
});

test("freeze matter spreads, ages into typed ice and anti-air burns cold", () => {
  const freeze = new VoxelSimulation(10, 9, 9, 0x4545);
  freeze.random = () => 0;
  freeze.set(4, 4, 4, MAT.FRZW, -153.15, 100);
  freeze.set(5, 4, 4, MAT.WATR);
  freeze.updateFreezeMatter(freeze.index(4, 4, 4), 4, 4, 4, MAT.FRZW);
  assert.equal(freeze.get(5, 4, 4), MAT.FRZW);
  const frozen = freeze.index(4, 4, 4);
  freeze.life[frozen] = 0;
  freeze.updateFreezeMatter(frozen, 4, 4, 4, MAT.FRZW);
  assert.equal(freeze.get(4, 4, 4), MAT.ICEI);
  assert.equal(freeze.ctype[frozen], MAT.FRZW);

  const anti = new VoxelSimulation(10, 9, 9, 0x4546);
  anti.random = () => 0;
  anti.set(4, 4, 4, MAT.ANAR);
  anti.set(5, 4, 4, MAT.CFLM, -273.15, 100);
  assert.equal(anti.updateAntiAir(anti.index(4, 4, 4), 4, 4, 4), false);
  assert.equal(anti.get(4, 4, 4), MAT.CFLM);
  assert.equal(anti.temperatures[anti.index(5, 4, 4)], 0);
});

test("expired freeze water receives both independent ice chances and anti-air burns every cold flame", () => {
  const freeze = new VoxelSimulation(10, 9, 9, 0x4547);
  const draws = [0.5, 0];
  freeze.random = () => draws.shift() ?? 1;
  freeze.set(4, 4, 4, MAT.FRZW, -153.15, 0);
  assert.equal(freeze.updateFreezeMatter(freeze.index(4, 4, 4), 4, 4, 4, MAT.FRZW), true);
  assert.equal(freeze.get(4, 4, 4), MAT.ICEI);
  assert.equal(freeze.ctype[freeze.index(4, 4, 4)], MAT.FRZW);

  const anti = new VoxelSimulation(10, 9, 9, 0x4548);
  anti.random = () => 0;
  anti.set(4, 4, 4, MAT.ANAR);
  anti.set(5, 4, 4, MAT.CFLM, 800, 100);
  anti.set(4, 4, 5, MAT.CFLM, 900, 100);
  anti.updateAntiAir(anti.index(4, 4, 4), 4, 4, 4);
  assert.equal(anti.get(4, 4, 4), MAT.CFLM);
  assert.equal(anti.temperatures[anti.index(5, 4, 4)], 0);
  assert.equal(anti.temperatures[anti.index(4, 4, 5)], 0);
  assert.equal(anti.air.sampleVoxel(4, 4, 4).pressure, -1);
});

test("gravity dust flares from velocity and Boyle gas controls pressure chemistry", () => {
  const gravity = new VoxelSimulation(10, 9, 9, 0x4646);
  gravity.random = () => 0;
  gravity.set(4, 4, 4, MAT.GRAV, 22, 0, { velocityX: 1 });
  gravity.updateGravityDust(gravity.index(4, 4, 4));
  assert.equal(gravity.life[gravity.index(4, 4, 4)], 48);

  const boyle = new VoxelSimulation(10, 9, 9, 0x4647);
  boyle.random = () => 0;
  boyle.set(4, 4, 4, MAT.BOYL, 27);
  boyle.set(5, 4, 4, MAT.O2);
  assert.equal(boyle.updateBoyleGas(boyle.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(boyle.get(4, 4, 4), MAT.WATR);
  assert.equal(boyle.get(5, 4, 4), MAT.EMPTY);
});

test("anti-air reverses Newtonian force without becoming a gravity source", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x4649);
  sim.set(4, 4, 4, MAT.ANAR);
  sim.gravity.injectVoxel(8, 4, 4, 5);
  sim.gravity.step(sim);
  assert.equal(sim.gravity.sampleVoxel(4, 4, 4).mass, 0);
  const antiAir = sim.index(4, 4, 4);
  sim.random = () => 0;
  assert.equal(sim.tryMove(antiAir, 4, 4, 4, []), true);
  assert.equal(sim.get(3, 4, 4), MAT.ANAR);
});

test("Boyle gas keeps its pressure floor while relaxing the original stencil through depth", () => {
  const sim = new VoxelSimulation(20, 20, 20, 0x4648);
  sim.set(9, 9, 9, MAT.BOYL, 27);
  const [cx, cy, cz] = sim.air.cellForVoxel(9, 9, 9);
  const center = sim.air.index(cx, cy, cz);
  const positiveX = sim.air.index(cx + 1, cy, cz);
  const positiveZ = sim.air.index(cx, cy, cz + 1);
  sim.air.pressure[center] = 10;
  sim.air.pressure[positiveX] = 10;
  sim.air.pressure[positiveZ] = 10;

  sim.updateBoyleGas(sim.index(9, 9, 9), 9, 9, 9);

  assert.equal(sim.air.pressure[center], 10);
  assert.ok(sim.air.pressure[positiveX] < 10);
  assert.ok(sim.air.pressure[positiveZ] < 10);
});

test("refrigerant heats from compression and resist switches phase under energy", () => {
  const refrigerant = new VoxelSimulation(10, 9, 9, 0x4747);
  refrigerant.set(4, 4, 4, MAT.RFRG, 100);
  refrigerant.air.pressure[refrigerant.air.indexForVoxel(4, 4, 4)] = 10;
  refrigerant.updateRefrigerant(refrigerant.index(4, 4, 4), 4, 4, 4);
  assert.ok(refrigerant.temperatures[refrigerant.index(4, 4, 4)] > 103);
  assert.notEqual(refrigerant.tmp[refrigerant.index(4, 4, 4)], 0);

  const solidify = new VoxelSimulation(10, 9, 9, 0x4748);
  solidify.set(4, 4, 4, MAT.RSST);
  solidify.setEnergy(4, 4, 4, MAT.PHOT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  assert.equal(solidify.interactEnergy(solidify.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(solidify.get(4, 4, 4), MAT.RSSS);
  assert.equal(solidify.getEnergy(4, 4, 4), MAT.EMPTY);
  solidify.air.updateBlocked(solidify);
  assert.equal(solidify.air.blocked[solidify.air.indexForVoxel(4, 4, 4)], 1);

  solidify.setEnergy(4, 4, 4, MAT.NEUT, 22, 20, { velocityX: 0, velocityY: 0, velocityZ: 0 });
  assert.equal(solidify.interactEnergy(solidify.index(4, 4, 4), 4, 4, 4), true);
  assert.equal(solidify.get(4, 4, 4), MAT.RSST);
});

test("refrigerant pressure work uses absolute temperature and initializes NaN history", () => {
  const compression = new VoxelSimulation(10, 9, 9, 0x4749);
  compression.set(4, 4, 4, MAT.RFRG, 100);
  compression.air.pressure[compression.air.indexForVoxel(4, 4, 4)] = 10;
  compression.updateRefrigerant(compression.index(4, 4, 4), 4, 4, 4);
  const expected = (100 + 273.15) * (267 / 257) - 273.15;
  assert.ok(Math.abs(compression.temperatures[compression.index(4, 4, 4)] - expected) < 0.001);

  const initialize = new VoxelSimulation(10, 9, 9, 0x474a);
  initialize.set(4, 4, 4, MAT.RFGL, -40, 0, { tmp: 0x7fc00000 });
  initialize.air.pressure[initialize.air.indexForVoxel(4, 4, 4)] = -20;
  initialize.updateRefrigerant(initialize.index(4, 4, 4), 4, 4, 4);
  assert.equal(initialize.temperatures[initialize.index(4, 4, 4)], -40);
  assert.notEqual(initialize.tmp[initialize.index(4, 4, 4)], 0x7fc00000);

  const phaseCycle = new VoxelSimulation(10, 9, 9, 0x474e);
  phaseCycle.set(4, 4, 4, MAT.RFRG, 22, 0, { tmp: 123, tmp2: 456 });
  phaseCycle.air.pressure[phaseCycle.air.indexForVoxel(4, 4, 4)] = 3;
  const phaseIndex = phaseCycle.index(4, 4, 4);
  assert.equal(phaseCycle.applyPhaseChange(phaseIndex, MAT.RFRG), true);
  assert.equal(phaseCycle.types[phaseIndex], MAT.RFGL);
  assert.deepEqual([phaseCycle.tmp[phaseIndex], phaseCycle.tmp2[phaseIndex]], [123, 456]);
  phaseCycle.air.pressure[phaseCycle.air.indexForVoxel(4, 4, 4)] = 1;
  assert.equal(phaseCycle.applyPhaseChange(phaseIndex, MAT.RFGL), true);
  assert.equal(phaseCycle.types[phaseIndex], MAT.RFRG);
  assert.deepEqual([phaseCycle.tmp[phaseIndex], phaseCycle.tmp2[phaseIndex]], [123, 456]);
});

test("resist reactions recreate products and solid resist blocks air during its callback", () => {
  const firework = new VoxelSimulation(10, 9, 9, 0x474b);
  firework.set(4, 4, 4, MAT.RSST, 700, 9, { ctype: MAT.WATR, tmp: 17, tmp2: 23, decoration: 0xff00ff00 });
  firework.set(5, 4, 4, MAT.GUNP);
  assert.equal(firework.updateResist(firework.index(4, 4, 4), 4, 4, 4, MAT.RSST), true);
  const product = firework.index(4, 4, 4);
  assert.equal(firework.types[product], MAT.FIRW);
  assert.equal(firework.temperatures[product], materialById(MAT.FIRW).defaultTemp);
  assert.deepEqual([firework.life[product], firework.ctype[product], firework.tmp[product], firework.tmp2[product], firework.decorations[product]], [0, 0, 0, 0, 0]);
  assert.equal(firework.get(5, 4, 4), MAT.EMPTY);

  const fuse = new VoxelSimulation(10, 9, 9, 0x474c);
  fuse.set(4, 4, 4, MAT.RSST, 900, 1, { tmp: 99 });
  fuse.set(4, 4, 5, MAT.BCOL);
  assert.equal(fuse.updateResist(fuse.index(4, 4, 4), 4, 4, 4, MAT.RSST), true);
  assert.equal(fuse.get(4, 4, 4), MAT.FSEP);
  assert.equal(fuse.life[fuse.index(4, 4, 4)], 50);
  assert.equal(fuse.temperatures[fuse.index(4, 4, 4)], materialById(MAT.FSEP).defaultTemp);

  const solid = new VoxelSimulation(10, 9, 9, 0x474d);
  solid.set(4, 4, 4, MAT.RSSS);
  solid.set(5, 4, 4, MAT.CLNE, 22, 0, { ctype: MAT.WATR });
  solid.set(4, 4, 5, MAT.BCLN, 22, 0, { ctype: MAT.O2 });
  solid.updateResist(solid.index(4, 4, 4), 4, 4, 4, MAT.RSSS);
  const solidIndex = solid.index(4, 4, 4);
  assert.equal(solid.ctype[solidIndex], MAT.WATR);
  assert.equal(solid.tmp[solidIndex], MAT.O2);
  assert.equal(solid.air.blocked[solid.air.indexForVoxel(4, 4, 4)], 1);
});

test("soap forms reciprocal 3D bubble links and spring forces remain linked after movement", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x4848);
  sim.set(4, 5, 5, MAT.SOAP);
  sim.set(6, 5, 5, MAT.SOAP);
  const first = sim.index(4, 5, 5);
  const second = sim.index(6, 5, 5);
  sim.ctype[first] = 1;
  sim.ctype[second] = 1;
  sim.life[first] = sim.life[second] = 10;
  sim.updateSoap(first, 4, 5, 5);
  assert.equal(sim.tmp[first], second);
  assert.equal(sim.tmp2[second], first);
  assert.ok(sim.ctype[first] & 2);
  assert.ok(sim.ctype[second] & 4);
  assert.ok(sim.velocityX[first] < 0);
  assert.ok(sim.velocityX[second] > 0);

  const destination = sim.index(5, 5, 5);
  sim.move(first, destination);
  assert.equal(sim.tmp2[second], destination);
  assert.equal(sim.tmp[destination], second);
});

test("soap pressure activates bubbles, blends oil motion and washes decoration", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x4949);
  sim.set(5, 5, 5, MAT.SOAP, 20, 0, { velocityX: 4 });
  sim.set(6, 5, 5, MAT.OIL, 22, 0, { velocityX: 0 });
  sim.set(5, 6, 5, MAT.STNE, 22, 0, { decoration: 0xffffffff });
  sim.air.pressure[sim.air.indexForVoxel(5, 5, 5)] = 1;
  sim.updateSoap(sim.index(5, 5, 5), 5, 5, 5);
  const soap = sim.index(5, 5, 5);
  assert.equal(sim.ctype[soap] & 1, 1);
  assert.equal(sim.life[soap], 10);
  assert.equal(sim.velocityX[soap], 1);
  assert.equal(sim.velocityX[sim.index(6, 5, 5)], 1);
  assert.equal(sim.decorations[sim.index(5, 6, 5)] >>> 24, 216);
});

test("changing soap type detaches both sides of its bubble topology", () => {
  const sim = new VoxelSimulation(10, 9, 9, 0x4a4a);
  sim.set(4, 4, 4, MAT.SOAP);
  sim.set(5, 4, 4, MAT.SOAP);
  const first = sim.index(4, 4, 4);
  const second = sim.index(5, 4, 4);
  sim.ctype[first] = 3;
  sim.tmp[first] = second;
  sim.ctype[second] = 5;
  sim.tmp2[second] = first;
  sim.transform(first, MAT.WATR, 22);
  assert.equal(sim.get(4, 4, 4), MAT.WATR);
  assert.equal(sim.ctype[second] & 4, 0);
  assert.equal(sim.tmp2[second], -1);
});

test("SOAP detaches before portal and pipe transport serializes its particle fields", () => {
  const portal = new VoxelSimulation(14, 10, 8, 0x5152);
  portal.set(5, 5, 4, MAT.PRTI);
  portal.set(6, 5, 4, MAT.SOAP);
  portal.set(7, 5, 4, MAT.SOAP);
  const captured = portal.index(6, 5, 4);
  const mate = portal.index(7, 5, 4);
  portal.attachSoap(captured, mate);
  portal.updatePortal(portal.index(5, 5, 4), 5, 5, 4, MAT.PRTI);
  assert.equal(portal.types[captured], MAT.EMPTY);
  assert.equal(portal.ctype[mate] & 6, 0);
  assert.equal(portal.tmp2[mate], -1);
  const queued = portal.portalQueues.flat(2).find((particle) => particle?.type === MAT.SOAP);
  assert.ok(queued);
  assert.equal(queued.ctype & 6, 0);
  assert.equal(queued.tmp, -1);
  assert.equal(queued.tmp2, -1);

  const pipe = new VoxelSimulation(12, 9, 8, 0x5153);
  pipe.set(4, 4, 4, MAT.PIPE);
  pipe.set(5, 4, 4, MAT.SOAP);
  pipe.set(6, 4, 4, MAT.SOAP);
  const soap = pipe.index(5, 4, 4);
  const pipeMate = pipe.index(6, 4, 4);
  pipe.attachSoap(soap, pipeMate);
  pipe.storeParticleInPipe(pipe.index(4, 4, 4), soap, MAT.SOAP);
  assert.equal(pipe.types[soap], MAT.EMPTY);
  assert.equal(pipe.ctype[pipeMate] & 6, 0);
  assert.equal(pipe.tmp3[pipe.index(4, 4, 4)], -1);
  assert.equal(pipe.tmp4[pipe.index(4, 4, 4)] & 6, 0);
});

test("TRON creates a six-direction head, grows its trail and retires the old head", () => {
  const sim = new VoxelSimulation(14, 11, 11, 0x4b4b);
  const head = sim.index(5, 5, 5);
  sim.set(5, 5, 5, MAT.TRON, 0, 100, { tmp: 0x10001, tmp2: 4, ctype: 0x123456 });
  sim.updateTron(head, 5, 5, 5);
  const next = sim.index(6, 5, 5);
  assert.equal(sim.get(6, 5, 5), MAT.TRON);
  assert.equal(sim.tmp[next] & 1, 1);
  assert.equal(sim.tmp2[next], 5);
  assert.equal(sim.life[next], 7);
  assert.equal(sim.ctype[next], 0x123456);
  assert.equal(sim.tmp[head] & 1, 0);
  assert.equal(sim.life[head], 5);
});

test("TRON sight turns around obstacles and marks a trapped head for death", () => {
  const turning = new VoxelSimulation(12, 10, 10, 0x4c4c);
  const head = turning.index(5, 5, 5);
  turning.set(5, 5, 5, MAT.TRON, 0, 5, { tmp: 0x10001, tmp2: 4 });
  turning.set(6, 5, 5, MAT.STNE);
  turning.updateTron(head, 5, 5, 5);
  assert.equal(turning.get(5, 6, 5), MAT.TRON);
  assert.equal((turning.tmp[turning.index(5, 6, 5)] >> 5) & 7, 2);

  const trapped = new VoxelSimulation(10, 9, 9, 0x4d4d);
  const trappedHead = trapped.index(4, 4, 4);
  trapped.set(4, 4, 4, MAT.TRON, 0, 5, { tmp: 0x10001, tmp2: 4 });
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    trapped.set(4 + dx, 4 + dy, 4 + dz, MAT.DMND);
  }
  trapped.updateTron(trappedHead, 4, 4, 4);
  assert.equal(trapped.tmp[trappedHead] & 0x10, 0x10);
  assert.equal(trapped.tmp[trappedHead] & 1, 0);
  assert.equal(trapped.life[trappedHead], 4);
});

test("TRON no-die trails counteract shared life decay", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x4e4e);
  const trail = sim.index(4, 4, 4);
  sim.set(4, 4, 4, MAT.TRON, 0, 3, { tmp: 0x8, tmp2: 4 });
  sim.updateTron(trail, 4, 4, 4);
  assert.equal(sim.life[trail], 4);
  sim.applyAutomaticLifeDecay();
  assert.equal(sim.life[trail], 3);
});

test("stickmen enforce unique slots, accept controls, carry elements and respawn", () => {
  const sim = new VoxelSimulation(18, 12, 12, 0x4f4f);
  for (let x = 0; x < sim.width; x += 1) for (let z = 0; z < sim.depth; z += 1) sim.set(x, 1, z, MAT.DMND);
  assert.equal(sim.set(5, 5, 5, MAT.STKM), true);
  assert.equal(sim.set(9, 5, 5, MAT.STKM), false);
  assert.deepEqual(sim.actorSpawns[0], [5, 5, 5]);
  let actor = sim.actorIndex(MAT.STKM);
  assert.equal(sim.ctype[actor], MAT.DUST);

  sim.setActorCommand(0, 0x02, true);
  for (let frame = 0; frame < 2; frame += 1) {
    actor = sim.actorIndex(MAT.STKM);
    sim.updateActor(actor, ...sim.coords(actor), MAT.STKM);
  }
  sim.setActorCommand(0, 0x02, false);
  actor = sim.actorIndex(MAT.STKM);
  assert.ok(sim.coords(actor)[0] > 5);

  const [x, y, z] = sim.coords(actor);
  sim.set(x + 1, y, z, MAT.WATR);
  sim.interactActor(actor, x, y, z);
  assert.equal(sim.ctype[actor], MAT.WATR);

  sim.random = () => 1;
  sim.air.pressure[sim.air.indexForVoxel(x, y, z)] = 8;
  sim.updateActor(actor, x, y, z, MAT.STKM);
  assert.equal(sim.actorIndex(MAT.STKM), -1);
  sim.respawnActors();
  assert.equal(sim.get(5, 5, 5), MAT.STKM);
  assert.equal(sim.life[sim.index(5, 5, 5)], 100);
});

test("fighter AI seeks the nearest player and fires a dangerous carried element", () => {
  const sim = new VoxelSimulation(22, 12, 12, 0x5050);
  for (let x = 0; x < sim.width; x += 1) for (let z = 0; z < sim.depth; z += 1) sim.set(x, 1, z, MAT.DMND);
  sim.set(13, 5, 5, MAT.STKM);
  sim.set(7, 5, 5, MAT.FIGH, 36.6, 100, { ctype: MAT.ACID, tmp3: 40, tmp4: 1 });
  const fighter = sim.index(7, 5, 5);
  sim.updateActor(fighter, 7, 5, 5, MAT.FIGH);
  const active = sim.actorIndex(MAT.FIGH);
  assert.equal(sim.tmp2[active], 1);
  assert.equal(sim.tmp4[active], 1);
  assert.ok(sim.types.includes(MAT.ACID));
});

test("AMTR preserves upstream immune types and dies on its fourth reactive contact", () => {
  const sim = new VoxelSimulation(11, 11, 11, 0x5051);
  const center = sim.index(5, 5, 5);
  sim.random = () => 0.5;
  sim.set(5, 5, 5, MAT.AMTR);
  sim.set(4, 4, 4, MAT.DMND);
  sim.set(5, 4, 4, MAT.CLNE);
  sim.set(6, 4, 4, MAT.PCLN);
  sim.set(4, 5, 4, MAT.VOID);
  sim.set(5, 5, 4, MAT.BHOL);
  sim.set(6, 5, 4, MAT.NBHL);
  sim.set(4, 6, 4, MAT.PRTI);
  sim.set(5, 6, 4, MAT.PRTO);
  for (const [x, y, z] of [[6, 6, 4], [4, 4, 5], [5, 4, 5], [6, 4, 5]]) sim.set(x, y, z, MAT.SAND);

  sim.updateAntimatter(center, 5, 5, 5);

  assert.equal(sim.get(5, 5, 5), MAT.EMPTY);
  assert.equal(sim.get(6, 4, 5), MAT.SAND);
  for (const [x, y, z] of [[6, 6, 4], [4, 4, 5], [5, 4, 5]]) assert.equal(sim.get(x, y, z), MAT.EMPTY);
  for (const [x, y, z, type] of [
    [4, 4, 4, MAT.DMND], [5, 4, 4, MAT.CLNE], [6, 4, 4, MAT.PCLN],
    [4, 5, 4, MAT.VOID], [5, 5, 4, MAT.BHOL], [6, 5, 4, MAT.NBHL],
    [4, 6, 4, MAT.PRTI], [5, 6, 4, MAT.PRTO],
  ]) assert.equal(sim.get(x, y, z), type);
  assert.equal(sim.air.sampleVoxel(5, 5, 5).pressure, -6);
});

test("AMTR has the upstream one-in-ten photon replacement branch", () => {
  const sim = new VoxelSimulation(9, 9, 9, 0x5052);
  const center = sim.index(4, 4, 4);
  sim.random = () => 0;
  sim.set(4, 4, 4, MAT.AMTR);
  sim.set(3, 3, 3, MAT.WATR);

  assert.equal(sim.updateAntimatter(center, 4, 4, 4), false);
  assert.equal(sim.get(3, 3, 3), MAT.EMPTY);
  assert.equal(sim.getEnergy(3, 3, 3), MAT.PHOT);
  assert.equal(sim.life[center], 1);
  assert.equal(sim.air.sampleVoxel(4, 4, 4).pressure, -2);
});

test("actor spawn and portal state survive snapshots and version-six saves", () => {
  const sim = new VoxelSimulation(12, 10, 10, 0x5151);
  sim.set(4, 6, 4, MAT.STKM2);
  sim.actorPortalLocks[1] = true;
  const snapshot = sim.createSnapshot();
  sim.clear();
  sim.restoreSnapshot(snapshot);
  assert.deepEqual(sim.actorSpawns[1], [4, 6, 4]);
  assert.equal(sim.actorPortalLocks[1], true);
  const save = sim.serialize();
  assert.equal(save.version, 6);
  const restored = new VoxelSimulation(12, 10, 10, 0x5152);
  restored.deserialize(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(restored.actorSpawns[1], [4, 6, 4]);
  assert.equal(restored.actorPortalLocks[1], true);
});
