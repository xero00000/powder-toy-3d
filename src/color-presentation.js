// SPDX-License-Identifier: GPL-3.0-or-later

import "./visual-upgrade.js";

const DIAGNOSTIC_VIEWS = new Set(["heat", "pressure", "velocity", "gravity", "gradient", "life", "air", "fire"]);

export function paletteVisibilityMultiplier(luminance, viewMode) {
  const value = Math.max(0, Number(luminance) || 0);
  if (viewMode === "basic" || viewMode === "clarity" || DIAGNOSTIC_VIEWS.has(viewMode)) return 1;
  const darkness = Math.max(0, Math.min(1, (0.1 - value) / 0.1));
  return 1 + darkness * 0.18;
}
