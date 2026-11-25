// Scene details are derived from the stored map in both views, including older maps.
import { clamp, dist, hash2, lerp, polysTouch, rectPoly, smooth, TAU } from '../engine/geom.mjs';
import { dateOf } from '../engine/calendar.mjs';
import { place } from '../engine/roads.mjs';
import { freeGround } from '../engine/sites.mjs';
import { herdLoose } from '../engine/visitors.mjs';
import { WOODPILE_HOLDS } from '../engine/households.mjs';
import { farmSites, sheepCount, FRUIT_RIPE } from '../engine/smallholding.mjs';

function besideBuilding(p, u, v, w, d) {
  const c = Math.cos(p.a), s = Math.sin(p.a);
  return { x: p.x + u * c - v * s, y: p.y + u * s + v * c, w, d, a: p.a };
}

export function parishLayout(map) {
  const gardens = [], piles = [], occupied = [];
  function reserve(options, roadGap = 0.15) {
    for (const p of options) {
      const shape = rectPoly(p, 0.1);
      if (!freeGround(map, shape, { gap: 0.08, roadGap, bank: 0.4 })) continue;
      if (occupied.some(other => polysTouch(shape, other))) continue;
      if (map.trees.some(t => dist([p.x, p.y], t) < Math.hypot(p.w, p.d) / 2 + t[2] * 0.5)) continue;
      occupied.push(shape);
      return p;
    }
    return null;
  }

  const wood = place(map, 'wood');
  if (wood) {
    const [x, y] = wood.at, options = [];
    for (const radius of [1.35, 1.9, 2.6, 3.3, 4.2]) {
      for (let i = 0; i < 12; i++) {
        const a = TAU * i / 12;
        options.push({ x: x + radius * Math.cos(a), y: y + radius * Math.sin(a), w: 1.2, d: 0.76, a });
      }
    }
    const p = reserve(options);
    if (p) piles.push({ ...p, id: wood.id, common: true, columns: 4, rows: 4 });
  }

  for (const p of map.places) {
    if (p.kind !== 'cottage' || p.stage !== 2) continue;
    const door = Math.sign((p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a)) || 1;
    const garden = reserve([1.5, 1.15, 0.8].map(d => besideBuilding(p, 0, -door * (p.d / 2 + 0.26 + d / 2), p.w, d)));
    if (garden) gardens.push({ ...garden, id: p.id, door });
    const options = [-1, 1].map(side => besideBuilding(p, side * (p.w / 2 + 0.74), -door * p.d * 0.18, 0.8, 0.48));
    options.push(besideBuilding(p, 0, -door * (p.d / 2 + (garden?.d ?? 0) + 0.85), 0.8, 0.48));
    const pile = reserve(options);
    if (pile) piles.push({ ...pile, id: p.id, columns: 3, rows: 3 });
  }

  const kitchen = place(map, farmSites.garden.id), orchard = place(map, farmSites.orchard.id);
  const pasture = place(map, farmSites.pasture.id), green = place(map, 'green'), meadowOptions = [];
  if (kitchen) {
    const door = Math.sign((kitchen.at[0] - kitchen.x) * -Math.sin(kitchen.a) + (kitchen.at[1] - kitchen.y) * Math.cos(kitchen.a)) || 1;
    gardens.push({ ...kitchen, door });
  }
  if (!pasture && green) {
    for (const radius of [7, 10, 13, 17]) {
      for (let i = 0; i < 16; i++) {
        const a = i * TAU / 16;
        meadowOptions.push({ x: green.x + Math.cos(a) * radius, y: green.y + Math.sin(a) * radius, w: 4.4, d: 3.6, a: 0 });
      }
    }
  }
  const meadow = pasture ?? reserve(meadowOptions, 0.6);
  const sheep = meadow ? [[-1.35, 0.1], [-0.48, -1.05], [0.1, 0.82], [0.76, -0.25], [1.42, 0.89], [-1.68, -0.88], [0.57, -1.27], [-0.91, 1.26]]
    .map(([u, v], i) => {
      const { x, y } = besideBuilding(meadow, u, v, 0, 0);
      return { kind: 'sheep', x, y, phase: (map.seed % 17 + i * 5) * 0.6, coat: i % 3 };
    }) : [];
  const appleTrees = orchard ? [-1.4, 0, 1.4].map(u => {
    const { x, y } = besideBuilding(orchard, u, 0, 0, 0);
    return [x, y, 0.66, 0];
  }) : [];
  for (const pile of piles) pile.logs = woodLogs(pile);
  return { gardens, piles, sheep, appleTrees, pasture, orchard, common: piles.find(p => p.common) };
}

export function visibleSheep(layout, world) {
  const flock = world?.smallholding?.flock;
  return layout.sheep.slice(0, layout.pasture && flock ? sheepCount(flock) : 5);
}

export function workHeading(position, activity, commonPile) {
  if (!activity.working || !commonPile || !['cut', 'fetchWood'].includes(activity.job)) return position.heading;
  return Math.atan2(commonPile.y - position.y, commonPile.x - position.x);
}

export function fenceSpans(garden) {
  const [nw, ne, se, sw] = rectPoly(garden);
  // The side facing the cottage stays open.
  const sides = garden.door > 0 ? [[sw, nw], [nw, ne], [ne, se]] : [[nw, sw], [sw, se], [se, ne]];
  return sides.flatMap(([a, b]) => {
    const n = Math.ceil(dist(a, b) / 0.95);
    const point = t => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    return Array.from({ length: n }, (_, i) => [point(i / n), point((i + 1) / n)]);
  });
}

export function logsIn(pile, world) {
  const stock = pile.common ? world?.supplies?.wood : world?.cottages?.[pile.id]?.woodpile;
  const capacity = pile.common ? world?.capacity?.wood || 32 : WOODPILE_HOLDS;
  return Math.ceil(clamp((stock || 0) / capacity) * pile.rows * pile.columns);
}

function woodLogs(pile) {
  const diameter = pile.d / pile.columns;
  return Array.from({ length: pile.rows * pile.columns }, (_, i) => {
    const row = Math.floor(i / pile.columns), column = i % pile.columns;
    return { u: Math.sin(i * 2.6) * diameter * 0.26, v: (column - (pile.columns - 1) / 2) * diameter * (1 - row * 0.13),
      height: (row * 0.84 + 0.55) * diameter, length: pile.w * (0.86 + (i % 3) * 0.07), radius: diameter * 0.49 };
  });
}

export function strayCattle(map, world) {
  const field = world && herdLoose(world) && place(map, world.herd.field);
  if (field?.stage !== 2) return [];
  return [[-1.6, 0.2], [0.48, -1.02], [1.42, 1.04]].map(([u, v], i) => ({
    ...besideBuilding(field, u, v, 0, 0), kind: 'cattle', phase: 3 + i * 3.3, coat: i,
  }));
}

export function animalPose(animal, now) {
  const cycle = now / 11000 + animal.phase / TAU;
  const lap = Math.floor(cycle), f = cycle - lap, walk = clamp(f / 0.52);
  const angle = animal.phase + (lap + walk * walk * (3 - 2 * walk)) * 2.3;
  const graze = clamp(Math.min((f - 0.52) * 12, (1 - f) * 12));
  return { x: animal.x + Math.cos(angle) * 0.32, y: animal.y + Math.sin(angle) * 0.27, heading: angle + Math.PI / 2,
    stride: Math.sin(angle * 9) * 4 * walk * (1 - walk), graze };
}

export const animalCoats = { sheep: ['#e8dfc2', '#d7c8ad', '#f2ebd5'], cattle: ['#a8754d', '#87573b', '#bd9474'] };

// The apples showing in the orchard, or null when the trees carry none worth drawing.
//   each  how many hang on a tree: more while the crop is unpicked, and a couple left out of reach once it is in
//   red   how far they have coloured, from 0 (green) to 1
//   size  how far they have swelled, as a share of a ripe apple
// The fruit sets at blossom and is ripe 150 days on. It shows from about half way, colours over the
// last weeks, and is gone with October whether or not it was picked.
export function orchardFruit(world, minute = world?.minute) {
  const orchard = world?.smallholding?.orchard, fruit = orchard?.fruit;
  if (!fruit || !Number.isFinite(minute)) return null;
  const { month, year } = dateOf(minute);
  if (fruit.year !== year || month > 10) return null;
  const grown = clamp(1 - (fruit.readyAt - minute) / FRUIT_RIPE);
  if (grown < 0.5) return null;
  const full = Math.max(1, orchard.trees * (orchard.prunedYear === year ? 4 : 3));
  return { each: 2 + Math.round(5 * clamp(fruit.remaining / full)), red: smooth(0.58, 0.85, grown), size: 0.65 + 0.35 * smooth(0.5, 1, grown) };
}

// Where apples hang on a tree at [x, y], spread round the crown. Each is [round, out, up]: the bearing
// round the trunk, how far out from it as a share of the crown's radius, and how high, from -1 at the
// skirt of the crown to 1 at its top. A tree keeps its first apples as others are picked.
export function appleSpots([x, y], seed, count) {
  const turn = hash2(seed, x * 10, y * 10) * TAU;
  return Array.from({ length: count }, (_, i) => [turn + i * 2.4 + (hash2(seed + 11, x * 10 + i, y * 10) - 0.5) * 0.7,
    0.42 + 0.4 * hash2(seed + 12, x * 10 + i, y * 10), hash2(seed + 13, x * 10 + i, y * 10) * 1.1 - 0.55]);
}
