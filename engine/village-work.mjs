import { place } from './roads.mjs';
import { nextOutdoorStart, SPELL, weatherAt } from './seasons.mjs';

export const bedJob = 'repairBed';

export const villageJobs = {
  weed: { label: 'Weeding the barley strip', task: 'weeding', duration: 35, makes: {} },
  waterBarley: { label: 'Watering the barley strip', task: 'watering', duration: 29, takes: { water: 2 }, makes: {} },
  repairBed: { label: 'Repairing the bed', task: 'bed repair', duration: 68, takes: { wood: 2 }, makes: {}, indoors: true }
};

export function normalizeVillageWork({ world, actors, map }) {
  const agnes = actors.find(actor => actor.id === 'agnes');
  if (!agnes) return;
  if (place(map, agnes.workplace)?.kind === 'field') {
    world.barleyStrip ??= { site: agnes.workplace, keeper: agnes.id, weeds: 2, moisture: 1 };
  }
  if (place(map, agnes.home)?.kind === 'cottage') {
    world.cottages ??= {};
    world.cottages[agnes.home] ??= { brokenBed: true };
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
  if (strip?.keeper === actor.id && nextOutdoorStart(world.minute) === world.minute) {
    const sky = weatherAt(world.minute, map.seed);
    if (strip.weeds >= 2) offer('weed', strip.site, 54 - weary, 'Weeds are crowding my barley.');
    if (strip.moisture <= 1 && !sky.rain && !sky.snow) {
      offer('waterBarley', strip.site, 56 - weary, 'My barley strip is dry. Watering it takes two buckets from the common reserve.');
    }
  }
  if (world.cottages?.[actor.home]?.brokenBed && !bedRepairRequest(actor, world)) {
    offer(bedJob, actor.home, 54 - weary * 0.5, 'My broken bed makes it harder to recover when I rest.');
  }
  for (const request of Object.values(world.helpRequests || {})) {
    if (request.job !== bedJob || request.helperId !== actor.id || request.status !== 'accepted' || request.due < world.minute) continue;
    if (!world.cottages?.[request.site]?.brokenBed) continue;
    offer(bedJob, request.site, 76 - weary, 'I promised ' + request.asker + ' I would repair the bed.',
      { commitmentId: request.id, label: 'Repairing ' + request.asker + '’s bed as promised' });
  }
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
}

export function ownWorkContext(actor, world) {
  const strip = world.barleyStrip?.keeper === actor.id ? world.barleyStrip : null;
  const cottage = world.cottages?.[actor.home];
  return {
    ...(strip && { ownBarleyStrip: { weeds: strip.weeds >= 2 ? 'crowded' : 'light', soil: strip.moisture <= 1 ? 'dry' : 'moist',
      barleyReady: world.fields[strip.site] >= 3 } }),
    ...(cottage?.brokenBed && { ownBed: 'Broken. Rest at home restores less energy until the bed is repaired.' })
  };
}
