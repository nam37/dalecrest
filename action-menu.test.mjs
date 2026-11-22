import test from 'node:test';
import assert from 'node:assert/strict';
import { actionBody } from './decisions.mjs';
import { startChosenAction } from './action-turns.mjs';
import { shapeActionMenu } from './engine/action-menu.mjs';
import { place } from './engine/roads.mjs';
import { consider, keep } from './engine/standing.mjs';
import { availableActions, createVillage, locationsOf, startChosen, stepVillage } from './sim.mjs';

function moveTo(village, actor, target) {
  const [x, y] = place(village.map, target).at;
  actor.position = { x, y };
  actor.action = { kind: 'leisure', target, phase: 'working', remaining: 100, label: 'Passing time' };
}

function freshMenu(actor, village) {
  const diagnostics = {};
  const feasible = availableActions(actor, village, diagnostics);
  return { feasible, ...shapeActionMenu(actor, village, feasible, diagnostics.ownTrade) };
}

test('the curated menu preserves a real trade and preferred outing, with a bounded social shortlist', () => {
  const village = createVillage();
  village.world.minute = 720;
  village.world.supplies.water = 0;
  const actor = village.actors.find(a => a.id === 'alice');
  moveTo(village, actor, 'green');
  moveTo(village, village.actors.find(a => a.id === 'edith'), 'green');
  actor.observations = { ovenStores: { site: 'oven', place: 'Common oven', wood: 10, flour: 10, minute: 680 } };
  const { menu, feasible, audit, context } = freshMenu(actor, village);
  assert.ok(feasible.size > 12);
  assert.equal(menu.size, 12);
  assert.equal(audit.feasible, menu.size + audit.omitted.length);
  assert.equal(audit.protected['work:draw:well'], 'own_trade');
  assert.equal(audit.protected['work:fish:fishing-bank'], 'preferred_outing');
  assert.ok(menu.has('leisure:company:green'));
  assert.ok(!menu.has('leisure:green') && feasible.has('leisure:green'));
  assert.ok([...menu.keys()].filter(id => id.startsWith('social:')).length <= 4);
  assert.ok([...menu.keys()].filter(id => id.startsWith('share:')).length <= 2);
  assert.ok(audit.omitted.some(({ reason }) => reason === 'news_audience'));
  assert.ok(audit.omitted.some(({ reason }) => reason === 'visit_limit'));
  assert.deepEqual(context.nearbyCompany, [{ place: 'Village green', people: ['Edith Vale'] }]);
  assert.ok(audit.omitted.every(({ id }) => !Object.hasOwn(audit.protected, id)));
});

test('the target yields to protected requests, receipts, a due meal, sleep and the moot', () => {
  const village = createVillage(), [actor] = village.actors;
  village.world.minute = 1320;
  actor.needs.hunger = 75;
  const requests = Array.from({ length: 13 }, (_, n) => ['reply:' + n, {
    kind: 'conversation', verb: 'accept', requestId: 'request-' + n,
  }]);
  const feasible = new Map([...requests,
    ['receipt', { kind: 'conversation', verb: 'share', fact: { kept: true, requestId: 'paid' } }],
    ['food', { kind: 'food' }], ['rest', { kind: 'rest' }], ['moot', { kind: 'meeting' }],
    ['walk', { kind: 'leisure' }],
  ]);
  const { menu, audit } = shapeActionMenu(actor, village, feasible);
  assert.equal(menu.size, 17);
  assert.equal(Object.keys(audit.protected).length, menu.size);
  assert.deepEqual(audit.omitted, [{ id: 'walk', reason: 'menu_target', kind: 'leisure' }]);
});

test('a named visit pruned from a fresh menu can still continue or be accepted from an earlier offer', async () => {
  const village = createVillage(), [actor] = village.actors;
  village.world.minute = 720;
  const { feasible, audit } = freshMenu(actor, village);
  const omitted = audit.omitted.find(row => row.reason === 'visit_limit').id;
  const visit = feasible.get(omitted);
  keep(actor, village, visit, '3');
  assert.equal(consider(actor, village, feasible, visit).follow.id, omitted);

  actor.action = { kind: 'waiting', since: village.world.minute, target: actor.home, previous: visit };
  const trace = { id: '4', actor_id: actor.id, decision_since: village.world.minute,
    request_body: actionBody(actor, village.world, new Map([[omitted, visit]]), locationsOf(village.map, village.actors)) };
  const db = { query: async () => ({ rows: [] }) };
  assert.equal((await startChosenAction(db, trace, 'leisure:green', village, async () => [])).status, 'unavailable');
  assert.equal((await startChosenAction(db, trace, omitted, village, async () => [{ id: '1' }])).status, 'applied');
  assert.equal(actor.action.choiceId, omitted);
});

test('company by place meets whoever is there and works when the plaza has emptied', () => {
  const village = createVillage(), [actor, other] = village.actors;
  village.world.minute = 720;
  moveTo(village, actor, 'green');
  moveTo(village, other, 'green');
  actor.action = { kind: 'waiting', since: 720, target: 'green' };
  assert.ok(startChosen(actor, village, 'leisure:company:green', { id: '5' }));
  const events = stepVillage(village, { externalActions: true, minutes: 1 });
  assert.ok(events.some(e => e.actorIds.includes(actor.id) && e.actorIds.includes(other.id)));
  moveTo(village, other, 'mill');
  actor.action = { kind: 'waiting', since: 721, target: 'green' };
  const { menu, context } = freshMenu(actor, village);
  assert.ok(menu.has('leisure:company:green'));
  assert.equal(context.nearbyCompany, undefined);
  assert.ok(startChosen(actor, village, 'leisure:company:green', { id: '6' }));
  assert.ok(!stepVillage(village, { externalActions: true, minutes: 1 }).some(e => e.actorIds.includes(actor.id)));
});

test('a trade that needs a first-hand oven count says so without disclosing the hidden reserve', () => {
  const village = createVillage(), actor = village.actors.find(a => a.id === 'mabel');
  village.world.minute = 720;
  moveTo(village, actor, 'green');
  const { menu, audit, context } = freshMenu(actor, village);
  assert.deepEqual(audit.ownTrade, { job: 'bake', status: 'oven_check' });
  assert.match(context.ownTrade, /check its flour and firewood/);
  assert.equal(audit.protected['inspect:oven'], 'oven_check');
  village.world.supplies.wood = 0;
  village.world.supplies.flour = 0;
  assert.deepEqual(freshMenu(actor, village).context, context);
  assert.deepEqual([...freshMenu(actor, village).menu.keys()], [...menu.keys()]);
  village.world.minute = 5 * 1440 + 720;
  assert.equal(freshMenu(actor, village).audit.ownTrade.status, 'rest_day');
});
