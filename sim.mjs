// All durable state is plain JSON. No wall-clock reads or process-local random state.
// A village is { world, actors, map }: the map is the generated and grown ground they live on.
import { generateMap } from './engine/worldgen.mjs';
import { place, placesOf, route, walkingSegment } from './engine/roads.mjs';
import * as civic from './engine/civic.mjs';
import { newcomer, wantsNewcomer } from './engine/people.mjs';
import * as standing from './engine/standing.mjs';
import { atOven, inspectOven } from './engine/observations.mjs';
import { weatherAt, dayTemp, daylight, chill, fuelPerHearth } from './engine/seasons.mjs';

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
  world.coldHearths ??= [];
  world.fuelCarry ??= 0;
  for (const actor of actors) {
    actor.needs.cold ??= 0;
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
      needs: { hunger: 28 + i * 3, fatigue: 17 + i, loneliness: 19 + i * 5, cold: 0 },
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
    const here = place(map, actor.action.phase === 'travelling' ? actor.home : actor.action.target);
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
function stockObstacle(world, job, allowUnknown = false) {
  for (const [item, quantity] of Object.entries(job.takes || {})) {
    if (allowUnknown && world.supplies[item] == null) continue;
    if (!(world.supplies[item] >= quantity)) return 'there was too little ' + item + ' in store';
  }
  for (const [item, quantity] of Object.entries(job.makes)) {
    if (allowUnknown && world.supplies[item] == null) continue;
    if (!(world.supplies[item] <= world.capacity[item] - quantity)) return 'there was too little room in store for ' + item;
  }
  return null;
}
function jobOptions(actor, state, perceived, allFeasible) {
  // When stores run low, anyone can lend a hand in the fields or coppice.
  const list = [...new Set([actor.trade, 'harvest', 'cut', 'draw'])];
  const options = [];
  // The fields and the coppice are worked by daylight: from first light until half an hour before sunset.
  const sun = daylight(perceived.minute), now = perceived.minute % 1440, light = now >= sun.sunrise - 30 && now <= sun.sunset - 30;
  for (const key of list) {
    const job = jobs[key];
    if (!light && (job.at === 'field' || job.at === 'wood')) continue;
    if (stockObstacle(perceived, job, true)) continue;
    const material = Object.keys(job.makes)[0];
    const amount = perceived.supplies[material];
    const shortage = amount == null ? 0.5 : 1 - amount / perceived.capacity[material];
    if (!allFeasible && key !== actor.trade && shortage < 0.67) continue;
    const site = workSite(actor, key, state);
    if (!site) continue;
    if (key === 'bake') {
      const oven = place(state.map, site);
      if (!atOven(actor, oven) || actor.observations?.ovenStores?.site !== site) continue;
    }
    const pledged = shortage > 0.5 && actor.memories.some(m => m.shortage === material && perceived.minute - m.minute < 480);
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
  const seen = actor.observations?.ovenStores, hearth = actor.observations?.hearth;
  // Waking to a cold hearth is news of the woodpile too, and newer than an earlier look at the oven.
  const bare = hearth && !hearth.lit && hearth.minute > (seen?.minute ?? -1);
  const perceived = { ...world, supplies: { ...world.supplies, flour: seen?.flour, wood: bare ? 0 : seen?.wood } };
  const jobsHere = jobOptions(actor, state, perceived, Boolean(menu));
  const duty = actor.traits.includes('steadfast') ? 5 : 0;
  const weary = (night ? 48 : 0) + Math.max(0, fatigue - 65);
  for (const job of (menu ? jobsHere : jobsHere.slice(0, 1))) {
    const spec = jobs[job.key];
    const material = Object.keys(spec.makes)[0];
    const reason = perceived.supplies[material] == null ? 'I can put in a shift at the ' + spec.at + '.'
      : 'The last known reserve of ' + material + ' was ' + perceived.supplies[material] + ' units.';
    offer('work', spec.label, job.site, spec.duration, job.score + duty - weary, reason, { job: job.key });
  }
  const build = civic.buildChoice(actor, { ...state, world: perceived });
  if (build) offer('work', build.label, build.project.id, 70, build.score + duty - weary, build.reason, { job: 'build' });
  if (civic.mootOpen(world)) {
    const backs = world.proposals.some(p => p.supporters.includes(actor.id));
    offer('meeting', 'Attending the moot', 'hall', 75, 82 + (backs ? 10 : 0), 'The moot meets at the hall this evening to settle what the village should build.');
  }
  const oven = nearest(actor, map, 'oven');
  if (oven) {
    const needsCheck = !atOven(actor, oven) || seen?.site !== oven.id || world.minute - seen.minute >= 180;
    const score = actor.trade === 'bake' && needsCheck ? 60 - weary : 6;
    offer('inspect', 'Checking the oven for flour and firewood', oven.id, 3, score, 'I can go to the oven and count what is on hand.');
  }
  if (world.supplies.bread > 0 && oven) offer('food', 'Taking a loaf at the ' + (oven.id === 'oven' ? 'oven' : 'bakehouse'), oven.id, 17, hunger * 1.35 - 16, 'There is bread to be had and my hunger is ' + Math.round(hunger) + ' out of 100.');
  const lodging = civic.isLodger(actor, map);
  // Someone chilled through goes home to the fire, if there is one.
  const chilled = !night && actor.needs.cold > 45 && !world.coldHearths.includes(actor.home);
  offer('rest', (night ? 'Sleeping ' : chilled ? 'Warming up ' : 'Resting ') + (lodging ? 'at the hall' : 'at home'), actor.home, night ? 105 : 54,
    fatigue + (night ? 48 : -9) + (chilled ? (actor.needs.cold - 45) * 0.9 : 0),
    night ? 'It is time to sleep and recover for tomorrow.' : chilled ? 'I am chilled through and there is a fire at home.' : 'My fatigue has reached ' + Math.round(fatigue) + ' out of 100.');
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
    if (!found) {
      endShiftEarly(actor, state.world.minute, emit, 'blocked', 'the worksite could not be reached');
      action.remaining = 0;
      return false;
    }
    action.path = found.pts;
    if (found.direct && found.from && found.length >= 5 && found.byRoad > found.length * 1.25) action.across = found.from;
  }
  const { points, passed } = walkingSegment(actor, action.path);
  if (points.length) {
    const [x, y] = points.at(-1);
    actor.position = { x, y };
  }
  action.path.splice(0, passed);
  if (action.path.length) return false;
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

// A resident with a real choice to make waits for it where they stand. The clock and everyone else carry on.
function waitForDecision(actor, minute, why) {
  if (actor.action.kind === 'waiting') return false;
  const { kind, label, target, job } = actor.action;
  actor.action = { kind: 'waiting', phase: 'waiting', label: 'Choosing the next activity', target, remaining: 0,
    since: minute, previous: { kind, label, target, ...(job ? { job } : {}) }, why, reason: 'Waiting for a decision from gpt-6-luna.' };
  actor.plan = null;
  return true;
}

const brief = ({ kind, label, target, job }) => ({ kind, label, target, ...(job ? { job } : {}) });

// One activity boundary in the model-driven village. Routine follows a standing instruction a model
// already gave. Anything else waits for a fresh decision. A resident who is already waiting is
// reconsidered each minute, so nightfall can send them to bed on a valid instruction.
function atBoundary(actor, state, records, pilot) {
  const minute = state.world.minute, waiting = actor.action.kind === 'waiting';
  const finished = waiting ? actor.action.previous : actor.action;
  const verdict = standing.consider(actor, state, availableActions(actor, state), finished, pilot);
  for (const end of verdict.ended) records?.push({ actorId: actor.id, minute, basis: 'instruction_ended', routine: end.routine, reason: end.reason, traceId: end.trace });
  if (!verdict.follow) {
    if (waitForDecision(actor, minute, verdict.fresh)) records?.push({ actorId: actor.id, minute, basis: 'waiting', reason: verdict.fresh, action: brief(finished) });
    return;
  }
  const { routine, id, action, instruction } = verdict.follow;
  const waited = waiting ? minute - actor.action.since : 0;
  instruction.uses++;
  actor.action = { ...action, phase: 'travelling', choiceId: id,
    basis: { kind: 'standing', routine, trace: instruction.trace, since: instruction.since, ...(waited ? { waited } : {}) },
    reason: 'Following a choice made earlier for this routine.' };
  records?.push({ actorId: actor.id, minute, basis: 'standing', routine, traceId: instruction.trace, waited, action: brief(actor.action) });
}

// Starts an action the Decisions API chose, if the engine still offers it, and keeps the choice as
// the standing instruction for the routine it answers. Returns null when it can no longer start.
export function startChosen(actor, state, id, trace, pilot = standing.PILOT) {
  if (actor.action.kind !== 'waiting') return null;
  const action = availableActions(actor, state).get(id);
  if (!action) return null;
  const minute = state.world.minute, { since, why, previous } = actor.action;
  actor.action = { ...action, phase: 'travelling', choiceId: id, decisionTraceId: trace.id,
    basis: { kind: 'fresh', trace: trace.id, waited: minute - since, ...(why ? { why } : {}) },
    reason: 'Selected by ' + trace.model + ' after ' + previous.label + '.' };
  actor.plan = null;
  actor.lastModelPlanAt = actor.decidedAt = minute;
  const kept = standing.keep(actor, state, action, trace.id, pilot);
  return { action: actor.action, waited: minute - since, why, routine: kept ? standing.routineOf(action, minute) : null };
}

const tracksShift = action => action.kind === 'work' && (action.job === 'bake' || action.job === 'cut');

function recordWork(actor, minute, emit, text, status, stockDelta, reason) {
  const { action } = actor;
  const outcome = tracksShift(action) ? {
    job: action.job, site: action.target, workerId: actor.id, helperIds: action.helpers || [],
    status, stockDelta, ...(reason && { reason }),
    ...(action.basis && { basis: action.basis.kind }),
    traceId: action.basis?.trace ?? action.decisionTraceId ?? null,
    ...(action.commitmentId != null && { commitmentId: action.commitmentId })
  } : undefined;
  memory(actor, minute, text, [actor.id], 'work');
  emit('work', text, [actor.id], outcome);
}

function endShiftEarly(actor, minute, emit, status, reason) {
  if (!tracksShift(actor.action)) return;
  const task = actor.action.job === 'bake' ? 'baking' : 'woodcutting';
  recordWork(actor, minute, emit, actor.name + ' could not finish the ' + task + ' shift because ' + reason + '.', status, {}, reason);
}

const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const listed = names => names.length > 3 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' others'
  : names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];

// Under a roof: at home, at a meeting or the alehouse, or at an indoor trade.
const indoors = action => action.phase === 'working' && (action.kind === 'rest' || action.kind === 'meeting'
  || (action.kind === 'leisure' && action.target !== 'green') || (action.kind === 'work' && ['bake', 'weave', 'mill'].includes(action.job)));
// Indoors with a fire going. A house that got no firewood this morning has none. The oven warms
// whoever is baking, and the hall and alehouse keep a fire while the common store has wood.
function byAFire(actor, world) {
  const action = actor.action;
  if (!indoors(action) || world.coldHearths.includes(action.target)) return false;
  return action.target === actor.home || action.job === 'bake' || world.supplies.wood > 0;
}

// Each morning in cold weather every hearth takes its day's firewood from the common store: each
// occupied house, and the hall while anyone lodges there. When the store runs short some go without,
// and whose turn that is moves round the village from day to day.
function fuelHearths({ world, actors, map }) {
  const minute = world.minute, rate = fuelPerHearth(dayTemp(minute, map.seed));
  const homes = [...new Set(actors.map(a => a.home))].sort();
  world.coldHearths = [];
  if (!rate) { world.fuelCarry = 0; return { taken: 0, cold: [], hearths: homes.length, lit: homes.length }; }
  // A hearth may burn a fraction of a bundle. What is owed beyond whole bundles carries to tomorrow.
  const want = homes.length * rate + world.fuelCarry, whole = Math.floor(want + 1e-9);
  let lit = homes.length, taken = whole;
  if (whole <= world.supplies.wood) world.fuelCarry = Math.round((want - whole) * 100) / 100;
  else {
    lit = Math.min(homes.length - 1, Math.floor(world.supplies.wood / rate + 1e-9));
    taken = Math.min(world.supplies.wood, Math.ceil(lit * rate - 1e-9));
    world.fuelCarry = 0;
    const first = Math.floor(minute / 1440) % homes.length;
    world.coldHearths = homes.map((_, i) => homes[(first + i) % homes.length]).slice(lit).sort();
  }
  world.supplies.wood -= taken;
  for (const actor of actors) {
    actor.observations ??= {};
    actor.observations.hearth = { minute, lit: !world.coldHearths.includes(actor.home) };
  }
  return { taken, cold: world.coldHearths, hearths: homes.length, lit };
}

// Snow makes poor woodcutting: what lies under it is wet, and less comes home dry enough to burn.
const snowedWood = [null,
  { makes: { wood: 1 }, result: 'dug one bundle of dry wood out from under the snow' },
  { makes: { wood: 2 }, result: 'stacked two bundles of wood, the rest too wet with snow to burn' }];

function finishShift(actor, world, emit, sky) {
  const { job: key, target } = actor.action;
  const minute = world.minute, dry = key !== 'cut' ? 3 : sky.lying > 0.5 ? 1 : sky.snow || sky.lying > 0.1 ? 2 : 3;
  const job = dry < 3 ? { ...jobs[key], ...snowedWood[dry] } : jobs[key];
  const obstacle = stockObstacle(world, job);
  if (obstacle) {
    endShiftEarly(actor, minute, emit, 'blocked', obstacle);
    return;
  }
  if (key === 'harvest') {
    if (!(world.fields[target] >= 3)) return;
    world.fields[target] -= 3;
  }
  const stockDelta = {};
  for (const [item, quantity] of Object.entries(job.takes || {})) stockDelta[item] = -quantity;
  for (const [item, quantity] of Object.entries(job.makes)) stockDelta[item] = (stockDelta[item] || 0) + quantity;
  for (const [item, change] of Object.entries(stockDelta)) world.supplies[item] += change;
  actor.lastJob = minute;
  if (actor.lastWorkDay !== Math.floor(minute / 1440)) { actor.daysWorked++; actor.lastWorkDay = Math.floor(minute / 1440); }
  recordWork(actor, minute, emit, actor.name + ' ' + job.result + '.', 'completed', stockDelta);
}

function stepMinute(state, events, externalActions, records, pilot) {
  const { world, actors, map } = state;
  const minute = ++world.minute;
  const emit = (type, text, actorIds = [], outcome) => events.push({ type, minute, text, actorIds, ...(outcome && { outcome }) });
  const sky = weatherAt(minute, map.seed), bite = chill(sky.temp);
  if (minute % 1440 === 360) {
    civic.dawn(state);
    for (const [key, used] of Object.entries({ cloth: 1, repair: 2, water: actors.length })) world.supplies[key] = Math.max(0, world.supplies[key] - used);
    const burned = fuelHearths(state);
    emit('village', 'Dawn breaks ' + sky.phrase + '. The households collect water and take what they need from the village stores'
      + (burned.taken ? ', and carry home ' + count(burned.taken, 'bundle') + ' of firewood for their hearths.' : '.'));
    if (burned.cold.length) {
      const without = actors.filter(a => burned.cold.includes(a.home));
      emit('village', 'There was firewood for only ' + burned.lit + ' of the ' + burned.hearths + ' hearths this morning. '
        + listed(without.map(a => a.name)) + ' woke to a cold house.', without.map(a => a.id),
        { hearths: burned.hearths, lit: burned.lit, firewoodTaken: burned.taken });
      for (const actor of without) {
        memory(actor, minute, actor.name + ' woke to a cold hearth. There was no firewood left in the common store.', [actor.id], 'observation', { shortage: 'wood' });
      }
    }
  }
  if (minute % 1440 === 540 && wantsNewcomer(state) && random(world) < 0.7) {
    const arrival = newcomer(state, () => random(world));
    arrival.desires = inferDesires(arrival);
    actors.push(arrival);
    world.lastArrival = minute;
    world.arrivals++;
    emit('arrival', arrival.name + ', a ' + arrival.role.toLowerCase() + ', came up the road looking for work and will lodge at the hall.', [arrival.id]);
  }
  civic.tick(state, emit, () => random(world), actor => {
    endShiftEarly(actor, minute, emit, 'interrupted', 'the village moot was about to begin');
  });
  for (const actor of actors) {
    const n = actor.needs;
    const action = actor.action;
    const resting = action.kind === 'rest' && action.phase === 'working';
    const warm = bite > 0 && byAFire(actor, world);
    n.hunger = clamp(n.hunger + 0.042);
    // Nobody sleeps well in a house without a fire.
    n.fatigue = clamp(n.fatigue + (resting ? (bite && !warm && n.cold > 50 ? -0.15 : -0.24) : action.kind === 'work' ? 0.074 : 0.043));
    n.cold = clamp(n.cold + (!bite ? -0.25 : warm ? -0.4 : bite * (indoors(action) ? 0.07 : sky.rain || sky.snow ? 0.15 : 0.11)));
    n.loneliness = clamp(n.loneliness + (resting ? 0.006 : 0.043));
    if (action.remaining <= 0) {
      if (externalActions) atBoundary(actor, state, records, pilot);
      else choose(actor, state);
      continue;
    }
    if (action.phase === 'travelling') {
      if (!travel(actor, state, emit)) continue;
      // A remembered count can be out of date. Discover the obstacle at the oven,
      // after the decision, so a change elsewhere cannot silently alter the offered menu.
      if (action.job === 'bake') {
        const obstacle = stockObstacle(world, jobs.bake);
        if (obstacle) {
          endShiftEarly(actor, minute, emit, 'blocked', obstacle);
          inspectOven(actor, place(map, action.target), world, emit, 'checking a blocked baking shift');
          action.remaining = 0;
          continue;
        }
      }
    }
    if (--action.remaining > 0) continue;
    if (action.kind === 'inspect') {
      inspectOven(actor, place(map, action.target), world, emit);
    } else if (action.kind === 'work' && action.job === 'build') {
      civic.labour(actor, state, emit);
    } else if (action.kind === 'work') {
      finishShift(actor, world, emit, sky);
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
    const shortage = Object.keys(world.capacity).find(k => {
      if (k === 'flour' || k === 'wood') {
        return [actor, other].some(a => a.observations?.ovenStores?.[k] < world.capacity[k] / 4);
      }
      return world.supplies[k] < world.capacity[k] / 4;
    });
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
        if (tracksShift(worker.action)) {
          worker.action.helpers ??= [];
          if (!worker.action.helpers.includes(helper.id)) worker.action.helpers.push(helper.id);
        }
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
    // An activity that ended this minute is settled now, so routine carries straight on.
    for (const actor of actors) if (actor.action.remaining <= 0 && actor.action.kind !== 'waiting') atBoundary(actor, state, records, pilot);
  }
}

// With externalActions the Decisions API chooses at each real choice and the engine never picks an
// activity itself. records, when given, receives how each activity came about.
export function stepVillage(state, { minutes = 5, externalActions = false, records = null, pilot = standing.PILOT } = {}) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError('minutes must be a nonnegative integer');
  normalize(state);
  const events = [];
  for (let i = 0; i < minutes; i++) stepMinute(state, events, externalActions, records, pilot);
  state.world.mapRevision = state.map.revision;
  return events;
}
