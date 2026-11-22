import { hash2 } from './geom.mjs';
import { clearWalk, nearestOnRoads, place } from './roads.mjs';
import { addPlace } from './sites.mjs';

export const CAST_MINUTES = 55;
export const BAIT_MINUTES = 12;
export const LINE_WEAR_LIMIT = 3;

export const provisions = { game: 4, meat: 12, hide: 6, fish: 12, cooked: 16, preserved: 20, leather: 12 };

export const forageJobs = {
  hunt: { label: 'Looking for game', task: 'hunt', duration: 62, makes: { game: 1 } },
  dressGame: { label: 'Skinning and dressing game', task: 'dressing', duration: 42, takes: { game: 1 }, makes: { meat: 3, hide: 1 },
    result: 'dressed the game and brought meat and a raw hide to the common stores' },
  cookMeat: { label: 'Cooking game for supper', task: 'cooking', duration: 36, takes: { meat: 2, wood: 1 }, makes: { cooked: 3 }, indoors: true,
    result: 'cooked three portions of game for the hall' },
  smokeMeat: { label: 'Smoking game for later', task: 'smoking', duration: 76, takes: { meat: 3, wood: 1 }, makes: { preserved: 3 }, indoors: true,
    result: 'hung three portions of smoked game in the hall’s stores' },
  tanHide: { label: 'Tanning a hide', task: 'tanning', duration: 92, takes: { hide: 1, water: 2 }, makes: { leather: 1 },
    result: 'finished a piece of leather from a game hide' },
  fish: { label: 'Fishing for supper', task: 'fishing', duration: CAST_MINUTES, makes: { fish: 2 } },
  mendPole: { label: 'Mending the fishing pole', task: 'pole repair', duration: 31, takes: { repair: 1 }, makes: {}, indoors: true,
    result: 'mended the fishing pole and can cast again' },
  cookFish: { label: 'Cooking the river catch', task: 'cooking', duration: 27, takes: { fish: 2, wood: 1 }, makes: { cooked: 3 }, indoors: true,
    result: 'cooked three portions of fish for the hall' },
  cureFish: { label: 'Curing fish for later', task: 'curing', duration: 62, takes: { fish: 3, wood: 1 }, makes: { preserved: 3 }, indoors: true,
    result: 'put away three portions of cured fish in the hall’s stores' }
};

const dayOf = minute => Math.floor(minute / 1440);
const outingsToday = (actor, job, minute) => actor.outings?.[job] === dayOf(minute);

export function addFishingBank(map) {
  if (place(map, 'fishing-bank')) return;
  // Find a dry near-bank landing with a clear connection to a lane or path.
  const { cx, cy, river, riverWidth } = map.terrain;
  let best, value = Infinity;
  for (const [x, y] of river) {
    if (Math.abs(y - cy) > 20) continue;
    for (let margin = 0.8; margin <= 3; margin += 0.5) {
      const point = [x - riverWidth / 2 - margin, y];
      const road = nearestOnRoads(map, point);
      if (!road || road.d < 1.6 || road.d > 12 || !clearWalk(map, [road.x, road.y], point)) continue;
      const cost = Math.hypot(point[0] - cx, y - cy) + road.d;
      if (cost < value) { best = point; value = cost; }
    }
  }
  if (best) addPlace(map, 'fishing', { x: best[0], y: best[1], at: best }, { id: 'fishing-bank', name: 'Fishing bank' });
}

export function offerForaging(actor, { world, map }, offer, sky, daylight, weary) {
  const gear = actor.fishing;
  if (gear?.wear >= LINE_WEAR_LIMIT) {
    offer('mendPole', actor.home, 49 - weary * 0.6, 'My fishing pole needs work before I can cast again.');
  }
  if (daylight) {
    if (place(map, 'wood') && !outingsToday(actor, 'hunt', world.minute)) {
      offer('hunt', 'wood', (actor.trade === 'cut' ? 48 : 27) - weary, 'I can look for game in the coppice.');
    }
    if (place(map, 'fishing-bank') && !outingsToday(actor, 'fish', world.minute) && !(gear?.wear >= LINE_WEAR_LIMIT) && sky.snow < 0.55) {
      const gather = !gear?.bait;
      offer('fish', 'fishing-bank', (actor.trade === 'mill' || actor.trade === 'draw' ? 47 : 28) - weary,
        gather ? 'I can gather bait on the bank before I cast.' : 'I have bait and can cast from the riverbank.',
        gather ? { duration: CAST_MINUTES + BAIT_MINUTES, label: 'Gathering bait and fishing for supper' } : {});
    }
  }
  offer('dressGame', 'hall', 49 - weary, 'There is game to dress at the hall.');
  offer('tanHide', 'hall', 37 - weary, 'There is a hide to tan at the hall.');
  const roomForSupper = world.supplies.cooked < 5;
  for (const job of ['cookMeat', 'cookFish']) {
    offer(job, 'hall', (roomForSupper ? 55 : 32) - weary, 'Cooking fresh food gives the village another supper.');
  }
  for (const job of ['smokeMeat', 'cureFish']) {
    offer(job, 'hall', (roomForSupper ? 40 : 53) - weary, 'Preserving the surplus will keep it for another day.');
  }
}

export function advanceForageShift(actor) {
  const action = actor.action;
  if (action.job === 'hunt' && action.remaining <= 34) action.label = 'Following game trails';
  if (action.job !== 'fish' || action.cast) return;
  if (action.remaining > CAST_MINUTES) {
    action.label = 'Gathering bait on the bank';
    return;
  }
  const gear = actor.fishing ??= { bait: 0, wear: 0 };
  if (!gear.bait) gear.bait = 3;
  gear.bait--;
  action.cast = true;
  action.label = 'Fishing from the bank';
}

export function outingResult(actor, { world, map }, sky) {
  const job = actor.action.job;
  if (job !== 'hunt' && job !== 'fish') return;
  let resident = 0;
  for (const letter of actor.id) resident = Math.imul(31, resident) + letter.charCodeAt(0);
  const roll = hash2(map.seed + (job === 'fish' ? 73 : 102), dayOf(world.minute), resident);
  if (job === 'hunt') {
    return roll < (sky.snow || sky.rain > 0.5 ? 0.32 : 0.53)
      ? { makes: { game: 1 }, result: 'brought game back from the coppice' }
      : { makes: {}, result: 'searched the coppice and returned empty-handed' };
  }
  return roll < (sky.rain > 0.5 ? 0.42 : 0.72)
    ? { makes: { fish: 2 }, result: 'caught two fish at the riverbank' }
    : { makes: {}, result: 'fished from the bank without a catch' };
}

export function finishForageShift(actor, world, result) {
  const job = actor.action.job;
  if (job === 'mendPole') actor.fishing.wear = 0;
  if (job === 'fish' || job === 'hunt') {
    (actor.outings ??= {})[job] = dayOf(world.minute);
    if (job === 'fish') {
      const gear = actor.fishing ??= { bait: 0, wear: 0 };
      gear.wear++;
      if (gear.wear === LINE_WEAR_LIMIT) return result + ', and the pole needs mending before the next outing';
    }
  }
  return result;
}
