import test from 'node:test';
import assert from 'node:assert/strict';
import { scenes, createDirector, NEWS_FOR } from './public/director.js';
import { residentCaption } from './public/card.js';
import { createVillage, startChosen, stepVillage } from './sim.mjs';

const at = { x: 80, y: 60 };
const person = (id, action, needs = {}) => ({ id, name: id, position: at, needs, action: { phase: 'working', target: 'green', label: id + ' is busy', ...action } });
const asleep = id => person(id, { kind: 'rest', target: id + '-home', label: 'Sleeping at home' });
const news = (id, minute, type = 'social', actorIds = []) => ({ id, minute, type, actorIds, text: 'Entry ' + id, place: { x: 70, y: 50, id: 'hall' } });

test('the caption follows Agnes from the barley to Hugh, then distinguishes a longer visit', () => {
  const village = createVillage(), agnes = village.actors.find(a => a.id === 'agnes'), hugh = village.actors.find(a => a.id === 'hugh');
  village.world.minute = 600;
  agnes.action = { kind: 'waiting', phase: 'waiting', target: 'fields', since: 595, previous: { label: 'Gathering barley' } };
  hugh.action = { kind: 'work', label: 'Grinding barley', job: 'mill', target: 'mill', phase: 'working', remaining: 100 };
  assert.equal(residentCaption(agnes).line, 'After gathering barley, Agnes Reed is deciding what to do next.');
  assert.ok(startChosen(agnes, village, 'social:hugh:mill', { id: '7' }));
  assert.deepEqual(residentCaption(agnes), { line: 'After gathering barley, Agnes Reed is on the way to see Hugh Fen.', why: '' });
  for (let i = 0; i < 60 && agnes.action.phase === 'travelling'; i++) stepVillage(village, { minutes: 1, externalActions: true });
  assert.deepEqual(residentCaption(agnes), { line: 'After gathering barley, Agnes Reed went to see Hugh Fen.', why: '' });
  agnes.action = { kind: 'social', phase: 'working', label: 'Visiting Hugh Fen', basis: { kind: 'standing' } };
  assert.equal(residentCaption(agnes).line, 'Agnes Reed stayed a while longer with Hugh Fen.');
});

test('captions handle saved reasons, repeated work, and a friend who moved', () => {
  const caption = action => residentCaption({ name: 'Agnes Reed', action }, {
    hall: { name: 'Village hall' }, green: { name: 'Village green' },
  });
  assert.deepEqual(caption({ kind: 'work', label: 'Gathering barley', reason: 'Selected by a model after Gathering barley.' }),
    { line: 'Agnes Reed is gathering barley.', why: '' });
  assert.equal(caption({ kind: 'conversation', label: 'Ask Thomas Pike to repair my bed', reason: 'Chose this.' }).line,
    'Agnes Reed is asking Thomas Pike to repair their bed.');
  const visitChange = { name: 'Hugh Fen', friendId: 'hugh', from: 'green', to: 'hall' };
  assert.deepEqual(caption({ kind: 'work', label: 'Baking bread', phase: 'travelling', target: 'hall', basis: { kind: 'fresh', visitChange },
    reason: 'Chose this after visiting Hugh Fen.' }), { line: 'After visiting Hugh Fen, Agnes Reed is walking to the village hall.',
    why: 'Hugh Fen went from the village green to the village hall.' });
});

test('a kept promise is worth more than a trade, and a trade more than idling', () => {
  const list = scenes({ world: { minute: 600 }, actors: [
    person('idler', { kind: 'leisure' }),
    person('baker', { kind: 'work', job: 'bake' }),
    person('helper', { kind: 'work', job: 'cut', commitmentId: 4 }),
    person('thinker', { kind: 'waiting', phase: 'waiting' }),
  ] });
  assert.deepEqual(list.filter(s => s.kind === 'resident').map(s => s.actorId), ['helper', 'thinker', 'baker', 'idler']);
  assert.equal(list[0].kicker, 'Keeping a promise');
  assert.equal(list.at(-1).kind, 'village');
});

test('someone walking to a promise is still keeping it, and anyone else walking is on the way', () => {
  const [helper, walker] = scenes({ world: { minute: 600 }, actors: [
    person('helper', { kind: 'work', job: 'cut', commitmentId: 4, phase: 'travelling' }),
    person('walker', { kind: 'work', job: 'mill', phase: 'travelling' }),
  ] });
  assert.equal(helper.kicker, 'Keeping a promise');
  assert.equal(walker.kicker, 'On the way');
});

test('a sleeping village is one scene, the whole parish', () => {
  const list = scenes({ world: { minute: 120 }, actors: [asleep('a'), asleep('b'), asleep('c')] });
  assert.deepEqual(list.map(s => s.kind), ['village']);
  assert.equal(list[0].indoors, 3);
  assert.equal(list[0].residents, 3);
});

test('only recent entries with a place are news, and routine never is', () => {
  const minute = 900, list = scenes({ world: { minute }, actors: [person('mabel', { kind: 'work', job: 'bake' })], events: [
    news(9, minute - 1, 'build'),
    news(8, minute - 2, 'meal'),
    news(7, minute - 3, 'plan'),
    { ...news(6, minute - 4), place: undefined },
    news(5, minute - NEWS_FOR - 1, 'civic'),
    news(4, minute - 10, 'social', ['mabel', 'gone']),
  ] });
  assert.deepEqual(list.filter(s => s.kind === 'event').map(s => s.event.id), [9, 4]);
  assert.equal(list[0].key, 'e:9');
  assert.equal(list.find(s => s.key === 'e:4').actorId, 'mabel');
});

test('the director stays with a scene, then goes round everyone before coming back', () => {
  const director = createDirector({ dwell: 10000 });
  const snapshot = { world: { minute: 600 }, actors: ['a', 'b', 'c', 'd'].map(id => person(id, { kind: 'work', job: 'weave' })) };
  const first = director.pick(snapshot, 0);
  assert.equal(director.pick(snapshot, 4000).key, first.key);
  assert.equal(director.pick(snapshot, 9999).key, first.key);
  const order = [first.key];
  for (let now = 10000; now < 40000; now += 10000) order.push(director.pick(snapshot, now).key);
  assert.equal(new Set(order).size, 4, 'four residents, four different scenes: ' + order);
  assert.ok(order.every(key => key.startsWith('r:')));
});

test('news that arrives during the watch cuts in, is told once, and is then left behind', () => {
  const director = createDirector({ dwell: 10000, newsDwell: 12000, minHold: 5000 });
  const actors = [person('a', { kind: 'work', job: 'weave' }), person('b', { kind: 'work', job: 'mill' })];
  const old = news(1, 590, 'civic');
  // An entry already in the record when the watch begins takes its turn. It does not cut in.
  assert.equal(director.pick({ world: { minute: 600 }, actors, events: [old] }, 0).key, 'e:1');
  const quiet = director.pick({ world: { minute: 601 }, actors, events: [old] }, 13000);
  assert.equal(quiet.kind, 'resident');
  // A moment later something happens at the hall. The scene on show is given its minimum hold first.
  const fresh = news(2, 602, 'build', ['b']);
  assert.equal(director.pick({ world: { minute: 602 }, actors, events: [fresh, old] }, 14000).key, quiet.key);
  const cut = director.pick({ world: { minute: 602 }, actors, events: [fresh, old] }, 18500);
  assert.equal(cut.key, 'e:2');
  assert.equal(cut.actorId, 'b');
  // More news waits its turn in the same way.
  const second = news(3, 603, 'arrival');
  assert.equal(director.pick({ world: { minute: 603 }, actors, events: [second, fresh, old] }, 20000).key, 'e:2');
  assert.equal(director.pick({ world: { minute: 603 }, actors, events: [second, fresh, old] }, 24000).key, 'e:3');
  // Once told, neither entry is shown again while there are residents to watch.
  const seen = new Set();
  for (let now = 40000; now < 140000; now += 10000) seen.add(director.pick({ world: { minute: 604 }, actors, events: [second, fresh, old] }, now).key);
  assert.ok(![...seen].some(key => key.startsWith('e:')), [...seen].join(' '));
});

test('a resident who starts something new while watched is stayed with a little longer', () => {
  const director = createDirector({ dwell: 10000 });
  const others = [person('b', { kind: 'work', job: 'mill' })];
  const deciding = { world: { minute: 600 }, actors: [person('a', { kind: 'waiting', phase: 'waiting' }), ...others] };
  assert.equal(director.pick(deciding, 0).key, 'r:a');
  const chosen = { world: { minute: 601 }, actors: [person('a', { kind: 'work', job: 'bake', label: 'Baking bread' }), ...others] };
  assert.equal(director.pick(chosen, 9000).key, 'r:a');
  assert.equal(director.pick(chosen, 12000).key, 'r:a');
  assert.equal(director.pick(chosen, 15000).key, 'r:b');
});

test('a village founded from a seed always gives the director something to show', () => {
  const village = createVillage(26111);
  const director = createDirector();
  const keys = new Set();
  // Five days: under local rules the founding village has nothing notable until its first newcomer, on the third.
  for (let step = 0; step < 1440; step++) {
    const events = stepVillage(village, { minutes: 5 });
    village.events = [...events.map((e, i) => ({ ...e, id: step + ':' + i })).reverse(), ...(village.events || [])].slice(0, 100);
    for (const scene of scenes(village)) {
      if (scene.kind === 'resident') assert.ok(village.actors.some(a => a.id === scene.actorId));
      if (scene.kind === 'event') assert.ok(Number.isFinite(scene.event.place.x));
    }
    keys.add(director.pick(village, step * 14000).kind);
  }
  assert.deepEqual([...keys].sort(), ['event', 'resident', 'village']);
});
