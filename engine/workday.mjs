// The working day. Trades keep hours. Nobody works at a trade on a Sunday or a feast day, and on a feast
// day the village eats together on the green. The mill and each oven take one worker at a time, so a
// second miller or baker waits their turn. The common buildings wear, and the carpenter's work keeps
// them sound: a mill or oven in poor repair turns out less, and one that falls out of use turns out none.
import { dateOf } from './calendar.mjs';
import { place } from './roads.mjs';

const DAY = 1440;

// Feast days kept in the parish, by the old calendar. Lammas, the first of August, blesses the first loaf
// of the harvest but is a working day: the barley will not wait.
const FEASTS = { '9-29': 'Michaelmas', '11-1': 'All Hallows', '11-11': 'Martinmas', '12-25': 'Christmas',
  '1-6': 'Twelfth Night', '2-2': 'Candlemas', '3-25': 'Lady Day', '5-1': 'May Day', '6-24': 'Midsummer' };

export function feastOf(minute) {
  const d = dateOf(minute);
  return FEASTS[d.month + '-' + d.day] || null;
}
// A day of rest: a Sunday or a feast day. Returns its name, or null on a working day.
export function restDay(minute) {
  return feastOf(minute) || (dateOf(minute).weekday === 'Sunday' ? 'Sunday' : null);
}

// The trades and the hours they keep, in minutes after midnight. Everything else keeps no hours.
const HOURS = { harvest: [300, 1170], mill: [360, 1140], bake: [240, 1020], cut: [300, 1170], weave: [360, 1260], mend: [420, 1080], build: [360, 1140], keep: [420, 1140] };
// Water is drawn whatever the day. The rest wait for a working day.
export function tradeOpen(job, minute) {
  const hours = HOURS[job];
  if (!hours) return true;
  if (restDay(minute)) return false;
  const t = minute % DAY;
  return t >= hours[0] && t <= hours[1];
}

export const isOwnTrade = (actor, action) => actor.trade === 'report'
  ? action.kind === 'report' : action.kind === 'work' && action.job === actor.trade;

// The feast on the green runs from one in the afternoon until six.
export const FEAST_HOURS = [780, 1080];
export const feastOn = minute => {
  const name = feastOf(minute), t = minute % DAY;
  return name && t >= FEAST_HOURS[0] && t < FEAST_HOURS[1] ? name : null;
};

// ------------------------------------------------------------------- queues

const QUEUES = { bake: 'Waiting for the oven', mill: 'Waiting for the millstones' };
export const queuesAt = job => Boolean(QUEUES[job]);

// Holds a miller or baker who arrives to find the stones or the oven in use. Returns true while they wait.
export function waitTurn(actor, actors, minute) {
  const action = actor.action;
  if (action.kind !== 'work' || !QUEUES[action.job] || action.carrying) return false;
  // Whoever is further through their shift keeps the stones or the oven. Between equals, the order of the village decides.
  const mine = actors.indexOf(actor);
  const busy = actors.some((o, i) => o !== actor && o.action.kind === 'work' && o.action.job === action.job && o.action.target === action.target && !o.action.carrying
    && o.action.phase === 'working' && !o.action.queued && o.action.remaining > 0
    && (action.queued || o.action.remaining < action.remaining || (o.action.remaining === action.remaining && i < mine)));
  if (busy) {
    if (!action.queued) { action.queued = minute; action.shiftLabel = action.label; action.label = QUEUES[action.job]; }
    return true;
  }
  if (action.queued) {
    action.label = action.shiftLabel || action.label;
    delete action.queued;
    delete action.shiftLabel;
  }
  return false;
}
// Nobody waits more than two hours for a turn.
export const waitedTooLong = (actor, minute) => actor.action.queued && minute - actor.action.queued > 120;

// ------------------------------------------------------------------- the buildings

const KEPT = ['hall', 'mill', 'oven', 'well', 'granary', 'alehouse', 'storehouse'];
const NAMES = { hall: 'the village hall', mill: 'the watermill', oven: 'the common oven', well: 'the well', granary: 'the granary', alehouse: 'the alehouse', storehouse: 'the storehouse' };
export const buildingName = p => p.kind === 'oven' && p.id !== 'oven' ? 'the bakehouse' : p.kind === 'well' && p.id !== 'well' ? p.name.toLowerCase().replace(/^/, 'the ') : p.kind === 'alehouse' ? p.name : NAMES[p.kind];

export function normalizeBuildings({ world, map }) {
  world.condition ??= {};
  for (const p of map.places) if (KEPT.includes(p.kind) && p.stage === 2) world.condition[p.id] ??= 90;
}

// How a building's repair changes what it turns out: nothing lost when sound, one less below half,
// and nothing at all once it has fallen out of use.
export function repairLoss(world, site) {
  const c = world.condition?.[site];
  return c == null || c >= 50 ? 0 : c >= 20 ? 1 : Infinity;
}

// At dawn every building wears a little, and the village's stock of repair work goes to the worst first.
export function wear(state, emit) {
  const { world, map } = state;
  normalizeBuildings(state);
  // When each roof was last mended, so the views can show the new thatch for a few days.
  world.mended ??= {};
  for (const [id, at] of Object.entries(world.mended)) if (world.minute - at > 10 * 1440) delete world.mended[id];
  for (const id of Object.keys(world.condition)) {
    const p = place(map, id);
    if (!p) { delete world.condition[id]; continue; }
    world.condition[id] = Math.max(0, world.condition[id] - (p.kind === 'mill' ? 1.4 : 1));
  }
  let budget = Math.min(3, world.supplies.repair || 0);
  while (budget > 0) {
    const worst = Object.entries(world.condition).filter(([, c]) => c < 96).sort((a, b) => a[1] - b[1])[0];
    if (!worst) break;
    world.condition[worst[0]] = Math.min(100, worst[1] + 4);
    world.mended[worst[0]] = world.minute;
    world.supplies.repair--;
    budget--;
  }
  announce(state, emit);
}

// Says when a building crosses into disrepair, out of use, or back to sound.
export function announce({ world, map }, emit) {
  world.conditionSaid ??= {};
  for (const [id, c] of Object.entries(world.condition)) {
    const p = place(map, id), band = c < 20 ? 'ruin' : c < 50 ? 'poor' : c >= 60 ? 'sound' : world.conditionSaid[id] || 'sound';
    if (band === (world.conditionSaid[id] || 'sound')) continue;
    world.conditionSaid[id] = band;
    const name = buildingName(p), The = name[0].toUpperCase() + name.slice(1);
    emit('build', band === 'ruin' ? The + ' has fallen out of use for want of repair.' : band === 'poor' ? The + ' is falling into disrepair.'
      : The + ' is in good repair again.', [], { condition: Math.round(c) }, id);
  }
}

// What the carpenter knows of the buildings, for the action model.
// names maps a place id to what residents call it.
export function buildingsContext(actor, world, names = {}) {
  if (actor.trade !== 'mend') return {};
  const poor = Object.entries(world.condition || {}).filter(([, c]) => c < 60).sort((a, b) => a[1] - b[1])
    .map(([id, c]) => (names[id]?.name || id) + (c < 20 ? ', out of use' : c < 50 ? ', in poor repair' : ', wearing'));
  return poor.length ? { buildingsNeedingWork: poor } : {};
}
