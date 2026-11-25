// The clouds over the parish, for whichever view is drawing them. The field repeats every TILE units
// in both directions and drifts with the wind, so cloud never runs out however long the wind blows.
// Both views read the same drift, so a cloud passes over the same ground in each.
import { hash2, clamp } from '../engine/geom.mjs';

export const TILE = 240;
const COUNT = 22;

// Every cloud the sky can hold, each a cluster of round lobes strung along its own long axis.
//   rank  when it appears: the lowest ranks are out under almost any sky, the highest only when it is nearly overcast
export function cloudField(seed) {
  const clouds = [];
  for (let i = 0; i < COUNT; i++) {
    const size = 8 + hash2(seed, i, 301) * 11, lean = (hash2(seed, i, 302) - 0.5) * 1.1, n = 4 + Math.floor(hash2(seed, i, 303) * 4);
    const lobes = [];
    for (let j = 0; j < n; j++) {
      const along = (j / (n - 1) - 0.5) * 2, across = (hash2(seed, i * 16 + j, 304) - 0.5) * 0.7;
      const r = size * (0.42 + 0.34 * hash2(seed, i * 16 + j, 305)) * (1.15 - 0.4 * along * along);
      const u = along * size * 0.95, v = across * size;
      lobes.push([u * Math.cos(lean) - v * Math.sin(lean), u * Math.sin(lean) + v * Math.cos(lean), r]);
    }
    clouds.push({ x: hash2(seed, i, 306) * TILE, y: hash2(seed, i, 307) * TILE, rank: (((i * 7) % COUNT) + 0.5) / COUNT, lobes });
  }
  return clouds;
}

// The clouds that are out under a given cover and lie within reach of a stretch of ground. Each has
// the id it keeps wherever it drifts and its lobes as [x, y, radius]. More cover brings more cloud
// and swells what is already there.
export function cloudsOver(field, cover, drift, x0, y0, x1, y1) {
  const out = [], show = 0.12 + cover, swell = 0.8 + 0.45 * cover, wrap = v => ((v % TILE) + TILE) % TILE;
  for (const [id, cloud] of field.entries()) {
    const grown = clamp((show - cloud.rank) / 0.22) * swell;
    if (grown < 0.08) continue;
    const reach = 36 * grown, bx = wrap(cloud.x + drift[0]), by = wrap(cloud.y + drift[1]);
    for (let x = bx + Math.floor((x0 - reach - bx) / TILE) * TILE + TILE; x < x1 + reach; x += TILE) {
      for (let y = by + Math.floor((y0 - reach - by) / TILE) * TILE + TILE; y < y1 + reach; y += TILE) {
        out.push({ id, lobes: cloud.lobes.map(([dx, dy, r]) => [x + dx * grown, y + dy * grown, r * grown]) });
      }
    }
  }
  return out;
}

// The widest and the narrowest a shadow is drawn, as shares of each lobe's radius. Between the two it
// falls away from full shade to none.
export const SHADE_EDGE = [1.1, 0.89];

// How far a spot is under cloud, from 0 in the open to 1 well inside a shadow.
export function cloudOverhead(clouds, x, y) {
  let most = 0;
  for (const { lobes } of clouds) {
    for (const [lx, ly, r] of lobes) {
      const d = Math.hypot(x - lx, y - ly) / r;
      if (d < SHADE_EDGE[0]) most = Math.max(most, clamp((SHADE_EDGE[0] - d) / (SHADE_EDGE[0] - SHADE_EDGE[1])));
    }
  }
  return most;
}

// How firmly cloud shadows show on the ground, from 0 to 1. A clear sky throws none, broken cloud
// throws them sharply, and under a full overcast they run together into one even grey.
export const cloudShade = cover => clamp(cover / 0.12) * (1 - clamp((cover - 0.7) / 0.27));

// How far the clouds have drifted. A view passes the time of its frame and the wind then blowing.
// A time of 0 leaves them where they are, for a reader who has asked for less motion.
let last = 0;
const gone = [0, 0];
export function cloudDrift(time, wind) {
  if (time && wind) {
    const dt = clamp((time - last) / 1000, 0, 0.25), speed = 0.4 + 2.3 * wind.strength;
    last = time;
    gone[0] = (gone[0] + wind.toward[0] * speed * dt) % TILE; gone[1] = (gone[1] + wind.toward[1] * speed * dt) % TILE;
  }
  return gone;
}
