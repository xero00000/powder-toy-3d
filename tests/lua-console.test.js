// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { MAT } from "../src/materials.js";
import { PowderLuaRuntime } from "../src/lua-console.js";
import { GRAPHICS_MODE, graphicsStyle } from "../src/graphics-modes.js";
import { VoxelSimulation } from "../src/simulation.js";

function harness(seed = 1, instructionLimit = 600000) {
  const simulation = new VoxelSimulation(10, 9, 8, seed);
  const calls = { before: 0, after: 0, paused: false, view: null, depth: 4, radius: 2, renderer: {}, materialRefreshes: 0, ui: new Map(), consoleOpen: true };
  const context = {
    simulation,
    currentDepth: () => calls.depth,
    setDepth: (depth) => { calls.depth = depth; },
    windowSize: () => [1280, 720],
    brushRadius: () => calls.radius,
    setBrushRadius: (radius) => { calls.radius = radius; },
    mousePosition: () => [3, 2, calls.depth],
    activeTool: () => MAT.SAND,
    activeMenu: () => 2,
    refreshMaterials: () => { calls.materialRefreshes += 1; },
    upsertLuaComponent: (component) => { calls.ui.set(component.id, component); },
    consoleOpen: () => calls.consoleOpen,
    setConsoleOpen: (open) => { calls.consoleOpen = open; },
    setRendererSetting: (field, value) => { calls.renderer[field] = value; },
    beforeMutate: () => { calls.before += 1; },
    onMutate: () => { calls.after += 1; },
    paused: () => calls.paused,
    setPaused: (paused) => { calls.paused = paused; },
    setView: (view) => { calls.view = view; },
  };
  return { simulation, calls, context, runtime: new PowderLuaRuntime({ instructionLimit }) };
}

test("Lua console is stateful and exposes safe standard libraries", () => {
  const { runtime, context } = harness();
  assert.equal(runtime.execute("counter = (counter or 0) + 1; return counter, math.floor(9.8)", context), "1\t9");
  assert.equal(runtime.execute("return counter + 1, string.upper('powder')", context), "2\tPOWDER");
  assert.equal(runtime.execute("return io, os, package, debug", context), "nil\tnil\tnil\tnil");
  assert.equal(runtime.execute("print('ready', 195)", context), "ready\t195");
});

test("Lua exposes the upstream BitOp compatibility surface with signed 32-bit results", () => {
  const { runtime, context } = harness();
  assert.equal(runtime.execute(`
    return bit.tobit(0xffffffff), bit.bnot(0), bit.band(0xff, 0x3c, 0x0f), bit.bor(0x10, 3),
      bit.bxor(0xaa, 0xff), bit.lshift(1, 31), bit.rshift(-1, 28), bit.arshift(-8, 2),
      bit.rol(0x12345678, 8), bit.ror(0x12345678, 8), bit.bswap(0x12345678),
      bit.tohex(0xdeadbeef), bit.tohex(0xdeadbeef, -4)
  `, context), "-1\t-1\t12\t19\t85\t-2147483648\t15\t-2\t878082066\t2014458966\t2018915346\tdeadbeef\tBEEF");
});

test("Lua virtual filesystem is sandboxed, mutable and persistent without host access", () => {
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const first = harness(101);
  first.runtime.fileSystem.storage = storage;
  assert.equal(first.runtime.execute(`
    fs.makeDirectory('/scripts')
    fs.write('/scripts/demo.lua', 'counter = 40')
    fs.append('/scripts/demo.lua', ' + 2')
    fs.copy('/scripts/demo.lua', '/scripts/copy.lua')
    fs.move('/scripts/copy.lua', '/scripts/moved.lua')
    local names = fs.list('/scripts')
    return fs == fileSystem, fs.exists('/scripts'), fs.isDirectory('/scripts'), fs.isFile('/scripts/demo.lua'),
      table.concat(names, ','), fs.read('/scripts/demo.lua')
  `, first.context), "true\ttrue\ttrue\ttrue\tdemo.lua,moved.lua\tcounter = 40 + 2");
  assert.throws(() => first.runtime.execute("return fs.read('../outside')", first.context), /cannot escape the script sandbox/);
  const second = harness(102);
  second.runtime.fileSystem.storage = storage;
  second.runtime.fileSystem.restore();
  assert.equal(second.runtime.execute("return fs.read('/scripts/moved.lua')", second.context), "counter = 40 + 2");
});

test("Lua loadfile and dofile execute sandboxed library scripts under the shared runtime", () => {
  const { runtime, context } = harness(103);
  runtime.fileSystem.makeDirectory("/scripts");
  runtime.fileSystem.write("/scripts/module.lua", "included = (included or 0) + 1; return included, 'ok'");
  assert.equal(runtime.execute("local chunk = loadfile('/scripts/module.lua'); return chunk()", context), "1\tok");
  assert.equal(runtime.execute("return dofile('/scripts/module.lua')", context), "2\tok");
  assert.throws(() => runtime.execute("return dofile('/missing.lua')", context), /virtual script not found/);
});

test("Lua simulation API creates particles and edits complete particle fields with one undo checkpoint", () => {
  const { runtime, context, simulation, calls } = harness(2);
  const expected = simulation.index(2, 3, 2);
  const output = runtime.execute(`
    local p = sim.partCreate(-1, 2, 3, 2, elements.DEFAULT_PT_WATR)
    sim.partProperty(p, "temp", 125.5)
    sim.partProperty(p, "life", -123456)
    return p, sim.partProperty(p, "type"), sim.partProperty(p, "temp"), sim.partProperty(p, "life")
  `, context);
  assert.equal(output, `${expected}\t${MAT.WATR}\t125.5\t-123456`);
  assert.equal(simulation.get(2, 3, 2), MAT.WATR);
  assert.equal(calls.before, 1);
  assert.equal(calls.after, 1);
});

test("Lua exposes live chamber dimensions and moves matter and energy atomically in 3D", () => {
  const { runtime, context, simulation, calls } = harness(21);
  const matter = simulation.index(1, 2, 3);
  const movedMatter = simulation.index(7, 6, 5);
  const energy = simulation.index(2, 2, 2);
  const movedEnergy = simulation.index(8, 7, 6);
  simulation.set(1, 2, 3, MAT.SAND);
  simulation.setEnergy(2, 2, 2, MAT.PHOT);
  assert.equal(runtime.execute(`
    local mx, my, mz = sim.partPosition(${matter}, 7, 6, 5)
    local ex, ey, ez = sim.partPosition(${energy}, 8, 7, 6)
    return sim.XRES, sim.YRES, sim.ZRES, mx, my, mz, ex, ey, ez,
      sim.partID(7, 6, 5), sim.partID(8, 7, 6)
  `, context), `10\t9\t8\t7\t6\t5\t8\t7\t6\t${movedMatter}\t${movedEnergy}`);
  assert.equal(simulation.get(1, 2, 3), MAT.EMPTY);
  assert.equal(simulation.get(7, 6, 5), MAT.SAND);
  assert.equal(simulation.getEnergy(2, 2, 2), MAT.EMPTY);
  assert.equal(simulation.getEnergy(8, 7, 6), MAT.PHOT);
  assert.equal(calls.before, 1);
  assert.equal(calls.after, 1);
});

test("Lua coordinate and field APIs reject out-of-bounds access without edge clamping", () => {
  const { runtime, context, simulation } = harness(22);
  const particle = simulation.index(1, 1, 1);
  simulation.set(1, 1, 1, MAT.DUST);
  assert.throws(() => runtime.execute(`return sim.partProperty(${particle}, 'x', 99)`, context), /outside the chamber/);
  assert.throws(() => runtime.execute("return sim.pressure3d(-1, 0, 0)", context), /outside the chamber/);
  assert.throws(() => runtime.execute("return tpt.delete(99, 0, 0)", context), /outside the chamber/);
  assert.equal(simulation.get(1, 1, 1), MAT.DUST);
});

test("legacy tpt helpers and volumetric field accessors modify the chamber", () => {
  const { runtime, context, simulation } = harness(3);
  simulation.set(1, 1, 4, MAT.SAND);
  simulation.set(2, 1, 4, MAT.WATR);
  assert.equal(runtime.execute("return tpt.set_property('life', 9, 'all')", context), "2");
  assert.equal(simulation.life[simulation.index(1, 1, 4)], 9);
  assert.equal(simulation.life[simulation.index(2, 1, 4)], 9);
  assert.equal(runtime.execute("return sim.pressure3d(4, 4, 3, 12.5), sim.pressure3d(4, 4, 3)", context), "12.5\t12.5");
  assert.equal(runtime.execute("return elements.property(elements.DEFAULT_PT_ACID, 'PhotonReflectWavelengths')", context), String(0x1fe001fe));
});

test("Lua compatibility helpers enumerate neighbors and change particle types", () => {
  const { runtime, context, simulation } = harness(31);
  const center = simulation.index(4, 4, 4);
  const sand = simulation.index(5, 4, 4);
  const water = simulation.index(4, 5, 4);
  const photon = simulation.index(4, 4, 5);
  simulation.set(4, 4, 4, MAT.DUST);
  simulation.set(5, 4, 4, MAT.SAND);
  simulation.set(4, 5, 4, MAT.WATR);
  simulation.setEnergy(4, 4, 5, MAT.PHOT);
  assert.equal(runtime.execute(`
    local flat = sim.partNeighbors(4, 4, 1)
    local volume = sim.partNeighbors3d(4, 4, 4, 1)
    return #flat, #volume, sim.partExists(${center}), sim.partExists(99999)
  `, context), "2\t3\ttrue\tfalse");
  assert.equal(runtime.execute(`sim.partChangeType(${sand}, elements.DEFAULT_PT_WATR); return sim.partProperty(${sand}, 'type')`, context), String(MAT.WATR));
  assert.equal(simulation.get(5, 4, 4), MAT.WATR);
  assert.equal(runtime.execute(`local only = sim.partNeighbors3d(4, 4, 4, 1, elements.DEFAULT_PT_PHOT); return #only, only[1]`, context), `1\t${photon}`);
  assert.equal(simulation.get(4, 5, 4), MAT.WATR);
  assert.equal(water, simulation.index(4, 5, 4));
});

test("Lua field, setting, count and reset compatibility surfaces retain 3D state", () => {
  const { runtime, context, simulation } = harness(32);
  const water = simulation.index(2, 2, 4);
  simulation.set(2, 2, 4, MAT.WATR, 500);
  simulation.setEnergy(2, 2, 4, MAT.PHOT, 800);
  assert.equal(runtime.execute(`
    sim.velocityX3d(2, 2, 4, 1.25)
    sim.velocityY3d(2, 2, 4, -2.5)
    sim.velocityZ3d(2, 2, 4, 3.75)
    sim.edgeVelocity(4, -5, 6)
    sim.edgePressure(7.5)
    sim.vorticityCoeff(0.65)
    sim.convectionMode(1)
    sim.decoSpace(2)
    return sim.velocityX3d(2, 2, 4), sim.velocityY3d(2, 2, 4), sim.velocityZ3d(2, 2, 4),
      sim.elementCount(elements.DEFAULT_PT_WATR), sim.partCount(), sim.edgePressure(), sim.vorticityCoeff()
  `, context), "1.25\t-2.5\t3.75\t1\t1440\t7.5\t0.65");
  assert.deepEqual([simulation.air.edgeVelocityX, simulation.air.edgeVelocityY, simulation.air.edgeVelocityZ], [4, -5, 6]);
  assert.equal(simulation.air.convectionMode, 1);
  assert.equal(simulation.decorationColorSpace, 2);
  runtime.execute("sim.resetTemp(); sim.resetPressure(); sim.resetVelocity()", context);
  assert.equal(simulation.temperatures[water], 20);
  assert.equal(simulation.energyTemperatures[water], 922);
  assert.equal(simulation.air.pressure[simulation.air.indexForVoxel(2, 2, 4)], 7.5);
  assert.equal(simulation.air.velocityX[simulation.air.indexForVoxel(2, 2, 4)], 0);
});

test("Lua exposes read-only upstream element tables and planar or volumetric clearing", () => {
  const { runtime, context, simulation } = harness(33);
  simulation.fillBox(1, 1, 4, 3, 3, 4, MAT.SAND);
  simulation.set(2, 2, 5, MAT.WATR);
  assert.equal(runtime.execute(`
    local acid = elements.element(elements.DEFAULT_PT_ACID)
    return elements.getByName('ACID'), acid.Identifier, acid.Colour,
      acid.DefaultProperties.temp, elements.property(elements.DEFAULT_PT_ACID, 'Colour')
  `, context), `${MAT.ACID}\tDEFAULT_PT_ACID\t15554047\t22\t15554047`);
  assert.equal(runtime.execute("return sim.clearRect(1, 1, 2, 2, 4), sim.clearBox(2, 2, 5, 1, 1, 1)", context), "4\t1");
  assert.equal(simulation.get(1, 1, 4), MAT.EMPTY);
  assert.equal(simulation.get(3, 3, 4), MAT.SAND);
  assert.equal(simulation.get(2, 2, 5), MAT.EMPTY);
});

test("Lua allocates, mutates, simulates and frees real runtime elements", () => {
  const { runtime, context, simulation, calls } = harness(331);
  const created = runtime.execute(`
    custom = elements.allocate('POWDER3', 'AQUA')
    elements.element(custom, {
      Name = 'Aqua Crystal', Description = 'A scripted solid', Colour = 0x23cfff,
      MenuVisible = true, MenuSection = elements.SC_SPECIAL,
      Properties = elements.TYPE_SOLID | elements.PROP_HOT_GLOW,
      DefaultProperties = { temp = 33, life = 4, tmp = 7 },
      Update = function(i, x, y, surround, neighbors, z)
        sim.partProperty(i, 'life', sim.partProperty(i, 'life') + 1)
        return false
      end
    })
    local p = sim.partCreate(-1, 4, 4, 4, custom)
    local definition = elements.element(custom)
    return custom, elements.POWDER3_PT_AQUA, elements.getByName('AQUA'), p,
      definition.Name, definition.Colour, definition.Properties, definition.DefaultProperties.tmp
  `, context);
  const index = simulation.index(4, 4, 4);
  assert.equal(created, `255\t255\t255\t${index}\tAqua Crystal\t2347007\t2052\t7`);
  assert.equal(simulation.types[index], 255);
  assert.equal(simulation.temperatures[index], 33);
  assert.equal(simulation.life[index], 4);
  simulation.step();
  simulation.step();
  assert.equal(simulation.types[index], 255);
  assert.equal(simulation.life[index], 6);
  assert.ok(calls.materialRefreshes >= 2);
  assert.equal(runtime.execute("elements.free(custom); return elements.exists(255), elements.POWDER3_PT_AQUA", context), "false\tnil");
  assert.equal(simulation.types[index], MAT.EMPTY);
});

test("Lua element graphics callbacks expose upstream modes, cache results and stay simulation-read-only", () => {
  const { runtime, context, simulation } = harness(332, 12000);
  const index = simulation.index(4, 4, 4);
  assert.equal(runtime.execute(`
    visual = elements.allocate('POWDER3', 'VISUAL')
    graphicsCalls = 0
    elements.property(visual, 'Graphics', function(i, r, g, b)
      graphicsCalls = graphicsCalls + 1
      return 1, ren.PMODE_GLOW | ren.PMODE_ADD | ren.NO_DECO | ren.FIRE_ADD,
        192, 12, 34, 56, 128, 240, 120, 30
    end)
    sim.partCreate(-1, 4, 4, 4, visual)
    return ren.PMODE_GLOW, ren.NO_DECO, ren.FIRE_ADD
  `, context), `${GRAPHICS_MODE.PMODE_GLOW}\t${GRAPHICS_MODE.NO_DECO}\t${GRAPHICS_MODE.FIRE_ADD}`);
  const first = simulation.customElementGraphics(255, index, 1, 2, 3);
  const second = simulation.customElementGraphics(255, index, 90, 91, 92);
  assert.deepEqual(second, first);
  assert.equal(runtime.execute("return graphicsCalls", context), "1");
  assert.equal(first.pixelMode, GRAPHICS_MODE.PMODE_GLOW | GRAPHICS_MODE.PMODE_ADD | GRAPHICS_MODE.NO_DECO | GRAPHICS_MODE.FIRE_ADD);
  assert.deepEqual([first.alpha, first.red, first.green, first.blue], [192, 12, 34, 56]);
  const style = graphicsStyle(first);
  assert.equal(style.visible, true);
  assert.equal(style.noDecoration, true);
  assert.equal(style.fireBlend, 128 / 255);

  runtime.execute(`elements.property(visual, 'Graphics', function(i, r, g, b)
    sim.partProperty(i, 'life', 99)
    return 0, ren.PMODE_FLAT, 255, r, g, b
  end)`, context);
  assert.equal(simulation.customElementGraphics(255, index, 7, 8, 9), null);
  assert.equal(simulation.life[index], 0);
  assert.match(runtime.output.at(-1), /mutation is restricted during graphics callbacks/);
});

test("Lua scripted drawing bridges particles, walls and simulation tools", () => {
  const { runtime, context, simulation, calls } = harness(34);
  simulation.fillBox(6, 1, 4, 7, 2, 4, MAT.SAND);
  simulation.set(8, 7, 4, MAT.WATR, 20);
  const output = runtime.execute(`
    local point = sim.createParts(1, 1, 0, 0, elements.DEFAULT_PT_SAND)
    local line = sim.createLine(2, 1, 4, 1, 0, 0, elements.DEFAULT_PT_DUST)
    local box = sim.createBox(1, 2, 2, 3, elements.DEFAULT_PT_STNE)
    local flood = sim.floodParts(6, 1, elements.DEFAULT_PT_WATR)
    sim.createWalls(5, 5, 0, 0, 8)
    sim.toolBrush(8, 7, 0, 0, 0)
    return point, line, box, flood
  `, context);
  assert.equal(output, "1\t3\t4\t4");
  assert.equal(simulation.get(1, 1, 4), MAT.SAND);
  assert.equal(simulation.get(4, 1, 4), MAT.DUST);
  assert.equal(simulation.get(2, 3, 4), MAT.STNE);
  assert.equal(simulation.get(7, 2, 4), MAT.WATR);
  assert.equal(simulation.wallAtVoxel(5, 5, 4), 8);
  assert.equal(simulation.temperatures[simulation.index(8, 7, 4)], 120);
  assert.equal(calls.before, 1);
  assert.equal(calls.after, 1);
});

test("Lua decoration drawing preserves upstream RGBA and blend constants", () => {
  const { runtime, context, simulation } = harness(35);
  simulation.fillBox(1, 1, 4, 4, 2, 4, MAT.STNE);
  assert.equal(runtime.execute(`
    sim.decoBrush(1, 1, 0, 0, 17, 34, 51, 255, sim.DECO_DRAW)
    sim.decoLine(2, 1, 4, 1, 0, 0, 68, 85, 102, 255, sim.DECO_DRAW)
    sim.decoBox(1, 2, 2, 2, 119, 136, 153, 255, sim.DECO_DRAW)
    sim.decoColor(10, 20, 30, 40)
    return sim.decoColor(), sim.DECO_SMUDGE, sim.NUM_DECOSPACES
  `, context), "671749150\t6\t4");
  assert.equal(simulation.decorations[simulation.index(1, 1, 4)], 0xff112233);
  assert.equal(simulation.decorations[simulation.index(4, 1, 4)], 0xff445566);
  assert.equal(simulation.decorations[simulation.index(2, 2, 4)], 0xff778899);
  assert.equal(runtime.execute("return sim.floodDeco(1, 2, 1, 2, 3, 255)", context), "2");
  assert.equal(simulation.decorations[simulation.index(1, 2, 4)], 0xff010203);
});

test("Lua render, pause and physics controls bridge to the live application context", () => {
  const { runtime, context, calls, simulation } = harness(4);
  const output = runtime.execute("ren.renderMode('heat'); sim.paused(true); sim.gravityMode(2); return sim.paused(), sim.gravityMode()", context);
  assert.equal(output, "true\t2");
  assert.equal(calls.view, "heat");
  assert.equal(calls.paused, true);
  assert.equal(simulation.gravityMode, 2);
});

test("Lua renderer and interface aliases expose live 3D application state", () => {
  const { runtime, context, calls } = harness(41);
  const output = runtime.execute(`
    local width, height = ui.windowSize()
    ui.brushRadius(5)
    ren.depth3d(6)
    ren.grid(3)
    ren.decorations(false)
    local rx, ry = interface.brushRadius()
    local mx, my, mz = ui.mousePosition()
    return interface == ui, evt == event, width, height, rx, ry, mx, my, mz,
      ui.activeTool(), ui.activeMenu(), ren.depth3d(), ren.grid(), ren.decorations()
  `, context);
  assert.equal(output, `true\ttrue\t1280\t720\t5\t5\t3\t2\t6\t${MAT.SAND}\t2\t6\t3\tfalse`);
  assert.equal(calls.depth, 6);
  assert.equal(calls.radius, 5);
  assert.deepEqual(calls.renderer, { grid: 3, decorations: false });
});

test("Lua mutable UI components retain state and dispatch browser-side actions", () => {
  const { runtime, context, calls } = harness(411);
  assert.equal(runtime.execute(`
    clicks = 0
    panel = ui.window(20, 30, 260, 150)
    title = ui.label(12, 10, 220, 24, 'Script controls')
    run = ui.button(12, 42, 110, 28, 'Run')
    enabled = ui.checkbox(12, 80, 160, 24, 'Enabled')
    level = ui.slider(12, 112, 220, 20, 20)
    run:action(function(self) clicks = clicks + 1; self:text('Ran '..clicks) end)
    enabled:action(function(self, checked) feature = checked end)
    level:onValueChanged(function(self, value) amount = value end)
    panel:addComponent(title); panel:addComponent(run); panel:addComponent(enabled); panel:addComponent(level)
    ui.showWindow(panel)
    local px, py = panel:position(); local width, height = panel:size()
    return px, py, width, height, run:text(), enabled:checked(), level:steps()
  `, context), "20\t30\t260\t150\tRun\tfalse\t20");
  assert.equal(calls.ui.get(1).shown, true);
  assert.deepEqual(calls.ui.get(1).children, [2, 3, 4, 5]);
  runtime.invokeUiEvent(3, "action", [], context);
  runtime.invokeUiEvent(4, "action", [true], context);
  runtime.invokeUiEvent(5, "onValueChanged", [13], context);
  assert.equal(runtime.execute("return clicks, feature, amount, run:text()", context), "1\ttrue\t13\tRan 1");
  assert.equal(calls.ui.get(3).text, "Ran 1");
  runtime.closeUiWindow(1, context);
  assert.equal(calls.ui.get(1).shown, false);
});

test("registered Lua tick callbacks persist and run under the instruction guard", () => {
  const { runtime, context, simulation, calls } = harness(5);
  const particle = simulation.index(3, 3, 3);
  simulation.set(3, 3, 3, MAT.SAND, 22, 1);
  runtime.execute(`
    tracked = ${particle}
    event.register(event.tick, function()
      sim.partProperty(tracked, "life", sim.partProperty(tracked, "life") + 2)
    end)
  `, context);
  runtime.dispatch("tick", context);
  runtime.dispatch("tick", context);
  assert.equal(simulation.life[particle], 5);
  assert.equal(calls.before, 0);
  assert.equal(calls.after, 2);
});

test("Lua scripts are stopped at a bounded instruction budget", () => {
  const { runtime, context } = harness(6, 10000);
  assert.throws(() => runtime.execute("while true do end", context), /exceeded 10000 instructions/);
});
