// SPDX-License-Identifier: GPL-3.0-or-later

export function axisMap(sourceWidth, sourceHeight, simulation, bounds = null) {
  const minX = Math.max(0, Math.min(sourceWidth - 1, Math.floor(bounds?.minX ?? 0)));
  const maxX = Math.max(minX, Math.min(sourceWidth - 1, Math.ceil(bounds?.maxX ?? sourceWidth - 1)));
  const minY = Math.max(0, Math.min(sourceHeight - 1, Math.floor(bounds?.minY ?? 0)));
  const maxY = Math.max(minY, Math.min(sourceHeight - 1, Math.ceil(bounds?.maxY ?? sourceHeight - 1)));
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const scale = Math.min(1, simulation.width / contentWidth, simulation.height / contentHeight);
  const offsetX = (simulation.width - contentWidth * scale) / 2;
  const offsetY = (simulation.height - contentHeight * scale) / 2;
  return {
    scale, bounds: { minX, minY, maxX, maxY },
    point(sourceX, sourceY) {
      const x = Math.max(0, Math.min(simulation.width - 1, Math.floor(offsetX + (sourceX - minX + 0.5) * scale)));
      const y = Math.max(0, Math.min(simulation.height - 1, Math.floor(offsetY + (maxY - sourceY + 0.5) * scale)));
      return [x, y];
    },
  };
}

export function particleBounds(particles, sourceWidth, sourceHeight, emptyType = 0) {
  let minX = sourceWidth;
  let minY = sourceHeight;
  let maxX = -1;
  let maxY = -1;
  for (const particle of particles) {
    if (particle.skipped || particle.type === emptyType) continue;
    minX = Math.min(minX, particle.sourceX);
    minY = Math.min(minY, particle.sourceY);
    maxX = Math.max(maxX, particle.sourceX);
    maxY = Math.max(maxY, particle.sourceY);
  }
  return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null;
}

export function depthOrder(depth, center) {
  const order = [];
  for (let distance = 0; distance < depth; distance += 1) {
    if (center + distance < depth) order.push(center + distance);
    if (distance && center - distance >= 0) order.push(center - distance);
  }
  return order;
}

export function* placementColumns(width, height, originX, originY) {
  const maximum = Math.max(width, height);
  for (let radius = 0; radius < maximum; radius += 1) {
    if (radius === 0) { yield [originX, originY]; continue; }
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = originX + dx;
      if (x < 0 || x >= width) continue;
      for (const y of [originY - radius, originY + radius]) if (y >= 0 && y < height) yield [x, y];
    }
    for (let dy = -radius + 1; dy < radius; dy += 1) {
      const y = originY + dy;
      if (y < 0 || y >= height) continue;
      for (const x of [originX - radius, originX + radius]) if (x >= 0 && x < width) yield [x, y];
    }
  }
}
