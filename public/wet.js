// Rain on the parish, for both views: how wet the ground is, where puddles lie on the ways, and the
// rings the drops make on the river. All of it follows from the weather and the map, so nothing is stored.
import { clamp, hash2, smooth } from '../engine/geom.mjs';
import { SPELL, weatherAt } from '../engine/seasons.mjs';
import { isWater } from '../engine/terrain.mjs';

// How wet the ground is, from 0 (dry) to 1 (soaked). Rain wets it at once, harder rain more so. When it
// stops the ground dries over two to four hours, slower in the cold.
export function wetness(minute, seed) {
  const now = Math.floor(minute / SPELL);
  let wet = 0;
  for (let back = 0; back < 3; back++) {
    const start = (now - back) * SPELL, w = weatherAt(start, seed);
    if (!w.rain) continue;
    const since = Math.max(0, minute - (start + SPELL)), dries = 130 + 110 * clamp((14 - w.temp) / 12);
    wet = Math.max(wet, clamp(0.55 + w.rain) * clamp(1 - (back ? since : 0) / dries));
  }
  return wet;
}

// Hollows in the made ways where water stands after rain, as [x, y, size, turn, lasts]. A puddle shows
// while the ground is wetter than lasts, so the big ones are the last to dry. None lie on the bridge.
export function puddles(map) {
  const found = [], made = map.edges.filter(([, , kind]) => kind === 'road' || kind === 'lane');
  for (const [n, [a, b, kind]] of made.entries()) {
    if (hash2(map.seed + 151, n, 1) > 0.2) continue;
    const [ax, ay] = map.nodes[a], [bx, by] = map.nodes[b], len = Math.hypot(bx - ax, by - ay) || 1;
    const t = 0.2 + 0.6 * hash2(map.seed + 151, n, 2), wide = kind === 'road' ? 0.98 : 0.66, off = (hash2(map.seed + 151, n, 3) - 0.5) * wide * 0.45;
    const x = ax + (bx - ax) * t - (by - ay) / len * off, y = ay + (by - ay) * t + (bx - ax) / len * off;
    if (isWater(map, x, y, 1.2)) continue;
    found.push([x, y, wide * (0.3 + 0.3 * hash2(map.seed + 151, n, 4)), Math.atan2(by - ay, bx - ax), 0.12 + 0.5 * hash2(map.seed + 151, n, 5)]);
  }
  return found;
}

// How far a puddle has filled, from 0 to 1, when the ground is this wet.
export const puddleFill = (wet, lasts) => smooth(lasts, lasts + 0.22, wet);

// Points along the river by their share of its length, with the way it runs there.
const courses = new WeakMap();
function course(map) {
  let c = courses.get(map);
  if (!c) {
    const pts = map.terrain.river, at = [0];
    for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    courses.set(map, c = { pts, at, length: at.at(-1) });
  }
  return c;
}

// The rings raindrops leave on the river at a moment, each [x, y, age] with age running from 0 as
// the drop lands to 1 as its ring fades. Heavier rain makes more of them.
export function rainRings(map, time, rain) {
  if (!(rain > 0) || !time) return [];
  const { pts, at, length } = course(map), half = map.terrain.riverWidth / 2, n = Math.round(length * (0.4 + 1.6 * rain)), out = [];
  for (let i = 0; i < n; i++) {
    const life = 900 + 500 * hash2(7, i, 1), clock = time / life + hash2(7, i, 2), turn = Math.floor(clock);
    const along = hash2(map.seed + i, turn, 3) * length, across = (hash2(map.seed + i, turn, 4) - 0.5) * 1.6 * half;
    let k = 1;
    while (k < at.length - 1 && at[k] < along) k++;
    const a = pts[k - 1], b = pts[k], run = at[k] - at[k - 1] || 1, f = (along - at[k - 1]) / run;
    const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    out.push([x - (b[1] - a[1]) / run * across, y + (b[0] - a[0]) / run * across, clock - turn]);
  }
  return out;
}
