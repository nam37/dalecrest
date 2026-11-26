import { dateOf } from './calendar.mjs';
import { dist } from './geom.mjs';
import { place } from './roads.mjs';
import { addPlace, pickLot } from './sites.mjs';

const DAY = 1440;
export const PEAS_RIPE = 56 * DAY, PEAS_LAST = 25 * DAY;
export const FRUIT_RIPE = 150 * DAY;
const SPRING_MONTHS = [30, 31, 30, 31, 31, 30, 31];
const MAX_SHEEP = 8, HAY_BATCH = 24;
export const WINTER = new Set([12, 1, 2]);
export const farmStock = { peas: 16, apples: 22, mutton: 12, hay: 184 };
export const farmSites = {
  garden: { id: 'kitchen-garden', name: 'Kitchen garden' },
  orchard: { id: 'apple-orchard', name: 'Apple orchard' },
  pasture: { id: 'sheep-pasture', name: 'Sheep pasture' },
};
export const isFarmSite = kind => Object.hasOwn(farmSites, kind);
export const sheepCount = flock => flock.ewes + flock.rams + flock.spare + flock.lambs;

export const farmJobs = {
  sowPeas: { site: 'garden', label: 'Sowing peas', task: 'sowing peas', duration: 36, takes: { water: 1 }, makes: {},
    score: 57, reason: 'This is the season to sow peas for the summer.' },
  tendPeas: { site: 'garden', label: 'Tending the pea plot', task: 'tending peas', duration: 25, takes: { water: 1 }, makes: {},
    score: 50, reason: 'Weeding and watering the pea rows will improve the harvest.' },
  harvestPeas: { site: 'garden', label: 'Picking peas for the hall', task: 'picking peas', duration: 29, makes: { peas: 1 },
    delivery: 'hall', foodSource: 'produce', score: 69, reason: 'There are ripe peas to pick and take to the hall.' },
  plantApple: { site: 'orchard', label: 'Planting an apple sapling', task: 'planting an apple tree', duration: 48, takes: { water: 1 }, makes: {},
    score: 48, reason: 'One more apple tree can go in while the sap is low.' },
  pruneApples: { site: 'orchard', label: 'Pruning the apple trees', task: 'pruning apples', duration: 38, makes: {},
    score: 51, reason: 'Pruning the trees before blossom will give us more fruit.' },
  harvestApples: { site: 'orchard', label: 'Picking apples for the hall', task: 'picking apples', duration: 36, makes: { apples: 1 },
    delivery: 'hall', foodSource: 'produce', score: 66, reason: 'The apples are ripe and can keep in the hall for weeks.' },
  tendSheep: { site: 'pasture', label: 'Tending the sheep', task: 'tending the flock', duration: 31, makes: {},
    score: 53, reason: 'The flock is due for a check and the pasture needs tending.' },
  cutHay: { site: 'pasture', label: 'Cutting hay for winter', task: 'cutting hay', duration: 52, makes: { hay: 1 },
    score: 60, reason: 'The flock will need hay when the pasture stops growing.' },
  takeMutton: { site: 'pasture', label: 'Preparing mutton for the hall', task: 'preparing mutton', duration: 55, makes: { mutton: 1 },
    delivery: 'hall', foodSource: 'livestock', score: 55, reason: 'The flock has a grown sheep to spare for meat.' },
};

export function normalizeSmallholding({ world, map }) {
  const green = place(map, 'green');
  const { minute } = world, { month } = dateOf(minute);
  if (!world.smallholding) {
    for (const [kind, site] of Object.entries(farmSites)) {
      if (place(map, site.id)) continue;
      const lot = pickLot(map, kind, candidate => -dist([green.x, green.y], [candidate.x, candidate.y]));
      if (lot) addPlace(map, kind, lot, { ...site, road: lot.road });
    }
    world.smallholding = {
      // The founding gardens were already being worked. A new spring still needs sowing.
      garden: { sownAt: month === 7 || month === 8 ? minute - PEAS_RIPE : null, tended: false, picked: 0 },
      orchard: { trees: 3, saplings: [], fruit: null, prunedYear: null },
      flock: { ewes: 3, rams: 1, spare: 1, lambs: 0, lastTended: minute, hayOwed: 0, shortDays: 0 },
    };
    beginFruit(world);
  }
}

function beginFruit(world) {
  const { minute, smallholding: { orchard } } = world, { month, year, day } = dateOf(minute);
  if (month < 4 || month > 10 || orchard.fruit?.year === year) return;
  const sinceBloom = SPRING_MONTHS.slice(0, month - 4).reduce((sum, days) => sum + days, day - 1);
  const bloom = Math.floor(minute / DAY) * DAY + 360 - sinceBloom * DAY;
  orchard.fruit = { year, readyAt: bloom + FRUIT_RIPE, remaining: orchard.trees * (orchard.prunedYear === year ? 4 : 3) };
}

const hayTarget = flock => Math.min(farmStock.hay, Math.ceil(sheepCount(flock) * 91 / 4));
const room = (world, item) => Math.max(0, world.capacity[item] - world.supplies[item]);
const daysSinceSown = (garden, minute) => garden.sownAt == null ? Infinity : minute - garden.sownAt;

// Used both when making a menu and when a shift finishes. Another worker may have got there first.
function ready(world, job, { month, year }) {
  const { minute, smallholding: { garden, orchard, flock }, supplies } = world;
  const age = daysSinceSown(garden, minute);
  switch (job) {
    case 'sowPeas': return month >= 3 && month <= 6 && (age >= PEAS_RIPE + PEAS_LAST || garden.picked >= (garden.tended ? 8 : 4));
    case 'tendPeas': return age >= 10 * DAY && age < PEAS_RIPE && !garden.tended;
    case 'harvestPeas': return age >= PEAS_RIPE && age < PEAS_RIPE + PEAS_LAST && garden.picked < (garden.tended ? 8 : 4) && room(world, 'peas') > 0;
    case 'plantApple': return month === 3 && orchard.trees + orchard.saplings.length < 4;
    case 'pruneApples': return (month === 2 || month === 3) && orchard.trees > 0 && orchard.prunedYear !== year;
    case 'harvestApples': return month <= 10 && orchard.fruit?.year === year && minute >= orchard.fruit.readyAt
      && orchard.fruit.remaining > 0 && room(world, 'apples') > 0;
    case 'tendSheep': return sheepCount(flock) > 0 && minute - flock.lastTended >= 6 * DAY;
    case 'cutHay': return month >= 6 && month <= 9 && supplies.hay < hayTarget(flock);
    case 'takeMutton': return flock.spare > 0 && room(world, 'mutton') >= 4 && supplies.mutton === 0;
    default: return false;
  }
}

export function farmChoices(actor, { world, actors, map }, offer, weary, daylight) {
  if (!daylight || !world.smallholding) return;
  const gardener = actors.find(person => person.id === 'agnes') ?? actors.find(person => person.trade === 'harvest') ?? actors[0];
  const shepherd = actors.find(person => person.id === 'oswin') ?? actors.find(person => person.trade === 'cut') ?? gardener;
  if (actor !== gardener && actor !== shepherd) return;
  const date = dateOf(world.minute);
  const choices = Object.entries(farmJobs).filter(([job, spec]) => (spec.site === 'pasture' ? actor === shepherd : actor === gardener)
    && place(map, farmSites[spec.site].id) && ready(world, job, date));
  const first = choices.reduce((best, entry) => !best || entry[1].score > best[1].score ? entry : best, null);
  for (const [job, spec] of choices) offer(job, farmSites[spec.site].id, spec.score - weary, spec.reason, { seasonalFood: job === first?.[0] });
}

export function farmObstacle(world, job) {
  return ready(world, job, dateOf(world.minute)) ? null : 'the crop or flock no longer needed that work';
}

export function farmOutput(world, key, job) {
  const { garden, orchard, flock } = world.smallholding;
  if (key === 'harvestPeas') return { peas: Math.min((garden.tended ? 8 : 4) - garden.picked, room(world, 'peas')) };
  if (key === 'harvestApples') return { apples: Math.min(6, orchard.fruit?.remaining ?? 0, room(world, 'apples')) };
  if (key === 'cutHay') return { hay: Math.min(HAY_BATCH, Math.max(0, hayTarget(flock) - world.supplies.hay), room(world, 'hay')) };
  if (key === 'takeMutton') return { mutton: 4 };
  return job.makes;
}

export function finishFarmWork(world, job, made) {
  const { garden, orchard, flock } = world.smallholding, { minute } = world;
  switch (job) {
    case 'sowPeas': Object.assign(garden, { sownAt: minute, tended: false, picked: 0 }); return 'sowed peas in the kitchen garden';
    case 'tendPeas': garden.tended = true; return 'weeded and watered the pea rows';
    case 'harvestPeas': garden.picked += made.peas; return 'picked ' + made.peas + ' bowls’ worth of peas';
    case 'plantApple': orchard.saplings.push(minute + 2 * 365 * DAY); return 'planted an apple sapling';
    case 'pruneApples': orchard.prunedYear = dateOf(minute).year; return 'pruned the apple trees before blossom';
    case 'harvestApples': orchard.fruit.remaining -= made.apples; return 'picked ' + made.apples + (made.apples === 1 ? ' apple' : ' apples');
    case 'tendSheep': flock.lastTended = minute; return 'checked the sheep and tended their pasture';
    case 'cutHay': return 'stored ' + made.hay + ' bundles of hay for the flock';
    case 'takeMutton': flock.spare--; return 'took a sheep from the flock and prepared four portions of mutton';
  }
}

export function dawnSmallholding({ world, map }, emit) {
  const { minute, smallholding: { orchard, flock }, supplies } = world, { month, year } = dateOf(minute);
  if (place(map, farmSites.orchard.id)) {
    const stillYoung = orchard.saplings.filter(due => due > minute);
    orchard.trees += orchard.saplings.length - stillYoung.length;
    orchard.saplings = stillYoung;
    beginFruit(world);
  }
  if (!place(map, farmSites.pasture.id) || sheepCount(flock) === 0) return;
  if (flock.lambs && minute >= flock.maturesAt) {
    const keepEwes = Math.min(flock.lambs, Math.max(0, 3 - flock.ewes));
    flock.ewes += keepEwes;
    flock.spare += flock.lambs - keepEwes;
    flock.lambs = 0;
    delete flock.maturesAt;
  }
  if (WINTER.has(month)) {
    flock.hayOwed += sheepCount(flock) / 4;
    const due = Math.floor(flock.hayOwed);
    if (due === 0) return;
    flock.hayOwed -= due;
    const used = Math.min(due, supplies.hay);
    supplies.hay -= used;
    flock.shortDays = used < due ? flock.shortDays + 1 : 0;
    if (flock.shortDays < 5) return;
    const lost = ['lambs', 'spare', 'ewes', 'rams'].find(group => flock[group] > 0);
    flock[lost]--;
    flock.shortDays = 0;
    emit('village', 'The flock lost a sheep after five days short of winter hay.', [], { flock: 'winterLoss', sheep: sheepCount(flock) }, farmSites.pasture.id);
    return;
  }
  flock.shortDays = 0;
  if (month === 4 && flock.lambedYear !== year && flock.ewes && flock.rams && minute - flock.lastTended < 9 * DAY) {
    const lambs = Math.min(flock.ewes, MAX_SHEEP - sheepCount(flock));
    if (lambs <= 0) return;
    flock.lambedYear = year;
    flock.lambs += lambs;
    flock.maturesAt = minute + 150 * DAY;
    emit('village', lambs + (lambs === 1 ? ' lamb was' : ' lambs were') + ' born in the pasture.', [], { flock: 'lambing', lambs }, farmSites.pasture.id);
  }
}
