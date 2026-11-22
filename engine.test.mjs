import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, adoptVillage, locationsOf } from './sim.mjs';
import { generateMap } from './engine/worldgen.mjs';
import { place, placesOf, outline, walkLength, route, nearestOnRoads } from './engine/roads.mjs';
import { extendLane, fieldSite } from './engine/sites.mjs';
import { isWater } from './engine/terrain.mjs';
import { polysTouch, rng } from './engine/geom.mjs';

function assertSound(map) {
  const solid = map.places.map(p => [p, outline(p)]).filter(([p, poly]) => poly && p.kind !== 'green');
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      assert.ok(!polysTouch(solid[i][1], solid[j][1]), solid[i][0].id + ' overlaps ' + solid[j][0].id);
    }
  }
  for (const p of map.places) {
    assert.ok(Number.isFinite(walkLength(map, 'green', p.id)), p.id + ' cannot be reached from the green');
    if (p.kind !== 'mill') assert.ok(!isWater(map, p.x, p.y), p.id + ' stands in the river');
  }
}

test('a seed always grows the same sound village', () => {
  for (const seed of [26111, 7, 4242]) {
    const map = generateMap(seed);
    assert.deepEqual(generateMap(seed), map);
    assertSound(map);
    assert.equal(placesOf(map, 'cottage').length, 8);
    for (const id of ['green', 'well', 'hall', 'oven', 'mill', 'wood', 'fields']) assert.ok(place(map, id), id);
    assert.ok(map.edges.some(e => e[2] === 'bridge'));
  }
  assert.notDeepEqual(generateMap(1).nodes, generateMap(2).nodes);
});

test('residents keep to dry ground or the bridge and reach where they are going', () => {
  const village = createVillage();
  for (let i = 0; i < 2880; i++) {
    stepVillage(village, { minutes: 1 });
    for (const a of village.actors) {
      if (isWater(village.map, a.position.x, a.position.y, -0.5)) {
        const bridge = nearestOnRoads(village.map, [a.position.x, a.position.y], kind => kind === 'bridge');
        assert.ok(bridge && bridge.d < 0.001, a.name + ' is in the river away from the bridge at minute ' + village.world.minute);
      }
    }
  }
  const walk = route(village.map, place(village.map, 'cottage-1').at, 'mill');
  assert.ok(walk.pts.length > 3 && !walk.direct);
});

test('new lanes and fields find free ground', () => {
  const map = generateMap(31), rand = rng(5);
  for (let i = 0; i < 4; i++) {
    const roads = map.roads.length;
    assert.ok(extendLane(map, rand) >= 0);
    assert.equal(map.roads.length, roads + 1);
  }
  assert.ok(fieldSite(map, rand));
  assertSound(map);
});

test('the village grows out of what its residents ask for', () => {
  const village = createVillage(), events = [];
  for (let day = 0; day < 45; day++) events.push(...stepVillage(village, { minutes: 1440 }));
  const { world, actors, map } = village;
  assert.ok(actors.length > 8, 'no one arrived');
  assert.ok(placesOf(map, 'cottage').length > 8, 'no cottage was built');
  assert.ok(events.some(e => e.type === 'civic' && /told/.test(e.text)), 'no concern was voiced');
  assert.ok(events.some(e => e.type === 'civic' && /moot agreed/.test(e.text)), 'no moot agreed anything');
  for (const a of actors) {
    assert.ok(place(map, a.home), a.name + ' has no home');
    assert.ok(a.needs.hunger < 100, a.name + ' is starving');
  }
  assert.equal(new Set(actors.map(a => a.id)).size, actors.length);
  assert.equal(world.mapRevision, map.revision);
  assertSound(map);
  const names = locationsOf(map, actors);
  assert.match(names[actors[0].home].name, /Agnes Reed’s cottage/);
});

test('a village stored before the map existed is moved onto one', () => {
  const { world, actors } = createVillage();
  const legacy = { world: { minute: 90210, seed: world.seed, supplies: world.supplies }, actors };
  actors.forEach((a, i) => {
    a.home = 'cottages';
    a.action = { kind: 'food', label: 'Taking a loaf at the oven', reason: '', target: i % 2 ? 'oven' : 'cottages', phase: i % 3 ? 'working' : 'travelling', remaining: 9 };
    a.position = { x: 40 + i, y: 30 };
  });
  actors[4].workplace = 'cottages';
  actors[1].action = { kind: 'waiting', phase: 'waiting', since: 90208, target: 'oven', remaining: 0,
    label: 'Choosing the next activity', previous: { kind: 'food', label: 'Taking a loaf at the oven', target: 'oven' } };
  const map = adoptVillage(legacy);
  const [x, y] = place(map, 'oven').at;
  assert.deepEqual(actors[1].position, { x, y });
  assert.equal(actors[1].action.since, 90208);
  const village = { ...legacy, map };
  stepVillage(village, { minutes: 600 });
  // The storekeeper sent for when the storehouse was built sleeps there.
  for (const a of actors) assert.equal(place(map, a.home).kind, a.trade === 'keep' ? 'storehouse' : 'cottage');
  assert.equal(actors[4].workplace, actors[4].home);
  assert.equal(village.world.capacity.grain, 160);
});

test('a village that has begun to grow resumes from JSON exactly', () => {
  const original = createVillage();
  stepVillage(original, { minutes: 1440 * 9 });
  assert.ok(original.actors.length > 8);
  const restored = JSON.parse(JSON.stringify(original));
  const expected = stepVillage(original, { minutes: 1440 * 8 });
  const actual = [];
  for (let i = 0; i < 8 * 480; i++) actual.push(...stepVillage(restored, { minutes: 3 }));
  assert.deepEqual(actual, expected);
  assert.deepEqual(restored, original);
  assert.ok(expected.some(e => e.type === 'build'));
});

test('events say where they happened', () => {
  const village = createVillage();
  const events = stepVillage(village, { minutes: 1440 * 30 });
  const { w, h } = village.map;
  for (const e of events) {
    if (!e.place) continue;
    assert.ok(e.place.x >= 0 && e.place.x <= w && e.place.y >= 0 && e.place.y <= h, e.text);
    if (e.place.id) assert.ok(place(village.map, e.place.id), e.text);
  }
  // Whatever a resident did happened where they stood, and a finished building is news of its site.
  for (const e of events) if (e.actorIds.length) assert.ok(e.place, e.text);
  const raised = events.filter(e => e.type === 'build' && / is finished| stands /.test(e.text));
  assert.ok(raised.length);
  for (const e of raised) assert.equal(place(village.map, e.place.id)?.kind !== undefined, true, e.text);
  const moot = events.find(e => e.type === 'civic' && e.text.startsWith('The moot'));
  assert.equal(moot.place.id, 'hall');
});
