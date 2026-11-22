// How the village changes itself. Residents voice concerns that come from their own circumstances,
// win neighbours over in conversation, settle the matter at a moot, and then build what was agreed.
import { dist, clamp } from './geom.mjs';
import { place, placesOf, addNode, addEdge, walkLength, clearWalk, touch } from './roads.mjs';
import { FIELD_NAMES, addPlace, pickLot, extendLane, fieldSite } from './sites.mjs';
import { prepareCottage } from './village-work.mjs';
import { GRANARY, foodDays, keepStores, mouths, ripen, storeDays } from './stores.mjs';
import { weatherAt } from './seasons.mjs';

// Shifts of labour and bundles of wood each kind of work needs.
export const WORKS = {
  cottage: { need: 22, wood: 10, crew: 3, a: 'a cottage', the: 'the cottage' },
  field: { need: 16, wood: 0, crew: 4, a: 'a new field', the: 'the new field' },
  granary: { need: 30, wood: 12, crew: 4, a: 'a granary', the: 'the granary' },
  well: { need: 14, wood: 4, crew: 2, a: 'another well', the: 'the new well' },
  oven: { need: 18, wood: 5, crew: 3, a: 'a bakehouse', the: 'the bakehouse' },
  alehouse: { need: 34, wood: 14, crew: 4, a: 'an alehouse', the: 'the alehouse' },
};
const ALEHOUSES = ['The Barley Mow', 'The Plough', 'The Green Man', 'The Wheatsheaf'];
const PATH_WEAR = 12;

const first = actor => actor.name.split(' ')[0];
export const isLodger = (actor, map) => place(map, actor.home)?.kind !== 'cottage';
export { remember } from './memory.mjs';
import { remember } from './memory.mjs';
const slots = actors => 1 + Math.floor(actors.length / 10);
const ready = (p, actors) => p.supporters.length >= (p.kind === 'cottage' ? Math.max(2, Math.ceil(actors.length / 4)) : Math.max(3, Math.ceil(actors.length / 3)));
const lane = (map, site) => map.roads[site.road]?.name;
const whereabouts = (map, site) => lane(map, site) ? ' on ' + lane(map, site) : '';

// A field regrows two measures of barley a day, which is bread for about six people.
export const fieldsFeed = map => map.places.filter(p => p.kind === 'field').length * 6.5;

// What this resident would change about the village, strongest first.
export function concerns(actor, { world, actors, map }) {
  const out = [], pop = actors.length;
  const add = (key, weight, claim) => {
    if (weight < 25 || world.cooldown[key] > world.minute || world.projects.some(p => p.key === key)) return;
    out.push({ key, kind: key.split(':')[0], weight, claim });
  };
  if (isLodger(actor, map)) add('cottage:' + actor.id, 90, 'that a corner of the hall is no home');
  for (const other of actors) {
    if (other === actor || !isLodger(other, map)) continue;
    add('cottage:' + other.id, 24 + (actor.relationships[other.id] || 0) * 0.5 + (actor.traits.includes('generous') ? 14 : 0)
      + (actor.trade === 'mend' ? 10 : 0), 'that ' + other.name + ' needs a cottage');
  }
  const farms = actor.trade === 'harvest' || actor.trade === 'mill';
  // Farmers ask for land before the village outgrows it; everyone asks once the stores run short.
  if (world.strain.grain >= 2) add('field', (farms ? 68 : 40) + world.strain.grain * 4, 'that the strips cannot feed ' + pop + ' mouths');
  else if (fieldsFeed(map) < pop + 1) add('field', farms ? 60 : 28, 'that the strips are stretched to feed ' + pop + ' and could not feed one more');
  // Whatever is in store when the fields stop growing has to last until the next harvest.
  if (storeDays(world, pop) < 150 && world.supplies.grain >= world.capacity.grain * 0.5) {
    add('granary', farms ? 62 : 30, 'that the barn and granaries cannot see ' + pop + ' people through a winter');
  }
  if (world.strain.water >= 2 || world.capacity.water < pop * 2) add('well', actor.trade === 'draw' ? 66 : 32, 'that one well cannot water ' + pop + ' residents');
  if (world.strain.bread >= 2 || world.capacity.bread < pop * 2) add('oven', actor.trade === 'bake' ? 64 : 32, 'that the oven cannot keep ' + pop + ' people in bread');
  if (pop >= 11 && !map.places.some(p => p.kind === 'alehouse')) {
    add('alehouse', (actor.traits.includes('gregarious') ? 46 : 22) + (actor.needs.loneliness > 55 ? 12 : 0), 'that Dalecrest wants an alehouse for the long evenings');
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// One of two residents in conversation presses a concern the other has not yet answered.
export function discuss(a, b, state, random) {
  const { world } = state;
  const mine = concerns(a, state), theirs = concerns(b, state);
  const order = (mine[0]?.weight || 0) >= (theirs[0]?.weight || 0) ? [[a, b, mine, theirs], [b, a, theirs, mine]] : [[b, a, theirs, mine], [a, b, mine, theirs]];
  for (const [speaker, listener, list, other] of order) {
    for (const c of list) {
      if (c.weight < 40) break;
      let p = world.proposals.find(x => x.key === c.key);
      if (p && p.supporters.includes(speaker.id) && (p.supporters.includes(listener.id) || p.heard.includes(listener.id))) continue;
      if (!p) world.proposals.push(p = { key: c.key, kind: c.kind, by: speaker.id, since: world.minute, supporters: [], heard: [] });
      if (!p.supporters.includes(speaker.id)) p.supporters.push(speaker.id);
      const already = p.supporters.includes(listener.id);
      const agreed = already || other.some(x => x.key === c.key) || (listener.relationships[speaker.id] || 0) >= 40
        || listener.traits.includes('generous') || random() < (c.kind === 'cottage' ? 0.5 : 0.3);
      if (agreed && !already) p.supporters.push(listener.id);
      if (!agreed) p.heard.push(listener.id);
      return { key: c.key, agreed, text: speaker.name + ' told ' + listener.name + ' ' + c.claim + '. ' + first(listener) + (agreed ? ' agreed.' : ' was not persuaded.') };
    }
  }
  return null;
}

function siteScore(kind, state, owner, random) {
  const { map, actors } = state, green = place(map, 'green'), G = [green.x, green.y];
  const spot = lot => [lot.x, lot.y];
  if (kind === 'cottage') {
    const work = owner && place(map, owner.workplace);
    const friends = owner ? actors.filter(a => (owner.relationships[a.id] || 0) >= 40).map(a => place(map, a.home)).filter(Boolean) : [];
    return lot => -dist(spot(lot), G) - (work ? 0.2 * dist(spot(lot), work.at) : 0)
      + (friends.some(f => dist(spot(lot), f.at) < 7) ? 3 : 0) + random() * 2.5;
  }
  if (kind === 'granary') {
    const mill = place(map, 'mill');
    return lot => -0.6 * dist(spot(lot), G) - 0.35 * dist(spot(lot), mill.at) + random() * 2;
  }
  if (kind === 'alehouse') return lot => -dist(spot(lot), G) + (lot.way === 'road' ? 5 : 0) + random() * 2;
  // A further well or oven goes where homes are worst served by the ones that exist.
  const same = map.places.filter(p => p.kind === kind);
  let worst = null, far = -1;
  for (const home of map.places.filter(p => p.kind === 'cottage')) {
    const nearest = Math.min(...same.map(s => dist(s.at, home.at)));
    if (nearest > far) { far = nearest; worst = home; }
  }
  const T = worst ? worst.at : G;
  return lot => -dist(spot(lot), T) - 0.2 * dist(spot(lot), G) - (same.some(s => dist(s.at, spot(lot)) < 10) ? 50 : 0) + random() * 2;
}

// Chooses ground for an agreed work and stakes it out. Returns the new project, or null if no ground suits.
function begin(state, proposal, random, emit) {
  const { world, actors, map } = state, kind = proposal.kind, green = place(map, 'green');
  const owner = kind === 'cottage' ? actors.find(a => a.id === proposal.key.split(':')[1]) : null;
  if (kind === 'cottage' && (!owner || !isLodger(owner, map))) return null;
  let site, props = { stage: 0, founded: world.minute };
  if (kind === 'field') {
    site = fieldSite(map, random);
    if (!site) return null;
    const used = new Set(map.places.map(p => p.name));
    props.name = FIELD_NAMES.find(n => !used.has(n)) || 'New field';
  } else {
    const turned = kind === 'cottage' && random() < 0.25;
    const score = siteScore(kind, state, owner, random);
    const houses = placesOf(map, 'cottage', false).length;
    site = pickLot(map, kind, score, { turned });
    if (!site || dist([site.x, site.y], [green.x, green.y]) > 10 + 2.4 * Math.sqrt(houses)) {
      const road = extendLane(map, random);
      if (road >= 0) {
        emit('build', 'With the good ground along the old ways taken, the villagers staked out ' + map.roads[road].name + '.');
        site = pickLot(map, kind, score, { turned }) || site;
      }
    }
    if (!site) return null;
    props.road = site.road;
    if (kind === 'granary') props.name = 'Granary';
    if (kind === 'oven') props.name = 'Bakehouse';
    if (kind === 'well') props.name = (lane(map, site) || 'New') + ' well';
    if (kind === 'alehouse') props.name = ALEHOUSES[Math.floor(random() * ALEHOUSES.length)];
    if (kind === 'well') site = { x: site.x, y: site.y, at: site.at };
  }
  const made = addPlace(map, kind, site, props);
  const project = { key: proposal.key, kind, id: made.id, need: WORKS[kind].need, wood: WORKS[kind].wood, done: 0, used: 0, since: world.minute, backers: proposal.supporters.slice() };
  if (owner) project.for = owner.id;
  world.projects.push(project);
  return project;
}

function describe(project, state) {
  const owner = project.for && state.actors.find(a => a.id === project.for);
  return owner ? 'a cottage for ' + owner.name : WORKS[project.kind].a;
}

function resolve(state, emit, random) {
  const { world, actors, map } = state;
  const present = actors.filter(a => a.action.kind === 'meeting' && a.action.phase === 'working');
  for (const a of present) a.action.remaining = 1;
  if (present.length < Math.max(3, Math.ceil(actors.length * 0.4))) {
    if (++world.moot.tries >= 2) {
      world.moot = null;
      emit('civic', 'Too few came to the hall again, and the moot was put off.', [], undefined, 'hall');
    } else {
      world.moot.at += 1440;
      emit('civic', 'Only ' + present.length + ' came to the hall. The moot will meet again tomorrow evening.', [], undefined, 'hall');
    }
    return;
  }
  const ids = present.map(a => a.id);
  const agenda = world.proposals.filter(p => ready(p, actors)).sort((a, b) => b.supporters.length - a.supporters.length || a.since - b.since);
  let open = slots(actors) - world.projects.length;
  const settled = [];
  for (const p of agenda) {
    if (open <= 0) break;
    world.proposals = world.proposals.filter(x => x !== p);
    const share = p.supporters.length / actors.length;
    let yes = 0;
    for (const a of present) if (p.supporters.includes(a.id) || random() < 0.35 + share * 0.5) yes++;
    const what = p.kind === 'cottage' ? 'a cottage for ' + (actors.find(a => a.id === p.key.split(':')[1])?.name || 'the lodger') : WORKS[p.kind].a;
    if (yes * 2 <= present.length) {
      world.cooldown[p.key] = world.minute + 2880;
      emit('civic', 'The moot heard the case for ' + what + ', but ' + (present.length - yes) + ' of the ' + present.length + ' present spoke against it.', ids);
      continue;
    }
    const project = begin(state, p, random, emit);
    if (!project) {
      world.cooldown[p.key] = world.minute + 1440;
      emit('civic', 'The moot agreed on ' + what + ' but could not settle where to put it.', ids);
      continue;
    }
    open--;
    settled.push(what);
    const site = place(map, project.id);
    const spot = p.kind === 'field' ? ', to be called ' + site.name : whereabouts(map, site);
    emit('civic', 'The moot agreed, ' + yes + ' voices to ' + (present.length - yes) + ', to ' + (p.kind === 'field' ? 'clear' : 'build') + ' ' + what + spot + '.', ids);
  }
  if (!agenda.length) emit('civic', 'The moot met at the hall but found nothing left to settle.', ids);
  for (const a of present) {
    a.needs.loneliness = clamp(a.needs.loneliness - 22, 0, 100);
    remember(a, world.minute, a.name + ' attended the moot at the hall' + (settled.length ? ', which agreed on ' + settled.join(' and ') : '') + '.', [a.id], 'social');
  }
  world.moot = null;
}

// What is being built and debated, in words, for whoever shows the village to a visitor.
export function affairs(state) {
  const { world, actors, map } = state;
  const who = key => actors.find(a => a.id === key.split(':')[1])?.name || 'a lodger';
  const title = (kind, key) => kind === 'cottage' ? 'A cottage for ' + who(key) : WORKS[kind].a[0].toUpperCase() + WORKS[kind].a.slice(1);
  return {
    moot: world.moot ? world.moot.at : null,
    works: (world.projects || []).map(p => {
      const site = place(map, p.id);
      return { id: p.id, title: p.kind === 'field' ? site.name : title(p.kind, p.key), where: lane(map, site) || '', done: Math.min(p.need, Math.floor(p.done)), need: p.need, stage: site.stage };
    }),
    talk: (world.proposals || []).map(p => ({
      title: title(p.kind, p.key), voices: p.supporters.length,
      needed: p.kind === 'cottage' ? Math.max(2, Math.ceil(actors.length / 4)) : Math.max(3, Math.ceil(actors.length / 3)),
    })).sort((a, b) => b.voices / b.needed - a.voices / a.needed),
  };
}

// Called once a simulated minute.
export function tick(state, emit, random, onMootInterruption) {
  const { world, actors } = state, minute = world.minute, day = minute % 1440;
  if (minute % 20 === 0 && !world.moot) {
    world.proposals = world.proposals.filter(p => minute - p.since < 8640
      && (p.kind !== 'cottage' || actors.some(a => a.id === p.key.split(':')[1] && isLodger(a, state.map))));
    if (world.projects.length < slots(actors) && world.proposals.some(p => ready(p, actors))) {
      let at = minute - day + 1110;
      if (at - minute < 90) at += 1440;
      world.moot = { at, tries: 0 };
      emit('civic', 'Word goes round Dalecrest: a moot will meet at the hall ' + (at - minute < 720 ? 'this evening' : 'tomorrow evening') + '.');
    }
  }
  if (!world.moot) return;
  // Shortly before the moot everyone awake reconsiders what they are doing.
  if (minute === world.moot.at - 35) {
    for (const actor of actors) {
      if (actor.action.remaining <= 0 || (actor.action.kind === 'rest' && actor.needs.fatigue >= 60)) continue;
      onMootInterruption?.(actor);
      actor.action.remaining = 0;
    }
  }
  if (minute === world.moot.at + 40) resolve(state, emit, random);
}

export const mootOpen = world => world.moot && world.minute >= world.moot.at - 40 && world.minute <= world.moot.at + 25;

// The agreed work this resident would most readily put a shift into.
export function buildChoice(actor, state) {
  const { world, actors, map } = state;
  let best = null;
  for (const p of world.projects) {
    if (p.used < p.wood && world.supplies.wood < 1) continue;
    // A site only has room for so many hands at once.
    if (actors.filter(a => a !== actor && a.action.job === 'build' && a.action.target === p.id).length >= WORKS[p.kind].crew) continue;
    const score = 36 + (actor.trade === 'mend' ? 16 : 0) + (p.for === actor.id ? 24 : 0) + (p.backers.includes(actor.id) ? 9 : 0)
      + Math.min(10, (world.minute - p.since) / 300);
    if (!best || score > best.score) best = { project: p, score };
  }
  if (!best) return null;
  const p = best.project, site = place(map, p.id), the = p.for === actor.id ? 'my own cottage' : WORKS[p.kind].the;
  best.label = p.kind === 'field' ? 'Clearing ground for ' + site.name : site.stage === 0 ? 'Setting the footings of ' + the : 'Raising ' + the;
  best.reason = 'The moot agreed to ' + (p.kind === 'field' ? 'clear' : 'build') + ' ' + describe(p, state) + ', and '
    + Math.floor(p.done) + ' of ' + p.need + ' shifts are done.';
  return best;
}

function complete(project, state, emit) {
  const { world, actors, map } = state, site = place(map, project.id);
  const tell = (text, ids = []) => emit('build', text, ids, undefined, site.id);
  world.projects = world.projects.filter(p => p !== project);
  site.built = world.minute;
  if (project.kind === 'cottage') {
    const owner = actors.find(a => a.id === project.for);
    if (owner && isLodger(owner, map)) {
      owner.home = site.id;
      prepareCottage(world, owner, site);
      tell('The cottage' + whereabouts(map, site) + ' is finished, and ' + owner.name + ' has moved in from the hall.', [owner.id]);
      remember(owner, world.minute, owner.name + ' moved into a cottage of their own' + whereabouts(map, site) + '.', [owner.id], 'work');
    } else tell('A cottage' + whereabouts(map, site) + ' is finished and stands empty.');
  } else if (project.kind === 'field') {
    world.fields[site.id] = 0;
    world.strain.grain = 0;
    if (site.felled) world.supplies.wood = Math.min(world.capacity.wood, world.supplies.wood + Math.min(4, site.felled));
    tell(site.name + ' is cleared and ploughed. Dalecrest now works ' + placesOf(map, 'field').length + ' fields.');
  } else if (project.kind === 'granary') {
    world.capacity.grain += GRANARY.grain; world.capacity.flour += GRANARY.flour;
    tell('The granary' + whereabouts(map, site) + ' is finished. The village can now store ' + world.capacity.grain + ' measures of barley.');
  } else if (project.kind === 'well') {
    world.capacity.water += 16;
    tell('Water has been struck at the new well' + whereabouts(map, site) + '.');
  } else if (project.kind === 'oven') {
    world.capacity.bread += 20;
    tell('The bakehouse' + whereabouts(map, site) + ' has fired its first loaves.');
  } else tell(site.name + ' has opened its door' + whereabouts(map, site) + '.');
}

// A finished shift on a building site.
export function labour(actor, state, emit) {
  const { world, map } = state;
  const project = world.projects.find(p => p.id === actor.action.target);
  if (!project) return;
  if (project.used < project.wood) {
    if (world.supplies.wood < 1) return;
    world.supplies.wood--;
    project.used++;
  }
  project.done += actor.trade === 'mend' ? 1.5 : 1;
  const site = place(map, project.id);
  const stage = project.done >= project.need ? 2 : project.done >= project.need * 0.35 ? 1 : 0;
  remember(actor, world.minute, actor.name + ' put in a shift on ' + (project.for === actor.id ? 'their own cottage' : describe(project, state)) + '.', [actor.id], 'work');
  if (stage === site.stage) return;
  site.stage = stage;
  touch(map);
  if (stage === 2) complete(project, state, emit);
  else emit('build', project.kind === 'field' ? 'The brush is cleared from ' + site.name + ' and the first furrows are cut.'
    : 'The frame of ' + describe(project, state) + ' stands' + whereabouts(map, site) + '.', [actor.id]);
}

// Daily reckoning, taken at dawn before the households draw on the stores.
export function dawn(state) {
  const { world, actors, map } = state, pop = actors.length;
  ripen(world, placesOf(map, 'field'), world.minute, world.barleyStrip?.site, map.seed, weatherAt(world.minute, map.seed));
  keepStores(world);
  const strain = (key, short) => { world.strain[key] = short ? Math.min(6, world.strain[key] + 1) : Math.max(0, world.strain[key] - 0.5); };
  strain('grain', foodDays(world, mouths(state)) < 2);
  strain('bread', world.supplies.bread < pop * 0.5 && world.supplies.flour >= 4);
  strain('water', world.supplies.water < pop);
  for (const key of Object.keys(world.wear)) if (--world.wear[key] <= 0) delete world.wear[key];
  for (const key of Object.keys(world.cooldown)) if (world.cooldown[key] <= world.minute) delete world.cooldown[key];
}

// Counts a walk straight across open ground. Enough of them wear a path into the map.
export function tread(state, fromId, toId, emit) {
  const { world, map } = state, key = [fromId, toId].sort().join('|');
  world.wear[key] = (world.wear[key] || 0) + 1;
  if (world.wear[key] < PATH_WEAR) return;
  delete world.wear[key];
  const a = place(map, fromId), b = place(map, toId);
  if (!a || !b || !clearWalk(map, a.at, b.at, [fromId, toId]) || walkLength(map, fromId, toId) < dist(a.at, b.at) * 1.25) return;
  const ends = [a, b].map(p => {
    if (dist(map.nodes[p.node], p.at) < 0.05) return p.node;
    const n = addNode(map, p.at[0], p.at[1]);
    addEdge(map, n, p.node, 'track');
    return p.node = n;
  });
  const length = dist(a.at, b.at), steps = Math.max(1, Math.round(length / 2.8));
  const road = map.roads.push({ name: null, kind: 'path' }) - 1, bend = (key.length % 2 ? 1 : -1) * length * 0.05;
  let last = ends[0];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, k = Math.sin(t * Math.PI) * bend;
    const n = addNode(map, a.at[0] + (b.at[0] - a.at[0]) * t - (b.at[1] - a.at[1]) / length * k, a.at[1] + (b.at[1] - a.at[1]) * t + (b.at[0] - a.at[0]) / length * k);
    addEdge(map, last, n, 'path', road);
    last = n;
  }
  addEdge(map, last, ends[1], 'path', road);
  const label = p => p.kind === 'cottage' ? 'the cottages' : p.name.startsWith('The ') ? p.name : 'the ' + p.name.toLowerCase();
  emit('build', 'So many feet have crossed between ' + label(a) + ' and ' + label(b) + ' that a path is worn into the grass.');
}
