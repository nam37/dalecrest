import test from 'node:test';
import assert from 'node:assert/strict';
import { daylight } from './engine/seasons.mjs';
import { dialAt } from './public/clock-dial.js';

const DAY = 1440;

test('the sun rides the dial from sunrise to sunset and the moon from sunset to sunrise', () => {
  for (const day of [0, 60, 142, 240, 325]) {
    const start = day * DAY, { sunrise, sunset } = daylight(start);
    const noon = dialAt(start + 720);
    assert.equal(noon.up, true);
    assert.ok(Math.abs(noon.along - 0.5) < 0.001);
    assert.ok(dialAt(start + Math.ceil(sunrise)).along < 0.01);
    assert.ok(dialAt(start + Math.floor(sunset)).along > 0.99);
    // The moon is half way over at midnight, whichever side of it the minute falls.
    for (const minute of [start, start + DAY - 1]) {
      const night = dialAt(minute);
      assert.equal(night.up, false);
      assert.ok(Math.abs(night.along - 0.5) < 0.01);
    }
    // It rises as the sun sets and has all but set when the sun comes up again.
    assert.ok(dialAt(start + Math.floor(sunset) + 1).along < 0.01);
    assert.ok(dialAt(start + Math.ceil(sunrise) - 1).along > 0.99);
    // Whatever is up never leaves the arc.
    for (let minute = start; minute < start + DAY; minute += 7) {
      const { along, long } = dialAt(minute);
      assert.ok(along >= 0 && along <= 1 && long >= 0 && long <= 1);
    }
  }
});

test('the arc stands tall for the long half of the day and low for the short', () => {
  const summer = 325 * DAY, winter = 142 * DAY;
  assert.ok(dialAt(summer + 720).long > 0.9);
  assert.ok(dialAt(summer).long < 0.1);
  assert.ok(dialAt(winter + 720).long < 0.1);
  assert.ok(dialAt(winter).long > 0.9);
});
