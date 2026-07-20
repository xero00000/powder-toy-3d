// SPDX-License-Identifier: GPL-3.0-or-later

import lua from "fengari/src/lua.js";
import lauxlib from "fengari/src/lauxlib.js";
import { to_jsstring, to_luastring } from "fengari/src/fengaricore.js";
import { luaopen_base } from "fengari/src/lbaselib.js";
import { luaopen_coroutine } from "fengari/src/lcorolib.js";
import { luaopen_math } from "fengari/src/lmathlib.js";
import { luaopen_string } from "fengari/src/lstrlib.js";
import { luaopen_table } from "fengari/src/ltablib.js";
import { luaopen_utf8 } from "fengari/src/lutf8lib.js";
import { DECORATION_MODE } from "./simulation.js";
import { GRAPHICS_MODE } from "./graphics-modes.js";
import { LuaVirtualFileSystem } from "./lua-filesystem.js";
import {
  MAT, MATERIALS, UPSTREAM_TOOLS, UPSTREAM_WALLS, allMaterials, allocateRuntimeMaterial,
  freeRuntimeMaterial, isRuntimeMaterial, loadDefaultRuntimeMaterial, materialById, updateRuntimeMaterial,
} from "./materials.js";

const INSTRUCTION_GRANULARITY = 2000;
const DEFAULT_INSTRUCTION_LIMIT = 600000;
const EVENT = Object.freeze({ tick: 1, presim: 2 });
const EVENT_NAME = new Map([[EVENT.tick, "tick"], [EVENT.presim, "presim"]]);
const VIEW_MODES = ["clarity", "cinematic", "xray", "heat", "pressure", "velocity", "gravity", "basic", "fancy", "fire", "blob", "persistent", "gradient", "life", "air"];
const FIELD_MAP = Object.freeze({
  type: ["types", "energyTypes"], life: ["life", "energyLife"], ctype: ["ctype", "energyCtype"],
  temp: ["temperatures", "energyTemperatures"], temperature: ["temperatures", "energyTemperatures"],
  tmp: ["tmp", "energyTmp"], tmp2: ["tmp2", "energyTmp2"], tmp3: ["tmp3", "energyTmp3"], tmp4: ["tmp4", "energyTmp4"],
  vx: ["velocityX", "energyVelocityX"], vy: ["velocityY", "energyVelocityY"], vz: ["velocityZ", "energyVelocityZ"],
  flags: ["flags", "energyFlags"], dcolour: ["decorations", "energyDecorations"], dcolor: ["decorations", "energyDecorations"],
});
const ELEMENT_FLAGS = Object.freeze({
  TYPE_PART: 0x00000001, TYPE_LIQUID: 0x00000002, TYPE_SOLID: 0x00000004, TYPE_GAS: 0x00000008, TYPE_ENERGY: 0x00000010,
  PROP_CONDUCTS: 0x00000020, PROP_PHOTPASS: 0x00000040, PROP_NEUTPENETRATE: 0x00000080,
  PROP_NEUTABSORB: 0x00000100, PROP_NEUTPASS: 0x00000200, PROP_DEADLY: 0x00000400,
  PROP_HOT_GLOW: 0x00000800, PROP_LIFE: 0x00001000, PROP_RADIOACTIVE: 0x00002000,
  PROP_LIFE_DEC: 0x00004000, PROP_LIFE_KILL: 0x00008000, PROP_LIFE_KILL_DEC: 0x00010000,
  PROP_SPARKSETTLE: 0x00020000, PROP_NOAMBHEAT: 0x00040000, PROP_NOCTYPEDRAW: 0x00100000,
  SC_WALL: 0, SC_ELEC: 5, SC_POWERED: 6, SC_SENSOR: 7, SC_FORCE: 8, SC_EXPLOSIVE: 4,
  SC_GAS: 2, SC_LIQUID: 1, SC_POWDERS: 0, SC_SOLIDS: 3, SC_NUCLEAR: 9, SC_SPECIAL: 10, SC_LIFE: 11,
  SC_TOOL: 12, SC_DECO: 13, NUM_MENUSECTIONS: 14,
  UPDATE_AFTER: 0, UPDATE_REPLACE: 1, UPDATE_BEFORE: 2, NUM_UPDATEMODES: 3,
});
const CATEGORY_BY_SECTION = ["powders", "liquids", "gases", "solids", "explosives", "electronics", "powered", "sensors", "force", "nuclear", "special", "life"];

const s = (value) => to_luastring(String(value), true);

function openLibrary(L, name, open) {
  lauxlib.luaL_requiref(L, s(name), open, 1);
  lua.lua_pop(L, 1);
}

function pushValue(L, value) {
  if (value == null) lua.lua_pushnil(L);
  else if (typeof value === "boolean") lua.lua_pushboolean(L, value);
  else if (typeof value === "number") Number.isInteger(value) ? lua.lua_pushinteger(L, value) : lua.lua_pushnumber(L, value);
  else lua.lua_pushstring(L, s(value));
}

function valueAt(L, index) {
  switch (lua.lua_type(L, index)) {
    case lua.LUA_TNIL: return "nil";
    case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, index) ? "true" : "false";
    case lua.LUA_TNUMBER: return String(lua.lua_tonumber(L, index));
    case lua.LUA_TSTRING: return to_jsstring(lua.lua_tolstring(L, index));
    default: {
      const text = to_jsstring(lauxlib.luaL_tolstring(L, index));
      lua.lua_pop(L, 1);
      return text;
    }
  }
}

export class PowderLuaRuntime {
  constructor({ instructionLimit = DEFAULT_INSTRUCTION_LIMIT, output = null, storage = null } = {}) {
    this.L = lauxlib.luaL_newstate();
    this.instructionLimit = Math.max(INSTRUCTION_GRANULARITY, instructionLimit);
    this.outputSink = output;
    this.output = [];
    this.context = null;
    this.mutated = false;
    this.eventMode = false;
    this.readOnlySimulation = false;
    this.decorationColor = 0xffffffff;
    this.rendererSettings = { decorations: true, hud: true, showBrush: true, grid: 0 };
    this.eventCallbacks = new Map([["tick", []], ["presim", []]]);
    this.fileSystem = new LuaVirtualFileSystem({ storage });
    this.elementCallbacks = new Map();
    this.elementGraphicsCache = new Map();
    this.elementGraphicsErrorTick = new Map();
    this.uiComponents = new Map();
    this.nextUiComponentId = 1;
    this.lastContext = null;
    this.attachedSimulation = null;
    this.installLibraries();
    this.installApi();
  }

  installLibraries() {
    openLibrary(this.L, "_G", luaopen_base);
    openLibrary(this.L, "coroutine", luaopen_coroutine);
    openLibrary(this.L, "table", luaopen_table);
    openLibrary(this.L, "string", luaopen_string);
    openLibrary(this.L, "math", luaopen_math);
    openLibrary(this.L, "utf8", luaopen_utf8);
  }

  guarded(callback) {
    return (L) => {
      try {
        return callback(L);
      } catch (error) {
        return lauxlib.luaL_error(L, s(error instanceof Error ? error.message : String(error)));
      }
    };
  }

  registerTable(name, fields, functions = {}) {
    lua.lua_newtable(this.L);
    for (const [field, value] of Object.entries(fields)) {
      pushValue(this.L, value);
      lua.lua_setfield(this.L, -2, s(field));
    }
    for (const [field, callback] of Object.entries(functions)) {
      lua.lua_pushcfunction(this.L, this.guarded(callback));
      lua.lua_setfield(this.L, -2, s(field));
    }
    lua.lua_setglobal(this.L, s(name));
  }

  installApi() {
    lua.lua_pushcfunction(this.L, this.guarded((L) => {
      const values = [];
      for (let index = 1; index <= lua.lua_gettop(L); index += 1) values.push(valueAt(L, index));
      this.emit(values.join("\t"));
      return 0;
    }));
    lua.lua_setglobal(this.L, s("print"));

    const bitArgument = (L, index) => Math.trunc(lauxlib.luaL_checknumber(L, index)) >>> 0;
    const pushBits = (L, value) => { lua.lua_pushnumber(L, value | 0); return 1; };
    const bitFold = (operation) => (L) => {
      let value = bitArgument(L, 1);
      for (let index = lua.lua_gettop(L); index > 1; index -= 1) value = operation(value, bitArgument(L, index)) >>> 0;
      return pushBits(L, value);
    };
    this.registerTable("bit", {}, {
      tobit: (L) => pushBits(L, bitArgument(L, 1)),
      bnot: (L) => pushBits(L, ~bitArgument(L, 1)),
      band: bitFold((left, right) => left & right),
      bor: bitFold((left, right) => left | right),
      bxor: bitFold((left, right) => left ^ right),
      lshift: (L) => pushBits(L, bitArgument(L, 1) << (bitArgument(L, 2) & 31)),
      rshift: (L) => pushBits(L, bitArgument(L, 1) >>> (bitArgument(L, 2) & 31)),
      arshift: (L) => pushBits(L, (bitArgument(L, 1) | 0) >> (bitArgument(L, 2) & 31)),
      rol: (L) => {
        const value = bitArgument(L, 1);
        const shift = bitArgument(L, 2) & 31;
        return pushBits(L, (value << shift) | (value >>> ((32 - shift) & 31)));
      },
      ror: (L) => {
        const value = bitArgument(L, 1);
        const shift = bitArgument(L, 2) & 31;
        return pushBits(L, (value >>> shift) | (value << ((32 - shift) & 31)));
      },
      bswap: (L) => {
        const value = bitArgument(L, 1);
        return pushBits(L, (value >>> 24) | ((value >>> 8) & 0xff00) | ((value & 0xff00) << 8) | (value << 24));
      },
      tohex: (L) => {
        const value = bitArgument(L, 1);
        let digits = lua.lua_gettop(L) >= 2 ? bitArgument(L, 2) | 0 : 8;
        const uppercase = digits < 0;
        digits = Math.min(8, Math.abs(digits));
        let result = value.toString(16).padStart(8, "0").slice(8 - digits);
        if (uppercase) result = result.toUpperCase();
        lua.lua_pushstring(L, s(result));
        return 1;
      },
    });

    const elementConstants = {};
    for (const material of MATERIALS) {
      elementConstants[material.identifier] = material.id;
      elementConstants[material.code] = material.id;
    }
    Object.assign(elementConstants, ELEMENT_FLAGS);
    const elementFunctions = {
      exists: (L) => {
        const id = lauxlib.luaL_checkinteger(L, 1);
        lua.lua_pushboolean(L, materialById(id).id === id);
        return 1;
      },
      allocate: (L) => this.elementAllocate(L),
      free: (L) => this.elementFree(L),
      property: (L) => this.elementProperty(L),
      element: (L) => this.elementDefinition(L),
      getByName: (L) => this.elementByName(L),
      loadDefault: (L) => this.elementLoadDefault(L),
    };
    this.registerTable("elements", elementConstants, elementFunctions);
    this.registerTable("elem", elementConstants, elementFunctions);

    this.registerTable("sim", {
      XRES: 0, YRES: 0, ZRES: 0,
      FIELD_TYPE: "type", FIELD_LIFE: "life", FIELD_CTYPE: "ctype", FIELD_TEMP: "temp",
      FIELD_TMP: "tmp", FIELD_TMP2: "tmp2", FIELD_TMP3: "tmp3", FIELD_TMP4: "tmp4",
      FIELD_VX: "vx", FIELD_VY: "vy", FIELD_VZ: "vz", FIELD_FLAGS: "flags", FIELD_DCOLOUR: "dcolour",
      MIN_TEMP: -273.15, MAX_TEMP: 9725.85, MIN_PRESSURE: -256, MAX_PRESSURE: 256, MAX_VELOCITY: 32,
      DECO_DRAW: DECORATION_MODE.DRAW, DECO_CLEAR: DECORATION_MODE.CLEAR, DECO_ADD: DECORATION_MODE.ADD,
      DECO_SUBTRACT: DECORATION_MODE.SUBTRACT, DECO_MULTIPLY: DECORATION_MODE.MULTIPLY,
      DECO_DIVIDE: DECORATION_MODE.DIVIDE, DECO_SMUDGE: DECORATION_MODE.SMUDGE,
      EDGE_VOID: 0, EDGE_SOLID: 1, EDGE_LOOP: 2, NUM_EDGEMODES: 3,
      AIR_ON: 0, AIR_PRESSUREOFF: 1, AIR_VELOCITYOFF: 2, AIR_OFF: 3, AIR_NOUPDATE: 4, NUM_AIRMODES: 5,
      AIRC_NONE: 0, AIRC_LEGACY: 1, AIRC_BOUSSINESQ: 2, NUM_CONVMODES: 3,
      GRAV_VERTICAL: 0, GRAV_OFF: 1, GRAV_RADIAL: 2, GRAV_CUSTOM: 3, NUM_GRAVMODES: 4,
      DECOSPACE_SRGB: 0, DECOSPACE_LINEAR: 1, DECOSPACE_GAMMA22: 2, DECOSPACE_GAMMA18: 3, NUM_DECOSPACES: 4,
    }, {
      partCreate: (L) => this.partCreate(L),
      partNeighbors: (L) => this.partNeighbors(L, false),
      partNeighbors3d: (L) => this.partNeighbors(L, true),
      partChangeType: (L) => this.partChangeType(L),
      partID: (L) => this.partID(L),
      partKill: (L) => this.partKill(L),
      partExists: (L) => this.partExists(L),
      partProperty: (L) => this.partProperty(L),
      partPosition: (L) => this.partPosition(L),
      pressure: (L) => this.fieldAccessor(L, "pressure"),
      pressure3d: (L) => this.fieldAccessor3d(L, "pressure"),
      velocityX: (L) => this.fieldAccessor(L, "velocityX"),
      velocityY: (L) => this.fieldAccessor(L, "velocityY"),
      velocityZ: (L) => this.fieldAccessor(L, "velocityZ"),
      velocityX3d: (L) => this.fieldAccessor3d(L, "velocityX"),
      velocityY3d: (L) => this.fieldAccessor3d(L, "velocityY"),
      velocityZ3d: (L) => this.fieldAccessor3d(L, "velocityZ"),
      ambientHeat: (L) => this.fieldAccessor(L, "ambientHeat"),
      ambientHeat3d: (L) => this.fieldAccessor3d(L, "ambientHeat"),
      gravityField: (L) => this.gravityAccessor(L),
      gravityField3d: (L) => this.gravityAccessor3d(L),
      createParts: (L) => this.createParts(L),
      createLine: (L) => this.createLine(L),
      createBox: (L) => this.createBox(L),
      floodParts: (L) => this.floodParts(L),
      createWalls: (L) => this.createWalls(L),
      createWallLine: (L) => this.createWallLine(L),
      createWallBox: (L) => this.createWallBox(L),
      floodWalls: (L) => this.floodWalls(L),
      toolBrush: (L) => this.toolBrush(L),
      toolLine: (L) => this.toolLine(L),
      toolBox: (L) => this.toolBox(L),
      decoBrush: (L) => this.decoBrush(L),
      decoLine: (L) => this.decoLine(L),
      decoBox: (L) => this.decoBox(L),
      decoColor: (L) => this.decoColorAccessor(L),
      floodDeco: (L) => this.floodDeco(L),
      clearSim: (L) => this.clearSimulation(L),
      clearRect: (L) => this.clearRect(L),
      clearBox: (L) => this.clearBox(L),
      resetTemp: (L) => this.resetTemperature(L),
      resetPressure: (L) => this.resetPressure(L),
      resetSpark: (L) => this.resetSpark(L),
      resetVelocity: (L) => this.resetVelocity(L),
      gravityMode: (L) => this.settingAccessor(L, "gravityMode", 0, 3),
      airMode: (L) => this.settingAccessor(L, "air.mode", 0, 4),
      edgeMode: (L) => this.settingAccessor(L, "edgeMode", 0, 2),
      waterEqualization: (L) => this.booleanSettingAccessor(L, "waterEqualization"),
      ambientAirTemp: (L) => this.numberSettingAccessor(L, "air.ambientTemperature", -273.15, 9725.85),
      ambientHeatEnabled: (L) => this.booleanSettingAccessor(L, "air.ambientHeatEnabled"),
      heatEnabled: (L) => this.booleanSettingAccessor(L, "heatSimulationEnabled"),
      newtonianGravity: (L) => this.booleanSettingAccessor(L, "newtonianGravityEnabled"),
      edgePressure: (L) => this.numberSettingAccessor(L, "air.edgePressure", -256, 256),
      edgeVelocity: (L) => this.edgeVelocityAccessor(L),
      vorticityCoeff: (L) => this.numberSettingAccessor(L, "air.vorticityCoeff", 0, 1),
      convectionMode: (L) => this.settingAccessor(L, "air.convectionMode", 0, 2),
      decoSpace: (L) => this.settingAccessor(L, "decorationColorSpace", 0, 3),
      elementCount: (L) => this.elementCount(L),
      partCount: (L) => {
        lua.lua_pushinteger(L, this.simulation().size * 2);
        return 1;
      },
      paused: (L) => this.pauseAccessor(L),
      step: (L) => this.stepSimulation(L),
    });

    this.registerTable("tpt", {}, {
      create: (L) => this.tptCreate(L),
      delete: (L) => this.tptDelete(L),
      get_property: (L) => this.tptGetProperty(L),
      set_property: (L) => this.tptSetProperty(L),
      set_pause: (L) => this.pauseAccessor(L),
      set_gravity: (L) => this.settingAccessor(L, "gravityMode", 0, 3),
      log: (L) => {
        this.emit(valueAt(L, 1));
        return 0;
      },
    });

    this.registerTable("ren", {
      ...Object.fromEntries(VIEW_MODES.map((mode, index) => [`MODE_${mode.toUpperCase()}`, index])),
      ...GRAPHICS_MODE,
    }, {
      renderMode: (L) => {
        const raw = lua.lua_type(L, 1) === lua.LUA_TNUMBER ? VIEW_MODES[lauxlib.luaL_checkinteger(L, 1)] : to_jsstring(lauxlib.luaL_checkstring(L, 1)).toLowerCase();
        if (!VIEW_MODES.includes(raw)) throw new Error(`unknown render mode ${raw}`);
        this.context?.setView?.(raw);
        lua.lua_pushstring(L, s(raw));
        return 1;
      },
      decorations: (L) => this.rendererBooleanAccessor(L, "decorations"),
      hud: (L) => this.rendererBooleanAccessor(L, "hud"),
      showBrush: (L) => this.rendererBooleanAccessor(L, "showBrush"),
      grid: (L) => this.rendererGridAccessor(L),
      depth3d: (L) => this.rendererDepthAccessor(L),
    });

    this.registerTable("ui", { NUM_TOOLINDICES: 4, MOUSEUP_NORMAL: 0, MOUSEUP_BLUR: 1, MOUSEUP_DRAWEND: 2 }, {
      showWindow: (L) => this.uiShowWindow(L, true),
      closeWindow: (L) => this.uiShowWindow(L, false),
      addComponent: (L) => this.uiRootComponent(L, true),
      removeComponent: (L) => this.uiRootComponent(L, false),
      beginInput: (L) => this.uiPrompt(L, "input"),
      beginMessageBox: (L) => this.uiPrompt(L, "message"),
      beginConfirm: (L) => this.uiPrompt(L, "confirm"),
      beginThrowError: (L) => this.uiPrompt(L, "error"),
      console: (L) => this.uiConsoleAccessor(L),
      windowSize: (L) => this.uiWindowSize(L),
      brushRadius: (L) => this.uiBrushRadius(L),
      mousePosition: (L) => this.uiMousePosition(L),
      activeTool: (L) => this.uiActiveTool(L),
      activeMenu: (L) => this.uiActiveMenu(L),
      numMenus: (L) => {
        lua.lua_pushinteger(L, 12);
        return 1;
      },
      perfectCircleBrush: (L) => {
        lua.lua_pushboolean(L, true);
        return 1;
      },
    });
    lua.lua_getglobal(this.L, s("ui"));
    lua.lua_setglobal(this.L, s("interface"));
    this.installUiConstructors();

    this.registerTable("event", { ...EVENT }, {
      register: (L) => this.registerEvent(L),
      unregister: (L) => this.unregisterEvent(L),
    });
    lua.lua_getglobal(this.L, s("event"));
    lua.lua_setglobal(this.L, s("evt"));

    const fileSystemFunctions = {
      list: (L) => this.fileSystemList(L),
      exists: (L) => this.fileSystemBoolean(L, "exists"),
      isFile: (L) => this.fileSystemBoolean(L, "isFile"),
      isDirectory: (L) => this.fileSystemBoolean(L, "isDirectory"),
      isLink: (L) => this.fileSystemBoolean(L, "isLink"),
      makeDirectory: (L) => this.fileSystemBoolean(L, "makeDirectory"),
      removeDirectory: (L) => this.fileSystemBoolean(L, "removeDirectory"),
      removeFile: (L) => this.fileSystemBoolean(L, "removeFile"),
      move: (L) => this.fileSystemTransfer(L, "move"),
      copy: (L) => this.fileSystemTransfer(L, "copy"),
      read: (L) => this.fileSystemRead(L),
      write: (L) => this.fileSystemWrite(L, false),
      append: (L) => this.fileSystemWrite(L, true),
    };
    this.registerTable("fileSystem", {}, fileSystemFunctions);
    lua.lua_getglobal(this.L, s("fileSystem"));
    lua.lua_setglobal(this.L, s("fs"));

    lua.lua_pushcfunction(this.L, this.guarded((L) => this.loadVirtualFile(L, false)));
    lua.lua_setglobal(this.L, s("loadfile"));
    lua.lua_pushcfunction(this.L, this.guarded((L) => this.loadVirtualFile(L, true)));
    lua.lua_setglobal(this.L, s("dofile"));
  }

  loadVirtualFile(L, execute) {
    const path = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    const content = this.fileSystem.read(path);
    if (content == null) throw new Error(`virtual script not found: ${path}`);
    const buffer = to_luastring(content);
    lua.lua_settop(L, 0);
    if (lauxlib.luaL_loadbuffer(L, buffer, buffer.length, s(`@${this.fileSystem.normalize(path)}`)) !== lua.LUA_OK) {
      if (execute) return lua.lua_error(L);
      lua.lua_pushnil(L);
      lua.lua_insert(L, -2);
      return 2;
    }
    if (!execute) return 1;
    if (lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0) !== lua.LUA_OK) return lua.lua_error(L);
    return lua.lua_gettop(L);
  }

  simulation() {
    const simulation = this.context?.simulation;
    if (!simulation) throw new Error("Lua has no simulation context");
    return simulation;
  }

  currentDepth() {
    return Math.max(0, Math.min(this.simulation().depth - 1, Math.round(this.context?.currentDepth?.() ?? this.simulation().depth / 2)));
  }

  fileSystemList(L) {
    const path = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    const entries = this.fileSystem.list(path);
    lua.lua_newtable(L);
    entries.forEach((entry, index) => {
      lua.lua_pushstring(L, s(entry));
      lua.lua_rawseti(L, -2, index + 1);
    });
    return 1;
  }

  fileSystemBoolean(L, method) {
    const path = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    lua.lua_pushboolean(L, this.fileSystem[method](path));
    return 1;
  }

  fileSystemTransfer(L, method) {
    const source = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    const target = to_jsstring(lauxlib.luaL_checkstring(L, 2));
    const replace = lua.lua_gettop(L) >= 3 && Boolean(lua.lua_toboolean(L, 3));
    lua.lua_pushboolean(L, this.fileSystem[method](source, target, replace));
    return 1;
  }

  fileSystemRead(L) {
    const path = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    pushValue(L, this.fileSystem.read(path));
    return 1;
  }

  fileSystemWrite(L, append) {
    const path = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    const content = to_jsstring(lauxlib.luaL_checkstring(L, 2));
    lua.lua_pushboolean(L, this.fileSystem.write(path, content, append));
    return 1;
  }

  updateContextGlobals() {
    const simulation = this.simulation();
    lua.lua_getglobal(this.L, s("sim"));
    for (const [field, value] of Object.entries({ XRES: simulation.width, YRES: simulation.height, ZRES: simulation.depth })) {
      lua.lua_pushinteger(this.L, value);
      lua.lua_setfield(this.L, -2, s(field));
    }
    lua.lua_pop(this.L, 1);
  }

  checkedVoxel(x, y, z) {
    if (!this.simulation().inBounds(x, y, z)) throw new Error(`cell ${x},${y},${z} is outside the chamber`);
    return [x, y, z];
  }

  markMutated() {
    if (this.readOnlySimulation) throw new Error("simulation mutation is restricted during graphics callbacks");
    if (!this.mutated) {
      if (!this.eventMode) this.context?.beforeMutate?.();
      this.mutated = true;
    }
  }

  emit(text) {
    const message = String(text);
    this.output.push(message);
    this.outputSink?.(message, "console-result");
  }

  indexLayer(index) {
    const simulation = this.simulation();
    if (!Number.isInteger(index) || index < 0 || index >= simulation.size) throw new Error(`particle index ${index} is outside the chamber`);
    if (simulation.types[index] !== MAT.EMPTY) return false;
    if (simulation.energyTypes[index] !== MAT.EMPTY) return true;
    return null;
  }

  partExists(L) {
    const index = lauxlib.luaL_checkinteger(L, 1);
    lua.lua_pushboolean(L, index >= 0 && index < this.simulation().size && this.indexLayer(index) != null);
    return 1;
  }

  partChangeType(L) {
    const index = lauxlib.luaL_checkinteger(L, 1);
    const type = lauxlib.luaL_checkinteger(L, 2);
    if (materialById(type).id !== type || this.indexLayer(index) == null) return 0;
    this.markMutated();
    this.simulation().applyParticlePropertyAt(index, "type", type);
    return 0;
  }

  partNeighbors(L, volumetric) {
    const simulation = this.simulation();
    const count = lua.lua_gettop(L);
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = volumetric ? lauxlib.luaL_checkinteger(L, 3) : this.currentDepth();
    const radiusIndex = volumetric ? 4 : 3;
    const radius = Math.max(0, Math.min(64, lauxlib.luaL_checkinteger(L, radiusIndex)));
    const typeIndex = radiusIndex + 1;
    const filter = count >= typeIndex ? lauxlib.luaL_checkinteger(L, typeIndex) : null;
    if (filter != null && materialById(filter).id !== filter) throw new Error(`invalid element ${filter}`);
    this.checkedVoxel(x, y, z);

    lua.lua_newtable(L);
    let result = 1;
    const minZ = volumetric ? Math.max(0, z - radius) : z;
    const maxZ = volumetric ? Math.min(simulation.depth - 1, z + radius) : z;
    for (let nz = minZ; nz <= maxZ; nz += 1) {
      for (let ny = Math.max(0, y - radius); ny <= Math.min(simulation.height - 1, y + radius); ny += 1) {
        for (let nx = Math.max(0, x - radius); nx <= Math.min(simulation.width - 1, x + radius); nx += 1) {
          if (nx === x && ny === y && nz === z) continue;
          const index = simulation.index(nx, ny, nz);
          let match = -1;
          if (simulation.types[index] !== MAT.EMPTY && (filter == null || simulation.types[index] === filter)) match = index;
          else if (simulation.energyTypes[index] !== MAT.EMPTY && (filter == null || simulation.energyTypes[index] === filter)) match = index;
          if (match < 0) continue;
          lua.lua_pushinteger(L, match);
          lua.lua_rawseti(L, -2, result);
          result += 1;
        }
      }
    }
    return 1;
  }

  validElement(type) {
    if (materialById(type).id !== type) throw new Error(`invalid element ${type}`);
    return type;
  }

  planeEllipse(x, y, z, radiusX, radiusY, callback) {
    const simulation = this.simulation();
    this.checkedVoxel(x, y, z);
    const rx = Math.max(0, Math.min(64, Math.abs(radiusX)));
    const ry = Math.max(0, Math.min(64, Math.abs(radiusY)));
    let changed = 0;
    for (let ny = Math.max(0, y - ry); ny <= Math.min(simulation.height - 1, y + ry); ny += 1) {
      for (let nx = Math.max(0, x - rx); nx <= Math.min(simulation.width - 1, x + rx); nx += 1) {
        const dx = nx - x;
        const dy = ny - y;
        const inside = rx === 0 && ry === 0 ? dx === 0 && dy === 0
          : rx === 0 ? dx === 0 && Math.abs(dy) <= ry
            : ry === 0 ? dy === 0 && Math.abs(dx) <= rx
              : (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.0001;
        if (inside) changed += Number(callback(nx, ny, z) || 0);
      }
    }
    return changed;
  }

  linePoints(x1, y1, x2, y2, callback) {
    const simulation = this.simulation();
    const z = this.currentDepth();
    this.checkedVoxel(x1, y1, z);
    this.checkedVoxel(x2, y2, z);
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    let changed = 0;
    for (let step = 0; step <= steps; step += 1) {
      changed += Number(callback(Math.round(x1 + (x2 - x1) * step / steps), Math.round(y1 + (y2 - y1) * step / steps), z) || 0);
    }
    return changed;
  }

  paintElement(x, y, z, type) {
    const simulation = this.simulation();
    const index = simulation.index(x, y, z);
    if (type === MAT.EMPTY) {
      const occupied = simulation.types[index] !== MAT.EMPTY || simulation.energyTypes[index] !== MAT.EMPTY;
      simulation.set(x, y, z, MAT.EMPTY);
      simulation.setEnergy(x, y, z, MAT.EMPTY);
      return occupied;
    }
    const energy = materialById(type).state === "energy";
    if ((energy ? simulation.energyTypes[index] : simulation.types[index]) !== MAT.EMPTY) return false;
    return energy ? simulation.setEnergy(x, y, z, type) : simulation.set(x, y, z, type);
  }

  createParts(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const rx = lauxlib.luaL_optinteger(L, 3, 5);
    const ry = lauxlib.luaL_optinteger(L, 4, 5);
    const type = this.validElement(lauxlib.luaL_checkinteger(L, 5));
    this.markMutated();
    const changed = this.planeEllipse(x, y, this.currentDepth(), rx, ry, (nx, ny, nz) => this.paintElement(nx, ny, nz, type));
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  createLine(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const rx = lauxlib.luaL_optinteger(L, 5, 0);
    const ry = lauxlib.luaL_optinteger(L, 6, 0);
    const type = this.validElement(lauxlib.luaL_checkinteger(L, 7));
    this.markMutated();
    const changed = this.linePoints(x1, y1, x2, y2, (x, y, z) => this.planeEllipse(x, y, z, rx, ry, (nx, ny, nz) => this.paintElement(nx, ny, nz, type)));
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  createBox(L) {
    const simulation = this.simulation();
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const type = this.validElement(lauxlib.luaL_checkinteger(L, 5));
    const z = this.currentDepth();
    this.checkedVoxel(x1, y1, z);
    this.checkedVoxel(x2, y2, z);
    this.markMutated();
    let changed = 0;
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) changed += Number(this.paintElement(x, y, z, type));
    }
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  floodParts(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const type = this.validElement(lauxlib.luaL_checkinteger(L, 3));
    const z = this.currentDepth();
    this.checkedVoxel(x, y, z);
    this.markMutated();
    lua.lua_pushinteger(L, this.simulation().floodFillPlane(x, y, z, type));
    return 1;
  }

  validWall(wall) {
    if (!UPSTREAM_WALLS.some((candidate) => candidate.id === wall)) throw new Error(`unrecognised wall id ${wall}`);
    return wall;
  }

  createWalls(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const rx = lauxlib.luaL_optinteger(L, 3, 0);
    const ry = lauxlib.luaL_optinteger(L, 4, 0);
    const wall = this.validWall(lauxlib.luaL_checkinteger(L, 5));
    this.markMutated();
    const changed = this.planeEllipse(x, y, this.currentDepth(), rx, ry, (nx, ny, nz) => this.simulation().paintWallSphere(nx, ny, nz, 0, wall, "disc"));
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  createWallLine(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const rx = lauxlib.luaL_optinteger(L, 5, 0);
    const ry = lauxlib.luaL_optinteger(L, 6, 0);
    const wall = this.validWall(lauxlib.luaL_checkinteger(L, 7));
    this.markMutated();
    this.linePoints(x1, y1, x2, y2, (x, y, z) => this.planeEllipse(x, y, z, rx, ry, (nx, ny, nz) => this.simulation().paintWallSphere(nx, ny, nz, 0, wall, "disc")));
    return 0;
  }

  createWallBox(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const wall = this.validWall(lauxlib.luaL_checkinteger(L, 5));
    const z = this.currentDepth();
    this.checkedVoxel(x1, y1, z);
    this.checkedVoxel(x2, y2, z);
    this.markMutated();
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) this.simulation().paintWallSphere(x, y, z, 0, wall, "disc");
    }
    return 0;
  }

  floodWalls(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const wall = this.validWall(lauxlib.luaL_checkinteger(L, 3));
    const z = this.currentDepth();
    this.checkedVoxel(x, y, z);
    this.markMutated();
    lua.lua_pushinteger(L, this.simulation().floodWallPlane(x, y, z, wall));
    return 1;
  }

  validTool(tool) {
    if (!UPSTREAM_TOOLS.some((candidate) => candidate.id === tool)) throw new Error(`invalid tool id ${tool}`);
    return tool;
  }

  toolBrush(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const radius = Math.max(Math.abs(lauxlib.luaL_optinteger(L, 3, 5)), Math.abs(lauxlib.luaL_optinteger(L, 4, 5)));
    const tool = this.validTool(lauxlib.luaL_checkinteger(L, 5));
    this.markMutated();
    this.simulation().applyToolSphere(x, y, this.currentDepth(), radius, tool, "disc");
    return 0;
  }

  toolLine(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const radius = Math.max(Math.abs(lauxlib.luaL_optinteger(L, 5, 5)), Math.abs(lauxlib.luaL_optinteger(L, 6, 5)));
    const tool = this.validTool(lauxlib.luaL_checkinteger(L, 7));
    this.markMutated();
    this.linePoints(x1, y1, x2, y2, (x, y, z) => this.simulation().applyToolSphere(x, y, z, radius, tool, "disc"));
    return 0;
  }

  toolBox(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const tool = this.validTool(lauxlib.luaL_checkinteger(L, 5));
    const z = this.currentDepth();
    this.checkedVoxel(x1, y1, z);
    this.checkedVoxel(x2, y2, z);
    this.markMutated();
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) this.simulation().applyToolSphere(x, y, z, 0, tool, "disc");
    }
    return 0;
  }

  decorationArguments(L, offset) {
    const clamp = (value) => Math.max(0, Math.min(255, value));
    const red = clamp(lauxlib.luaL_optinteger(L, offset, 255));
    const green = clamp(lauxlib.luaL_optinteger(L, offset + 1, 255));
    const blue = clamp(lauxlib.luaL_optinteger(L, offset + 2, 255));
    const alpha = clamp(lauxlib.luaL_optinteger(L, offset + 3, 255));
    const mode = Math.max(DECORATION_MODE.DRAW, Math.min(DECORATION_MODE.SMUDGE, lauxlib.luaL_optinteger(L, offset + 4, DECORATION_MODE.DRAW)));
    return { color: ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0, mode };
  }

  decoBrush(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const rx = lauxlib.luaL_optinteger(L, 3, 5);
    const ry = lauxlib.luaL_optinteger(L, 4, 5);
    const { color, mode } = this.decorationArguments(L, 5);
    this.markMutated();
    this.planeEllipse(x, y, this.currentDepth(), rx, ry, (nx, ny, nz) => this.simulation().applyDecorationAt(this.simulation().index(nx, ny, nz), color, mode));
    return 0;
  }

  decoLine(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const rx = lauxlib.luaL_optinteger(L, 5, 5);
    const ry = lauxlib.luaL_optinteger(L, 6, 5);
    const { color, mode } = this.decorationArguments(L, 7);
    this.markMutated();
    this.linePoints(x1, y1, x2, y2, (x, y, z) => this.planeEllipse(x, y, z, rx, ry, (nx, ny, nz) => this.simulation().applyDecorationAt(this.simulation().index(nx, ny, nz), color, mode)));
    return 0;
  }

  decoBox(L) {
    const x1 = lauxlib.luaL_checkinteger(L, 1);
    const y1 = lauxlib.luaL_checkinteger(L, 2);
    const x2 = lauxlib.luaL_checkinteger(L, 3);
    const y2 = lauxlib.luaL_checkinteger(L, 4);
    const { color, mode } = this.decorationArguments(L, 5);
    const simulation = this.simulation();
    const z = this.currentDepth();
    this.checkedVoxel(x1, y1, z);
    this.checkedVoxel(x2, y2, z);
    this.markMutated();
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) simulation.applyDecorationAt(simulation.index(x, y, z), color, mode);
    }
    return 0;
  }

  decoColorAccessor(L) {
    const count = lua.lua_gettop(L);
    if (count === 1) this.decorationColor = Math.max(0, Math.min(0xffffffff, lauxlib.luaL_checknumber(L, 1))) >>> 0;
    else if (count > 1) this.decorationColor = this.decorationArguments(L, 1).color;
    lua.lua_pushnumber(L, this.decorationColor);
    return 1;
  }

  floodDeco(L) {
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const { color, mode } = this.decorationArguments(L, 3);
    const z = this.currentDepth();
    this.checkedVoxel(x, y, z);
    this.markMutated();
    lua.lua_pushinteger(L, this.simulation().floodDecorationPlane(x, y, z, color, mode));
    return 1;
  }

  moveParticleTo(index, target) {
    const simulation = this.simulation();
    const layer = this.indexLayer(index);
    if (layer == null) return { moved: false, index };
    this.checkedVoxel(...target);
    const targetIndex = simulation.index(...target);
    if (targetIndex === index) return { moved: false, index };
    if ((layer ? simulation.energyTypes[targetIndex] : simulation.types[targetIndex]) !== MAT.EMPTY) return { moved: false, index };
    this.markMutated();
    const moved = layer ? simulation.moveEnergy(index, targetIndex) : simulation.move(index, targetIndex);
    return { moved, index: moved ? targetIndex : index };
  }

  partCreate(L) {
    const simulation = this.simulation();
    const count = lua.lua_gettop(L);
    if (count !== 4 && count !== 5) throw new Error("sim.partCreate expects id,x,y,type or id,x,y,z,type");
    const x = lauxlib.luaL_checkinteger(L, 2);
    const y = lauxlib.luaL_checkinteger(L, 3);
    const z = count === 5 ? lauxlib.luaL_checkinteger(L, 4) : this.currentDepth();
    const type = lauxlib.luaL_checkinteger(L, count);
    if (!simulation.inBounds(x, y, z) || materialById(type).id !== type || type === MAT.EMPTY) {
      lua.lua_pushinteger(L, -1);
      return 1;
    }
    const voxel = simulation.index(x, y, z);
    const energy = materialById(type).state === "energy";
    if ((energy ? simulation.energyTypes[voxel] : simulation.types[voxel]) !== MAT.EMPTY) {
      lua.lua_pushinteger(L, -1);
      return 1;
    }
    this.markMutated();
    const created = energy ? simulation.setEnergy(x, y, z, type) : simulation.set(x, y, z, type);
    lua.lua_pushinteger(L, created ? voxel : -1);
    return 1;
  }

  partID(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = lua.lua_gettop(L) >= 3 ? lauxlib.luaL_checkinteger(L, 3) : this.currentDepth();
    if (!simulation.inBounds(x, y, z)) { lua.lua_pushnil(L); return 1; }
    const index = simulation.index(x, y, z);
    if (this.indexLayer(index) == null) lua.lua_pushnil(L);
    else lua.lua_pushinteger(L, index);
    return 1;
  }

  partKill(L) {
    const simulation = this.simulation();
    const count = lua.lua_gettop(L);
    let index;
    if (count === 1) index = lauxlib.luaL_checkinteger(L, 1);
    else {
      const coordinates = this.checkedVoxel(
        lauxlib.luaL_checkinteger(L, 1),
        lauxlib.luaL_checkinteger(L, 2),
        count >= 3 ? lauxlib.luaL_checkinteger(L, 3) : this.currentDepth(),
      );
      index = simulation.index(...coordinates);
    }
    const layer = this.indexLayer(index);
    if (layer == null) { lua.lua_pushboolean(L, false); return 1; }
    this.markMutated();
    if (layer) simulation.killEnergy(index);
    else simulation.set(...simulation.coords(index), MAT.EMPTY);
    lua.lua_pushboolean(L, true);
    return 1;
  }

  partProperty(L) {
    const simulation = this.simulation();
    const count = lua.lua_gettop(L);
    const index = lauxlib.luaL_checkinteger(L, 1);
    const field = to_jsstring(lauxlib.luaL_checkstring(L, 2)).toLowerCase();
    let layer = this.indexLayer(index);
    if (layer == null) { lua.lua_pushnil(L); return 1; }
    if (field === "x" || field === "y" || field === "z") {
      const axis = field === "x" ? 0 : field === "y" ? 1 : 2;
      let resultIndex = index;
      if (count >= 3) {
        const target = simulation.coords(index);
        target[axis] = Math.round(lauxlib.luaL_checknumber(L, 3));
        const result = this.moveParticleTo(index, target);
        if (!result.moved && result.index !== simulation.index(...target)) { lua.lua_pushboolean(L, false); return 1; }
        resultIndex = result.index;
      }
      lua.lua_pushinteger(L, simulation.coords(resultIndex)[axis]);
      return 1;
    }
    if (count >= 3) {
      const value = lauxlib.luaL_checknumber(L, 3);
      this.markMutated();
      if (!simulation.applyParticlePropertyAt(index, field === "temperature" ? "temp" : field === "dcolor" ? "dcolour" : field, value)) {
        lua.lua_pushboolean(L, false);
        return 1;
      }
      layer = this.indexLayer(index);
      if (layer == null) { lua.lua_pushnil(L); return 1; }
    }
    const fields = FIELD_MAP[field];
    if (!fields) throw new Error(`unknown particle property ${field}`);
    pushValue(L, simulation[fields[layer ? 1 : 0]][index]);
    return 1;
  }

  partPosition(L) {
    const simulation = this.simulation();
    const index = lauxlib.luaL_checkinteger(L, 1);
    const count = lua.lua_gettop(L);
    if (this.indexLayer(index) == null) {
      if (count === 1) for (let axis = 0; axis < 3; axis += 1) lua.lua_pushnil(L);
      return count === 1 ? 3 : 0;
    }
    let resultIndex = index;
    if (count >= 4) {
      const target = [lauxlib.luaL_checkinteger(L, 2), lauxlib.luaL_checkinteger(L, 3), lauxlib.luaL_checkinteger(L, 4)];
      resultIndex = this.moveParticleTo(index, target).index;
    }
    for (const coordinate of simulation.coords(resultIndex)) lua.lua_pushinteger(L, coordinate);
    return 3;
  }

  fieldAccessor(L, field) {
    const simulation = this.simulation();
    const count = lua.lua_gettop(L);
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = this.currentDepth();
    this.checkedVoxel(x, y, z);
    const value = count >= 3 ? lauxlib.luaL_checknumber(L, 3) : null;
    const index = simulation.air.indexForVoxel(x, y, z);
    if (value != null) { this.markMutated(); simulation.air[field][index] = value; }
    lua.lua_pushnumber(L, simulation.air[field][index]);
    return 1;
  }

  fieldAccessor3d(L, field) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = lauxlib.luaL_checkinteger(L, 3);
    this.checkedVoxel(x, y, z);
    const index = simulation.air.indexForVoxel(x, y, z);
    if (lua.lua_gettop(L) >= 4) { this.markMutated(); simulation.air[field][index] = lauxlib.luaL_checknumber(L, 4); }
    lua.lua_pushnumber(L, simulation.air[field][index]);
    return 1;
  }

  gravityAccessor(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = lua.lua_gettop(L) >= 4 ? lauxlib.luaL_checkinteger(L, 3) : this.currentDepth();
    this.checkedVoxel(x, y, z);
    const valueIndex = lua.lua_gettop(L) >= 4 ? 4 : 3;
    const index = simulation.gravity.indexForVoxel(x, y, z);
    if (lua.lua_gettop(L) >= valueIndex) { this.markMutated(); simulation.gravity.toolMass[index] = lauxlib.luaL_checknumber(L, valueIndex); }
    lua.lua_pushnumber(L, simulation.gravity.toolMass[index]);
    return 1;
  }

  gravityAccessor3d(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = lauxlib.luaL_checkinteger(L, 3);
    this.checkedVoxel(x, y, z);
    const index = simulation.gravity.indexForVoxel(x, y, z);
    if (lua.lua_gettop(L) >= 4) {
      this.markMutated();
      simulation.gravity.toolMass[index] = lauxlib.luaL_checknumber(L, 4);
    }
    lua.lua_pushnumber(L, simulation.gravity.toolMass[index]);
    return 1;
  }

  clearSimulation(L) {
    this.markMutated();
    this.simulation().clear();
    lua.lua_pushboolean(L, true);
    return 1;
  }

  clearRect(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const width = Math.max(0, lauxlib.luaL_checkinteger(L, 3));
    const height = Math.max(0, lauxlib.luaL_checkinteger(L, 4));
    const z = lua.lua_gettop(L) >= 5 ? lauxlib.luaL_checkinteger(L, 5) : this.currentDepth();
    this.checkedVoxel(Math.max(0, Math.min(simulation.width - 1, x)), Math.max(0, Math.min(simulation.height - 1, y)), z);
    this.markMutated();
    const changed = width && height ? simulation.clearRegionPlane(x, y, x + width - 1, y + height - 1, z) : 0;
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  clearBox(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = lauxlib.luaL_checkinteger(L, 3);
    const width = Math.max(0, lauxlib.luaL_checkinteger(L, 4));
    const height = Math.max(0, lauxlib.luaL_checkinteger(L, 5));
    const depth = Math.max(0, lauxlib.luaL_checkinteger(L, 6));
    this.checkedVoxel(Math.max(0, Math.min(simulation.width - 1, x)), Math.max(0, Math.min(simulation.height - 1, y)), Math.max(0, Math.min(simulation.depth - 1, z)));
    this.markMutated();
    let changed = 0;
    for (let nz = z; nz < z + depth; nz += 1) {
      if (nz < 0 || nz >= simulation.depth) continue;
      if (width && height) changed += simulation.clearRegionPlane(x, y, x + width - 1, y + height - 1, nz);
    }
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  resetTemperature() {
    const simulation = this.simulation();
    this.markMutated();
    for (let index = 0; index < simulation.size; index += 1) {
      if (simulation.types[index] !== MAT.EMPTY) simulation.temperatures[index] = materialById(simulation.types[index]).defaultTemp ?? 22;
      if (simulation.energyTypes[index] !== MAT.EMPTY) simulation.energyTemperatures[index] = materialById(simulation.energyTypes[index]).defaultTemp ?? 22;
    }
    return 0;
  }

  resetPressure() {
    const simulation = this.simulation();
    this.markMutated();
    simulation.air.pressure.fill(simulation.air.edgePressure);
    simulation.air.velocityX.fill(0);
    simulation.air.velocityY.fill(0);
    simulation.air.velocityZ.fill(0);
    return 0;
  }

  resetSpark() {
    const simulation = this.simulation();
    this.markMutated();
    for (let index = 0; index < simulation.size; index += 1) {
      if (simulation.types[index] !== MAT.SPRK) continue;
      const restored = simulation.ctype[index];
      if (materialById(restored).id === restored && restored !== MAT.EMPTY && restored !== MAT.SPRK) simulation.applyParticlePropertyAt(index, "type", restored);
      else simulation.set(...simulation.coords(index), MAT.EMPTY);
    }
    return 0;
  }

  resetVelocity(L) {
    const simulation = this.simulation();
    this.markMutated();
    for (const field of [simulation.velocityX, simulation.velocityY, simulation.velocityZ, simulation.energyVelocityX, simulation.energyVelocityY, simulation.energyVelocityZ]) field.fill(0);
    for (const field of [simulation.air.velocityX, simulation.air.velocityY, simulation.air.velocityZ]) field.fill(0);
    return 0;
  }

  nestedSetting(path) {
    const parts = path.split(".");
    let target = this.simulation();
    for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
    return [target, parts.at(-1)];
  }

  settingAccessor(L, path, minimum, maximum) {
    const [target, field] = this.nestedSetting(path);
    if (lua.lua_gettop(L)) {
      this.markMutated();
      target[field] = Math.max(minimum, Math.min(maximum, lauxlib.luaL_checkinteger(L, 1)));
    }
    lua.lua_pushinteger(L, target[field]);
    return 1;
  }

  numberSettingAccessor(L, path, minimum, maximum) {
    const [target, field] = this.nestedSetting(path);
    if (lua.lua_gettop(L)) {
      this.markMutated();
      target[field] = Math.max(minimum, Math.min(maximum, lauxlib.luaL_checknumber(L, 1)));
    }
    lua.lua_pushnumber(L, target[field]);
    return 1;
  }

  edgeVelocityAccessor(L) {
    const simulation = this.simulation();
    if (lua.lua_gettop(L)) {
      this.markMutated();
      simulation.air.edgeVelocityX = Math.max(-32, Math.min(32, lauxlib.luaL_checknumber(L, 1)));
      simulation.air.edgeVelocityY = Math.max(-32, Math.min(32, lauxlib.luaL_optnumber(L, 2, 0)));
      simulation.air.edgeVelocityZ = Math.max(-32, Math.min(32, lauxlib.luaL_optnumber(L, 3, 0)));
    }
    lua.lua_pushnumber(L, simulation.air.edgeVelocityX);
    lua.lua_pushnumber(L, simulation.air.edgeVelocityY);
    lua.lua_pushnumber(L, simulation.air.edgeVelocityZ);
    return 3;
  }

  elementCount(L) {
    const type = lauxlib.luaL_optinteger(L, 1, MAT.EMPTY);
    if (materialById(type).id !== type) throw new Error(`invalid element ${type}`);
    let count = 0;
    for (const current of this.simulation().types) if (current === type) count += 1;
    for (const current of this.simulation().energyTypes) if (current === type) count += 1;
    lua.lua_pushinteger(L, count);
    return 1;
  }

  rendererBooleanAccessor(L, field) {
    if (lua.lua_gettop(L)) {
      this.rendererSettings[field] = lua.lua_toboolean(L, 1);
      this.context?.setRendererSetting?.(field, this.rendererSettings[field]);
    }
    lua.lua_pushboolean(L, this.rendererSettings[field]);
    return 1;
  }

  rendererGridAccessor(L) {
    if (lua.lua_gettop(L)) {
      this.rendererSettings.grid = Math.max(0, Math.min(9, lauxlib.luaL_checkinteger(L, 1)));
      this.context?.setRendererSetting?.("grid", this.rendererSettings.grid);
    }
    lua.lua_pushinteger(L, this.rendererSettings.grid);
    return 1;
  }

  rendererDepthAccessor(L) {
    const simulation = this.simulation();
    let depth = this.currentDepth();
    if (lua.lua_gettop(L)) {
      depth = Math.max(0, Math.min(simulation.depth - 1, lauxlib.luaL_checkinteger(L, 1)));
      this.context?.setDepth?.(depth);
    }
    lua.lua_pushinteger(L, depth);
    return 1;
  }

  uiWindowSize(L) {
    const size = this.context?.windowSize?.() ?? [this.simulation().width, this.simulation().height];
    lua.lua_pushinteger(L, Math.round(size[0]));
    lua.lua_pushinteger(L, Math.round(size[1]));
    return 2;
  }

  uiBrushRadius(L) {
    let radius = Math.max(0, Math.round(this.context?.brushRadius?.() ?? 0));
    if (lua.lua_gettop(L)) {
      radius = Math.max(0, Math.min(12, lauxlib.luaL_checkinteger(L, 1)));
      this.context?.setBrushRadius?.(radius);
      radius = Math.max(0, Math.round(this.context?.brushRadius?.() ?? radius));
    }
    lua.lua_pushinteger(L, radius);
    lua.lua_pushinteger(L, radius);
    return 2;
  }

  uiMousePosition(L) {
    const position = this.context?.mousePosition?.() ?? [0, 0, this.currentDepth()];
    lua.lua_pushinteger(L, Math.round(position[0]));
    lua.lua_pushinteger(L, Math.round(position[1]));
    lua.lua_pushinteger(L, Math.round(position[2] ?? this.currentDepth()));
    return 3;
  }

  uiActiveTool(L) {
    const tool = this.context?.activeTool?.() ?? MAT.EMPTY;
    lua.lua_pushinteger(L, Number.isInteger(tool) ? tool : MAT.EMPTY);
    return 1;
  }

  uiActiveMenu(L) {
    if (lua.lua_gettop(L)) {
      const menu = lauxlib.luaL_checkinteger(L, 1);
      if (menu < 0 || menu >= CATEGORY_BY_SECTION.length) throw new Error("invalid menu");
      this.context?.setActiveMenu?.(menu);
    }
    const menu = this.context?.activeMenu?.() ?? this.lastContext?.activeMenu?.() ?? 0;
    lua.lua_pushinteger(L, Number.isInteger(menu) ? menu : 0);
    return 1;
  }

  installUiConstructors() {
    lua.lua_getglobal(this.L, s("ui"));
    for (const kind of ["window", "button", "label", "textbox", "checkbox", "slider", "progressBar"]) {
      lua.lua_pushcfunction(this.L, this.guarded((L) => this.createUiComponent(L, kind)));
      lua.lua_setfield(this.L, -2, s(kind));
    }
    lua.lua_pop(this.L, 1);
  }

  uiComponentFromLua(L, index = 1) {
    if (lua.lua_type(L, index) !== lua.LUA_TTABLE) throw new Error("expected UI component");
    lua.lua_getfield(L, index, s("__powder3UiId"));
    const id = lauxlib.luaL_checkinteger(L, -1);
    lua.lua_pop(L, 1);
    const component = this.uiComponents.get(id);
    if (!component) throw new Error("UI component has been released");
    return component;
  }

  uiSnapshot(component) {
    const { callbacks, luaReference, ...snapshot } = component;
    return { ...snapshot, children: [...component.children] };
  }

  syncUi(component) {
    (this.context ?? this.lastContext)?.upsertLuaComponent?.(this.uiSnapshot(component));
  }

  uiMethod(L, method) {
    const component = this.uiComponentFromLua(L, 1);
    const count = lua.lua_gettop(L);
    const callbackNames = new Set(["action", "onTextChanged", "onValueChanged", "onInitialized", "onExit", "onTick", "onDraw", "onFocus", "onBlur", "onTryExit", "onTryOkay", "onMouseMove", "onMouseDown", "onMouseUp", "onMouseWheel", "onKeyPress", "onKeyRelease"]);
    if (callbackNames.has(method)) {
      const previous = component.callbacks.get(method);
      if (Number.isInteger(previous)) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, previous);
      if (count >= 2 && lua.lua_isfunction(L, 2)) {
        lua.lua_pushvalue(L, 2);
        component.callbacks.set(method, lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX));
      } else component.callbacks.delete(method);
      return 0;
    }
    if (method === "addComponent" || method === "removeComponent") {
      if (component.kind !== "window") throw new Error("only windows contain components");
      const child = this.uiComponentFromLua(L, 2);
      if (method === "addComponent") {
        component.children.add(child.id);
        child.parent = component.id;
      } else {
        component.children.delete(child.id);
        child.parent = null;
      }
      this.syncUi(component);
      this.syncUi(child);
      return 0;
    }
    if (method === "position" || method === "size") {
      const fields = method === "position" ? ["x", "y"] : ["width", "height"];
      if (count >= 3) {
        component[fields[0]] = lauxlib.luaL_checkinteger(L, 2);
        component[fields[1]] = lauxlib.luaL_checkinteger(L, 3);
        this.syncUi(component);
        return 0;
      }
      lua.lua_pushinteger(L, component[fields[0]]);
      lua.lua_pushinteger(L, component[fields[1]]);
      return 2;
    }
    const booleanFields = { visible: "visible", enabled: "enabled", checked: "checked", readonly: "readonly", focus: "focused" };
    const numericFields = { value: "value", steps: "steps", progress: "progress" };
    const stringFields = { text: "text", status: "status" };
    const field = booleanFields[method] ?? numericFields[method] ?? stringFields[method];
    if (!field) throw new Error(`unsupported UI method ${method}`);
    if (count >= 2) {
      component[field] = booleanFields[method] ? Boolean(lua.lua_toboolean(L, 2))
        : numericFields[method] ? lauxlib.luaL_checkinteger(L, 2) : to_jsstring(lauxlib.luaL_checkstring(L, 2));
      if (method === "steps") component.steps = Math.max(1, component.steps);
      if (method === "value") component.value = Math.max(0, Math.min(component.steps, component.value));
      if (method === "progress") component.progress = Math.max(-1, Math.min(100, component.progress));
      this.syncUi(component);
      return 0;
    }
    pushValue(L, component[field]);
    return 1;
  }

  createUiComponent(L, kind) {
    const integer = (index, fallback) => lua.lua_gettop(L) >= index && !lua.lua_isnil(L, index) ? lauxlib.luaL_checkinteger(L, index) : fallback;
    const text = (index, fallback = "") => lua.lua_gettop(L) >= index && lua.lua_type(L, index) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tolstring(L, index)) : fallback;
    const component = {
      id: this.nextUiComponentId++, kind, x: integer(1, kind === "window" ? 1 : 0), y: integer(2, kind === "window" ? 1 : 0),
      width: Math.max(kind === "window" ? 10 : 1, integer(3, 10)), height: Math.max(kind === "window" ? 10 : 1, integer(4, 10)),
      text: text(5), tooltip: text(6), visible: true, enabled: true, checked: false, readonly: false, focused: false,
      value: 0, steps: Math.max(1, kind === "slider" ? integer(5, 10) : 100), progress: kind === "progressBar" ? integer(5, 0) : 0,
      status: kind === "progressBar" ? text(6) : "", placeholder: kind === "textbox" ? text(6) : "", shown: false, parent: null,
      children: new Set(), callbacks: new Map(), luaReference: null,
    };
    if (kind === "slider") component.text = "";
    if (kind === "progressBar") component.text = "";
    this.uiComponents.set(component.id, component);
    lua.lua_newtable(L);
    lua.lua_pushinteger(L, component.id);
    lua.lua_setfield(L, -2, s("__powder3UiId"));
    const common = ["position", "size", "visible"];
    const methods = {
      window: [...common, "addComponent", "removeComponent", "onInitialized", "onExit", "onTick", "onDraw", "onFocus", "onBlur", "onTryExit", "onTryOkay", "onMouseMove", "onMouseDown", "onMouseUp", "onMouseWheel", "onKeyPress", "onKeyRelease"],
      button: [...common, "action", "text", "enabled"], label: [...common, "text"],
      textbox: [...common, "text", "readonly", "focus", "onTextChanged"],
      checkbox: [...common, "action", "text", "checked"], slider: [...common, "value", "steps", "onValueChanged"],
      progressBar: [...common, "progress", "status"],
    }[kind];
    for (const method of methods) {
      lua.lua_pushcfunction(L, this.guarded((state) => this.uiMethod(state, method)));
      lua.lua_setfield(L, -2, s(method));
    }
    lua.lua_pushvalue(L, -1);
    component.luaReference = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    this.syncUi(component);
    return 1;
  }

  uiShowWindow(L, visible) {
    const component = this.uiComponentFromLua(L, 1);
    if (component.kind !== "window") throw new Error("expected window");
    component.shown = visible;
    this.syncUi(component);
    if (visible) this.invokeUiCallback(component, "onInitialized", [], this.context ?? this.lastContext);
    else this.invokeUiCallback(component, "onExit", [], this.context ?? this.lastContext);
    return 0;
  }

  uiRootComponent(L, add) {
    const component = this.uiComponentFromLua(L, 1);
    component.parent = add ? 0 : null;
    component.shown = add;
    this.syncUi(component);
    return 0;
  }

  uiConsoleAccessor(L) {
    const context = this.context ?? this.lastContext;
    if (lua.lua_gettop(L)) context?.setConsoleOpen?.(Boolean(lua.lua_toboolean(L, 1)));
    lua.lua_pushboolean(L, context?.consoleOpen?.() ?? false);
    return 1;
  }

  uiPrompt(L, kind) {
    const context = this.context ?? this.lastContext;
    const title = lua.lua_type(L, 1) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tolstring(L, 1)) : "Title";
    const message = lua.lua_type(L, 2) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tolstring(L, 2)) : "Message";
    const initial = lua.lua_type(L, 3) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tolstring(L, 3)) : "";
    const result = context?.luaPrompt?.(kind, { title, message, initial });
    const callbackIndex = lua.lua_isfunction(L, lua.lua_gettop(L)) ? lua.lua_gettop(L) : -1;
    if (callbackIndex > 0) {
      lua.lua_pushvalue(L, callbackIndex);
      const reference = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
      this.invokeReference(reference, kind === "message" || kind === "error" ? [] : [result], context);
      lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, reference);
    }
    pushValue(L, result);
    return 1;
  }

  booleanSettingAccessor(L, path) {
    const [target, field] = this.nestedSetting(path);
    if (lua.lua_gettop(L)) { this.markMutated(); target[field] = lua.lua_toboolean(L, 1); }
    lua.lua_pushboolean(L, target[field]);
    return 1;
  }

  pauseAccessor(L) {
    if (lua.lua_gettop(L)) this.context?.setPaused?.(lua.lua_toboolean(L, 1));
    lua.lua_pushboolean(L, this.context?.paused?.() ?? false);
    return 1;
  }

  stepSimulation(L) {
    const count = Math.max(1, Math.min(240, lauxlib.luaL_optinteger(L, 1, 1)));
    this.markMutated();
    for (let index = 0; index < count; index += 1) this.simulation().step();
    lua.lua_pushinteger(L, this.simulation().tick);
    return 1;
  }

  tptCreate(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const type = lauxlib.luaL_checkinteger(L, 3);
    const z = lua.lua_gettop(L) >= 4 ? lauxlib.luaL_checkinteger(L, 4) : this.currentDepth();
    lua.lua_settop(L, 0);
    for (const value of [-1, x, y, z, type]) lua.lua_pushinteger(L, value);
    return this.partCreate(L);
  }

  tptDelete(L) {
    const simulation = this.simulation();
    const x = lauxlib.luaL_checkinteger(L, 1);
    const y = lauxlib.luaL_checkinteger(L, 2);
    const z = lua.lua_gettop(L) >= 3 ? lauxlib.luaL_checkinteger(L, 3) : this.currentDepth();
    this.checkedVoxel(x, y, z);
    lua.lua_settop(L, 0);
    lua.lua_pushinteger(L, simulation.index(x, y, z));
    return this.partKill(L);
  }

  tptGetProperty(L) {
    const simulation = this.simulation();
    const field = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    const x = lauxlib.luaL_checkinteger(L, 2);
    const y = lauxlib.luaL_checkinteger(L, 3);
    const z = lua.lua_gettop(L) >= 4 ? lauxlib.luaL_checkinteger(L, 4) : this.currentDepth();
    this.checkedVoxel(x, y, z);
    lua.lua_settop(L, 0);
    lua.lua_pushinteger(L, simulation.index(x, y, z));
    lua.lua_pushstring(L, s(field));
    return this.partProperty(L);
  }

  tptSetProperty(L) {
    const simulation = this.simulation();
    const field = to_jsstring(lauxlib.luaL_checkstring(L, 1)).toLowerCase();
    const value = lauxlib.luaL_checknumber(L, 2);
    const selector = lua.lua_gettop(L) >= 3 && lua.lua_type(L, 3) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tolstring(L, 3)).toLowerCase() : "all";
    const type = selector === "all" ? null : Number.isInteger(Number(selector)) ? Number(selector) : MAT[selector.toUpperCase()];
    if (selector !== "all" && !Number.isInteger(type)) throw new Error(`unknown element selector ${selector}`);
    this.markMutated();
    let changed = 0;
    for (let index = 0; index < simulation.size; index += 1) {
      const layer = simulation.types[index] !== MAT.EMPTY ? false : simulation.energyTypes[index] !== MAT.EMPTY ? true : null;
      if (layer == null) continue;
      const currentType = layer ? simulation.energyTypes[index] : simulation.types[index];
      if (type != null && currentType !== type) continue;
      if (simulation.applyParticlePropertyAt(index, field === "temperature" ? "temp" : field === "dcolor" ? "dcolour" : field, value)) changed += 1;
    }
    lua.lua_pushinteger(L, changed);
    return 1;
  }

  refreshElementUi() {
    this.context?.refreshMaterials?.();
  }

  setElementConstant(identifier, code, id) {
    for (const table of ["elements", "elem"]) {
      lua.lua_getglobal(this.L, s(table));
      if (id == null) lua.lua_pushnil(this.L);
      else lua.lua_pushinteger(this.L, id);
      lua.lua_setfield(this.L, -2, s(identifier));
      if (code) {
        if (id == null) lua.lua_pushnil(this.L);
        else lua.lua_pushinteger(this.L, id);
        lua.lua_setfield(this.L, -2, s(code));
      }
      lua.lua_pop(this.L, 1);
    }
  }

  elementAllocate(L) {
    const group = to_jsstring(lauxlib.luaL_checkstring(L, 1));
    const code = to_jsstring(lauxlib.luaL_checkstring(L, 2));
    const id = allocateRuntimeMaterial(group, code);
    const material = materialById(id);
    this.setElementConstant(material.identifier, material.code, id);
    this.refreshElementUi();
    lua.lua_pushinteger(L, id);
    return 1;
  }

  clearElementCallbacks(id) {
    const callbacks = this.elementCallbacks.get(id);
    if (!callbacks) return;
    for (const reference of callbacks.values()) if (Number.isInteger(reference)) lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, reference);
    this.elementCallbacks.delete(id);
    this.elementGraphicsCache.delete(id);
    this.refreshElementCallbackTypes();
  }

  elementFree(L) {
    const id = lauxlib.luaL_checkinteger(L, 1);
    const material = materialById(id);
    if (!isRuntimeMaterial(id)) throw new Error("cannot free default elements");
    this.clearElementCallbacks(id);
    freeRuntimeMaterial(id);
    this.setElementConstant(material.identifier, material.code, null);
    const simulation = this.context?.simulation;
    if (simulation) {
      for (let index = 0; index < simulation.size; index += 1) {
        if (simulation.types[index] === id) simulation.set(...simulation.coords(index), MAT.EMPTY);
        if (simulation.energyTypes[index] === id) simulation.killEnergy(index);
      }
    }
    this.refreshElementUi();
    return 0;
  }

  elementLoadDefault(L) {
    const id = lua.lua_gettop(L) ? lauxlib.luaL_checkinteger(L, 1) : null;
    const before = id == null ? allMaterials().filter((material) => isRuntimeMaterial(material.id)) : [materialById(id)];
    if (id == null) for (const material of allMaterials()) this.clearElementCallbacks(material.id);
    else this.clearElementCallbacks(id);
    loadDefaultRuntimeMaterial(id);
    for (const material of before) if (!materialById(material.id).enabled || !isRuntimeMaterial(material.id)) this.setElementConstant(material.identifier, material.code, null);
    for (const material of allMaterials()) this.setElementConstant(material.identifier, material.code, material.id);
    this.refreshElementUi();
    lua.lua_pushboolean(L, true);
    return 1;
  }

  elementMask(material) {
    if (Number.isInteger(material.propertyMask)) return material.propertyMask;
    let mask = material.state === "energy" ? ELEMENT_FLAGS.TYPE_ENERGY
      : material.render === "liquid" ? ELEMENT_FLAGS.TYPE_LIQUID
        : material.render === "gas" ? ELEMENT_FLAGS.TYPE_GAS
          : material.render === "solid" ? ELEMENT_FLAGS.TYPE_SOLID : ELEMENT_FLAGS.TYPE_PART;
    for (const [name, bit] of Object.entries(ELEMENT_FLAGS)) if (name.startsWith("PROP_") && material.properties.includes(name)) mask |= bit;
    return mask;
  }

  setElementCallback(L, id, name, index) {
    const callbacks = this.elementCallbacks.get(id) ?? new Map();
    const previous = callbacks.get(name);
    if (Number.isInteger(previous)) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, previous);
    if (lua.lua_isfunction(L, index)) {
      lua.lua_pushvalue(L, index);
      callbacks.set(name, lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX));
      this.elementCallbacks.set(id, callbacks);
    } else {
      callbacks.delete(name);
      if (!callbacks.size) this.elementCallbacks.delete(id);
    }
    if (name === "Graphics") this.elementGraphicsCache.delete(id);
    this.refreshElementCallbackTypes();
  }

  refreshElementCallbackTypes() {
    if (!this.attachedSimulation) return;
    const updateTypes = new Set([...this.elementCallbacks].filter(([, callbacks]) => callbacks.has("Update")).map(([id]) => id));
    const graphicsTypes = new Set([...this.elementCallbacks].filter(([, callbacks]) => callbacks.has("Graphics")).map(([id]) => id));
    this.attachedSimulation.customElementUpdateTypes = updateTypes.size ? updateTypes : null;
    this.attachedSimulation.customElementGraphicsTypes = graphicsTypes.size ? graphicsTypes : null;
  }

  defaultPropertiesFromLua(L, index, current) {
    if (lua.lua_type(L, index) !== lua.LUA_TTABLE) throw new Error("DefaultProperties must be a table");
    const absolute = lua.lua_absindex(L, index);
    const updates = {};
    for (const [field, target] of [["temp", "defaultTemp"], ["life", "defaultLife"], ["ctype", "defaultCtype"], ["tmp", "defaultTmp"], ["tmp2", "defaultTmp2"], ["tmp3", "defaultTmp3"], ["tmp4", "defaultTmp4"]]) {
      lua.lua_getfield(L, absolute, s(field));
      if (!lua.lua_isnil(L, -1)) updates[target] = lauxlib.luaL_checknumber(L, -1);
      lua.lua_pop(L, 1);
    }
    return { ...current, ...updates };
  }

  setElementFieldFromLua(L, id, name, index) {
    const material = materialById(id);
    if (material.id !== id) throw new Error(`invalid element ${id}`);
    if (["Update", "Graphics", "Create", "CreateAllowed", "ChangeType", "CtypeDraw"].includes(name)) {
      this.setElementCallback(L, id, name, index);
      return;
    }
    if (name === "DefaultProperties") {
      updateRuntimeMaterial(id, this.defaultPropertiesFromLua(L, index, {}));
      return;
    }
    const number = () => lauxlib.luaL_checknumber(L, index);
    const integer = () => lauxlib.luaL_checkinteger(L, index);
    const text = () => to_jsstring(lauxlib.luaL_checkstring(L, index));
    const simple = {
      Name: ["name", text], Description: ["description", text], Colour: ["color", integer],
      MenuVisible: ["menuVisible", () => Boolean(lua.lua_toboolean(L, index))], Enabled: ["enabled", () => Boolean(lua.lua_toboolean(L, index))],
      Weight: ["density", number], HeatConduct: ["conductivity", () => Math.max(0, Math.min(1, number() / 255))],
      PhotonReflectWavelengths: ["photonReflectWavelengths", integer], Properties: ["propertyMask", integer],
      Flammable: ["flammable", () => number() / 1000], Explosive: ["explosive", () => Boolean(integer())],
      LowPressure: ["lowPressure", number], HighPressure: ["highPressure", number],
      LowTemperature: ["lowTemperature", number], HighTemperature: ["highTemperature", number],
      LowPressureTransition: ["lowPressureTransition", integer], HighPressureTransition: ["highPressureTransition", integer],
      LowTemperatureTransition: ["lowTemperatureTransition", integer], HighTemperatureTransition: ["highTemperatureTransition", integer],
    };
    if (simple[name]) {
      const [field, read] = simple[name];
      updateRuntimeMaterial(id, { [field]: read() });
      return;
    }
    const upstream = {
      Advection: "advection", AirDrag: "airDrag", AirLoss: "airLoss", Loss: "loss", Collision: "collision",
      Gravity: "gravity", Diffusion: "diffusion", HotAir: "hotAir", Falldown: "falldown", Hardness: "hardness", Meltable: "meltable",
    };
    if (upstream[name]) {
      updateRuntimeMaterial(id, { upstream: { [upstream[name]]: number() } });
      return;
    }
    if (name === "MenuSection") {
      const category = CATEGORY_BY_SECTION[integer()];
      if (!category) throw new Error("invalid menu section");
      updateRuntimeMaterial(id, { category });
      return;
    }
    if (name === "UpdateMode") {
      const mode = integer();
      if (mode < 0 || mode >= ELEMENT_FLAGS.NUM_UPDATEMODES) throw new Error("invalid update mode");
      updateRuntimeMaterial(id, { updateMode: mode });
      return;
    }
    throw new Error(`invalid element property ${name}`);
  }

  elementProperty(L) {
    const id = lauxlib.luaL_checkinteger(L, 1);
    const name = to_jsstring(lauxlib.luaL_checkstring(L, 2));
    const material = materialById(id);
    if (material.id !== id) { lua.lua_pushnil(L); return 1; }
    if (lua.lua_gettop(L) >= 3) {
      this.setElementFieldFromLua(L, id, name, 3);
      this.refreshElementUi();
      return 0;
    }
    const callback = this.elementCallbacks.get(id)?.get(name);
    if (Number.isInteger(callback)) { lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, callback); return 1; }
    const aliases = {
      Name: "name", Description: "description", Colour: "color", MenuVisible: "menuVisible", Enabled: "enabled", Weight: "density",
      HeatConduct: "conductivity", PhotonReflectWavelengths: "photonReflectWavelengths", Properties: "propertyMask",
      MenuSection: "category", UpdateMode: "updateMode", Flammable: "flammable", Explosive: "explosive",
    };
    const field = aliases[name] ?? name;
    let value = field === "propertyMask" ? this.elementMask(material) : material[field] ?? material.upstream?.[field];
    if (name === "MenuSection") value = Math.max(0, CATEGORY_BY_SECTION.indexOf(material.category));
    if (name === "HeatConduct") value = Math.round((material.conductivity ?? 0) * 255);
    if (name === "Flammable") value = Math.round((material.flammable ?? 0) * 1000);
    pushValue(L, field === "color" && typeof value === "string" ? Number.parseInt(value.replace("#", ""), 16) : value);
    return 1;
  }

  elementByName(L) {
    const requested = to_jsstring(lauxlib.luaL_checkstring(L, 1)).toUpperCase();
    const material = allMaterials().find((candidate) => candidate.code.toUpperCase() === requested || candidate.identifier.toUpperCase() === requested);
    lua.lua_pushinteger(L, material?.id ?? MAT.EMPTY);
    return 1;
  }

  elementDefinition(L) {
    const id = lauxlib.luaL_checkinteger(L, 1);
    const material = materialById(id);
    if (material.id !== id) throw new Error(`invalid element ${id}`);
    if (lua.lua_gettop(L) >= 2) {
      if (lua.lua_type(L, 2) !== lua.LUA_TTABLE) throw new Error("element definition must be a table");
      const fields = [
        "Name", "Description", "Colour", "MenuVisible", "Enabled", "Weight", "HeatConduct", "PhotonReflectWavelengths", "Properties",
        "MenuSection", "UpdateMode", "Flammable", "Explosive", "Advection", "AirDrag", "AirLoss", "Loss", "Collision", "Gravity",
        "Diffusion", "HotAir", "Falldown", "Hardness", "Meltable", "LowPressure", "HighPressure", "LowTemperature", "HighTemperature",
        "LowPressureTransition", "HighPressureTransition", "LowTemperatureTransition", "HighTemperatureTransition", "DefaultProperties",
        "Update", "Graphics", "Create", "CreateAllowed", "ChangeType", "CtypeDraw",
      ];
      for (const field of fields) {
        lua.lua_getfield(L, 2, s(field));
        if (!lua.lua_isnil(L, -1)) this.setElementFieldFromLua(L, id, field, -1);
        lua.lua_pop(L, 1);
      }
      this.refreshElementUi();
      return 0;
    }
    const values = {
      Identifier: material.identifier,
      Name: material.name,
      Description: material.description,
      Colour: typeof material.color === "number" ? material.color >>> 0 : Number.parseInt(String(material.color).replace("#", ""), 16),
      MenuVisible: material.menuVisible,
      Enabled: material.enabled,
      Weight: material.density,
      HeatConduct: material.conductivity,
      PhotonReflectWavelengths: material.photonReflectWavelengths,
      Properties: this.elementMask(material),
      MenuSection: Math.max(0, CATEGORY_BY_SECTION.indexOf(material.category)),
      UpdateMode: material.updateMode ?? ELEMENT_FLAGS.UPDATE_AFTER,
    };
    lua.lua_newtable(L);
    for (const [field, value] of Object.entries(values)) {
      pushValue(L, value);
      lua.lua_setfield(L, -2, s(field));
    }
    lua.lua_newtable(L);
    pushValue(L, material.defaultTemp ?? 22);
    lua.lua_setfield(L, -2, s("temp"));
    pushValue(L, material.defaultLife ?? 0);
    lua.lua_setfield(L, -2, s("life"));
    pushValue(L, material.defaultCtype ?? 0);
    lua.lua_setfield(L, -2, s("ctype"));
    for (const field of ["tmp", "tmp2", "tmp3", "tmp4"]) {
      const suffix = field === "tmp" ? "Tmp" : `Tmp${field.slice(3)}`;
      pushValue(L, material[`default${suffix}`] ?? 0);
      lua.lua_setfield(L, -2, s(field));
    }
    lua.lua_setfield(L, -2, s("DefaultProperties"));
    return 1;
  }

  registerEvent(L) {
    const eventId = lauxlib.luaL_checkinteger(L, 1);
    const name = EVENT_NAME.get(eventId);
    if (!name) throw new Error(`unsupported event ${eventId}`);
    if (!lua.lua_isfunction(L, 2)) throw new Error("event.register expects a function");
    lua.lua_pushvalue(L, 2);
    const reference = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    this.eventCallbacks.get(name).push(reference);
    lua.lua_pushinteger(L, reference);
    return 1;
  }

  unregisterEvent(L) {
    const eventId = lauxlib.luaL_checkinteger(L, 1);
    const reference = lauxlib.luaL_checkinteger(L, 2);
    const name = EVENT_NAME.get(eventId);
    if (!name) { lua.lua_pushboolean(L, false); return 1; }
    const callbacks = this.eventCallbacks.get(name);
    const index = callbacks.indexOf(reference);
    if (index < 0) { lua.lua_pushboolean(L, false); return 1; }
    callbacks.splice(index, 1);
    lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, reference);
    lua.lua_pushboolean(L, true);
    return 1;
  }

  invokeReference(reference, args, context, component = null) {
    const previousContext = this.context;
    const previousEventMode = this.eventMode;
    const previousTop = lua.lua_gettop(this.L);
    this.context = context ?? this.lastContext;
    this.lastContext = this.context ?? this.lastContext;
    this.eventMode = true;
    lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, reference);
    let argumentCount = 0;
    if (component) {
      lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, component.luaReference);
      argumentCount += 1;
    }
    for (const value of args) { pushValue(this.L, value); argumentCount += 1; }
    if (lua.lua_pcall(this.L, argumentCount, 0, 0) !== lua.LUA_OK) {
      const message = valueAt(this.L, -1);
      lua.lua_pop(this.L, 1);
      this.emit(`Lua UI error: ${message}`);
    }
    lua.lua_settop(this.L, previousTop);
    this.context = previousContext;
    this.eventMode = previousEventMode;
  }

  invokeUiCallback(component, event, args, context) {
    const reference = component.callbacks.get(event);
    if (!Number.isInteger(reference)) return;
    this.invokeReference(reference, args, context, component);
  }

  invokeUiEvent(id, event, values = [], context = this.lastContext) {
    const component = this.uiComponents.get(Number(id));
    if (!component) return [];
    this.output = [];
    if (component.kind === "checkbox" && event === "action") {
      component.checked = Boolean(values[0]);
      values = [component.checked];
    } else if (component.kind === "textbox" && event === "onTextChanged") {
      component.text = String(values[0] ?? "");
      values = [];
    } else if (component.kind === "slider" && event === "onValueChanged") {
      component.value = Math.max(0, Math.min(component.steps, Math.round(Number(values[0]) || 0)));
      values = [component.value];
    }
    this.syncUi(component);
    this.invokeUiCallback(component, event, values, context);
    return [...this.output];
  }

  closeUiWindow(id, context = this.lastContext) {
    const component = this.uiComponents.get(Number(id));
    if (!component || component.kind !== "window") return [];
    component.shown = false;
    this.syncUi(component);
    return this.invokeUiEvent(id, "onExit", [], context);
  }

  attachSimulation(simulation) {
    if (!simulation || this.attachedSimulation === simulation) return;
    if (this.attachedSimulation?.customElementUpdate?.__powderLuaRuntime === this) {
      this.attachedSimulation.customElementUpdate = null;
      this.attachedSimulation.customElementUpdateTypes = null;
      this.attachedSimulation.customElementGraphics = null;
      this.attachedSimulation.customElementGraphicsTypes = null;
    }
    const update = (type, index, x, y, z) => this.invokeElementUpdate(type, index, x, y, z);
    update.__powderLuaRuntime = this;
    const graphics = (type, index, red, green, blue) => this.invokeElementGraphics(type, index, red, green, blue);
    graphics.__powderLuaRuntime = this;
    simulation.customElementUpdate = update;
    simulation.customElementGraphics = graphics;
    this.attachedSimulation = simulation;
    this.refreshElementCallbackTypes();
  }

  invokeElementUpdate(type, index, x, y, z) {
    const reference = this.elementCallbacks.get(type)?.get("Update");
    if (!Number.isInteger(reference)) return false;
    const previousContext = this.context;
    const previousEventMode = this.eventMode;
    const previousTop = lua.lua_gettop(this.L);
    this.context = this.lastContext;
    this.eventMode = true;
    try {
      this.resetBudget();
      lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, reference);
      for (const value of [index, x, y, 0, 0, z]) lua.lua_pushinteger(this.L, value);
      if (lua.lua_pcall(this.L, 6, 1, 0) !== lua.LUA_OK) {
        const message = valueAt(this.L, -1);
        lua.lua_pop(this.L, 1);
        this.emit(`Lua element ${type} update error: ${message}`);
        return false;
      }
      const replace = lua.lua_toboolean(this.L, -1);
      lua.lua_pop(this.L, 1);
      return replace;
    } finally {
      lua.lua_sethook(this.L, null, 0, 0);
      lua.lua_settop(this.L, previousTop);
      this.context = previousContext;
      this.eventMode = previousEventMode;
    }
  }

  emitElementGraphicsError(type, message) {
    const tick = this.attachedSimulation?.tick ?? -1;
    if (this.elementGraphicsErrorTick.get(type) === tick) return;
    this.elementGraphicsErrorTick.set(type, tick);
    this.emit(`Lua element ${type} graphics error: ${message}`);
  }

  invokeElementGraphics(type, index, red, green, blue) {
    const reference = this.elementCallbacks.get(type)?.get("Graphics");
    if (!Number.isInteger(reference)) return null;
    const cached = this.elementGraphicsCache.get(type);
    if (cached) return cached;
    const previousContext = this.context;
    const previousEventMode = this.eventMode;
    const previousReadOnly = this.readOnlySimulation;
    const previousTop = lua.lua_gettop(this.L);
    this.context = this.lastContext;
    this.eventMode = true;
    this.readOnlySimulation = true;
    try {
      this.resetBudget(Math.min(this.instructionLimit, 50000));
      lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, reference);
      for (const value of [index, red, green, blue]) lua.lua_pushinteger(this.L, Math.trunc(value));
      if (lua.lua_pcall(this.L, 4, 10, 0) !== lua.LUA_OK) {
        const message = valueAt(this.L, -1);
        lua.lua_pop(this.L, 1);
        this.emitElementGraphicsError(type, message);
        return null;
      }
      const defaults = [0, GRAPHICS_MODE.PMODE_FLAT, 255, red, green, blue, 0, 0, 0, 0];
      const values = defaults.map((fallback, offset) => {
        const stackIndex = -10 + offset;
        if (lua.lua_isnil(this.L, stackIndex)) return fallback;
        if (lua.lua_type(this.L, stackIndex) !== lua.LUA_TNUMBER) throw new Error("graphics callback must return numbers or nil");
        return lua.lua_tonumber(this.L, stackIndex);
      });
      const result = {
        cache: Boolean(Math.trunc(values[0])), pixelMode: Math.trunc(values[1]) >>> 0,
        alpha: values[2], red: values[3], green: values[4], blue: values[5],
        fireAlpha: values[6], fireRed: values[7], fireGreen: values[8], fireBlue: values[9],
      };
      if (result.cache) this.elementGraphicsCache.set(type, result);
      return result;
    } catch (error) {
      this.emitElementGraphicsError(type, error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      lua.lua_sethook(this.L, null, 0, 0);
      lua.lua_settop(this.L, previousTop);
      this.context = previousContext;
      this.eventMode = previousEventMode;
      this.readOnlySimulation = previousReadOnly;
    }
  }

  resetBudget(limit = this.instructionLimit) {
    let consumed = 0;
    lua.lua_sethook(this.L, (L) => {
      consumed += INSTRUCTION_GRANULARITY;
      if (consumed > limit) lauxlib.luaL_error(L, s(`script exceeded ${limit} instructions`));
    }, lua.LUA_MASKCOUNT, INSTRUCTION_GRANULARITY);
  }

  errorFromStack() {
    const message = lua.lua_gettop(this.L) ? valueAt(this.L, -1) : "unknown Lua error";
    lua.lua_settop(this.L, 0);
    return new Error(message);
  }

  execute(source, context) {
    this.context = context;
    this.lastContext = context;
    this.attachSimulation(context?.simulation);
    this.output = [];
    this.mutated = false;
    this.eventMode = false;
    lua.lua_settop(this.L, 0);
    this.updateContextGlobals();
    const trimmed = String(source ?? "").trim();
    const code = trimmed.startsWith("=") ? `return ${trimmed.slice(1)}` : trimmed.startsWith("lua ") ? trimmed.slice(4) : trimmed;
    try {
      this.resetBudget();
      if (lauxlib.luaL_loadstring(this.L, to_luastring(code)) !== lua.LUA_OK) throw this.errorFromStack();
      if (lua.lua_pcall(this.L, 0, lua.LUA_MULTRET, 0) !== lua.LUA_OK) throw this.errorFromStack();
      const returned = [];
      for (let index = 1; index <= lua.lua_gettop(this.L); index += 1) returned.push(valueAt(this.L, index));
      lua.lua_settop(this.L, 0);
      const lines = [...this.output];
      if (returned.length) lines.push(returned.join("\t"));
      return lines.join("\n") || "Lua OK";
    } finally {
      lua.lua_sethook(this.L, null, 0, 0);
      if (this.mutated) this.context?.onMutate?.();
      this.context = null;
    }
  }

  dispatch(name, context) {
    const callbacks = this.eventCallbacks.get(name);
    if (!callbacks?.length) return [];
    this.context = context;
    this.lastContext = context;
    this.attachSimulation(context?.simulation);
    this.output = [];
    this.mutated = false;
    this.eventMode = true;
    try {
      lua.lua_settop(this.L, 0);
      this.updateContextGlobals();
      for (const reference of [...callbacks]) {
        lua.lua_settop(this.L, 0);
        this.resetBudget();
        lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, reference);
        if (lua.lua_pcall(this.L, 0, 0, 0) !== lua.LUA_OK) this.emit(`Lua ${name} error: ${this.errorFromStack().message}`);
      }
      return [...this.output];
    } finally {
      lua.lua_sethook(this.L, null, 0, 0);
      if (this.mutated) this.context?.onMutate?.();
      this.context = null;
      this.eventMode = false;
    }
  }
}
