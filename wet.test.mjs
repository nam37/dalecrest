import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from './engine/worldgen.mjs';
import { SPELL, weatherAt } from './engine/seasons.mjs';
import { isWater, riverDistance } from './engine/terrain.mjs';
import { puddleFill, puddles, rainRings, wetness } from './public/wet.js';

const map = generateMap(7);

// The first spell of rain followed by a dry one.
function shower(seed) {
  for (let i = 1; i < 4000; i++) if (weatherAt(i * SPELL, seed).rain > 0.3 && !weatherAt((i + 1) * SPELL, seed).rain) return i * SPELL;
  throw new Error('no shower found');
}

test('the ground is soaked while it rains and dries within a few hours after', () => {
  const start = shower(map.seed), end = start + SPELL;
  assert.equal(wetness(start + 30, map.seed), 1);
  assert.ok(wetness(end + 60, map.seed) > 0.4, 'still wet an hour after');
  assert.ok(wetness(end + 60, map.seed) > wetness(end + 120, map.seed), 'it keeps drying');
  assert.equal(wetness(end + 5 * 60, map.seed), 0, 'dry again five hours after');
});

test('puddles lie on the made ways, clear of the river, and the larger last longer', () => {
  const found = puddles(map);
  assert.ok(found.length > 5);
  for (const [x, y] of found) assert.ok(!isWater(map, x, y, 1));
  assert.equal(puddleFill(0, 0.2), 0);
  assert.equal(puddleFill(1, 0.6), 1);
  assert.ok(puddleFill(0.5, 0.2) > puddleFill(0.5, 0.4));
});

test('rain rings the river and nothing else, and more of it in heavier rain', () => {
  assert.deepEqual(rainRings(map, 5000, 0), []);
  const light = rainRings(map, 5000, 0.2), heavy = rainRings(map, 5000, 0.9);
  assert.ok(heavy.length > light.length);
  for (const [x, y, age] of heavy) {
    assert.ok(riverDistance(map, x, y) < map.terrain.riverWidth / 2);
    assert.ok(age >= 0 && age < 1);
  }
});
