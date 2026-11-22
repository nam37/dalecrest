import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { actionBody } from './decisions.mjs';
import { weatherAt } from './engine/seasons.mjs';
import { place, route } from './engine/roads.mjs';
import { isWater } from './engine/terrain.mjs';

const tick = (village, minutes = 1) => stepVillage(village, { minutes, externalActions: true });

function choose(village, actor, prefix) {
  actor.action = { kind: 'waiting', phase: 'waiting', remaining: 0, target: actor.action.target, since: village.world.minute };
  const id = [...availableActions(actor, village).keys()].find(key => key.startsWith(prefix));
  assert.ok(id, prefix);
  const selected = startChosen(actor, village, id, { id: '42' });
  assert.ok(selected);
  return selected.action;
}

test('weeding and watering change the saved strip and its next barley growth', () => {
  const village = createVillage();
  const agnes = village.actors[0];
  const { world } = village;
  const site = world.barleyStrip.site;
  const seen = JSON.parse(actionBody(agnes, world, availableActions(agnes, village))).input[0].content[0].data;
  assert.deepEqual(seen.ownBarleyStrip, { weeds: 'crowded', soil: 'dry', barleyReady: true });
  choose(village, agnes, 'work:weed:');
  assert.equal(tick(village, 35).find(e => e.outcome?.job === 'weed').outcome.status, 'completed');
  assert.equal(world.barleyStrip.weeds, 0);
  choose(village, agnes, 'work:waterBarley:');
  const resumed = JSON.parse(JSON.stringify(village));
  const water = tick(resumed, 29).find(e => e.outcome?.job === 'waterBarley');
  assert.deepEqual(water.outcome.stockDelta, { water: -2 });
  assert.equal(resumed.world.barleyStrip.moisture, 4);
  assert.equal(resumed.world.supplies.water, world.supplies.water - 2);
  resumed.world.fields[site] = 0;
  resumed.world.minute = 1799;
  tick(resumed);
  assert.equal(resumed.world.fields[site], 3);
  resumed.world.minute = 2160;
  const reaping = choose(resumed, resumed.actors[0], 'work:harvest:');
  assert.equal(reaping.target, site);
  assert.ok(tick(resumed, 110).some(event => event.actorIds.includes(agnes.id) && /brought three measures of barley/.test(event.text)));
  assert.equal(resumed.world.fields[site], 0);

  const rainy = createVillage();
  let rain = 540;
  while (!weatherAt(rain, rainy.map.seed).rain) rain += 180;
  rainy.world.minute = rain - 1;
  tick(rainy);
  assert.equal(rainy.world.barleyStrip.moisture, 2);
});

test('Agnes can repair her own bed and a migrated village remembers the repair', () => {
  const village = createVillage();
  const agnes = village.actors[0];
  delete village.world.cottages;
  tick(village, 0);
  agnes.action = { kind: 'rest', phase: 'working', remaining: 10, target: agnes.home };
  agnes.needs.fatigue = 40;
  tick(village);
  assert.ok(Math.abs(agnes.needs.fatigue - 39.85) < 0.001);
  choose(village, agnes, 'work:repairBed:');
  const repair = tick(village, 140).find(e => e.outcome?.job === 'repairBed');
  assert.deepEqual(repair.outcome.stockDelta, { wood: -2 });
  assert.match(repair.text, /at home/);
  const resumed = JSON.parse(JSON.stringify(village));
  tick(resumed, 0);
  assert.equal(resumed.world.cottages[agnes.home].brokenBed, false);
  assert.ok(![...availableActions(resumed.actors[0], resumed).keys()].some(id => id.includes('repairBed') || id.startsWith('ask:thomas:bed:')));
});

test('Thomas can accept the in-person request and complete it at the right cottage', () => {
  const village = createVillage();
  const agnes = village.actors[0], thomas = village.actors.find(actor => actor.id === 'thomas');
  agnes.position = { ...thomas.position };
  choose(village, agnes, 'ask:thomas:bed:');
  tick(village, 2);
  const [request] = Object.values(village.world.helpRequests);
  assert.equal(request.status, 'asked');
  assert.equal(request.site, agnes.home);
  choose(village, thomas, 'accept:agnes:');
  tick(village, 2);
  assert.equal(request.status, 'accepted');
  const shift = choose(village, thomas, 'work:repairBed:');
  assert.equal(shift.target, agnes.home);
  assert.equal(shift.remaining, 40);
  const events = tick(village, 140);
  const repair = events.find(e => e.outcome?.job === 'repairBed');
  assert.deepEqual(repair.outcome.stockDelta, { wood: -1 });
  assert.equal(repair.outcome.commitmentId, request.id);
  assert.equal(repair.place.id, agnes.home);
  assert.ok(events.some(e => e.outcome?.verb === 'kept'));
  assert.equal(village.world.cottages[agnes.home].brokenBed, false);
  assert.equal(village.world.helpRequests[request.id], undefined);
});

function moveTo(village, actor, site) {
  const [x, y] = place(village.map, site).at;
  actor.position = { x, y };
}

test('cottage chores recur, without consuming timber twice', () => {
  const village = createVillage();
  const agnes = village.actors[0], { world } = village;
  const cottage = world.cottages[agnes.home];
  moveTo(village, agnes, agnes.home);
  cottage.floorDue = world.minute;
  choose(village, agnes, 'work:sweep:');
  assert.ok(tick(village, 19).some(event => event.outcome?.job === 'sweep'));
  const repair = choose(village, agnes, 'work:repairFloor:');
  const result = tick(village, repair.remaining).find(event => event.outcome?.job === 'repairFloor');
  assert.deepEqual(result.outcome.stockDelta, { wood: -1 });
  const choices = () => [...availableActions(agnes, village).keys()];
  assert.ok(!choices().some(id => id.includes('sweep') || id.includes('repairFloor')));
  world.minute = cottage.sweepDue;
  assert.ok(choices().some(id => id.includes('sweep')));
});

test('fishing gathers bait in the same action, catches fish, and wears out a saved pole', () => {
  const village = createVillage();
  const hugh = village.actors.find(actor => actor.id === 'hugh'), { world, map } = village;
  const bank = place(map, 'fishing-bank');
  assert.ok(bank && !isWater(map, ...bank.at, 0.4));
  assert.ok(route(map, [hugh.position.x, hugh.position.y], bank.id));
  moveTo(village, hugh, bank.id);
  hugh.fishing = { bait: 0, wear: 2 };
  world.minute = 720;
  choose(village, hugh, 'work:fish:');
  tick(village, 12);
  assert.equal(hugh.action.label, 'Gathering bait on the bank');
  assert.equal(hugh.fishing.bait, 0);
  const resumed = JSON.parse(JSON.stringify(village));
  const fisher = resumed.actors.find(actor => actor.id === 'hugh');
  tick(resumed);
  assert.equal(fisher.action.label, 'Fishing from the bank');
  assert.equal(fisher.fishing.bait, 2);
  const result = tick(resumed, fisher.action.remaining).find(event => event.outcome?.job === 'fish');
  assert.equal(result.outcome.status, 'completed');
  assert.equal(result.place.id, bank.id);
  assert.equal(fisher.fishing.wear, 3);
  assert.match(result.text, /caught two fish/);
  assert.deepEqual(result.outcome.stockDelta, { fish: 2 });
  assert.ok(![...availableActions(fisher, resumed).keys()].some(id => id.startsWith('work:fish:')));
  choose(resumed, fisher, 'work:mendPole:');
  const repair = tick(resumed, 110).find(event => event.outcome?.job === 'mendPole');
  assert.deepEqual(repair.outcome.stockDelta, { repair: -1 });
  assert.equal(fisher.fishing.wear, 0);
});

test('game and fish become meals, leather and preserves, while fresh stock can spoil', () => {
  const village = createVillage();
  const oswin = village.actors.find(actor => actor.id === 'oswin'), { world } = village;
  world.minute = 720;
  moveTo(village, oswin, 'wood');
  const hunt = choose(village, oswin, 'work:hunt:');
  const result = tick(village, hunt.remaining).find(event => event.outcome?.job === 'hunt');
  assert.deepEqual(result.outcome.stockDelta, { game: 1 });

  moveTo(village, oswin, 'hall');
  const work = job => {
    const { remaining } = choose(village, oswin, 'work:' + job + ':');
    return tick(village, remaining).find(event => event.outcome?.job === job).outcome.stockDelta;
  };
  assert.deepEqual(work('dressGame'), { game: -1, meat: 3, hide: 1 });
  assert.deepEqual(work('tanHide'), { hide: -1, water: -2, leather: 1 });
  assert.deepEqual(work('smokeMeat'), { meat: -3, wood: -1, preserved: 3 });
  world.supplies.fish = 6;
  assert.deepEqual(work('cookFish'), { fish: -2, wood: -1, cooked: 3 });
  assert.deepEqual(work('cureFish'), { fish: -3, wood: -1, preserved: 3 });
  world.minute = 1799;
  tick(village);
  assert.equal(world.supplies.fish, 0);
  assert.equal(world.supplies.cooked, 1);
  assert.equal(world.supplies.preserved, 6);
  oswin.needs.hunger = 80;
  const meal = choose(village, oswin, 'food:cooked:');
  assert.ok(tick(village, meal.remaining).some(event => event.type === 'meal' && /cooked meal/.test(event.text)));
  assert.equal(world.supplies.cooked, 0);
  assert.ok(oswin.needs.hunger < 25);
});
