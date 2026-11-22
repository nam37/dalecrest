// Goals. A resident's goals persist across activities and nights, and change for reasons. Each goal is
// one of two kinds. A goal with a condition is one the engine can settle from the record: a store level
// by a time, a promise kept, a place reached, a number of shifts done. The engine marks it met, missed or
// overtaken and records what settled it. A goal on evidence ("Earn Edith's trust") has no condition. The
// engine never declares it achieved. It keeps the evidence that bears on it, and the general-purpose
// model, in a goal review, keeps, revises or retires it citing that evidence.
//
// actor.goalBook holds the goals in force, each a version with an id. A revised goal keeps its id and
// takes the next version, and the old version moves to actor.goalHistory. actor.goals stays a plain
// list of the goals' words, the calling first, for everything that read it before.
import { remember, memoryKey } from './memory.mjs';
import { evidenceAbout } from './bonds.mjs';
import { villageTime } from './exchanges.mjs';

const DAY = 1440;
export const MAX_GOALS = 4;
export const STORE_ITEMS = ['grain', 'flour', 'bread', 'wood', 'water', 'cloth', 'preserved'];
export const GOAL_JOBS = ['harvest', 'mill', 'bake', 'cut', 'weave', 'mend', 'draw', 'build', 'fish', 'hunt', 'fetchWood', 'fetchBread'];
const FOCI = ['work', 'social', 'rest', 'food'];
// A review is due when the resident has gone this long without one.
export const REVIEW_EVERY = 3 * DAY;

export const goalKey = (actor, g) => actor.id + ':' + g.id + ':' + g.version;
export const activeGoals = actor => (actor.goalBook || []).filter(g => g.status === 'active');

// Gives a resident from before goal books their founding goals as goals on evidence. Safe to repeat.
export function normalizeGoals(actor, minute) {
  if (actor.goalBook) return;
  const kinship = actor.desires?.find(d => d.id === 'kinship')?.target;
  actor.goalSeq = 0;
  actor.goalBook = (actor.goals || []).map((text, i) => ({
    id: 'g' + ++actor.goalSeq, version: 1, kind: 'evidence', text, focus: i === 0 ? 'work' : 'social',
    ...(i === 1 && kinship && { about: kinship }), status: 'active', since: minute, source: 'founding', basis: [], stored: false,
  }));
  actor.goalHistory = [];
  actor.lastReview ??= minute;
}

// actor.goals and actor.desires follow the goals in force.
export function syncGoals(actor) {
  const active = activeGoals(actor);
  actor.goals = active.map(g => g.text);
  const steady = actor.traits.includes('steadfast'), warm = actor.traits.includes('gregarious');
  actor.desires = active.map((g, i) => ({
    id: g.source === 'founding' ? (g.focus === 'work' ? 'calling' : 'kinship') : g.id, label: g.text, focus: g.focus,
    ...(g.about && { target: g.about }),
    weight: g.kind === 'condition' ? 10 : g.focus === 'work' ? (steady ? 9 : 5) : g.focus === 'social' ? (warm ? 12 : 5) : 5,
  }));
}

// ------------------------------------------------------------------- conditions

// Checks a condition the review proposed. Returns the condition as the engine will keep it, or a reason it cannot.
export function checkCondition(c, actor, state) {
  const { world, map } = state, minute = world.minute;
  const hours = Number.isInteger(c.withinHours) ? c.withinHours : NaN;
  if (c.type !== 'commitment' && !(hours >= 1 && hours <= 96)) return 'withinHours must be a whole number from 1 to 96';
  const by = minute + hours * 60;
  if (c.type === 'store') {
    if (!STORE_ITEMS.includes(c.item)) return 'unknown store ' + c.item;
    if (!(Number.isInteger(c.atLeast) && c.atLeast >= 1 && c.atLeast <= (world.capacity[c.item] ?? 0))) return 'atLeast must fit the store';
    return { type: 'store', item: c.item, atLeast: c.atLeast, by };
  }
  if (c.type === 'reach') {
    if (!map.places.some(p => p.id === c.place && p.stage === 2)) return 'unknown place ' + c.place;
    return { type: 'reach', place: c.place, by };
  }
  if (c.type === 'work') {
    if (!GOAL_JOBS.includes(c.job)) return 'unknown work ' + c.job;
    if (!(Number.isInteger(c.count) && c.count >= 1 && c.count <= 10)) return 'count must be from 1 to 10';
    return { type: 'work', job: c.job, count: c.count, done: 0, by };
  }
  if (c.type === 'commitment') {
    const r = actor.helpBook?.[c.requestId];
    if (!r || !['asked', 'accepted'].includes(r.status)) return 'no open request ' + c.requestId;
    return { type: 'commitment', requestId: c.requestId, by: r.due };
  }
  return 'unknown condition ' + c.type;
}

// Words for a condition, for the resident's request and the page.
export function conditionWords(c, names = {}) {
  if (!c) return null;
  const by = ' by ' + villageTime(c.by);
  if (c.type === 'store') return 'The ' + c.item + ' store holds at least ' + c.atLeast + by;
  if (c.type === 'reach') return 'Be at ' + (names[c.place]?.name || c.place) + by;
  if (c.type === 'work') return c.count + ' finished ' + c.job + ' shift' + (c.count === 1 ? '' : 's') + by + ' (' + (c.done || 0) + ' so far)';
  if (c.type === 'commitment') return 'Request ' + c.requestId + ' kept' + by;
  return null;
}

// Counts a finished shift towards any goal of so many shifts.
export function noteShift(actor, job) {
  for (const g of activeGoals(actor)) if (g.condition?.type === 'work' && g.condition.job === job) { g.condition.done++; g.stored = false; }
}

function requestStatus(actor, id) {
  return actor.helpBook?.[id]?.status ?? actor.requestMemories?.find(r => r.id === id)?.status;
}

// Settles any goal whose condition the record now decides. Called each minute.
export function settleGoals(state, emit) {
  const { world, actors } = state, minute = world.minute;
  for (const actor of actors) {
    if (!actor.goalBook) continue;
    let changed = false;
    for (const g of activeGoals(actor)) {
      const c = g.condition;
      if (!c) continue;
      let status = null, why = null;
      if (c.type === 'store' && world.supplies[c.item] >= c.atLeast) [status, why] = ['met', 'The ' + c.item + ' store held ' + world.supplies[c.item] + '.'];
      else if (c.type === 'reach' && actor.action.target === c.place && actor.action.phase === 'working') [status, why] = ['met', actor.name + ' was there.'];
      else if (c.type === 'work' && c.done >= c.count) [status, why] = ['met', c.done + ' shifts were finished.'];
      else if (c.type === 'commitment') {
        const s = requestStatus(actor, c.requestId);
        if (s === 'kept') [status, why] = ['met', 'The promise was kept.'];
        else if (['broken', 'declined', 'unanswered', 'unconfirmed'].includes(s)) [status, why] = ['missed', 'The request ended ' + s + '.'];
        else if (s === 'released' || s == null) [status, why] = ['overtaken', 'The request was withdrawn.'];
      }
      if (!status && minute > c.by) [status, why] = ['missed', 'The time ran out.'];
      if (!status) continue;
      changed = true;
      g.status = status;
      g.settled = minute;
      g.outcome = { minute, why };
      g.stored = false;
      const text = (status === 'met' ? 'Goal met' : status === 'missed' ? 'Goal missed' : 'Goal overtaken') + ' for ' + actor.name + ': “' + g.text + '” ' + why;
      remember(actor, minute, text, [actor.id], 'goal', { goal: g.id });
      g.outcome.memory = memoryKey(actor, actor.memories.at(-1));
      emit('goal', text, [actor.id], { goal: { id: g.id, version: g.version, status } });
      dueReview(actor, minute, 'a goal was ' + status);
      // A settled goal leaves the book once a review has had the chance to read it.
      actor.goalHistory.push(g);
    }
    if (!changed) continue;
    actor.goalBook = actor.goalBook.filter(g => g.status === 'active');
    trimHistory(actor);
    syncGoals(actor);
  }
}

function trimHistory(actor) {
  while (actor.goalHistory.length > 20) {
    const i = actor.goalHistory.findIndex(g => g.stored);
    if (i < 0) break;
    actor.goalHistory.splice(i, 1);
  }
}

// ------------------------------------------------------------------- reviews

export function dueReview(actor, minute, why) {
  if (!actor.reviewDue) actor.reviewDue = { since: minute, why };
}

// Called each minute: something consequential learned, or a long time without direction, calls a review.
export function watchGoals(actor, minute) {
  const latest = actor.memories?.at(-1);
  if (latest && latest.minute === minute && latest.importance >= 8 && latest.kind !== 'goal') dueReview(actor, minute, 'learned something consequential');
  if (minute - (actor.lastReview ?? 0) >= REVIEW_EVERY && minute % DAY === 420) dueReview(actor, minute, 'needs direction');
}

// What a goal review is given: who the resident is, their goals and how the settled ones ended, what
// they remember that bears on them, and the evidence about each person a goal concerns. Every
// observation and piece of evidence carries a key the review cites.
export function reviewInput(actor, state, names = {}, recalled = []) {
  const { world, actors } = state, minute = world.minute;
  const nameOf = id => actors.find(a => a.id === id)?.name || id;
  const goal = g => ({ goalId: g.id, version: g.version, kind: g.kind, text: g.text, focus: g.focus,
    ...(g.about && { about: g.about, aboutName: nameOf(g.about) }), ...(g.condition && { condition: conditionWords(g.condition, names) }),
    since: villageTime(g.since) });
  const settled = (actor.goalHistory || []).filter(g => g.settled > (actor.lastReview ?? -Infinity))
    .map(g => ({ ...goal(g), ended: g.status, how: g.outcome?.why, when: villageTime(g.settled) }));
  const people = [...new Set(activeGoals(actor).map(g => g.about).filter(Boolean))];
  const evidence = people.flatMap(id => evidenceAbout(actor, id).slice(-8).map(e => ({
    key: actor.id + ':' + e.id, about: nameOf(id), when: villageTime(e.minute), text: e.text,
    ...(e.trust && { trustChanged: e.trust }), ...(e.warmth && { warmthChanged: e.warmth }) })));
  return {
    resident: { id: actor.id, name: actor.name, role: actor.role, traits: actor.traits, background: actor.backstory },
    time: villageTime(minute), whyThisReview: actor.reviewDue?.why || 'needs direction',
    needs: Object.fromEntries(Object.entries(actor.needs).map(([k, v]) => [k, Math.round(v)])),
    goals: activeGoals(actor).map(goal), settledSinceLastReview: settled,
    observations: recalled.map(m => ({ key: memoryKey(actor, m), when: villageTime(m.minute), text: m.text, importance: m.importance, source: m.source })),
    evidence,
    neighbours: actors.filter(a => a !== actor).map(a => ({ id: a.id, name: a.name, role: a.role,
      warmth: Math.round(actor.relationships?.[a.id] ?? 0), trust: Math.round(actor.trust?.[a.id] ?? 40) })),
    openRequests: Object.values(actor.helpBook || {}).filter(r => ['asked', 'accepted'].includes(r.status))
      .map(r => ({ requestId: r.id, asker: r.asker, helper: r.helper, terms: r.terms, status: r.status, due: villageTime(r.due) })),
    places: Object.values(names).filter(p => p.stage === 2).map(p => ({ id: p.id, name: p.name })),
    vocabulary: { stores: STORE_ITEMS, jobs: GOAL_JOBS, conditions: ['store', 'reach', 'work', 'commitment'] },
  };
}

// Applies a goal review's decisions to the resident. Each decision is checked first, and one that fails
// a check is set aside with its reason. Returns what changed and what was set aside.
export function applyReview(actor, state, reply, { reviewId, offered }) {
  const minute = state.world.minute, applied = [], rejected = [];
  const keys = new Set(offered);
  const people = new Set(state.actors.filter(a => a !== actor).map(a => a.id));
  const cites = d => (Array.isArray(d.evidence) ? d.evidence : []).filter(k => keys.has(k));
  let added = 0;
  for (const d of Array.isArray(reply?.decisions) ? reply.decisions : []) {
    const reject = why => rejected.push({ decision: d, why });
    const current = d.goalId ? activeGoals(actor).find(g => g.id === d.goalId) : null;
    if (d.action !== 'new' && !current) { reject('no goal ' + d.goalId + ' in force'); continue; }
    // A goal about another resident is kept, revised or retired on recorded evidence, and says which.
    const basis = cites(d);
    if (current?.kind === 'evidence' && current.about && !basis.length && d.action !== 'keep') { reject('a goal about ' + current.about + ' was changed without citing evidence'); continue; }
    if (d.action === 'keep') {
      if (basis.length) { current.basis = [...new Set([...current.basis, ...basis])]; current.stored = false; }
      applied.push({ action: 'keep', goal: current.id });
      continue;
    }
    if (d.action === 'retire') {
      current.status = 'retired';
      current.settled = minute;
      current.outcome = { minute, why: 'Retired at a review.', reviewId };
      current.basis = [...new Set([...current.basis, ...basis])];
      current.stored = false;
      actor.goalHistory.push(current);
      actor.goalBook = actor.goalBook.filter(g => g !== current);
      applied.push({ action: 'retire', goal: current.id });
      continue;
    }
    // A new goal or a new version of one.
    const text = typeof d.text === 'string' ? d.text.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
    if (!text) { reject('no words for the goal'); continue; }
    if (!FOCI.includes(d.focus)) { reject('unknown focus ' + d.focus); continue; }
    const kind = d.kind === 'condition' ? 'condition' : 'evidence';
    let condition = null;
    if (kind === 'condition') {
      condition = checkCondition(d.condition || {}, actor, state);
      if (typeof condition === 'string') { reject(condition); continue; }
    }
    const about = d.about && people.has(d.about) ? d.about : null;
    if (d.about && !about) { reject('unknown resident ' + d.about); continue; }
    if (d.action === 'new' && (activeGoals(actor).length >= MAX_GOALS || added >= 2)) { reject('too many goals'); continue; }
    const version = d.action === 'revise' ? current.version + 1 : 1;
    const id = d.action === 'revise' ? current.id : 'g' + (actor.goalSeq = (actor.goalSeq || 0) + 1);
    if (current) {
      current.status = 'revised';
      current.settled = minute;
      current.outcome = { minute, why: 'Revised at a review.', reviewId };
      current.stored = false;
      actor.goalHistory.push(current);
      actor.goalBook = actor.goalBook.filter(g => g !== current);
    } else added++;
    actor.goalBook.push({ id, version, kind, text, focus: d.focus, ...(about && { about }), ...(condition && { condition }),
      status: 'active', since: minute, source: 'review', reviewId, basis, stored: false });
    applied.push({ action: d.action, goal: id, version });
  }
  // The calling stays first.
  actor.goalBook.sort((a, b) => (a.focus === 'work' ? 0 : 1) - (b.focus === 'work' ? 0 : 1) || a.since - b.since);
  trimHistory(actor);
  syncGoals(actor);
  actor.lastReview = minute;
  delete actor.reviewDue;
  return { applied, rejected };
}

// A resident's own sentence about a revision. It is published as their stated intention, in their
// name, and never as a verified motive. Anything that is not one plain sentence is not published.
export function screenStatement(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().replace(/\s+/g, ' ').replace(/^["“'‘]+|["”'’]+$/g, '');
  if (s.length < 8 || s.length > 200) return null;
  if (/https?:|www\.|[<>{}\[\]\\@#*_`|]/.test(s)) return null;
  if ((s.match(/[.!?](\s|$)/g) || []).length > 1) return null;
  return /[.!?]$/.test(s) ? s : s + '.';
}

// What a resident's request to the action model says of their goals.
export function goalContext(actor, names = {}) {
  return activeGoals(actor).map(g => ({ text: g.text, ...(g.condition && { condition: conditionWords(g.condition, names) }) }));
}
