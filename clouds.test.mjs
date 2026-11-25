import test from 'node:test';
import assert from 'node:assert/strict';
import { windAt } from './engine/seasons.mjs';
import { cloudField, cloudsOver, cloudOverhead, cloudShade, TILE } from './public/clouds.js';

test('the wind is the same for a given minute and seed, and never jumps', () => {
  assert.deepEqual(windAt(5000, 7), windAt(5000, 7));
  let east = 0, count = 0;
  for (let minute = 0; minute < 1440 * 120; minute += 30) {
    const now = windAt(minute, 7), next = windAt(minute + 30, 7);
    assert.ok(Math.abs(Math.hypot(...now.toward) - 1) < 1e-9);
    assert.ok(now.strength >= 0 && now.strength <= 1);
    assert.ok(Math.hypot(next.toward[0] - now.toward[0], next.toward[1] - now.toward[1]) < 0.2, 'the wind swung too fast at ' + minute);
    assert.ok(Math.abs(next.strength - now.strength) < 0.12, 'the wind rose or fell too fast at ' + minute);
    count++; if (now.toward[0] > 0) east++;
  }
  assert.ok(east / count > 0.7, 'the wind should come mostly out of the west');
});

test('more cover brings more cloud, and an overcast sky throws no separate shadows', () => {
  const field = cloudField(7), area = cover => cloudsOver(field, cover, [0, 0], 0, 0, TILE, TILE)
    .flatMap(cloud => cloud.lobes).reduce((sum, [, , r]) => sum + r * r, 0);
  assert.equal(cloudsOver(field, 0, [0, 0], 0, 0, 160, 120).flatMap(cloud => cloud.lobes).every(([, , r]) => r < 6), true);
  assert.ok(area(0.3) > area(0.1) && area(0.6) > area(0.3) && area(0.9) > area(0.6));
  assert.equal(cloudShade(0), 0);
  assert.equal(cloudShade(0.4), 1);
  assert.equal(cloudShade(1), 0);
});

test('cloud that drifts off one side of the country comes on again at the other', () => {
  const field = cloudField(7), sorted = drift => cloudsOver(field, 0.5, drift, 0, 0, 160, 120)
    .flatMap(cloud => cloud.lobes).map(([x, y, r]) => [x, y, r].map(v => v.toFixed(3)).join(',')).sort();
  assert.deepEqual(sorted([13, 29]), sorted([13 + TILE, 29 - TILE]));
  assert.notDeepEqual(sorted([13, 29]), sorted([40, 29]));
});

test('a spot is under cloud at the middle of a lobe and in the open well clear of it', () => {
  const clouds = cloudsOver(cloudField(7), 0.5, [0, 0], 0, 0, TILE, TILE), [x, y, r] = clouds[0].lobes[0];
  assert.equal(cloudOverhead(clouds, x, y), 1);
  assert.equal(cloudOverhead([clouds[0]], x + 400, y), 0);
  const edge = cloudOverhead([{ lobes: [[x, y, r]] }], x + r, y);
  assert.ok(edge > 0 && edge < 1);
});
