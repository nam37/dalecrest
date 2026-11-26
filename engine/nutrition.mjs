import { batchTotal, cottageBatches, larderFoods } from './fresh-food.mjs';
import { forageJobs } from './foraging.mjs';
import { eatingChildren } from './storehouse.mjs';
import { LOAVES } from './stores.mjs';

export const HUNGER = { bread: 53, cooked: 58, preserved: 48, peas: 48, apples: 32 };
export const CHILD_NEED = HUNGER.preserved;
export const HUNGRY_AT_DAWN = 85;
export const hungerPerMinute = cold => 0.042 + 0.012 * cold;
const yieldPer = (job, input, output) => forageJobs[job].makes[output] / forageJobs[job].takes[input];

// The ready food in the hall and the Storehouse, counted in loaves by how much hunger it relieves: bread,
// salt fish and smoked meat, cooked portions, peas and apples, and raw fish, meat, game and mutton as the
// portions they cook into. Grain and flour still wait on the mill and the oven, so they are not counted.
export function readyLoaves(supplies) {
  const meat = (supplies.meat || 0) + (supplies.game || 0) * yieldPer('dressGame', 'game', 'meat');
  const meals = (supplies.fish || 0) * yieldPer('cookFish', 'fish', 'cooked') + meat * yieldPer('cookMeat', 'meat', 'cooked')
    + (supplies.mutton || 0) * yieldPer('cookMutton', 'mutton', 'cooked');
  const relief = (supplies.bread || 0) * HUNGER.bread + (supplies.preserved || 0) * HUNGER.preserved
    + ((supplies.cooked || 0) + meals) * HUNGER.cooked + (supplies.peas || 0) * HUNGER.peas + (supplies.apples || 0) * HUNGER.apples;
  return relief / HUNGER.bread;
}

// A mixed portion divides its actual relief in the same proportions as its ingredients.
export function mealRecord(household, food, hungerRelieved, amounts, child) {
  const sources = amounts ?? { [food === 'bread' ? 'bread' : 'unknown']: 1 };
  return { household, food, portions: 1, hungerRelieved, ...(child && { child }), sources: Object.keys(sources).sort()
    .map(source => ({ source, portions: sources[source], hungerRelieved: hungerRelieved * sources[source] })) };
}

export function relieveHunger(actor, points) {
  const relief = Math.min(actor.needs.hunger, points);
  actor.needs.hunger -= relief;
  return relief;
}

export function foodReserve({ world, actors }, cold) {
  const { supplies, minute } = world;
  let larders = 0, children = 0;
  for (const cottage of Object.values(world.cottages || {})) {
    children += eatingChildren(cottage, minute);
    larders += (cottage.larder || 0) * HUNGER.bread;
    for (const item of larderFoods) larders += batchTotal(cottageBatches(cottage, item)) * HUNGER[item];
  }
  const hall = supplies.cooked * HUNGER.cooked + supplies.peas * HUNGER.peas + supplies.apples * HUNGER.apples;
  const storehouse = supplies.bread * HUNGER.bread + supplies.preserved * HUNGER.preserved;
  // A theoretical yield before labour, fuel, spoilage and capacity limits. Each ingredient appears once.
  const meat = supplies.meat + supplies.game * yieldPer('dressGame', 'game', 'meat');
  const meals = supplies.fish * yieldPer('cookFish', 'fish', 'cooked') + meat * yieldPer('cookMeat', 'meat', 'cooked')
    + supplies.mutton * yieldPer('cookMutton', 'mutton', 'cooked');
  const unprepared = (supplies.grain * LOAVES.grain + supplies.flour * LOAVES.flour) * HUNGER.bread
    + meals * HUNGER.cooked;
  const dailyNeed = actors.length * 1440 * hungerPerMinute(cold) + children * CHILD_NEED;
  const days = points => dailyNeed ? points / dailyNeed : null;
  return { minute, dailyNeed, hallDays: days(hall), storehouseDays: days(storehouse), larderDays: days(larders),
    readyDays: days(hall + storehouse + larders), unpreparedDays: days(unprepared) };
}
