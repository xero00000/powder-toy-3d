// SPDX-License-Identifier: GPL-3.0-or-later

import { MAT, MATERIAL_BY_ID } from "./materials.js";

export const PARTICLE_PROPERTIES = Object.freeze([
  { id: "type", name: "type", kind: "element", description: "Particle element type" },
  { id: "life", name: "life", kind: "integer", description: "Element-defined lifetime or state" },
  { id: "ctype", name: "ctype", kind: "element-or-integer", description: "Element-defined carried type or bit field" },
  { id: "x", name: "x", kind: "float", description: "Move to an X voxel coordinate" },
  { id: "y", name: "y", kind: "float", description: "Move to a Y voxel coordinate" },
  { id: "z", name: "z", kind: "float", description: "Move to a Z voxel coordinate (3D extension)" },
  { id: "vx", name: "vx", kind: "float", description: "X velocity" },
  { id: "vy", name: "vy", kind: "float", description: "Y velocity" },
  { id: "vz", name: "vz", kind: "float", description: "Z velocity (3D extension)" },
  { id: "temp", name: "temp", kind: "temperature", description: "Particle temperature" },
  { id: "flags", name: "flags", kind: "unsigned", description: "Unsigned 32-bit particle flags" },
  { id: "tmp", name: "tmp", kind: "integer", description: "Element-defined temporary field" },
  { id: "tmp2", name: "tmp2", kind: "integer", description: "Element-defined temporary field 2" },
  { id: "tmp3", name: "tmp3", kind: "integer", description: "Element-defined temporary field 3 / pavg0" },
  { id: "tmp4", name: "tmp4", kind: "integer", description: "Element-defined temporary field 4 / pavg1" },
  { id: "dcolour", name: "dcolour", kind: "unsigned", description: "ARGB decoration colour / dcolor" },
]);

const PROPERTY_ALIASES = new Map([
  ["temperature", "temp"], ["deco", "dcolour"], ["dcolor", "dcolour"],
  ["pavg0", "tmp3"], ["pavg1", "tmp4"],
]);

export function canonicalPropertyName(value) {
  const requested = String(value ?? "").trim().toLowerCase();
  const canonical = PROPERTY_ALIASES.get(requested) ?? requested;
  return PARTICLE_PROPERTIES.some((property) => property.id === canonical) ? canonical : null;
}

function parseInteger(input, unsigned = false) {
  const text = String(input ?? "").trim();
  let value;
  if (/^[+-]?0x[0-9a-f]+$/i.test(text)) value = Number.parseInt(text.replace(/^\+/, ""), 16);
  else if (/^#[0-9a-f]+$/i.test(text)) value = Number.parseInt(text.slice(1), 16);
  else if (/^[+-]?0b[01]+$/i.test(text)) {
    const sign = text.startsWith("-") ? -1 : 1;
    value = sign * Number.parseInt(text.replace(/^[+-]?0b/i, ""), 2);
  } else if (/^[+-]?\d+$/.test(text)) value = Number(text);
  else throw new Error("Expected a decimal, hexadecimal or binary integer");
  if (!Number.isSafeInteger(value)) throw new Error("Integer is outside the supported range");
  if (unsigned && (value < 0 || value > 0xffffffff)) throw new Error("Unsigned value must be between 0 and 0xFFFFFFFF");
  if (!unsigned && (value < -0x80000000 || value > 0x7fffffff)) throw new Error("Integer must fit a signed 32-bit field");
  return unsigned ? value >>> 0 : value;
}

function resolveElement(input, allowInteger = false) {
  const code = String(input ?? "").trim().toUpperCase().replace(/^DEFAULT_PT_/, "");
  if (Object.hasOwn(MAT, code)) return MAT[code];
  const numeric = parseInteger(input);
  if (allowInteger) return numeric;
  if (!MATERIAL_BY_ID[numeric]?.enabled) throw new Error(`Unknown element: ${input}`);
  return numeric;
}

export function parseParticleProperty(propertyName, input) {
  const property = canonicalPropertyName(propertyName);
  if (!property) throw new Error(`Unknown particle property: ${propertyName}`);
  const descriptor = PARTICLE_PROPERTIES.find((candidate) => candidate.id === property);
  const text = String(input ?? "").trim();
  if (!text) throw new Error("Property value is required");
  let value;
  if (descriptor.kind === "element") value = resolveElement(text, false);
  else if (descriptor.kind === "element-or-integer") value = resolveElement(text, true);
  else if (descriptor.kind === "integer") value = parseInteger(text, false);
  else if (descriptor.kind === "unsigned") value = parseInteger(text, true);
  else if (descriptor.kind === "temperature") {
    const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([ckf])?$/i);
    if (!match) throw new Error("Temperature must be a number, optionally suffixed C, K or F");
    value = Number(match[1]);
    const scale = match[2]?.toLowerCase();
    if (scale === "k") value -= 273.15;
    else if (scale === "f") value = (value - 32) * 5 / 9;
    value = Math.max(-273.15, Math.min(9725.85, value));
  } else {
    value = Number(text);
    if (!Number.isFinite(value)) throw new Error("Property value must be a number");
  }
  return { property, value, descriptor };
}
