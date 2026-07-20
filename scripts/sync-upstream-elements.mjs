#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const upstreamRoot = resolve(process.argv[2] || process.env.TPT_UPSTREAM || "../The-Powder-Toy");
const outputPath = resolve(process.argv[3] || "src/upstream-elements.generated.js");
const elementsRoot = join(upstreamRoot, "src/simulation/elements");
const mesonPath = join(elementsRoot, "meson.build");
const toolsRoot = join(upstreamRoot, "src/simulation/simtools");
const simulationDataPath = join(upstreamRoot, "src/simulation/SimulationData.cpp");

const SECTION_MAP = {
  SC_ELEC: "electronics",
  SC_POWERED: "powered",
  SC_SENSOR: "sensors",
  SC_FORCE: "force",
  SC_EXPLOSIVE: "explosives",
  SC_GAS: "gases",
  SC_LIQUID: "liquids",
  SC_POWDERS: "powders",
  SC_SOLIDS: "solids",
  SC_NUCLEAR: "nuclear",
  SC_SPECIAL: "special",
  SC_LIFE: "life",
};

const KNOWN_SCALARS = {
  R_TEMP: 22,
  MAX_TEMP: 9999,
  MIN_TEMP: 0,
  O_MAX_TEMP: 3500,
  O_MIN_TEMP: -273,
  MAX_PRESSURE: 256,
  MIN_PRESSURE: -256,
  IPL: -256,
  IPH: 256,
  ITL: 0,
  ITH: 9999,
  CFDS: 1,
};

function decodeCString(value = "") {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function assignment(source, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*=\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

function stringAssignment(source, field) {
  const raw = assignment(source, field);
  if (!raw) return null;
  const match = raw.match(/(?:String\s*\()?"((?:\\.|[^"\\])*)"/);
  return match ? decodeCString(match[1]) : null;
}

function numericValue(expression) {
  if (!expression) return null;
  let normalized = expression
    .replace(/_rgb/g, "")
    .replace(/([0-9.])f\b/g, "$1")
    .replace(/0x([0-9A-Fa-f]+)/g, (_, hex) => String(Number.parseInt(hex, 16)))
    .replace(/\bstd::numeric_limits<[^>]+>::max\(\)/g, "9999");
  for (const [name, value] of Object.entries(KNOWN_SCALARS)) normalized = normalized.replace(new RegExp(`\\b${name}\\b`, "g"), String(value));
  if (!/^[\d\s+\-*/().]+$/.test(normalized)) return null;
  try {
    const result = Function(`"use strict"; return (${normalized});`)();
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function absoluteToCelsius(value) {
  return value == null ? null : Math.round((value - 273.15) * 100) / 100;
}

function transitionName(expression) {
  const match = expression?.match(/\bPT_([A-Z0-9]+)\b/);
  if (match) return match[1];
  return /\bST\b/.test(expression ?? "") ? "ST" : null;
}

function renderKind(properties, category) {
  if (properties.includes("TYPE_LIQUID")) return "liquid";
  if (properties.includes("TYPE_GAS") || properties.includes("TYPE_ENERGY")) return "gas";
  if (properties.includes("TYPE_PART")) return "powder";
  if (properties.includes("TYPE_SOLID")) return "solid";
  if (["gases", "nuclear", "force"].includes(category)) return "gas";
  if (category === "liquids") return "liquid";
  if (["powders", "explosives"].includes(category)) return "powder";
  return "solid";
}

function parseNames(mesonSource, variableName) {
  const listSource = mesonSource.match(new RegExp(`${variableName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\]`))?.[1];
  if (!listSource) throw new Error(`Could not find ${variableName}`);
  const tokens = [...listSource.matchAll(/'([A-Z0-9]+)'|(disabler\(\))/g)];
  let id = 0;
  const names = [];
  for (const token of tokens) {
    if (token[2]) {
      id += 1;
      continue;
    }
    names.push({ name: token[1], id });
    id += 1;
  }
  return names;
}

function readGitCommit(root) {
  const gitPath = join(root, ".git");
  const headPath = join(gitPath, "HEAD");
  if (!existsSync(headPath)) return process.env.UPSTREAM_COMMIT || "unknown";
  const head = readFileSync(headPath, "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const refPath = join(gitPath, head.slice(5));
  if (existsSync(refPath)) return readFileSync(refPath, "utf8").trim();
  const packedRefs = join(gitPath, "packed-refs");
  if (!existsSync(packedRefs)) return "unknown";
  const ref = head.slice(5);
  return readFileSync(packedRefs, "utf8").split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "unknown";
}

const mesonSource = readFileSync(mesonPath, "utf8");
const elementIds = parseNames(mesonSource, "simulation_elem_names");
const commit = readGitCommit(upstreamRoot);

const elements = elementIds.map(({ name: code, id }) => {
  const source = readFileSync(join(elementsRoot, `${code}.cpp`), "utf8");
  const properties = assignment(source, "Properties") ?? "";
  const section = assignment(source, "MenuSection");
  const category = SECTION_MAP[section] ?? (code === "NONE" ? "tools" : "special");
  const colourHex = assignment(source, "Colour")?.match(/0x([0-9A-Fa-f]{6})/)?.[1] ?? "7E8C96";
  const weight = numericValue(assignment(source, "Weight"));
  const heatConduct = numericValue(assignment(source, "HeatConduct"));
  const heatCapacity = numericValue(assignment(source, "HeatCapacity")) ?? 1;
  const photonReflectWavelengths = numericValue(assignment(source, "PhotonReflectWavelengths"));
  const flammable = numericValue(assignment(source, "Flammable"));
  const explosive = numericValue(assignment(source, "Explosive"));
  const defaultTempK = numericValue(assignment(source, "DefaultProperties.temp"));
  const defaultLife = numericValue(assignment(source, "DefaultProperties.life"));
  const defaultTmp = numericValue(assignment(source, "DefaultProperties.tmp"));
  const defaultTmp2 = numericValue(assignment(source, "DefaultProperties.tmp2"));
  const defaultTmp3 = numericValue(assignment(source, "DefaultProperties.tmp3"));
  const defaultTmp4 = numericValue(assignment(source, "DefaultProperties.tmp4"));
  const defaultCtypeExpression = assignment(source, "DefaultProperties.ctype");
  const carriesTypeInExpression = assignment(source, "CarriesTypeIn") ?? "";
  const defaultCtypeValue = numericValue(defaultCtypeExpression);
  const lowTemperatureK = numericValue(assignment(source, "LowTemperature"));
  const highTemperatureK = numericValue(assignment(source, "HighTemperature"));
  const kind = renderKind(properties, category);
  const defaultTemp = defaultTempK == null ? 22 : absoluteToCelsius(defaultTempK);

  return {
    id,
    code,
    identifier: stringAssignment(source, "Identifier") ?? `DEFAULT_PT_${code}`,
    key: code.toLowerCase(),
    name: stringAssignment(source, "Name") ?? code,
    symbol: code.slice(0, 4),
    category,
    render: code === "NONE" ? "none" : kind,
    color: Number.parseInt(colourHex, 16),
    css: `#${colourHex.toLowerCase()}`,
    description: stringAssignment(source, "Description") ?? `${code} · upstream Powder Toy element`,
    enabled: numericValue(assignment(source, "Enabled")) !== 0,
    menuVisible: numericValue(assignment(source, "MenuVisible")) !== 0,
    state: properties.includes("TYPE_ENERGY") ? "energy" : kind,
    density: weight ?? (kind === "gas" ? -8 : kind === "liquid" ? 30 : kind === "powder" ? 70 : 100),
    conductivity: heatConduct == null ? 0.1 : Math.max(0, Math.min(1, heatConduct / 255)),
    heatCapacity,
    defaultTemp,
    defaultLife: defaultLife == null ? 0 : Math.max(0, Math.round(defaultLife)),
    defaultTmp: defaultTmp == null ? 0 : Math.round(defaultTmp),
    defaultTmp2: defaultTmp2 == null ? 0 : Math.round(defaultTmp2),
    defaultTmp3: defaultTmp3 == null ? 0 : Math.round(defaultTmp3),
    defaultTmp4: defaultTmp4 == null ? 0 : Math.round(defaultTmp4),
    defaultCtypeValue: defaultCtypeValue == null ? null : Math.round(defaultCtypeValue),
    flammable: flammable == null ? 0 : Math.max(0, Math.min(1, flammable / 100)),
    explosive: Boolean(explosive && explosive > 0),
    ignition: flammable && flammable > 0 ? 300 : null,
    properties,
    photonReflectWavelengths: photonReflectWavelengths == null ? 0x3fffffff : photonReflectWavelengths >>> 0,
    carriesCtype: carriesTypeInExpression.includes("FIELD_CTYPE"),
    carriesTmp: carriesTypeInExpression.includes("FIELD_TMP"),
    upstream: {
      advection: numericValue(assignment(source, "Advection")),
      airDrag: numericValue(assignment(source, "AirDrag")),
      airLoss: numericValue(assignment(source, "AirLoss")),
      loss: numericValue(assignment(source, "Loss")),
      collision: numericValue(assignment(source, "Collision")),
      gravity: numericValue(assignment(source, "Gravity")),
      newtonianGravity: numericValue(assignment(source, "NewtonianGravity")),
      diffusion: numericValue(assignment(source, "Diffusion")),
      hotAir: numericValue(assignment(source, "HotAir")),
      falldown: numericValue(assignment(source, "Falldown")),
      hardness: numericValue(assignment(source, "Hardness")),
      meltable: numericValue(assignment(source, "Meltable")),
      heatConduct,
      defaultCtype: transitionName(defaultCtypeExpression),
      lowPressure: numericValue(assignment(source, "LowPressure")),
      lowPressureTransition: transitionName(assignment(source, "LowPressureTransition")),
      highPressure: numericValue(assignment(source, "HighPressure")),
      highPressureTransition: transitionName(assignment(source, "HighPressureTransition")),
      lowTemperature: absoluteToCelsius(lowTemperatureK),
      lowTemperatureTransition: transitionName(assignment(source, "LowTemperatureTransition")),
      highTemperature: absoluteToCelsius(highTemperatureK),
      highTemperatureTransition: transitionName(assignment(source, "HighTemperatureTransition")),
    },
  };
});

const visibleCount = elements.filter((element) => element.enabled && element.menuVisible).length;
const toolMesonSource = readFileSync(join(toolsRoot, "meson.build"), "utf8");
const tools = parseNames(toolMesonSource, "simulation_tool_names").map(({ name: code, id }) => {
  const source = readFileSync(join(toolsRoot, `${code}.cpp`), "utf8");
  const colourHex = assignment(source, "Colour")?.match(/0x([0-9A-Fa-f]{6})/)?.[1] ?? "7E8C96";
  return {
    id,
    code,
    identifier: stringAssignment(source, "Identifier") ?? `DEFAULT_TOOL_${code}`,
    name: stringAssignment(source, "Name") ?? code,
    color: Number.parseInt(colourHex, 16),
    css: `#${colourHex.toLowerCase()}`,
    description: stringAssignment(source, "Description") ?? `${code} simulation tool`,
  };
});

const simulationDataSource = readFileSync(simulationDataPath, "utf8");
const wallBlock = simulationDataSource.match(/static std::vector<wall_type> LoadWalls\(\)[\s\S]*?std::vector<wall_type>\{([\s\S]*?)\n\s*\};/)?.[1] ?? "";
const walls = [...wallBlock.matchAll(/\{0x([0-9A-Fa-f]{6})_rgb,\s*0x([0-9A-Fa-f]{6})_rgb,\s*(\d+),\s*Renderer::WallIcon,\s*String\("((?:\\.|[^"])*)"\),\s*"([^"]+)",\s*String\("((?:\\.|[^"])*)"\)\}/g)]
  .map((match, id) => ({
    id,
    color: Number.parseInt(match[1], 16),
    css: `#${match[1].toLowerCase()}`,
    secondaryColor: Number.parseInt(match[2], 16),
    pattern: Number(match[3]),
    name: decodeCString(match[4]),
    identifier: match[5],
    description: decodeCString(match[6]),
  }));

const lifeBlock = simulationDataSource.match(/SimulationData::builtinGol\s*=\s*\{\{([\s\S]*?)\n\}\};/)?.[1] ?? "";
const lifeRules = lifeBlock.split("\n").filter((line) => line.trim().startsWith('{ "')).map((line, id) => {
  const strings = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  const hexValues = [...line.matchAll(/0x([0-9A-Fa-f]+)/g)].map((match) => match[1]);
  return {
    id,
    code: strings[0],
    ruleset: Number.parseInt(hexValues[0], 16),
    color: Number.parseInt(hexValues[1], 16),
    css: `#${hexValues[1].padStart(6, "0").toLowerCase()}`,
    gradientColor: Number.parseInt(hexValues[2], 16),
    description: decodeCString(strings[1]),
  };
});

if (tools.length !== 11) throw new Error(`Expected 11 tools, parsed ${tools.length}`);
if (walls.length !== 19) throw new Error(`Expected 19 walls, parsed ${walls.length}`);
if (lifeRules.length !== 24) throw new Error(`Expected 24 Life rules, parsed ${lifeRules.length}`);

const output = `// This file is generated by scripts/sync-upstream-elements.mjs. Do not edit by hand.\n` +
  `// Upstream commit: ${commit}\n` +
  `// SPDX-License-Identifier: GPL-3.0-or-later\n\n` +
  `export const UPSTREAM_COMMIT = ${JSON.stringify(commit)};\n` +
  `export const UPSTREAM_ELEMENT_COUNT = ${elements.length};\n` +
  `export const UPSTREAM_VISIBLE_ELEMENT_COUNT = ${visibleCount};\n` +
  `export const UPSTREAM_ELEMENTS = Object.freeze(${JSON.stringify(elements, null, 2)});\n` +
  `export const UPSTREAM_TOOLS = Object.freeze(${JSON.stringify(tools, null, 2)});\n` +
  `export const UPSTREAM_WALLS = Object.freeze(${JSON.stringify(walls, null, 2)});\n` +
  `export const UPSTREAM_LIFE_RULES = Object.freeze(${JSON.stringify(lifeRules, null, 2)});\n`;

writeFileSync(outputPath, output);
console.log(`Generated ${elements.length} elements, ${tools.length} tools, ${walls.length} walls and ${lifeRules.length} Life rules from ${commit.slice(0, 12)} -> ${outputPath}`);
