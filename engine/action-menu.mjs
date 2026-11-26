import { warmthOf } from './bonds.mjs';
import { preferredOuting } from './foraging.mjs';
import { activeGoals } from './goals.mjs';
import { lifeVerbs, tooIll } from './lives.mjs';
import { place } from './roads.mjs';
import { isNight, PILOT } from './standing.mjs';
import { requestIsOpen } from './request-review.mjs';
import { villageJobs } from './village-work.mjs';
import { isOwnTrade } from './workday.mjs';
import { knownShelfCount } from './storehouse.mjs';
import { wornShoes } from './footwear.mjs';

const TARGET_SIZE = 12;
const VISIT_LIMIT = 4;
const NEWS_LIMIT = 2;

export function restockingPreference(actor, world, feasible) {
  const goals = activeGoals(actor);
  const goalFor = item => goals.some(goal => goal.condition?.type === 'store' && goal.condition.item === item);
  const seen = knownShelfCount(actor);
  const countedEmpty = item => seen?.stock?.[item] === 0 && world.minute - seen.minute <= 1440;
  const choiceFor = (...jobs) => jobs.map(job => [...feasible].find(([, action]) => action.job === job)?.[0]).find(Boolean);
  const preserveGoal = goalFor('preserved');
  if (preserveGoal || countedEmpty('preserved')) {
    const choice = choiceFor('cureFish', 'smokeMeat', 'smokeMutton', 'dressGame');
    if (choice) return { choice, reason: preserveGoal ? 'My goal is to put preserved food on the storehouse shelves.'
      : 'The last storehouse count I know of found no preserved food.' };
  }
  const leatherGoal = goalFor('leather');
  if (leatherGoal || (wornShoes(actor) && countedEmpty('leather'))) {
    const choice = choiceFor('tanHide', 'dressGame');
    if (choice) return { choice, reason: leatherGoal ? 'My goal is to put leather on the storehouse shelves.'
      : 'My shoes need mending and the last count I know of found no leather.' };
  }
}

function closeBy(actor, other) {
  return other && Math.hypot(other.position.x - actor.position.x, other.position.y - actor.position.y) <= 3;
}

function relevantPeople(actor, minute) {
  const ids = new Set([...activeGoals(actor).map(goal => goal.about), actor.courting?.with, actor.proposal?.from]);
  for (const request of Object.values(actor.helpBook || {})) {
    if (!requestIsOpen(request) || request.due < minute) continue;
    ids.add(request.askerId === actor.id ? request.helperId : request.askerId);
  }
  ids.delete(undefined);
  return ids;
}

function shortlistVisits(visits, actor, residents, relevant) {
  const warmth = ([, a], [, b]) => warmthOf(actor, b.friendId) - warmthOf(actor, a.friendId);
  const lastMet = ([, a], [, b]) => (actor.met?.[a.friendId] ?? -1) - (actor.met?.[b.friendId] ?? -1);
  const nearby = visits.filter(([, action]) => closeBy(actor, residents.get(action.friendId))).sort(warmth);
  const first = [
    ...visits.filter(([, action]) => relevant.has(action.friendId)).sort(warmth),
    ...nearby.slice(0, 1),
    ...visits.slice().sort(warmth).slice(0, 1),
    ...visits.slice().sort(lastMet),
  ];
  return new Set([...new Set(first.map(([id]) => id))].slice(0, VISIT_LIMIT));
}

function newsRelevance(action, recipient, actor, relevant) {
  const fact = action.fact;
  if (!recipient || !fact) return -1;
  const trade = fact.topic === 'oven' ? 'bake' : fact.topic === 'store' ? 'keep' : null;
  if (recipient.trade === trade || (fact.site && recipient.workplace === fact.site)) return 2;
  if (relevant.has(recipient.id)) return 1;
  return closeBy(actor, recipient) ? 0 : -1;
}

function workPriority(action) {
  if (action.kind === 'report' || action.job === 'fish' || action.job === 'hunt') return 0;
  return Object.hasOwn(villageJobs, action.job) ? 2 : 1;
}

function companySeen(actor, state, menu) {
  const { actors, map } = state;
  return [...menu.values()].filter(action => action.company).flatMap(action => {
    const venue = place(map, action.target);
    const [x, y] = venue.at;
    if (Math.hypot(actor.position.x - x, actor.position.y - y) > 3) return [];
    const people = actors.filter(other => other !== actor && other.action.phase === 'working'
      && other.action.target === action.target && !['rest', 'arrive'].includes(other.action.kind) && closeBy(actor, other));
    return people.length ? [{ place: venue.name, people: people.map(other => other.name) }] : [];
  });
}

// The full feasible menu is used for standing instructions and late replies. This pass only shapes
// what the model sees for a fresh choice. Conditions such as an exclusive request review apply first.
export function shapeActionMenu(actor, state, feasible, ownTrade) {
  const minute = state.world.minute;
  const rows = [...feasible];
  const residents = new Map(state.actors.map(other => [other.id, other]));
  const relevant = relevantPeople(actor, minute);
  const protectedChoices = new Map();
  const protect = (id, reason) => { if (id && !protectedChoices.has(id)) protectedChoices.set(id, reason); };
  protect(rows.find(([, action]) => action.kind === 'civic' && action.verb === 'raise')?.[0], 'proposal');
  for (const [id, action] of rows) {
    if (action.kind === 'civic' && action.verb === 'position') protect(id, 'position');
    if (action.kind === 'ballot') protect(id, 'ballot');
    if (action.kind === 'review' || action.requestId || action.commitmentId || action.verb === 'ask' ||
        (action.verb === 'share' && action.fact?.kept && action.fact?.requestId)) protect(id, 'request');
    if (lifeVerbs.has(action.verb)) protect(id, 'life');
    if (action.kind === 'meeting' || action.feast) protect(id, 'village_event');
    if (action.kind === 'teach') protect(id, 'lesson');
    if (action.kind === 'compose') protect(id, 'songwriting_project');
    if (action.kind === 'food' && actor.needs.hunger >= PILOT.mealAt) protect(id, 'due_meal');
    if (action.job === 'fetchPreserved' || action.householdBreakfast) protect(id, 'household_breakfast');
    if (action.seasonalFood) protect(id, 'seasonal_food');
    if (action.kind === 'rest' && (isNight(minute) || tooIll(actor) ||
        Math.max(actor.needs.fatigue, actor.needs.cold ?? 0) >= PILOT.urgent)) protect(id, 'rest');
  }
  const trade = rows.filter(([, action]) => isOwnTrade(actor, action));
  if (actor.trade === 'report') {
    trade.sort(([, a], [, b]) => (actor.rounds?.[a.target] ?? -1) - (actor.rounds?.[b.target] ?? -1));
  }
  protect(trade[0]?.[0], 'own_trade');
  if (actor.trade === 'bake' && !trade.length) protect(rows.find(([, action]) => action.kind === 'inspect')?.[0], 'oven_check');
  protect(preferredOuting(actor, feasible)?.choice, 'preferred_outing');
  protect(restockingPreference(actor, state.world, feasible)?.choice, 'restocking');

  const visits = shortlistVisits(rows.filter(([, a]) => a.kind === 'social'), actor, residents, relevant);
  const ordinaryNews = rows.filter(([id, action]) => action.verb === 'share' && !protectedChoices.has(id))
    .map(([id, action]) => ({ id, action, relevance: newsRelevance(action, residents.get(action.friendId), actor, relevant) }));
  const distantNews = new Set(ordinaryNews.filter(news => news.relevance < 0).map(news => news.id));
  const news = new Set(ordinaryNews.filter(item => item.relevance >= 0)
    .sort((a, b) => b.relevance - a.relevance || Number(Boolean(b.action.onSpot)) - Number(Boolean(a.action.onSpot)) ||
      (b.action.fact?.minute ?? 0) - (a.action.fact?.minute ?? 0))
    .slice(0, NEWS_LIMIT).map(item => item.id));

  const venues = new Set(rows.filter(([, a]) => a.company).map(([, a]) => a.target));
  const omitted = new Map();
  const work = [], company = [], visiting = [], telling = [], needs = [], other = [];
  for (const [id, action] of rows) {
    if (protectedChoices.has(id)) continue;
    if (action.kind === 'social') {
      if (visits.has(id)) visiting.push(id);
      else omitted.set(id, 'visit_limit');
    } else if (action.verb === 'share') {
      if (news.has(id)) telling.push(id);
      else omitted.set(id, distantNews.has(id) ? 'news_audience' : 'news_limit');
    } else if (action.company) company.push(id);
    else if (action.kind === 'leisure' && venues.has(action.target)) omitted.set(id, 'company_by_place');
    else if (action.kind === 'work' || action.kind === 'report') work.push(id);
    else if (['food', 'rest', 'inspect'].includes(action.kind)) needs.push(id);
    else other.push(id);
  }
  work.sort((a, b) => workPriority(feasible.get(b)) - workPriority(feasible.get(a)));
  const groups = [work, company, needs, visiting, telling, other];
  const selected = new Set(protectedChoices.keys());
  for (let i = 0; selected.size < TARGET_SIZE && groups.some(group => i < group.length); i++) {
    for (const group of groups) {
      if (group[i]) selected.add(group[i]);
      if (selected.size >= TARGET_SIZE) break;
    }
  }
  const menu = new Map(rows.filter(([id]) => selected.has(id)));
  const audit = {
    target: TARGET_SIZE,
    feasible: feasible.size,
    protected: Object.fromEntries(protectedChoices),
    omitted: rows.filter(([id]) => !selected.has(id)).map(([id, action]) => ({
      id, reason: omitted.get(id) ?? 'menu_target', kind: action.kind, ...(action.job && { job: action.job }),
    })),
    ...(ownTrade && { ownTrade: { job: actor.trade, status: ownTrade.status } }),
  };
  const companions = companySeen(actor, state, menu);
  return { menu, audit, context: {
    ...(ownTrade?.note && { ownTrade: ownTrade.note }),
    ...(companions.length && { nearbyCompany: companions }),
  } };
}
