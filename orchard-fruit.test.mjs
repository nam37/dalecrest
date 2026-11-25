import test from 'node:test';
import assert from 'node:assert/strict';
import { FRUIT_RIPE } from './engine/smallholding.mjs';
import { appleSpots, orchardFruit } from './public/parish.js';

const DAY = 1440, READY = 40680;
const world = (minute, remaining, extra = {}) => ({ minute,
  smallholding: { orchard: { trees: 3, saplings: [], prunedYear: null, fruit: { year: 1312, readyAt: READY, remaining }, ...extra } } });

test('apples show once they have swelled, and colour before they are ripe', () => {
  assert.equal(orchardFruit(world(READY - FRUIT_RIPE + 20 * DAY, 9)), null, 'nothing shows just after blossom');
  const green = orchardFruit(world(READY - 70 * DAY, 9)), ripe = orchardFruit(world(READY, 9));
  assert.equal(green.red, 0);
  assert.ok(green.size < ripe.size);
  assert.equal(ripe.red, 1);
  assert.equal(orchardFruit(world(READY - 20 * DAY, 9)).red, 1, 'they are red some weeks before picking');
});

test('picking thins the apples but leaves a couple on each tree', () => {
  assert.equal(orchardFruit(world(READY, 9)).each, 7);
  assert.ok(orchardFruit(world(READY, 4)).each < 7);
  assert.equal(orchardFruit(world(READY, 0)).each, 2);
});

test('there are no apples without a crop, in another year or after October', () => {
  assert.equal(orchardFruit(null), null);
  assert.equal(orchardFruit({ minute: READY, smallholding: { orchard: { trees: 3, fruit: null } } }), null);
  assert.equal(orchardFruit(world(READY + 365 * DAY, 9)), null);
  assert.equal(orchardFruit(world(READY + 80 * DAY, 9)), null);
});

test('a tree keeps its first apples in place as others are picked', () => {
  const tree = [90, 60, 0.66, 0], seven = appleSpots(tree, 7, 7), two = appleSpots(tree, 7, 2);
  assert.deepEqual(seven.slice(0, 2), two);
  for (const [, out, up] of seven) { assert.ok(out > 0.4 && out < 0.85); assert.ok(up >= -0.55 && up <= 0.55); }
});
