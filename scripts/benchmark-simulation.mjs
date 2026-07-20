// SPDX-License-Identifier: GPL-3.0-or-later

import { performance } from "node:perf_hooks";
import { VoxelSimulation } from "../src/simulation.js";

const WIDTH = 48;
const HEIGHT = 36;
const DEPTH = 28;
const TARGET_HZ = 24;
const STEP_BUDGET_MS = 1000 / TARGET_HZ;
const WARMUP_STEPS = 12;
const MEASURED_STEPS = 120;
const PRESETS = ["foundry", "reactor", "garden", "volcano"];

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

const rows = [];
for (let presetIndex = 0; presetIndex < PRESETS.length; presetIndex += 1) {
  const preset = PRESETS[presetIndex];
  const simulation = new VoxelSimulation(WIDTH, HEIGHT, DEPTH, 0x3d0000 + presetIndex);
  simulation.loadPreset(preset);
  for (let step = 0; step < WARMUP_STEPS; step += 1) simulation.step();

  const samples = [];
  for (let step = 0; step < MEASURED_STEPS; step += 1) {
    const started = performance.now();
    simulation.step();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  rows.push({
    preset,
    mean: mean.toFixed(3),
    p95: percentile(samples, 0.95).toFixed(3),
    max: samples.at(-1).toFixed(3),
    simulatedHz: (1000 / mean).toFixed(1),
  });
}

console.log(`Powder³ simulation benchmark · ${WIDTH}×${HEIGHT}×${DEPTH} · ${MEASURED_STEPS} measured steps · ${STEP_BUDGET_MS.toFixed(3)} ms budget`);
console.table(rows);

const slow = rows.filter((row) => Number(row.p95) > STEP_BUDGET_MS);
if (slow.length) {
  console.error(`24 Hz p95 budget exceeded by: ${slow.map((row) => row.preset).join(", ")}`);
  process.exitCode = 1;
}
