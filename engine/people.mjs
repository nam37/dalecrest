// Newcomers. A prosperous village with room at the hall draws travellers off the road,
// and each one takes up the trade the village is shortest of.
import { placesOf } from './roads.mjs';
import { dist } from './geom.mjs';
import { isLodger, fieldsFeed } from './civic.mjs';

export const POPULATION_LIMIT = 36;
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
};

function shortestTrade(state, random) {
  const { actors, map } = state, pop = actors.length + 1;
  const ideal = {
    harvest: Math.ceil(placesOf(map, 'field', false).length * 0.9), mill: 1 + Math.floor(pop / 16), bake: 1 + Math.floor(pop / 12),
    cut: 1 + Math.floor(pop / 10), weave: 1 + Math.floor(pop / 12), mend: 1 + Math.floor(pop / 8), draw: 1 + Math.floor(pop / 14),
  };
  let best = null, lack = -Infinity;
  for (const trade of Object.keys(TRADES)) {
    const value = ideal[trade] - actors.filter(a => a.trade === trade).length + random() * 0.9;
    if (value > lack) { lack = value; best = trade; }
  }
  return best;
}

export function wantsNewcomer(state) {
  const { world, actors, map } = state, pop = actors.length;
  // Word of a small village with spare bread travels fast; a larger one fills more slowly.
  if (pop >= POPULATION_LIMIT || world.minute - world.lastArrival < 1440 * (2 + 0.75 * Math.max(0, pop - 8)) - 60) return false;
  if (actors.filter(a => isLodger(a, map)).length > 1) return false;
  // Travellers stay where there is bread on the table and land enough to feed one more.
  return world.supplies.bread >= pop * 0.75 && world.supplies.grain + world.supplies.flour >= pop * 0.8 && fieldsFeed(map) >= pop + 1;
}

export function newcomer(state, random) {
  const { world, actors, map } = state;
  const pick = list => list[Math.floor(random() * list.length)];
  const taken = new Set(actors.map(a => a.id));
  const free = FIRST.filter(n => !taken.has(n.toLowerCase()));
  const name = free.length ? pick(free) : pick(FIRST) + ' the younger';
  let id = name.toLowerCase().replace(/[^a-z]+/g, '-');
  while (taken.has(id)) id += '-' + (world.arrivals + 1);
  const trade = shortestTrade(state, random), [kind, roles, goal, craft] = TRADES[trade];
  const traits = [pick(TRAITS)];
  let second = pick(TRAITS);
  while (second === traits[0]) second = pick(TRAITS);
  traits.push(second);
  const gate = map.nodes[map.gates[random() < 0.7 ? 0 : 1]];
  const start = { x: Math.min(map.w - 1, Math.max(1, gate[0])), y: gate[1] };
  let workplace = 'hall';
  if (kind !== 'home') {
    const sites = placesOf(map, kind);
    if (sites.length) workplace = sites.reduce((a, b) => dist(a.at, [start.x, start.y]) <= dist(b.at, [start.x, start.y]) ? a : b).id;
  }
  const surnames = new Set(actors.map(a => a.name.split(' ').pop()));
  const spare = LAST.filter(n => !surnames.has(n));
  const full = name + ' ' + pick(spare.length ? spare : LAST);
  return {
    id, name: full, role: pick(roles), home: 'hall', workplace, trade, traits,
    backstory: name + ' walked in from ' + pick(TOWNS) + ' after ' + pick(REASONS) + '. ' + name + ' ' + craft + '.',
    goals: [goal, 'Find a place among the households of Dalecrest'],
    needs: { hunger: 38 + Math.floor(random() * 20), fatigue: 30 + Math.floor(random() * 20), loneliness: 45 + Math.floor(random() * 20), cold: 0 },
    relationships: {}, memories: [], plan: null, position: start,
    action: { kind: 'arrive', label: 'Coming up the road to Dalecrest', reason: 'Word on the road was that Dalecrest had bread and work to spare.', target: 'hall', phase: 'travelling', remaining: 25 },
    lastChat: world.minute, lastJob: world.minute, daysWorked: 0, lastWorkDay: -1, arrived: world.minute,
  };
}
