// Newcomers. A prosperous village with room at the hall draws travellers off the road,
// and each one takes up the trade the village is shortest of.
import { placesOf } from './roads.mjs';
import { dist } from './geom.mjs';
import { fieldsFeed } from './civic.mjs';
import { dateOf } from './calendar.mjs';
import { daysToHarvest, foodDays, mouths } from './stores.mjs';
import { NAMES, YEAR } from './lives.mjs';
import { createAppearance } from './appearance.mjs';

export const POPULATION_LIMIT = 36;
export function travelSeason(minute) {
  const { month } = dateOf(minute);
  return month >= 3 && month <= 10;
}
const FIRST = ['Wat', 'Joan', 'Piers', 'Cecily', 'Giles', 'Maud', 'Simon', 'Isolde', 'Ralph', 'Margery', 'Adam', 'Emma',
  'Walter', 'Beatrix', 'Hob', 'Avice', 'Roger', 'Sybil', 'Gilbert', 'Elena', 'Martin', 'Idonea', 'Stephen', 'Juliana',
  'Nicholas', 'Felice', 'Hamo', 'Rohese', 'Bartholomew', 'Amice'];
const LAST = ['Underhill', 'Atwood', 'Carter', 'Greenway', 'Hayward', 'Stiles', 'Cooper', 'Turner', 'Ford', 'Hollis',
  'Dale', 'Thorne', 'Rowe', 'Bell', 'Lyle', 'Shepherd', 'Fletcher', 'Wainwright', 'Barrow', 'Kemp', 'Sedge', 'Oakes'];
const TOWNS = ['Ashby', 'Thornwick', 'Marlow Cross', 'Harrowdene', 'Wenlock', 'Stowe Ferry', 'Pendle', 'Coldharbour', 'Elmstead', 'Barrowby'];
const TRAITS = ['steadfast', 'generous', 'meticulous', 'reserved', 'gregarious', 'restless'];
const REASONS = ['a flood took the lower fields', 'the lord enclosed the common', 'a fire in the long barn', 'a quarrel over an inheritance',
  'two bad harvests', 'the old master died without an heir'];
// Trade, the kind of place it is worked at, role names, goal and a line of history.
const TRADES = {
  harvest: ['field', ['Field hand', 'Ploughman', 'Reaper'], 'Bring in a harvest that is partly my own', 'has followed the plough since childhood and reads the weather in the swallows'],
  mill: ['mill', ['Miller’s hand'], 'Learn the stones well enough to be trusted with them', 'once dressed millstones and still carries the pick'],
  bake: ['oven', ['Baker'], 'See that no household waits on its bread', 'kneads by feel and distrusts any loaf that rises too fast'],
  cut: ['wood', ['Woodcutter', 'Hurdle maker'], 'Keep the woodpile ahead of the winter', 'can name a tree by the sound of the axe in it'],
  weave: ['home', ['Weaver', 'Spinner'], 'Set up a loom that pays its way', 'carried a spindle the whole road and never stopped turning it'],
  mend: ['hall', ['Carpenter', 'Thatcher'], 'Leave every roof in Dalecrest sounder than I found it', 'learned to cut a joint that needs no nail'],
  draw: ['well', ['Water carrier'], 'Keep every barrel in the village full', 'has a yoke worn smooth to the shape of one pair of shoulders'],
  keep: ['storehouse', ['Storekeeper'], 'Keep the storehouse honest and tell the village what is running short', 'kept the tally sticks at a priory grange and can count a shelf at a glance'],
};

function shortestTrade(state, random) {
  const { actors, map } = state, pop = actors.length + 1;
  const ideal = {
    harvest: Math.ceil(placesOf(map, 'field', false).length * 0.9), mill: 1 + Math.floor(pop / 16), bake: 1 + Math.floor(pop / 12),
    cut: 1 + Math.floor(pop / 10), weave: 1 + Math.floor(pop / 12), mend: 1 + Math.floor(pop / 8), draw: 1 + Math.floor(pop / 14),
  };
  let best = null, lack = -Infinity;
  // The storehouse sends for its own keeper. A traveller looking for work takes up another trade.
  for (const trade of Object.keys(TRADES).filter(t => t !== 'keep')) {
    const value = ideal[trade] - actors.filter(a => a.trade === trade).length + random() * 0.9;
    if (value > lack) { lack = value; best = trade; }
  }
  return best;
}

export function wantsNewcomer(state) {
  const { world, actors, map } = state, pop = actors.length;
  // Word of a small village with spare bread travels fast; a larger one fills more slowly.
  if (pop >= POPULATION_LIMIT || world.minute - world.lastArrival < 1440 * (2 + 0.75 * Math.max(0, pop - 8)) - 60) return false;
  // The hall has two beds for lodgers. A storekeeper sleeps at the storehouse.
  if (actors.filter(a => a.home === 'hall').length > 1) return false;
  // Nobody takes to the roads between November and February.
  if (!travelSeason(world.minute)) return false;
  // Travellers stay where there is bread on the table, food in store to see one more to the next harvest
  // with a margin, and land enough to feed them.
  return world.supplies.bread >= pop * 0.75 && foodDays(world, mouths(state) + 1) >= daysToHarvest(world.minute) + 20
    && fieldsFeed(map) >= pop + 1;
}

// A child of the village who has come of age, ready to take up a trade beside their household.
export function grownChild(state, child, home, random) {
  const { world, actors, map } = state;
  const pick = list => list[Math.floor(random() * list.length)];
  const parents = actors.filter(a => child.parents?.includes(a.id));
  const surname = child.surname || parents[0]?.name.split(' ').slice(1).join(' ') || pick(LAST);
  const taken = new Set(actors.map(a => a.id));
  let id = child.id ?? child.name.toLowerCase().replace(/[^a-z]+/g, '-');
  while (taken.has(id)) id += '-' + (world.arrivals + actors.length);
  const trade = parents.map(p => p.trade).find(t => TRADES[t]) || shortestTrade(state, random), [kind, roles, goal] = TRADES[trade];
  const traits = [pick(TRAITS)];
  let second = pick(TRAITS);
  while (second === traits[0]) second = pick(TRAITS);
  traits.push(second);
  let workplace = home;
  if (kind !== 'home') workplace = placesOf(map, kind)[0]?.id || 'hall';
  const at = map.places.find(p => p.id === home)?.at || [map.w / 2, map.h / 2];
  return {
    id, name: child.name + ' ' + surname, role: pick(roles), home, workplace, trade, traits, born: child.born, sex: child.sex,
    appearance: child.appearance ?? createAppearance({ id: child.id ?? id }),
    backstory: child.name + ' was born in ' + (child.birthplace || 'Dalecrest') + (parents.length ? ' to ' + parents.map(p => p.name).join(' and ') : '')
      + (child.birthplace ? ', and came to Dalecrest with their family.' : ', and has grown up among its lanes and fields.'),
    goals: [goal, 'Make a life of my own in Dalecrest'],
    needs: { hunger: 30, fatigue: 20, loneliness: 30, cold: 0 },
    relationships: Object.fromEntries(parents.map(p => [p.id, 75])), memories: [], plan: null, position: { x: at[0], y: at[1] },
    action: { kind: 'idle', label: 'Starting out', reason: 'Old enough now to work beside the household.', target: home, phase: 'working', remaining: 0 },
    lastChat: world.minute, lastJob: world.minute, daysWorked: 0, lastWorkDay: -1, arrived: world.minute,
  };
}

function entrance(map, random) {
  const gate = map.nodes[map.gates[random() < 0.7 ? 0 : 1]];
  return { x: Math.min(map.w - 1, Math.max(1, gate[0])), y: gate[1] };
}

// A traveller who takes up the trade the village is shortest of, or the one named.
export function newcomer(state, random, wanted, family) {
  const { world, actors, map } = state;
  const pick = list => list[Math.floor(random() * list.length)];
  const taken = new Set(actors.map(a => a.id));
  const names = family ? NAMES[family.sex] : FIRST;
  const free = names.filter(n => !taken.has(n.toLowerCase()));
  const name = free.length ? pick(free) : pick(names) + ' the younger';
  let id = name.toLowerCase().replace(/[^a-z]+/g, '-');
  while (taken.has(id)) id += '-' + (world.arrivals + 1);
  const trade = TRADES[wanted] ? wanted : shortestTrade(state, random), [kind, roles, goal, craft] = TRADES[trade];
  const traits = [pick(TRAITS)];
  let second = pick(TRAITS);
  while (second === traits[0]) second = pick(TRAITS);
  traits.push(second);
  const start = family?.start ?? entrance(map, random);
  let workplace = kind === 'home' && family ? family.home : 'hall';
  if (kind !== 'home') {
    const sites = placesOf(map, kind);
    if (sites.length) workplace = sites.reduce((a, b) => dist(a.at, [start.x, start.y]) <= dist(b.at, [start.x, start.y]) ? a : b).id;
  }
  const surnames = new Set(actors.map(a => a.name.split(' ').pop()));
  const spare = LAST.filter(n => !surnames.has(n));
  const full = name + ' ' + (family?.surname ?? pick(spare.length ? spare : LAST));
  // A storekeeper sleeps among the goods, as a keeper should, until there is a cottage to spare.
  const home = family?.home ?? (trade === 'keep' && workplace !== 'hall' ? workplace : 'hall');
  const role = pick(roles);
  const story = family ? name + ' came from ' + family.town + ' with their family.' : name + ' walked in from ' + pick(TOWNS) + ' after ' + pick(REASONS) + '.';
  const reason = family ? 'There was a cottage ready for their household in Dalecrest.'
    : trade === 'keep' ? 'Word on the road was that Dalecrest had built a storehouse and wanted someone to keep it.'
    : 'Word on the road was that Dalecrest had bread and work to spare.';
  return {
    id, name: full, role, home, workplace, trade, traits,
    appearance: createAppearance({ id, arrived: world.minute }),
    ...(family && { sex: family.sex, born: world.minute - family.age * YEAR }),
    backstory: story + ' ' + name + ' ' + craft + '.',
    goals: [goal, 'Find a place among the households of Dalecrest'],
    needs: { hunger: 38 + Math.floor(random() * 20), fatigue: 30 + Math.floor(random() * 20), loneliness: 45 + Math.floor(random() * 20), cold: 0 },
    relationships: {}, memories: [], plan: null, position: { ...start },
    action: { kind: 'arrive', label: 'Coming up the road to Dalecrest', reason, target: home, phase: 'travelling', remaining: 25 },
    lastChat: world.minute, lastJob: world.minute, daysWorked: 0, lastWorkDay: -1, arrived: world.minute,
  };
}
