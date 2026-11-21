// Elevation and water are pure functions of the stored terrain parameters,
// so the server, the map and the walking view all agree without storing a height grid.
import { segDist, fbm, smooth, dist } from './geom.mjs';

export const WATER_LEVEL = -0.14;

// Distance from a point to the river's centre line.
export function riverDistance(map, x, y) {
  const river = map.terrain.river, p = [x, y];
  let best = Infinity;
  for (let i = 1; i < river.length; i++) {
    if (Math.abs(river[i][1] - y) > 40 && Math.abs(river[i - 1][1] - y) > 40) continue;
    const d = segDist(p, river[i - 1], river[i]).d;
    if (d < best) best = d;
  }
  // Beyond either end of the river, measure to the nearest end.
  if (best === Infinity) best = Math.min(Math.hypot(x - river[0][0], y - river[0][1]), Math.hypot(x - river[river.length - 1][0], y - river[river.length - 1][1]));
  return best;
}

export const isWater = (map, x, y, margin = 0) => riverDistance(map, x, y) < map.terrain.riverWidth / 2 + margin;

export function heightAt(map, x, y) {
  const t = map.terrain;
  const fromBank = riverDistance(map, x, y) - t.riverWidth / 2;
  // Short steep banks, then a valley floor that rises gently into the hills.
  const bank = smooth(-0.6, 1.6, fromBank), valley = 0.12 + 0.88 * smooth(0, 16, fromBank);
  const settled = smooth(9, 48, dist([x, y], [t.cx, t.cy]));
  const hills = (0.25 + 0.75 * settled) * (2.5 * fbm(t.seed, x / 44, y / 44) + 0.35 * fbm(t.seed + 7, x / 11, y / 11, 2))
    + 0.012 * Math.min(70, Math.max(0, fromBank));
  return bank * (0.1 + valley * hills) - (1 - bank) * 0.5;
}

export function slopeAt(map, x, y) {
  const e = 1.2;
  return Math.hypot(heightAt(map, x + e, y) - heightAt(map, x - e, y), heightAt(map, x, y + e) - heightAt(map, x, y - e)) / (2 * e);
}
