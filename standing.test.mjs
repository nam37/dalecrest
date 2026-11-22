// The model-driven path, exercised with scripted choices so every branch runs without a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, availableActions, startChosen, locationsOf } from './sim.mjs';
import { consider, keep, PILOT } from './engine/standing.mjs';
import { actionBody } from './decisions.mjs';
import { placesOf } from './engine/roads.mjs';

const isNight = minute => { const t = minute % 1440; return t >= 1260 || t < 340; };

// A stand-in for the Decisions API: it answers a waiting resident after a delay, from the real menu.
function sensible(actor, village, menu) {
  const ids = [...menu.keys()], pick = prefix => ids.find(id => id.startsWith(prefix));
  return pick('meeting:') || (actor.needs.hunger > 55 && pick('food:')) || (isNight(village.world.minute) && pick('rest:'))
    || pick('work:build:') || pick('work:' + actor.trade + ':')
    || (actor.trade === 'bake' && (!actor.observations?.ovenStores || village.world.minute - actor.observations.ovenStores.minute >= 180) && pick('inspect:'))
    || pick('leisure:');
}
function run(village, minutes, policy, latency = 3) {
  const records = [], events = [];
  let traces = village.traces || 0;
  for (let i = 0; i < minutes; i++) {
    events.push(...stepVillage(village, { minutes: 1, externalActions: true, records }));
    for (const actor of village.actors) {
      if (actor.action.kind !== 'waiting' || village.world.minute - actor.action.since < latency) continue;
      const id = policy(actor, village, availableActions(actor, village));
      const started = id && startChosen(actor, village, id, { id: String(++traces), model: 'script' });
      if (started) records.push({ actorId: actor.id, minute: village.world.minute, basis: 'fresh', routine: started.routine, reason: started.why, waited: started.waited });
    }
  }
  village.traces = traces;
  return { records, events };
}
const count = (records, basis, routine) => records.filter(r => r.basis === basis && (!routine || r.routine === routine)).length;

test('decision wording describes the resident before and after choosing, including saved activities', () => {
  const village = createVillage(), actor = village.actors[0];
  actor.action = { kind: 'food', phase: 'working', label: 'Taking a loaf at the oven', target: 'oven', remaining: 1 };
  stepVillage(village, { minutes: 1, externalActions: true });
  assert.equal(actor.action.reason, 'Will decide after taking a loaf at the oven.');

  actor.action.reason = 'Waiting for a decision from gpt-6-luna.';
  stepVillage(village, { minutes: 0 });
  assert.equal(actor.action.reason, 'Will decide after taking a loaf at the oven.');
  startChosen(actor, village, 'leisure:green', { id: '7', model: 'test-provider' });
  assert.equal(actor.action.reason, 'Chose this after taking a loaf at the oven.');

  actor.action.reason = 'Selected by test-provider after Visiting Oswin Holt.';
  stepVillage(village, { minutes: 0 });
  assert.equal(actor.action.reason, 'Chose this after visiting Oswin Holt.');
  assert.equal(actor.action.decisionTraceId, '7');
});

test('village time passes when no decision ever arrives', () => {
  const village = createVillage(), start = village.world.minute;
  const { records } = run(village, 2880, () => null);
  assert.equal(village.world.minute, start + 2880);
  assert.ok(village.actors.every(a => a.action.kind === 'waiting' && a.action.why === 'no instruction applies'));
  assert.equal(count(records, 'waiting'), village.actors.length);
  assert.equal(count(records, 'standing') + count(records, 'fresh'), 0);
  assert.ok(village.actors.every(a => a.needs.hunger > 90), 'needs kept rising while they waited');
});

test('routine follows a standing instruction and every activity records how it began', () => {
  const village = createVillage();
  const { records } = run(village, 4 * 1440, sensible);
  const fresh = count(records, 'fresh'), standing = count(records, 'standing');
  assert.ok(fresh > 0 && standing > fresh, 'most boundaries were routine: ' + standing + ' standing, ' + fresh + ' fresh');
  // A night's sleep is one decision, renewed every other day, however many stretches it takes.
  for (const actor of village.actors) {
    const mine = records.filter(r => r.actorId === actor.id);
    assert.ok(count(mine, 'fresh', 'sleep') <= 3, actor.name + ' was asked about sleep ' + count(mine, 'fresh', 'sleep') + ' times');
    assert.ok(count(mine, 'standing', 'sleep') > count(mine, 'fresh', 'sleep'));
  }
  for (const actor of village.actors) {
    if (actor.action.kind !== 'waiting') assert.ok(['fresh', 'standing'].includes(actor.action.basis?.kind), actor.name + ' has no recorded basis');
  }
  assert.ok(records.filter(r => r.basis === 'waiting').every(r => r.reason));
});

test('a stale instruction is dropped with its reason and never followed', () => {
  for (const [spoil, reason] of [[ins => { ins.until = 0; }, 'lapsed'], [(ins, actor) => { actor.goals = ['Something else entirely']; }, 'goals changed']]) {
    const village = createVillage(), actor = village.actors[0], records = [];
    village.world.minute = 1440 + 1300;
    const sleep = [...availableActions(actor, village)].find(([id]) => id.startsWith('rest:'))[1];
    spoil(keep(actor, village, sleep, '41'), actor);
    actor.action = { ...sleep, phase: 'working', remaining: 1 };
    stepVillage(village, { minutes: 2, externalActions: true, records });
    assert.equal(actor.action.kind, 'waiting');
    assert.equal(actor.action.why, 'instruction ' + reason);
    assert.deepEqual(records.find(r => r.basis === 'instruction_ended' && r.actorId === actor.id), { actorId: actor.id, minute: village.world.minute - 1, basis: 'instruction_ended', routine: 'sleep', reason, traceId: '41' });
    assert.equal(actor.instructions.sleep, undefined);
  }
});

test('a routine that would cost the resident something becomes a choice', () => {
  const village = createVillage(), actor = village.actors[0];
  village.world.minute = 1440 + 600;
  const menu = () => availableActions(actor, village);
  const walk = menu().get('leisure:green');
  keep(actor, village, walk, '7');
  assert.equal(consider(actor, village, menu(), walk).follow.routine, 'again:leisure:green');
  // A moot falls due within the walk.
  village.world.moot = { at: village.world.minute + 60, tries: 0 };
  assert.equal(consider(actor, village, menu(), walk).fresh, 'would run into the moot');
  village.world.moot = null;
  // Two urgent needs at once.
  Object.assign(actor.needs, { hunger: 80, fatigue: 75 });
  keep(actor, village, menu().get('food:oven'), '8');
  assert.equal(consider(actor, village, menu(), walk).fresh, 'two urgent needs');
  Object.assign(actor.needs, { hunger: 20, fatigue: 20 });
  // News the resident had not heard since they last chose.
  actor.decidedAt = village.world.minute - 30;
  actor.memories.push({ minute: village.world.minute - 5, text: 'Heard the well is failing.', actorIds: [actor.id], kind: 'social', concern: 'well' });
  assert.equal(consider(actor, village, menu(), walk).fresh, 'learned something new');
  actor.decidedAt = village.world.minute;
  assert.ok(consider(actor, village, menu(), walk).follow);
  // The instructed action can no longer be started.
  actor.needs.hunger = 60;
  village.world.supplies.bread = 0;
  assert.equal(consider(actor, village, menu(), walk).fresh, 'instructed action cannot start');
  // An activity repeated often enough on one instruction goes back to the model.
  actor.needs.hunger = 20;
  actor.instructions['again:leisure:green'].uses = PILOT.repeats;
  assert.equal(consider(actor, village, menu(), walk).fresh, 'instruction ran its course');
});

test('a reply that arrives after the resident has moved on is not applied', () => {
  const village = createVillage(), actor = village.actors[0];
  // Last night the resident chose to sleep. It is now five minutes before the next nightfall.
  village.world.minute = 1440 + 1300;
  keep(actor, village, [...availableActions(actor, village)].find(([id]) => id.startsWith('rest:'))[1], '3');
  village.world.minute = 2880 + 1255;
  actor.action = { kind: 'leisure', label: 'Walking on the green', target: 'green', phase: 'working', remaining: 1 };
  stepVillage(village, { minutes: 2, externalActions: true });
  assert.equal(actor.action.kind, 'waiting', 'an evening with no instruction for it is a choice');
  const asked = [...availableActions(actor, village).keys()].find(id => id.startsWith('leisure:'));
  stepVillage(village, { minutes: 8, externalActions: true });
  assert.equal(actor.action.basis.kind, 'standing', 'nightfall sent them to bed on the standing instruction');
  assert.equal(actor.action.basis.routine, 'sleep');
  assert.ok(actor.action.basis.waited > 0);
  assert.equal(startChosen(actor, village, asked, { id: '9', model: 'script' }), null);
  assert.equal(actor.action.kind, 'rest');
});

test('a promise reserves time for the route and named shift before repeating a routine', () => {
  const v = createVillage(), helper = v.actors.find(a => a.id === 'oswin');
  v.world.minute = 720;
  const r = { id: 'winter-wood', askerId: 'mabel', asker: 'Mabel Ash', helperId: helper.id, helper: helper.name,
    item: 'wood', job: 'cut', terms: 'stack three bundles of firewood', quantity: 3, status: 'accepted', due: 2300 };
  helper.helpBook = { [r.id]: r };
  const menu = availableActions(helper, v);
  const sleep = [...menu.values()].find(a => a.kind === 'rest');
  keep(helper, v, sleep, '11');
  const verdict = () => consider(helper, v, menu, sleep, { ...PILOT, lookahead: 0 });
  assert.equal(verdict().follow.action.kind, 'rest');
  const promised = [...menu.values()].find(a => a.commitmentId === r.id);
  assert.ok(promised);
  r.due = v.world.minute + sleep.remaining + promised.remaining;
  assert.match(verdict().fresh, /promise to Mabel Ash/);
  helper.action = { ...sleep, remaining: 1, phase: 'working' };
  stepVillage(v, { minutes: 1, externalActions: true });
  assert.match(helper.action.why, /promise to Mabel Ash/);
  assert.equal(helper.action.kind, 'waiting');
  const body = JSON.parse(actionBody(helper, v.world, availableActions(helper, v), locationsOf(v.map, v.actors)));
  assert.equal(body.input[0].content[0].data.helpRequests[0].minutesLeftToFinish, r.due - v.world.minute);
  assert.ok(body.questions[0].choices.some(c => c.value.startsWith('rest:')));
  assert.ok(body.questions[0].choices.some(c => c.value.startsWith('help:')));
  r.status = 'asked';
  assert.equal(verdict().follow.action.kind, 'rest');
  r.status = 'accepted';
  r.helperId = 'mabel';
  assert.equal(verdict().follow.action.kind, 'rest');
});

test('a moot reaches quorum and the village builds on the model-driven path', () => {
  const village = createVillage();
  village.world.proposals.push({ key: 'field', kind: 'field', by: 'agnes', since: village.world.minute, supporters: ['agnes', 'robin', 'hugh', 'mabel'], heard: [] });
  const fields = placesOf(village.map, 'field', false).length;
  const { events, records } = run(village, 3 * 1440, sensible);
  assert.ok(events.some(e => /a moot will meet/.test(e.text)));
  assert.ok(records.some(r => r.basis === 'waiting' && r.reason === 'would run into the moot'), 'the moot made routine a choice');
  assert.ok(events.some(e => /The moot agreed/.test(e.text)), events.filter(e => e.type === 'civic').map(e => e.text).join(' | '));
  assert.equal(placesOf(village.map, 'field', false).length, fields + 1);
  assert.ok(events.some(e => e.type === 'build'), 'work began on what was agreed');
});

test('the model-driven village resumes from JSON exactly', () => {
  const original = createVillage();
  run(original, 1440, sensible);
  const restored = JSON.parse(JSON.stringify(original));
  const a = run(original, 2 * 1440, sensible), b = run(restored, 2 * 1440, sensible);
  assert.deepEqual(b.events, a.events);
  assert.deepEqual(b.records, a.records);
  assert.deepEqual(restored, original);
});

test('the action model reads place names, never place IDs', () => {
  const village = createVillage(), actor = village.actors[0];
  stepVillage(village, { minutes: 1, externalActions: true });
  const request = JSON.parse(actionBody(actor, village.world, availableActions(actor, village), locationsOf(village.map, village.actors)));
  const said = JSON.stringify([request.input[0].content[0].data, request.questions[0].choices.map(c => c.description)]);
  assert.match(said, /Village green/);
  assert.match(said, /Agnes Reed’s cottage/);
  assert.doesNotMatch(said, /cottage-\d|fields-2|"position"/);
  assert.equal(request.input[0].content[0].data.whyThisIsAChoice, 'no instruction applies');
});
