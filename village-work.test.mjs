import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { actionBody } from './decisions.mjs';
import { weatherAt } from './engine/seasons.mjs';

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
