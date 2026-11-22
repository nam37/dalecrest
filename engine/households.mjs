// Households. Each cottage keeps its own woodpile and larder, filled by its people carrying firewood and
// loaves home from the common stores. A cottage hearth burns only from its own pile, so one household
// can wake to a cold house while the village's woodpile still stands. The hall, where lodgers sleep,
// is kept by the village and draws on the common store directly.

export const WOODPILE_HOLDS = 9;
export const LARDER_HOLDS = 8;

export const householdJobs = {
  fetchWood: { label: 'Carrying firewood home', task: 'carrying firewood', duration: 26, takes: { wood: 3 }, makes: {} },
  fetchBread: { label: 'Taking loaves home', task: 'taking bread home', duration: 12, takes: { bread: 3 }, makes: {} },
};

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

// Days a woodpile lasts at a day's burn. A pile in mild weather lasts as long as it likes.
export const pileDays = (cottage, rate) => rate > 0 ? cottage.woodpile / rate : Infinity;

// What a resident can do for their own household. `rate` is what a hearth burns today.
export function householdChoices(actor, { world }, offer, weary, rate) {
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
  const mouths = actor.spouse ? 2 : 1, kids = cottage.children?.length || 0;
  if (cottage.larder + 3 <= LARDER_HOLDS && cottage.larder < mouths + kids) {
    offer('fetchBread', 'oven', 34 + kids * 8 - weary, 'There ' + (cottage.larder === 1 ? 'is one loaf' : 'are ' + cottage.larder + ' loaves') + ' in the larder at home.');
  }
}

const count = n => n === 1 ? 'one bundle' : (Math.floor(n * 10) / 10) + ' bundles';

export function householdObstacle(actor, world) {
  const { job } = actor.action, cottage = world.cottages?.[actor.home];
  if (!cottage) return 'there was no house of their own to carry it to';
  if (job === 'fetchWood' && cottage.woodpile > WOODPILE_HOLDS - 3) return 'the woodpile at home was already full';
  if (job === 'fetchBread' && cottage.larder + 3 > LARDER_HOLDS) return 'the larder at home was already full';
  return null;
}

export function finishHousehold(actor, world) {
  const { job } = actor.action, cottage = world.cottages[actor.home];
  if (job === 'fetchWood') {
    cottage.woodpile += 3;
    return 'carried three bundles of firewood home from the village woodpile';
  }
  if (job === 'fetchBread') {
    cottage.larder += 3;
    return 'took three loaves home for the larder';
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
