// SPDX-License-Identifier: GPL-3.0-or-later

import { MAT, MATERIAL_BY_ID } from "./materials.js";

export function parseSignAction(text) {
  const source = String(text ?? "");
  let match = source.match(/^\{([ct]):(\d+)\|([\s\S]*)\}$/);
  if (match) return { type: match[1] === "c" ? "save" : "thread", target: match[2], label: match[3] };
  match = source.match(/^\{b\|([\s\S]*)\}$/);
  if (match) return { type: "button", target: "", label: match[1] };
  match = source.match(/^\{s:([^|}]*)\|([\s\S]*)\}$/);
  if (match) return { type: "search", target: match[1], label: match[2] };
  return null;
}

export function formatSignText(simulation, sign) {
  const action = parseSignAction(sign?.text);
  if (action) return action.label;
  const text = String(sign?.text ?? "");
  if (!text.includes("{") || !simulation?.inBounds(sign.x, sign.y, sign.z)) return text;
  const index = simulation.index(sign.x, sign.y, sign.z);
  const energy = simulation.energyTypes[index] !== MAT.EMPTY;
  const type = energy ? simulation.energyTypes[index] : simulation.types[index];
  const temperature = type === MAT.EMPTY ? 0 : energy ? simulation.energyTemperatures[index] : simulation.temperatures[index];
  const ctype = type === MAT.EMPTY ? 0 : energy ? simulation.energyCtype[index] : simulation.ctype[index];
  const life = type === MAT.EMPTY ? 0 : energy ? simulation.energyLife[index] : simulation.life[index];
  const tmp = type === MAT.EMPTY ? 0 : energy ? simulation.energyTmp[index] : simulation.tmp[index];
  const tmp2 = type === MAT.EMPTY ? 0 : energy ? simulation.energyTmp2[index] : simulation.tmp2[index];
  const air = simulation.air.sampleVoxel(sign.x, sign.y, sign.z);
  return text.replace(/\{([^{}]+)\}/g, (match, requested) => {
    const field = requested.toLowerCase();
    if (field === "t" || field === "temp") return Number(temperature).toFixed(2);
    if (field === "p" || field === "pres") return Number(air.pressure).toFixed(2);
    if (field === "a" || field === "aheat") return Number(air.temperature).toFixed(2);
    if (field === "type") return type === MAT.EMPTY ? "Empty" : MATERIAL_BY_ID[type]?.code ?? String(type);
    if (field === "ctype") return type === MAT.EMPTY ? "Empty" : MATERIAL_BY_ID[ctype]?.code ?? String(ctype);
    if (field === "life") return String(life);
    if (field === "tmp") return String(tmp);
    if (field === "tmp2") return String(tmp2);
    return match;
  });
}
