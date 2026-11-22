import { place } from './roads.mjs';
import { nextOutdoorStart, SPELL, weatherAt } from './seasons.mjs';
import { addFishingBank, forageJobs, LINE_WEAR_LIMIT, offerForaging, provisions } from './foraging.mjs';

export const bedJob = 'repairBed';

export const villageJobs = {
  ...forageJobs,
  weed: { label: 'Weeding the barley strip', task: 'weeding', duration: 35, makes: {} },
  waterBarley: { label: 'Watering the barley strip', task: 'watering', duration: 29, takes: { water: 2 }, makes: {} },
  repairBed: { label: 'Repairing the bed', task: 'bed repair', duration: 68, takes: { wood: 2 }, makes: {}, indoors: true },
  sweep: { label: 'Sweeping the cottage', task: 'sweeping', duration: 19, makes: {}, indoors: true },
  repairFloor: { label: 'Replacing a rotten floorboard', task: 'floor repair', duration: 47, takes: { wood: 1 }, makes: {}, indoors: true }
};

const DAY = 1440;

export function prepareCottage(world, owner, site) {
  if (site?.kind !== 'cottage') return;
  world.cottages ??= {};
  const cottage = world.cottages[site.id] ??= { brokenBed: owner.id === 'agnes' };
  cottage.sweepDue ??= world.minute + (owner.id === 'agnes' ? 0 : 2 * DAY);
  cottage.floorDue ??= world.minute + (owner.id === 'agnes' ? 2 : 9) * DAY;
}

export function normalizeVillageWork({ world, actors, map }) {
  for (const [item, capacity] of Object.entries(provisions)) {
    world.capacity[item] ??= capacity;
    world.supplies[item] ??= 0;
  }
  addFishingBank(map);
  for (const actor of actors) prepareCottage(world, actor, place(map, actor.home));
  const agnes = actors.find(actor => actor.id === 'agnes');
  if (agnes && place(map, agnes.workplace)?.kind === 'field') {
    world.barleyStrip ??= { site: agnes.workplace, keeper: agnes.id, weeds: 2, moisture: 1 };
  }
}

export function tickBarley(world, sky) {
  const strip = world.barleyStrip;
  if (!strip || world.minute % SPELL !== 0) return;
  if (world.minute % 1440 === 360) {
    const growth = 1 + Number(strip.weeds < 2) + Number(strip.moisture >= 2);
    world.fields[strip.site] = Math.min(6, (world.fields[strip.site] ?? 3) + growth);
    strip.weeds = Math.min(3, strip.weeds + 1);
  }
  if (sky.rain) strip.moisture = Math.min(4, strip.moisture + 1);
  else if ((world.minute % 1440 === 720 || world.minute % 1440 === 900) && sky.temp > 4) {
    strip.moisture = Math.max(0, strip.moisture - 1);
  }
}

export function bedRepairRequest(actor, world) {
  return Object.values(world.helpRequests || {}).find(request =>
    request.job === bedJob && request.askerId === actor.id && request.due >= world.minute);
}

export function repairBedSpec(actor) {
  const spec = villageJobs.repairBed;
  return actor.trade === 'mend' ? { ...spec, duration: 40, takes: { wood: 1 } } : spec;
}

export function ownWorkChoices(actor, { world, map }, offer, weary) {
  const strip = world.barleyStrip;
  const daylight = nextOutdoorStart(world.minute) === world.minute, sky = weatherAt(world.minute, map.seed);
  if (strip?.keeper === actor.id && daylight) {
    if (strip.weeds >= 2) offer('weed', strip.site, 54 - weary, 'Weeds are crowding my barley.');
    if (strip.moisture <= 1 && !sky.rain && !sky.snow) {
      offer('waterBarley', strip.site, 56 - weary, 'My barley strip is dry. Watering it takes two buckets from the common reserve.');
    }
  }
  const cottage = world.cottages?.[actor.home];
  if (cottage?.brokenBed && !bedRepairRequest(actor, world)) {
    offer(bedJob, actor.home, 54 - weary * 0.5, 'My broken bed makes it harder to recover when I rest.');
  }
  for (const request of Object.values(world.helpRequests || {})) {
    if (request.job !== bedJob || request.helperId !== actor.id || request.status !== 'accepted' || request.due < world.minute) continue;
    if (!world.cottages?.[request.site]?.brokenBed) continue;
    offer(bedJob, request.site, 76 - weary, 'I promised ' + request.asker + ' I would repair the bed.',
      { commitmentId: request.id, label: 'Repairing ' + request.asker + '’s bed as promised' });
  }
  if (world.minute >= cottage?.sweepDue) offer('sweep', actor.home, 36 - weary, 'The cottage needs sweeping. A clean room is easier to rest in.');
  if (world.minute >= cottage?.floorDue) offer('repairFloor', actor.home, 51 - weary * 0.6, 'A rotten board makes the cottage draughty.');
  offerForaging(actor, { world, map }, offer, sky, daylight, weary);
}

export function villageWorkObstacle(actor, world, sky) {
  const { job, target, commitmentId } = actor.action;
  if (job === 'weed' && !(world.barleyStrip?.weeds >= 2)) return 'the strip had already been weeded';
  if (job === 'waterBarley' && (!(world.barleyStrip?.moisture <= 1) || sky.rain || sky.snow)) return 'the strip no longer needed watering';
  if (job === bedJob) {
    if (!world.cottages?.[target]?.brokenBed) return 'the bed had already been repaired';
    if (commitmentId && world.helpRequests?.[commitmentId]?.status !== 'accepted') return 'the request was no longer open';
    if (!commitmentId && bedRepairRequest(actor, world)) return 'there was already a request open for the bed';
  }
  if (job === 'sweep' && !(world.minute >= world.cottages?.[target]?.sweepDue)) return 'the cottage had already been swept';
  if (job === 'repairFloor' && !(world.minute >= world.cottages?.[target]?.floorDue)) return 'the floorboard had already been replaced';
  return null;
}

export function finishVillageWork(actor, { world, map }) {
  const { job, target } = actor.action;
  if (job === 'weed') {
    world.barleyStrip.weeds = 0;
    return 'cleared the weeds from the barley at ' + place(map, target).name;
  }
  if (job === 'waterBarley') {
    world.barleyStrip.moisture = 4;
    return 'watered the barley at ' + place(map, target).name + ' with two buckets from the common reserve';
  }
  if (job === bedJob) {
    world.cottages[target].brokenBed = false;
    const request = world.helpRequests?.[actor.action.commitmentId];
    return request ? 'repaired ' + request.asker + '’s broken bed' : 'repaired the broken bed at home';
  }
  if (job === 'sweep') {
    world.cottages[target].sweepDue = world.minute + 3 * DAY;
    return 'swept the hearth and cottage floor';
  }
  if (job === 'repairFloor') {
    world.cottages[target].floorDue = world.minute + 18 * DAY;
    return 'replaced a rotten floorboard at home';
  }
}

export function ownWorkContext(actor, world) {
  const strip = world.barleyStrip?.keeper === actor.id ? world.barleyStrip : null;
  const cottage = world.cottages?.[actor.home];
  const chores = [];
  if (world.minute >= cottage?.sweepDue) chores.push('The floor needs sweeping.');
  if (world.minute >= cottage?.floorDue) chores.push('A rotten floorboard lets in a draught.');
  return {
    ...(strip && { ownBarleyStrip: { weeds: strip.weeds >= 2 ? 'crowded' : 'light', soil: strip.moisture <= 1 ? 'dry' : 'moist',
      barleyReady: world.fields[strip.site] >= 3 } }),
    ...(cottage?.brokenBed && { ownBed: 'Broken. Rest at home restores less energy until the bed is repaired.' }),
    ...(chores.length && { ownCottage: chores }),
    ...(actor.fishing && { fishingGear: { bait: actor.fishing.bait, poleNeedsRepair: actor.fishing.wear >= LINE_WEAR_LIMIT } })
  };
}
