import test from 'node:test';
import assert from 'node:assert/strict';
import { residentActivity, toolFor } from './public/resident-pose.js';
import { createPlay, ovenLoaves, raisedOf } from './public/parish.js';

const carry = action => residentActivity({ action }, true).carry;

test('what residents carry on the way follows their errand', () => {
  assert.equal(carry({ kind: 'work', job: 'bake', phase: 'travelling', carrying: { bread: 5 } }), 'basket');
  assert.equal(carry({ kind: 'work', job: 'harvest', phase: 'travelling', carrying: { grain: 3 } }), 'sack');
  assert.equal(carry({ kind: 'work', job: 'cut', phase: 'travelling', carrying: { wood: 3 } }), 'bundle');
  assert.equal(carry({ kind: 'work', job: 'weave', phase: 'travelling', carrying: { cloth: 1 } }), 'bolt');
  assert.equal(carry({ kind: 'work', job: 'cut', phase: 'travelling' }), 'axe', 'the tool of the work they are going to');
  assert.equal(carry({ kind: 'carrying', phase: 'travelling' }), 'bundle', 'a child taking kindling home');
  assert.equal(carry({ kind: 'social', phase: 'travelling' }), null);
  assert.equal(residentActivity({ action: { kind: 'work', job: 'cut', phase: 'travelling' } }, false).carry, null, 'nothing is carried standing still');
  assert.equal(toolFor({ working: true, job: 'harvest', carry: 'basket' }), 'sickle', 'at work the tool of the work wins');
});

test('a building in progress shows how far its walls and thatch have gone', () => {
  const world = { projects: [{ id: 'cottage-9', need: 40, done: 14 }, { id: 'cottage-8', need: 40, done: 40 }] };
  assert.equal(raisedOf(world, 'cottage-9'), 0, 'the frame has just gone up');
  assert.equal(raisedOf(world, 'cottage-8'), 1);
  assert.equal(raisedOf(world, 'nowhere'), 0);
});

test('loaves come out by the oven as a bake goes on', () => {
  const map = { places: [{ id: 'oven', kind: 'oven', stage: 2, x: 10, y: 10, w: 3, d: 2, a: 0, at: [10, 12] }] };
  const baking = remaining => [{ action: { job: 'bake', phase: 'working', target: 'oven', remaining } }];
  assert.equal(ovenLoaves(map, []).count, 0);
  assert.ok(ovenLoaves(map, baking(50)).count < ovenLoaves(map, baking(5)).count);
  assert.equal(ovenLoaves(map, baking(0)).count, 5);
});

test('children at play run round the green and come back when play ends', () => {
  const map = { places: [{ id: 'green', kind: 'green', x: 50, y: 50, rx: 5, ry: 4, at: [50, 52] }] };
  const child = id => ({ id, child: true, action: { kind: 'play', phase: 'working', target: 'green' } });
  const here = { x: 50, y: 52, moving: false, heading: 0 }, play = createPlay(), kids = [child('a'), child('b')];
  let a, b;
  for (let t = 0; t < 80; t++) { play.begin(map, kids, () => here, t * 100); a = play.place('a', here, 0.1); b = play.place('b', here, 0.1); }
  assert.ok(a.moving && b.moving);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2, 'they spread out round the ring');
  const home = [{ id: 'a', child: true, action: { kind: 'rest', phase: 'working', target: 'cottage-1' } }];
  for (let t = 80; t < 200; t++) { play.begin(map, home, () => here, t * 100); a = play.place('a', here, 0.1); }
  assert.equal(a, here);
});

test('a family’s ox-cart travels with them and then stands at the end of their house', async () => {
  const { cartsOf } = await import('./public/carts.js');
  const map = { places: [{ id: 'barn', kind: 'barn', x: 50, y: 50, w: 5, d: 2.8, a: 0, at: [50, 52] }] };
  const world = { familyArrivals: [{ home: 'barn', lodging: 'barn', parents: ['ma', 'pa'], cart: { oxen: 2 } }] };
  const parent = kind => [{ id: 'ma', action: { kind, phase: kind === 'arrive' ? 'travelling' : 'working' } }, { id: 'pa', action: { kind: 'rest', phase: 'working' } }];
  const [road] = cartsOf(map, world, parent('arrive'), () => ({ x: 20, y: 30, heading: 0, moving: true, gone: 3 }), 1000);
  assert.ok(road.moving);
  assert.ok(road.x < 20, 'the cart follows behind the oxen');
  assert.equal(road.oxen.length, 2);
  const [home] = cartsOf(map, world, parent('rest'), () => null, 1000);
  assert.equal(home.moving, false);
  assert.ok(Math.abs(home.x - (50 + 2.5 + 0.85)) < 1e-9, 'it stands at the gable end');
  assert.deepEqual(cartsOf(map, { familyArrivals: [{ home: 'barn', parents: [] }] }, [], () => null, 0), [], 'no cart, nothing drawn');
});

test('the children’s ring on the green keeps clear of the well and the peddler’s pitch', async () => {
  const { playRing, pitchOf } = await import('./public/parish.js');
  const map = { nodes: [[50, 52], [50, 60]], edges: [[0, 1, 'track', -1]], places: [
    { id: 'green', kind: 'green', x: 50, y: 50, rx: 5, ry: 4, a: 0, at: [50, 52], node: 0 },
    { id: 'well', kind: 'well', x: 48.5, y: 49.5, at: [48.5, 50.5] },
  ] };
  const ring = playRing(map), pitch = pitchOf(map);
  for (let i = 0; i < 36; i++) {
    const a = i * Math.PI / 18, x = ring.x + Math.cos(a) * ring.rx, y = ring.y + Math.sin(a) * ring.ry;
    assert.ok(Math.hypot(x - 48.5, y - 49.5) >= 1.3, 'never over the well');
    assert.ok(Math.hypot(x - pitch.x, y - pitch.y) >= 1.1, 'never over the pack');
    assert.ok(((x - 50) / 5) ** 2 + ((y - 50) / 4) ** 2 <= 1, 'on the green');
  }
  assert.ok(((48.5 - ring.x) / ring.rx) ** 2 + ((49.5 - ring.y) / ring.ry) ** 2 > 1, 'not running round the well either');
});

test('lambs keep at their mothers’ sides, and are drawn small', async () => {
  const { visibleSheep } = await import('./public/parish.js');
  const sheep = Array.from({ length: 8 }, (_, i) => ({ kind: 'sheep', x: i * 2, y: 0, phase: i, coat: i % 3 }));
  const flock = { ewes: 3, rams: 1, spare: 0, lambs: 3 };
  const shown = visibleSheep({ pasture: {}, sheep }, { smallholding: { flock } });
  assert.equal(shown.length, 7);
  const lambs = shown.filter(s => s.lamb);
  assert.equal(lambs.length, 3);
  for (const [i, lamb] of lambs.entries()) assert.ok(Math.hypot(lamb.x - sheep[i].x, lamb.y - sheep[i].y) < 0.6, 'beside a ewe');
});
