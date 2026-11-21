import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotion } from './public/motion.js';
import { createVillage, stepVillage } from './sim.mjs';

test('Oswin starts walking on the first live snapshot and follows the clock all the way home', () => {
  const village = createVillage();
  const oswin = village.actors.find(a => a.id === 'oswin');
  const oven = village.map.places.find(p => p.id === 'oven');
  const cottage = village.map.places.find(p => p.id === oswin.home);
  oswin.position = { x: oven.at[0], y: oven.at[1] };
  oswin.action = { kind: 'rest', target: cottage.id, label: 'Sleeping at home', phase: 'travelling', remaining: 105 };
  const motion = createMotion();
  const position = time => {
    const { x, y } = motion.at(oswin.id, time);
    return [x, y];
  };
  const ms = 30000;
  for (let n = 0; n < 100 && oswin.action.phase === 'travelling'; n++) {
    const now = n * ms, tick = { map: village.map, minute: village.world.minute, minutes: 1, ms, endsAt: now + ms };
    const snapshot = structuredClone(oswin);
    motion.update([oswin], now, ms, tick);
    const start = position(now), halfway = position(now + ms / 2);
    assert.notDeepEqual(halfway, start);
    motion.update([structuredClone(oswin)], now + ms / 2, ms / 2, tick);
    assert.deepEqual(position(now + ms / 2), halfway);
    assert.notDeepEqual(position(now + ms * 0.75), halfway);
    assert.deepEqual(oswin, snapshot);
    stepVillage(village, { minutes: 1, externalActions: true });
    const endpoint = [oswin.position.x, oswin.position.y];
    assert.ok(Math.hypot(...position(now + ms).map((v, i) => v - endpoint[i])) < 1e-8);
    assert.deepEqual(position(now + ms * 2), position(now + ms));
  }
  assert.equal(oswin.action.phase, 'working');
  assert.deepEqual([oswin.position.x, oswin.position.y], cottage.at);
});

test('joining mid-tick follows corners and a paused snapshot stays still', () => {
  const actor = { id: 'walker', traits: [], position: { x: 0, y: 0 },
    action: { phase: 'travelling', remaining: 15, target: 'home', path: [[0, 1], [5, 1]] } };
  const tick = { minute: 1, minutes: 1, ms: 30000, endsAt: 30000 };
  const motion = createMotion();
  motion.update([actor], 10000, 20000, tick);
  assert.equal(motion.at(actor.id, 10000).x, 0);
  assert.ok(motion.at(actor.id, 10000).y > 0);
  assert.ok(motion.at(actor.id, 20000).x > 0);
  assert.equal(motion.at(actor.id, 20000).y, 1);
  motion.update([actor], 20000, 0, tick);
  assert.equal(motion.at(actor.id, 45000).moving, false);
  motion.update([actor], 22000, 8000, tick);
  assert.ok(motion.at(actor.id, 22000).moving);
  actor.action = { phase: 'waiting', target: 'home', remaining: 0 };
  motion.update([actor], 24000, 6000, tick);
  assert.equal(motion.at(actor.id, 29000).moving, false);
  assert.deepEqual([motion.at(actor.id, 29000).x, motion.at(actor.id, 29000).y], [0, 0]);
});
