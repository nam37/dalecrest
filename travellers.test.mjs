import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage } from './sim.mjs';
import { finishVisitor, PEDDLER_GOING, tickVisitors, dawnVisitors } from './engine/visitors.mjs';
import { gatesOf, liveMinute, pitchOf, REEVE_STAYS, visitorsOf } from './public/travellers.js';

const near = (a, b, d = 0.5) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d;

test('a peddler walks in with a laden pony, sets out the pack on the green, and goes again', () => {
  const { map } = createVillage(), M = 10000;
  const world = { minute: M, peddler: { name: 'Hamon of Ashby', from: M + 240, until: M + 600 } };
  const at = minute => visitorsOf(map, world, minute, 0);
  assert.equal(at(M).walkers.length, 0, 'not yet on the road');
  const pitch = pitchOf(map);
  const road = at(M + 225);
  assert.equal(road.walkers.length, 1);
  assert.ok(road.walkers[0].moving);
  const [pony] = road.animals;
  assert.equal(pony.kind, 'pony'); assert.ok(pony.laden, 'the pack is on the pony on the road');
  assert.equal(road.pitch, null);
  const earlier = at(M + 215).walkers[0];
  assert.ok(Math.hypot(road.walkers[0].x - pitch.stand[0], road.walkers[0].y - pitch.stand[1]) < Math.hypot(earlier.x - pitch.stand[0], earlier.y - pitch.stand[1]), 'coming nearer');
  world.peddler.traded = 2;
  const open = at(M + 300);
  assert.ok(near([open.walkers[0].x, open.walkers[0].y], pitch.stand), 'stands at the pitch');
  assert.equal(open.walkers[0].moving, false);
  assert.deepEqual([open.pitch.fish, open.pitch.linen], [3, 2], 'two lengths of linen taken and fewer fish left');
  assert.equal(open.animals[0].laden, false, 'the pony is unloaded and grazing');
  const going = at(M + 620);
  assert.ok(going.walkers[0].moving && going.animals[0].laden);
  assert.equal(going.pitch, null, 'packed up');
  assert.equal(at(M + 600 + PEDDLER_GOING).walkers.length, 0, 'gone by the time the engine forgets the visit');
  let last = null;
  for (let m = M + 600; m < M + 600 + PEDDLER_GOING; m += 0.5) last = at(m).walkers[0] ?? last;
  const gates = gatesOf(map);
  assert.ok(gates.some(g => near([last.x, last.y], g, 10)), 'off down the road towards the edge of the map');
});

test('the reeve rides in to the hall, stays a while and leaves with the rent', () => {
  const { map } = createVillage(), M = 20000;
  const hall = map.places.find(p => p.id === 'hall');
  const coming = visitorsOf(map, { minute: M, reeveAt: M + 10 }, M, 0);
  assert.equal(coming.walkers[0].role, 'reeve');
  assert.ok(coming.walkers[0].moving);
  const world = { minute: M + 20, reeveVisit: { at: M + 10, grain: 9, cloth: 1 } };
  const there = visitorsOf(map, world, M + 20, 0);
  assert.ok(near([there.walkers[0].x, there.walkers[0].y], hall.at));
  const leaving = visitorsOf(map, world, M + 10 + REEVE_STAYS + 5, 0);
  assert.ok(leaving.walkers[0].moving && leaving.animals[0].laden, 'the rent goes on the pony');
});

test('a drover comes for strays and takes them home; turned out, they go alone', () => {
  const { map } = createVillage(), M = 30000;
  const field = map.places.find(p => p.kind === 'field');
  const herd = { field: field.id, from: M - 400, until: M + 5, from_: 'Thornwick', eaten: 4 };
  assert.equal(visitorsOf(map, { minute: M, herd }, M, 0).walkers[0].role, 'drover');
  const home = visitorsOf(map, { minute: M + 10, drover: { field: field.id, at: M + 5, from_: 'Thornwick' } }, M + 10, 0);
  assert.equal(home.walkers.length, 1);
  assert.equal(home.animals.filter(a => a.kind === 'cattle').length, 3);
  const alone = visitorsOf(map, { minute: M + 10, drover: { field: field.id, at: M + 5, from_: 'Thornwick', driven: true } }, M + 10, 0);
  assert.equal(alone.walkers.length, 0);
  assert.equal(alone.animals.length, 3);
});

test('visitors walk smoothly between village minutes', () => {
  assert.equal(liveMinute(100, null, 0), 100);
  const tick = { minute: 100, minutes: 2, ms: 4000, endsAt: 5000 };
  assert.equal(liveMinute(100, tick, 3000), 101);
  assert.equal(liveMinute(100, tick, 9000), 102);
  assert.equal(liveMinute(99, tick, 3000), 99, 'a stale tick is ignored');
});

test('the engine keeps a visit long enough to show it ending, and counts the peddler’s trades', () => {
  const village = createVillage(), { world, map } = village, emit = () => {};
  world.minute = 5000;
  world.peddler = { name: 'Geoffrey Pack', from: 4800, until: 5000 };
  tickVisitors(village, emit);
  assert.ok(world.peddler, 'still packing up and going');
  world.minute = 5000 + PEDDLER_GOING;
  tickVisitors(village, emit);
  assert.equal(world.peddler, undefined);
  world.peddler = { name: 'Geoffrey Pack', from: 4800, until: 6000 };
  finishVisitor({ action: { job: 'trade' } }, village);
  finishVisitor({ action: { job: 'trade' } }, village);
  assert.equal(world.peddler.traded, 2);
  world.reeveAt = world.minute;
  tickVisitors(village, emit);
  assert.equal(world.reeveVisit.at, world.minute);
  const field = map.places.find(p => p.kind === 'field');
  world.herd = { field: field.id, from: world.minute - 100, until: world.minute, from_: 'Elmstead', eaten: 0 };
  tickVisitors(village, emit);
  assert.deepEqual(world.drover, { field: field.id, at: world.minute, from_: 'Elmstead' });
  dawnVisitors(village, emit, () => 0.99, { rain: 0, snow: 0 });
  assert.equal(world.reeveVisit, undefined);
  assert.equal(world.drover, undefined);
});
