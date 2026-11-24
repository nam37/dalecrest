import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, spreadWood } from './engine/worldgen.mjs';
import { riverDistance } from './engine/terrain.mjs';
import { inPoly, segDist } from './engine/geom.mjs';
import { outline, place } from './engine/roads.mjs';
import { createVillage, stepVillage } from './sim.mjs';

test('the woodland spreads south-west of the coppice once, by the rules the rest was planted by', () => {
  for (const seed of [26111, 7, 90210]) {
    const map = generateMap(seed), wood = place(map, 'wood'), old = map.trees.length, revision = map.revision;
    const planted = spreadWood(map), fresh = map.trees.slice(old);
    assert.equal(planted, fresh.length);
    assert.ok(planted > 60, `only ${planted} trees planted, seed ${seed}`);
    assert.equal(map.revision, revision + 1);
    // The new trees lie south of the coppice and west of the green.
    const mean = axis => fresh.reduce((sum, t) => sum + t[axis], 0) / fresh.length;
    assert.ok(mean(1) > wood.y + 8, `new trees not south of the coppice, seed ${seed}`);
    assert.ok(mean(0) < map.terrain.cx - 20, `new trees not west of the green, seed ${seed}`);
    const solids = map.places.map(p => outline(p)).filter(Boolean);
    for (const [x, y] of fresh) {
      assert.ok(riverDistance(map, x, y) > map.terrain.riverWidth / 2, `a tree in the river, seed ${seed}`);
      assert.ok(!solids.some(poly => inPoly([x, y], poly)), `a tree on a building or field, seed ${seed}`);
      assert.ok(map.edges.every(([a, b]) => segDist([x, y], map.nodes[a], map.nodes[b]).d > 0.9), `a tree on a way, seed ${seed}`);
    }
    // A second survey plants nothing and leaves the map as it is.
    const saved = JSON.stringify(map);
    assert.equal(spreadWood(JSON.parse(saved)), 0);
    assert.equal(spreadWood(map), 0);
    assert.equal(JSON.stringify(map), saved);
  }
});

test('a new village has the wider wood, and a stored one gains it on its next step', () => {
  const plain = generateMap(26111), village = createVillage(26111);
  assert.ok(place(village.map, 'wood').spread);
  assert.ok(village.map.trees.length > plain.trees.length + 60);
  assert.equal(village.world.mapRevision, village.map.revision);

  // A village stored before the wood spread: the ground as it was first drawn, without the new trees
  // or their mark, and without the high country that was raised after them.
  const stored = JSON.parse(JSON.stringify(village));
  stored.map.trees = plain.trees;
  delete place(stored.map, 'wood').spread;
  delete stored.map.terrain.fell;
  const before = stored.map.revision;
  stepVillage(stored, { minutes: 1 });
  assert.equal(stored.map.trees.length, village.map.trees.length);
  assert.ok(stored.map.revision > before);
  assert.equal(stored.world.mapRevision, stored.map.revision);
  const settled = stored.map.revision, count = stored.map.trees.length;
  stepVillage(stored, { minutes: 1 });
  assert.equal(stored.map.trees.length, count);
  assert.equal(stored.map.revision, settled);
});
