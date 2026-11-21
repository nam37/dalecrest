// All durable state is plain JSON. No wall-clock reads or process-local random state.
export const FOCUSES = ['work', 'social', 'rest', 'food'];
const sites = [
  ['green', 'Village green', 50, 40], ['fields', 'Strip fields', 24, 23],
  ['mill', 'Watermill', 73, 18], ['oven', 'Common oven', 66, 47],
  ['wood', 'Coppice', 14, 52], ['cottages', 'Cottages', 31, 58],
  ['well', 'Village well', 46, 32], ['hall', 'Village hall', 51, 64],
];
export const LOCATIONS = Object.fromEntries(sites.map(([id, name, x, y]) => [id, { id, name, x, y }]));

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
const jobs = {
  harvest: { site: 'fields', label: 'Gathering barley', duration: 80, makes: { grain: 3 }, result: 'brought three measures of barley in from the fields' },
  mill: { site: 'mill', label: 'Grinding barley', duration: 69, takes: { grain: 2 }, makes: { flour: 3 }, result: 'ground two measures of barley into three of flour' },
  bake: { site: 'oven', label: 'Baking bread', duration: 58, takes: { flour: 2, wood: 1 }, makes: { bread: 5 }, result: 'drew five loaves from the common oven' },
  cut: { site: 'wood', label: 'Stacking firewood', duration: 78, makes: { wood: 3 }, result: 'stacked three bundles of dry wood' },
  weave: { site: 'cottages', label: 'Weaving linen', duration: 99, makes: { cloth: 1 }, result: 'finished a length of linen for the village' },
  mend: { site: 'hall', label: 'Mending the hall', duration: 84, makes: { repair: 2 }, result: 'repaired another section of the hall' },
  draw: { site: 'well', label: 'Drawing water', duration: 39, makes: { water: 4 }, result: 'filled four buckets at the well' },
};
const capacity = { grain: 44, flour: 34, bread: 32, wood: 32, cloth: 12, repair: 14, water: 28 };
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
function random(world) {
  world.seed = (Math.imul(world.seed, 1664525) + 1013904223) >>> 0;
  return world.seed / 4294967296;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function memory(actor, minute, text, actorIds, kind, details = {}) {
  actor.memories.push({ minute, text, actorIds, kind, ...details });
  if (actor.memories.length > 18) actor.memories.shift();
}

function inferDesires(actor) {
  const friend = Object.entries(actor.relationships).sort((a, b) => b[1] - a[1])[0]?.[0];
  return [
    { id: 'calling', label: actor.goals[0], focus: 'work', weight: actor.traits.includes('steadfast') ? 9 : 5 },
    { id: 'kinship', label: actor.goals[1], focus: 'social', target: friend, weight: actor.traits.includes('gregarious') ? 12 : 5 },
  ];
}
function desireWeight(actor, focus, target) {
  return clamp(actor.desires.reduce((sum, d) => {
    if (d.focus !== focus || (d.target && d.target !== target) || !Number.isFinite(d.weight)) return sum;
    return sum + d.weight;
  }, 0), -40, 40);
}

export function createVillage() {
  const world = { minute: 420, seed: 62491, supplies: { grain: 12, flour: 7, bread: 12, wood: 11, cloth: 4, repair: 5, water: 12 } };
  const actors = households.map(([id, name, role, home, backstory, traits, goal, trade, friend], i) => ({
    id, name, role, home: 'cottages', workplace: home, backstory, traits, trade,
    goals: [goal, 'Make time for ' + households.find(h => h[0] === friend)[1]],
    needs: { hunger: 28 + i * 3, fatigue: 17 + i, loneliness: 19 + i * 5 },
    relationships: Object.fromEntries(households.filter(h => h[0] !== id).map(h => [h[0], h[0] === friend ? 57 : 18 + ((i + h[1].length) % 17)])),
    memories: [], plan: null, position: { x: LOCATIONS[home].x + i % 2, y: LOCATIONS[home].y },
    action: { kind: 'idle', label: 'Starting the day', reason: 'The morning bell has just rung.', target: home, phase: 'working', remaining: 0 },
    lastChat: -100, lastJob: -400, daysWorked: 0, lastWorkDay: -1,
  }));
  for (const actor of actors) actor.desires = inferDesires(actor);
  return { world, actors, events: [{ type: 'village', minute: world.minute, actorIds: [], text: 'The morning bell rings across Dalecrest.' }] };
}

function available(world, job) {
  return Object.entries(job.takes || {}).every(([k, n]) => world.supplies[k] >= n)
    && Object.entries(job.makes).every(([k, n]) => world.supplies[k] <= capacity[k] - n);
}
function jobOptions(actor, world, allFeasible) {
  // When stores run low, anyone can lend a hand in the fields or coppice.
  const list = [...new Set([actor.trade, 'harvest', 'cut', 'draw'])];
  const options = [];
  for (const key of list) {
    const job = jobs[key];
    if (!available(world, job)) continue;
    const material = Object.keys(job.makes)[0];
    const shortage = 1 - world.supplies[material] / capacity[material];
    if (!allFeasible && key !== actor.trade && shortage < 0.67) continue;
    const pledged = shortage > 0.5 && actor.memories.some(m => m.shortage === material && world.minute - m.minute < 480);
    const score = 22 + 33 * shortage + (actor.trade === key ? 13 : 0) + (pledged ? 12 : 0);
    options.push({ key, score });
  }
  return options.sort((a, b) => b.score - a.score);
}
function choose(actor, actors, world, menu) {
  const choices = [];
  const dayTime = world.minute % 1440;
  const night = dayTime >= 1260 || dayTime < 340;
  const { hunger, fatigue, loneliness } = actor.needs;
  if (!menu && actor.plan && (!FOCUSES.includes(actor.plan.focus) || !Number.isFinite(actor.plan.until) || actor.plan.until <= world.minute)) actor.plan = null;
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
  const jobsHere = jobOptions(actor, world, Boolean(menu));
  for (const job of (menu ? jobsHere : jobsHere.slice(0, 1))) {
    const spec = jobs[job.key];
    const duty = actor.traits.includes('steadfast') ? 5 : 0;
    const material = Object.keys(spec.makes)[0];
    const reason = 'The village has ' + world.supplies[material] + ' of ' + capacity[material] + ' units of ' + material + ' in reserve.';
    offer('work', spec.label, spec.site, spec.duration, job.score + duty - (night ? 48 : 0) - Math.max(0, fatigue - 65), reason, { job: job.key });
  }
  if (world.supplies.bread > 0) offer('food', 'Taking a loaf at the oven', 'oven', 17, hunger * 1.35 - 16, 'There is bread at the oven and my hunger is ' + Math.round(hunger) + ' out of 100.');
  offer('rest', night ? 'Sleeping at home' : 'Resting at home', actor.home, night ? 105 : 54, fatigue + (night ? 48 : -9), night ? 'It is time to sleep and recover for tomorrow.' : 'My fatigue has reached ' + Math.round(fatigue) + ' out of 100.');
  // Seek a friend with a reachable destination. Recent pleasant meetings favor a return visit.
  let friend, best = -Infinity;
  for (const other of actors) {
    if (other === actor || other.action.kind === 'rest') continue;
    const site = LOCATIONS[other.action.target];
    if (!site || (menu && other.action.kind === 'waiting')) continue;
    if (menu) {
      offer('social', 'Visiting ' + other.name, other.action.target, 28, 0, '', { friendId: other.id });
      continue;
    }
    const recent = actor.memories.slice(-5).some(m => m.kind === 'social' && m.actorIds.includes(other.id));
    const appeal = (actor.relationships[other.id] || 0) * 0.35 + desireWeight(actor, 'social', other.id) + (recent ? 6 : 0) - distance(actor.position, site) * 0.17 + random(world) * 16;
    if (appeal > best) { best = appeal; friend = other; }
  }
  if (friend) offer('social', 'Visiting ' + friend.name.split(' ')[0], friend.action.target, 28, loneliness + (actor.traits.includes('gregarious') ? 13 : 0) - (night ? 28 : 0), 'I could use some company and know where to find ' + friend.name + '.', { friendId: friend.id });
  offer('leisure', 'Walking on the green', 'green', 44, 30 + (actor.traits.includes('restless') ? 6 : 0) - (night ? 17 : 0), 'A walk on the green will ease my fatigue.');
  if (menu) return;
  choices.sort((a, b) => b.score - a.score);
  const { score, ...chosen } = choices[0];
  chosen.phase = 'travelling';
  actor.action = chosen;
}

export function availableActions(actor, state) {
  const menu = new Map();
  choose(actor, state.actors, state.world, menu);
  return menu;
}

function waitForDecision(actor, minute) {
  if (actor.action.kind === 'waiting') return;
  const { kind, label, target } = actor.action;
  actor.action = { kind: 'waiting', phase: 'waiting', label: 'Choosing the next activity', target, remaining: 0,
    since: minute, previous: { kind, label, target }, reason: 'Waiting for a decision from gpt-6-luna.' };
  actor.plan = null;
}

function stepMinute(world, actors, events, externalActions) {
  const minute = ++world.minute;
  const emit = (type, text, actorIds = []) => events.push({ type, minute, text, actorIds });
  if (minute % 1440 === 360) {
    for (const [key, used] of Object.entries({ cloth: 1, repair: 2, water: actors.length })) world.supplies[key] = Math.max(0, world.supplies[key] - used);
    emit('village', 'Dawn breaks. The households collect water and take what they need from the village stores.');
  }
  for (const actor of actors) {
    const n = actor.needs;
    const action = actor.action;
    const resting = action.kind === 'rest' && action.phase === 'working';
    n.hunger = clamp(n.hunger + 0.042);
    n.fatigue = clamp(n.fatigue + (resting ? -0.24 : action.kind === 'work' ? 0.074 : 0.043));
    n.loneliness = clamp(n.loneliness + (resting ? 0.006 : 0.043));
    if (action.remaining <= 0) {
      if (externalActions) waitForDecision(actor, minute);
      else choose(actor, actors, world);
      continue;
    }
    if (action.phase === 'travelling') {
      const site = LOCATIONS[action.target];
      const d = distance(actor.position, site);
      const stride = actor.traits.includes('restless') ? 2.65 : 2.15;
      if (d > stride) {
        actor.position.x += stride * (site.x - actor.position.x) / d;
        actor.position.y += stride * (site.y - actor.position.y) / d;
        continue;
      }
      actor.position = { x: site.x, y: site.y };
      action.phase = 'working';
    }
    if (--action.remaining > 0) continue;
    if (action.kind === 'work') {
      const job = jobs[action.job];
      if (available(world, job)) {
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
      emit('meal', actor.name + ' took a loaf from the common oven.', [actor.id]);
    } else if (action.kind === 'leisure') {
      n.fatigue = clamp(n.fatigue - 7);
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
    const place = LOCATIONS[actor.action.target].name.toLowerCase();
    let text = speaker + ' exchanged news at the ' + place + '.';
    let bond = 3;
    const details = {};
    const shortage = Object.keys(capacity).find(k => world.supplies[k] < capacity[k] / 4);
    if (actor.action.target === 'oven' && world.supplies.bread > 0 && Math.max(actor.needs.hunger, other.needs.hunger) > 40) {
      world.supplies.bread--;
      for (const a of [actor, other]) {
        a.needs.hunger = clamp(a.needs.hunger - 26.5);
        if (a.action.kind === 'food' && a.needs.hunger < 35) a.action.remaining = 0;
      }
      text = speaker + ' divided a warm loaf between them at the oven.';
      bond = 5;
    } else if (shortage) {
      text = speaker + ' discussed the dwindling ' + shortage + ' reserve at the ' + place + '.';
      details.shortage = shortage;
    } else if (actor.action.kind === 'work' || other.action.kind === 'work') {
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
    emit('social', text, ids);
  }
  if (externalActions) {
    for (const actor of actors) if (actor.action.remaining <= 0) waitForDecision(actor, minute);
  }
}

export function stepVillage({ world, actors }, { minutes = 5, externalActions = false } = {}) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError('minutes must be a nonnegative integer');
  for (const actor of actors) {
    if (!Array.isArray(actor.desires)) actor.desires = inferDesires(actor);
    if (!actor.action.reason) actor.action.reason = 'Continuing an activity chosen earlier in the day.';
  }
  const events = [];
  for (let i = 0; i < minutes; i++) stepMinute(world, actors, events, externalActions);
  return events;
}
