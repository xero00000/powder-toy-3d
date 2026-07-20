// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATERIALS, MAT, UPSTREAM_ELEMENT_COUNT, UPSTREAM_VISIBLE_ELEMENT_COUNT,
  UPSTREAM_LIFE_RULES, UPSTREAM_TOOLS, UPSTREAM_WALLS,
} from "../src/materials.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => fs.readFileSync(path.join(root, "tests", name), "utf8"))
  .join("\n");
const selectable = MATERIALS.filter((material) => material.enabled && material.menuVisible && material.id !== MAT.NONE);
const uncovered = selectable.filter((material) => !new RegExp(`MAT\\.${material.code}\\b`).test(tests));
const nonPorted = MATERIALS.filter((material) => material.parity !== "ported");

const checks = [
  ["element ID space", MATERIALS.length, UPSTREAM_ELEMENT_COUNT],
  ["menu-visible definitions", selectable.length + 1, UPSTREAM_VISIBLE_ELEMENT_COUNT],
  ["selectable element fixtures", selectable.length - uncovered.length, selectable.length],
  ["ported behavior routes", MATERIALS.length - nonPorted.length, MATERIALS.length],
  ["simulation tools", UPSTREAM_TOOLS.length, 11],
  ["wall types", UPSTREAM_WALLS.length, 19],
  ["built-in Life rules", UPSTREAM_LIFE_RULES.length, 24],
];

let failed = false;
for (const [surface, actual, expected] of checks) {
  const pass = actual === expected;
  failed ||= !pass;
  console.log(`${pass ? "PASS" : "FAIL"}  ${surface.padEnd(29)} ${actual}/${expected}`);
}
if (uncovered.length) console.error(`Uncovered selectable elements: ${uncovered.map(({ code }) => code).join(", ")}`);
if (nonPorted.length) console.error(`Non-ported behavior routes: ${nonPorted.map(({ code, parity }) => `${code}:${parity}`).join(", ")}`);
if (failed) process.exitCode = 1;
