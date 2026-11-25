import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { ballotOffers, recordBallot, tick, labour } from './engine/civic.mjs';
import { issueAllowance } from './engine/storehouse.mjs';
import { place, route, walkingSegment } from './engine/roads.mjs';

const run = state => tick(state, () => {}, () => 0.43, undefined, { externalBallots: true });
function meeting(agenda, attendance = 4) {
  const state = createVillage(), { world, actors } = state;
  for (const kind of [agenda].flat()) world.proposals.push({ key: kind, kind, by: actors[0].id, since: world.minute,
    supporters: actors.slice(0, 4).map(a => a.id), heard: [] });
  world.moot = { at: world.minute, tries: 0 };
  for (const actor of actors.slice(0, attendance)) {
    const [x, y] = place(state.map, 'hall').at;
    actor.position = { x, y };
    actor.action = { kind: 'meeting', target: 'hall', phase: 'working', remaining: 50 };
  }
  run(state);
  return state;
}

function cast(state, index, choice) {
  const actor = state.actors[index];
  const offer = ballotOffers(actor, state).find(o => o.choice === choice);
  assert.ok(offer);
  const receipt = recordBallot(actor, state, offer, { traceId: index + 21, source: 'decisions' });
  assert.ok(receipt);
  assert.equal(recordBallot(actor, state, offer, receipt.trace), null);
  return receipt;
}
function close(state, elapsed = 40) {
  state.world.minute = state.world.moot.at + elapsed;
  run(state);
  return state.world.mootHistory?.at(-1);
}

function beforeMoot() {
  const village = createVillage(26111), { actors: [actor], world, map } = village;
  const [x, y] = place(map, 'wood').at;
  actor.position = { x, y };
  world.moot = { at: 1110, tries: 0 };
  world.minute = world.moot.at - 37;
  actor.action = { kind: 'waiting', label: 'Choosing the next activity', target: 'wood', phase: 'waiting', remaining: 0, since: world.minute };
  return { village, actor, world, map };
}

test('the call to the moot lets residents already travelling to the hall finish the walk', () => {
  const { village, actor, world } = beforeMoot();
  assert.ok(startChosen(actor, village, 'meeting:hall', { id: 'early' }));
  stepVillage(village, { minutes: 2, externalActions: true });
  assert.equal(actor.action.kind, 'meeting');
  assert.equal(actor.action.phase, 'travelling');
  stepVillage(village, { minutes: world.moot.at - world.minute, externalActions: true });
  assert.ok(world.moot.attendees.includes(actor.id));
});

test('the last feasible departure is enrolled and a later reply cannot start the trip', () => {
  const { village, actor, world, map } = beforeMoot();
  const path = route(map, [actor.position.x, actor.position.y], 'hall').pts;
  let walk = 1;
  while (walkingSegment(actor, path, walk).passed < path.length) walk++;
  assert.ok(walk > 15, 'the coppice is too far from the hall to use the entire invitation window');
  const attendanceCloses = world.moot.at + 40;
  world.minute = attendanceCloses - walk - 1;
  actor.action.since = world.minute;
  assert.ok(availableActions(actor, village).has('meeting:hall'));

  const late = structuredClone(village);
  late.world.minute++;
  assert.equal(availableActions(late.actors[0], late).has('meeting:hall'), false);
  assert.equal(startChosen(late.actors[0], late, 'meeting:hall', { id: 'late' }), null);
  const [x, y] = place(late.map, 'hall').at;
  late.actors[1].position = { x, y };
  assert.ok(availableActions(late.actors[1], late).has('meeting:hall'));

  assert.ok(startChosen(actor, village, 'meeting:hall', { id: 'in-time' }));
  stepVillage(village, { minutes: walk + 1, externalActions: true });
  const result = world.mootHistory.at(-1);
  assert.equal(result.closedAt, attendanceCloses);
  assert.ok(result.attendees.includes(actor.id));
});

test('moots are called for seven with at least ninety minutes of notice', () => {
  for (const [minute, scheduled] of [[17 * 60 + 20, 19 * 60], [17 * 60 + 40, 1440 + 19 * 60]]) {
    const village = createVillage(), { world, actors } = village;
    world.minute = minute;
    world.proposals.push({ key: 'field', kind: 'field', by: actors[0].id, since: minute,
      supporters: actors.slice(0, 4).map(a => a.id), heard: [] });
    run(village);
    assert.deepEqual(world.moot, { at: scheduled, tries: 0 });
  }
});

test('an enacted allowance changes dawn issues for cottages and lodgers and leaves issued bread alone', () => {
  const state = meeting('allowance');
  const { world, actors } = state;
  assert.deepEqual(ballotOffers(actors[4], state), []);
  const first = cast(state, 0, 'support');
  const restored = JSON.parse(JSON.stringify(state));
  for (const village of [state, restored]) {
    ['support', 'support', 'oppose'].forEach((choice, i) => cast(village, i + 1, choice));
    const result = close(village);
    assert.deepEqual(result.ballots[0], first);
    assert.equal(result.items[0].status, 'enacted');
    assert.equal(result.items[0].oppose, 1);
    assert.equal(village.world.bylaws.allowance.mootId, result.id);
  }
  assert.deepEqual(restored, state);
  const cottage = world.cottages[actors[0].home];
  assert.equal(cottage.ration, 1.25);
  actors[4].home = 'hall';
  actors[4].ration = 0;
  issueAllowance(state);
  assert.equal(cottage.ration, 2.75);
  assert.equal(actors[4].ration, 1.5);
});

test('the tally distinguishes opposition, abstention, an absent voter and an unreturned ballot', () => {
  for (const [choices, status, reason] of [
    [['oppose', 'support', 'oppose', 'oppose'], 'rejected', undefined],
    [['support', 'support', 'oppose', 'abstain'], 'postponed', 'no majority'],
    [['support', 'support', 'support'], 'postponed', 'ballots outstanding'],
  ]) {
    const state = meeting('field');
    choices.forEach((choice, i) => cast(state, i, choice));
    const missing = choices.length === 3;
    if (missing) assert.equal(close(state), undefined);
    const result = close(state, missing ? 100 : 40);
    assert.equal(result.ballots.length, choices.length);
    assert.equal(result.attendees.length, 4);
    assert.equal(result.items[0].missing, Number(missing));
    assert.equal(result.items[0].abstain, choices.filter(c => c === 'abstain').length);
    assert.equal(result.items[0].status, status);
    assert.equal(result.items[0].reason, reason);
    assert.equal(state.world.projects.length, 0);
  }
  const state = meeting('field', 2);
  cast(state, 0, 'support');
  cast(state, 1, 'support');
  const result = close(state);
  assert.equal(result.items[0].reason, 'too few attended');
  assert.deepEqual(state.world.moot, { at: 1440 + 19 * 60, tries: 1 });
});

test('an agreed well still costs wood, one bundle per shift, and increases capacity only when finished', () => {
  const state = meeting('well'), { world, actors } = state;
  actors.slice(0, 4).forEach((_, i) => cast(state, i, 'support'));
  const item = close(state).items[0];
  assert.equal(item.status, 'agreed');
  const water = world.capacity.water, site = place(state.map, item.projectId);
  world.supplies.wood = 0;
  actors[0].action = { job: 'build', target: site.id, phase: 'working' };
  labour(actors[0], state, () => {});
  assert.equal(world.projects[0].done, 0);
  world.supplies.wood = 5;
  for (let shift = 0; shift < 14; shift++) labour(actors[0], state, () => {});
  assert.equal(world.supplies.wood, 1);
  assert.equal(world.capacity.water, water + 16);
  assert.equal(site.stage, 2);
});

test('two supported works compete for the last building crew while a bylaw can still pass', () => {
  const state = meeting(['well', 'field', 'allowance']);
  for (const [i, voter] of state.actors.slice(0, 4).entries()) {
    for (const key of ['well', 'field', 'allowance']) {
      assert.equal(ballotOffers(voter, state)[0].proposalKey, key);
      cast(state, i, 'support');
    }
    assert.deepEqual(ballotOffers(voter, state), []);
  }
  const result = close(state);
  assert.deepEqual(result.items.map(item => item.status), ['agreed', 'postponed', 'enacted']);
  assert.equal(result.items[1].reason, 'all building crews committed');
  assert.equal(result.ballots.length, 12);
  assert.deepEqual(state.world.proposals.map(p => p.key), ['field']);
});
