import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from './engine/worldgen.mjs';
import { addFishingBank } from './engine/foraging.mjs';
import { heightAt, riverDistance, WATER_LEVEL } from './engine/terrain.mjs';
import { createAnglers, fishingStands } from './public/parish.js';

const map = generateMap(7);
addFishingBank(map);
const bank = map.places.find(p => p.kind === 'fishing');
const fishing = id => ({ id, action: { kind: 'work', job: 'fish', cast: true, phase: 'working', target: 'fishing-bank' } });
const landing = { x: bank.x, y: bank.y, moving: false, heading: 0 };

test('anglers stand on dry ground at the water, nearer it than the landing and apart from each other', () => {
  const stands = fishingStands(map, 3);
  assert.equal(stands.length, 3);
  for (const [x, y] of stands) {
    assert.ok(heightAt(map, x, y) > WATER_LEVEL, 'an angler stands in the water');
    assert.ok(riverDistance(map, x, y) < riverDistance(map, bank.x, bank.y), 'an angler stands no nearer the river than the landing');
    assert.ok(riverDistance(map, x, y) - map.terrain.riverWidth / 2 < 1.4, 'an angler stands back from the water');
  }
  for (let i = 1; i < 3; i++) assert.ok(Math.hypot(stands[i][0] - stands[i - 1][0], stands[i][1] - stands[i - 1][1]) > 0.7);
});

test('an angler walks from the landing to the water and back when the fishing is done', () => {
  const anglers = createAnglers(), [[sx, sy, facing]] = fishingStands(map, 1);
  anglers.begin(map, [fishing('a')], () => landing);
  const first = anglers.place('a', landing, 0.1);
  assert.ok(first.moving, 'the first steps are walked');
  let at = first;
  for (let i = 0; i < 60; i++) at = anglers.place('a', landing, 0.1);
  assert.ok(Math.hypot(at.x - sx, at.y - sy) < 1e-6);
  assert.equal(at.moving, false);
  assert.equal(at.heading, facing);
  anglers.begin(map, [{ id: 'a', action: { kind: 'rest', phase: 'working', target: 'cottage-1' } }], () => landing);
  for (let i = 0; i < 30; i++) at = anglers.place('a', landing, 0.1);
  assert.equal(at, landing, 'once back on the landing the resident is drawn where the engine has them');
});

test('residents who are not fishing are drawn where the engine has them', () => {
  const anglers = createAnglers(), here = { x: 10, y: 20, moving: false };
  anglers.begin(map, [{ id: 'b', action: { kind: 'work', job: 'cut', phase: 'working', target: 'wood' } }], () => here);
  assert.equal(anglers.place('b', here, 0.1), here);
});
