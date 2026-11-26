import test from 'node:test';
import assert from 'node:assert/strict';
import { createDucks, createTracks, millWork, PRINTS_LAST, REAPING, CARTING, riverWalk, stooksOf, washingOf } from './public/touches.js';
import { sunDay } from './engine/seasons.mjs';

const DAY = 1440;
// The first minute at noon whose day of the year is the one given.
const onDay = target => { for (let d = 0; d < 800; d++) if ((sunDay(d * DAY + 720) - 1) % 365 + 1 === target) return d * DAY + 720; throw new Error('no day ' + target); };
const field = { id: 'fields', kind: 'field', stage: 2, x: 50, y: 50, w: 12, d: 8, a: 0.3, at: [50, 55] };

test('stooks stand in the fields from the reaping until they are carted in', () => {
  const map = { seed: 7, places: [field] };
  assert.equal(stooksOf(map, onDay(REAPING[0] - 5)).length, 0, 'none before the reaping');
  const early = stooksOf(map, onDay(REAPING[0] + 4)).length, full = stooksOf(map, onDay(REAPING[1] + 2)).length;
  assert.ok(early > 0 && early < full, 'more go up as the reaping crosses the field');
  assert.ok(stooksOf(map, onDay(CARTING[0] + 8)).length < full, 'carting takes them in a row at a time');
  assert.equal(stooksOf(map, onDay(CARTING[1] + 3)).length, 0, 'gone by the time the stubble shows');
  for (const [x, y] of stooksOf(map, onDay(REAPING[1] + 2))) assert.ok(Math.hypot(x - 50, y - 50) < Math.hypot(6, 4), 'each stands inside its field');
  assert.equal(stooksOf({ seed: 7, places: [{ ...field, stage: 1 }] }, onDay(REAPING[1] + 2)).length, 0, 'not on a field still being broken');
});

test('washing goes out on a household’s washing day, in daylight and only when it is dry', () => {
  const cottage = { id: 'cottage-1', kind: 'cottage', stage: 2, x: 20, y: 20, w: 2.7, d: 1.8, a: 0, at: [20, 22] };
  const map = { seed: 3, places: [cottage] }, world = { cottages: { 'cottage-1': {} } };
  let day = 0;
  while (!washingOf(map, world, day * DAY + 780, 3, {}).length) day++;
  const [line] = washingOf(map, world, day * DAY + 780, 3, {});
  assert.ok(line.cloths.length >= 3);
  assert.ok(line.a[1] < 20 && line.b[1] < 20, 'the line is behind the house, away from the door');
  assert.equal(washingOf(map, world, day * DAY + 780, 3, { rain: true }).length, 0, 'in it comes when it rains');
  assert.equal(washingOf(map, world, day * DAY + 300, 3, {}).length, 0, 'not out before morning');
  assert.equal(washingOf(map, { cottages: { 'cottage-1': { lodging: true } } }, day * DAY + 780, 3, {}).length, 0);
  assert.equal(washingOf(map, { cottages: {} }, day * DAY + 780, 3, {}).length, 0, 'no washing at an empty house');
});

test('the mill shows sacks only while someone is grinding, more as the grinding goes on', () => {
  const map = { places: [{ id: 'mill', kind: 'mill', stage: 2, x: 10, y: 10, w: 3.4, d: 2.5, a: 0, at: [10, 12] }] };
  const grinding = remaining => [{ action: { job: 'mill', phase: 'working', target: 'mill', remaining } }];
  assert.equal(millWork(map, []).milling, false);
  assert.equal(millWork(map, []).sacks, 0);
  assert.ok(millWork(map, grinding(60)).sacks < millWork(map, grinding(5)).sacks);
  assert.ok(millWork(map, grinding(0)).sacks <= 4);
  assert.equal(millWork({ places: [] }, []), null);
});

test('ducks keep to the river and edge away from someone fishing', () => {
  const river = [[0, 0], [0, 100]], map = { seed: 1, terrain: { river, riverWidth: 5 } };
  assert.equal(riverWalk(river).length, 100);
  const ducksAt = createDucks();
  for (let t = 0; t < 200000; t += 5000) for (const d of ducksAt(map, t, [], 0.1)) assert.ok(Math.abs(d.x) <= 2, 'on the water');
  const calm = createDucks(), shy = createDucks();
  const [lead] = calm(map, 1000, [], 0.1), angler = { x: lead.x - 2, y: lead.y };
  let moved;
  for (let i = 0; i < 40; i++) moved = shy(map, 1000, [angler], 0.25)[0];
  assert.ok(Math.hypot(moved.x - angler.x, moved.y - angler.y) > Math.hypot(lead.x - angler.x, lead.y - angler.y) + 3);
});

test('footprints follow a walker in turn, left and right, and fill in over a few hours', () => {
  const tracks = createTracks();
  for (let i = 0; i <= 20; i++) tracks.step('a', { x: i * 0.4, y: 0 }, 100);
  const prints = tracks.prints(100);
  assert.equal(prints.length, 20);
  assert.ok(prints[0].y * prints[1].y < 0, 'left and right in turn');
  assert.ok(tracks.prints(100 + PRINTS_LAST / 2).every(q => q.fresh < 0.6));
  assert.equal(tracks.prints(100 + PRINTS_LAST + 1).length, 0);
  tracks.step('b', { x: 0, y: 0 }, 400); tracks.step('b', { x: 30, y: 0 }, 400);
  assert.equal(tracks.prints(400).length, 0, 'no line of prints across a jump');
});

test('roofs show their wear, a torn strip when in poor repair, and new thatch for a few days', async () => {
  const { roofWear } = await import('./public/touches.js');
  assert.equal(roofWear(96, null, 0).wear, 0, 'a sound roof shows nothing');
  assert.ok(roofWear(70, null, 0).wear > 0 && !roofWear(70, null, 0).bare);
  assert.ok(roofWear(50, null, 0).bare, 'a strip torn away to the battens');
  assert.equal(roofWear(90, 1000, 1000).fresh, 1, 'mended today');
  assert.ok(roofWear(90, 1000, 1000 + 4 * DAY).fresh < 1);
  assert.equal(roofWear(90, 1000, 1000 + 9 * DAY).fresh, 0, 'weathered in');
});

test('trodden lines follow the bend the path will take, plainer as the walks add up', async () => {
  const { treadLines, PATH_WEAR } = await import('./public/touches.js');
  const map = { places: [{ id: 'a', at: [0, 0] }, { id: 'b', at: [20, 0] }] };
  const [line] = treadLines(map, { 'a|b': 3 });
  assert.ok(Math.hypot(...line.pts[0]) < 1e-9 && Math.hypot(line.pts.at(-1)[0] - 20, line.pts.at(-1)[1]) < 1e-9, 'from door to door');
  assert.ok(Math.abs(line.pts[Math.floor(line.pts.length / 2)][1]) > 0.5, 'a gentle bend');
  assert.ok(line.worn < treadLines(map, { 'a|b': PATH_WEAR - 1 })[0].worn);
  assert.deepEqual(treadLines(map, { 'a|gone': 4 }), [], 'nothing to a place no longer there');
});

test('the pea rows grow, flower, pod, thin out as they are picked, and are cleared', async () => {
  const { peaRows } = await import('./public/touches.js');
  const garden = { sownAt: 0, picked: 0, tended: true }, world = { smallholding: { garden } };
  assert.ok(peaRows(world, 10 * DAY).grow < peaRows(world, 30 * DAY).grow);
  assert.ok(peaRows(world, 46 * DAY).flowering);
  assert.ok(peaRows(world, 60 * DAY).podded);
  garden.picked = 4;
  assert.ok(peaRows(world, 60 * DAY).left < 1, 'thinned by the picking');
  assert.ok(peaRows(world, 90 * DAY).spent);
  assert.equal(peaRows(world, 120 * DAY), null, 'cleared');
  assert.equal(peaRows({ smallholding: { garden: { sownAt: null, picked: 0 } } }, 0), null);
});

test('ricks by the barn are as big as the hay and grain in store', async () => {
  const { ricksOf } = await import('./public/touches.js');
  const map = { places: [{ id: 'barn', kind: 'barn', stage: 2, x: 50, y: 50, w: 5, d: 2.8, a: 0, at: [50, 52] }] };
  const world = s => ({ supplies: s, capacity: { hay: 180, grain: 160 } });
  const ricks = ricksOf(map, world({ hay: 90, grain: 160 }));
  assert.deepEqual(ricks.map(r => r.kind), ['hay', 'corn']);
  assert.ok(ricks[0].size < ricks[1].size);
  assert.ok(ricks.every(r => r.x < 50 - 2.5), 'at the far end of the barn');
  assert.deepEqual(ricksOf(map, world({ hay: 0, grain: 10 })).map(r => r.kind), ['corn']);
});
