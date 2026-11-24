// The world beyond the parish reaches Dalecrest now and then. A peddler sets out a pack on the green
// and trades salt fish for linen. The lord's reeve comes for the rent at Michaelmas and Lady Day. A
// storm strips a roof or flattens standing barley. A neighbour's cattle stray into a ripe field and
// eat it until someone drives them out. All of it is decided at dawn by the village's own seeded
// random state, so a stored village meets the same weather and the same visitors on replay.
import { dateOf } from './calendar.mjs';
import { place, placesOf } from './roads.mjs';
import { buildingName } from './workday.mjs';
import { remember } from './memory.mjs';

const DAY = 1440;
const PEDDLERS = ['Hamon of Ashby', 'Wymark the chapman', 'Old Ysolt of Pendle', 'Geoffrey Pack', 'Lettice of Stowe Ferry'];
const DROVERS = ['Thornwick', 'Elmstead', 'Barrowby', 'Coldharbour'];

export const visitorJobs = {
  driveHerd: { label: 'Driving the stray cattle out', task: 'driving out the cattle', duration: 30, makes: {} },
  trade: { label: 'Trading linen with the peddler', task: 'trading with the peddler', duration: 20, takes: { cloth: 1 }, makes: { preserved: 3 }, foodSource: 'tradedFish' },
};

// Decided at dawn. random() is the village's seeded random state.
export function dawnVisitors(state, emit, random, sky) {
  const { world, map } = state, minute = world.minute, { month, day } = dateOf(minute);
  const roll = () => random();
  // The rent: a tenth of the barley in store, and a length of linen.
  if ((month === 9 && day === 29) || (month === 3 && day === 25)) world.reeveAt = minute + 240;
  // A peddler in the open months, now and then.
  const peddlerRoll = roll();
  if (month >= 4 && month <= 10 && !world.peddler && minute - (world.lastPeddler ?? -Infinity) >= 12 * DAY && peddlerRoll < 0.12) {
    const name = PEDDLERS[Math.floor(roll() * PEDDLERS.length)];
    world.peddler = { name, from: minute + 240, until: minute + 600 };
    world.lastPeddler = minute;
  }
  // A storm comes with the worst of the autumn and winter weather.
  const stormRoll = roll();
  if ((month >= 10 || month <= 3) && (sky.rain > 0.6 || sky.snow > 0.6) && stormRoll < 0.25) storm(state, emit, roll);
  // Strays find a ripe field in the summer and autumn.
  const herdRoll = roll();
  const ripe = placesOf(map, 'field').filter(f => (world.fields[f.id] || 0) >= 6);
  if (month >= 6 && month <= 10 && !world.herd && ripe.length && herdRoll < 0.035) {
    const field = ripe[Math.floor(roll() * ripe.length)];
    world.herd = { field: field.id, from: minute + 180, until: minute + 660, from_: DROVERS[Math.floor(roll() * DROVERS.length)], eaten: 0 };
  }
}

function storm(state, emit, roll) {
  const { world, map } = state;
  const roofs = Object.keys(world.condition || {}).filter(id => place(map, id));
  const struck = roofs.length ? place(map, roofs[Math.floor(roll() * roofs.length)]) : null;
  const parts = [];
  if (struck) {
    world.condition[struck.id] = Math.max(0, world.condition[struck.id] - 25);
    parts.push('stripped thatch from ' + buildingName(struck));
  }
  const fields = placesOf(map, 'field').filter(f => (world.fields[f.id] || 0) >= 4);
  if (fields.length) {
    const f = fields[Math.floor(roll() * fields.length)], lost = Math.floor(world.fields[f.id] / 2);
    world.fields[f.id] -= lost;
    parts.push('laid flat ' + lost + ' measures of standing barley in ' + f.name);
  }
  const windfall = Math.min(3, (world.capacity.wood || 0) - world.supplies.wood);
  if (windfall > 0) {
    world.supplies.wood += windfall;
    parts.push('brought down enough deadwood in the coppice for ' + windfall + ' bundles');
  }
  if (!parts.length) return;
  emit('storm', 'A storm in the night ' + parts.join(', ') .replace(/, ([^,]*)$/, ', and $1') + '.', [], { struck: struck?.id ?? null }, struck?.id || 'green');
}

// Called each minute: the reeve, the peddler and the strays come and go.
export function tickVisitors(state, emit) {
  const { world, map, actors } = state, minute = world.minute;
  if (world.reeveAt === minute) {
    delete world.reeveAt;
    const grain = Math.floor(world.supplies.grain / 10), cloth = Math.min(1, world.supplies.cloth);
    world.supplies.grain -= grain;
    world.supplies.cloth -= cloth;
    const feast = dateOf(minute).month === 9 ? 'Michaelmas' : 'Lady Day';
    emit('visit', 'The lord’s reeve came to the hall for the ' + feast + ' rent and took ' + (grain ? grain + (grain === 1 ? ' measure' : ' measures') + ' of barley' : 'what barley there was, which was none')
      + (cloth ? ' and a length of linen' : '') + '.', [], { rent: { grain, cloth } }, 'hall');
  }
  const p = world.peddler;
  if (p && minute === p.from) emit('visit', p.name + ', a peddler, has set out a pack on the green and will trade salt fish for linen until the afternoon.', [], { peddler: p.name }, 'green');
  if (p && minute >= p.until) delete world.peddler;
  const h = world.herd;
  if (h && minute === h.from) {
    const field = place(map, h.field);
    const text = 'Stray cattle from ' + h.from_ + ' have broken into ' + field.name + ' and are eating the ripe barley.';
    // Whoever is at work in the fields sees them. Everyone else hears of it from them.
    const seen = actors.filter(a => place(map, a.action.target)?.kind === 'field' || Math.hypot(a.position.x - field.at[0], a.position.y - field.at[1]) < 14);
    for (const a of seen) remember(a, minute, text, [a.id], 'observation', { herd: h.field, importance: 6 });
    emit('herd', text, seen.map(a => a.id), { herd: h.field }, h.field);
  }
  if (h && minute > h.from && (minute - h.from) % 60 === 0) {
    const bite = Math.min(2, world.fields[h.field] || 0);
    world.fields[h.field] -= bite;
    h.eaten += bite;
  }
  if (h && minute >= h.until) {
    delete world.herd;
    const field = place(map, h.field);
    emit('herd', 'A drover from ' + h.from_ + ' came for the strays, which had eaten ' + Math.round(h.eaten) + ' measures of barley in ' + field.name + '.', [], { herd: h.field, eaten: h.eaten }, h.field);
  }
}

export const peddlerHere = world => world.peddler && world.minute >= world.peddler.from && world.minute < world.peddler.until;
export const herdLoose = world => world.herd && world.minute >= world.herd.from && world.minute < world.herd.until;

// What visitors offer a resident to do.
export function visitorChoices(actor, { world, map }, offer, weary) {
  if (herdLoose(world) && actor.memories.some(m => m.herd === world.herd.field && m.minute >= world.herd.from)) {
    const field = place(map, world.herd.field);
    offer('driveHerd', world.herd.field, (actor.trade === 'harvest' ? 72 : 48) - weary, 'Stray cattle are eating the barley in ' + field.name + '.',
      { label: 'Driving the stray cattle out of ' + field.name });
  }
  if (peddlerHere(world)) offer('trade', 'green', 38 - weary, 'A peddler on the green will give salt fish for linen.');
}

export function visitorObstacle(actor, world) {
  const { job } = actor.action;
  if (job === 'driveHerd' && !herdLoose(world)) return 'the cattle had already gone';
  if (job === 'trade' && !peddlerHere(world)) return 'the peddler had packed up and gone';
  return null;
}

export function finishVisitor(actor, { world, map }) {
  const { job } = actor.action;
  if (job === 'driveHerd') {
    const field = place(map, world.herd.field), eaten = Math.round(world.herd.eaten);
    delete world.herd;
    return 'drove the stray cattle out of ' + field.name + (eaten ? ', after they had eaten ' + eaten + ' measures of barley' : ' before they did much harm');
  }
  if (job === 'trade') return 'traded a length of linen with ' + world.peddler.name + ' for three salted fish';
}

// What a resident can see of visitors, for the action model.
export function visitorContext(actor, world, names = {}) {
  const out = {};
  if (peddlerHere(world)) out.peddler = world.peddler.name + ' is on the green, trading salt fish for linen.';
  if (herdLoose(world) && actor.memories.some(m => m.herd === world.herd.field && m.minute >= world.herd.from)) out.strayCattle = 'Eating the barley in ' + (names[world.herd.field]?.name || world.herd.field) + '.';
  return out;
}
