import { childName, YEAR } from './lives.mjs';
import { prepareHousehold, vacantCottages, waitingLodgers } from './households.mjs';
import { cottageBatches } from './fresh-food.mjs';
import { dist } from './geom.mjs';
import { place } from './roads.mjs';
import { addPlace, pickLot } from './sites.mjs';
import { remember } from './memory.mjs';
import { dateOf } from './calendar.mjs';
import { WINTER } from './smallholding.mjs';
import { newcomer, POPULATION_LIMIT, travelSeason } from './people.mjs';
import { LARDER_HOLDS, adultAllowance, eatingChildren, stockLarder, storehouseOf } from './storehouse.mjs';
import { prepareCottage } from './village-work.mjs';
import { readyLoaves } from './nutrition.mjs';

const FED_DAWNS = 3;
const FAMILIES = [
  { town: 'Ashby', trades: ['bake', 'mill'], ages: [34, 37], teacher: true, children: [[12, 'm'], [9, 'f'], [6, 'm'], [3, 'f']] },
  { town: 'Elmstead', trades: ['weave', 'cut'], ages: [36, 39], children: [[13, 'f'], [10, 'm'], [7, 'f'], [4, 'm']] },
];
const familyKey = index => 'cottage:new-family-' + (index + 1);
export const isFamilyCottage = key => FAMILIES.some((_, index) => key === familyKey(index));
const emptyHomes = state => vacantCottages(state).filter(home => !state.world.cottages?.[home.id]?.children?.length);

// The village has kept its barley in a barn since the seasonal year. Gives it a building on the map,
// near the fields, once. Safe to repeat.
export function addBarn(map) {
  if (place(map, 'barn')) return null;
  const green = place(map, 'green');
  if (!green) return null;
  const fields = map.places.filter(p => p.kind === 'field');
  const near = fields.length ? [fields.reduce((s, f) => s + f.x, 0) / fields.length, fields.reduce((s, f) => s + f.y, 0) / fields.length] : [green.x, green.y];
  const lot = pickLot(map, 'barn', lot => -dist([lot.x, lot.y], near) - 0.4 * dist([lot.x, lot.y], [green.x, green.y]) + (lot.way === 'road' ? 1 : 0));
  return lot ? addPlace(map, 'barn', lot, { id: 'barn', name: 'Barn', road: lot.road }) : null;
}

// Where an arriving family can keep house while their cottage is built: the loft over a finished
// alehouse, or else the barn. One family lodges in a place at a time.
export function lodgingFor({ world, map }) {
  const taken = new Set((world.familyArrivals || []).filter(f => f.lodging).map(f => f.lodging));
  const loft = map.places.find(p => p.kind === 'alehouse' && p.stage === 2 && !taken.has(p.id));
  const barn = place(map, 'barn');
  return loft ?? (barn?.stage === 2 && !taken.has(barn.id) ? barn : null);
}
export const lodgingName = p => p?.kind === 'alehouse' ? 'the loft over ' + p.name : 'the barn';

// The arrived family a resident belongs to while it lodges, if any.
export const lodgingFamilyOf = (world, actorId) => (world.familyArrivals || []).find(f => f.lodging && f.parents.includes(actorId)) ?? null;

// Moves a lodging family into a cottage: both parents, the children, the larder and what is in it.
// Returns the parents who moved.
export function moveFamilyIn(state, family, site) {
  const { world, actors } = state, from = family.lodging;
  const parents = actors.filter(a => family.parents.includes(a.id));
  if (!from || !parents.length || site?.kind !== 'cottage') return [];
  const lodged = world.cottages?.[from];
  for (const parent of parents) {
    parent.home = site.id;
    if (parent.workplace === from) parent.workplace = site.id;
  }
  prepareCottage(world, parents[0], site);
  const home = world.cottages[site.id];
  if (lodged) {
    home.children = [...(home.children || []), ...(lodged.children || [])];
    home.larder = Math.min(LARDER_HOLDS, (home.larder || 0) + (lodged.larder || 0));
    if (lodged.ration != null) home.ration = lodged.ration;
    if (lodged.preservedFood?.length) home.preservedFood = [...(home.preservedFood || []), ...lodged.preservedFood];
    for (const [item, batches] of Object.entries(lodged.produce || {})) cottageBatches(home, item, true).push(...batches);
    delete world.cottages[from];
  }
  family.home = site.id;
  delete family.lodging;
  world.proposals = (world.proposals || []).filter(p => !parents.some(a => p.key === 'cottage:' + a.id));
  return parents;
}

// A family's oxen graze the verges and the stubble for most of the year. Through the winter months each
// eats a little of the stored hay, a tenth of a bundle a day, so a pair takes about eighteen bundles
// over a winter. When the hay runs out they make do on straw and browse.
export const OX_HAY = 0.1;
export function feedOxen(world) {
  if (!WINTER.has(dateOf(world.minute).month)) return 0;
  const oxen = (world.familyArrivals || []).reduce((n, family) => n + (family.cart?.oxen || 0), 0);
  if (!oxen) return 0;
  world.oxenHayOwed = (world.oxenHayOwed || 0) + oxen * OX_HAY;
  const due = Math.floor(world.oxenHayOwed + 1e-9);
  if (!due) return 0;
  world.oxenHayOwed = Math.round((world.oxenHayOwed - due) * 100) / 100;
  const eaten = Math.min(due, world.supplies.hay || 0);
  world.supplies.hay = (world.supplies.hay || 0) - eaten;
  return eaten;
}

// At dawn a lodging family takes a cottage that stands empty, once the single lodgers have had theirs.
export function settleLodgingFamilies(state, emit) {
  const { world, map } = state;
  for (const family of (world.familyArrivals || []).filter(f => f.lodging).sort((a, b) => a.minute - b.minute)) {
    const site = vacantCottages(state).find(home => !world.cottages?.[home.id]?.children?.length);
    if (!site) return;
    const from = lodgingName(place(map, family.lodging)), parents = moveFamilyIn(state, family, site);
    if (!parents.length) continue;
    const road = map.roads[site.road]?.name;
    const text = parents.map(a => a.name).join(' and ') + ' have moved their family from ' + from + ' into the empty cottage' + (road ? ' on ' + road : '') + '.';
    for (const parent of parents) remember(parent, world.minute, text, parents.map(a => a.id), 'life', { importance: 8 });
    emit('life', text, parents.map(a => a.id), { life: 'moved', family: true }, site.id);
  }
}

export function familyCottageNeeded(state) {
  const { familyArrivals, projects } = state.world;
  if (!familyArrivals || !FAMILIES[familyArrivals.length]) return null;
  const underway = projects.filter(project => project.kind === 'cottage').length;
  return emptyHomes(state).length + underway <= waitingLodgers(state).length ? familyKey(familyArrivals.length) : null;
}

export function recordFamilyBreakfasts({ world, actors }) {
  // The household's own dawn settles its meal before an arrival checks this record.
  for (const family of world.familyArrivals || []) {
    if (family.fedDawns >= FED_DAWNS) continue;
    const guardian = actors.find(actor => family.parents.includes(actor.id));
    const cottage = world.cottages?.[guardian?.home];
    const children = cottage?.children?.filter(child => child.parents?.some(id => family.parents.includes(id)));
    const fed = eatingChildren({ children }, world.minute) > 0 && cottage.hungry === 0;
    family.fedDawns = fed ? family.fedDawns + 1 : 0;
  }
}

export function arrivingFamily(state, random) {
  const { world, actors, map } = state, arrivals = world.familyArrivals;
  const profile = arrivals && FAMILIES[arrivals.length];
  if (!profile || (arrivals[0] && arrivals[0].fedDawns < FED_DAWNS)) return;
  if (actors.length + 2 > POPULATION_LIMIT || !travelSeason(world.minute) || !storehouseOf(map)) return;

  // Leave the first finished cottages for the people already waiting to move out of lodgings. With
  // none to spare, the family comes anyway and keeps house in the alehouse loft or the barn.
  const site = emptyHomes(state)[waitingLodgers(state).length];
  const lodging = site ? null : lodgingFor(state), home = site ?? lodging;
  if (!home) return;
  const adultBread = adultAllowance(world);
  const childBread = Object.values(world.cottages || {}).reduce((count, cottage) => count + eatingChildren(cottage, world.minute), 0);
  const reserve = Math.ceil(actors.length * adultBread + childBread);
  const allowance = 2 * adultBread + profile.children.length;
  const larder = world.cottages?.[home.id]?.larder ?? 0;
  const wanted = Math.max(0, Math.min(Math.floor(allowance), LARDER_HOLDS) - larder);
  // The village must hold ready food of any kind for everyone's allowance and the family's first larder,
  // counted in loaves. The new larder gets bread as far as the shelves allow.
  if (readyLoaves(world.supplies) < reserve + wanted) return;
  const bread = Math.min(wanted, Math.floor(world.supplies.bread));

  const family = { home: home.id, town: profile.town };
  const mother = newcomer(state, random, profile.trades[0], { ...family, sex: 'f', age: profile.ages[0] });
  const surname = mother.name.split(' ').at(-1);
  const father = newcomer({ ...state, actors: [...actors, mother] }, random, profile.trades[1],
    { ...family, sex: 'm', age: profile.ages[1], start: mother.position, surname });
  const parents = [mother.id, father.id];
  const people = { actors: [...actors, mother, father] };
  for (const [parent, spouse] of [[mother, father], [father, mother]]) {
    parent.spouse = spouse.id;
    parent.spouseName = spouse.name;
    parent.relationships[spouse.id] = 85;
    parent.trust = { [spouse.id]: 80 };
    parent.met = { [spouse.id]: world.minute };
  }
  if (profile.teacher) {
    father.schoolTeacher = true;
    father.goals.push('Teach the children of Dalecrest their letters and reading at the hall');
    father.backstory += ' He learned his letters from a clerk and hopes to teach children in Dalecrest.';
  }
  if (site) prepareCottage(world, mother, site);
  else {
    // A lodging household keeps its children and larder, and takes its fuel from the common store.
    world.cottages ??= {};
    prepareHousehold(world.cottages[home.id] = { lodging: true, woodpile: 0 });
  }
  const cottage = world.cottages[home.id];
  cottage.children = [];
  for (const [age, sex] of profile.children) {
    const name = childName(people, cottage, sex, random);
    cottage.children.push({ name, sex, born: world.minute - age * YEAR, parents, birthplace: profile.town,
      position: { ...mother.position }, action: { kind: 'arrive', label: 'Coming up the road with family',
        target: home.id, phase: 'travelling', remaining: 1 } });
  }
  cottage.ration = allowance;
  world.supplies.bread -= bread;
  stockLarder(mother, world, bread);
  // They bring their goods on a two-wheeled cart drawn by a pair of oxen.
  arrivals.push({ home: home.id, ...(lodging && { lodging: home.id }), minute: world.minute, parents, fedDawns: 0, cart: { oxen: 2 } });
  const text = mother.name + ' and ' + father.name + ' came from ' + profile.town + ' on an ox-cart with their four children, '
    + cottage.children.slice(0, -1).map(child => child.name).join(', ') + ' and ' + cottage.children.at(-1).name + '.'
    + (lodging ? ' No cottage stands free for them yet, so they have made a home in ' + lodgingName(lodging) + ' until one is built.' : '')
    + (bread ? ' The storehouse sent ' + bread + ' loaves to ' + (lodging ? 'them' : 'their new cottage') + '.' : '');
  return { adults: [mother, father], parents, text, outcome: { arrival: 'family', home: home.id, lodging: lodging?.id ?? null, children: cottage.children.map(child => child.name), bread } };
}
