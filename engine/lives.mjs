// Lives. Residents have an age. Hunger, cold or overwork that goes on for days makes them ill, and
// they mend when they are fed, warm and rested. Two residents who grow close begin walking out
// together, and either may ask the other to marry: the asking and the answer are their own choices.
// A married couple keep one house, and children are born into it. A resident who is ill too long, or
// cannot be fed or housed, leaves Dalecrest. A village that allows it (world.mortal) also knows death,
// by a long illness or by old age. The live village does not, by its founders' decision.
import { dateOf, formatDate } from './calendar.mjs';
import { place } from './roads.mjs';
import { remember } from './memory.mjs';
import { warm, warmthOf, trustOf } from './bonds.mjs';
import { canContact } from './exchanges.mjs';
import { vacantCottages, waitingLodgers } from './households.mjs';
import { eatsFromLarder } from './storehouse.mjs';
import { cottageBatches, larderFoods, produceFoods, takeFoodBatches } from './fresh-food.mjs';
import { CHILD_NEED, HUNGER, HUNGRY_AT_DAWN, mealRecord } from './nutrition.mjs';

const DAY = 1440;
export const YEAR = 365.25 * DAY;
export const ADULT = 16, COMES_OF_AGE = 14;
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

// The founders' ages on the day Dalecrest was founded.
const FOUNDERS = { agnes: ['f', 34], hugh: ['m', 41], mabel: ['f', 29], oswin: ['m', 52], edith: ['f', 38], thomas: ['m', 27], alice: ['f', 31], robin: ['m', 24] };
// Given names in use in the parish and on the roads, by whether a child given one is a son or a daughter.
export const NAMES = {
  f: ['Joan', 'Cecily', 'Maud', 'Isolde', 'Margery', 'Emma', 'Beatrix', 'Avice', 'Sybil', 'Elena', 'Idonea', 'Juliana', 'Felice', 'Rohese', 'Amice', 'Agnes', 'Mabel', 'Edith', 'Alice', 'Alys', 'Matilda', 'Christiana'],
  m: ['Wat', 'Piers', 'Giles', 'Simon', 'Ralph', 'Adam', 'Walter', 'Hob', 'Roger', 'Gilbert', 'Martin', 'Stephen', 'Nicholas', 'Hamo', 'Bartholomew', 'Hugh', 'Oswin', 'Thomas', 'Robin', 'John', 'William', 'Henry'],
};
export const sexOfName = first => NAMES.f.includes(first) ? 'f' : NAMES.m.includes(first) ? 'm' : null;
const TOWNS = ['Ashby', 'Thornwick', 'Marlow Cross', 'Harrowdene', 'Wenlock', 'Stowe Ferry', 'Pendle', 'Coldharbour', 'Elmstead', 'Barrowby'];

const hashed = s => { let h = 0; for (const c of s) h = Math.imul(31, h) + c.charCodeAt(0) >>> 0; return h; };
export const ageOf = (actor, minute) => Math.floor((minute - actor.born) / YEAR);
const first = a => a.name.split(' ')[0];

// Gives a resident from before lives an age and a sex. Safe to repeat.
export function normalizeLife(actor, minute) {
  const known = FOUNDERS[actor.id];
  actor.sex ??= known?.[0] ?? sexOfName(first(actor)) ?? (hashed(actor.id) % 2 ? 'f' : 'm');
  if (actor.born == null) {
    const age = known?.[1] ?? 18 + hashed(actor.id + 'age') % 26;
    // Somewhere in the year before they turned that age.
    actor.born = (known ? 0 : actor.arrived ?? minute) - age * YEAR - (hashed(actor.id + 'day') % 360) * DAY;
  }
}

// ------------------------------------------------------------------- illness, leaving and death

const CAUSES = { hungry: 'a fever brought on by hunger', cold: 'a chill on the chest', worn: 'exhaustion', age: 'an ague of old age' };

// A resident too ill to work. The menu offers them rest, food and company, and nothing else.
export const tooIll = actor => actor.illness?.severity >= 2;

function dawnHealth(actor, state, emit, rand) {
  const { world } = state, minute = world.minute, n = actor.needs, age = ageOf(actor, minute);
  const h = actor.hardship ??= { hungry: 0, cold: 0, worn: 0 };
  h.hungry = n.hunger >= HUNGRY_AT_DAWN ? h.hungry + 1 : 0;
  h.cold = n.cold >= 70 ? h.cold + 1 : 0;
  h.worn = n.fatigue >= 92 ? h.worn + 1 : 0;
  if (!actor.illness) {
    const worst = Object.entries(h).sort((a, b) => b[1] - a[1])[0];
    const risk = (worst[1] >= 2 ? 0.2 * (worst[1] - 1) : 0) + (age >= 60 ? (age - 59) * 0.0015 : 0);
    if (risk > 0 && rand() < risk) {
      const cause = worst[1] >= 2 ? worst[0] : 'age';
      actor.illness = { since: minute, cause, severity: 1, worst: 1 };
      const text = actor.name + ' has fallen ill with ' + CAUSES[cause] + '.';
      remember(actor, minute, text, [actor.id], 'life');
      emit('life', text, [actor.id], { life: 'ill', cause });
    }
    return;
  }
  const ill = actor.illness, mending = n.hunger < 60 && n.cold < 40 && n.fatigue < 75;
  if (mending && rand() < 0.4) ill.severity--;
  else if (!mending && rand() < 0.3) ill.severity = Math.min(3, ill.severity + 1);
  ill.worst = Math.max(ill.worst, ill.severity);
  ill.gravely = ill.severity === 3 ? (ill.gravely || 0) + 1 : 0;
  if (ill.severity <= 0) {
    delete actor.illness;
    const text = actor.name + ' is well again after ' + Math.round((minute - ill.since) / DAY) + ' days of ' + CAUSES[ill.cause] + '.';
    remember(actor, minute, text, [actor.id], 'life', { importance: 6 });
    emit('life', text, [actor.id], { life: 'recovered' });
    return;
  }
  const days = (minute - ill.since) / DAY;
  if (ill.gravely >= 3 || days >= 16) {
    if (world.mortal && rand() < 0.35) return removeResident(state, actor, 'died', emit, 'of ' + CAUSES[ill.cause]);
    if (!world.mortal || days >= 20) return removeResident(state, actor, 'nursed', emit, rand);
  }
}

// A resident who cannot be fed or housed for long goes elsewhere.
function dawnStaying(actor, state, emit, rand) {
  const { world, map } = state, minute = world.minute;
  if (actor.hardship?.hungry >= 5 && !actor.illness) return removeResident(state, actor, 'hungry', emit, rand);
  const lodging = place(map, actor.home)?.kind !== 'cottage';
  const waited = minute - (actor.arrived ?? 0);
  const underway = world.projects?.some(p => p.for === actor.id) || world.proposals?.some(p => p.key === 'cottage:' + actor.id && p.supporters.length >= 2);
  if (lodging && !actor.spouse && waited > 60 * DAY && !underway && rand() < 0.04) return removeResident(state, actor, 'unhoused', emit, rand);
  if (world.mortal && ageOf(actor, minute) >= 60) {
    const over = ageOf(actor, minute) - 59;
    if (rand() < over * over / (365 * 220)) return removeResident(state, actor, 'died', emit, 'of old age');
  }
}

// Takes a resident out of the village, by death or by leaving, and settles what they leave behind.
export function removeResident(state, actor, how, emit, why) {
  const { world, actors, map } = state, minute = world.minute;
  const town = typeof why === 'function' ? TOWNS[Math.floor(why() * TOWNS.length)] : null;
  const age = ageOf(actor, minute);
  const text = how === 'died' ? actor.name + ' died ' + why + ', at the age of ' + age + '.'
    : how === 'nursed' ? actor.name + ' has left Dalecrest, too ill to stay, to be nursed by kin in ' + town + '.'
    : how === 'hungry' ? actor.name + ' has left Dalecrest to look for bread in ' + town + '.'
    : how === 'unhoused' ? actor.name + ' has given up waiting for a cottage and left Dalecrest for ' + town + '.'
    : actor.name + ' has left Dalecrest.';
  const spouse = actors.find(a => a.id === actor.spouse);
  const cottage = world.cottages?.[actor.home];
  // Children go with a parent who leaves, unless the other parent stays.
  const leavingChildren = !spouse && cottage?.children?.length && actors.filter(a => a.home === actor.home && a !== actor).length === 0;
  const children = leavingChildren ? cottage.children.splice(0) : [];
  actors.splice(actors.indexOf(actor), 1);
  for (const other of actors) {
    const close = warmthOf(other, actor.id);
    if (other === spouse || close >= 40) {
      remember(other, minute, text, [actor.id, other.id], 'life', { importance: other === spouse ? 10 : 7 });
      if (how === 'died') other.needs.loneliness = clamp(other.needs.loneliness + (other === spouse ? 35 : 12));
    }
    if (other.courting?.with === actor.id) delete other.courting;
    if (other.proposal?.from === actor.id) delete other.proposal;
  }
  if (spouse) {
    delete spouse.spouse;
    delete spouse.spouseName;
    delete spouse.expecting;
  }
  // Open requests with them come to nothing.
  for (const [id, r] of Object.entries(world.helpRequests || {})) {
    if (r.askerId !== actor.id && r.helperId !== actor.id) continue;
    r.status = 'released';
    for (const other of actors) if (other.helpBook?.[id]) other.helpBook[id].status = 'released';
    delete world.helpRequests[id];
  }
  if (world.barleyStrip?.keeper === actor.id) world.barleyStrip.keeper = spouse?.id ?? null;
  for (const p of world.projects || []) if (p.for === actor.id) delete p.for;
  world.proposals = (world.proposals || []).filter(p => p.key !== 'cottage:' + actor.id);
  world.weddings = (world.weddings || []).filter(w => w.a !== actor.id && w.b !== actor.id);
  world.departed ??= [];
  world.departed.push({ id: actor.id, name: actor.name, arrived: actor.arrived ?? 0, role: actor.role, home: actor.home,
    how, minute, age, ...(children.length && { children: children.map(c => c.name) }) });
  emit('life', text + (children.length ? ' ' + (children.length === 1 ? children[0].name + ' went too.' : children.map(c => c.name).join(' and ') + ' went too.') : ''),
    [actor.id], { life: how === 'died' ? 'died' : 'left', how }, actor.home);
  return true;
}

// ------------------------------------------------------------------- courtship and marriage

const eligible = (a, minute) => !a.spouse && ageOf(a, minute) >= ADULT && !a.illness;

// Two residents who meet often and think well of each other begin walking out together.
export function maybeCourt(a, b, state, emit) {
  const minute = state.world.minute;
  if (a.courting || b.courting || !eligible(a, minute) || !eligible(b, minute)) return;
  if (Math.abs(ageOf(a, minute) - ageOf(b, minute)) > 15) return;
  if (Math.min(warmthOf(a, b.id), warmthOf(b, a.id)) < 82 || Math.min(trustOf(a, b.id), trustOf(b, a.id)) < 45) return;
  // Fondness is not the same as a spark. Only some close pairs ever have one, fixed for the pair.
  const pair = [a.id, b.id].sort().join('+');
  if (hashed(pair) % 100 >= 30) return;
  for (const [x, y] of [[a, b], [b, a]]) x.courting = { with: y.id, name: y.name, since: minute };
  const text = a.name + ' and ' + b.name + ' have begun walking out together.';
  for (const x of [a, b]) remember(x, minute, text, [a.id, b.id], 'life', { importance: 8 });
  emit('life', text, [a.id, b.id], { life: 'courting' });
}

// What courtship offers on a resident's menu: asking, and answering.
export function lifeChoices(actor, { actors, world }, add) {
  const minute = world.minute, near = other => Math.hypot(actor.position.x - other.position.x, actor.position.y - other.position.y) <= 3;
  const c = actor.courting;
  if (c && !actor.proposal && minute - c.since >= 30 * DAY && !(world.weddings || []).some(w => w.a === actor.id || w.b === actor.id)) {
    const other = actors.find(a => a.id === c.with);
    if (other && canContact(actor, other, minute) && other.proposal?.from !== actor.id) {
      add(['propose', other.id, other.action.target].join(':'), { kind: 'conversation', verb: 'propose', label: 'Ask ' + other.name + ' to marry me',
        target: other.action.target, friendId: other.id, onSpot: near(other), remaining: 3 }, 30 + warmthOf(actor, other.id) * 0.5);
    }
  }
  const asked = actor.proposal;
  if (asked) {
    const other = actors.find(a => a.id === asked.from);
    if (other && canContact(actor, other, minute)) {
      add(['wed', other.id, other.action.target].join(':'), { kind: 'conversation', verb: 'wed', label: 'Tell ' + other.name + ' I will marry them',
        target: other.action.target, friendId: other.id, onSpot: near(other), remaining: 3 }, 50 + warmthOf(actor, other.id) * 0.4);
      add(['refuse', other.id, other.action.target].join(':'), { kind: 'conversation', verb: 'refuse', label: 'Tell ' + other.name + ' I will not marry them',
        target: other.action.target, friendId: other.id, onSpot: near(other), remaining: 3 }, 25 + (100 - warmthOf(actor, other.id)) * 0.3);
    }
  }
}

export const lifeVerbs = new Set(['propose', 'wed', 'refuse']);

// The next Sunday at least two days off, at eleven in the morning.
function weddingDay(minute) {
  let day = Math.floor(minute / DAY) + 2;
  while (dateOf(day * DAY).weekday !== 'Sunday') day++;
  return day * DAY + 660;
}

export function finishLifeConversation(actor, state, emit, missed) {
  const { world, actors } = state, minute = world.minute, { verb, friendId } = actor.action;
  const other = actors.find(a => a.id === friendId);
  const near = other && Math.hypot(actor.position.x - other.position.x, actor.position.y - other.position.y) <= 3;
  if (!near || other.action.kind === 'rest' || other.action.kind === 'arrive') return missed(actor, minute, emit, 'they did not meet');
  const ids = [actor.id, other.id];
  let text;
  if (verb === 'propose') {
    if (actor.courting?.with !== other.id) return missed(actor, minute, emit, 'they were no longer walking out together');
    if ((world.weddings || []).some(w => [w.a, w.b].includes(actor.id))) return missed(actor, minute, emit, 'a wedding was already set');
    if (actor.proposal?.from !== other.id) {
      other.proposal = { from: actor.id, name: actor.name, since: minute };
      text = actor.name + ' asked ' + other.name + ' to marry them.';
    }
  }
  // Asking someone who has already asked you is an answer.
  if (verb !== 'propose' || !text) {
    if (actor.proposal?.from !== other.id) return missed(actor, minute, emit, 'there was no question to answer');
    delete actor.proposal;
    if (verb === 'wed' || verb === 'propose') {
      const at = weddingDay(minute);
      world.weddings ??= [];
      world.weddings.push({ a: other.id, b: actor.id, at });
      text = actor.name + ' agreed to marry ' + other.name + '. They will be married on the green on ' + formatDate(at, 'long').replace(/ \d{4}$/, '') + '.';
      for (const x of [actor, other]) warm(x, x === actor ? other.id : actor.id, 4, minute, text);
    } else {
      for (const x of [actor, other]) delete x.courting;
      text = actor.name + ' told ' + other.name + ' they would not marry them.';
      warm(other, actor.id, -8, minute, text);
    }
  }
  for (const x of [actor, other]) {
    remember(x, minute, text, ids, 'life', { importance: 9 });
    x.lastChat = minute;
  }
  emit('life', text, ids, { life: verb, verb, traceId: actor.action.basis?.trace ?? null });
}

// Weddings are kept each minute. A wedding needs both of them, and well enough to stand on the green.
export function tickLives(state, emit) {
  const { world, actors, map } = state, minute = world.minute;
  for (const w of [...(world.weddings || [])]) {
    if (w.at !== minute) continue;
    world.weddings = world.weddings.filter(x => x !== w);
    const a = actors.find(x => x.id === w.a), b = actors.find(x => x.id === w.b);
    if (!a || !b || a.spouse || b.spouse) continue;
    if (a.illness?.severity >= 3 || b.illness?.severity >= 3) {
      w.at = weddingDay(minute);
      world.weddings.push(w);
      emit('life', 'The wedding of ' + a.name + ' and ' + b.name + ' was put off, for illness.', [a.id, b.id], { life: 'postponed' }, 'green');
      continue;
    }
    for (const [x, y] of [[a, b], [b, a]]) {
      x.spouse = y.id;
      x.spouseName = y.name;
      delete x.courting;
    }
    const moved = shareHouse(state, a, b);
    const text = a.name + ' and ' + b.name + ' were married on the green, with the village looking on.' + (moved ? ' ' + moved : '');
    for (const x of actors) {
      const guest = x.action.target === 'green' && x.action.phase === 'working';
      if (x === a || x === b || guest || warmthOf(x, a.id) >= 45 || warmthOf(x, b.id) >= 45) {
        remember(x, minute, text, [a.id, b.id, x.id], 'life', { importance: x === a || x === b ? 10 : 6 });
        if (x !== a && x !== b) x.needs.loneliness = clamp(x.needs.loneliness - 15);
      }
    }
    emit('life', text, [a.id, b.id], { life: 'married' }, 'green');
  }
}

// A married couple keep one house: the one with children in it, or else whichever is a cottage.
function shareHouse({ world, map, actors }, a, b) {
  const cottage = x => place(map, x.home)?.kind === 'cottage';
  const kids = x => world.cottages?.[x.home]?.children?.length || 0;
  if (a.home === b.home) return '';
  let keep = a, mover = b;
  if (!cottage(a) || (cottage(b) && kids(b) > kids(a))) [keep, mover] = [b, a];
  if (!cottage(keep)) return '';
  const leaving = mover.home, lived = cottage(mover);
  const theirs = world.cottages?.[leaving];
  if (theirs) {
    const home = world.cottages[keep.home];
    home.children = [...(home.children || []), ...(theirs.children || [])];
    home.woodpile = (home.woodpile || 0) + (theirs.woodpile || 0);
    home.larder = Math.min(8, (home.larder || 0) + (theirs.larder || 0));
    if (theirs.preservedFood?.length) {
      home.preservedFood = [...(home.preservedFood || []), ...theirs.preservedFood];
      delete theirs.preservedFood;
    }
    for (const [item, batches] of Object.entries(theirs.produce || {})) {
      cottageBatches(home, item, true).push(...batches);
    }
    delete theirs.produce;
    theirs.children = [];
    theirs.woodpile = 0;
    theirs.larder = 0;
  }
  if (mover.workplace === mover.home) mover.workplace = keep.home;
  mover.home = keep.home;
  return first(mover) + ' has moved ' + (lived ? 'out of their own cottage ' : 'from the hall ') + 'to live with ' + first(keep) + '.';
}

// ------------------------------------------------------------------- children

export function childName(state, cottage, sex, rand) {
  const siblings = new Set(cottage.children?.map(c => c.name));
  const adults = new Set(state.actors.map(first));
  const pool = NAMES[sex].filter(name => !siblings.has(name));
  const free = pool.filter(name => !adults.has(name));
  const names = free.length ? free : pool;
  return names[Math.floor(rand() * names.length)];
}

function dawnFamily(state, emit, rand, comeOfAge) {
  const { world, actors } = state, minute = world.minute;
  for (const mother of actors) {
    const father = actors.find(a => a.id === mother.spouse);
    if (!father || mother.sex !== 'f' || father.sex !== 'm') continue;
    const cottage = world.cottages?.[mother.home];
    if (!cottage) continue;
    if (mother.expecting && minute >= mother.expecting.due) {
      delete mother.expecting;
      const sex = rand() < 0.5 ? 'f' : 'm', name = childName(state, cottage, sex, rand);
      cottage.children = [...(cottage.children || []), { name, sex, born: minute, parents: [mother.id, father.id] }];
      const text = mother.name + ' and ' + father.name + ' have a ' + (sex === 'f' ? 'daughter' : 'son') + ', ' + name + '.';
      for (const x of [mother, father]) remember(x, minute, text, [mother.id, father.id], 'life', { importance: 10 });
      emit('life', text, [mother.id, father.id], { life: 'born', child: name }, mother.home);
      continue;
    }
    const age = ageOf(mother, minute), youngest = Math.max(-Infinity, ...(cottage.children || []).map(c => c.born));
    if (mother.expecting || age < 18 || age > 42 || (cottage.children?.length || 0) >= 6 || minute - youngest < 1.2 * YEAR) continue;
    if (rand() < 1 / 200) {
      mother.expecting = { since: minute, due: minute + 270 * DAY };
      const text = mother.name + ' is expecting a child, due about ' + formatDate(mother.expecting.due, 'day') + '.';
      for (const x of [mother, father]) remember(x, minute, text, [mother.id, father.id], 'life', { importance: 9 });
      emit('life', text, [mother.id, father.id], { life: 'expecting' });
    }
  }
  let missedBreakfasts = 0;
  // A child's breakfast comes from their own larder. Give credit to children who ate even when it ran out.
  for (const [home, cottage] of Object.entries(world.cottages || {})) {
    const eating = (cottage.children || []).filter(c => eatsFromLarder(c, minute));
    if (!eating.length) continue;
    let missed = 0;
    for (const child of eating) {
      let food, amounts;
      const fresh = larderFoods.find(item => item !== 'preserved' && cottageBatches(cottage, item)?.length);
      if (fresh) {
        amounts = takeFoodBatches(cottageBatches(cottage, fresh), 1);
        food = fresh;
      } else if (cottage.larder >= 1) {
        cottage.larder--;
        food = 'bread';
      } else if (cottage.preservedFood?.length) {
        amounts = takeFoodBatches(cottage.preservedFood, 1);
        food = 'preserved';
      } else {
        missed++;
        continue;
      }
      const name = [child.name, child.surname].filter(Boolean).join(' ');
      const meal = produceFoods[food] ?? (food === 'bread' ? 'bread' : 'preserved food');
      emit('meal', name + ' ate ' + meal + ' for breakfast at home.',
        child.id ? [child.id] : [], { meal: mealRecord(home, food, Math.min(CHILD_NEED, HUNGER[food]), amounts, name) }, home);
    }
    if (!missed) { cottage.hungry = 0; continue; }
    missedBreakfasts += missed;
    const parents = actors.filter(a => a.home === home);
    cottage.hungry = (cottage.hungry || 0) + 1;
    const without = missed === eating.length && missed > 1 ? 'the children missed breakfast' : missed === 1 ? 'one child missed breakfast' : missed + ' children missed breakfast';
    const text = 'The larder ran out at ' + (parents.length ? parents.map(first).join(' and ') + '’s' : 'the') + ' cottage, and ' + without + ' this morning.';
    for (const p of parents) remember(p, minute, text, parents.map(a => a.id), 'observation', { shortage: 'larder', importance: 8 });
    emit('village', text, parents.map(a => a.id), { hungry: missed }, home);
  }
  // A child of fourteen takes their place among the residents.
  for (const [home, cottage] of Object.entries(world.cottages || {})) {
    for (const child of [...(cottage.children || [])]) {
      if (minute - child.born < COMES_OF_AGE * YEAR) continue;
      cottage.children = cottage.children.filter(c => c !== child);
      comeOfAge(child, home);
    }
  }
  return missedBreakfasts;
}

// Lodgers move into a finished cottage that stands empty, whoever's turn it is by longest waiting.
function dawnHouses(state, emit) {
  const { world, map } = state;
  const lodgers = waitingLodgers(state).filter(a => a.action.kind !== 'arrive')
    .sort((a, b) => (a.arrived ?? 0) - (b.arrived ?? 0));
  for (const site of vacantCottages(state)) {
    const lodger = lodgers.shift();
    if (!lodger) break;
    lodger.home = site.id;
    if (lodger.workplace === 'hall' && lodger.trade === 'weave') lodger.workplace = site.id;
    world.cottages ??= {};
    const c = world.cottages[site.id] ??= {};
    c.brokenBed ??= false;
    world.proposals = (world.proposals || []).filter(p => p.key !== 'cottage:' + lodger.id);
    const road = map.roads[site.road]?.name;
    const text = lodger.name + ' has moved from the hall into the empty cottage' + (road ? ' on ' + road : '') + '.';
    remember(lodger, world.minute, text, [lodger.id], 'life', { importance: 8 });
    emit('life', text, [lodger.id], { life: 'moved' }, site.id);
  }
}

// Called at dawn, after the stores are reckoned. comeOfAge(child, home) adds a grown child as a resident.
export function dawnLives(state, emit, rand, comeOfAge) {
  for (const actor of [...state.actors]) {
    if (!state.actors.includes(actor)) continue;
    if (dawnHealth(actor, state, emit, rand)) continue;
    if (state.actors.includes(actor)) dawnStaying(actor, state, emit, rand);
  }
  const missedBreakfasts = dawnFamily(state, emit, rand, comeOfAge);
  dawnHouses(state, emit);
  return missedBreakfasts;
}

// What a resident's own life looks like to them, for the action model.
export function lifeContext(actor, minute) {
  const life = { age: ageOf(actor, minute) };
  if (actor.spouse) life.married = actor.spouseName;
  if (actor.courting) life.walkingOutWith = actor.courting.name;
  if (actor.proposal) life.askedToMarryBy = actor.proposal.name;
  if (actor.expecting) life.expectingAChild = 'due ' + formatDate(actor.expecting.due, 'day');
  if (actor.illness) life.ill = CAUSES[actor.illness.cause] + (tooIll(actor) ? ', too ill to work' : ', mildly');
  return { life };
}
