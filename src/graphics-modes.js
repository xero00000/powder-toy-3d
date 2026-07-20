// SPDX-License-Identifier: GPL-3.0-or-later

// Values mirror src/simulation/ElementGraphics.h in the pinned upstream build.
const GRAPHICS_MODE_UNSIGNED = {
  PMODE: 0x00000fff,
  PMODE_NONE: 0x00000000,
  PMODE_FLAT: 0x00000001,
  PMODE_BLOB: 0x00000002,
  PMODE_BLUR: 0x00000004,
  PMODE_GLOW: 0x00000008,
  PMODE_SPARK: 0x00000010,
  PMODE_FLARE: 0x00000020,
  PMODE_LFLARE: 0x00000040,
  PMODE_ADD: 0x00000080,
  PMODE_BLEND: 0x00000100,
  PSPEC_STICKMAN: 0x00000200,
  OPTIONS: 0x0000f000,
  NO_DECO: 0x00001000,
  DECO_FIRE: 0x00002000,
  FIREMODE: 0x00ff0000,
  FIRE_ADD: 0x00010000,
  FIRE_BLEND: 0x00020000,
  FIRE_SPARK: 0x00040000,
  EFFECT: 0xff000000,
  EFFECT_GRAVIN: 0x01000000,
  EFFECT_GRAVOUT: 0x02000000,
  EFFECT_LINES: 0x04000000,
  EFFECT_DBGLINES: 0x08000000,
  RENDER_EFFE: 0xff00f270,
  RENDER_FIRE: 0x0003f380,
  RENDER_SPRK: 0x0004f380,
  RENDER_GLOW: 0x0000f388,
  RENDER_BLUR: 0x0000f384,
  RENDER_BLOB: 0x0000f382,
  RENDER_BASC: 0x0400f381,
  RENDER_NONE: 0x0000f201,
};

// Lua 5.3 in Fengari exposes 32-bit signed integers, matching upstream's
// `int(v)` constants for masks whose high bit is set.
export const GRAPHICS_MODE = Object.freeze(Object.fromEntries(
  Object.entries(GRAPHICS_MODE_UNSIGNED).map(([name, value]) => [name, value | 0]),
));

const byte = (value) => Math.max(0, Math.min(255, Number(value) || 0));

// The upstream callback controls a 2D pixel/fire renderer. This translation keeps
// its colour, visibility, decoration and effect intent in the volumetric renderer.
export function graphicsStyle(result) {
  const pixelMode = Number(result?.pixelMode ?? GRAPHICS_MODE.PMODE_FLAT) >>> 0;
  const primaryMode = pixelMode & GRAPHICS_MODE.PMODE;
  const fireMode = pixelMode & GRAPHICS_MODE.FIREMODE;
  const alpha = byte(result?.alpha ?? 255) / 255;
  const fireAlpha = fireMode ? byte(result?.fireAlpha ?? 0) / 255 : 0;
  const primaryVisible = primaryMode !== GRAPHICS_MODE.PMODE_NONE && alpha > 0;
  const visible = primaryVisible || fireAlpha > 0;
  let scale = primaryVisible ? 0.45 + Math.sqrt(alpha) * 0.55 : 0.84;
  let intensity = primaryVisible ? 0.35 + alpha * 0.65 : 1;
  if (pixelMode & GRAPHICS_MODE.PMODE_BLOB) scale *= 1.18;
  if (pixelMode & GRAPHICS_MODE.PMODE_BLUR) scale *= 1.12;
  if (pixelMode & GRAPHICS_MODE.PMODE_GLOW) intensity += 0.55;
  if (pixelMode & GRAPHICS_MODE.PMODE_ADD) intensity += 0.35;
  if (pixelMode & GRAPHICS_MODE.PMODE_SPARK) { scale *= 0.88; intensity += 0.72; }
  if (pixelMode & GRAPHICS_MODE.PMODE_FLARE) { scale *= 1.24; intensity += 0.88; }
  if (pixelMode & GRAPHICS_MODE.PMODE_LFLARE) { scale *= 1.42; intensity += 1.05; }
  intensity += fireAlpha * 0.7;
  return {
    visible,
    noDecoration: Boolean(pixelMode & GRAPHICS_MODE.NO_DECO),
    scale,
    intensity,
    fireBlend: fireAlpha,
    color: [byte(result?.red), byte(result?.green), byte(result?.blue)],
    fireColor: [byte(result?.fireRed), byte(result?.fireGreen), byte(result?.fireBlue)],
  };
}
