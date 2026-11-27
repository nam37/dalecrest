import { remember } from './memory.mjs';
import { noticeForRequests, ovenFact } from './request-review.mjs';

// A harvest shift puts grain in the barn and a milling shift draws it out. Only the handler
// sees how full it is. Keep a new observation when that changes materially or a day has passed.
export function observeGrain(actor, state, job) {
  if (job !== 'harvest' && job !== 'mill') return;
  const { world } = state, grain = world.supplies.grain, capacity = world.capacity.grain;
  const prior = actor.observations?.grain;
  if (prior && prior.capacity === capacity && (prior.grain >= capacity / 2) === (grain >= capacity / 2) &&
      Math.abs(prior.grain - grain) < 6 && world.minute - prior.minute < 1440) return;
  const count = { grain, capacity, minute: world.minute, resident: actor.id,
    observation: actor.id + ':' + ((actor.memorySeq || 0) + 1) };
  actor.observations ??= {};
  actor.observations.grain = count;
  remember(actor, world.minute, actor.name + ' handled the barley and counted ' + grain +
    ' measures in a barn with room for ' + capacity + '.', [actor.id], 'observation', { grainCount: count });
}

export function atOven(actor, site) {
  return site?.kind === 'oven' && site.stage === 2 &&
    Math.hypot(actor.position.x - site.at[0], actor.position.y - site.at[1]) <= 0.05;
}

// One communal stock, observed by one resident at a particular place and minute.
export function inspectOven(actor, site, world, emit, source = 'oven inspection') {
  if (!atOven(actor, site)) return;
  const prior = actor.observations?.ovenStores;
  const observation = {
    source, site: site.id, place: site.name, minute: world.minute,
    flour: world.supplies.flour, wood: world.supplies.wood
  };
  // A recount within the hour that found the stores as they were. The menu stops offering a third.
  if (prior?.site === site.id && world.minute - prior.minute < 60 && prior.flour === observation.flour && prior.wood === observation.wood) {
    observation.recount = true;
  }
  const traceId = actor.action.basis?.trace ?? actor.action.decisionTraceId ?? null;
  noticeForRequests(actor, ovenFact(actor, observation), world.minute, null, traceId);
  actor.observations ??= {};
  actor.observations.ovenStores = observation;
  const text = actor.name + ' checked the stores at ' + site.name + ' and counted ' +
    observation.flour + ' measures of flour and ' + observation.wood + ' bundles of firewood.';
  remember(actor, world.minute, text, [actor.id], 'observation', { observation });
  emit('observation', text, [actor.id], { ...observation, traceId });
}

export function recalledOvenStores(actor, minute) {
  const seen = actor.observations?.ovenStores;
  if (!seen) return null;
  return { source: seen.source, place: seen.place, minute: seen.minute, minutesAgo: minute - seen.minute,
    flour: seen.flour, wood: seen.wood };
}
