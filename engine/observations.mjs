import { remember } from './civic.mjs';

export function atOven(actor, site) {
  return site?.kind === 'oven' && site.stage === 2 &&
    Math.hypot(actor.position.x - site.at[0], actor.position.y - site.at[1]) <= 0.05;
}

// One communal stock, observed by one resident at a particular place and minute.
export function inspectOven(actor, site, world, emit, source = 'oven inspection') {
  if (!atOven(actor, site)) return;
  const observation = {
    source, site: site.id, place: site.name, minute: world.minute,
    flour: world.supplies.flour, wood: world.supplies.wood
  };
  actor.observations ??= {};
  actor.observations.ovenStores = observation;
  const text = actor.name + ' checked the stores at ' + site.name + ' and counted ' +
    observation.flour + ' measures of flour and ' + observation.wood + ' bundles of firewood.';
  remember(actor, world.minute, text, [actor.id], 'observation', { observation });
  emit('observation', text, [actor.id], { ...observation, traceId: actor.action.basis?.trace ?? actor.action.decisionTraceId ?? null });
}

export function recalledOvenStores(actor, minute) {
  const seen = actor.observations?.ovenStores;
  if (!seen) return null;
  return { source: seen.source, place: seen.place, minute: seen.minute, minutesAgo: minute - seen.minute,
    flour: seen.flour, wood: seen.wood };
}
