// Stage 2: goals and memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, availableActions, startChosen } from './sim.mjs';
import { activeGoals, applyReview, goalKey, screenStatement, settleGoals } from './engine/goals.mjs';
import { recall, memoryKey, remember, MEMORY_HOLDS } from './engine/memory.mjs';
import { trustOf, warmthOf } from './engine/bonds.mjs';
import { knownStores } from './engine/exchanges.mjs';
import { actionBody } from './decisions.mjs';
import { readReply, reviewSchema } from './goal-reviews.mjs';
import { consider } from './engine/standing.mjs';

const DAY = 1440;
const resident = (village, id) => village.actors.find(a => a.id === id);
const tick = (village, minutes = 1, externalActions = false) => stepVillage(village, { minutes, externalActions });
const review = (actor, village, decisions, offered = []) => applyReview(actor, village, { decisions }, { reviewId: 7, offered });
const keepAll = actor => activeGoals(actor).map(g => ({ action: 'keep', goalId: g.id, evidence: [] }));

test('the founding goals are goals on evidence, and the old fields still read them', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  assert.deepEqual(mabel.goalBook.map(g => [g.kind, g.focus, g.text]), [['evidence', 'work', 'Put fresh loaves on every table'], ['evidence', 'social', 'Make time for Agnes Reed']]);
  assert.equal(mabel.goalBook[1].about, 'agnes');
  assert.deepEqual(mabel.goals, ['Put fresh loaves on every table', 'Make time for Agnes Reed']);
  assert.equal(mabel.desires.find(d => d.id === 'kinship').target, 'agnes');
});

test('a goal with a condition is settled by the engine, with the outcome that settled it', () => {
  const village = createVillage(), { world } = village, alice = resident(village, 'alice');
  world.supplies.water = 5;
  const { applied, rejected } = review(alice, village, [...keepAll(alice),
    { action: 'new', kind: 'condition', text: 'Fill the barrels to twenty buckets by nightfall', focus: 'work',
      condition: { type: 'store', item: 'water', atLeast: 20, withinHours: 12 }, evidence: [] }]);
  assert.deepEqual(rejected, []);
  assert.equal(applied.at(-1).action, 'new');
  const goal = activeGoals(alice).find(g => g.kind === 'condition');
  assert.equal(goal.condition.by, world.minute + 720);
  assert.ok(alice.goals.includes('Fill the barrels to twenty buckets by nightfall'));
  world.supplies.water = 21;
  const said = [];
  settleGoals(village, (type, text, ids, outcome) => said.push({ type, text, outcome }));
  assert.equal(goal.status, 'met');
  assert.match(goal.outcome.why, /water store held 21/);
  assert.equal(said[0].type, 'goal');
  assert.match(said[0].text, /^Goal met for Alice Brook: “Fill the barrels/);
  assert.ok(alice.memories.at(-1).kind === 'goal' && goal.outcome.memory === memoryKey(alice, alice.memories.at(-1)));
  assert.ok(alice.reviewDue && alice.goalHistory.includes(goal) && !alice.goals.includes(goal.text));
  // A goal whose time runs out is missed.
  delete alice.reviewDue;
  review(alice, village, [...keepAll(alice), { action: 'new', kind: 'condition', text: 'Two more shifts at the well', focus: 'work',
    condition: { type: 'work', job: 'draw', count: 2, withinHours: 1 }, evidence: [] }]);
  const shifts = activeGoals(alice).find(g => g.condition?.type === 'work');
  world.minute += 61;
  settleGoals(village, () => {});
  assert.equal(shifts.status, 'missed');
  assert.equal(shifts.outcome.why, 'The time ran out.');
});

test('a review checks each decision, and a goal about someone changes only on cited evidence', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  remember(mabel, village.world.minute, 'Agnes Reed walked past without a word.', ['mabel', 'agnes'], 'social', { importance: 6 });
  const key = memoryKey(mabel, mabel.memories.at(-1));
  const kin = mabel.goalBook.find(g => g.about === 'agnes');
  const uncited = review(mabel, village, [{ action: 'revise', goalId: kin.id, kind: 'evidence', text: 'Find out what troubles Agnes', focus: 'social', about: 'agnes', evidence: [] }], [key]);
  assert.match(uncited.rejected[0].why, /without citing evidence/);
  assert.equal(activeGoals(mabel).find(g => g.id === kin.id).version, 1);
  const cited = review(mabel, village, [{ action: 'revise', goalId: kin.id, kind: 'evidence', text: 'Find out what troubles Agnes', focus: 'social', about: 'agnes', evidence: [key, 'made-up:1'] }], [key]);
  assert.deepEqual(cited.rejected, []);
  const v2 = activeGoals(mabel).find(g => g.id === kin.id);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.basis, [key]);
  assert.equal(mabel.goalHistory.find(g => g.id === kin.id && g.version === 1).status, 'revised');
  // Conditions outside the vocabulary, strangers and a fifth goal are all refused.
  const bad = review(mabel, village, [
    { action: 'new', kind: 'condition', text: 'Fill the moat', focus: 'work', condition: { type: 'store', item: 'moat', atLeast: 1, withinHours: 4 }, evidence: [] },
    { action: 'new', kind: 'evidence', text: 'Befriend the king', focus: 'social', about: 'king', evidence: [] },
    { action: 'new', kind: 'condition', text: 'Bake soon', focus: 'work', condition: { type: 'work', job: 'bake', count: 1, withinHours: 500 }, evidence: [] },
  ], [key]);
  assert.deepEqual(bad.rejected.map(r => r.why), ['unknown store moat', 'unknown resident king', 'withinHours must be a whole number from 1 to 96']);
  // Retiring is recorded too.
  const work = activeGoals(mabel).find(g => g.focus === 'work');
  review(mabel, village, [{ action: 'retire', goalId: work.id, evidence: [] }], [key]);
  assert.equal(mabel.goalHistory.at(-1).status, 'retired');
  assert.ok(!mabel.goals.includes(work.text));
});

test('a changed goal ends the standing instructions chosen under the old one', () => {
  const village = createVillage(), hugh = resident(village, 'hugh');
  hugh.instructions = { meal: { match: 'food:storehouse:draw', label: 'x', trace: 1, since: 0, until: village.world.minute + 999, uses: 0, goals: JSON.stringify(hugh.goals) } };
  review(hugh, village, [...keepAll(hugh), { action: 'new', kind: 'evidence', text: 'Teach a newcomer the stones', focus: 'work', evidence: [] }]);
  const verdict = consider(hugh, village, availableActions(hugh, village), hugh.action);
  assert.deepEqual(verdict.ended.map(e => e.reason), ['goals changed']);
});

test('a goal survives several activities and a night’s sleep, and reaches the action model', () => {
  const village = createVillage(), edith = resident(village, 'edith');
  review(edith, village, [...keepAll(edith), { action: 'new', kind: 'evidence', text: 'Weave a christening cloth for the green', focus: 'work', evidence: [] }]);
  const goal = activeGoals(edith).at(-1), key = goalKey(edith, goal);
  const activities = new Set();
  for (let i = 0; i < 36; i++) { tick(village, 60); activities.add(edith.action.label); }
  assert.ok(activities.size >= 3, [...activities].join(' / '));
  assert.ok(activeGoals(edith).some(g => goalKey(edith, g) === key));
  const body = JSON.parse(actionBody(edith, village.world, availableActions(edith, village))).input[0].content[0].data;
  assert.ok(body.goals.some(g => g.text === 'Weave a christening cloth for the green'));
});

test('memory keeps what matters, and recall brings up what bears on the moment', () => {
  const village = createVillage(), oswin = resident(village, 'oswin'), minute = village.world.minute;
  remember(oswin, minute - 3 * DAY, 'Mabel Ash asked me to stack wood and I let her down.', ['oswin', 'mabel'], 'social', { exchange: 'decline', requestId: 'r' });
  for (let i = 0; i < MEMORY_HOLDS + 20; i++) remember(oswin, minute - 2 * DAY + i, 'Another walk on the green.', ['oswin'], 'social');
  assert.equal(oswin.memories.length, MEMORY_HOLDS);
  assert.ok(oswin.memories.some(m => /let her down/.test(m.text)), 'the important memory was forgotten first');
  const brought = recall(oswin, { minute, people: ['mabel'], limit: 3 });
  assert.ok(brought.some(m => /let her down/.test(m.text)));
  assert.ok(brought.every((m, i) => i === 0 || brought[i - 1].minute <= m.minute));
});

test('two residents can hold different beliefs about the same store', () => {
  const village = createVillage(), { world, map } = village;
  const oven = map.places.find(p => p.id === 'oven');
  const [mabel, hugh] = [resident(village, 'mabel'), resident(village, 'hugh')];
  for (const who of [mabel, hugh]) who.position = { x: oven.at[0], y: oven.at[1] };
  const inspect = who => { who.action = { kind: 'inspect', label: 'Checking the oven', target: 'oven', phase: 'working', remaining: 1 }; tick(village, 1, true); };
  Object.assign(world.supplies, { flour: 9, wood: 0 });
  inspect(mabel);
  Object.assign(world.supplies, { flour: 2, wood: 6 });
  inspect(hugh);
  assert.deepEqual([knownStores(mabel).flour, knownStores(mabel).wood], [9, 0]);
  assert.deepEqual([knownStores(hugh).flour, knownStores(hugh).wood], [2, 6]);
});

test('trust falls when a promise passes with no word of it, and warmth can stay', () => {
  const village = createVillage(), { world } = village;
  const [mabel, oswin] = [resident(village, 'mabel'), resident(village, 'oswin')];
  const r = { id: 'mabel-oswin-wood-1', askerId: 'mabel', asker: mabel.name, helperId: 'oswin', helper: oswin.name, item: 'wood', job: 'cut',
    quantity: 3, terms: 'stack three bundles of firewood', since: world.minute, due: world.minute + 2, status: 'accepted' };
  world.helpRequests = { [r.id]: { ...r } };
  mabel.helpBook = { [r.id]: { ...r } };
  oswin.helpBook = { [r.id]: { ...r } };
  mabel.relationships.oswin = 70;
  const [trust, warmth] = [trustOf(mabel, 'oswin'), warmthOf(mabel, 'oswin')];
  tick(village, 4);
  assert.equal(trustOf(mabel, 'oswin'), trust - 10);
  assert.ok(warmthOf(mabel, 'oswin') >= warmth - 1);
  assert.match(mabel.evidence.at(-1).text, /no word came that it was done/);
});

test('a resident’s own words are published only as one plain sentence', () => {
  assert.equal(screenStatement('I mean to see the oven never wants for wood again'), 'I mean to see the oven never wants for wood again.');
  assert.equal(screenStatement('“I will keep my word to Oswin.”'), 'I will keep my word to Oswin.');
  assert.equal(screenStatement('First this. Then that.'), null);
  assert.equal(screenStatement('See https://example.com'), null);
  assert.equal(screenStatement(''), null);
});

test('the goal model’s reply is read for its review, its cost and any refusal', () => {
  const ok = readReply({ status: 200, body: JSON.stringify({ stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 120 },
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"decisions":[],"statement":""}' }] }) });
  assert.deepEqual(ok, { status: 'valid', review: { decisions: [], statement: '' }, tokens: 1020 });
  assert.equal(readReply({ status: 200, body: JSON.stringify({ stop_reason: 'refusal', usage: {} }) }).status, 'refused');
  assert.equal(readReply({ status: 529, body: 'overloaded' }).status, 'http_error');
  // Every object in the schema is closed, as structured outputs require.
  const closed = s => s.type !== 'object' || (s.additionalProperties === false && Object.values(s.properties).every(p => closed(p.items || p)));
  assert.ok(closed(reviewSchema));
});
