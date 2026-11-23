// Where the wild creatures of the plan live: deer and hares in the woods, fish under the fishing bank.
// They are scenery. Each is placed from the stored map, so every reader finds them in the same spots,
// and what the village takes by hunting and fishing does not depend on them.
import { TAU, rng, segDist } from '../engine/geom.mjs';
import { riverDistance } from '../engine/terrain.mjs';

export function wildlife(map) {
  return { game: gameIn(map), fish: fishBy(map) };
}

// Deer keep to glades with trees on every side, far from any roof, and hares to the smaller gaps.
// All of them stay clear of houses, fields and ways.
function gameIn(map) {
  const rand = rng(map.seed + 41), trees = map.trees, wet = map.terrain.riverWidth / 2 + 1.4;
  const open = (x, y, room) => trees.every(t => Math.hypot(t[0] - x, t[1] - y) > t[2] + room);
  // How many trees stand close by, and on how many of the four sides.
  const cover = (x, y) => {
    let n = 0, sides = 0;
    for (const t of trees) if (Math.hypot(t[0] - x, t[1] - y) < 5.5) { n++; sides |= 1 << (t[0] > x ? 1 : 0) + (t[1] > y ? 2 : 0); }
    return [n, [1, 2, 4, 8].filter(bit => sides & bit).length];
  };
  const quiet = (x, y) => {
    if (riverDistance(map, x, y) < wet) return false;
    for (const p of map.places) {
      if (p.at && Math.hypot(p.at[0] - x, p.at[1] - y) < 4.5) return false;
      if (p.kind !== 'wood' && Math.hypot(p.x - x, p.y - y) < (p.w ? Math.hypot(p.w, p.d) / 2 : p.rx || 1) + 6) return false;
    }
    return map.edges.every(([a, b]) => segDist([x, y], map.nodes[a], map.nodes[b]).d > 1.7);
  };
  const secluded = (x, y) => map.places.every(p => !p.w || p.kind === 'field' || Math.hypot(p.x - x, p.y - y) > 14);
  const glades = [];
  for (let i = 0; i < 1600; i++) {
    const x = 4 + rand() * (map.w - 8), y = 4 + rand() * (map.h - 8);
    if (!quiet(x, y) || !open(x, y, 0.95)) continue;
    const [n, sides] = cover(x, y);
    if (n >= 3) glades.push([x, y, n, sides]);
  }
  const game = [], taken = [];
  const apart = (g, d) => taken.every(t => Math.hypot(t[0] - g[0], t[1] - g[1]) > d);
  // Up to three small herds, in the thickest woodland there is, and the first of them in the wood the
  // village hunts if it has room. The first of a herd may be a buck and the last a fawn.
  const hunted = map.places.find(p => p.kind === 'wood');
  const rank = g => g[2] + (hunted && Math.hypot(hunted.x - g[0], hunted.y - g[1]) < 30 ? 100 : 0);
  for (const g of [...glades].sort((a, b) => rank(b) - rank(a))) {
    if (taken.length === 3) break;
    if (g[2] < 6 || g[3] < 4 || !apart(g, 18) || !secluded(g[0], g[1])) continue;
    taken.push(g);
    const herd = 2 + Math.floor(rand() * 3);
    for (let i = 0, tries = 0; i < herd && tries < 30; tries++) {
      const a = rand() * TAU, d = i ? 0.8 + rand() * 1.5 : 0, x = g[0] + Math.cos(a) * d, y = g[1] + Math.sin(a) * d;
      if (!open(x, y, 0.85) || game.some(o => Math.hypot(o.x - x, o.y - y) < 0.85)) continue;
      game.push({ kind: 'deer', x, y, phase: rand() * 40, buck: i === 0 && taken.length !== 2, young: herd > 2 && i === herd - 1 });
      i++;
    }
  }
  let hares = 0;
  for (const g of glades) {
    if (hares === 4) break;
    if (!apart(g, 8)) continue;
    taken.push(g); hares++;
    game.push({ kind: 'hare', x: g[0], y: g[1], phase: rand() * 40 });
  }
  return game;
}

// A shoal lies in the river off the fishing bank, strung out along the current.
function fishBy(map) {
  const bank = map.places.find(p => p.kind === 'fishing'), river = map.terrain.river, rw = map.terrain.riverWidth;
  if (!bank) return [];
  let near = null;
  for (let i = 1; i < river.length; i++) {
    const hit = segDist([bank.x, bank.y], river[i - 1], river[i]);
    if (!near || hit.d < near.d) near = { ...hit, i };
  }
  // The point a given distance downstream of the bank, and the way the water runs there.
  const downstream = s => {
    let i = near.i, [x, y] = [near.x, near.y];
    for (let left = Math.abs(s); ;) {
      const to = s < 0 ? river[i - 1] : river[i], len = Math.hypot(to[0] - x, to[1] - y);
      const a = river[i - 1], b = river[i], run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const flow = [(b[0] - a[0]) / run, (b[1] - a[1]) / run];
      const next = s < 0 ? i - 1 : i + 1;
      if (len >= left || next < 1 || next >= river.length) {
        const k = len ? Math.min(1, left / len) : 0;
        return [x + (to[0] - x) * k, y + (to[1] - y) * k, ...flow];
      }
      left -= len; [x, y] = to; i = next;
    }
  };
  const rand = rng(map.seed + 43);
  return Array.from({ length: 7 }, (_, i) => {
    const [x, y, tx, ty] = downstream((i - 3) * 1.05 + (rand() - 0.5) * 0.8), across = (rand() - 0.5) * rw * 0.56;
    return { x: x - ty * across, y: y + tx * across, tx, ty, len: 0.22 + rand() * 0.16, phase: rand() * 60 };
  });
}
