import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, raiseFell } from './engine/worldgen.mjs';
import { heightAt, riverDistance, riverEast, TREE_LINE } from './engine/terrain.mjs';
import { inPoly, segDist } from './engine/geom.mjs';
import { outline } from './engine/roads.mjs';
import { createVillage, stepVillage } from './sim.mjs';

const seeds = [26111, 7, 90210];

test('the high country rises east of the river and leaves the west bank and the water as they were', () => {
  for (const seed of seeds) {
    const low = generateMap(seed), map = generateMap(seed), revision = map.revision;
    assert.equal(raiseFell(map), true);
    assert.equal(map.revision, revision + 1);
    const t = map.terrain;
    let top = 0;
    for (let x = 0; x <= map.w; x += 2) {
      for (let y = 0; y <= map.h; y += 2) {
        const was = heightAt(low, x, y), now = heightAt(map, x, y);
        if (x < riverEast(t, y) + 2) assert.equal(now, was, `ground moved at ${x},${y}, seed ${seed}`);
        else if (riverDistance(map, x, y) < t.riverWidth / 2) assert.ok(Math.abs(now - was) < 0.05, `the river bed moved at ${x},${y}, seed ${seed}`);
        else assert.ok(now > was - 0.6, `ground sank at ${x},${y}, seed ${seed}`);
        top = Math.max(top, now);
      }
    }
    assert.ok(top > 15 && top < 26, `summit at ${top.toFixed(1)}, seed ${seed}`);
    // The summit stands on the sheet, well east of the river.
    const summit = t.fell.crest.reduce((best, p) => p[2] > best[2] ? p : best);
    assert.ok(summit[0] > riverEast(t, summit[1]) + 25 && summit[0] < map.w - 8 && summit[1] > 4, `summit off the sheet, seed ${seed}`);
  }
});

test('the High Road climbs onto the moor by an easy slope', () => {
  for (const seed of seeds) {
    const map = generateMap(seed);
    raiseFell(map);
    for (const [a, b, kind] of map.edges) {
      if (kind !== 'road') continue;
      const A = map.nodes[a], B = map.nodes[b], run = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (run < 0.5) continue;
      assert.ok(Math.abs(heightAt(map, B[0], B[1]) - heightAt(map, A[0], A[1])) / run < 0.45, `the road is too steep near ${A}, seed ${seed}`);
    }
  }
});

test('no tree stands above the tree line, and the new woods keep off the ways, the buildings and the water', () => {
  for (const seed of seeds) {
    const low = generateMap(seed), map = generateMap(seed), had = new Set(low.trees.map(tree => tree.join()));
    raiseFell(map);
    const fresh = map.trees.filter(tree => !had.has(tree.join())), solids = map.places.map(p => outline(p)).filter(Boolean);
    assert.ok(fresh.length > 40, `only ${fresh.length} trees planted, seed ${seed}`);
    for (const [x, y] of map.trees) assert.ok(heightAt(map, x, y) < TREE_LINE, `a tree above the tree line, seed ${seed}`);
    for (const [x, y] of fresh) {
      assert.ok(x > riverEast(map.terrain, y), `a new tree west of the river, seed ${seed}`);
      assert.ok(riverDistance(map, x, y) > map.terrain.riverWidth / 2, `a tree in the river, seed ${seed}`);
      assert.ok(!solids.some(poly => inPoly([x, y], poly)), `a tree on a building or field, seed ${seed}`);
      assert.ok(map.edges.every(([a, b]) => segDist([x, y], map.nodes[a], map.nodes[b]).d > 0.9), `a tree on a way, seed ${seed}`);
    }
  }
});

test('the high country is raised once: at founding, or on the next step of a stored village', () => {
  const map = generateMap(26111);
  raiseFell(map);
  const saved = JSON.stringify(map);
  assert.equal(raiseFell(JSON.parse(saved)), false);
  assert.equal(raiseFell(map), false);
  assert.equal(JSON.stringify(map), saved);

  const village = createVillage(26111);
  assert.ok(village.map.terrain.fell);
  assert.equal(village.world.mapRevision, village.map.revision);
  // A village stored before the wood spread and the high country rose gains the same ground and trees.
  const stored = JSON.parse(JSON.stringify(village));
  delete stored.map.terrain.fell;
  stored.map.trees = generateMap(26111).trees;
  delete stored.map.places.find(p => p.kind === 'wood').spread;
  const revision = stored.map.revision;
  stepVillage(stored, { minutes: 1 });
  assert.deepEqual(stored.map.terrain.fell, village.map.terrain.fell);
  assert.deepEqual(stored.map.trees, village.map.trees);
  assert.ok(stored.map.revision > revision);
  assert.equal(stored.world.mapRevision, stored.map.revision);
  const settled = stored.map.revision;
  stepVillage(stored, { minutes: 1 });
  assert.equal(stored.map.revision, settled);
});
