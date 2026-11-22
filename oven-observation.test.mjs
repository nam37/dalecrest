import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, availableActions, locationsOf, startChosen } from './sim.mjs';
import { actionBody } from './decisions.mjs';
import { remember } from './engine/civic.mjs';

const tick = village => stepVillage(village, { externalActions: true, minutes: 1 });
const resident = (village, id) => village.actors.find(a => a.id === id);
function request(actor, village) {
  return actionBody(actor, village.world, availableActions(actor, village), locationsOf(village.map, village.actors));
}
function goHome(actor, village) {
  const at = village.map.places.find(p => p.id === actor.home).at;
  actor.position = { x: at[0], y: at[1] };
}

test('unseen flour and wood cannot change the request, including job order and civic work', () => {
  const village = createVillage();
  tick(village);
  village.world.projects.push({ id: 'hall', kind: 'cottage', used: 0, wood: 3, done: 1, need: 8, backers: [], since: 420 });
  for (const actor of village.actors) goHome(actor, village);
  for (const id of ['mabel', 'oswin', 'hugh']) {
    const actor = resident(village, id);
    Object.assign(village.world.supplies, { flour: 0, wood: 0 });
    const empty = request(actor, village);
    Object.assign(village.world.supplies, { flour: village.world.capacity.flour, wood: village.world.capacity.wood });
    assert.equal(request(actor, village), empty);
    const body = JSON.parse(empty);
    const data = body.input[0].content[0].data;
    assert.equal(data.lastOvenCheck, null);
    assert.equal('stores' in data, false);
    assert.ok(body.questions[0].choices.some(c => c.value === 'inspect:oven'));
    assert.ok(!body.questions[0].choices.some(c => c.value.startsWith('work:bake:')));
  }
});

test('inspection reads on site, survives ordinary memories and prompts a new decision', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  goHome(mabel, village);
  tick(village);
  assert.ok(startChosen(mabel, village, 'inspect:oven', { id: '12', model: 'test' }));
  assert.equal(mabel.observations, undefined);
  assert.deepEqual(mabel.instructions || {}, {});
  for (let n = 0; n < 100 && mabel.action.phase === 'travelling'; n++) {
    assert.ok(!tick(village).some(e => e.type === 'observation'));
  }
  assert.equal(mabel.action.phase, 'working');
  assert.equal(mabel.observations, undefined);
  Object.assign(village.world.supplies, { flour: 7, wood: 0 });
  const resumed = JSON.parse(JSON.stringify(village));
  const events = stepVillage(resumed, { minutes: 2, externalActions: true });
  const actor = resident(resumed, 'mabel'), seen = actor.observations.ovenStores;
  assert.deepEqual(seen, { source: 'oven inspection', site: 'oven', place: 'Common oven', minute: resumed.world.minute, flour: 7, wood: 0 });
  assert.equal(actor.action.kind, 'waiting');
  assert.equal(actor.action.why, 'checked the oven stores');
  assert.ok(!availableActions(actor, resumed).has('work:bake:oven'));
  assert.deepEqual(events.filter(e => e.type === 'observation').map(e => e.actorIds), [['mabel']]);
  const memory = actor.memories.find(m => m.kind === 'observation');
  assert.deepEqual(memory.observation, seen);

  goHome(actor, resumed);
  // Weightier memories crowd the oven count out of memory. The count itself is kept apart and survives.
  for (let i = 0; i < 70; i++) remember(actor, resumed.world.minute, 'Another weighty event.', [actor.id], 'social', { importance: 9 });
  assert.ok(!actor.memories.some(m => m.kind === 'observation'));
  resumed.world.minute += 45;
  const before = request(actor, resumed);
  Object.assign(resumed.world.supplies, { flour: 1, wood: 24 });
  assert.equal(request(actor, resumed), before);
  const data = JSON.parse(before).input[0].content[0].data;
  assert.deepEqual([data.lastOvenCheck.flour, data.lastOvenCheck.wood, data.lastOvenCheck.minutesAgo], [7, 0, 45]);
  assert.equal(JSON.parse(request(resident(resumed, 'oswin'), resumed)).input[0].content[0].data.lastOvenCheck, null);
  assert.ok(startChosen(actor, resumed, 'inspect:oven', { id: '13', model: 'test' }));
  for (let i = 0; i < 100 && actor.action.kind === 'inspect'; i++) tick(resumed);
  assert.deepEqual([actor.observations.ovenStores.flour, actor.observations.ovenStores.wood], [1, 24]);
  assert.ok(actor.observations.ovenStores.minute > seen.minute);
});

test('a moot that interrupts the check leaves no invented sighting', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  tick(village);
  startChosen(mabel, village, 'inspect:oven', { id: '14', model: 'test' });
  village.world.moot = { at: village.world.minute + 36, tries: 0 };
  const events = tick(village);
  assert.equal(mabel.action.kind, 'waiting');
  assert.equal(mabel.observations, undefined);
  assert.ok(!events.some(e => e.type === 'observation'));
});

test('a stale reading still permits a baking attempt, and Mabel discovers missing wood at the oven', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  Object.assign(village.world.supplies, { flour: 7, wood: 2 });
  tick(village);
  startChosen(mabel, village, 'inspect:oven', { id: '15', model: 'test' });
  stepVillage(village, { minutes: 3, externalActions: true });
  const before = request(mabel, village), bread = village.world.supplies.bread;
  village.world.supplies.wood = 0;
  assert.equal(request(mabel, village), before);
  assert.ok(startChosen(mabel, village, 'work:bake:oven', { id: '16', model: 'test' }));
  const events = tick(village);
  assert.equal(events.find(e => e.type === 'work').outcome.status, 'blocked');
  assert.equal(village.world.supplies.bread, bread);
  assert.equal(mabel.observations.ovenStores.wood, 0);
  assert.equal(mabel.action.why, 'checked the oven stores');
  assert.ok(!availableActions(mabel, village).has('work:bake:oven'));
});
