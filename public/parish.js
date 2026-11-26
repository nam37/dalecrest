// Scene details are derived from the stored map in both views, including older maps.
import { clamp, dist, hash2, lerp, polysTouch, rectPoly, segDist, smooth, TAU } from '../engine/geom.mjs';
import { heightAt, WATER_LEVEL } from '../engine/terrain.mjs';
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
  // The woodward splits logs on a block between where they stand and the common pile, and the chips
  // lie about it.
  const pile = piles.find(q => q.common), block = wood && pile ? chopping(map, wood.at, pile) : null;

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
  return { gardens, piles, sheep, appleTrees, pasture, orchard, common: piles.find(p => p.common), block };
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

// Where people fishing stand: at the water's edge off the fishing bank, a few steps apart when there
// are several, each looking out over the water. Gives [x, y, heading] for each of count anglers.
export function fishingStands(map, count) {
  const bank = map.places.find(p => p.kind === 'fishing'), river = map.terrain.river;
  if (!bank || !count) return [];
  let near = null;
  for (let i = 1; i < river.length; i++) {
    const hit = segDist([bank.x, bank.y], river[i - 1], river[i]);
    if (!near || hit.d < near.d) near = hit;
  }
  const d = near.d || 1, out = [(near.x - bank.x) / d, (near.y - bank.y) / d], along = [-out[1], out[0]];
  return Array.from({ length: count }, (_, i) => {
    const shift = (i - (count - 1) / 2) * 0.9;
    let x = bank.x + along[0] * shift, y = bank.y + along[1] * shift;
    // Out from the landing until one more step would be in the water.
    for (let s = 0; s < 8 && heightAt(map, x + out[0] * 0.3, y + out[1] * 0.3) > WATER_LEVEL + 0.04; s += 0.1) { x += out[0] * 0.1; y += out[1] * 0.1; }
    return [x, y, Math.atan2(out[1], out[0])];
  });
}

// Someone at the fishing bank with a line in the water.
const angling = (actor, p) => Boolean(p) && !p.moving && actor.action?.target === 'fishing-bank' && actor.action.phase === 'working'
  && actor.action.job === 'fish' && actor.action.cast && !actor.action.queued;

// The engine leaves anglers on the landing. A view walks each of them the last few steps to their
// place at the water's edge, and back to the landing when they finish. Make one for each view, then
// for each frame call begin with the actors and their places, and place for each resident.
export function createAnglers() {
  const stood = new Map(), stands = new Map();
  let seen = null, fishers = [];
  return {
    begin(map, actors, at) {
      if (map !== seen) { seen = map; stands.clear(); }
      fishers = actors.filter(a => angling(a, at(a.id))).map(a => a.id).sort();
      if (fishers.length && !stands.has(fishers.length)) stands.set(fishers.length, fishingStands(map, fishers.length));
    },
    // Where to draw a resident whose place on the path is p, dt seconds after the last frame.
    place(id, p, dt) {
      const i = fishers.indexOf(id), stand = i >= 0 ? stands.get(fishers.length)[i] : null, was = stood.get(id);
      if (!stand && !was) return p;
      const [tx, ty] = stand ?? [p.x, p.y], cur = was ?? { x: p.x, y: p.y };
      const gap = Math.hypot(tx - cur.x, ty - cur.y), step = gap > 6 ? gap : Math.min(gap, dt * (stand ? 1.1 : 3));
      if (gap) { cur.x += (tx - cur.x) / gap * step; cur.y += (ty - cur.y) / gap * step; }
      const left = gap - step;
      if (!stand && left < 0.01) { stood.delete(id); return p; }
      stood.set(id, cur);
      return { ...p, x: cur.x, y: cur.y, moving: p.moving || left > 0.02,
        heading: left > 0.02 ? Math.atan2(ty - cur.y, tx - cur.x) : stand ? stand[2] : p.heading };
    },
  };
}

// A chopping block a little way from where the woodward stands, toward the pile, with chips scattered
// round it as [x, y, size, turn].
function chopping(map, [sx, sy], pile) {
  const d = Math.hypot(pile.x - sx, pile.y - sy) || 1, x = sx + (pile.x - sx) / d * 0.55, y = sy + (pile.y - sy) / d * 0.55;
  const chips = Array.from({ length: 34 }, (_, i) => {
    const a = hash2(map.seed + 171, i, 1) * TAU, r = 0.18 + Math.pow(hash2(map.seed + 171, i, 2), 0.7) * 0.85;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r, 0.035 + hash2(map.seed + 171, i, 3) * 0.05, hash2(map.seed + 171, i, 4) * TAU];
  });
  return { x, y, chips };
}

// How far the walls and roof of a building in progress have gone, from 0 as its frame goes up to 1 as
// it is finished. The frame stands at 35% of the work.
export function raisedOf(world, id) {
  const project = world?.projects?.find(p => p.id === id);
  return project ? clamp((project.done / project.need - 0.35) / 0.65) : 0;
}

// While a bake is on, loaves come out onto a board by the oven mouth, up to five. Gives how many show,
// and where the board stands as { x, y, a } with a the way the oven faces.
export function ovenLoaves(map, actors) {
  const oven = map.places.find(p => p.kind === 'oven' && p.stage === 2);
  if (!oven) return null;
  let made = 0;
  for (const a of actors) {
    const action = a.action;
    if (action?.job !== 'bake' || action.phase !== 'working' || action.target !== oven.id) continue;
    made = Math.max(made, Math.min(5, Math.floor(clamp(1 - (action.remaining ?? 58) / 58) * 6)));
  }
  const side = (oven.at[0] - oven.x) * -Math.sin(oven.a) + (oven.at[1] - oven.y) * Math.cos(oven.a) > 0 ? 1 : -1;
  const lx = oven.w * 0.27 + 0.72, ly = side * 0.78;
  return { count: made, x: oven.x + lx * Math.cos(oven.a) - ly * Math.sin(oven.a), y: oven.y + lx * Math.sin(oven.a) + ly * Math.cos(oven.a), a: oven.a };
}

// Children at play on the green. The engine leaves them standing where they arrived; a view sets them
// running round a ring on the grass, spaced out as in a chasing game, now and then all turning to run
// the other way. Each eases onto the ring when play begins and back to where the engine has them when
// it ends. Make one for each view, then each frame call begin with the actors, their places and the
// time, and place for each resident.
export function createPlay() {
  const stood = new Map();
  let players = [], ring = null, time = 0, run = 0, last = 0;
  return {
    begin(map, actors, at, now) {
      const green = map.places.find(p => p.kind === 'green');
      players = green ? actors.filter(a => a.child && a.action?.kind === 'play' && a.action.phase === 'working' && a.action.target === green.id && at(a.id) && !at(a.id).moving)
        .map(a => a.id).sort() : [];
      ring = green && { x: green.x, y: green.y, rx: Math.max(1.2, (green.rx ?? 4) * 0.5), ry: Math.max(1, (green.ry ?? 3) * 0.5) };
      // The game turns about every twenty seconds, so the ring runs one way and then the other.
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now; time = now;
      run += dt * (Math.floor(now / 20000) % 2 ? -0.55 : 0.55);
    },
    place(id, p, dt) {
      const i = players.indexOf(id), was = stood.get(id);
      if (i < 0 && !was) return p;
      let tx = p.x, ty = p.y, heading = p.heading;
      if (i >= 0) {
        const a = run + i * TAU / players.length, wobble = 1 + 0.12 * Math.sin(time * 0.0017 + i * 2.1);
        tx = ring.x + Math.cos(a) * ring.rx * wobble; ty = ring.y + Math.sin(a) * ring.ry * wobble;
        heading = Math.atan2(Math.cos(a) * ring.ry, -Math.sin(a) * ring.rx) + (Math.floor(time / 20000) % 2 ? Math.PI : 0);
      }
      const cur = was ?? { x: p.x, y: p.y, gone: 0 }, gap = Math.hypot(tx - cur.x, ty - cur.y);
      const step = gap > 8 ? gap : Math.min(gap, dt * (i >= 0 ? 2.2 : 3));
      if (gap) { cur.x += (tx - cur.x) / gap * step; cur.y += (ty - cur.y) / gap * step; }
      cur.gone += i >= 0 ? Math.max(step, dt * 0.55 * Math.hypot(ring.rx, ring.ry) * 0.7) : step;
      if (i < 0 && gap - step < 0.01) { stood.delete(id); return p; }
      stood.set(id, cur);
      return { ...p, x: cur.x, y: cur.y, moving: true, gone: cur.gone * 1.6, heading: gap - step > 0.05 ? Math.atan2(ty - cur.y, tx - cur.x) : heading };
    },
  };
}
