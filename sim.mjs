// All durable state is plain JSON. No wall-clock reads or process-local random state.
// A village is { world, actors, map }: the map is the generated and grown ground they live on.
import { generateMap } from './engine/worldgen.mjs';
import { place, placesOf, route } from './engine/roads.mjs';
import * as civic from './engine/civic.mjs';
import { newcomer, wantsNewcomer } from './engine/people.mjs';

export const FOCUSES = ['work', 'social', 'rest', 'food'];
export const DEFAULT_SEED = 26111;

// The last column of places a household started at is its workplace; 'cottages' means the resident's own home.
const households = [
  ['agnes', 'Agnes Reed', 'Farmer', 'fields', 'Agnes took over three strips of barley when her older brother left for town. She keeps the first sheaf of every harvest above her door.', ['steadfast', 'generous'], 'Keep a reserve of grain for lean weeks', 'harvest', 'hugh'],
  ['hugh', 'Hugh Fen', 'Miller', 'mill', 'Hugh learned the mill from his aunt. He can hear a loose paddle from the far bank, though he still counts sacks on his fingers.', ['meticulous', 'reserved'], 'Keep the grindstones fed and the flour bin full', 'mill', 'mabel'],
  ['mabel', 'Mabel Ash', 'Baker', 'oven', 'Mabel rebuilt the common oven with clay from the riverbank. She recognizes each household by the mark it presses into its loaves.', ['generous', 'gregarious'], 'Put fresh loaves on every table', 'bake', 'agnes'],
  ['oswin', 'Oswin Holt', 'Woodward', 'wood', 'Oswin marks each season’s cut with a notch on his staff. A good fire at the oven matters more to him than a straight stack.', ['steadfast', 'reserved'], 'Keep the oven supplied with seasoned billets', 'cut', 'edith'],
  ['edith', 'Edith Vale', 'Weaver', 'cottages', 'Edith’s loom fills half her cottage. Her blue cloth once bought seed for a neighbor, and she remembers the bargain fondly.', ['meticulous', 'generous'], 'Finish a bolt of cloth for the village store', 'weave', 'oswin'],
  ['thomas', 'Thomas Pike', 'Carpenter', 'hall', 'Thomas grew up sleeping beneath his father’s workbench. Now he mends the doors, shutters and benches he climbed as a boy.', ['meticulous', 'steadfast'], 'Keep the common buildings in good repair', 'mend', 'alice'],
  ['alice', 'Alice Brook', 'Wellkeeper', 'well', 'Alice came to Dalecrest in a dry summer. She has tended the well rope ever since, and knows who needs a second bucket carried home.', ['gregarious', 'generous'], 'Keep the water barrels filled', 'draw', 'edith'],
  ['robin', 'Robin Marsh', 'Field hand', 'fields', 'Robin was hired for a single harvest and stayed. He still makes time after work to hear the old field songs on the green.', ['gregarious', 'restless'], 'Earn a place among the village households', 'harvest', 'agnes'],
];
// Each job is done at the nearest finished place of its kind; 'home' is the resident's own house.
const jobs = {
  harvest: { at: 'field', label: 'Gathering barley', duration: 80, makes: { grain: 3 }, result: 'brought three measures of barley in from the fields' },
  mill: { at: 'mill', label: 'Grinding barley', duration: 69, takes: { grain: 2 }, makes: { flour: 3 }, result: 'ground two measures of barley into three of flour' },
  bake: { at: 'oven', label: 'Baking bread', duration: 58, takes: { flour: 2, wood: 1 }, makes: { bread: 5 }, result: 'drew five loaves from the oven' },
  cut: { at: 'wood', label: 'Stacking firewood', duration: 78, makes: { wood: 3 }, result: 'stacked three bundles of dry wood' },
  weave: { at: 'home', label: 'Weaving linen', duration: 99, makes: { cloth: 1 }, result: 'finished a length of linen for the village' },
  mend: { at: 'hall', label: 'Mending the hall', duration: 84, makes: { repair: 2 }, result: 'repaired another section of the hall' },
  draw: { at: 'well', label: 'Drawing water', duration: 39, makes: { water: 4 }, result: 'filled four buckets at the well' },
};
const CAPACITY = { grain: 44, flour: 34, bread: 32, wood: 32, cloth: 12, repair: 14, water: 28 };
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
function random(world) {
  world.seed = (Math.imul(world.seed, 1664525) + 1013904223) >>> 0;
  return world.seed / 4294967296;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const memory = civic.remember;

export function placeName(p, actors) {
  if (p.kind !== 'cottage') return p.name;
  const owners = actors.filter(a => a.home === p.id);
  return owners.length ? owners[0].name + '’s cottage' : p.stage < 2 ? 'New cottage' : 'Empty cottage';
}
function wherePhrase(p, actors) {
  const name = placeName(p, actors);
  if (p.kind === 'cottage' || name.startsWith('The ')) return 'at ' + name;
  return (p.kind === 'field' ? 'in the ' : 'at the ') + name.toLowerCase();
}
// Every place a resident can be, keyed by id, for whoever draws or describes the village.
export function locationsOf(map, actors) {
  return Object.fromEntries(map.places.map(p => [p.id, { id: p.id, kind: p.kind, name: placeName(p, actors), x: p.at[0], y: p.at[1], stage: p.stage }]));
}

function inferDesires(actor) {
  const friend = Object.entries(actor.relationships).sort((a, b) => b[1] - a[1])[0]?.[0];
  // A newcomer knows no one yet, so their wish for company has no particular target.
  return [
    { id: 'calling', label: actor.goals[0], focus: 'work', weight: actor.traits.includes('steadfast') ? 9 : 5 },
    { id: 'kinship', label: actor.goals[1], focus: 'social', ...(friend ? { target: friend } : {}), weight: actor.traits.includes('gregarious') ? 12 : 5 },
  ];
}
function desireWeight(actor, focus, target) {
  return clamp(actor.desires.reduce((sum, d) => {
    if (d.focus !== focus || (d.target && d.target !== target) || !Number.isFinite(d.weight)) return sum;
    return sum + d.weight;
  }, 0), -40, 40);
}

// Fills in anything a stored village predates. Safe to repeat.
function normalize({ world, actors, map }) {
  world.capacity ??= { ...CAPACITY };
  world.fields ??= {};
  for (const field of placesOf(map, 'field')) world.fields[field.id] ??= 6;
  world.strain ??= { grain: 0, bread: 0, water: 0 };
  world.proposals ??= [];
  world.projects ??= [];
  world.moot ??= null;
  world.wear ??= {};
  world.cooldown ??= {};
  world.lastArrival ??= world.minute;
  world.arrivals ??= 0;
  for (const actor of actors) {
    if (!Array.isArray(actor.desires)) actor.desires = inferDesires(actor);
    if (!actor.action.reason) actor.action.reason = 'Continuing an activity chosen earlier in the day.';
  }
}

export function createVillage(seed = DEFAULT_SEED) {
  const map = generateMap(seed);
  const world = { minute: 420, seed: (62491 + Math.imul(seed - DEFAULT_SEED, 7919)) >>> 0, supplies: { grain: 12, flour: 7, bread: 12, wood: 11, cloth: 4, repair: 5, water: 12 } };
  const actors = households.map(([id, name, role, site, backstory, traits, goal, trade, friend], i) => {
    const home = 'cottage-' + (i + 1), workplace = site === 'cottages' ? home : site, at = place(map, workplace).at;
    return {
      id, name, role, home, workplace, backstory, traits, trade,
      goals: [goal, 'Make time for ' + households.find(h => h[0] === friend)[1]],
      needs: { hunger: 28 + i * 3, fatigue: 17 + i, loneliness: 19 + i * 5 },
      relationships: Object.fromEntries(households.filter(h => h[0] !== id).map(h => [h[0], h[0] === friend ? 57 : 18 + ((i + h[1].length) % 17)])),
      memories: [], plan: null, position: { x: at[0], y: at[1] },
      action: { kind: 'idle', label: 'Starting the day', reason: 'The morning bell has just rung.', target: workplace, phase: 'working', remaining: 0 },
      lastChat: -100, lastJob: -400, daysWorked: 0, lastWorkDay: -1,
    };
  });
  for (const actor of actors) actor.desires = inferDesires(actor);
  const village = { world, actors, map, events: [{ type: 'village', minute: world.minute, actorIds: [], text: 'The morning bell rings across Dalecrest.' }] };
  normalize(village);
  world.mapRevision = map.revision;
  return village;
}

// Gives a village stored before the map existed a generated one, and moves its residents onto it.
export function adoptVillage({ world, actors }, seed = DEFAULT_SEED) {
  const map = generateMap(seed);
  actors.forEach((actor, i) => {
    actor.home = place(map, 'cottage-' + (i + 1)) ? 'cottage-' + (i + 1) : 'hall';
    if (actor.workplace === 'cottages') actor.workplace = actor.home;
    if (!place(map, actor.action.target)) actor.action.target = actor.home;
    delete actor.action.path;
    const here = place(map, actor.action.phase === 'working' ? actor.action.target : actor.home);
    actor.position = { x: here.at[0], y: here.at[1] };
  });
  normalize({ world, actors, map });
  world.mapRevision = map.revision;
  return map;
}

function workSite(actor, key, { world, map }) {
  const kind = jobs[key].at;
  if (kind === 'home') return actor.home;
  let best, value = -Infinity;
  for (const p of map.places) {
    if (p.kind !== kind || p.stage !== 2) continue;
    let score = -Math.hypot(p.at[0] - actor.position.x, p.at[1] - actor.position.y);
    if (kind === 'field') {
      if ((world.fields[p.id] || 0) < 3) continue;
      score += world.fields[p.id] * 6;
    }
    if (score > value) { value = score; best = p.id; }
  }
  return best;
}
function stocked(world, job) {
  return Object.entries(job.takes || {}).every(([k, n]) => world.supplies[k] >= n)
    && Object.entries(job.makes).every(([k, n]) => world.supplies[k] <= world.capacity[k] - n);
}
function jobOptions(actor, state, allFeasible) {
  const { world } = state;
  // When stores run low, anyone can lend a hand in the fields or coppice.
  const list = [...new Set([actor.trade, 'harvest', 'cut', 'draw'])];
  const options = [];
  for (const key of list) {
    const job = jobs[key];
    if (!stocked(world, job)) continue;
    const material = Object.keys(job.makes)[0];
    const shortage = 1 - world.supplies[material] / world.capacity[material];
    if (!allFeasible && key !== actor.trade && shortage < 0.67) continue;
    const site = workSite(actor, key, state);
    if (!site) continue;
    const pledged = shortage > 0.5 && actor.memories.some(m => m.shortage === material && world.minute - m.minute < 480);
    const score = 22 + 33 * shortage + (actor.trade === key ? 13 : 0) + (pledged ? 12 : 0);
    options.push({ key, score, site });
  }
  return options.sort((a, b) => b.score - a.score);
}
function nearest(actor, map, kind) {
  let best, gap = Infinity;
  for (const p of map.places) {
    if (p.kind !== kind || p.stage !== 2) continue;
    const d = Math.hypot(p.at[0] - actor.position.x, p.at[1] - actor.position.y);
    if (d < gap) { gap = d; best = p; }
  }
  return best;
}

function choose(actor, state, menu) {
  const { world, actors, map } = state;
  const choices = [];
  const dayTime = world.minute % 1440;
  const night = dayTime >= 1260 || dayTime < 340;
  const { hunger, fatigue, loneliness } = actor.needs;
  if (!menu && actor.plan && (!FOCUSES.includes(actor.plan.focus) || !Number.isFinite(actor.plan.until) || actor.plan.until <= world.minute)) actor.plan = null;
  if (!place(map, actor.home)) actor.home = 'hall';
  function offer(kind, label, target, duration, score, reason, extra = {}) {
    if (menu) {
      const id = [kind, extra.job || extra.friendId, target].filter(Boolean).join(':');
      menu.set(id, { kind, label, target, remaining: duration, ...extra });
      return;
    }
    score += desireWeight(actor, kind, extra.friendId || extra.job || target);
    if (actor.plan?.focus === kind) {
      score += 15;
      reason = reason.replace(/\.$/, '') + ', in keeping with today’s intention.';
    }
    choices.push({ score: score + 4 * random(world), kind, label, reason, target, remaining: duration, ...extra });
  }
  const jobsHere = jobOptions(actor, state, Boolean(menu));
  const duty = actor.traits.includes('steadfast') ? 5 : 0;
  const weary = (night ? 48 : 0) + Math.max(0, fatigue - 65);
  for (const job of (menu ? jobsHere : jobsHere.slice(0, 1))) {
    const spec = jobs[job.key];
    const material = Object.keys(spec.makes)[0];
    const reason = 'The village has ' + world.supplies[material] + ' of ' + world.capacity[material] + ' units of ' + material + ' in reserve.';
    offer('work', spec.label, job.site, spec.duration, job.score + duty - weary, reason, { job: job.key });
  }
  const build = civic.buildChoice(actor, state);
  if (build) offer('work', build.label, build.project.id, 70, build.score + duty - weary, build.reason, { job: 'build' });
  if (civic.mootOpen(world)) {
    const backs = world.proposals.some(p => p.supporters.includes(actor.id));
    offer('meeting', 'Attending the moot', 'hall', 75, 82 + (backs ? 10 : 0), 'The moot meets at the hall this evening to settle what the village should build.');
  }
  const oven = nearest(actor, map, 'oven');
  if (world.supplies.bread > 0 && oven) offer('food', 'Taking a loaf at the ' + (oven.id === 'oven' ? 'oven' : 'bakehouse'), oven.id, 17, hunger * 1.35 - 16, 'There is bread to be had and my hunger is ' + Math.round(hunger) + ' out of 100.');
  const lodging = civic.isLodger(actor, map);
  offer('rest', (night ? 'Sleeping ' : 'Resting ') + (lodging ? 'at the hall' : 'at home'), actor.home, night ? 105 : 54, fatigue + (night ? 48 : -9), night ? 'It is time to sleep and recover for tomorrow.' : 'My fatigue has reached ' + Math.round(fatigue) + ' out of 100.');
  // Seek a friend with a reachable destination. Recent pleasant meetings favor a return visit.
  let friend, best = -Infinity;
  for (const other of actors) {
    if (other === actor || other.action.kind === 'rest' || other.action.kind === 'arrive') continue;
    const site = place(map, other.action.target);
    if (!site || (menu && other.action.kind === 'waiting')) continue;
    if (menu) {
      offer('social', 'Visiting ' + other.name, other.action.target, 28, 0, '', { friendId: other.id });
      continue;
    }
    const recent = actor.memories.slice(-5).some(m => m.kind === 'social' && m.actorIds.includes(other.id));
    const appeal = (actor.relationships[other.id] || 0) * 0.35 + desireWeight(actor, 'social', other.id) + (recent ? 6 : 0)
      - Math.hypot(site.at[0] - actor.position.x, site.at[1] - actor.position.y) * 0.17 + random(world) * 16;
    if (appeal > best) { best = appeal; friend = other; }
  }
  if (friend) offer('social', 'Visiting ' + friend.name.split(' ')[0], friend.action.target, 28, loneliness + (actor.traits.includes('gregarious') ? 13 : 0) - (night ? 28 : 0), 'I could use some company and know where to find ' + friend.name + '.', { friendId: friend.id });
  const alehouse = dayTime >= 960 && nearest(actor, map, 'alehouse');
  if (alehouse) offer('leisure', 'Sitting in ' + alehouse.name, alehouse.id, 50, 26 + loneliness * 0.4 + (actor.traits.includes('gregarious') ? 8 : 0) - (night ? 12 : 0), 'The day’s work is done and there will be company at ' + alehouse.name + '.');
  offer('leisure', 'Walking on the green', 'green', 44, 30 + (actor.traits.includes('restless') ? 6 : 0) - (night ? 17 : 0), 'A walk on the green will ease my fatigue.');
  if (menu) return;
  choices.sort((a, b) => b.score - a.score);
  const { score, ...chosen } = choices[0];
  chosen.phase = 'travelling';
  actor.action = chosen;
}

// Walks one minute along the route to the current destination. Returns true on arrival.
function travel(actor, state, emit) {
  const { map } = state, action = actor.action;
  if (!action.path) {
    const found = route(map, [actor.position.x, actor.position.y], action.target);
    if (!found) { action.remaining = 0; return false; }
    action.path = found.pts;
    if (found.direct && found.from && found.length >= 5 && found.byRoad > found.length * 1.25) action.across = found.from;
  }
  let stride = actor.traits.includes('restless') ? 2.65 : 2.15;
  while (action.path.length) {
    const [x, y] = action.path[0];
    const d = Math.hypot(x - actor.position.x, y - actor.position.y);
    if (d > stride) {
      actor.position.x += stride * (x - actor.position.x) / d;
      actor.position.y += stride * (y - actor.position.y) / d;
      return false;
    }
    actor.position = { x, y };
    stride -= d;
    action.path.shift();
  }
  delete action.path;
  if (action.across) {
    const from = action.across;
    delete action.across;
    civic.tread(state, from, action.target, emit);
  }
  action.phase = 'working';
  return true;
}

export function availableActions(actor, state) {
  const menu = new Map();
  choose(actor, state, menu);
  const reachable = new Map();
  for (const [id, action] of menu) {
    if (!reachable.has(action.target)) reachable.set(action.target, Boolean(route(state.map, [actor.position.x, actor.position.y], action.target)));
    if (!reachable.get(action.target)) menu.delete(id);
  }
  return menu;
}

function waitForDecision(actor, minute) {
  if (actor.action.kind === 'waiting') return;
  const { kind, label, target } = actor.action;
  actor.action = { kind: 'waiting', phase: 'waiting', label: 'Choosing the next activity', target, remaining: 0,
    since: minute, previous: { kind, label, target }, reason: 'Waiting for a decision from gpt-6-luna.' };
  actor.plan = null;
}

function stepMinute(state, events, externalActions) {
  const { world, actors, map } = state;
  const minute = ++world.minute;
  const emit = (type, text, actorIds = []) => events.push({ type, minute, text, actorIds });
  if (minute % 1440 === 360) {
    civic.dawn(state);
    for (const [key, used] of Object.entries({ cloth: 1, repair: 2, water: actors.length })) world.supplies[key] = Math.max(0, world.supplies[key] - used);
    emit('village', 'Dawn breaks. The households collect water and take what they need from the village stores.');
  }
  if (minute % 1440 === 540 && wantsNewcomer(state) && random(world) < 0.7) {
    const arrival = newcomer(state, () => random(world));
    arrival.desires = inferDesires(arrival);
    actors.push(arrival);
    world.lastArrival = minute;
    world.arrivals++;
    emit('arrival', arrival.name + ', a ' + arrival.role.toLowerCase() + ', came up the road looking for work and will lodge at the hall.', [arrival.id]);
  }
  civic.tick(state, emit, () => random(world));
  for (const actor of actors) {
    const n = actor.needs;
    const action = actor.action;
    const resting = action.kind === 'rest' && action.phase === 'working';
    n.hunger = clamp(n.hunger + 0.042);
    n.fatigue = clamp(n.fatigue + (resting ? -0.24 : action.kind === 'work' ? 0.074 : 0.043));
    n.loneliness = clamp(n.loneliness + (resting ? 0.006 : 0.043));
    if (action.remaining <= 0) {
      if (externalActions) waitForDecision(actor, minute);
      else choose(actor, state);
      continue;
    }
    if (action.phase === 'travelling' && !travel(actor, state, emit)) continue;
    if (--action.remaining > 0) continue;
    if (action.kind === 'work' && action.job === 'build') {
      civic.labour(actor, state, emit);
    } else if (action.kind === 'work') {
      const job = jobs[action.job];
      const ripe = action.job !== 'harvest' || world.fields[action.target] >= 3;
      if (stocked(world, job) && ripe) {
        if (action.job === 'harvest') world.fields[action.target] -= 3;
        for (const [key, qty] of Object.entries(job.takes || {})) world.supplies[key] -= qty;
        for (const [key, qty] of Object.entries(job.makes)) world.supplies[key] += qty;
        const text = actor.name + ' ' + job.result + '.';
        actor.lastJob = minute;
        if (actor.lastWorkDay !== Math.floor(minute / 1440)) { actor.daysWorked++; actor.lastWorkDay = Math.floor(minute / 1440); }
        memory(actor, minute, text, [actor.id], 'work');
        emit('work', text, [actor.id]);
      }
    } else if (action.kind === 'food' && world.supplies.bread >= 1) {
      world.supplies.bread--;
      n.hunger = clamp(n.hunger - 53);
      emit('meal', actor.name + ' took a loaf from the ' + (action.target === 'oven' ? 'common oven' : 'bakehouse') + '.', [actor.id]);
    } else if (action.kind === 'leisure') {
      n.fatigue = clamp(n.fatigue - 7);
      if (action.target !== 'green') n.loneliness = clamp(n.loneliness - 8);
    }
  }
  // Conversations need physical proximity. Both parties remember the same encounter.
  for (const actor of actors) {
    if (actor.action.phase !== 'working' || actor.action.kind === 'rest' || minute - actor.lastChat < 135) continue;
    const other = actors.find(b => b !== actor && b.action.phase === 'working' && b.action.kind !== 'rest'
      && minute - b.lastChat >= 135 && distance(actor.position, b.position) <= 3
      && ((actor.action.kind === 'social' && actor.action.friendId === b.id) || (actor.needs.loneliness > 46 && b.needs.loneliness > 35)));
    if (!other) continue;
    const ids = [actor.id, other.id];
    const speaker = actor.name + ' and ' + other.name;
    const here = place(map, actor.action.target);
    const where = here ? wherePhrase(here, actors) : 'on the road';
    let text = speaker + ' exchanged news ' + where + '.';
    let bond = 3, type = 'social', raised;
    const details = {};
    const shortage = Object.keys(world.capacity).find(k => world.supplies[k] < world.capacity[k] / 4);
    if (here?.kind === 'oven' && world.supplies.bread > 0 && Math.max(actor.needs.hunger, other.needs.hunger) > 40) {
      world.supplies.bread--;
      for (const a of [actor, other]) {
        a.needs.hunger = clamp(a.needs.hunger - 26.5);
        if (a.action.kind === 'food' && a.needs.hunger < 35) a.action.remaining = 0;
      }
      text = speaker + ' divided a warm loaf between them at the oven.';
      bond = 5;
    } else if ((raised = civic.discuss(actor, other, state, () => random(world)))) {
      text = raised.text;
      details.concern = raised.key;
      bond = raised.agreed ? 4 : 2;
      type = 'civic';
    } else if (shortage) {
      text = speaker + ' discussed the dwindling ' + shortage + ' reserve ' + where + '.';
      details.shortage = shortage;
    } else if ((actor.action.kind === 'work' || other.action.kind === 'work') && (actor.action.kind === 'work' ? actor : other).action.job !== 'build') {
      const worker = actor.action.kind === 'work' ? actor : other;
      const helper = worker === actor ? other : actor;
      if (worker.action.remaining > 4) {
        worker.action.remaining -= 4;
        helper.needs.fatigue = clamp(helper.needs.fatigue + 2);
        text = helper.name + ' lent ' + worker.name + ' a hand with ' + jobs[worker.action.job].label.toLowerCase() + '.';
        bond = 4;
      }
    }
    for (const [a, b] of [[actor, other], [other, actor]]) {
      a.needs.loneliness = clamp(a.needs.loneliness - 41);
      a.relationships[b.id] = clamp((a.relationships[b.id] || 0) + bond);
      a.lastChat = minute;
      memory(a, minute, text, ids, 'social', details);
    }
    emit(type, text, ids);
  }
  if (externalActions) {
    for (const actor of actors) if (actor.action.remaining <= 0) waitForDecision(actor, minute);
  }
}

export function stepVillage(state, { minutes = 5, externalActions = false } = {}) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError('minutes must be a nonnegative integer');
  normalize(state);
  const events = [];
  for (let i = 0; i < minutes; i++) stepMinute(state, events, externalActions);
  state.world.mapRevision = state.map.revision;
  return events;
}
