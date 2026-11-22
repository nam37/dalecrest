import { remember } from './civic.mjs';
import { place } from './roads.mjs';

export const reportingGoal = 'Report what my neighbours do for the Dalecrest Daily and follow up on unfinished business';
const beats = new Set(['oven', 'mill', 'field', 'wood', 'fishing', 'well', 'hall', 'green', 'alehouse', 'storehouse']);

export function appointReporter(actor) {
  if (actor.id !== 'robin' || actor.trade !== 'harvest') return;
  actor.role = 'Village journalist';
  actor.trade = 'report';
  actor.workplace = 'hall';
  actor.goals[0] = reportingGoal;
  const calling = actor.desires?.find(d => d.id === 'calling');
  if (calling) calling.label = reportingGoal;
}

export function offerReporting(actor, { world, map }, offer, weary) {
  for (const site of map.places) {
    if (site.stage !== 2 || !beats.has(site.kind)) continue;
    const last = actor.rounds?.[site.id];
    const due = last == null ? 1 : Math.min(1, (world.minute - last) / 720);
    offer('report', 'Gathering news at ' + site.name, site.id, 55, 44 + 19 * due - weary,
      'I can see what is happening at ' + site.name + ' and put it in my notebook.');
  }
}

// A note records only what is visible during a round. An activity in progress is
// distinct from a completed shift, whose outcome is recorded by the simulation.
export function takeFieldNotes(actor, { actors, map, world }, emit) {
  const action = actor.action, site = place(map, action.target);
  if (!site || action.phase !== 'working' || Math.hypot(actor.position.x - site.at[0], actor.position.y - site.at[1]) > 0.1) return;
  actor.rounds ??= {};
  actor.rounds[site.id] = world.minute;
  action.noted ??= [];
  const write = (text, ids) => {
    remember(actor, world.minute, text, ids, 'fieldnote', { site: site.id });
    emit('fieldnote', text, ids, undefined, site.id);
  };
  for (const other of actors) {
    const seen = other.action;
    if (other === actor || seen.phase !== 'working' || seen.target !== site.id || seen.remaining <= 0 ||
        Math.hypot(other.position.x - actor.position.x, other.position.y - actor.position.y) > 1) continue;
    let activity;
    if (seen.job === 'hunt') activity = seen.label.toLowerCase();
    else if (seen.kind === 'work' || seen.kind === 'inspect') activity = seen.label.toLowerCase().split(' for ')[0];
    else if (seen.kind === 'meeting') activity = 'attending the moot';
    else if (seen.kind === 'food') activity = seen.meal === 'draw' ? 'drawing the day’s bread' : seen.meal ? 'stopping for a meal' : 'stopping for bread';
    else if (seen.kind === 'social' || seen.kind === 'conversation') activity = 'there on a visit';
    else continue;
    const entry = other.id + '/' + activity;
    if (action.noted.includes(entry)) continue;
    action.noted.push(entry);
    write('At ' + site.name + ', Robin saw ' + other.name + ' ' + activity + '.', [actor.id, other.id]);
  }
  if (action.remaining === 0) {
    if (!action.noted.length) write('Robin finished a round at ' + site.name + ' without seeing anyone at work there.', [actor.id]);
    actor.lastJob = world.minute;
    const day = Math.floor(world.minute / 1440);
    if (actor.lastWorkDay !== day) { actor.daysWorked++; actor.lastWorkDay = day; }
  }
}
