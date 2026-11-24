import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { addStock, batchTotal } from './engine/fresh-food.mjs';
import { CHILD_NEED, HUNGER, foodReserve } from './engine/nutrition.mjs';
import { shapeActionMenu } from './engine/action-menu.mjs';
import { place } from './engine/roads.mjs';

const step = (village, minutes = 1) => stepVillage(village, { minutes, externalActions: true });
function act(village, actor, site, prefix) {
  const { world, map } = village, [x, y] = place(map, site).at;
  actor.position = { x, y };
  actor.action = { kind: 'waiting', phase: 'waiting', target: site, remaining: 0, since: world.minute };
  const choice = [...availableActions(actor, village).keys()].find(id => id.startsWith(prefix));
  assert.ok(choice, prefix);
  const { action } = startChosen(actor, village, choice, { id: 'fixture' });
  return step(village, action.remaining);
}

test('a breadless family draws preserved portions for breakfast while another household goes hungry', () => {
  const village = createVillage(), { world, actors: [agnes, hugh] } = village;
  world.minute = 1200;
  world.supplies.bread = 0;
  const child = name => ({ name, sex: 'f', born: world.minute - 8 * 365.25 * 1440, parents: [] });
  const home = world.cottages[agnes.home], otherHome = world.cottages[hugh.home];
  home.children = [child('Ellen'), child('Joan')];
  otherHome.children = [child('Alice')];
  addStock(world, 'preserved', 1, { fish: 1 });
  addStock(world, 'preserved', 1, { game: 1 });
  addStock(world, 'preserved', 1, { tradedFish: 1 });

  const before = foodReserve(village, 0);
  const { audit } = shapeActionMenu(agnes, village, availableActions(agnes, village));
  assert.equal(audit.protected['work:fetchPreserved:storehouse'], 'household_breakfast');
  const drawn = act(village, agnes, 'storehouse', 'work:fetchPreserved:').find(event => event.outcome?.job === 'fetchPreserved');
  assert.deepEqual(drawn.outcome.stockDelta, { preserved: -2 });
  assert.equal(batchTotal(home.preservedFood), 2);
  assert.equal(world.supplies.preserved, 1);
  const after = foodReserve(village, 0);
  assert.equal(after.readyDays, before.readyDays);
  assert.ok(after.storehouseDays < before.storehouseDays);
  assert.ok(Math.abs(after.larderDays - 2 * HUNGER.preserved / after.dailyNeed) < 1e-12);

  agnes.needs.hunger = 75;
  const supper = act(village, agnes, 'hall', 'food:preserved:').find(e => e.type === 'meal');
  assert.deepEqual(supper.outcome.meal.sources, [{ source: 'tradedFish', portions: 1, hungerRelieved: HUNGER.preserved }]);
  assert.equal(supper.outcome.meal.household, agnes.home);
  assert.equal(world.supplies.preserved, 0);

  const resumed = JSON.parse(JSON.stringify(village));
  resumed.world.minute = 1799;
  const breakfast = step(resumed);
  assert.deepEqual(breakfast.filter(e => e.type === 'meal').map(e => e.outcome.meal.sources[0]), [
    { source: 'fish', portions: 1, hungerRelieved: CHILD_NEED }, { source: 'game', portions: 1, hungerRelieved: CHILD_NEED },
  ]);
  assert.equal(resumed.world.cottages[agnes.home].hungry, 0);
  assert.equal(resumed.world.cottages[hugh.home].hungry, 1);
  assert.equal(batchTotal(resumed.world.cottages[agnes.home].preservedFood), 0);
  const dawn = breakfast.find(e => e.outcome?.foodReserve).outcome;
  assert.equal(dawn.missedBreakfasts, 1);
  assert.equal(dawn.foodReserve.readyDays, 0);
  assert.ok(dawn.foodReserve.unpreparedDays > 0);
});

test('a mixed cooked batch preserves its source shares through spoilage and credits actual relief', () => {
  const village = createVillage(), { world, actors: [agnes] } = village;
  world.minute = 720;
  world.supplies.fish = 1;
  world.supplies.cooked = 1;
  step(village, 0);
  addStock(world, 'fish', 1, { fish: 1 });
  act(village, agnes, 'hall', 'work:cookFish:');
  assert.equal(world.supplies.cooked, 4);
  world.minute = 1799;
  step(village);
  assert.equal(world.supplies.cooked, 2);
  assert.equal(batchTotal(world.freshFood.cooked), 2);
  agnes.needs.hunger = 32;
  const { outcome: { meal } } = act(village, agnes, 'hall', 'food:cooked:').find(e => e.type === 'meal');
  assert.ok(meal.hungerRelieved >= 32 && meal.hungerRelieved < HUNGER.cooked);
  assert.equal(meal.portions, 1);
  assert.deepEqual(Object.fromEntries(meal.sources.map(s => [s.source, s.portions])), { unknown: 0.5, fish: 0.5 });
  assert.equal(meal.sources.reduce((relief, source) => relief + source.hungerRelieved, 0), meal.hungerRelieved);
});
