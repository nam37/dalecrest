import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage } from './sim.mjs';

test('a JSON snapshot resumes the same village, including its memories and events', () => {
  const original = createVillage();
  stepVillage(original, { minutes: 150 });
  const restored = JSON.parse(JSON.stringify(original));
  const expected = stepVillage(original, { minutes: 720 });
  const actual = [];
  for (let i = 0; i < 240; i++) actual.push(...stepVillage(restored, { minutes: 3 }));
  assert.deepEqual(restored, original);
  assert.deepEqual(actual, expected);
  assert.ok(original.actors.some(a => a.memories.some(m => m.kind === 'social')));
});

test('a resident’s persisted desire changes their choice', () => {
  const world = createVillage();
  world.actors[0].needs.fatigue = 50;
  const edited = structuredClone(world);
  edited.actors[0].desires.push({ id: 'recover', label: 'Rest after the harvest', focus: 'rest', weight: 40 });
  stepVillage(world, { minutes: 1 });
  stepVillage(edited, { minutes: 1 });
  assert.equal(world.actors[0].action.kind, 'work');
  assert.equal(edited.actors[0].action.kind, 'rest');
});
