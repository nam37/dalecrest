import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, locationsOf } from './sim.mjs';
import { actionBody } from './decisions.mjs';
import { civicChoices, civicContext, civicObservationKeys, enactCivicChoice, normalizeCivicNews, shareProposalNews, witnessProposal } from './engine/civic-news.mjs';
import { WORKS } from './engine/civic.mjs';
import { observeGrain } from './engine/observations.mjs';

function choices(actor, state) {
  const menu = new Map();
  civicChoices(actor, state, menu);
  return menu;
}

function enact(actor, state, id, trace) {
  actor.action = { ...choices(actor, state).get(id), decisionTraceId: trace, phase: 'working' };
  return enactCivicChoice(actor, state, () => {});
}

function villageWithFieldProposal(additionalWitness) {
  const state = createVillage();
  // The two existing strips are already feeding thirteen neighbours.
  while (state.actors.length < 13) state.actors.push({ ...structuredClone(state.actors[3]), id: 'new-' + state.actors.length });
  state.actors.forEach((actor, i) => { actor.position = { x: i * 12, y: 10 }; });
  const [grower, intermediary, listener] = state.actors;
  if (additionalWitness) {
    const witness = state.actors.find(a => a.id === additionalWitness);
    witness.position = { ...grower.position };
    witness.action = { kind: 'social', phase: 'working', target: grower.action.target };
  }
  enact(grower, state, 'civic:raise:field', '13');
  return { state, grower, intermediary, listener, proposal: state.world.proposals[0] };
}

test('a grower and a lodger can advance competing motions and an uninformed neighbour cannot take a position', () => {
  const { state, grower, listener, proposal } = villageWithFieldProposal();
  listener.home = 'hall';
  const menu = choices(listener, state);
  assert.ok(menu.has('civic:raise:cottage:' + listener.id));
  assert.ok(menu.has('civic:raise:allowance'));
  assert.ok(![...menu.values()].some(action => action.verb === 'position'));
  assert.deepEqual(civicContext(listener, state.world), {});
  assert.equal(shareProposalNews(grower, listener, state, () => 1), null);
  listener.position = { ...grower.position };
  shareProposalNews(grower, listener, state, () => 1);
  const actions = [...choices(listener, state).entries()].filter(([, action]) => action.verb === 'position');
  assert.deepEqual(actions.map(([, action]) => action.position), ['support', 'oppose', 'undecided']);
  assert.deepEqual(proposal.supporters, [grower.id]);
  const result = enact(listener, state, actions[1][0], '21');
  assert.equal(proposal.positions[listener.id].position, 'oppose');
  assert.equal(result.traceId, '21');
  assert.deepEqual(result.observationKeys, civicObservationKeys(listener, state.world));
});

test('the action menu offers a granary to a grower who saw a filling barn with insufficient winter capacity', () => {
  const state = createVillage(), [grower] = state.actors;
  const { world } = state;
  world.capacity.grain = 1000;
  world.supplies.grain = 600;
  observeGrain(grower, state, 'harvest');
  assert.ok(!availableActions(grower, state).has('civic:raise:granary'));
  world.capacity.grain = 160;
  world.supplies.grain = 120;
  while (state.actors.length < 20) state.actors.push({ ...structuredClone(state.actors[3]), id: 'new-' + state.actors.length });
  delete grower.observations.grain;
  assert.ok(!availableActions(grower, state).has('civic:raise:granary'));
  observeGrain(grower, state, 'harvest');
  assert.ok(availableActions(grower, state).has('civic:raise:granary'));
  world.supplies.grain = 0;
  assert.ok(availableActions(grower, state).has('civic:raise:granary'), 'an unseen draw cannot erase a witnessed count');
  observeGrain(grower, state, 'harvest');
  assert.ok(!availableActions(grower, state).has('civic:raise:granary'), 'the grower sees the change at the next shift');
  assert.ok(availableActions(grower, state).has('civic:raise:field'));
  state.actors.splice(8);
  world.supplies.grain = 120;
  observeGrain(grower, state, 'harvest');
  assert.ok(!availableActions(grower, state).has('civic:raise:field'));
});

test('earlier proposal records restore only recorded knowledge and support and can spread after a reload', () => {
  const state = createVillage(), [sponsor, hearer, neighbour] = state.actors;
  const p = { key: 'field', kind: 'field', since: state.world.minute - 100, by: sponsor.id,
    supporters: [sponsor.id], heard: [hearer.id] };
  state.world.proposals.push(p);
  normalizeCivicNews(state);
  const snapshot = JSON.stringify(state);
  normalizeCivicNews(state);
  assert.equal(JSON.stringify(state), snapshot);
  const news = civicContext(hearer, state.world).civicNews[0];
  assert.equal(news.source, 'earlier proposal record');
  assert.equal(news.witness, null);
  assert.equal(news.observed, null);
  assert.equal(news.claim, null);
  assert.equal(news.ownPosition, null);
  assert.equal(p.positions[sponsor.id].position, 'support');
  assert.equal(p.positions[sponsor.id].minute, null);
  assert.equal(p.positions[sponsor.id].traceId, null);
  assert.equal(p.ballots, undefined);
  assert.ok([...choices(hearer, state).values()].some(action => action.verb === 'position'));
  assert.equal(civicContext(neighbour, state.world).civicNews, undefined);
  assert.ok(![...choices(neighbour, state).values()].some(action => action.verb === 'position'));
  state.world.minute++;
  neighbour.position = { ...hearer.position };
  const report = shareProposalNews(hearer, neighbour, state, () => 0);
  assert.equal(report.details.news.claim, null);
  assert.equal(report.details.news.origin, 'earlier proposal record');
  assert.equal(report.details.news.witness, null);
  assert.doesNotMatch(report.text, /undefined|shifts/);
  const option = [...choices(neighbour, state)].find(([, a]) => a.position === 'support');
  assert.ok(option);
  enact(neighbour, state, option[0], '31');
  assert.deepEqual(p.supporters, [sponsor.id, neighbour.id]);
});

test('two villages preserve different witness paths and a mistaken estimate through the ballot request', () => {
  function request(relay) {
    const { state, grower, intermediary, listener, proposal } = villageWithFieldProposal(relay ? null : 'edith');
    const { world } = state;
    // Edith heard the motion herself in the first village. Only Agnes witnessed it in the second.
    world.minute++;
    if (relay) {
      intermediary.position = { ...grower.position };
      shareProposalNews(grower, intermediary, state, () => 0);
      world.minute++;
      intermediary.position = { ...listener.position };
      shareProposalNews(intermediary, listener, state, () => 0);
    } else {
      const eyewitness = state.actors.find(a => a.id === 'edith');
      listener.position = { ...eyewitness.position };
      shareProposalNews(eyewitness, listener, state, () => 0);
    }
    const before = civicContext(listener, world).civicNews[0];
    const oldPosition = [...choices(listener,state)].find(([, action]) => action.position === 'support')[0];
    world.minute++;
    witnessProposal(listener, proposal, state, { place: 'hall' });
    assert.ok(!availableActions(listener,state).has(oldPosition), 'a delayed answer on the earlier report cannot use the hall reading');
    const menu = new Map(['support', 'oppose', 'abstain'].map(choice => [choice, { kind: 'ballot',
      mootId: 'moot-1', proposalKey: proposal.key, title: before.title, choice, label: choice }]));
    const body = JSON.parse(actionBody(listener, world, menu, locationsOf(state.map, state.actors)));
    const evidence = body.input[0].content[0].data.civicNews[0];
    assert.deepEqual(evidence.previousReport.chain, before.chain);
    assert.equal(evidence.witness, listener.id);
    assert.equal(evidence.claim.shifts, WORKS.field.need);
    assert.match(body.questions[0].instructions, /Cast this resident’s ballot/);
    for (const hop of before.chain) {
      const actor = state.actors.find(a => a.id === hop.resident);
      assert.ok(actor.memories.some(m => actor.id + ':' + m.id === hop.observation));
      assert.ok(civicObservationKeys(listener, world).includes(hop.observation));
    }
    return before;
  }
  const direct = request(false), retold = request(true);
  assert.equal(direct.witness, 'edith');
  assert.equal(retold.witness, 'agnes');
  assert.deepEqual(direct.chain.map(h => h.resident), ['edith', 'mabel']);
  assert.deepEqual(retold.chain.map(h => h.resident), ['agnes', 'hugh', 'mabel']);
  assert.equal(direct.claim.shifts, WORKS.field.need);
  assert.equal(retold.claim.shifts, WORKS.field.need + 4);
});

test('a reopened motion does not inherit knowledge or a late position on its predecessor', () => {
  const { state, grower, listener, proposal } = villageWithFieldProposal();
  listener.position = { ...grower.position };
  shareProposalNews(grower, listener, state, () => 1);
  listener.action = [...choices(listener, state).values()].find(action => action.position === 'oppose');
  const replacement = { ...proposal, since: ++state.world.minute, positions: {} };
  state.world.proposals = [replacement];
  assert.deepEqual(civicContext(listener, state.world), {});
  assert.equal(enactCivicChoice(listener, state, () => {}), undefined);
  assert.deepEqual(replacement.positions, {});
});

test('a resident speaking on the road does not report an encounter at a destination still ahead', () => {
  const { state, grower, listener } = villageWithFieldProposal();
  grower.action = { kind: 'waiting', target: 'hall', remaining: 0 };
  listener.position = { ...grower.position };
  const report = shareProposalNews(grower, listener, state, () => 1);
  assert.equal(report.details.news.place, null);
  const offer = [...choices(listener, state).values()].find(a => a.position === 'support');
  assert.equal(offer.target, null);
  listener.action = { ...offer, phase: 'working' };
  const events = [];
  enactCivicChoice(listener, state, (...args) => events.push(args));
  assert.equal(events[0][4], null);
  assert.equal(listener.memories.at(-1).place, undefined);
});
