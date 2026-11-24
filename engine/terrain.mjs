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

// The river's easting at a given northing.
export function riverEast(t, y) {
  const r = t.river, i = Math.min(r.length - 2, Math.max(0, Math.floor((y - r[0][1]) / (r[1][1] - r[0][1]))));
  return r[i][0] + (r[i + 1][0] - r[i][0]) * (y - r[i][1]) / (r[i + 1][1] - r[i][1]);
}

// High country east of the river: a moor that climbs away from the water in long swells, and standing
// on it a ridge with its summits and the saddles between them. A map without one is unchanged.
//   fell: { moor, crest: [[x, y, h], ...], r }
//     moor   how high the open ground climbs before the ridge
//     crest  the ridge line, through each summit and saddle, with the height the ridge adds there
//     r      how far its slopes reach to either side
function fellAt(t, x, y) {
  const f = t.fell;
  if (!f) return 0;
  const east = smooth(2, 34, x - riverEast(t, y));
  if (!east) return 0;
  const moor = f.moor * east * (0.45 + 1.1 * fbm(t.seed + 37, x / 24, y / 24, 3));
  let d = Infinity, crest = 0;
  for (let i = 1; i < f.crest.length; i++) {
    const from = f.crest[i - 1], to = f.crest[i], hit = segDist([x, y], from, to);
    if (hit.d < d) { d = hit.d; crest = from[2] + (to[2] - from[2]) * hit.t; }
  }
  // Spurs: the foot reaches further out in some places than in others.
  const rise = smooth(0, 1, 1 - d / (f.r * (0.75 + 0.5 * fbm(t.seed + 29, x / 30 + 5, y / 30 + 5, 2))));
  if (!rise) return moor;
  // Gullies cut the slopes, deepest half way up, and the rock between is broken into crags.
  const ridge = 1 - Math.abs(2 * fbm(t.seed + 23, x / 17, y / 17, 3) - 1);
  const crag = fbm(t.seed + 31, x / 6, y / 6, 2) - 0.5;
  return moor + east * (crest * Math.pow(rise, 1.6) * (1 - 1.5 * rise * (1 - rise) * (1 - ridge * ridge)) + crag * 2.4 * rise * (1 - rise * 0.6));
}

// Above this the ground is bare rock and scree, and no tree grows.
export const TREE_LINE = 9;

export function heightAt(map, x, y) {
  const t = map.terrain;
  const fromBank = riverDistance(map, x, y) - t.riverWidth / 2;
  // Short steep banks, then a valley floor that rises gently into the hills.
  const bank = smooth(-0.6, 1.6, fromBank), valley = 0.12 + 0.88 * smooth(0, 16, fromBank);
  const settled = smooth(9, 48, dist([x, y], [t.cx, t.cy]));
  const hills = (0.25 + 0.75 * settled) * (2.5 * fbm(t.seed, x / 44, y / 44) + 0.35 * fbm(t.seed + 7, x / 11, y / 11, 2))
    + 0.012 * Math.min(70, Math.max(0, fromBank)) + fellAt(t, x, y);
  return bank * (0.1 + valley * hills) - (1 - bank) * 0.5;
}

export function slopeAt(map, x, y) {
  const e = 1.2;
  return Math.hypot(heightAt(map, x + e, y) - heightAt(map, x - e, y), heightAt(map, x, y + e) - heightAt(map, x, y - e)) / (2 * e);
}
