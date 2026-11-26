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
