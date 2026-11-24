import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { dateOf } from './engine/calendar.mjs';
import { batchTotal, cottageBatches } from './engine/fresh-food.mjs';
import { place } from './engine/roads.mjs';
import { farmSites, sheepCount } from './engine/smallholding.mjs';
import { parishLayout, visibleSheep } from './public/parish.js';

const DAY = 1440;
const step = (village, minutes = 1) => stepVillage(village, { minutes, externalActions: true });
const dayWhen = (month, day = 1) => {
  for (let minute = 0; minute < 370 * DAY; minute += DAY) {
    const date = dateOf(minute);
    if (date.month === month && date.day === day) return minute;
  }
  throw new Error('Date outside test year');
};

function work(village, id, site, choice) {
  const actor = village.actors.find(person => person.id === id);
  assert.ok(actor, id);
  const [x, y] = place(village.map, site).at;
  actor.position = { x, y };
  actor.action = { kind: 'waiting', phase: 'waiting', remaining: 0, target: site, since: village.world.minute };
  assert.ok(availableActions(actor, village).has(choice), choice);
  const selected = startChosen(actor, village, choice, { id: 'fixture' });
  const events = step(village, selected.action.remaining);
  if (actor.action.carrying) events.push(...step(village, 100));
  return events;
}

test('a sown and tended pea plot and the mature orchard feed households and the hall', () => {
  const village = createVillage(), { world, map, actors: [agnes] } = village;
  const garden = farmSites.garden.id, orchard = farmSites.orchard.id;
  assert.equal(place(map, garden).kind, 'garden');
  assert.equal(place(map, orchard).kind, 'orchard');
  world.supplies.bread = 0;
  world.minute = dayWhen(3, 15) + 720;
  work(village, agnes.id, garden, 'work:sowPeas:' + garden);
  const sown = world.smallholding.garden.sownAt;
  assert.ok(Number.isFinite(sown));
  assert.ok(!availableActions(agnes, village).has('work:harvestPeas:' + garden));
  world.minute = sown + 12 * DAY;
  work(village, agnes.id, garden, 'work:tendPeas:' + garden);
  assert.equal(world.smallholding.garden.tended, true);
  world.minute = dayWhen(4) + 359;
  step(village);
  world.minute = sown + 56 * DAY;
  const picked = work(village, agnes.id, garden, 'work:harvestPeas:' + garden)
    .find(event => event.outcome?.job === 'harvestPeas');
  assert.equal(picked.outcome.stockDelta.peas, 8);
  assert.match(picked.text, /to the hall/);

  work(village, agnes.id, 'hall', 'work:fetchPeas:hall');
  const cottage = world.cottages[agnes.home];
  const deadline = world.freshFood.peas[0].expires;
  assert.equal(cottageBatches(cottage, 'peas')[0].expires, deadline);
  agnes.needs.hunger = 80;
  const lunch = work(village, agnes.id, agnes.home, 'food:peas:' + agnes.home).find(event => event.type === 'meal');
  assert.equal(lunch.outcome.meal.sources[0].source, 'produce');
  assert.match(lunch.text, /bowl of peas.*at home/);
  world.minute = deadline - 1;
  const spoiled = step(village).find(event => event.outcome?.spoiled?.peas);
  assert.equal(spoiled.outcome.spoiled.peas, 6);
  assert.equal(batchTotal(cottageBatches(cottage, 'peas')), 0);

  // The orchard began its fruit cycle at the spring dawn.
  const ripeAt = world.smallholding.orchard.fruit.readyAt;
  world.minute = ripeAt + 360;
  const apples = work(village, agnes.id, orchard, 'work:harvestApples:' + orchard)
    .find(event => event.outcome?.job === 'harvestApples');
  assert.equal(apples.outcome.stockDelta.apples, 6);
  agnes.needs.hunger = 80;
  const eaten = work(village, agnes.id, 'hall', 'food:apples:hall').find(event => event.type === 'meal');
  assert.equal(eaten.outcome.meal.sources[0].source, 'produce');
  assert.match(eaten.text, /ate an apple at the hall/);
});

test('hay carries the flock through winter, spring lambing replenishes it, and a sheep becomes a meal', () => {
  let village = createVillage(), { world } = village;
  const pasture = farmSites.pasture.id, flock = world.smallholding.flock, layout = parishLayout(village.map);
  const first = sheepCount(flock);
  assert.equal(visibleSheep(layout, world).length, first);
  work(village, 'oswin', pasture, 'work:takeMutton:' + pasture);
  assert.equal(sheepCount(flock), first - 1);
  assert.equal(visibleSheep(layout, world).length, first - 1);
  assert.equal(world.supplies.mutton, 4);
  assert.ok(!availableActions(village.actors.find(actor => actor.id === 'oswin'), village).has('work:takeMutton:' + pasture));
  work(village, 'oswin', 'hall', 'work:smokeMutton:hall');
  assert.equal(world.supplies.preserved, 3);
  village.actors[0].needs.hunger = 80;
  const supper = work(village, village.actors[0].id, 'hall', 'food:preserved:hall').find(event => event.type === 'meal');
  assert.equal(supper.outcome.meal.sources[0].source, 'livestock');
  assert.equal(supper.outcome.meal.hungerRelieved, 48);

  world.minute = dayWhen(9, 15) + 660;
  for (let n = 0; n < 4; n++) work(village, 'oswin', pasture, 'work:cutHay:' + pasture);
  assert.equal(world.supplies.hay, 91);
  // Advance each winter dawn through the normal village step, including a save and reload.
  const start = dayWhen(12), end = dayWhen(3);
  let used = 0;
  for (let day = start; day < end; day += DAY) {
    if (day === start + 40 * DAY) {
      village = JSON.parse(JSON.stringify(village));
      world = village.world;
    }
    world.minute = day + 359;
    const previous = world.supplies.hay;
    assert.ok(!step(village).some(event => event.outcome?.flock === 'winterLoss'));
    used += previous - world.supplies.hay;
  }
  assert.equal(used, (end - start) / DAY);
  assert.equal(sheepCount(world.smallholding.flock), 4);

  world.minute = dayWhen(3, 30) + 720;
  work(village, 'oswin', pasture, 'work:tendSheep:' + pasture);
  world.minute = dayWhen(4) + 359;
  const birth = step(village).find(event => event.outcome?.flock === 'lambing');
  assert.equal(birth.outcome.lambs, 3);
  assert.equal(sheepCount(world.smallholding.flock), 7);
  assert.equal(visibleSheep(layout, world).length, 7);
});
