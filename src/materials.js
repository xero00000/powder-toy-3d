// SPDX-License-Identifier: GPL-3.0-or-later

import {
  UPSTREAM_COMMIT,
  UPSTREAM_ELEMENT_COUNT,
  UPSTREAM_VISIBLE_ELEMENT_COUNT,
  UPSTREAM_ELEMENTS,
  UPSTREAM_TOOLS,
  UPSTREAM_WALLS,
  UPSTREAM_LIFE_RULES,
} from "./upstream-elements.generated.js";

export {
  UPSTREAM_COMMIT, UPSTREAM_ELEMENT_COUNT, UPSTREAM_VISIBLE_ELEMENT_COUNT,
  UPSTREAM_TOOLS, UPSTREAM_WALLS, UPSTREAM_LIFE_RULES,
};

export const CATEGORY_ORDER = [
  "powders", "liquids", "gases", "solids", "explosives", "electronics",
  "powered", "sensors", "force", "nuclear", "special", "life",
];

export const CATEGORIES = {
  powders: { name: "Powders", short: "POW" },
  liquids: { name: "Liquids", short: "LIQ" },
  gases: { name: "Gases", short: "GAS" },
  solids: { name: "Solids", short: "SOL" },
  explosives: { name: "Explosives", short: "EXP" },
  electronics: { name: "Electronics", short: "ELE" },
  powered: { name: "Powered", short: "PWR" },
  sensors: { name: "Sensors", short: "SNS" },
  force: { name: "Force", short: "FRC" },
  nuclear: { name: "Radioactive", short: "NUC" },
  special: { name: "Special", short: "SPC" },
  life: { name: "Life", short: "LIF" },
};

// These behavior families either have bespoke 3D update paths or are deliberately
// callback-free upstream and close through the shared movement, transition and flag
// engines. Keeping the audited set explicit makes any new upstream element fail closed.
const BESPOKE_CODES = new Set([
  "SAND", "WATR", "OIL", "FIRE", "WOOD", "STNE", "METL", "ICEI",
  "LAVA", "GUNP", "ACID", "PLNT", "SMKE", "WTRV", "GLAS",
  "SPRK", "BTRY", "PSCN", "NSCN", "SWCH", "INST", "WIRE",
  "PHOT", "NEUT", "ELEC", "PROT", "GRVT",
  "DSTW", "SLTW", "CBNW", "O2", "H2", "BASE", "VIRS", "VRSS", "VRSG",
  "CLNE", "BCLN", "PCLN", "PBCN", "CONV", "VOID", "PVOD", "BHOL", "WHOL", "NBHL", "NWHL",
  "DTEC", "TSNS", "PSNS", "LSNS", "LDTC", "VSNS", "ACEL", "DCEL", "SING", "AMTR",
  "PSTN", "FRME", "FRAY", "RPEL", "DMG", "GBMB",
  "PRTI", "PRTO",
  "SHLD1", "SHLD2", "SHLD3", "SHLD4", "FOG", "RIME", "FILT", "INVIS", "GEL", "GLOW", "BIZR", "BIZRG", "BIZRS",
  "LITH", "SEED", "VINE", "SPNG", "MERC",
  "GOO", "BMTL", "BRMT", "COAL", "BCOL", "IRON", "QRTZ", "PQRT", "TTAN", "GOLD", "TUNG",
  "CRMC", "HEAC", "PTNM", "BREC", "CLST", "PSTS", "SLCN",
  // Empty and decorative/support definitions have no element callbacks upstream.
  "NONE", "LOVE", "E116", "SPAWN", "SPAWN2", "LOLZ",
  "SNOW", "PLSM", "NBLE", "YEST", "MORT", "CO2", "CAUS", "FRZZ", "FRZW", "GRAV", "ANAR", "BOYL",
  "RFRG", "RFGL", "RSST", "RSSS",
  "SOAP", "TRON", "STKM", "STKM2", "FIGH",
  // These upstream definitions intentionally have no element update callback; their
  // canonical behavior is fully provided by shared movement, transitions and flags.
  "DUST", "NITR", "GAS", "PLEX", "CNCT", "SALT", "DMND", "WAX", "MWAX", "LNTG", "INSL",
  "RBDM", "LRBD", "BGLA", "NICE", "DESL", "LO2", "DYST", "BRCK", "DRIC", "PSTE", "SAWD", "ROCK", "LIFE",
  "LCRY", "PUMP", "GPMP", "HSWC",
  "THDR", "BOMB", "DEST", "THRM", "FUSE", "FSEP", "C5", "BANG", "IGNT", "LIGH", "CFLM", "EMBR",
  "FIRW", "FWRK",
  "PIPE", "PPIP", "STOR", "WIFI", "ARAY", "BRAY", "CRAY", "DRAY",
  "ETRD", "TESC", "DLAY", "EMP", "NTCT", "PTCT", "INWR",
  "URAN", "PLUT", "POLO", "DEUT", "ISOZ", "ISZS", "WARP", "VIBR", "BVBR", "EXOT",
]);

const OVERRIDES = {
  FIRE: { defaultTemp: 422, emissive: 1 },
  LAVA: { defaultTemp: 1522, emissive: 1 },
  CFLM: { emissive: 1 },
  LIGH: { defaultLife: 30, emissive: 1 },
  SEED: { defaultCtype: 0b111011000000 },
};

const idByCode = Object.fromEntries(UPSTREAM_ELEMENTS.map((element) => [element.code, element.id]));

export const MATERIALS = Object.freeze(UPSTREAM_ELEMENTS.map((element) => {
  const override = OVERRIDES[element.code] ?? {};
  const resolveTransition = (transition) => {
    const code = transition === "ST" ? element.upstream.defaultCtype : transition;
    return code == null ? null : (idByCode[code] ?? null);
  };
  return Object.freeze({
    ...element,
    ...override,
    parity: BESPOKE_CODES.has(element.code) ? "ported" : "generic",
    lowTemperature: element.upstream.lowTemperature,
    lowTemperatureTransition: resolveTransition(element.upstream.lowTemperatureTransition),
    highTemperature: element.upstream.highTemperature,
    highTemperatureTransition: resolveTransition(element.upstream.highTemperatureTransition),
    lowPressure: element.upstream.lowPressure,
    lowPressureTransition: resolveTransition(element.upstream.lowPressureTransition),
    highPressure: element.upstream.highPressure,
    highPressureTransition: resolveTransition(element.upstream.highPressureTransition),
    defaultCtype: override.defaultCtype ?? resolveTransition(element.upstream.defaultCtype) ?? element.defaultCtypeValue ?? 0,
    ignition: override.ignition ?? (element.flammable > 0 ? element.upstream.highTemperature ?? 300 : null),
  });
}));

const BASE_MATERIAL_BY_ID = Object.freeze(Object.fromEntries(MATERIALS.map((material) => [material.id, material])));
export const MATERIAL_BY_ID = { ...BASE_MATERIAL_BY_ID };
const RUNTIME_MATERIAL_IDS = new Set();

const canonicalIds = Object.fromEntries(MATERIALS.map((material) => [material.code, material.id]));
export const MAT = Object.freeze({
  ...canonicalIds,
  EMPTY: canonicalIds.NONE,
  WATER: canonicalIds.WATR,
  STONE: canonicalIds.STNE,
  METAL: canonicalIds.METL,
  ICE: canonicalIds.ICEI,
  GUNPOWDER: canonicalIds.GUNP,
  PLANT: canonicalIds.PLNT,
  SMOKE: canonicalIds.SMKE,
  STEAM: canonicalIds.WTRV,
  GLASS: canonicalIds.GLAS,
  DIAMOND: canonicalIds.DMND,
});

export const PRESETS = [
  { id: "foundry", name: "The Foundry", tag: "THERMAL", accent: "#ff7a35", description: "Molten core / sand vitrification" },
  { id: "reactor", name: "Reactor Breach", tag: "VOLATILE", accent: "#e7ff4f", description: "Coolant / fuel / chain reaction" },
  { id: "garden", name: "Hydro Garden", tag: "BIOLOGIC", accent: "#54df79", description: "Water-driven organic growth" },
  { id: "volcano", name: "Caldera", tag: "GEOLOGIC", accent: "#ff4628", description: "Pressurized lava chamber" },
];

export function materialById(id) {
  return MATERIAL_BY_ID[id] ?? MATERIAL_BY_ID[MAT.EMPTY];
}

export function allMaterials() {
  return Object.values(MATERIAL_BY_ID).sort((left, right) => left.id - right.id);
}

const stateForMask = (mask) => {
  if (mask & 0x10) return ["energy", "gas"];
  if (mask & 0x08) return ["gas", "gas"];
  if (mask & 0x02) return ["liquid", "liquid"];
  if (mask & 0x04) return ["solid", "solid"];
  return ["powder", "powder"];
};

const propertyNamesForMask = (mask) => [
  [0x20, "PROP_CONDUCTS"], [0x40, "PROP_PHOTPASS"], [0x80, "PROP_NEUTPENETRATE"],
  [0x100, "PROP_NEUTABSORB"], [0x200, "PROP_NEUTPASS"], [0x400, "PROP_DEADLY"],
  [0x800, "PROP_HOT_GLOW"], [0x1000, "PROP_LIFE"], [0x2000, "PROP_RADIOACTIVE"],
  [0x4000, "PROP_LIFE_DEC"], [0x8000, "PROP_LIFE_KILL"], [0x10000, "PROP_LIFE_KILL_DEC"],
  [0x20000, "PROP_SPARKSETTLE"], [0x40000, "PROP_NOAMBHEAT"], [0x100000, "PROP_NOCTYPEDRAW"],
].filter(([bit]) => mask & bit).map(([, name]) => name);

export function allocateRuntimeMaterial(group, code) {
  const normalizedGroup = String(group).trim().toUpperCase();
  const normalizedCode = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalizedGroup) || normalizedGroup === "DEFAULT") throw new Error("custom element group must use letters/numbers and cannot be DEFAULT");
  if (!/^[A-Z0-9]+$/.test(normalizedCode)) throw new Error("custom element name must use letters/numbers");
  const identifier = `${normalizedGroup}_PT_${normalizedCode}`;
  if (allMaterials().some((material) => material.identifier === identifier)) throw new Error("element identifier already in use");
  let id = -1;
  for (let candidate = 255; candidate >= UPSTREAM_ELEMENT_COUNT; candidate -= 1) {
    if (!MATERIAL_BY_ID[candidate]) { id = candidate; break; }
  }
  if (id < 0) throw new Error("no custom element slots remain");
  const base = MATERIAL_BY_ID[MAT.DUST];
  MATERIAL_BY_ID[id] = {
    ...base,
    upstream: { ...base.upstream },
    id,
    code: normalizedCode,
    identifier,
    key: `${normalizedGroup.toLowerCase()}-${normalizedCode.toLowerCase()}`,
    name: normalizedCode,
    symbol: normalizedCode.slice(0, 4),
    description: `Lua element ${identifier}`,
    category: "special",
    color: 0xb8e6ff,
    css: "#b8e6ff",
    menuVisible: false,
    parity: "scripted",
    propertyMask: 0x01,
  };
  RUNTIME_MATERIAL_IDS.add(id);
  return id;
}

export function updateRuntimeMaterial(id, updates = {}) {
  const current = MATERIAL_BY_ID[id];
  if (!current || id === MAT.EMPTY) throw new Error(`invalid element ${id}`);
  const next = { ...current, upstream: { ...current.upstream, ...(updates.upstream ?? {}) }, ...updates };
  if (Number.isInteger(next.propertyMask)) {
    const [state, render] = stateForMask(next.propertyMask);
    next.state = state;
    next.render = render;
    next.properties = propertyNamesForMask(next.propertyMask);
  }
  if (Number.isFinite(next.color)) {
    next.color = Math.max(0, Math.min(0xffffff, Math.trunc(next.color))) >>> 0;
    next.css = `#${next.color.toString(16).padStart(6, "0")}`;
  }
  MATERIAL_BY_ID[id] = next;
  if (!BASE_MATERIAL_BY_ID[id]) RUNTIME_MATERIAL_IDS.add(id);
  return next;
}

export function freeRuntimeMaterial(id) {
  if (!RUNTIME_MATERIAL_IDS.has(id) || BASE_MATERIAL_BY_ID[id]) throw new Error("cannot free default elements");
  delete MATERIAL_BY_ID[id];
  RUNTIME_MATERIAL_IDS.delete(id);
}

export function loadDefaultRuntimeMaterial(id = null) {
  if (id == null) {
    for (const runtimeId of [...RUNTIME_MATERIAL_IDS]) if (!BASE_MATERIAL_BY_ID[runtimeId]) delete MATERIAL_BY_ID[runtimeId];
    for (const [baseId, material] of Object.entries(BASE_MATERIAL_BY_ID)) MATERIAL_BY_ID[baseId] = material;
    RUNTIME_MATERIAL_IDS.clear();
    return;
  }
  if (BASE_MATERIAL_BY_ID[id]) {
    MATERIAL_BY_ID[id] = BASE_MATERIAL_BY_ID[id];
    RUNTIME_MATERIAL_IDS.delete(id);
  } else if (RUNTIME_MATERIAL_IDS.has(id)) {
    delete MATERIAL_BY_ID[id];
    RUNTIME_MATERIAL_IDS.delete(id);
  } else throw new Error(`invalid element ${id}`);
}

export function isRuntimeMaterial(id) {
  return RUNTIME_MATERIAL_IDS.has(id);
}

export function materialsInCategory(category, query = "") {
  const normalized = query.trim().toLowerCase();
  return allMaterials().filter((material) => {
    if (!material.enabled || (!material.menuVisible && material.code !== "LIFE") || material.id === MAT.EMPTY) return false;
    if (category && material.category !== category) return false;
    if (!normalized) return true;
    return material.code.toLowerCase().includes(normalized)
      || material.name.toLowerCase().includes(normalized)
      || material.description.toLowerCase().includes(normalized);
  });
}
