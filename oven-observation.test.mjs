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

test('a baker who recounts the same stores is not offered a third count within the hour', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  goHome(mabel, village);
  tick(village);
  const offered = () => availableActions(mabel, village).has('inspect:oven');
  // Each count runs to its end. The resident then waits to choose again, as in the live village.
  const count = () => {
    assert.ok(startChosen(mabel, village, 'inspect:oven', { id: String(village.world.minute), model: 'test' }));
    for (let n = 0; n < 200 && mabel.action.kind !== 'waiting'; n++) tick(village);
    assert.equal(mabel.action.kind, 'waiting');
  };
  Object.assign(village.world.supplies, { flour: 2, wood: 0 });
  count();
  assert.ok(offered(), 'one recount is still offered, as a requester checking on promised work would need');
  count();
  assert.equal(mabel.observations.ovenStores.recount, true);
  assert.equal(offered(), false, 'a third count of the same stores within the hour is not offered');
  // A count that finds the stores changed is news, and counting stays on offer.
  village.world.supplies.wood = 3;
  mabel.observations.ovenStores.recount = false;
  assert.ok(offered());
  // So is a count an hour later.
  mabel.observations.ovenStores.recount = true;
  mabel.observations.ovenStores.minute = village.world.minute - 60;
  assert.ok(offered());
});

test('a baker with a recent count can set out to bake from home, and finds a shortfall at the oven', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  Object.assign(village.world.supplies, { flour: 7, wood: 6 });
  tick(village);
  startChosen(mabel, village, 'inspect:oven', { id: '17', model: 'test' });
  for (let n = 0; n < 200 && mabel.action.kind !== 'waiting'; n++) tick(village);
  goHome(mabel, village);
  assert.ok(availableActions(mabel, village).has('work:bake:oven'), 'a count within three hours is enough to set out');
  village.world.supplies.wood = 0;
  assert.ok(startChosen(mabel, village, 'work:bake:oven', { id: '18', model: 'test' }));
  const events = [];
  for (let n = 0; n < 200 && mabel.action.kind !== 'waiting'; n++) events.push(...tick(village));
  assert.equal(events.find(e => e.type === 'work').outcome.status, 'blocked');
  assert.equal(mabel.observations.ovenStores.wood, 0);
  // An old count is not: she has to go and look first.
  goHome(mabel, village);
  Object.assign(village.world.supplies, { wood: 6 });
  Object.assign(mabel.observations.ovenStores, { wood: 6, minute: village.world.minute - 180 });
  assert.equal(availableActions(mabel, village).has('work:bake:oven'), false);
  assert.ok(availableActions(mabel, village).has('inspect:oven'));
});

test('others count the oven once a day unless a request they are party to is open', () => {
  const village = createVillage(), hugh = resident(village, 'hugh');
  tick(village);
  const offered = () => availableActions(hugh, village).has('inspect:oven');
  assert.ok(offered(), 'someone who has never counted it may');
  hugh.observations = { ovenStores: { source: 'oven inspection', site: 'oven', place: 'Common oven', minute: village.world.minute - 300, flour: 4, wood: 4 } };
  assert.equal(offered(), false);
  hugh.helpBook = { r1: { id: 'r1', askerId: 'hugh', helperId: 'oswin', status: 'accepted', item: 'wood',
    since: village.world.minute, due: village.world.minute + 600 } };
  assert.ok(offered(), 'a requester checks on promised work');
  hugh.helpBook.r1.status = 'kept';
  assert.equal(offered(), false);
  hugh.observations.ovenStores.minute = village.world.minute - 1440;
  assert.ok(offered(), 'a day-old count may be renewed');
});
