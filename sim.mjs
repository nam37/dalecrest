// All durable state is plain JSON. No wall-clock reads or process-local random state.
// A village is { world, actors, map }: the map is the generated and grown ground they live on.
import { generateMap, raiseFell, spreadWood } from './engine/worldgen.mjs';
import { r2 } from './engine/geom.mjs';
import { place, placesOf, route, walkingSegment } from './engine/roads.mjs';
import * as civic from './engine/civic.mjs';
import { civicChoices, enactCivicChoice, normalizeCivicNews } from './engine/civic-news.mjs';
import { grownChild, newcomer, wantsNewcomer } from './engine/people.mjs';
import { arrivingFamily, recordFamilyBreakfasts } from './engine/families.mjs';
import { lessonOffer, prepareChildren, teachMinute, tickChildren } from './engine/children.mjs';
import { dawnLives, finishLifeConversation, lifeChoices, lifeVerbs, maybeCourt, normalizeLife, tickLives, tooIll } from './engine/lives.mjs';
import * as standing from './engine/standing.mjs';
import { atOven, inspectOven, observeGrain } from './engine/observations.mjs';
import { appointReporter, reportingGoal, offerReporting, takeFieldNotes } from './engine/reporting.mjs';
import { bedConversationChoices, canContact, conversationChoices, finishConversation, missedConversation, recordPrivateReview, requestReviewMenu, knownStores, noteWork, settleHelp, expireHelp } from './engine/exchanges.mjs';
import { weatherAt, dayTemp, nextOutdoorStart, chill, fuelPerHearth } from './engine/seasons.mjs';
import { bedJob, finishVillageWork, normalizeVillageWork, ownWorkChoices, repairBedSpec, tickBarley, villageJobs, villageWorkObstacle } from './engine/village-work.mjs';
import { advanceForageShift, finishForageShift, outingResult } from './engine/foraging.mjs';
import { BARN, foodDays, mouths, normalizeStores } from './engine/stores.mjs';
import { breadDraw, burnHearths, foodDraw, foodDrawJobs, spareFood } from './engine/households.mjs';
import { MEAL_FLOOR, STORED, STOREHOUSE, addStorehouse, drawAndEat, drawable, issueAllowance, keepShelves, normalizeAllowance, storehouseOf } from './engine/storehouse.mjs';
import { FEAST_HOURS, feastOf, feastOn, isOwnTrade, normalizeBuildings, repairLoss, restDay, tradeOpen, waitTurn, waitedTooLong, wear } from './engine/workday.mjs';
import { dawnVisitors, tickVisitors } from './engine/visitors.mjs';
import { forgetTold, judge } from './engine/chronicle.mjs';
import { normalizeMemories } from './engine/memory.mjs';
import { noteShift, normalizeGoals, settleGoals, watchGoals } from './engine/goals.mjs';
import { familiar, fade, warm } from './engine/bonds.mjs';
import { addStock, cottageBatches, foodMix, nextFreshExpiry, produceFoods, spoilCottageProduce, spoilFreshFood, takeFoodBatches, takeStock } from './engine/fresh-food.mjs';
import { HUNGER, HUNGRY_AT_DAWN, foodReserve, hungerPerMinute, mealRecord, relieveHunger } from './engine/nutrition.mjs';
import { dawnSmallholding, farmJobs, farmOutput, normalizeSmallholding } from './engine/smallholding.mjs';
import { walkingFatigue } from './engine/footwear.mjs';

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
  ['robin', 'Robin Marsh', 'Village journalist', 'hall', 'Robin was hired for a single harvest and stayed. He still makes time after work to hear the old field songs on the green.', ['gregarious', 'restless'], reportingGoal, 'report', 'agnes'],
];
// Each job is done at the nearest finished place of its kind; 'home' is the resident's own house.
const jobs = {
  ...villageJobs,
  harvest: { at: 'field', label: 'Gathering barley', duration: 80, makes: { grain: 3 }, result: 'brought three measures of barley in from the fields' },
  mill: { at: 'mill', label: 'Grinding barley', duration: 69, takes: { grain: 2 }, makes: { flour: 3 }, result: 'ground two measures of barley into three of flour' },
  bake: { at: 'oven', label: 'Baking bread', duration: 58, takes: { flour: 2, wood: 1 }, makes: { bread: 5 }, result: 'drew five loaves from the oven' },
  cut: { at: 'wood', label: 'Stacking firewood', duration: 78, makes: { wood: 3 }, result: 'stacked three bundles of dry wood' },
  weave: { at: 'home', label: 'Weaving linen', duration: 99, makes: { cloth: 1 }, result: 'finished a length of linen for the village' },
  mend: { at: 'hall', label: 'Mending the hall', duration: 84, makes: { repair: 2 }, result: 'repaired another section of the hall' },
  draw: { at: 'well', label: 'Drawing water', duration: 39, makes: { water: 4 }, result: 'filled four buckets at the well' },
  keep: { at: 'storehouse', label: 'Counting the storehouse shelves', duration: 40, makes: {}, result: 'counted the shelves at the storehouse' },
};
const CAPACITY = { grain: BARN.grain, flour: BARN.flour, bread: 32, wood: 32, cloth: 12, repair: 14, water: 28 };
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

function decisionAfter(verb, label = '') {
  const activity = label.trim().replace(/[.!?]+$/, '');
  if (/^[a-z]+ing\b/i.test(activity)) return verb + ' after ' + activity[0].toLowerCase() + activity.slice(1) + '.';
  return verb + '.' + (activity ? ' The previous activity was “' + activity + '”.' : '');
}

// Fills in anything a stored village predates. Safe to repeat.
function normalize({ world, actors, map }) {
  // A village founded with today's stores has its barn already.
  if (!world.capacity) { world.capacity = { ...CAPACITY }; world.barn = true; }
  normalizeStores(world);
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
    appointReporter(actor);
    actor.needs.cold ??= 0;
    normalizeMemories(actor);
    normalizeLife(actor, world.minute);
    normalizeGoals(actor, world.minute);
    if (!Array.isArray(actor.desires)) actor.desires = inferDesires(actor);
    const lastChoice = /^Selected by .+? after (.+)\.$/.exec(actor.action.reason);
    if (lastChoice) actor.action.reason = decisionAfter('Chose this', lastChoice[1]);
    if (actor.action.kind === 'waiting') actor.action.reason = decisionAfter('Will decide', actor.action.previous?.label);
    if (!actor.action.reason) actor.action.reason = 'Continuing an activity chosen earlier in the day.';
  }
  normalizeCivicNews({ world, actors, map });
  normalizeVillageWork({ world, actors, map });
  addStorehouse(map);
  spreadWood(map);
  raiseFell(map);
  normalizeSmallholding({ world, map });
  normalizeAllowance({ world, actors });
  normalizeBuildings({ world, map });
  prepareChildren({ world, actors, map });
}

export function createVillage(seed = DEFAULT_SEED) {
  const map = generateMap(seed);
  const world = { minute: 420, barn: true, seed: (62491 + Math.imul(seed - DEFAULT_SEED, 7919)) >>> 0, supplies: { grain: 12, flour: 7, bread: 12, wood: 11, cloth: 4, repair: 5, water: 12 } };
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
  const strip = world.barleyStrip;
  if (kind === 'field' && strip?.keeper === actor.id && world.fields[strip.site] >= 3 && place(map, strip.site)?.stage === 2) return strip.site;
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
function jobCandidate(actor, key, state, perceived, daylight) {
  const job = jobs[key];
  if (!tradeOpen(key, perceived.minute)) {
    return restDay(perceived.minute)
      ? { status: 'rest_day', note: 'My trade observes the day of rest.' }
      : { status: 'hours', note: 'This is outside my trade’s working hours.' };
  }
  if (!daylight && (job.at === 'field' || job.at === 'wood')) {
    return { status: 'daylight', note: 'There is too little daylight to start my work outdoors.' };
  }
  if (key === 'keep' && perceived.minute - (actor.lastShelfCount?.minute ?? -Infinity) < 360) {
    return { status: 'recent_count', note: 'I counted the shelves recently. My next round is later.' };
  }
  const obstacle = stockObstacle(perceived, job, true);
  if (obstacle) return { status: 'stocks', note: 'As far as I know, ' + obstacle + ' for my trade.' };
  const site = workSite(actor, key, state);
  if (!site) return job.at === 'field'
    ? { status: 'no_ripe_barley', note: 'There is no strip ready to reap.' }
    : { status: 'no_site', note: 'There is no place ready for my trade.' };
  if (key === 'bake' && (!atOven(actor, place(state.map, site)) || actor.observations?.ovenStores?.site !== site)) {
    return { status: 'oven_check', note: 'I need to be at the oven and check its flour and firewood before I can bake.' };
  }
  return { status: 'available', site };
}

function jobOptions(actor, state, perceived, allFeasible, diagnostics) {
  // When stores run low, anyone can lend a hand in the fields or coppice.
  const list = [...new Set([actor.trade, 'harvest', 'cut', 'draw'])].filter(key => jobs[key]);
  const options = [];
  // The fields and the coppice are worked by daylight: from first light until half an hour before sunset.
  const light = nextOutdoorStart(perceived.minute) === perceived.minute;
  for (const key of list) {
    const job = jobs[key];
    const candidate = jobCandidate(actor, key, state, perceived, light);
    if (diagnostics && key === actor.trade) diagnostics.ownTrade = candidate;
    if (candidate.status !== 'available') continue;
    const material = Object.keys(job.makes)[0];
    const amount = perceived.supplies[material];
    const shortage = amount == null ? 0.5 : 1 - amount / perceived.capacity[material];
    if (!allFeasible && key !== actor.trade && shortage < 0.67) continue;
    const pledged = shortage > 0.5 && actor.memories.some(m => m.shortage === material && perceived.minute - m.minute < 480);
    const score = 22 + 33 * shortage + (actor.trade === key ? 13 : 0) + (pledged ? 12 : 0);
    options.push({ key, score, site: candidate.site });
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

function choose(actor, state, menu, diagnostics) {
  const { world, actors, map } = state;
  const choices = [];
  const dayTime = world.minute % 1440;
  const night = standing.isNight(world.minute);
  const { hunger, fatigue, loneliness } = actor.needs;
  if (!menu && actor.plan && (!FOCUSES.includes(actor.plan.focus) || !Number.isFinite(actor.plan.until) || actor.plan.until <= world.minute)) actor.plan = null;
  if (!place(map, actor.home)) actor.home = 'hall';
  function offer(kind, label, target, duration, score, reason, extra = {}) {
    if (menu) {
      const id = [kind, extra.job || extra.friendId || extra.meal || (extra.feast && 'feast') || (extra.company && 'company'), target].filter(Boolean).join(':');
      menu.set(id, { kind, label, target, remaining: duration, ...extra });
      return;
    }
    const focus = kind === 'report' ? 'work' : kind;
    score += desireWeight(actor, focus, extra.friendId || extra.job || target);
    if (actor.plan?.focus === focus) {
      score += 15;
      reason = reason.replace(/\.$/, '') + ', in keeping with today’s intention.';
    }
    choices.push({ score: score + 4 * random(world), kind, label, reason, target, remaining: duration, ...extra });
  }
  const seen = actor.observations?.ovenStores, hearth = actor.observations?.hearth;
  const known = knownStores(actor);
  const bare = hearth && !hearth.lit && !world.cottages?.[actor.home] && hearth.minute > (known?.minute ?? -1);
  const perceived = { ...world, supplies: { ...world.supplies, flour: known?.flour, wood: bare ? 0 : known?.wood } };
  const jobsHere = jobOptions(actor, state, perceived, Boolean(menu), diagnostics);
  const duty = actor.traits.includes('steadfast') ? 5 : 0;
  const weary = (night ? 48 : 0) + Math.max(0, fatigue - 65);
  if (actor.trade === 'report' && !night) offerReporting(actor, state, offer, weary);
  const ill = tooIll(actor);
  const lesson = lessonOffer(actor, state);
  if (lesson) offer('teach', 'Teaching letters and reading', 'hall', lesson.duration, 80 - weary, lesson.reason, { indoors: true });
  for (const job of (ill ? [] : menu ? jobsHere : jobsHere.slice(0, 1))) {
    const spec = jobs[job.key];
    const material = Object.keys(spec.makes)[0];
    const reason = perceived.supplies[material] == null ? 'I can put in a shift at the ' + spec.at + '.'
      : 'The last known reserve of ' + material + ' was ' + perceived.supplies[material] + ' units.';
    offer('work', spec.label, job.site, spec.duration, job.score + duty - weary, reason, { job: job.key });
  }
  if (!ill) ownWorkChoices(actor, state, (job, target, score, reason, extra = {}) => {
    const spec = job === bedJob ? repairBedSpec(actor) : jobs[job];
    if (menu ? stockObstacle(perceived, spec, true) : stockObstacle(world, spec)) return;
    const { label = spec.label, duration = spec.duration, ...details } = extra;
    offer('work', label, target, duration, score, reason, { job, ...(spec.indoors && { indoors: true }), ...details });
  }, weary);
  if (!menu) {
    const proposals = new Map();
    civicChoices(actor, state, proposals);
    for (const action of proposals.values()) {
      const { kind, label, target, remaining, localScore, reason, ...details } = action;
      offer(kind, label, target, remaining, localScore - weary, reason, details);
    }
    const conversations = new Map();
    if (!ill) bedConversationChoices(actor, state, conversations);
    // Courtship under local rules: the asking and the answer weighed on warmth.
    lifeChoices(actor, state, (id, action, score) => {
      const { kind, label, target, remaining, ...extra } = action;
      offer(kind, label, target, remaining, score - weary, extra.verb === 'propose' ? 'We have walked out together a while now.' : 'I have been asked to marry.', extra);
    });
    for (const action of conversations.values()) {
      const { kind, label, target, remaining, verb, ...extra } = action;
      const score = verb === 'ask' ? 46 + (action.onSpot ? 12 : 0) : verb === 'accept' ? 72 : 40;
      offer(kind, label, target, remaining, score - weary, 'There is a broken bed that needs attention.', { verb, ...extra });
    }
  }
  const build = !ill && tradeOpen('build', world.minute) && civic.buildChoice(actor, { ...state, world: perceived });
  if (build) offer('work', build.label, build.project.id, 70, build.score + duty - weary, build.reason, { job: 'build' });
  if (civic.canAttendMoot(actor, state)) {
    const backs = world.proposals.some(p => p.supporters.includes(actor.id));
    offer('meeting', 'Attending the moot', 'hall', 75, 82 + (backs ? 10 : 0), 'The moot meets at the hall this evening to settle what the village should build.');
  }
  const oven = nearest(actor, map, 'oven');
  if (oven) {
    const needsCheck = !atOven(actor, oven) || seen?.site !== oven.id || world.minute - seen.minute >= 180;
    const score = actor.trade === 'bake' && needsCheck ? 60 - weary : 6;
    offer('inspect', 'Checking the oven for flour and firewood', oven.id, 3, score, 'I can go to the oven and count what is on hand.');
  }
  // Nobody is offered a meal before they are hungry. Bread is drawn at the storehouse against the
  // household's allowance and eaten at home; salt fish and cooked food are served at the hall.
  if (hunger >= MEAL_FLOOR) {
    const cottage = world.cottages?.[actor.home];
    if (storehouseOf(map) && drawable(actor, world) >= 1) offer('food', cottage ? 'Drawing the household’s bread at the storehouse' : 'Drawing my bread at the storehouse',
      STOREHOUSE, 17, hunger * 1.35 - 16 - (cottage?.larder >= 1 ? 8 : 0), 'The day’s bread is due at the storehouse and my hunger is ' + Math.round(hunger) + ' out of 100.', { meal: 'draw' });
    if (cottage?.larder >= 1) offer('food', 'Eating bread at home', actor.home, 15, hunger * 1.35 - 12,
      'There is bread in the larder at home.', { meal: 'larder', indoors: true });
    if (spareFood(cottage, 'preserved', world.minute) >= 1) {
      offer('food', 'Eating preserved food at home', actor.home, 15, hunger * 1.35 - 12,
        'There is a preserved portion in the larder beyond what the children need for breakfast.', { meal: 'homePreserved', indoors: true });
    }
    if (world.supplies.cooked > 0) offer('food', 'Eating a cooked meal', 'hall', 21, hunger * 1.35 - 11,
      'A cooked portion is ready at the hall.', { meal: 'cooked', indoors: true });
    if (world.supplies.preserved > 0) offer('food', 'Eating preserved food at the hall', 'hall', 20, hunger * 1.35 - 21,
      'Salt fish and smoked meat from the storehouse are served at the hall.', { meal: 'preserved', indoors: true });
    for (const [food, portion] of Object.entries(produceFoods)) {
      const lightMeal = hunger <= HUNGER[food] + 12;
      if (spareFood(cottage, food, world.minute) >= 1) offer('food', 'Eating ' + portion + ' at home', actor.home, 12,
        hunger * 1.35 - (lightMeal ? 8 : 17), 'There is ' + portion + ' in the larder at home.', { meal: food, mealAtHome: true, indoors: true });
      if (world.supplies[food] > 0) {
        const useSoon = nextFreshExpiry(world, food) - world.minute <= 2 * 1440;
        offer('food', 'Eating ' + portion + (useSoon ? ' before it spoils' : ''), 'hall', 14,
          hunger * 1.35 - 18 + (lightMeal ? 9 : 0) + (useSoon ? 12 : 0),
          'There is ' + portion + ' ready to eat at the hall' + (useSoon ? ' that will spoil soon.' : '.'),
          { meal: food, indoors: true });
      }
    }
  }
  const lodging = civic.isLodger(actor, map);
  // Someone chilled through goes home to the fire, if there is one.
  const chilled = !night && actor.needs.cold > 45 && !world.coldHearths.includes(actor.home);
  offer('rest', (night ? 'Sleeping ' : chilled ? 'Warming up ' : 'Resting ') + (!lodging ? 'at home' : actor.home === STOREHOUSE ? 'at the storehouse' : 'at the hall'), actor.home, night ? 105 : 54,
    fatigue + (night ? 48 : -9) + (chilled ? (actor.needs.cold - 45) * 0.9 : 0),
    night ? 'It is time to sleep and recover for tomorrow.' : chilled ? 'I am chilled through and there is a fire at home.' : 'My fatigue has reached ' + Math.round(fatigue) + ' out of 100.');
  // Seek a friend with a reachable destination. Recent pleasant meetings favor a return visit.
  let friend, best = -Infinity;
  for (const other of actors) {
    if (other === actor || !canContact(actor, other, world.minute)) continue;
    const site = place(map, other.action.target);
    if (!site) continue;
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
  if (menu && alehouse) offer('leisure', 'Spending time with whoever is at the alehouse', alehouse.id, 50, 0, '', { company: true });
  const feast = feastOn(world.minute);
  if (feast) offer('leisure', 'Keeping ' + feast + ' at the feast on the green', 'green', Math.max(20, FEAST_HOURS[1] - dayTime), 64 + loneliness * 0.3 - weary * 0.5,
    'The village keeps ' + feast + ' with a feast on the green this afternoon.', { feast });
  offer('leisure', 'Walking on the green', 'green', 44, 30 + (actor.traits.includes('restless') ? 6 : 0) - (night ? 17 : 0), 'A walk on the green will ease my fatigue.');
  if (menu) offer('leisure', 'Spending time on the green', 'green', 44, 0, '', { company: true });
  if (menu) return;
  choices.sort((a, b) => b.score - a.score);
  const { score, ...chosen } = choices[0];
  chosen.phase = chosen.onSpot ? 'working' : 'travelling';
  actor.action = chosen;
}

// Walks one minute along the route to the current destination. Returns true on arrival.
function travel(actor, state, emit) {
  const { map } = state, action = actor.action;
  if (!action.path) {
    const found = route(map, [actor.position.x, actor.position.y], action.target);
    if (!found) {
      endShiftEarly(actor, state, emit, 'blocked', 'the worksite could not be reached');
      if (action.kind === 'conversation') missedConversation(actor, state.world.minute, emit, 'the meeting place could not be reached');
      action.remaining = 0;
      return false;
    }
    action.path = found.pts;
    if (found.direct && found.from && found.length >= 5 && found.byRoad > found.length * 1.25) action.across = found.from;
  }
  const { points, passed, walked } = walkingSegment(actor, action.path);
  if (points.length) {
    const [x, y] = points.at(-1);
    actor.position = { x, y };
    actor.needs.fatigue = clamp(actor.needs.fatigue + walkingFatigue(actor, walked));
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

export function availableActions(actor, state, diagnostics) {
  const menu = new Map();
  for (const ballot of civic.ballotOffers(actor, state)) {
    const verb = { support: 'Support', oppose: 'Oppose', abstain: 'Abstain on' }[ballot.choice];
    menu.set(['ballot', ballot.mootId, ballot.proposalKey, ballot.choice].join(':'), {
      ...ballot, kind: 'ballot', label: verb + ' ' + ballot.title, target: 'hall', onSpot: true, remaining: 1,
    });
  }
  if (menu.size) return menu;
  choose(actor, state, menu, diagnostics);
  civicChoices(actor, state, menu);
  bedConversationChoices(actor, state, menu);
  conversationChoices(actor, state, menu);
  lifeChoices(actor, state, (id, action) => menu.set(id, action));
  const ill = tooIll(actor);
  if (ill) for (const [id, action] of menu) if (action.kind === 'work' || action.kind === 'report') menu.delete(id);
  const reachable = new Map();
  for (const [id, action] of menu) {
    if (action.onSpot) continue;
    if (!reachable.has(action.target)) reachable.set(action.target, Boolean(route(state.map, [actor.position.x, actor.position.y], action.target)));
    if (!reachable.get(action.target)) menu.delete(id);
  }
  const review = requestReviewMenu(actor, menu);
  if (diagnostics && actor.trade) {
    if (review !== menu) diagnostics.ownTrade = { status: 'request_review' };
    else if (ill) diagnostics.ownTrade = { status: 'ill', note: 'I am too ill to work at my trade right now.' };
    else if ([...menu.values()].some(action => isOwnTrade(actor, action))) diagnostics.ownTrade = { status: 'available' };
    else if (diagnostics.ownTrade?.status === 'available') diagnostics.ownTrade = { status: 'unreachable', note: 'I cannot get to my worksite.' };
    else if (actor.trade === 'report') diagnostics.ownTrade = standing.isNight(state.world.minute)
      ? { status: 'hours', note: 'I take my reporting rounds by day.' }
      : { status: 'unreachable', note: 'I cannot get to any of my reporting beats.' };
  }
  return review;
}

// A resident with a real choice to make waits for it where they stand. The clock and everyone else carry on.
function waitForDecision(actor, minute, { fresh: why, blockedVisit }) {
  if (actor.action.kind === 'waiting') return false;
  const { kind, label, target, job } = actor.action;
  actor.action = { kind: 'waiting', phase: 'waiting', label: 'Choosing the next activity', target, remaining: 0,
    since: minute, previous: { kind, label, target, ...(job ? { job } : {}) }, why, reason: decisionAfter('Will decide', label),
    ...(blockedVisit && { blockedVisit }) };
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
    if (waiting && verdict.fresh?.startsWith('would run into my promise') && actor.action.why !== verdict.fresh) {
      actor.action.why = verdict.fresh;
      actor.action.since = minute;
      delete actor.action.blockedVisit;
    }
    if (waitForDecision(actor, minute, verdict)) records?.push({ actorId: actor.id, minute, basis: 'waiting', reason: verdict.fresh, action: brief(finished) });
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
  const minute = state.world.minute, { since, why, previous, blockedVisit } = actor.action;
  // The reply and ballot are committed together, even if this is the last minute of voting.
  const ballot = action.kind === 'ballot' && civic.recordBallot(actor, state, action, { source: 'decisions', traceId: trace.id });
  if (action.kind === 'ballot' && !ballot) return null;
  if (action.update) actor.helpBook[action.requestId].consideredFact = action.update.factId;
  let visitChange = blockedVisit;
  // The friend may have started somewhere else while the resident was waiting for the decision.
  if (blockedVisit && action.kind === 'social' && action.friendId === blockedVisit.friendId && action.target !== blockedVisit.from) {
    visitChange = { ...blockedVisit, to: action.target };
  }
  actor.action = { ...action, phase: action.onSpot ? 'working' : 'travelling', choiceId: id, decisionTraceId: trace.id,
    basis: { kind: 'fresh', trace: trace.id, waited: minute - since, ...(why ? { why } : {}),
      ...(visitChange?.to && { visitChange }) },
    reason: decisionAfter('Chose this', previous?.label) };
  actor.plan = null;
  actor.lastModelPlanAt = actor.decidedAt = minute;
  const kept = standing.keep(actor, state, action, trace.id, pilot);
  return { action: actor.action, waited: minute - since, why, routine: kept ? standing.routineOf(action, minute) : null, ...(ballot && { ballot }) };
}

const tracksShift = action => action.kind === 'work' && (action.job === 'bake' || action.job === 'cut' || Object.hasOwn(villageJobs, action.job));

function recordWork(actor, minute, emit, text, status, stockDelta, reason) {
  const { action } = actor;
  const outcome = tracksShift(action) || action.commitmentId ? {
    job: action.job, site: action.workedAt ?? action.target, workerId: actor.id, helperIds: action.helpers || [],
    status, stockDelta, ...(reason && { reason }),
    ...(action.basis && { basis: action.basis.kind }),
    traceId: action.basis?.trace ?? action.decisionTraceId ?? null,
    ...(action.commitmentId != null && { commitmentId: action.commitmentId })
  } : undefined;
  // A storekeeper's count is already remembered, with its shortage, as what was seen.
  const last = actor.memories.at(-1);
  if (!(last?.minute === minute && last.text === text)) memory(actor, minute, text, [actor.id], 'work');
  emit('work', text, [actor.id], outcome);
}

// A shift cut short. Keep the active shift's delivery bookkeeping if it already produced goods.
function endShiftEarly(actor, state, emit, status, reason) {
  const minute = state.world.minute;
  if (actor.action.carrying) return deliver(actor, state, emit);
  if (!tracksShift(actor.action) && !actor.action.commitmentId) return;
  const task = { bake: 'baking', cut: 'woodcutting' }[actor.action.job] || jobs[actor.action.job].task || jobs[actor.action.job].label.toLowerCase();
  recordWork(actor, minute, emit, actor.name + ' could not finish the ' + task + ' shift because ' + reason + '.', status, {}, reason);
}

// What neighbours worry over when they meet. Food and water are judged by how many days they would last,
// so a new granary with room to spare no longer reads as a shortage. Other stores are judged by the bin.
function shortTalk({ world, actors }) {
  const m = mouths({ world, actors });
  if (foodDays(world, m) < 4) return 'grain';
  if (world.supplies.water < actors.length * 1.5) return 'water';
  return ['cloth', 'repair'].find(k => world.supplies[k] < world.capacity[k] / 4);
}

const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const listed = names => names.length > 3 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' others'
  : names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];

// Under a roof: at home, at a meeting or the alehouse, or at an indoor trade.
const indoors = action => action.phase === 'working' && (action.kind === 'rest' || action.kind === 'meeting'
  || action.indoors || (action.kind === 'leisure' && action.target !== 'green')
  || (action.kind === 'work' && !action.carrying && (villageJobs[action.job]?.indoors || ['bake', 'weave', 'mill', 'keep'].includes(action.job))));
// Indoors with a fire going. A house that got no firewood this morning has none. The oven warms
// whoever is baking, and the hall and alehouse keep a fire while the common store has wood.
function byAFire(actor, world) {
  const action = actor.action;
  if (!indoors(action) || world.coldHearths.includes(action.target)) return false;
  return action.target === actor.home || (action.job === 'bake' && !action.carrying) || world.supplies.wood > 0;
}

// Each morning in cold weather every hearth burns its day's firewood: a cottage from its own woodpile,
// and the hall, while anyone lodges there, from the common store. A hearth may burn a fraction of a
// bundle, and what is owed beyond whole bundles carries to tomorrow.
function fuelHearths({ world, actors, map }) {
  const minute = world.minute, rate = fuelPerHearth(dayTemp(minute, map.seed));
  const homes = [...new Set(actors.map(a => a.home))].sort();
  world.hearthRate = rate;
  world.coldHearths = [];
  if (!rate) { world.fuelCarry = 0; return { taken: 0, cold: [], hearths: homes.length, lit: homes.length }; }
  const { cold, hallTaken } = burnHearths(world, homes, rate);
  world.coldHearths = cold;
  const taken = hallTaken, lit = homes.length - cold.length;
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

function finishShift(actor, state, emit, sky) {
  const { world } = state;
  if (actor.action.carrying) return deliver(actor, state, emit);
  const { job: key, target } = actor.action;
  const minute = world.minute, dry = key !== 'cut' ? 3 : sky.lying > 0.5 ? 1 : sky.snow || sky.lying > 0.1 ? 2 : 3;
  let spec = key === bedJob ? repairBedSpec(actor) : jobs[key];
  // A bread draw takes what is due to the household, settled now.
  if (key === 'fetchBread') spec = { ...spec, takes: breadDraw(actor, world) };
  const drawnFood = foodDrawJobs[key];
  if (drawnFood) spec = { ...spec, takes: { [drawnFood]: foodDraw(actor, world, drawnFood) } };
  const changes = dry < 3 ? snowedWood[dry] : outingResult(actor, state, sky);
  let job = changes ? { ...spec, ...changes } : spec;
  // A mill, oven or well in poor repair turns out less, and one out of use turns out nothing.
  const worn = ['mill', 'bake', 'draw'].includes(key) ? repairLoss(world, target) : 0, what = { mill: 'mill', bake: 'oven', draw: 'well' }[key];
  if (worn === Infinity) {
    endShiftEarly(actor, state, emit, 'blocked', 'the ' + what + ' was out of use for want of repair');
    return;
  }
  if (worn) job = { ...job, makes: Object.fromEntries(Object.entries(job.makes).map(([k, v]) => [k, v - worn])),
    result: job.result.replace(/\b(five|four|three)\b(?= (loaves|of flour|buckets))/, w => ({ five: 'four', four: 'three', three: 'two' })[w]) + ', the ' + what + ' being in poor repair' };
  const localObstacle = villageWorkObstacle(actor, world, sky);
  if (!localObstacle && Object.hasOwn(farmJobs, key)) job = { ...job, makes: farmOutput(world, key, job) };
  const obstacle = localObstacle || stockObstacle(world, job);
  if (obstacle) {
    if (key === 'hunt' || key === 'fish') finishForageShift(actor, world, job.result);
    endShiftEarly(actor, state, emit, 'blocked', obstacle);
    return;
  }
  if (key === 'harvest') {
    if (!(world.fields[target] >= 3)) return;
    world.fields[target] -= 3;
  }
  const stockDelta = {}, ingredients = {};
  const larder = drawnFood ? cottageBatches(world.cottages[actor.home], drawnFood, true) : undefined;
  for (const [item, quantity] of Object.entries(job.takes || {})) {
    stockDelta[item] = -quantity;
    for (const [source, amount] of Object.entries(takeStock(world, item, quantity, larder))) {
      ingredients[source] = (ingredients[source] || 0) + amount;
    }
  }
  const origins = job.foodSource ? { [job.foodSource]: 1 } : foodMix(ingredients);
  // Stock carried to the hall or Storehouse is available there once the shift delivers it.
  const store = job.delivery ? place(state.map, job.delivery) : storehouseOf(state.map), carried = {};
  for (const [item, quantity] of Object.entries(job.makes)) {
    stockDelta[item] = (stockDelta[item] || 0) + quantity;
    if (store?.stage === 2 && (job.delivery || STORED.includes(item)) && quantity > 0) carried[item] = quantity;
    else addStock(world, item, quantity, origins);
  }
  if (key === 'fetchBread') actor.action.drawn = job.takes.bread;
  actor.lastJob = minute;
  if (actor.lastWorkDay !== Math.floor(minute / 1440)) { actor.daysWorked++; actor.lastWorkDay = Math.floor(minute / 1440); }
  const result = key === 'keep' ? keepShelves(actor, world, state.actors)
    : finishVillageWork(actor, state, job) || finishForageShift(actor, world, job.result);
  if (Object.keys(carried).length) {
    // Delivery is the last leg of the same shift and needs no choice of its own.
    const what = goodsWords(carried);
    Object.assign(actor.action, { label: 'Carrying ' + what + ' to the ' + (store.id === 'hall' ? 'hall' : 'storehouse'),
      target: store.id, phase: 'travelling', remaining: 1, carrying: carried, ...(origins && { foodOrigins: origins }),
      workedAt: actor.action.target, result, stockDelta, indoors: false });
    delete actor.action.path;
    return;
  }
  settleShift(actor, state, emit, actor.name + ' ' + result + '.', stockDelta, key);
}

// The record of a finished shift, its credit and what the worker now knows.
function settleShift(actor, state, emit, text, stockDelta, key) {
  const { world } = state;
  recordWork(actor, world.minute, emit, text, 'completed', stockDelta);
  observeGrain(actor, state, key);
  noteShift(actor, key);
  // A storekeeper's count is passed on as the count itself, not as an account of the work.
  if (key !== 'keep') noteWork(actor, world, text, stockDelta);
  if (actor.action.commitmentId) settleHelp(actor, world, stockDelta, emit);
}

const GOODS = { bread: ['loaf', 'loaves'], cloth: ['length of linen', 'lengths of linen'], preserved: ['portion', 'portions'], leather: ['piece of leather', 'pieces of leather'],
  peas: ['portion of peas', 'portions of peas'], apples: ['apple', 'apples'], mutton: ['portion of mutton', 'portions of mutton'] };
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
function goodsWords(goods) {
  return Object.entries(goods).map(([item, n]) => (NUMBERS[n] || n) + ' ' + GOODS[item][n === 1 ? 0 : 1]).join(' and ');
}

// Goods set on the storehouse shelves, as far as there is room. The shift is recorded now, so the stock
// change in its record is the one the shelves show.
function deliver(actor, state, emit) {
  const { world } = state, action = actor.action, stockDelta = { ...action.stockDelta };
  for (const [item, quantity] of Object.entries(action.carrying)) {
    const room = Math.max(0, (world.capacity[item] ?? Infinity) - world.supplies[item]), placed = Math.min(quantity, room);
    addStock(world, item, placed, action.foodOrigins);
    stockDelta[item] -= quantity - placed;
  }
  const at = place(state.map, action.target);
  const arrived = at && Math.hypot(actor.position.x - at.at[0], actor.position.y - at.at[1]) < 0.2;
  const them = Object.values(action.carrying).reduce((a, b) => a + b, 0) === 1 ? 'it' : 'them';
  const destination = action.target === 'hall' ? 'hall' : 'storehouse';
  const text = actor.name + ' ' + action.result + (arrived ? (action.result.includes(',') ? ',' : '') + ' and took ' + them + ' to the ' + destination : '') + '.';
  delete action.carrying;
  delete action.foodOrigins;
  action.remaining = 0;
  settleShift(actor, state, emit, text, stockDelta, action.job);
}

// Where an event took place: at the site named for it, or wherever its first resident stood.
// A resident who has settled to something is at a place with a name. One on the road is not.
function spotOf({ actors, map }, actorIds, site) {
  const named = site && place(map, site);
  if (named) return { place: { x: r2(named.x), y: r2(named.y), id: named.id } };
  const who = actors.find(a => a.id === actorIds[0]);
  if (!who?.position) return {};
  const settled = who.action?.phase === 'working' && place(map, who.action.target);
  return { place: { x: r2(who.position.x), y: r2(who.position.y), ...(settled && { id: settled.id }) } };
}

function registerArrival({ world, actors }, resident) {
  normalizeLife(resident, world.minute);
  resident.desires = inferDesires(resident);
  normalizeGoals(resident, world.minute);
  actors.push(resident);
  world.lastArrival = world.minute;
  world.arrivals = (world.arrivals ?? 0) + 1;
}

function arrival(state, trade) {
  const { world } = state;
  const resident = newcomer(state, () => random(world), trade);
  // A traveller is allowed a loaf on the day they arrive.
  if (!world.cottages?.[resident.home]) resident.ration = 1;
  registerArrival(state, resident);
  return { type: 'arrival', minute: world.minute, actorIds: [resident.id], ...spotOf(state, [resident.id]),
    text: resident.name + ', a ' + resident.role.toLowerCase() + ', came up the road ' + (resident.home === STOREHOUSE
      ? 'to keep the storehouse, and will sleep there until there is a cottage to spare.' : 'looking for work and will lodge at the hall.') };
}

// The storehouse needs a keeper. One is sent for as soon as it stands, whatever the season.
function needsKeeper({ actors, map }) {
  return storehouseOf(map) && !actors.some(a => a.trade === 'keep');
}

export function welcomeResidents(state, minimum) {
  const events = [];
  if (state.actors.length >= minimum) return events;
  const beds = 2 - state.actors.filter(actor => actor.home === 'hall').length;
  for (let i = 0; i < beds && state.actors.length < minimum; i++) events.push(arrival(state));
  return events;
}

function stepMinute(state, events, externalActions, records, pilot) {
  const { world, actors, map } = state;
  const minute = ++world.minute, first = events.length;
  const emit = (type, text, actorIds = [], outcome, site) => events.push({ type, minute, text, actorIds, ...(outcome && { outcome }), ...spotOf(state, actorIds, site) });
  expireHelp(state, emit);
  const sky = weatherAt(minute, map.seed), bite = chill(sky.temp);
  spoilCottageProduce(world);
  const dawn = minute % 1440 === 360;
  let hungryAdults, missedBreakfasts;
  if (dawn) {
    hungryAdults = actors.filter(actor => actor.needs.hunger >= HUNGRY_AT_DAWN).length;
    civic.dawn(state);
    forgetTold(world);
    for (const actor of actors) fade(actor, minute);
    for (const [key, used] of Object.entries({ cloth: 1, water: actors.length })) world.supplies[key] = Math.max(0, world.supplies[key] - used);
    wear(state, emit);
    dawnVisitors(state, emit, () => random(world), sky);
    dawnSmallholding(state, emit);
    const burned = fuelHearths(state);
    issueAllowance(state);
    emit('village', 'Dawn breaks ' + sky.phrase + '. The households collect water and take what they need from the village stores'
      + (world.hearthRate ? ', and light their hearths.' : '.'));
    if (burned.cold.length) {
      const without = actors.filter(a => burned.cold.includes(a.home));
      const houses = burned.cold.map(home => { const p = place(map, home); return p ? placeName(p, actors).replace(/^The /, 'the ') : 'the hall'; });
      emit('village', 'The firewood ran out at ' + listed(houses) + ', and ' + listed(without.map(a => a.name)) + ' woke to a cold house.', without.map(a => a.id),
        { hearths: burned.hearths, lit: burned.lit, firewoodTaken: burned.taken });
      for (const actor of without) {
        const own = world.cottages?.[actor.home];
        memory(actor, minute, actor.name + ' woke to a cold hearth. ' + (own ? 'The woodpile at home had run out.' : 'There was no firewood left in the common store for the hall.'),
          [actor.id], 'observation', own ? { shortage: 'woodpile' } : { shortage: 'wood' });
      }
    }
    const spoiled = Math.ceil(world.supplies.cooked / 2);
    takeStock(world, 'cooked', spoiled);
    if (spoiled) emit('village', 'Some cooked food spoiled in the hall’s stores overnight.', [], { spoiled: { cooked: spoiled } }, 'hall');
    missedBreakfasts = dawnLives(state, emit, () => random(world), (child, home) => {
      const grown = grownChild(state, child, home, () => random(world));
      grown.desires = inferDesires(grown);
      normalizeGoals(grown, minute);
      actors.push(grown);
      emit('life', grown.name + ' has come of age and takes up work as a ' + grown.role.toLowerCase() + '.', [grown.id], { life: 'grown' });
    });
    recordFamilyBreakfasts(state);
  }
  const spoiled = spoilFreshFood(world);
  if (Object.keys(spoiled).length) emit('village', 'Some fresh supplies spoiled in the hall’s stores.', [], { spoiled }, 'hall');
  if (dawn) {
    const reserve = world.foodReserve = foodReserve(state, chill(dayTemp(minute, map.seed)));
    emit('village', 'The dawn food count reckoned what was ready to eat and what still needed preparing.', [],
      { foodReserve: reserve, hungryAdults, missedBreakfasts });
  }
  tickLives(state, emit);
  tickVisitors(state, emit);
  if (minute % 1440 === FEAST_HOURS[0] && feastOf(minute)) emit('feast', 'Dalecrest keeps ' + feastOf(minute) + ' with a feast on the green this afternoon.', [], undefined, 'green');
  tickBarley(world, sky, map.seed);
  const family = minute % 1440 === 540 && arrivingFamily(state, () => random(world));
  if (family) {
    for (const adult of family.adults) registerArrival(state, adult);
    emit('arrival', family.text, family.parents, family.outcome);
  } else if (minute % 1440 === 540 && wantsNewcomer(state) && random(world) < 0.7) {
    events.push(arrival(state));
  } else if (minute % 60 === 0 && minute % 1440 >= 480 && minute % 1440 <= 1080 && needsKeeper(state)) {
    events.push(arrival(state, 'keep'));
  }
  civic.tick(state, emit, () => random(world), actor => {
    endShiftEarly(actor, state, emit, 'interrupted', 'the village moot was about to begin');
    if (actor.action.kind === 'conversation') missedConversation(actor, minute, emit, 'the village moot was about to begin');
  }, { externalBallots: externalActions });
  for (const actor of actors) {
    const n = actor.needs;
    const action = actor.action;
    if (externalActions && action.kind === 'meeting' && civic.ballotOffers(actor, state).length) action.remaining = 0;
    const resting = action.kind === 'rest' && action.phase === 'working';
    const warm = bite > 0 && byAFire(actor, world);
    const cottage = world.cottages?.[action.target];
    const poorRest = (bite && !warm && n.cold > 50) || cottage?.brokenBed || (bite && minute >= cottage?.floorDue);
    const recovery = poorRest ? -0.15 : minute >= cottage?.sweepDue ? -0.21 : -0.24;
    // Cold air sharpens the appetite.
    n.hunger = clamp(n.hunger + hungerPerMinute(bite));
    // Nobody sleeps well in a house without a fire.
    n.fatigue = clamp(n.fatigue + (resting ? recovery * (actor.illness ? 0.7 : 1) : (action.kind === 'work' ? 0.074 : 0.043) * (actor.illness ? 1.5 : 1)));
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
      if (action.job === 'bake' && !action.carrying) {
        const obstacle = stockObstacle(world, jobs.bake);
        if (obstacle) {
          endShiftEarly(actor, state, emit, 'blocked', obstacle);
          inspectOven(actor, place(map, action.target), world, emit, 'checking a blocked baking shift');
          action.remaining = 0;
          continue;
        }
      }
    }
    if (waitTurn(actor, actors, minute)) {
      if (waitedTooLong(actor, minute)) {
        endShiftEarly(actor, state, emit, 'blocked', 'the ' + (action.job === 'bake' ? 'oven' : 'millstones') + ' stayed in use too long');
        action.remaining = 0;
      }
      continue;
    }
    if (action.kind === 'teach') {
      action.remaining = teachMinute(actor, state) ? action.remaining - 1 : 0;
      continue;
    }
    advanceForageShift(actor);
    action.remaining--;
    if (action.kind === 'report') takeFieldNotes(actor, state, emit);
    if (action.remaining > 0) continue;
    if (action.kind === 'civic') {
      enactCivicChoice(actor, state, emit);
    } else if (action.kind === 'review') {
      recordPrivateReview(actor, minute, emit);
    } else if (action.kind === 'conversation') {
      if (lifeVerbs.has(action.verb)) finishLifeConversation(actor, state, emit, missedConversation);
      else finishConversation(actor, state, emit);
    } else if (action.kind === 'inspect') {
      inspectOven(actor, place(map, action.target), world, emit);
    } else if (action.kind === 'work' && action.job === 'build') {
      civic.labour(actor, state, emit);
      noteShift(actor, 'build');
    } else if (action.kind === 'work') {
      finishShift(actor, state, emit, sky);
    } else if (action.kind === 'food' && action.meal === 'draw') {
      const meal = drawAndEat(actor, world);
      if (!meal) {
        memory(actor, minute, actor.name + ' went to draw bread and found the shelves at the storehouse bare.', [actor.id], 'observation', { shortage: 'bread', site: STOREHOUSE });
        actor.lastLowCount = { minute, item: 'bread' };
        continue;
      }
      const relief = relieveHunger(actor, HUNGER.bread);
      emit('meal', actor.name + ' ' + meal + '.', [actor.id], { meal: mealRecord(actor.home, 'bread', relief) }, STOREHOUSE);
    } else if (action.kind === 'food') {
      // A loaf taken at the oven is how a village before the storehouse ate. An activity begun then finishes so.
      const atHome = action.meal === 'larder' || action.meal === 'homePreserved' || action.mealAtHome;
      if (atHome && action.target !== actor.home) continue;
      const item = action.meal === 'larder' ? 'bread' : action.meal === 'homePreserved' ? 'preserved' : action.meal ?? 'bread';
      const larder = world.cottages?.[actor.home];
      let amounts;
      if (atHome && item === 'bread') {
        if (!(larder?.larder >= 1)) continue;
        larder.larder--;
      } else if (atHome) {
        if (spareFood(larder, item, minute) < 1) continue;
        amounts = takeFoodBatches(cottageBatches(larder, item), 1);
      } else {
        if (!(world.supplies[item] >= 1)) continue;
        amounts = takeStock(world, item, 1);
      }
      const relief = relieveHunger(actor, HUNGER[item]);
      const meal = produceFoods[item] ? 'ate ' + produceFoods[item] + (atHome ? ' from the larder at home' : ' at the hall')
        : atHome ? 'ate ' + (item === 'bread' ? 'bread' : 'preserved food') + ' from the larder at home'
        : item === 'bread' ? 'took a loaf from the ' + (action.target === 'oven' ? 'common oven' : 'bakehouse')
          : 'ate ' + (item === 'cooked' ? 'a cooked meal' : 'a preserved portion of fish or meat') + ' at the hall';
      emit('meal', actor.name + ' ' + meal + '.', [actor.id], { meal: mealRecord(actor.home, item, relief, amounts) });
    } else if (action.kind === 'leisure') {
      n.fatigue = clamp(n.fatigue - 7);
      if (action.feast) {
        // Everyone at the feast eats from the common stores while there is bread or salt fish to share.
        const shared = world.supplies.bread > 0 ? 'bread' : world.supplies.preserved > 0 ? 'preserved' : null;
        if (shared) {
          const taken = takeStock(world, shared, 1);
          const relief = relieveHunger(actor, 40);
          emit('meal', actor.name + ' ate ' + (shared === 'bread' ? 'bread' : 'preserved food') + ' at the feast on the green.',
            [actor.id], { meal: mealRecord(actor.home, shared, relief, taken) }, 'green');
        }
        n.loneliness = clamp(n.loneliness - 35);
        memory(actor, minute, actor.name + ' kept ' + action.feast + ' at the feast on the green.', [actor.id], 'social', { importance: 4 });
      }
      if (action.target !== 'green') n.loneliness = clamp(n.loneliness - 8);
    }
  }
  // Conversations need physical proximity. Both parties remember the same encounter.
  for (const actor of actors) {
    if (actor.action.phase !== 'working' || actor.action.kind === 'rest' || minute - actor.lastChat < 135) continue;
    const other = actors.find(b => b !== actor && b.action.phase === 'working' && b.action.kind !== 'rest'
      && minute - b.lastChat >= 135 && distance(actor.position, b.position) <= 3
      && ((actor.action.kind === 'social' && actor.action.friendId === b.id)
        || (actor.action.company && actor.action.target === b.action.target)
        || (actor.needs.loneliness > 46 && b.needs.loneliness > 35)));
    if (!other) continue;
    const ids = [actor.id, other.id];
    const speaker = actor.name + ' and ' + other.name;
    const here = place(map, actor.action.target);
    const where = here ? wherePhrase(here, actors) : 'on the road';
    let text = speaker + ' exchanged news ' + where + '.';
    let bond = 3, type = 'social', raised;
    const details = {};
    const shortage = shortTalk(state);
    if ((raised = civic.discuss(actor, other, state, () => random(world)))) {
      text = raised.text;
      details.concern = raised.key;
      Object.assign(details, raised.details);
      type = 'civic';
    } else if (shortage) {
      text = speaker + ' discussed the dwindling ' + (shortage === 'grain' ? 'food stores' : shortage + ' reserve') + ' ' + where + '.';
      details.shortage = shortage;
    } else if (actor.action.kind === 'work' || other.action.kind === 'work') {
      const worker = actor.action.kind === 'work' ? actor : other;
      const helper = worker === actor ? other : actor;
      if (jobs[worker.action.job] && !['hunt', 'fish'].includes(worker.action.job) && worker.action.remaining > 4) {
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
      warm(a, b.id, bond, minute);
      familiar(a, b.id, minute);
      a.lastChat = minute;
      if (a.id !== raised?.listenerId) memory(a, minute, text, ids, 'social', details);
    }
    emit(type, text, ids, raised?.details);
    maybeCourt(actor, other, state, emit);
  }
  tickChildren(state, sky, emit);
  if (externalActions) {
    // An activity that ended this minute is settled now, so routine carries straight on.
    for (const actor of actors) if (actor.action.remaining <= 0 && actor.action.kind !== 'waiting') atBoundary(actor, state, records, pilot);
  }
  // Goals the record now settles are settled, and anything consequential calls for a review.
  settleGoals(state, emit);
  for (const actor of actors) watchGoals(actor, minute);
  // Each minute's entries are judged as they happen, so the record is the same however the clock is stepped.
  judge(world, events.slice(first));
}

// With externalActions the Decisions API chooses at each real choice and the engine never picks an
// activity itself. records, when given, receives how each activity came about.
export function stepVillage(state, { minutes = 5, externalActions = false, records = null, pilot = standing.PILOT, observe } = {}) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError('minutes must be a nonnegative integer');
  normalize(state);
  const events = [];
  for (let i = 0; i < minutes; i++) {
    stepMinute(state, events, externalActions, records, pilot);
    observe?.(state);
  }
  state.world.mapRevision = state.map.revision;
  return events;
}
