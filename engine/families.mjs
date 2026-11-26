import { childName, YEAR } from './lives.mjs';
import { vacantCottages, waitingLodgers } from './households.mjs';
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

  // Leave the first finished cottages for the people already waiting to move out of lodgings.
  const site = emptyHomes(state)[waitingLodgers(state).length];
  if (!site) return;
  const adultBread = adultAllowance(world);
  const childBread = Object.values(world.cottages || {}).reduce((count, cottage) => count + eatingChildren(cottage, world.minute), 0);
  const reserve = Math.ceil(actors.length * adultBread + childBread);
  const allowance = 2 * adultBread + profile.children.length;
  const larder = world.cottages?.[site.id]?.larder ?? 0;
  const wanted = Math.max(0, Math.min(Math.floor(allowance), LARDER_HOLDS) - larder);
  // The village must hold ready food of any kind for everyone's allowance and the family's first larder,
  // counted in loaves. The new larder gets bread as far as the shelves allow.
  if (readyLoaves(world.supplies) < reserve + wanted) return;
  const bread = Math.min(wanted, Math.floor(world.supplies.bread));

  const family = { home: site.id, town: profile.town };
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
  prepareCottage(world, mother, site);
  const cottage = world.cottages[site.id];
  cottage.children = [];
  for (const [age, sex] of profile.children) {
    const name = childName(people, cottage, sex, random);
    cottage.children.push({ name, sex, born: world.minute - age * YEAR, parents, birthplace: profile.town,
      position: { ...mother.position }, action: { kind: 'arrive', label: 'Coming up the road with family',
        target: site.id, phase: 'travelling', remaining: 1 } });
  }
  cottage.ration = allowance;
  world.supplies.bread -= bread;
  stockLarder(mother, world, bread);
  arrivals.push({ home: site.id, minute: world.minute, parents, fedDawns: 0 });
  const text = mother.name + ' and ' + father.name + ' came from ' + profile.town + ' with their four children, '
    + cottage.children.slice(0, -1).map(child => child.name).join(', ') + ' and ' + cottage.children.at(-1).name + '.'
    + (bread ? ' The storehouse sent ' + bread + ' loaves to their new cottage.' : '');
  return { adults: [mother, father], parents, text, outcome: { arrival: 'family', home: site.id, children: cottage.children.map(child => child.name), bread } };
}
