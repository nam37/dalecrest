import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from './engine/worldgen.mjs';
import { riverDistance } from './engine/terrain.mjs';
import { segDist } from './engine/geom.mjs';
import { wildlife } from './public/wildlife.js';

test('game and fish are placed from a saved map, the same way every time, without changing it', () => {
  const saved = JSON.stringify(generateMap(26111));
  const map = JSON.parse(saved), wild = wildlife(map);
  assert.deepEqual(wild, wildlife(JSON.parse(saved)));
  assert.equal(JSON.stringify(map), saved);
  assert.ok(wild.game.some(a => a.kind === 'deer'));
  assert.ok(wild.game.some(a => a.kind === 'hare'));
});

test('game stands on open ground, clear of trees, buildings, ways and the river', () => {
  for (const seed of [26111, 7, 90210]) {
    const map = generateMap(seed), bank = map.terrain.riverWidth / 2;
    for (const a of wildlife(map).game) {
      assert.ok(map.trees.every(t => Math.hypot(t[0] - a.x, t[1] - a.y) > t[2] + 0.8), `${a.kind} under a tree, seed ${seed}`);
      assert.ok(riverDistance(map, a.x, a.y) > bank, `${a.kind} in the river, seed ${seed}`);
      assert.ok(map.edges.every(([p, q]) => segDist([a.x, a.y], map.nodes[p], map.nodes[q]).d > 0.5), `${a.kind} on a way, seed ${seed}`);
      for (const p of map.places) {
        if (p.w && p.kind !== 'field') assert.ok(Math.hypot(p.x - a.x, p.y - a.y) > Math.hypot(p.w, p.d) / 2 + 3, `${a.kind} beside ${p.id}, seed ${seed}`);
      }
    }
  }
});

test('fish lie in the water off the fishing bank, and nowhere until there is one', () => {
  const map = generateMap(26111);
  map.places = map.places.filter(p => p.kind !== 'fishing');
  assert.deepEqual(wildlife(map).fish, []);
  const river = map.terrain.river, mid = river[Math.floor(river.length / 2)];
  map.places.push({ id: 'fishing-bank', kind: 'fishing', x: mid[0] - map.terrain.riverWidth, y: mid[1], at: [mid[0] - map.terrain.riverWidth, mid[1]], stage: 2 });
  const { fish } = wildlife(map);
  assert.equal(fish.length, 7);
  for (const f of fish) {
    assert.ok(riverDistance(map, f.x, f.y) < map.terrain.riverWidth * 0.36, 'a fish out of the water');
    assert.ok(Math.hypot(f.x - mid[0], f.y - mid[1]) < 8, 'a fish far from the bank');
    assert.ok(Math.abs(Math.hypot(f.tx, f.ty) - 1) < 1e-9);
  }
});
