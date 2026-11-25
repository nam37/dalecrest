import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage } from './sim.mjs';
import { appearanceOf } from './engine/appearance.mjs';

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

test('old residents get stable appearance data and saved choices survive a roster change', () => {
  const village = createVillage();
  const [agnes, hugh] = village.actors;
  const original = structuredClone(agnes.appearance);
  const custom = { ...hugh.appearance, headwear: 'cap' };
  hugh.appearance = custom;
  delete agnes.appearance;
  assert.deepEqual(appearanceOf(agnes), original);

  const restored = JSON.parse(JSON.stringify(village));
  restored.actors.reverse();
  restored.actors = restored.actors.filter(actor => actor.id !== 'mabel');
  stepVillage(restored, { minutes: 0 });

  assert.deepEqual(restored.actors.find(actor => actor.id === 'agnes').appearance, original);
  assert.deepEqual(restored.actors.find(actor => actor.id === 'hugh').appearance, custom);
  assert.notEqual(appearanceOf({ id: 'mabel', arrived: 4400 }).seed, village.actors[2].appearance.seed);
});
