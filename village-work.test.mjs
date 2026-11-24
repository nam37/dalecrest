import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, locationsOf, startChosen, stepVillage } from './sim.mjs';
import { actionBody } from './decisions.mjs';
import { weatherAt } from './engine/seasons.mjs';
import { ripeningOn } from './engine/stores.mjs';
import { place, route } from './engine/roads.mjs';
import { isWater } from './engine/terrain.mjs';
import { FRESH_LIFE } from './engine/fresh-food.mjs';
import { SHOE_WEAR } from './engine/footwear.mjs';
import { shapeActionMenu } from './engine/action-menu.mjs';

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
  // A weeded, watered strip ripens half again as fast as the season and the year would give it.
  const grown = ripeningOn(1800, resumed.map.seed, weatherAt(1800, resumed.map.seed)) * 1.5;
  assert.ok(grown > 3);
  assert.equal(resumed.world.fields[site], grown);
  resumed.world.minute = 2160;
  const reaping = choose(resumed, resumed.actors[0], 'work:harvest:');
  assert.equal(reaping.target, site);
  assert.ok(tick(resumed, 110).some(event => event.actorIds.includes(agnes.id) && /brought three measures of barley/.test(event.text)));
  assert.equal(resumed.world.fields[site], grown - 3);

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

test('game and fish become meals, leather and preserves, while cooked stock spoils at dawn', () => {
  const village = createVillage();
  const oswin = village.actors.find(actor => actor.id === 'oswin'), { world } = village;
  world.minute = 720;
  moveTo(village, oswin, 'wood');
  const hunt = choose(village, oswin, 'work:hunt:');
  const result = tick(village, hunt.remaining).find(event => event.outcome?.job === 'hunt');
  assert.deepEqual(result.outcome.stockDelta, { game: 1 });

  moveTo(village, oswin, 'hall');
  // Leather and preserves are carried to the storehouse, and count when they are on its shelves.
  const work = job => {
    choose(village, oswin, 'work:' + job + ':');
    for (let i = 0; i < 300; i++) {
      const done = tick(village).find(event => event.outcome?.job === job);
      if (done) return done.outcome.stockDelta;
    }
  };
  assert.deepEqual(work('dressGame'), { game: -1, meat: 3, hide: 1 });
  assert.deepEqual(work('tanHide'), { hide: -1, water: -2, leather: 1 });
  assert.deepEqual(work('smokeMeat'), { meat: -3, wood: -1, preserved: 3 });
  assert.deepEqual(world.freshFood.preserved, [{ quantity: 3, origins: { game: 1 } }]);
  world.supplies.fish = 4;
  assert.deepEqual(work('cookFish'), { fish: -2, wood: -1, cooked: 3 });
  assert.deepEqual(work('cureFish'), { fish: -2, wood: -1, preserved: 2 });
  world.minute = 1799;
  tick(village);
  assert.equal(world.supplies.fish, 0);
  assert.equal(world.supplies.cooked, 1);
  assert.equal(world.supplies.preserved, 5);
  oswin.needs.hunger = 80;
  choose(village, oswin, 'food:cooked:');
  let ate = false;
  for (let i = 0; i < 120 && !ate; i++) ate = tick(village).some(event => event.type === 'meal' && /cooked meal/.test(event.text));
  assert.ok(ate);
  assert.equal(world.supplies.cooked, 0);
  assert.ok(oswin.needs.hunger < 25);
});

test('legacy raw food survives one dawn, then expires once across a saved game', () => {
  const village = createVillage(), { world } = village;
  world.minute = 1799;
  world.supplies.game = 1;
  world.supplies.fish = 1;
  tick(village, 0);
  const expires = 1799 + FRESH_LIFE;
  assert.deepEqual(world.freshFood.game, [{ quantity: 1, expires }]);
  tick(village);
  assert.equal(world.supplies.game, 1);
  assert.equal(world.supplies.fish, 1);
  const resumed = JSON.parse(JSON.stringify(village));
  resumed.world.minute = expires - 1;
  const spoiled = tick(resumed).find(e => e.outcome?.spoiled);
  assert.deepEqual(spoiled.outcome.spoiled, { fish: 1, game: 1 });
  assert.equal(resumed.world.supplies.game, 0);
  assert.equal(resumed.world.supplies.fish, 0);
  assert.ok(!tick(resumed).some(e => e.outcome?.spoiled));
});

test('one catch can be claimed for curing, carried to the storehouse and counted on delivery', () => {
  const village = createVillage(), { world, actors, map } = village;
  const fisher = actors.find(actor => actor.id === 'hugh'), [cook] = actors;
  world.minute = 720;
  moveTo(village, fisher, 'fishing-bank');
  const outing = choose(village, fisher, 'work:fish:');
  assert.ok(tick(village, outing.remaining).some(event => event.outcome?.stockDelta?.fish === 2));
  const expires = world.freshFood.fish[0].expires;
  assert.equal(expires, world.minute + FRESH_LIFE);
  fisher.observations ??= {};
  fisher.observations.storehouse = { site: 'storehouse', minute: world.minute, stock: { bread: 8, cloth: 0, preserved: 0, leather: 0 } };
  const names = locationsOf(map, actors);
  const decision = () => {
    const { menu, audit } = shapeActionMenu(fisher, village, availableActions(fisher, village));
    return { audit, ...JSON.parse(actionBody(fisher, world, menu, names)).input[0].content[0].data };
  };
  assert.equal(decision().processingOptions.find(option => option.choice === 'work:cureFish:hall').oldestIngredientSpoilsAt, undefined);
  moveTo(village, fisher, 'hall');
  const prompt = decision();
  assert.equal(prompt.audit.protected['work:cureFish:hall'], 'restocking');
  assert.equal(prompt.restockingOpportunity.choice, 'work:cureFish:hall');
  assert.match(prompt.processingOptions.find(option => option.choice === 'work:cureFish:hall').oldestIngredientSpoilsAt, /August 1312 at/);
  const cure = choose(village, fisher, 'work:cureFish:');
  assert.ok(!availableActions(cook, village).has('work:cookFish:hall'));
  const doneAtHall = tick(village, cure.remaining);
  assert.ok(!doneAtHall.some(event => event.outcome?.job === 'cureFish'));
  assert.equal(world.supplies.fish, 0);
  assert.equal(world.supplies.preserved, 0);
  assert.deepEqual(fisher.action.carrying, { preserved: 2 });
  const resumed = JSON.parse(JSON.stringify(village));
  const delivered = tick(resumed, 100).find(event => event.outcome?.job === 'cureFish');
  assert.match(delivered.text, /cured two portions.*took them to the storehouse/);
  assert.deepEqual(delivered.outcome.stockDelta, { fish: -2, wood: -1, preserved: 2 });
  assert.equal(resumed.world.supplies.preserved, 2);
  assert.deepEqual(resumed.world.freshFood.preserved, [{ quantity: 2, origins: { fish: 1 } }]);
});

test('processing takes the oldest fish and a new catch keeps its own expiry', () => {
  const village = createVillage(), { world, actors: [cook] } = village;
  world.minute = 720;
  world.supplies.fish = 2;
  tick(village, 0);
  const oldest = world.freshFood.fish[0].expires;
  world.minute += 90;
  world.supplies.fish += 2;
  tick(village, 0);
  moveTo(village, cook, 'hall');
  const action = choose(village, cook, 'work:cookFish:');
  assert.ok(tick(village, action.remaining).some(event => event.outcome?.stockDelta?.fish === -2));
  assert.deepEqual(world.freshFood.fish, [{ quantity: 2, expires: oldest + 90 }]);
  world.minute = oldest - 1;
  assert.ok(!tick(village).some(e => e.outcome?.spoiled?.fish));
  assert.equal(world.supplies.fish, 2);
});

test('one piece of delivered leather repairs shoes and makes a long walk less tiring', () => {
  const village = createVillage(), { world, actors: [actor] } = village;
  world.minute = 720;
  world.supplies.leather = 1;
  actor.shoeWear = SHOE_WEAR;
  moveTo(village, actor, 'storehouse');
  const leather = choose(village, actor, 'work:repairShoes:');
  const result = tick(village, leather.remaining).find(event => event.outcome?.job === 'repairShoes');
  assert.deepEqual(result.outcome.stockDelta, { leather: -1 });
  assert.equal(world.supplies.leather, 0);
  assert.equal(actor.shoeWear, 0);
  assert.ok(!availableActions(actor, village).has('work:repairShoes:storehouse'));
  actor.needs.fatigue = 20;
  actor.action = { kind: 'work', job: 'cut', phase: 'travelling', remaining: 78, target: 'wood', label: 'Stacking firewood' };
  const worn = structuredClone(village);
  worn.actors[0].shoeWear = SHOE_WEAR;
  tick(village, 10);
  tick(worn, 10);
  assert.deepEqual(worn.actors[0].position, actor.position);
  assert.ok(worn.actors[0].needs.fatigue > actor.needs.fatigue + 1);
});
