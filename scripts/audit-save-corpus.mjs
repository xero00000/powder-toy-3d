// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { importOps } from "../src/ops-import.js";
import { importPsv } from "../src/psv-import.js";
import { VoxelSimulation } from "../src/simulation.js";

const CORPUS = Object.freeze([
  { id: 2157797, format: "OPS1", title: "Upstream preview fallback", sha256: "c82dd8d0bba98d039e2273a495c661e0e0ee8cf936957c554304a212b8e86090", version: 92, minimumImported: 48384 },
  { id: 3394926, format: "OPS1", title: "SEED and BASE contest", sha256: "3eae03296283e1ba2812af3f5571085987f9b9dca7662b254dada2b1c44f912d", version: 100, minimumImported: 43391, lossless: true },
  { id: 3399886, format: "OPS1", title: "R4A0416M", sha256: "3618c42de92c6e5a94cbebf477d03d4cc596d6433083a574d8c040bcdb6453ba", version: 100, minimumImported: 49792 },
  { id: 3400267, format: "OPS1", title: "Attempt at solid uranium", sha256: "64140307688bc88a7d01a85a3d83cff734de34bddb7ed16d8e025c699f9f3636", version: 100, minimumImported: 7680, lossless: true },
  { id: 3401094, format: "OPS1", title: "Orange LITH substance", sha256: "345c44c2e09fe6e4d8dba0a6be74a4e3cb5dca226b66b87725e9796baad0b4c4", version: 100, minimumImported: 48384 },
  { id: 3401734, format: "OPS1", title: "Photon eater alloy", sha256: "e06815a9adebfec025e7bda18da2b89c4869edd3ae64d32d62be8bf0e1ced6e2", version: 100, minimumImported: 48384 },
  { id: 100, format: "fuC", title: "NMDLP reactor", sha256: "6b327b911ec175c1ec4486b6d2017ebb2a9832d06c7e55196dcdd5ea0d288fb0", version: 27, minimumImported: 2032, lossless: true },
  { id: 10000, format: "fuC", title: "Kaboom", sha256: "909a83903e5e89c49856c5aacb7f12d83b9bfc02264ac1f5ff6197a55afac87f", version: 41, minimumImported: 48384 },
  { id: 100000, format: "PSv", title: "muaa :*", sha256: "de4c84fcf7f9cfc2d0dab9d91923969614770c7e5b522a15a0df2aeafee3a0b3", version: 44, minimumImported: 18860, lossless: true },
  { id: 500000, format: "PSv", title: "Waterfall Simulation", sha256: "a1219d975c3a739e0c9bd534af537425755bed40350280a5ddcbc4d780b9461c", version: 61, minimumImported: 20314, lossless: true },
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const offline = process.argv.includes("--offline");
const corpusDirectory = path.resolve(option("--dir") ?? path.join(tmpdir(), "powder-toy-3d-save-corpus"));
await mkdir(corpusDirectory, { recursive: true });

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadFixture(fixture) {
  const filename = path.join(corpusDirectory, `${fixture.id}.cps`);
  let bytes;
  try { bytes = await readFile(filename); } catch { /* fetched below */ }
  if (!bytes || digest(bytes) !== fixture.sha256) {
    if (offline) throw new Error(`missing or mismatched offline fixture ${fixture.id}: ${filename}`);
    const response = await fetch(`https://static.powdertoy.co.uk/${fixture.id}.cps`);
    if (!response.ok) throw new Error(`save ${fixture.id} download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== fixture.sha256) throw new Error(`save ${fixture.id} hash changed; audit the new public revision before accepting it`);
    await writeFile(filename, bytes);
  }
  return bytes;
}

const rows = [];
for (const fixture of CORPUS) {
  const bytes = await loadFixture(fixture);
  const simulation = new VoxelSimulation(48, 36, 28, 0xc50000 + fixture.id);
  const started = performance.now();
  const report = fixture.format === "OPS1" ? importOps(bytes, simulation, 14) : importPsv(bytes, simulation, 14);
  const elapsed = performance.now() - started;
  if (report.format !== fixture.format) throw new Error(`${fixture.id}: expected ${fixture.format}, got ${report.format}`);
  if (report.savedVersion !== fixture.version) throw new Error(`${fixture.id}: expected version ${fixture.version}, got ${report.savedVersion}`);
  if (report.imported + report.omitted !== report.total) throw new Error(`${fixture.id}: particle accounting mismatch`);
  if (report.imported < fixture.minimumImported) throw new Error(`${fixture.id}: imported ${report.imported}, expected at least ${fixture.minimumImported}`);
  if (fixture.lossless && report.omitted !== 0) throw new Error(`${fixture.id}: expected a lossless fit, omitted ${report.omitted}`);
  if (simulation.calculateStats().active !== report.imported) throw new Error(`${fixture.id}: active-particle count diverges from import report`);
  rows.push({
    id: fixture.id,
    format: report.format,
    title: fixture.title,
    version: report.savedVersion,
    imported: report.imported,
    omitted: report.omitted,
    total: report.total,
    scale: report.scale.toFixed(4),
    milliseconds: elapsed.toFixed(1),
  });
}

console.log(`Powder³ public OPS/PSv/fuC compatibility corpus · cache ${corpusDirectory}`);
console.table(rows);
