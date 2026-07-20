// SPDX-License-Identifier: GPL-3.0-or-later

import { MAT, materialById } from "./materials.js";
import { parseParticleProperty } from "./property-tool.js";

const PARTICLE_FIELDS = new Map([
  ["temp", ["temperatures", "energyTemperatures"]],
  ["temperature", ["temperatures", "energyTemperatures"]],
  ["life", ["life", "energyLife"]],
  ["ctype", ["ctype", "energyCtype"]],
  ["tmp", ["tmp", "energyTmp"]],
  ["tmp2", ["tmp2", "energyTmp2"]],
  ["tmp3", ["tmp3", "energyTmp3"]],
  ["tmp4", ["tmp4", "energyTmp4"]],
  ["vx", ["velocityX", "energyVelocityX"]],
  ["vy", ["velocityY", "energyVelocityY"]],
  ["vz", ["velocityZ", "energyVelocityZ"]],
  ["flags", ["flags", "energyFlags"]],
  ["deco", ["decorations", "energyDecorations"]],
]);

function tokenize(input) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  for (const character of String(input).trim()) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/.test(character)) {
      if (token) { tokens.push(token); token = ""; }
    } else token += character;
  }
  if (quote) throw new Error("Unterminated quote");
  if (escaped) token += "\\";
  if (token) tokens.push(token);
  return tokens;
}

function number(value, label, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) throw new Error(`${label} must be ${integer ? "an integer" : "a number"}`);
  return parsed;
}

function coordinates(simulation, args) {
  const x = number(args[0], "x", true);
  const y = number(args[1], "y", true);
  const z = number(args[2], "z", true);
  if (!simulation.inBounds(x, y, z)) throw new Error(`Cell ${x},${y},${z} is outside the chamber`);
  return [x, y, z];
}

function elementId(value) {
  const asNumber = Number(value);
  const id = Number.isInteger(asNumber) ? asNumber : MAT[String(value ?? "").toUpperCase()];
  if (!Number.isInteger(id) || materialById(id).id !== id || id === MAT.EMPTY) throw new Error(`Unknown element: ${value}`);
  return id;
}

function toggleValue(value, label) {
  const requested = String(value ?? "").toLowerCase();
  if (!["on", "off", "true", "false", "1", "0"].includes(requested)) throw new Error(`${label} expects on or off`);
  return ["on", "true", "1"].includes(requested);
}

function formatParticle(simulation, index, energy) {
  const type = energy ? simulation.energyTypes[index] : simulation.types[index];
  if (type === MAT.EMPTY) return "empty";
  const prefix = energy ? "energy" : "matter";
  const temperature = energy ? simulation.energyTemperatures[index] : simulation.temperatures[index];
  const life = energy ? simulation.energyLife[index] : simulation.life[index];
  const ctype = energy ? simulation.energyCtype[index] : simulation.ctype[index];
  const tmp = energy ? simulation.energyTmp[index] : simulation.tmp[index];
  const tmp2 = energy ? simulation.energyTmp2[index] : simulation.tmp2[index];
  return `${prefix}=${materialById(type).code}(${type}) temp=${temperature.toFixed(2)}C life=${life} ctype=${ctype} tmp=${tmp} tmp2=${tmp2}`;
}

export function executeConsoleCommand(input, context) {
  const tokens = tokenize(input);
  const command = tokens.shift()?.toLowerCase();
  const simulation = context?.simulation;
  if (!command) return "";
  if (!simulation) throw new Error("Console has no simulation context");
  if (command === "help" || command === "?") {
    return [
      "create TYPE X Y Z [R]  delete X Y Z [R]  inspect X Y Z",
      "set X Y Z FIELD VALUE  prop X Y Z FIELD VALUE  temp X Y Z C  spark X Y Z",
      "pressure X Y Z VALUE  gravity X Y Z MASS  sign X Y Z TEXT",
      "airmode 0..4  gravitymode 0..3 [GX GY GZ]  edgemode 0..2",
      "ambient C  aheat|heat|newton|water on|off",
      "edgepressure N  edgevelocity X Y Z  vorticity 0..1  convection 0..2  decospace 0..3",
      "count [TYPE]  stats  step [N]  pause [on|off]  reset [PRESET]  view MODE  clear",
      "Lua 5.3: prefix with 'lua ', use '= expression', or enter any Lua statement; sim/tpt/elements/elem/ren/event APIs are available",
    ].join("\n");
  }
  if (command === "clear") return { clear: true, text: "Console cleared" };
  if (command === "create") {
    const type = elementId(tokens.shift());
    const [x, y, z] = coordinates(simulation, tokens);
    const radius = tokens[3] == null ? 0 : Math.max(0, Math.min(12, number(tokens[3], "radius", true)));
    context.beforeMutate?.();
    const painted = simulation.paintSphere(x, y, z, radius, type, false);
    context.onMutate?.();
    return `Created ${painted} ${materialById(type).code} cell${painted === 1 ? "" : "s"}`;
  }
  if (command === "delete") {
    const [x, y, z] = coordinates(simulation, tokens);
    const radius = tokens[3] == null ? 0 : Math.max(0, Math.min(12, number(tokens[3], "radius", true)));
    context.beforeMutate?.();
    const painted = simulation.paintSphere(x, y, z, radius, MAT.EMPTY, true);
    simulation.removeSignsInSphere(x, y, z, radius);
    context.onMutate?.();
    return `Cleared ${painted} cell${painted === 1 ? "" : "s"}`;
  }
  if (command === "inspect") {
    const [x, y, z] = coordinates(simulation, tokens);
    const index = simulation.index(x, y, z);
    const air = simulation.air.sampleVoxel(x, y, z);
    const gravity = simulation.gravity.sampleVoxel(x, y, z);
    return `${x},${y},${z}  ${formatParticle(simulation, index, false)}  ${formatParticle(simulation, index, true)}\npressure=${air.pressure.toFixed(3)} flow=${air.velocityX.toFixed(3)},${air.velocityY.toFixed(3)},${air.velocityZ.toFixed(3)} gravity=${gravity.forceX.toFixed(3)},${gravity.forceY.toFixed(3)},${gravity.forceZ.toFixed(3)}`;
  }
  if (command === "spark") {
    const [x, y, z] = coordinates(simulation, tokens);
    context.beforeMutate?.();
    if (!simulation.spark(simulation.index(x, y, z))) throw new Error("Target cannot be sparked");
    context.onMutate?.();
    return `Sparked ${x},${y},${z}`;
  }
  if (command === "temp" || command === "temperature") {
    const [x, y, z] = coordinates(simulation, tokens);
    const value = Math.max(-273.15, Math.min(9725.85, number(tokens[3], "temperature")));
    const index = simulation.index(x, y, z);
    let changed = 0;
    if (simulation.types[index] === MAT.EMPTY && simulation.energyTypes[index] === MAT.EMPTY) throw new Error("Cell is empty");
    context.beforeMutate?.();
    if (simulation.types[index] !== MAT.EMPTY) { simulation.temperatures[index] = value; changed += 1; }
    if (simulation.energyTypes[index] !== MAT.EMPTY) { simulation.energyTemperatures[index] = value; changed += 1; }
    if (!changed) throw new Error("Cell is empty");
    context.onMutate?.();
    return `Temperature set to ${value.toFixed(2)}C on ${changed} layer${changed === 1 ? "" : "s"}`;
  }
  if (command === "set") {
    const [x, y, z] = coordinates(simulation, tokens);
    const fieldName = String(tokens[3] ?? "").toLowerCase();
    const fields = PARTICLE_FIELDS.get(fieldName);
    if (!fields) throw new Error(`Unknown writable field: ${fieldName}`);
    const value = number(tokens[4], fieldName, !["temp", "temperature", "vx", "vy", "vz"].includes(fieldName));
    const index = simulation.index(x, y, z);
    let changed = 0;
    if (simulation.types[index] === MAT.EMPTY && simulation.energyTypes[index] === MAT.EMPTY) throw new Error("Cell is empty");
    context.beforeMutate?.();
    if (simulation.types[index] !== MAT.EMPTY) { simulation[fields[0]][index] = value; changed += 1; }
    if (simulation.energyTypes[index] !== MAT.EMPTY) { simulation[fields[1]][index] = value; changed += 1; }
    if (!changed) throw new Error("Cell is empty");
    context.onMutate?.();
    return `${fieldName}=${value} on ${changed} layer${changed === 1 ? "" : "s"}`;
  }
  if (command === "prop" || command === "property") {
    const [x, y, z] = coordinates(simulation, tokens);
    const parsed = parseParticleProperty(tokens[3], tokens[4]);
    const index = simulation.index(x, y, z);
    if (simulation.particleLayerAt(index) == null) throw new Error("Cell is empty");
    context.beforeMutate?.();
    if (!simulation.applyParticlePropertyAt(index, parsed.property, parsed.value)) throw new Error("Property edit had no effect");
    context.onMutate?.();
    return `${parsed.property}=${parsed.value} at ${x},${y},${z}`;
  }
  if (command === "pressure") {
    const [x, y, z] = coordinates(simulation, tokens);
    const value = Math.max(-256, Math.min(256, number(tokens[3], "pressure")));
    context.beforeMutate?.();
    simulation.air.pressure[simulation.air.indexForVoxel(x, y, z)] = value;
    context.onMutate?.();
    return `Pressure set to ${value.toFixed(3)}`;
  }
  if (command === "gravity") {
    const [x, y, z] = coordinates(simulation, tokens);
    const mass = Math.max(-100, Math.min(100, number(tokens[3], "mass")));
    context.beforeMutate?.();
    simulation.gravity.toolMass[simulation.gravity.indexForVoxel(x, y, z)] = mass;
    context.onMutate?.();
    return `Gravity mass set to ${mass.toFixed(3)}`;
  }
  if (command === "airmode") {
    const mode = Math.max(0, Math.min(4, number(tokens[0], "air mode", true)));
    context.beforeMutate?.();
    simulation.air.mode = mode;
    context.onMutate?.();
    return `Air mode set to ${mode}`;
  }
  if (command === "gravitymode") {
    const names = { vertical: 0, off: 1, radial: 2, custom: 3 };
    const requested = String(tokens[0] ?? "").toLowerCase();
    const mode = Object.hasOwn(names, requested) ? names[requested] : Math.max(0, Math.min(3, number(tokens[0], "gravity mode", true)));
    const custom = mode === 3 && tokens.length >= 4 ? [number(tokens[1], "gx"), number(tokens[2], "gy"), number(tokens[3], "gz")] : null;
    context.beforeMutate?.();
    simulation.gravityMode = mode;
    if (custom) simulation.customGravity = custom;
    context.onMutate?.();
    return `Gravity mode set to ${mode}${custom ? ` (${custom.join(",")})` : ""}`;
  }
  if (command === "edgemode") {
    const names = { void: 0, solid: 1, loop: 2 };
    const requested = String(tokens[0] ?? "").toLowerCase();
    const mode = Object.hasOwn(names, requested) ? names[requested] : Math.max(0, Math.min(2, number(tokens[0], "edge mode", true)));
    context.beforeMutate?.();
    simulation.edgeMode = mode;
    context.onMutate?.();
    return `Edge mode set to ${mode}`;
  }
  if (command === "ambient") {
    const temperature = Math.max(-273.15, Math.min(9725.85, number(tokens[0], "ambient temperature")));
    context.beforeMutate?.();
    simulation.air.ambientTemperature = temperature;
    context.onMutate?.();
    return `Ambient temperature set to ${temperature.toFixed(2)}C`;
  }
  if (command === "aheat") {
    const enabled = toggleValue(tokens[0], "aheat");
    context.beforeMutate?.();
    simulation.air.ambientHeatEnabled = enabled;
    context.onMutate?.();
    return `Ambient heat ${enabled ? "enabled" : "disabled"}`;
  }
  if (["heat", "newton", "water"].includes(command)) {
    const enabled = toggleValue(tokens[0], command);
    context.beforeMutate?.();
    if (command === "heat") simulation.heatSimulationEnabled = enabled;
    else if (command === "newton") simulation.newtonianGravityEnabled = enabled;
    else simulation.waterEqualization = enabled;
    context.onMutate?.();
    return `${command} ${enabled ? "enabled" : "disabled"}`;
  }
  if (command === "edgepressure") {
    const value = Math.max(-256, Math.min(256, number(tokens[0], "edge pressure")));
    context.beforeMutate?.(); simulation.air.edgePressure = value; context.onMutate?.();
    return `Edge pressure set to ${value}`;
  }
  if (command === "edgevelocity") {
    const values = [number(tokens[0], "edge vx"), number(tokens[1], "edge vy"), number(tokens[2], "edge vz")].map((value) => Math.max(-32, Math.min(32, value)));
    context.beforeMutate?.();
    [simulation.air.edgeVelocityX, simulation.air.edgeVelocityY, simulation.air.edgeVelocityZ] = values;
    context.onMutate?.();
    return `Edge velocity set to ${values.join(",")}`;
  }
  if (command === "vorticity") {
    const value = Math.max(0, Math.min(1, number(tokens[0], "vorticity")));
    context.beforeMutate?.(); simulation.air.vorticityCoeff = value; context.onMutate?.();
    return `Vorticity set to ${value}`;
  }
  if (command === "convection" || command === "decospace") {
    const max = command === "convection" ? 2 : 3;
    const value = Math.max(0, Math.min(max, number(tokens[0], command, true)));
    context.beforeMutate?.();
    if (command === "convection") simulation.air.convectionMode = value;
    else simulation.decorationColorSpace = value;
    context.onMutate?.();
    return `${command} set to ${value}`;
  }
  if (command === "sign") {
    const [x, y, z] = coordinates(simulation, tokens);
    const text = tokens.slice(3).join(" ");
    context.beforeMutate?.();
    if (!simulation.addSign(x, y, z, text)) throw new Error("Sign text is empty or sign limit reached");
    context.onMutate?.();
    return `Sign placed at ${x},${y},${z}`;
  }
  if (command === "count") {
    const type = tokens.length ? elementId(tokens[0]) : null;
    let matter = 0;
    let energy = 0;
    for (const current of simulation.types) if (current !== MAT.EMPTY && (type == null || current === type)) matter += 1;
    for (const current of simulation.energyTypes) if (current !== MAT.EMPTY && (type == null || current === type)) energy += 1;
    return `${type == null ? "All particles" : materialById(type).code}: ${matter + energy} (${matter} matter, ${energy} energy)`;
  }
  if (command === "stats") {
    let matter = 0;
    let energy = 0;
    for (const current of simulation.types) if (current !== MAT.EMPTY) matter += 1;
    for (const current of simulation.energyTypes) if (current !== MAT.EMPTY) energy += 1;
    const stats = simulation.calculateStats();
    return [
      `Tick ${simulation.tick}  particles=${stats.active} (${matter} matter, ${energy} energy)  hot=${stats.hot}`,
      `peak=${stats.peakTemp.toFixed(2)}C  ambient=${stats.peakAmbientTemp.toFixed(2)}C  pressure=${stats.maxPressure.toFixed(3)}`,
      `air=${stats.maxAirVelocity.toFixed(3)}  gravity=${stats.maxGravity.toFixed(3)} (${stats.gravitySources} sources)`,
      `moves=${stats.moves}  reactions=${stats.reactions}  explosions=${stats.explosions}`,
    ].join("\n");
  }
  if (command === "step") {
    const steps = tokens[0] == null ? 1 : Math.max(1, Math.min(240, number(tokens[0], "steps", true)));
    context.beforeMutate?.();
    for (let index = 0; index < steps; index += 1) simulation.step();
    context.onMutate?.();
    return `Advanced ${steps} tick${steps === 1 ? "" : "s"} to ${simulation.tick}`;
  }
  if (command === "pause") {
    const requested = tokens[0]?.toLowerCase();
    const paused = requested === "on" || requested === "true" || requested === "1" ? true
      : requested === "off" || requested === "false" || requested === "0" ? false
        : !context.paused?.();
    context.setPaused?.(paused);
    return paused ? "Simulation paused" : "Simulation resumed";
  }
  if (command === "reset") {
    context.reset?.(tokens[0]);
    return `Loaded ${tokens[0] ?? "current"} preset`;
  }
  if (command === "view") {
    if (!tokens[0]) throw new Error("View mode is required");
    context.setView?.(tokens[0].toLowerCase());
    return `View mode: ${tokens[0].toLowerCase()}`;
  }
  throw new Error(`Unknown command: ${command}. Type help for commands.`);
}
