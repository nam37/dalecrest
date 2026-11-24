// Households. Each cottage keeps its own woodpile and larder, filled by its people carrying firewood home
// from the common woodpile and drawing the household's bread at the storehouse. A cottage hearth burns
// only from its own pile, so one household can wake to a cold house while the village's woodpile still
// stands. The hall, where lodgers sleep, is kept by the village and draws on the common store directly.
import { LARDER_HOLDS, drawable, stockLarder, storehouseOf, STOREHOUSE } from './storehouse.mjs';
import { place } from './roads.mjs';

export { LARDER_HOLDS };
export const WOODPILE_HOLDS = 9;
const YEAR = 365 * 1440;

// How many loaves a bread draw takes is settled when the shift ends, by what is due to the household.
export const householdJobs = {
  fetchWood: { label: 'Carrying firewood home', task: 'carrying firewood', duration: 26, takes: { wood: 3 }, makes: {} },
  fetchBread: { label: 'Drawing the household’s bread', task: 'drawing bread', duration: 12, takes: {}, makes: {} },
};
// The loaves a bread draw would take now.
export const breadDraw = (actor, world) => ({ bread: Math.max(1, drawable(actor, world)) });

export function prepareHousehold(cottage) {
  cottage.woodpile ??= 2;
  cottage.larder ??= 0;
  cottage.burnOwed ??= 0;
}

// Who lives in a cottage: its residents and their children.
export function householdOf(world, actors, home) {
  const cottage = world.cottages?.[home];
  return { cottage, people: actors.filter(a => a.home === home), children: cottage?.children || [] };
}

export function vacantCottages({ world, actors, map }) {
  return map.places.filter(site => site.kind === 'cottage' && site.stage === 2 && !actors.some(actor => actor.home === site.id)
    && !(world.projects || []).some(project => project.id === site.id));
}

export function waitingLodgers({ actors, map }) {
  return actors.filter(actor => place(map, actor.home)?.kind !== 'cottage' && !actor.spouse);
}

// Days a woodpile lasts at a day's burn. A pile in mild weather lasts as long as it likes.
export const pileDays = (cottage, rate) => rate > 0 ? cottage.woodpile / rate : Infinity;

// What a resident can do for their own household. `rate` is what a hearth burns today.
export function householdChoices(actor, { world, map }, offer, weary, rate) {
  const cottage = world.cottages?.[actor.home];
  if (!cottage) return;
  const days = pileDays(cottage, rate);
  // Whether the village woodpile or the oven has enough is the caller's to judge, by what this resident knows.
  if (cottage.woodpile <= WOODPILE_HOLDS - 3) {
    const want = rate > 0 ? (days < 1 ? 62 : days < 3 ? 46 : 24) : 12;
    offer('fetchWood', 'wood', want - weary,
      rate > 0 ? 'The woodpile at home holds ' + count(cottage.woodpile) + ', about ' + Math.floor(days) + ' days at this cold.'
        : 'The woodpile at home holds ' + count(cottage.woodpile) + '. A pile laid in now will see the house into the cold.');
  }
  // A household with children lays in their bread before morning. Anyone else draws it when they eat.
  const kids = (cottage.children || []).filter(c => world.minute - c.born >= YEAR).length;
  if (map && storehouseOf(map) && cottage.larder < kids + 1 && drawable(actor, world) >= 1) {
    offer('fetchBread', STOREHOUSE, 30 + kids * 8 - weary, 'There ' + (cottage.larder === 1 ? 'is one loaf' : 'are ' + cottage.larder + ' loaves')
      + ' in the larder at home, and the household’s bread is due at the storehouse.');
  }
}

const count = n => n === 1 ? 'one bundle' : (Math.floor(n * 10) / 10) + ' bundles';

export function householdObstacle(actor, world) {
  const { job } = actor.action, cottage = world.cottages?.[actor.home];
  if (!cottage) return 'there was no house of their own to carry it to';
  if (job === 'fetchWood' && cottage.woodpile > WOODPILE_HOLDS - 3) return 'the woodpile at home was already full';
  if (job === 'fetchBread') {
    if (cottage.larder >= LARDER_HOLDS) return 'the larder at home was already full';
    if (drawable(actor, world) < 1) return world.supplies.bread < 1 ? 'the shelves at the storehouse were bare' : 'nothing more was due to the household today';
  }
  return null;
}

export function finishHousehold(actor, world) {
  const { job } = actor.action, cottage = world.cottages[actor.home];
  if (job === 'fetchWood') {
    cottage.woodpile += 3;
    return 'carried three bundles of firewood home from the village woodpile';
  }
  if (job === 'fetchBread') {
    // The loaves left the shelves with the shift's stock change. They go into the larder here.
    const n = actor.action.drawn || 0;
    stockLarder(actor, world, n);
    return 'drew ' + (n === 1 ? 'the household’s loaf' : n + ' loaves') + ' at the storehouse for the larder at home';
  }
}

// At dawn on a cold day every hearth burns its day's firewood: a cottage from its own pile, owing any
// fraction of a bundle to tomorrow, and the hall from the common store. Returns the hearths that went cold.
export function burnHearths(world, homes, rate) {
  const cold = [];
  let hallTaken = 0;
  for (const home of homes) {
    const cottage = world.cottages?.[home];
    if (!cottage) {
      // The hall keeps its fire while the common store has a bundle for it.
      const want = rate + (world.fuelCarry || 0), whole = Math.floor(want + 1e-9);
      if (whole <= world.supplies.wood) {
        world.supplies.wood -= whole;
        hallTaken += whole;
        world.fuelCarry = Math.round((want - whole) * 100) / 100;
      } else {
        cold.push(home);
        world.fuelCarry = 0;
      }
      continue;
    }
    prepareHousehold(cottage);
    const want = rate + cottage.burnOwed, whole = Math.floor(want + 1e-9);
    if (whole <= cottage.woodpile) {
      cottage.woodpile -= whole;
      cottage.burnOwed = Math.round((want - whole) * 100) / 100;
    } else {
      cold.push(home);
      cottage.burnOwed = 0;
    }
  }
  return { cold: cold.sort(), hallTaken };
}

// What a resident knows of their own household, for the action model.
export function householdContext(actor, world, rate) {
  const cottage = world.cottages?.[actor.home];
  if (!cottage) return {};
  return { ownHousehold: {
    woodpile: Math.floor(cottage.woodpile * 10) / 10 + ' bundles' + (rate > 0 ? ', about ' + Math.floor(pileDays(cottage, rate)) + ' days at today’s cold' : ''),
    larder: cottage.larder + ' loaves',
    ...(cottage.children?.length && { children: cottage.children.map(c => c.name) }),
  } };
}
